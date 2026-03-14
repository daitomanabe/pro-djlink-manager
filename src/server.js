const path = require("path");
const http = require("http");
const os = require("os");
const dgram = require("dgram");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const { EventEmitter } = require("events");
const nodeConsole = require("console");

const express = require("express");
const WebSocket = require("ws");
const osc = require("osc");
const {
  PioneerDJTCClient,
  TCNetClient,
  TCNetConfiguration,
  TCNetDataPacketMetadata,
  TCNetManagementHeader,
  TCNetMessageType,
  LayerIndex,
  TCNetLayerStatus,
} = require("node-tcnet");
const {
  DEFAULT_SELECTION_HOLD_SECONDS,
  DEFAULT_SELECTION_MODE,
  normalizeBpm,
  selectAudibleTrack,
} = require("./track-selection");
const { buildRuleBasedTrackAnalysis } = require("./rule-based-track-analysis");
const {
  DEFAULT_ANALYSIS_FOCUS,
  DEFAULT_ANALYSIS_MODEL,
  OpenAITrackAnalyzer,
} = require("./openai-track-analysis");
const { DummyPlaybackEngine } = require("./dummy-playback");

nodeConsole.assert = () => {};

const HTTP_PORT = parseNumber(process.env.PORT, 3000);
const TCNET_BROADCAST_PORT = 60000;
const TCNET_TIMESTAMP_PORT = 60001;
const TRACK_PROFILE_DIR = path.join(__dirname, "..", "data", "track-profiles");
const MONITORED_LAYERS = [
  LayerIndex.Layer1,
  LayerIndex.Layer2,
  LayerIndex.Layer3,
  LayerIndex.Layer4,
];
const ACTIVE_PLAYBACK_STATES = new Set([TCNetLayerStatus.PLAYING, TCNetLayerStatus.LOOPING]);
const STATUS_LABELS = Object.fromEntries(
  Object.entries(TCNetLayerStatus)
    .filter(([, value]) => Number.isInteger(value))
    .map(([key, value]) => [value, key]),
);

function nowIso() {
  return new Date().toISOString();
}

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

function slugifySegment(value, fallback) {
  const slug = `${value || ""}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();

  return slug || fallback;
}

function listInterfaces() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses || [])
        .filter((address) => address.family === "IPv4" && !address.internal)
        .map((address) => ({
          name,
          address: address.address,
          cidr: address.cidr || null,
        })),
    )
    .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}

function statusLabel(code) {
  return STATUS_LABELS[code] || `UNKNOWN(${code})`;
}

function createLayerSnapshot(layer) {
  return {
    layer,
    trackId: -1,
    trackTitle: "",
    trackArtist: "",
    trackKey: null,
    stateCode: TCNetLayerStatus.IDLE,
    state: statusLabel(TCNetLayerStatus.IDLE),
    currentPosition: null,
    trackLength: null,
    beatMarker: null,
    beatNumber: null,
    bpm: null,
    speed: null,
    pitchBend: null,
    syncMaster: null,
    mixerLevel: null,
    channelFader: null,
    isTransportAdvancing: false,
    lastPositionSample: null,
    lastPositionSampleEpochMs: 0,
    lastPositionDelta: 0,
    lastPositionAdvancedAt: null,
    lastPositionAdvancedEpochMs: 0,
    lastTrackChangeAt: null,
    lastTrackChangeEpochMs: 0,
    lastPlaybackStartAt: null,
    lastPlaybackStartEpochMs: 0,
    lastUpdatedAt: null,
    metadataError: null,
  };
}

function applyTCNetSocketPatch() {
  if (TCNetClient.prototype.__codexSocketPatchApplied) {
    return;
  }

  // node-tcnet binds its broadcast listeners to the interface broadcast address.
  // That fails on macOS with EADDRNOTAVAIL, even though sending to the broadcast
  // address is valid. Binding to 0.0.0.0 keeps packet reception working while
  // preserving the original broadcast destination for outgoing discovery.
  TCNetClient.prototype.connect = async function connectWithWildcardBind() {
    this.broadcastSocket = dgram.createSocket({ type: "udp4", reuseAddr: true }, this.receiveBroadcast.bind(this));
    await this.bindSocket(this.broadcastSocket, TCNET_BROADCAST_PORT, "0.0.0.0");
    this.broadcastSocket.setBroadcast(true);

    this.timestampSocket = dgram.createSocket({ type: "udp4", reuseAddr: true }, this.receiveTimestamp.bind(this));
    await this.bindSocket(this.timestampSocket, TCNET_TIMESTAMP_PORT, "0.0.0.0");
    this.timestampSocket.setBroadcast(true);

    this.unicastSocket = dgram.createSocket({ type: "udp4", reuseAddr: false }, this.receiveUnicast.bind(this));
    await this.bindSocket(this.unicastSocket, this.config.unicastPort, "0.0.0.0");

    await this.announceApp();
    this.announcementInterval = setInterval(this.announceApp.bind(this), 1000);
    await this.waitConnected();
  };

  TCNetClient.prototype.__codexSocketPatchApplied = true;
}

applyTCNetSocketPatch();

function applyTCNetHeaderPatch() {
  if (TCNetManagementHeader.prototype.__codexHeaderPatchApplied) {
    return;
  }

  TCNetManagementHeader.prototype.read = function readHeaderSafely() {
    this.nodeId = this.buffer.length >= 2 ? this.buffer.readUInt16LE(0) : 0;

    const majorVersion = this.buffer.length >= 3 ? this.buffer.readUInt8(2) : -1;
    const magicHeader = this.buffer.length >= 7 ? this.buffer.subarray(4, 7).toString("ascii") : "";

    if (majorVersion !== TCNetManagementHeader.MAJOR_VERSION || magicHeader !== TCNetManagementHeader.MAGIC_HEADER) {
      this.minorVersion = 0;
      this.messageType = TCNetMessageType.Error;
      this.nodeName = "";
      this.seq = 0;
      this.nodeType = 0;
      this.nodeOptions = 0;
      this.timestamp = 0;
      return;
    }

    this.minorVersion = this.buffer.readUInt8(3);
    this.messageType = this.buffer.readUInt8(7);
    this.nodeName = this.buffer.subarray(8, 16).toString("ascii").replace(/\0.*$/g, "");
    this.seq = this.buffer.readUInt8(16);
    this.nodeType = this.buffer.readUInt8(17);
    this.nodeOptions = this.buffer.readUInt16LE(18);
    this.timestamp = this.buffer.readUInt32LE(20);
  };

  TCNetManagementHeader.prototype.__codexHeaderPatchApplied = true;
}

applyTCNetHeaderPatch();

function decodeMetadataString(buffer) {
  const utf32Characters = [];
  let utf32Detected = false;

  for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
    const codePoint = buffer.readUInt32LE(offset);
    if (codePoint === 0) {
      break;
    }

    utf32Detected = true;
    utf32Characters.push(String.fromCodePoint(codePoint));
  }

  if (utf32Detected) {
    return utf32Characters.join("").trim();
  }

  const ascii = buffer.toString("ascii").replace(/\0.*$/g, "").trim();
  const utf16 = buffer.toString("utf16le").replace(/\0.*$/g, "").trim();
  const zeroByteCount = [...buffer].filter((value) => value === 0).length;

  if (zeroByteCount > buffer.length / 4 && utf16.length > 0) {
    return utf16;
  }

  return utf16.length > ascii.length ? utf16 : ascii;
}

function applyTCNetMetadataPatch() {
  if (TCNetDataPacketMetadata.prototype.__codexMetadataPatchApplied) {
    return;
  }

  TCNetDataPacketMetadata.prototype.read = function readMetadataPacket() {
    this.trackArtist = decodeMetadataString(this.buffer.subarray(29, 285));
    this.trackTitle = decodeMetadataString(this.buffer.subarray(285, 541));
    this.trackKey = this.buffer.readUInt16LE(541);
    this.trackID = this.buffer.readUInt32LE(543);
  };

  TCNetDataPacketMetadata.prototype.__codexMetadataPatchApplied = true;
}

applyTCNetMetadataPatch();

class BridgeOscService extends EventEmitter {
  constructor() {
    super();

    const [defaultInterface] = listInterfaces();
    this.trackAnalyzer = new OpenAITrackAnalyzer();

    this.state = {
      bridge: {
        interfaceName: defaultInterface?.name || "",
        interfaceAddress: defaultInterface?.address || "",
        connected: false,
        connecting: false,
        sourceMode: "live",
        connectedAt: null,
        lastError: null,
        lastHeartbeatAt: null,
      },
      osc: {
        host: process.env.OSC_HOST || "127.0.0.1",
        port: parseNumber(process.env.OSC_PORT, 29001),
        currentTrackAddress: "/pro-dj-link/currentTrack",
        trackChangedAddress: "/pro-dj-link/trackChanged",
        trackProfileAddress: "/pro-dj-link/trackProfile",
        testAddress: "/pro-dj-link/test",
      },
      selection: {
        mode: DEFAULT_SELECTION_MODE,
        holdSeconds: DEFAULT_SELECTION_HOLD_SECONDS,
        evaluation: {
          mode: DEFAULT_SELECTION_MODE,
          selectedLayer: null,
          masterLayer: null,
          masterSignalAvailable: false,
          mixerSignalAvailable: false,
          candidates: [],
          reason: "Selection has not run yet.",
        },
      },
      analysis: {
        configured: this.trackAnalyzer.isConfigured(),
        autoAnalyze: true,
        model: DEFAULT_ANALYSIS_MODEL,
        focus: DEFAULT_ANALYSIS_FOCUS,
        running: false,
        lastError: null,
        updatedAt: null,
        currentTrackKey: null,
        savedProfilePath: null,
        ruleBased: null,
        result: null,
      },
      currentTrack: null,
      lastChange: null,
      layers: MONITORED_LAYERS.map(createLayerSnapshot),
      events: [],
    };

    this.layersByIndex = new Map(this.state.layers.map((layer) => [layer.layer, layer]));
    this.client = null;
    this.oscSocket = dgram.createSocket("udp4");
    this.resyncTimer = null;
    this.pendingStateFlush = null;
    this.lastAnnouncedTrackKey = null;
    this.analysisRequestSerial = 0;
    this.dummyEngine = null;
    this.dummyTimer = null;
  }

  serializeState() {
    const interfaces = listInterfaces();
    const selectedInterface = interfaces.find((entry) => entry.name === this.state.bridge.interfaceName);

    return {
      bridge: {
        ...this.state.bridge,
        interfaceAddress: selectedInterface?.address || this.state.bridge.interfaceAddress || "",
        lastChange: this.state.lastChange?.detectedAt || null,
      },
      osc: { ...this.state.osc },
      selection: {
        ...this.state.selection,
        evaluation: {
          ...this.state.selection.evaluation,
          candidates: this.state.selection.evaluation.candidates.map((candidate) => ({
            ...candidate,
            reasons: candidate.reasons.map((reason) => ({ ...reason })),
          })),
        },
      },
      analysis: {
        ...this.state.analysis,
        configured: this.trackAnalyzer.isConfigured() || this.isDummyMode(),
        ruleBased: this.state.analysis.ruleBased ? { ...this.state.analysis.ruleBased } : null,
        result: this.state.analysis.result ? { ...this.state.analysis.result } : null,
      },
      currentTrack: this.state.currentTrack ? { ...this.state.currentTrack } : null,
      layers: this.state.layers.map((layer) => ({ ...layer })),
      events: this.state.events.map((entry) => ({ ...entry })),
      dummy: {
        active: this.isDummyMode(),
      },
      networkInterfaces: interfaces,
    };
  }

  pushEvent(type, message, level = "info") {
    this.state.events.unshift({
      id: randomUUID(),
      type,
      level,
      message,
      at: nowIso(),
    });
    this.state.events = this.state.events.slice(0, 40);
    this.scheduleStateFlush();
  }

  scheduleStateFlush() {
    if (this.pendingStateFlush) {
      return;
    }

    this.pendingStateFlush = setTimeout(() => {
      this.pendingStateFlush = null;
      this.emit("state", this.serializeState());
    }, 80);
  }

  getLayer(layer) {
    return this.layersByIndex.get(layer);
  }

  isMonitoredLayer(layer) {
    return this.layersByIndex.has(layer);
  }

  resetLayers() {
    this.state.layers = MONITORED_LAYERS.map(createLayerSnapshot);
    this.layersByIndex = new Map(this.state.layers.map((layer) => [layer.layer, layer]));
  }

  isDummyMode() {
    return this.state.bridge.sourceMode === "dummy" || Boolean(this.dummyTimer);
  }

  ensureDummyEngine() {
    if (!this.dummyEngine) {
      this.dummyEngine = new DummyPlaybackEngine({ layers: MONITORED_LAYERS });
    }

    return this.dummyEngine;
  }

  stopDummyTimer() {
    if (this.dummyTimer) {
      clearInterval(this.dummyTimer);
      this.dummyTimer = null;
    }

    if (this.dummyEngine) {
      this.dummyEngine.stop();
    }
  }

  updatePositionTelemetry(snapshot, nextPosition, sampleIso, sampleEpochMs) {
    if (!Number.isFinite(nextPosition) || nextPosition < 0) {
      return;
    }

    const previousPosition = snapshot.lastPositionSample;
    const previousSampleEpochMs = snapshot.lastPositionSampleEpochMs;

    snapshot.currentPosition = nextPosition;
    snapshot.lastPositionSample = nextPosition;
    snapshot.lastPositionSampleEpochMs = sampleEpochMs;

    if (!Number.isFinite(previousPosition) || !previousSampleEpochMs || sampleEpochMs <= previousSampleEpochMs) {
      snapshot.lastPositionDelta = 0;
      return;
    }

    const delta = nextPosition - previousPosition;
    snapshot.lastPositionDelta = delta;
    snapshot.isTransportAdvancing = delta > 0;

    if (delta > 0) {
      snapshot.lastPositionAdvancedAt = sampleIso;
      snapshot.lastPositionAdvancedEpochMs = sampleEpochMs;
    }
  }

  currentTrackKey(track) {
    if (!track || track.trackId <= 0) {
      return null;
    }

    return `${track.layer}:${track.trackId}`;
  }

  buildDummyAnalysisResult(track = this.state.currentTrack) {
    if (!track || !this.dummyEngine) {
      return null;
    }

    const result = this.dummyEngine.buildAnalysis(track, this.state.analysis.ruleBased);
    if (!result) {
      return null;
    }

    return {
      ...result,
      title: track.title,
      artist: track.artist,
      trackId: track.trackId,
      layer: track.layer,
    };
  }

  applyDummyAnalysis(track = this.state.currentTrack) {
    const result = this.buildDummyAnalysisResult(track);
    if (!result) {
      return null;
    }

    this.state.analysis.result = result;
    this.state.analysis.updatedAt = nowIso();
    this.state.analysis.running = false;
    this.state.analysis.lastError = null;
    this.state.analysis.currentTrackKey = this.currentTrackKey(track);
    return result;
  }

  async startDummyMode() {
    if (this.state.bridge.connecting) {
      throw new Error("Bridge is connecting. Wait for it to finish before starting dummy mode.");
    }

    await this.disconnect({ silent: true });

    const engine = this.ensureDummyEngine();
    const startedAt = Date.now();
    engine.start(startedAt);

    this.state.bridge.connected = true;
    this.state.bridge.connecting = false;
    this.state.bridge.sourceMode = "dummy";
    this.state.bridge.connectedAt = nowIso();
    this.state.bridge.lastError = null;
    this.state.bridge.lastHeartbeatAt = nowIso();
    this.state.selection.evaluation = {
      mode: this.state.selection.mode,
      selectedLayer: null,
      masterLayer: null,
      masterSignalAvailable: false,
      mixerSignalAvailable: true,
      candidates: [],
      reason: "Dummy manual mode is warming up.",
    };

    await this.applyDummyFrame(engine.update(startedAt));

    this.dummyTimer = setInterval(() => {
      void this.handleDummyTick();
    }, engine.tickMs);

    this.pushEvent("bridge", "Dummy manual mode started.");
    this.scheduleStateFlush();
    return this.serializeState();
  }

  async stopDummyMode(options = {}) {
    const wasActive = this.isDummyMode();
    this.stopDummyTimer();

    if (wasActive && !options.silent) {
      this.pushEvent("bridge", "Dummy manual mode stopped.");
    }
  }

  async handleDummyTick() {
    if (!this.dummyEngine) {
      return;
    }

    await this.applyDummyFrame(this.dummyEngine.update(Date.now()));
  }

  async applyDummyFrame(frame) {
    if (!frame) {
      return;
    }

    const sampleEpochMs = frame.generatedAtMs || Date.now();
    const sampleIso = new Date(sampleEpochMs).toISOString();
    this.state.bridge.connected = true;
    this.state.bridge.connecting = false;
    this.state.bridge.sourceMode = "dummy";
    this.state.bridge.lastHeartbeatAt = sampleIso;

    for (const layerState of frame.layers || []) {
      const snapshot = this.getLayer(layerState.layer);
      if (!snapshot) {
        continue;
      }

      const previousState = snapshot.stateCode;
      const previousTrackId = snapshot.trackId;

      if (previousTrackId !== layerState.trackId) {
        snapshot.lastTrackChangeAt = sampleIso;
        snapshot.lastTrackChangeEpochMs = sampleEpochMs;
        snapshot.metadataError = null;
        this.pushEvent(
          "track",
          `Layer ${layerState.layer} loaded ${layerState.trackTitle || `track ${layerState.trackId}`}.`,
        );
      }

      snapshot.trackId = layerState.trackId;
      snapshot.trackTitle = layerState.trackTitle || "";
      snapshot.trackArtist = layerState.trackArtist || "";
      snapshot.trackKey = layerState.trackKey ?? null;
      snapshot.stateCode = layerState.stateCode;
      snapshot.state = statusLabel(layerState.stateCode);
      this.updatePositionTelemetry(snapshot, layerState.currentPosition, sampleIso, sampleEpochMs);
      snapshot.trackLength = layerState.trackLength ?? snapshot.trackLength;
      snapshot.beatMarker = layerState.beatMarker ?? snapshot.beatMarker;
      snapshot.beatNumber = layerState.beatNumber ?? snapshot.beatNumber;
      snapshot.bpm = layerState.bpm ?? snapshot.bpm;
      snapshot.speed = layerState.speed ?? snapshot.speed;
      snapshot.pitchBend = layerState.pitchBend ?? snapshot.pitchBend;
      snapshot.syncMaster = layerState.syncMaster ?? snapshot.syncMaster;
      snapshot.mixerLevel = layerState.mixerLevel ?? null;
      snapshot.channelFader = layerState.channelFader ?? layerState.mixerLevel ?? null;
      snapshot.lastUpdatedAt = sampleIso;

      if (ACTIVE_PLAYBACK_STATES.has(layerState.stateCode) && !ACTIVE_PLAYBACK_STATES.has(previousState)) {
        snapshot.lastPlaybackStartAt = sampleIso;
        snapshot.lastPlaybackStartEpochMs = sampleEpochMs;
      }
    }

    await this.refreshActiveTrack();
    this.scheduleStateFlush();
  }

  buildTrackProfilePayload(track = this.state.currentTrack, selection = this.state.selection.evaluation) {
    if (!track) {
      return null;
    }

    return {
      version: 1,
      generatedAt: nowIso(),
      track: {
        ...track,
      },
      playback: {
        layer: track.layer,
        state: track.state,
        currentPositionMs: track.currentPosition,
        trackLengthMs: track.trackLength,
        detectedAt: track.detectedAt,
      },
      selection,
      analysis: {
        hasAtmosphere: Boolean(this.state.analysis.result),
        ruleBased: this.state.analysis.ruleBased,
        atmosphere: this.state.analysis.result,
      },
    };
  }

  async saveTrackProfileJson(profile) {
    if (!profile?.track) {
      return null;
    }

    await fs.mkdir(TRACK_PROFILE_DIR, { recursive: true });

    const titleSlug = slugifySegment(profile.track.title, `track-${profile.track.trackId}`);
    const artistSlug = slugifySegment(profile.track.artist, "unknown-artist");
    const baseName = `${artistSlug}__${titleSlug}__${profile.track.trackId}`;
    const stampedFile = path.join(TRACK_PROFILE_DIR, `${baseName}__latest.json`);
    const latestFile = path.join(TRACK_PROFILE_DIR, "current-track-profile.json");
    const body = `${JSON.stringify(profile, null, 2)}\n`;

    await Promise.all([fs.writeFile(stampedFile, body, "utf8"), fs.writeFile(latestFile, body, "utf8")]);
    return stampedFile;
  }

  async updateConfig(input) {
    const nextInterface = typeof input.bridgeInterface === "string" ? input.bridgeInterface.trim() : this.state.bridge.interfaceName;
    const nextOscHost = typeof input.oscHost === "string" ? input.oscHost.trim() : this.state.osc.host;
    const nextOscPort = parseNumber(input.oscPort, this.state.osc.port);
    const nextCurrentTrackAddress =
      typeof input.currentTrackAddress === "string" ? input.currentTrackAddress.trim() : this.state.osc.currentTrackAddress;
    const nextTrackChangedAddress =
      typeof input.trackChangedAddress === "string" ? input.trackChangedAddress.trim() : this.state.osc.trackChangedAddress;
    const nextTrackProfileAddress =
      typeof input.trackProfileAddress === "string" ? input.trackProfileAddress.trim() : this.state.osc.trackProfileAddress;
    const nextTestAddress = typeof input.testAddress === "string" ? input.testAddress.trim() : this.state.osc.testAddress;
    const nextSelectionMode =
      typeof input.selectionMode === "string" ? input.selectionMode.trim() : this.state.selection.mode;
    const nextSelectionHoldSeconds = parseNumber(input.selectionHoldSeconds, this.state.selection.holdSeconds);
    const nextAnalysisAutoAnalyze = parseBoolean(input.analysisAutoAnalyze, this.state.analysis.autoAnalyze);
    const nextAnalysisModel =
      typeof input.analysisModel === "string" ? input.analysisModel.trim() : this.state.analysis.model;
    const nextAnalysisFocus =
      typeof input.analysisFocus === "string" ? input.analysisFocus.trim() : this.state.analysis.focus;

    const availableInterfaces = listInterfaces();
    if (nextInterface && !availableInterfaces.some((entry) => entry.name === nextInterface)) {
      throw new Error(`Network interface "${nextInterface}" was not found.`);
    }

    if (!nextOscHost) {
      throw new Error("OSC host is required.");
    }

    if (!(nextOscPort >= 1 && nextOscPort <= 65535)) {
      throw new Error("OSC port must be between 1 and 65535.");
    }

    const addresses = [nextCurrentTrackAddress, nextTrackChangedAddress, nextTrackProfileAddress, nextTestAddress];
    if (addresses.some((address) => !address.startsWith("/"))) {
      throw new Error("OSC addresses must start with '/'.");
    }

    if (!["balanced", "master_first", "recent_start", "lowest_position"].includes(nextSelectionMode)) {
      throw new Error("Selection mode is invalid.");
    }

    if (!(nextSelectionHoldSeconds >= 0 && nextSelectionHoldSeconds <= 120)) {
      throw new Error("Selection hold seconds must be between 0 and 120.");
    }

    if (!nextAnalysisModel) {
      throw new Error("OpenAI model is required.");
    }

    if (!nextAnalysisFocus) {
      throw new Error("Analysis focus is required.");
    }

    const shouldReconnect =
      this.state.bridge.connected && nextInterface && nextInterface !== this.state.bridge.interfaceName;

    this.state.bridge.interfaceName = nextInterface;
    this.state.bridge.interfaceAddress = availableInterfaces.find((entry) => entry.name === nextInterface)?.address || "";
    this.state.osc.host = nextOscHost;
    this.state.osc.port = nextOscPort;
    this.state.osc.currentTrackAddress = nextCurrentTrackAddress;
    this.state.osc.trackChangedAddress = nextTrackChangedAddress;
    this.state.osc.trackProfileAddress = nextTrackProfileAddress;
    this.state.osc.testAddress = nextTestAddress;
    this.state.selection.mode = nextSelectionMode;
    this.state.selection.holdSeconds = nextSelectionHoldSeconds;
    this.state.analysis.autoAnalyze = nextAnalysisAutoAnalyze;
    this.state.analysis.model = nextAnalysisModel;
    this.state.analysis.focus = nextAnalysisFocus;
    this.trackAnalyzer.updateConfig({
      model: nextAnalysisModel,
      focus: nextAnalysisFocus,
    });

    this.scheduleStateFlush();

    if (shouldReconnect) {
      await this.disconnect({ silent: true });
      await this.connect();
    }

    return this.serializeState();
  }

  async connect() {
    if (this.state.bridge.connected || this.state.bridge.connecting) {
      if (this.isDummyMode()) {
        await this.disconnect({ silent: true });
      } else {
        return this.serializeState();
      }
    }

    if (this.isDummyMode()) {
      await this.disconnect({ silent: true });
    }

    if (this.state.bridge.connected || this.state.bridge.connecting) {
      return this.serializeState();
    }

    if (!this.state.bridge.interfaceName) {
      throw new Error("Select a Bridge network interface first.");
    }

    this.state.bridge.connecting = true;
    this.state.bridge.lastError = null;
    this.scheduleStateFlush();

    const config = new TCNetConfiguration();
    config.broadcastInterface = this.state.bridge.interfaceName;
    config.nodeName = "PDJ OSC BRIDGE";
    config.vendorName = "CODEX";
    config.appName = "PRO DJ LINK OSC";
    config.requestTimeout = 4000;

    const client = new PioneerDJTCClient(config);
    this.attachClient(client);
    this.client = client;

    try {
      await client.connect();
      this.state.bridge.connected = true;
      this.state.bridge.connecting = false;
      this.state.bridge.sourceMode = "live";
      this.state.bridge.connectedAt = nowIso();
      this.pushEvent("bridge", `Connected to Pro DJ Link Bridge on ${this.state.bridge.interfaceName}.`);
      this.startResyncLoop();
      await this.syncAllLayers();
      await this.refreshActiveTrack();
      return this.serializeState();
    } catch (error) {
      this.state.bridge.connecting = false;
      this.state.bridge.connected = false;
      this.state.bridge.connectedAt = null;
      this.state.bridge.lastError = error.message;
      this.pushEvent("error", `Bridge connection failed: ${error.message}`, "error");
      this.teardownClient();
      throw error;
    } finally {
      this.scheduleStateFlush();
    }
  }

  attachClient(client) {
    client.on("changedtrack", (layer) => {
      void this.handleChangedTrack(layer);
    });

    client.on("changedstatus", (layer) => {
      void this.handleChangedStatus(layer);
    });

    client.client().on("time", (packet) => {
      this.handleTimePacket(packet);
    });
  }

  startResyncLoop() {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
    }

    this.resyncTimer = setInterval(() => {
      void this.syncAllLayers();
    }, 15000);
  }

  teardownClient() {
    if (!this.client) {
      return;
    }

    try {
      this.client.disconnect();
    } catch {
      // Ignore disconnect errors from partially initialized sockets.
    }

    this.client = null;
  }

  async disconnect(options = {}) {
    await this.stopDummyMode({ silent: true });

    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }

    this.teardownClient();
    this.state.bridge.connected = false;
    this.state.bridge.connecting = false;
    this.state.bridge.sourceMode = "live";
    this.state.bridge.connectedAt = null;
    this.state.bridge.lastHeartbeatAt = null;
    this.state.bridge.lastError = null;
    this.state.currentTrack = null;
    this.state.lastChange = null;
    this.state.selection.evaluation = {
      mode: this.state.selection.mode,
      selectedLayer: null,
      masterLayer: null,
      masterSignalAvailable: false,
      mixerSignalAvailable: false,
      candidates: [],
      reason: "Bridge disconnected.",
    };
    this.state.analysis.running = false;
    this.state.analysis.currentTrackKey = null;
    this.state.analysis.ruleBased = null;
    this.state.analysis.result = null;
    this.state.analysis.updatedAt = null;
    this.state.analysis.savedProfilePath = null;
    this.state.analysis.lastError = null;
    this.lastAnnouncedTrackKey = null;
    this.resetLayers();

    if (!options.silent) {
      this.pushEvent("bridge", "Bridge disconnected.");
    }

    this.scheduleStateFlush();
    return this.serializeState();
  }

  async syncAllLayers() {
    if (!this.client) {
      return;
    }

    await Promise.all(MONITORED_LAYERS.map((layer) => this.syncLayer(layer)));
    await this.refreshActiveTrack();
  }

  async syncLayer(layer) {
    if (!this.client) {
      return;
    }

    try {
      const metrics = await this.client.layerMetrics(layer);
      this.applyMetrics(layer, metrics, true);
    } catch {
      // Metrics are best effort; avoid flooding logs while Bridge is idle.
    }

    const snapshot = this.getLayer(layer);
    if (!snapshot || snapshot.trackId <= 0) {
      return;
    }

    try {
      const trackInfo = await this.client.trackInfo(layer);
      this.applyTrackInfo(layer, trackInfo);
    } catch {
      // Metadata is best effort as well.
    }
  }

  async handleChangedTrack(layer) {
    if (!this.client) {
      return;
    }

    if (!this.isMonitoredLayer(layer)) {
      return;
    }

    const snapshot = this.getLayer(layer);
    const nextTrackId = this.client.state().trackID(layer);

    snapshot.trackId = nextTrackId;
    snapshot.trackTitle = "";
    snapshot.trackArtist = "";
    snapshot.trackKey = null;
    snapshot.metadataError = null;
    snapshot.isTransportAdvancing = false;
    snapshot.lastPositionDelta = 0;
    snapshot.lastTrackChangeAt = nowIso();
    snapshot.lastTrackChangeEpochMs = Date.now();
    snapshot.lastUpdatedAt = snapshot.lastTrackChangeAt;

    this.pushEvent("track", `Layer ${layer} loaded ${nextTrackId > 0 ? `track ${nextTrackId}` : "an empty slot"}.`);

    if (nextTrackId > 0) {
      await this.fetchTrackInfo(layer, nextTrackId);
    }

    await this.refreshActiveTrack();
  }

  async handleChangedStatus(layer) {
    if (!this.client) {
      return;
    }

    if (!this.isMonitoredLayer(layer)) {
      return;
    }

    const nextState = this.client.state().status(layer);
    this.applyStatus(layer, nextState, true);
    this.pushEvent("status", `Layer ${layer} is now ${statusLabel(nextState)}.`);
    await this.refreshActiveTrack();
  }

  handleTimePacket(packet) {
    const heartbeatAt = nowIso();
    const heartbeatEpochMs = Date.now();
    this.state.bridge.lastHeartbeatAt = heartbeatAt;

    MONITORED_LAYERS.forEach((layer, index) => {
      const snapshot = this.getLayer(layer);
      const nextState = packet.layerState[index];
      const previousState = snapshot.stateCode;

      snapshot.stateCode = nextState;
      snapshot.state = statusLabel(nextState);
      this.updatePositionTelemetry(snapshot, packet.layerCurrentTime[index], heartbeatAt, heartbeatEpochMs);
      snapshot.trackLength = packet.layerTotalTime[index] ?? snapshot.trackLength;
      snapshot.beatMarker = packet.layerBeatmarker[index] ?? snapshot.beatMarker;
      snapshot.lastUpdatedAt = heartbeatAt;

      if (ACTIVE_PLAYBACK_STATES.has(nextState) && !ACTIVE_PLAYBACK_STATES.has(previousState)) {
        snapshot.lastPlaybackStartAt = heartbeatAt;
        snapshot.lastPlaybackStartEpochMs = Date.now();
      }
    });

    void this.refreshActiveTrack();
    this.scheduleStateFlush();
  }

  applyStatus(layer, nextState, recordPlaybackStart) {
    const snapshot = this.getLayer(layer);
    if (!snapshot) {
      return;
    }
    const previousState = snapshot.stateCode;

    snapshot.stateCode = nextState;
    snapshot.state = statusLabel(nextState);
    snapshot.lastUpdatedAt = nowIso();

    if (recordPlaybackStart && ACTIVE_PLAYBACK_STATES.has(nextState) && !ACTIVE_PLAYBACK_STATES.has(previousState)) {
      snapshot.lastPlaybackStartAt = snapshot.lastUpdatedAt;
      snapshot.lastPlaybackStartEpochMs = Date.now();
    }

    this.scheduleStateFlush();
  }

  applyMetrics(layer, metrics, recordPlaybackStart) {
    const snapshot = this.getLayer(layer);
    if (!snapshot) {
      return;
    }
    const previousState = snapshot.stateCode;
    const nextTrackId = metrics.trackID || snapshot.trackId;

    snapshot.trackId = nextTrackId;
    snapshot.stateCode = metrics.state;
    snapshot.state = statusLabel(metrics.state);
    this.updatePositionTelemetry(snapshot, metrics.currentPosition, nowIso(), Date.now());
    snapshot.trackLength = metrics.trackLength;
    snapshot.beatMarker = metrics.beatMarker;
    snapshot.beatNumber = metrics.beatNumber;
    snapshot.bpm = metrics.bpm;
    snapshot.speed = metrics.speed;
    snapshot.pitchBend = metrics.pitchBend;
    snapshot.syncMaster = metrics.syncMaster;
    snapshot.lastUpdatedAt = nowIso();

    if (recordPlaybackStart && ACTIVE_PLAYBACK_STATES.has(metrics.state) && !ACTIVE_PLAYBACK_STATES.has(previousState)) {
      snapshot.lastPlaybackStartAt = snapshot.lastUpdatedAt;
      snapshot.lastPlaybackStartEpochMs = Date.now();
    }

    this.scheduleStateFlush();
  }

  applyTrackInfo(layer, trackInfo) {
    const snapshot = this.getLayer(layer);
    if (!snapshot) {
      return;
    }
    snapshot.trackId = trackInfo.trackID || snapshot.trackId;
    snapshot.trackTitle = trackInfo.trackTitle || "";
    snapshot.trackArtist = trackInfo.trackArtist || "";
    snapshot.trackKey = trackInfo.trackKey ?? null;
    snapshot.metadataError = null;
    snapshot.lastUpdatedAt = nowIso();
    this.scheduleStateFlush();
  }

  async fetchTrackInfo(layer, expectedTrackId) {
    if (!this.client) {
      return;
    }

    try {
      const trackInfo = await this.client.trackInfo(layer);
      const snapshot = this.getLayer(layer);
      if (!snapshot) {
        return;
      }

      if (expectedTrackId && snapshot.trackId !== expectedTrackId) {
        return;
      }

      this.applyTrackInfo(layer, trackInfo);
    } catch (error) {
      const snapshot = this.getLayer(layer);
      if (!snapshot) {
        return;
      }

      if (expectedTrackId && snapshot.trackId !== expectedTrackId) {
        return;
      }

      snapshot.metadataError = error.message;
      snapshot.lastUpdatedAt = nowIso();
      this.scheduleStateFlush();
    }
  }

  async refreshActiveTrack() {
    await this.computeActiveTrack();
  }

  async computeActiveTrack() {
    const selection = selectAudibleTrack({
      layers: this.state.layers,
      currentTrack: this.state.currentTrack,
      selectionMode: this.state.selection.mode,
      holdSeconds: this.state.selection.holdSeconds,
    });
    this.state.selection.evaluation = selection;
    const activeLayer = selection.selectedLayer;

    if (!activeLayer) {
      if (this.state.currentTrack) {
        this.state.currentTrack = null;
        this.lastAnnouncedTrackKey = null;
        this.state.analysis.currentTrackKey = null;
        this.state.analysis.result = null;
        this.state.analysis.updatedAt = null;
        this.pushEvent("playback", "No actively playing layer was detected.");
      }
      this.scheduleStateFlush();
      return;
    }

    const snapshot = this.getLayer(activeLayer);
    if (!snapshot.trackTitle && !snapshot.metadataError && snapshot.trackId > 0) {
      await this.fetchTrackInfo(activeLayer, snapshot.trackId);
    }

    const resolved = this.getLayer(activeLayer);
    if (!resolved || resolved.trackId <= 0) {
      this.scheduleStateFlush();
      return;
    }

    const trackKey = `${resolved.layer}:${resolved.trackId}`;
    const ruleBased = buildRuleBasedTrackAnalysis({
      track: this.buildCurrentTrackPayload(resolved, this.state.currentTrack?.detectedAt || nowIso(), selection),
      layer: resolved,
      selection,
    });
    this.state.analysis.ruleBased = ruleBased;

    if (trackKey !== this.lastAnnouncedTrackKey) {
      const detectedAt = nowIso();
      const payload = this.buildCurrentTrackPayload(resolved, detectedAt, selection);
      this.state.currentTrack = payload;
      this.state.lastChange = payload;
      this.state.analysis.ruleBased = buildRuleBasedTrackAnalysis({
        track: payload,
        layer: resolved,
        selection,
      });
      this.state.analysis.lastError = null;
      this.state.analysis.currentTrackKey = trackKey;
      if (this.isDummyMode()) {
        this.applyDummyAnalysis(payload);
      } else {
        this.state.analysis.result = null;
        this.state.analysis.updatedAt = null;
      }
      this.lastAnnouncedTrackKey = trackKey;
      this.pushEvent("now-playing", `Now playing: ${payload.title} on Layer ${payload.layer}.`);
      await this.sendTrackOsc(payload);
      if (!this.isDummyMode() && this.state.analysis.autoAnalyze) {
        void this.analyzeCurrentTrack(payload, selection).catch(() => {});
      }
    } else if (this.state.currentTrack) {
      this.state.currentTrack = this.buildCurrentTrackPayload(resolved, this.state.currentTrack.detectedAt, selection);
      this.state.analysis.ruleBased = buildRuleBasedTrackAnalysis({
        track: this.state.currentTrack,
        layer: resolved,
        selection,
      });
      if (this.isDummyMode()) {
        this.applyDummyAnalysis(this.state.currentTrack);
      }
    } else {
      this.state.currentTrack = this.buildCurrentTrackPayload(resolved, nowIso(), selection);
      this.state.analysis.ruleBased = buildRuleBasedTrackAnalysis({
        track: this.state.currentTrack,
        layer: resolved,
        selection,
      });
      if (this.isDummyMode()) {
        this.applyDummyAnalysis(this.state.currentTrack);
      }
    }

    this.scheduleStateFlush();
  }

  buildCurrentTrackPayload(layer, detectedAt, selection) {
    const selectedCandidate = selection?.candidates?.find((candidate) => candidate.layer === layer.layer) || null;
    return {
      layer: layer.layer,
      trackId: layer.trackId,
      title: layer.trackTitle || `Track ${layer.trackId}`,
      artist: layer.trackArtist || "",
      trackKey: layer.trackKey,
      state: layer.state,
      currentPosition: layer.currentPosition,
      trackLength: layer.trackLength,
      bpm: normalizeBpm(layer.bpm),
      beatMarker: layer.beatMarker,
      selectionMode: selection?.mode || this.state.selection.mode,
      selectionReason: selectedCandidate ? selectedCandidate.reasons.map((reason) => reason.label).join(", ") : "",
      selectionScore: selectedCandidate?.score ?? null,
      detectedAt,
    };
  }

  async analyzeCurrentTrack(track = this.state.currentTrack, selection = this.state.selection.evaluation) {
    if (!track) {
      throw new Error("No current track to analyze.");
    }

    if (this.isDummyMode()) {
      const result = this.applyDummyAnalysis(track);
      if (!result) {
        throw new Error("Dummy analysis could not be generated.");
      }

      const savedPath = await this.saveTrackProfileJson(this.buildTrackProfilePayload(track, selection));
      this.state.analysis.savedProfilePath = savedPath;
      await this.sendTrackProfileOsc(track, selection);
      this.pushEvent("analysis", `Loaded simulated analysis for ${track.title}.`);
      this.scheduleStateFlush();
      return this.serializeState();
    }

    if (!this.trackAnalyzer.isConfigured()) {
      this.state.analysis.lastError = "OPENAI_API_KEY is not configured.";
      this.scheduleStateFlush();
      throw new Error(this.state.analysis.lastError);
    }

    const requestedTrackKey = this.currentTrackKey(track);
    const requestSerial = ++this.analysisRequestSerial;

    this.state.analysis.running = true;
    this.state.analysis.lastError = null;
    this.state.analysis.currentTrackKey = requestedTrackKey;
    this.scheduleStateFlush();

    try {
      const result = await this.trackAnalyzer.analyzeTrack({
        track,
        selection,
        ruleBased: this.state.analysis.ruleBased,
      });
      if (requestSerial !== this.analysisRequestSerial || requestedTrackKey !== this.currentTrackKey(this.state.currentTrack)) {
        return this.serializeState();
      }

      this.state.analysis.result = {
        ...result,
        title: track.title,
        artist: track.artist,
        trackId: track.trackId,
        layer: track.layer,
      };
      this.state.analysis.updatedAt = nowIso();
      this.state.analysis.running = false;
      const savedPath = await this.saveTrackProfileJson(this.buildTrackProfilePayload(track, selection));
      this.state.analysis.savedProfilePath = savedPath;
      await this.sendTrackProfileOsc(track, selection);
      this.pushEvent("analysis", `Analyzed ${track.title} with ${this.state.analysis.model}.`);
      this.scheduleStateFlush();
      return this.serializeState();
    } catch (error) {
      if (requestSerial === this.analysisRequestSerial) {
        this.state.analysis.lastError = error.message;
        this.state.analysis.running = false;
        this.pushEvent("analysis", `Track analysis failed: ${error.message}`, "error");
        this.scheduleStateFlush();
      }
      throw error;
    }
  }

  async sendTrackOsc(track) {
    const profile = this.buildTrackProfilePayload(track, this.state.selection.evaluation);
    const profileJson = JSON.stringify(profile);
    const savedPath = await this.saveTrackProfileJson(profile);
    const deterministic = profile?.analysis?.ruleBased?.deterministic || {};
    const atmosphereSummary = profile?.analysis?.atmosphere?.atmosphereSummary || "";
    this.state.analysis.savedProfilePath = savedPath;

    await this.sendOscMessage(this.state.osc.currentTrackAddress, [
      track.title,
      track.artist,
      track.layer,
      track.trackId,
      track.state,
      track.currentPosition ?? -1,
      track.trackLength ?? -1,
      track.bpm ?? 0,
      deterministic.playbackRole || "unknown",
      deterministic.energy ?? -1,
      atmosphereSummary,
      profileJson,
    ]);

    await this.sendOscMessage(this.state.osc.trackChangedAddress, [
      track.title,
      track.artist,
      track.layer,
      track.trackId,
      track.state,
      track.currentPosition ?? -1,
      track.trackLength ?? -1,
      track.bpm ?? 0,
      deterministic.playbackRole || "unknown",
      deterministic.energy ?? -1,
      atmosphereSummary,
      track.detectedAt,
      Math.floor(new Date(track.detectedAt).getTime() / 1000),
      profileJson,
    ]);

    await this.sendTrackProfileOsc(track, this.state.selection.evaluation);
  }

  async sendTrackProfileOsc(track = this.state.currentTrack, selection = this.state.selection.evaluation) {
    const profile = this.buildTrackProfilePayload(track, selection);
    if (!profile) {
      return;
    }

    await this.sendOscMessage(this.state.osc.trackProfileAddress, [JSON.stringify(profile)]);
  }

  async sendTestOsc() {
    const timestamp = nowIso();
    await this.sendOscMessage(this.state.osc.testAddress, [
      "test",
      this.state.osc.host,
      this.state.osc.port,
      timestamp,
    ]);
    this.pushEvent("osc", `Sent test OSC to ${this.state.osc.host}:${this.state.osc.port}.`);
    return this.serializeState();
  }

  async sendOscMessage(address, args) {
    const packet = osc.writePacket({ address, args });
    await new Promise((resolve, reject) => {
      this.oscSocket.send(Buffer.from(packet), this.state.osc.port, this.state.osc.host, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.pushEvent("osc", `Sent ${address} to ${this.state.osc.host}:${this.state.osc.port}.`);
  }

  async shutdown() {
    await this.disconnect({ silent: true });
    try {
      this.oscSocket.close();
    } catch {
      // Socket may already be closed while switching between live and dummy sources.
    }
  }
}

const publicDir = path.join(__dirname, "..", "public");
const service = new BridgeOscService();
const app = express();

app.use(express.json());
app.use(express.static(publicDir));

app.get("/api/state", (_request, response) => {
  response.json(service.serializeState());
});

app.post("/api/config", async (request, response) => {
  try {
    const state = await service.updateConfig(request.body || {});
    response.json(state);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/connect", async (_request, response) => {
  try {
    const state = await service.connect();
    response.json(state);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/disconnect", async (_request, response) => {
  const state = await service.disconnect();
  response.json(state);
});

app.post("/api/dummy/start", async (_request, response) => {
  try {
    const state = await service.startDummyMode();
    response.json(state);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/dummy/stop", async (_request, response) => {
  try {
    const state = await service.disconnect();
    response.json(state);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/test-osc", async (_request, response) => {
  try {
    const state = await service.sendTestOsc();
    response.json(state);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/analyze-current", async (_request, response) => {
  try {
    const state = await service.analyzeCurrentTrack();
    response.json(state);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

const server = http.createServer(app);
const sockets = new WebSocket.Server({ server, path: "/ws" });

service.on("state", (payload) => {
  const message = JSON.stringify({ type: "state", payload });
  sockets.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
});

sockets.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: service.serializeState() }));
});

server.listen(HTTP_PORT, () => {
  console.log(`Pro DJ Link Bridge OSC monitor listening on http://localhost:${HTTP_PORT}`);
  if (parseBoolean(process.env.DUMMY_MODE, false)) {
    void service.startDummyMode().catch((error) => {
      console.error(`Failed to start dummy mode: ${error.message}`);
    });
  }
});

async function closeGracefully() {
  await service.shutdown();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void closeGracefully();
});

process.on("SIGTERM", () => {
  void closeGracefully();
});
