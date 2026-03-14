const os = require("os");
const fs = require("fs/promises");
const path = require("path");
const dgram = require("dgram");
const { RemoteDbServer, REMOTEDB_QUERY_PORT } = require("./prolink-remotedb");

const PROLINK_HEADER = Buffer.from([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c]);
const ANNOUNCE_PORT = 50000;
const BEAT_PORT = 50001;
const STATUS_PORT = 50002;
const MIXER_DEVICE_ID = 0x21;
const MIXER_PRESENCE_TYPE = 0x02;
const CDJ_PRESENCE_TYPE = 0x01;
const DEFAULT_STATE_FILE = path.join(__dirname, "..", "data", "emulator", "default-state.json");

const PLAY_STATE_CODES = {
  empty: 0,
  loading: 2,
  playing: 3,
  looping: 4,
  paused: 5,
  cued: 6,
  cuing: 7,
  platter_held: 8,
  searching: 9,
  spun_down: 14,
  ended: 17,
};

const TRACK_SLOT_CODES = {
  empty: 0,
  cd: 1,
  sd: 2,
  usb: 3,
  rb: 4,
};

const TRACK_TYPE_CODES = {
  none: 0,
  rb: 1,
  unanalyzed: 2,
  audio_cd: 5,
};

const BASE_CDJ_STATUS_PACKET = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x03, 0x00, 0x00, 0xf8, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9c, 0xff, 0xfe, 0x00, 0x10, 0x00, 0x00,
  0x7f, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  0xff, 0xff, 0xff, 0xff, 0x01, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function parseArgs(argv) {
  const result = {
    interfaceName: "",
    bindAddress: "",
    broadcastAddress: "",
    statePath: DEFAULT_STATE_FILE,
    startup: true,
    dbPort: 15000,
    dbEnabled: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--interface") {
      result.interfaceName = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--bind-address") {
      result.bindAddress = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--broadcast") {
      result.broadcastAddress = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--state") {
      result.statePath = argv[index + 1] || DEFAULT_STATE_FILE;
      index += 1;
      continue;
    }
    if (arg === "--db-port") {
      result.dbPort = Number.parseInt(argv[index + 1] || "15000", 10) || 15000;
      index += 1;
      continue;
    }
    if (arg === "--no-startup") {
      result.startup = false;
      continue;
    }
    if (arg === "--no-db") {
      result.dbEnabled = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listInterfaces() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses || [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => ({
          name,
          address: entry.address,
          netmask: entry.netmask,
          mac: entry.mac,
          cidr: entry.cidr || null,
        })),
    )
    .sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}

function ipToInt(ipAddress) {
  return ipAddress
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .reduce((accumulator, value) => ((accumulator << 8) | (value & 0xff)) >>> 0, 0);
}

function intToIp(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function computeBroadcastAddress(address, netmask) {
  if (!address || !netmask) {
    return "255.255.255.255";
  }
  const ipValue = ipToInt(address);
  const maskValue = ipToInt(netmask);
  const broadcastValue = (ipValue & maskValue) | (~maskValue >>> 0);
  return intToIp(broadcastValue >>> 0);
}

function resolveInterface(interfaceName) {
  const available = listInterfaces();
  if (!available.length) {
    throw new Error("No external IPv4 network interface found.");
  }

  if (!interfaceName) {
    return available[0];
  }

  const directMatch = available.find((entry) => entry.name === interfaceName || entry.address === interfaceName);
  if (!directMatch) {
    throw new Error(`Network interface "${interfaceName}" was not found.`);
  }
  return directMatch;
}

function writeFixedName(buffer, offset, name) {
  const field = Buffer.alloc(20);
  field.write((name || "").slice(0, 20), "ascii");
  field.copy(buffer, offset);
}

function writePitch24(buffer, offset, pitchPct) {
  const clamped = Math.max(-100, Math.min(100, Number.isFinite(pitchPct) ? pitchPct : 0));
  const encoded = Math.max(0, Math.min(0x1fffff, Math.round(0x100000 + (clamped / 100) * 0x100000)));
  buffer[offset] = (encoded >>> 16) & 0xff;
  buffer[offset + 1] = (encoded >>> 8) & 0xff;
  buffer[offset + 2] = encoded & 0xff;
}

function writePitch32(buffer, offset, pitchPct) {
  const clamped = Math.max(-100, Math.min(100, Number.isFinite(pitchPct) ? pitchPct : 0));
  const encoded = Math.max(0, Math.min(0x1fffff, Math.round(0x100000 + (clamped / 100) * 0x100000)));
  buffer.writeUInt32BE(encoded >>> 0, offset);
}

function encodeBpm100(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0xffff;
  }
  return Math.max(0, Math.min(0xffff, Math.round(bpm * 100)));
}

function encodeBpm10(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(0x7fffffff, Math.round(bpm * 10)));
}

function normalizePlayState(value) {
  const normalized = `${value || "empty"}`.trim().toLowerCase().replace(/\s+/g, "_");
  return Object.prototype.hasOwnProperty.call(PLAY_STATE_CODES, normalized) ? normalized : "empty";
}

function normalizeTrackSlot(value) {
  const normalized = `${value || "empty"}`.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TRACK_SLOT_CODES, normalized) ? normalized : "empty";
}

function normalizeTrackType(value) {
  const normalized = `${value || "none"}`.trim().toLowerCase().replace(/\s+/g, "_");
  return Object.prototype.hasOwnProperty.call(TRACK_TYPE_CODES, normalized) ? normalized : "none";
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function normalizeDeckState(deckId, rawDeck = {}) {
  const playState = normalizePlayState(rawDeck.playState);
  const trackId = Math.max(0, Number.parseInt(rawDeck.trackId ?? 0, 10) || 0);
  const bpm = Number(rawDeck.bpm);
  const pitchPct = Number(rawDeck.pitchPct ?? 0);
  const effectivePitchPct = Number(rawDeck.effectivePitchPct ?? pitchPct);
  const playheadMs = Math.max(0, Number.parseInt(rawDeck.playheadMs ?? 0, 10) || 0);
  const trackLengthMs = Math.max(0, Number.parseInt(rawDeck.trackLengthMs ?? 0, 10) || 0);

  return {
    id: deckId,
    kind: "cdj",
    presenceType: CDJ_PRESENCE_TYPE,
    name: `${rawDeck.name || `CDJ-3000X ${deckId}`}`.slice(0, 20),
    playState,
    trackId,
    trackDeviceId: Math.max(0, Number.parseInt(rawDeck.trackDeviceId ?? deckId, 10) || deckId),
    trackSlot: normalizeTrackSlot(rawDeck.trackSlot),
    trackType: normalizeTrackType(rawDeck.trackType),
    bpm: Number.isFinite(bpm) ? bpm : 128,
    pitchPct: Number.isFinite(pitchPct) ? pitchPct : 0,
    effectivePitchPct: Number.isFinite(effectivePitchPct) ? effectivePitchPct : (Number.isFinite(pitchPct) ? pitchPct : 0),
    playheadMs,
    trackLengthMs,
    title: `${rawDeck.title || `Track ${trackId || deckId}`}`,
    artist: `${rawDeck.artist || `Artist ${deckId}`}`,
    album: `${rawDeck.album || "Emulated Album"}`,
    genre: `${rawDeck.genre || "Electronic"}`,
    comment: `${rawDeck.comment || ""}`,
    label: `${rawDeck.label || ""}`,
    keyLabel: `${rawDeck.keyLabel || rawDeck.key || ""}`,
    color: `${rawDeck.color || "blue"}`,
    rating: Math.max(0, Math.min(5, Number.parseInt(rawDeck.rating ?? 0, 10) || 0)),
    year: Number.parseInt(rawDeck.year ?? new Date().getUTCFullYear(), 10) || new Date().getUTCFullYear(),
    bitrate: Number.parseInt(rawDeck.bitrate ?? 320, 10) || 320,
    artworkId: Number.parseInt(rawDeck.artworkId ?? 0, 10) || 0,
    path: `${rawDeck.path || `/USB/${(rawDeck.title || `Track-${trackId || deckId}`).replace(/\s+/g, "-")}.wav`}`,
    onAir: normalizeBoolean(rawDeck.onAir, false),
    sync: normalizeBoolean(rawDeck.sync, false),
    master: normalizeBoolean(rawDeck.master, false),
    emergencyMode: normalizeBoolean(rawDeck.emergencyMode, false),
    beatsUntilCue: Number.isFinite(Number(rawDeck.beatsUntilCue)) ? Math.max(0, Number(rawDeck.beatsUntilCue)) : null,
  };
}

function normalizeMixerState(rawMixer = {}, decks = []) {
  const channels = Array.isArray(rawMixer.channels) ? rawMixer.channels.slice(0, 6).map((value) => normalizeBoolean(value, false)) : [];
  while (channels.length < 6) {
    channels.push(false);
  }

  decks.forEach((deck, index) => {
    if (index < 4 && rawMixer.channels == null) {
      channels[index] = Boolean(deck.onAir);
    }
  });

  return {
    id: MIXER_DEVICE_ID,
    kind: "mixer",
    presenceType: MIXER_PRESENCE_TYPE,
    name: `${rawMixer.name || "DJM-V10"}`.slice(0, 20),
    master: normalizeBoolean(rawMixer.master, true),
    channels,
  };
}

function isPlayingState(playState) {
  return playState === "playing" || playState === "looping";
}

function effectiveBpm(deck) {
  if (!deck.trackId || !Number.isFinite(deck.bpm) || deck.bpm <= 0) {
    return 0;
  }
  return deck.bpm * (1 + (deck.effectivePitchPct || 0) / 100);
}

function computeDeckRuntime(deck, elapsedMs) {
  let playheadMs = deck.playheadMs;
  if (isPlayingState(deck.playState) && deck.trackId > 0) {
    const ratio = Math.max(0, 1 + (deck.effectivePitchPct || 0) / 100);
    playheadMs += elapsedMs * ratio;
    if (deck.trackLengthMs > 0) {
      if (deck.playState === "looping") {
        playheadMs %= deck.trackLengthMs;
      } else {
        playheadMs = Math.min(playheadMs, deck.trackLengthMs);
      }
    }
  }

  const currentBpm = effectiveBpm(deck);
  const beatLengthMs = currentBpm > 0 ? 60000 / currentBpm : 0;
  const beat = deck.trackId > 0 && beatLengthMs > 0 ? Math.max(1, Math.floor(playheadMs / beatLengthMs) + 1) : null;
  const beatInBar = beat ? ((beat - 1) % 4) + 1 : 0;

  return {
    ...deck,
    playheadMs: Math.round(playheadMs),
    effectiveBpm: currentBpm,
    beatLengthMs,
    beat,
    beatInBar,
    playing: isPlayingState(deck.playState),
  };
}

function selectMasterDeck(decks) {
  return decks.find((deck) => deck.master && deck.trackId > 0) || decks.find((deck) => deck.playing && deck.trackId > 0) || null;
}

function buildStartupPacket(device, kind) {
  if (kind === "initial") {
    const packet = Buffer.alloc(0x26);
    PROLINK_HEADER.copy(packet, 0x00);
    packet[0x0a] = 0x0a;
    packet[0x0b] = 0x00;
    writeFixedName(packet, 0x0c, device.name);
    packet[0x20] = device.kind === "cdj" ? 0x04 : 0x02;
    packet[0x21] = device.id;
    packet.writeUInt16BE(0x0026, 0x22);
    packet[0x24] = 0x01;
    packet[0x25] = device.id;
    return packet;
  }

  if (kind === "claim-1") {
    const packet = Buffer.alloc(0x26);
    PROLINK_HEADER.copy(packet, 0x00);
    packet[0x0a] = 0x00;
    packet[0x0b] = 0x00;
    writeFixedName(packet, 0x0c, device.name);
    packet[0x20] = device.kind === "cdj" ? 0x03 : 0x01;
    packet[0x21] = device.id;
    packet.writeUInt16BE(0x0026, 0x22);
    packet[0x24] = 0x01;
    packet[0x25] = device.id;
    return packet;
  }

  if (kind === "claim-2") {
    const packet = Buffer.alloc(0x28);
    PROLINK_HEADER.copy(packet, 0x00);
    packet[0x0a] = 0x02;
    packet[0x0b] = 0x00;
    writeFixedName(packet, 0x0c, device.name);
    packet[0x20] = device.kind === "cdj" ? 0x03 : 0x01;
    packet[0x21] = device.id;
    packet.writeUInt16BE(0x0028, 0x22);
    packet[0x24] = device.id;
    packet[0x25] = 0x01;
    packet[0x26] = 0x01;
    packet[0x27] = device.id;
    return packet;
  }

  if (kind === "final") {
    const packet = Buffer.alloc(0x36);
    PROLINK_HEADER.copy(packet, 0x00);
    packet[0x0a] = 0x04;
    packet[0x0b] = 0x00;
    writeFixedName(packet, 0x0c, device.name);
    packet[0x20] = device.kind === "cdj" ? 0x03 : 0x01;
    packet[0x21] = device.id;
    packet.writeUInt16BE(0x0036, 0x22);
    packet[0x24] = device.id;
    packet[0x25] = device.presenceType;
    Buffer.from(device.macBytes).copy(packet, 0x26);
    Buffer.from(device.ipBytes).copy(packet, 0x2c);
    packet[0x34] = device.presenceType;
    packet[0x35] = device.kind === "cdj" ? 0x64 : 0x00;
    return packet;
  }

  throw new Error(`Unsupported startup packet kind: ${kind}`);
}

function buildKeepAlivePacket(device, peerCount) {
  const packet = Buffer.alloc(0x36);
  PROLINK_HEADER.copy(packet, 0x00);
  packet[0x0a] = 0x06;
  packet[0x0b] = 0x00;
  writeFixedName(packet, 0x0c, device.name);
  packet[0x20] = 0x01;
  packet[0x21] = 0x02;
  packet.writeUInt16BE(0x0036, 0x22);
  packet[0x24] = device.id;
  packet[0x25] = device.presenceType;
  Buffer.from(device.macBytes).copy(packet, 0x26);
  Buffer.from(device.ipBytes).copy(packet, 0x2c);
  packet[0x30] = Math.max(1, Math.min(0xff, peerCount));
  packet[0x34] = device.presenceType;
  packet[0x35] = device.kind === "cdj" ? 0x64 : 0x00;
  return packet;
}

function buildCdjStatusPacket(device, runtimeDeck, packetNumber) {
  const packet = Buffer.from(BASE_CDJ_STATUS_PACKET);
  PROLINK_HEADER.copy(packet, 0x00);
  writeFixedName(packet, 0x0b, device.name);
  packet[0x1f] = 0x01;
  packet[0x20] = 0x03;
  packet[0x21] = device.id;
  packet[0x24] = device.id;
  packet[0x28] = runtimeDeck.trackDeviceId;
  packet[0x29] = TRACK_SLOT_CODES[runtimeDeck.trackSlot];
  packet[0x2a] = TRACK_TYPE_CODES[runtimeDeck.trackType];
  packet.writeUInt32BE(runtimeDeck.trackId >>> 0, 0x2c);
  packet[0x7b] = PLAY_STATE_CODES[runtimeDeck.playState];
  packet.write("1.85", 0x7c, "ascii");
  let flags = 0;
  if (runtimeDeck.onAir) {
    flags |= 0x08;
  }
  if (runtimeDeck.sync) {
    flags |= 0x10;
  }
  if (runtimeDeck.master) {
    flags |= 0x20;
  }
  if (runtimeDeck.playing) {
    flags |= 0x40;
  }
  packet[0x89] = flags;
  writePitch24(packet, 0x8d, runtimeDeck.pitchPct);
  packet.writeUInt16BE(encodeBpm100(runtimeDeck.bpm), 0x92);
  writePitch24(packet, 0x99, runtimeDeck.effectivePitchPct);
  packet.writeUInt32BE(runtimeDeck.beat == null ? 0xffffffff : runtimeDeck.beat >>> 0, 0xa0);
  packet.writeUInt16BE(
    runtimeDeck.beatsUntilCue == null ? 0x01ff : Math.max(0, Math.min(0x01ff, Math.round(runtimeDeck.beatsUntilCue))),
    0xa4,
  );
  packet[0xa6] = runtimeDeck.beatInBar || 0;
  packet[0xba] = runtimeDeck.emergencyMode ? 1 : 0;
  packet.writeUInt32BE(packetNumber >>> 0, 0xc8);
  return packet;
}

function buildAbsolutePositionPacket(device, runtimeDeck) {
  const packet = Buffer.alloc(0x3c);
  PROLINK_HEADER.copy(packet, 0x00);
  packet[0x0a] = 0x0b;
  writeFixedName(packet, 0x0b, device.name);
  packet[0x1f] = 0x02;
  packet[0x20] = 0x00;
  packet[0x21] = device.id;
  packet.writeUInt16BE(0x0018, 0x22);
  packet.writeUInt32BE(Math.max(0, Math.round(runtimeDeck.trackLengthMs / 1000)), 0x24);
  packet.writeUInt32BE(Math.max(0, runtimeDeck.playheadMs >>> 0), 0x28);
  writePitch32(packet, 0x2c, runtimeDeck.effectivePitchPct);
  packet.fill(0x00, 0x30, 0x38);
  packet.writeUInt32BE(encodeBpm10(runtimeDeck.effectiveBpm || runtimeDeck.bpm), 0x38);
  return packet;
}

function buildBeatPacket(device, runtimeDeck) {
  const packet = Buffer.alloc(0x60, 0x00);
  const beatLengthMs = runtimeDeck.beatLengthMs > 0 ? runtimeDeck.beatLengthMs : 500;
  const elapsedIntoBeat = runtimeDeck.beatLengthMs > 0 ? runtimeDeck.playheadMs % beatLengthMs : 0;
  const untilNextBeat = Math.max(1, Math.round(beatLengthMs - elapsedIntoBeat));
  const beatInBar = runtimeDeck.beatInBar || 1;
  const nextBar = untilNextBeat + ((4 - beatInBar) % 4) * beatLengthMs;

  PROLINK_HEADER.copy(packet, 0x00);
  packet[0x0a] = 0x28;
  writeFixedName(packet, 0x0b, device.name);
  packet[0x1f] = 0x01;
  packet[0x20] = 0x00;
  packet[0x21] = device.id;
  packet.writeUInt16BE(0x003c, 0x22);
  packet.writeUInt32BE(Math.round(untilNextBeat), 0x24);
  packet.writeUInt32BE(Math.round(untilNextBeat + beatLengthMs), 0x28);
  packet.writeUInt32BE(Math.round(nextBar || 4 * beatLengthMs), 0x2c);
  packet.writeUInt32BE(Math.round(untilNextBeat + 3 * beatLengthMs), 0x30);
  packet.writeUInt32BE(Math.round((nextBar || 4 * beatLengthMs) + 4 * beatLengthMs), 0x34);
  packet.writeUInt32BE(Math.round(untilNextBeat + 7 * beatLengthMs), 0x38);
  packet.fill(0xff, 0x3c, 0x54);
  writePitch32(packet, 0x54, runtimeDeck.effectivePitchPct);
  packet.writeUInt16BE(encodeBpm100(runtimeDeck.effectiveBpm || runtimeDeck.bpm), 0x5a);
  packet[0x5c] = beatInBar;
  packet[0x5f] = device.id;
  return packet;
}

function buildMixerStatusPacket(mixerDevice, mixerState, masterDeck) {
  const packet = Buffer.alloc(0x38, 0x00);
  const pitch = masterDeck ? masterDeck.effectivePitchPct : 0;
  const bpm = masterDeck ? (masterDeck.effectiveBpm || masterDeck.bpm) : 0;

  PROLINK_HEADER.copy(packet, 0x00);
  packet[0x0a] = 0x29;
  writeFixedName(packet, 0x0b, mixerDevice.name);
  packet[0x1f] = 0x01;
  packet[0x20] = 0x00;
  packet[0x21] = mixerDevice.id;
  packet.writeUInt16BE(0x0014, 0x22);
  packet[0x24] = mixerDevice.id;
  packet[0x27] = mixerState.master ? 0xf0 : 0xd0;
  writePitch32(packet, 0x28, pitch);
  packet[0x2c] = 0x80;
  packet[0x2d] = 0x00;
  packet.writeUInt16BE(encodeBpm100(bpm), 0x2e);
  writePitch32(packet, 0x30, pitch);
  packet[0x34] = 0x00;
  packet[0x35] = 0x09;
  packet[0x36] = mixerState.master ? 0x20 : 0x00;
  packet[0x37] = masterDeck?.beatInBar || 0;
  return packet;
}

function buildOnAirPacket(mixerDevice, mixerState) {
  const packet = Buffer.alloc(0x35, 0x00);
  PROLINK_HEADER.copy(packet, 0x00);
  packet[0x0a] = 0x03;
  writeFixedName(packet, 0x0b, mixerDevice.name);
  packet[0x1f] = 0x01;
  packet[0x20] = 0x03;
  packet[0x21] = mixerDevice.id;
  packet.writeUInt16BE(0x0011, 0x22);
  packet[0x24] = mixerState.channels[0] ? 1 : 0;
  packet[0x25] = mixerState.channels[1] ? 1 : 0;
  packet[0x26] = mixerState.channels[2] ? 1 : 0;
  packet[0x27] = mixerState.channels[3] ? 1 : 0;
  packet[0x2d] = mixerState.channels[4] ? 1 : 0;
  packet[0x2e] = mixerState.channels[5] ? 1 : 0;
  return packet;
}

class StateLoader {
  constructor(statePath) {
    this.statePath = statePath;
    this.lastMtimeMs = 0;
    this.snapshot = null;
    this.loadedAtMs = Date.now();
  }

  async load(force = false) {
    const stat = await fs.stat(this.statePath);
    if (!force && this.snapshot && stat.mtimeMs === this.lastMtimeMs) {
      return this.snapshot;
    }

    const raw = JSON.parse(await fs.readFile(this.statePath, "utf8"));
    const decks = [1, 2, 3, 4].map((deckId) => normalizeDeckState(deckId, raw.decks?.[`${deckId}`]));
    const mixer = normalizeMixerState(raw.mixer, decks);
    this.lastMtimeMs = stat.mtimeMs;
    this.loadedAtMs = Date.now();
    this.snapshot = {
      announceIntervalMs: Math.max(250, Number.parseInt(raw.announceIntervalMs ?? 1500, 10) || 1500),
      statusIntervalMs: Math.max(50, Number.parseInt(raw.statusIntervalMs ?? 200, 10) || 200),
      positionIntervalMs: Math.max(15, Number.parseInt(raw.positionIntervalMs ?? 30, 10) || 30),
      beatPollIntervalMs: Math.max(5, Number.parseInt(raw.beatPollIntervalMs ?? 10, 10) || 10),
      onAirIntervalMs: Math.max(20, Number.parseInt(raw.onAirIntervalMs ?? 100, 10) || 100),
      decks,
      mixer,
    };

    return this.snapshot;
  }

  runtimeSnapshot() {
    if (!this.snapshot) {
      throw new Error("State has not been loaded yet.");
    }

    const elapsedMs = Date.now() - this.loadedAtMs;
    const runtimeDecks = this.snapshot.decks.map((deck) => computeDeckRuntime(deck, elapsedMs));
    const mixer = normalizeMixerState(this.snapshot.mixer, runtimeDecks);
    return {
      ...this.snapshot,
      decks: runtimeDecks,
      mixer,
    };
  }
}

class ProlinkEmulator {
  constructor(options) {
    this.options = options;
    this.interface = resolveInterface(options.interfaceName);
    this.bindAddress = options.bindAddress || this.interface.address;
    this.broadcastAddress =
      options.broadcastAddress || computeBroadcastAddress(this.interface.address, this.interface.netmask);
    this.ipBytes = this.bindAddress.split(".").map((part) => Number.parseInt(part, 10) & 0xff);
    this.macBytes = this.interface.mac.split(":").map((part) => Number.parseInt(part, 16) & 0xff);
    this.stateLoader = new StateLoader(options.statePath);
    this.announceSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.beatSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.statusSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.timers = [];
    this.packetCounter = 1;
    this.lastBeatSignature = "";
    this.devices = [
      { id: 1, kind: "cdj", name: "CDJ-3000X 1", presenceType: CDJ_PRESENCE_TYPE, ipBytes: this.ipBytes, macBytes: this.macBytes },
      { id: 2, kind: "cdj", name: "CDJ-3000X 2", presenceType: CDJ_PRESENCE_TYPE, ipBytes: this.ipBytes, macBytes: this.macBytes },
      { id: 3, kind: "cdj", name: "CDJ-3000X 3", presenceType: CDJ_PRESENCE_TYPE, ipBytes: this.ipBytes, macBytes: this.macBytes },
      { id: 4, kind: "cdj", name: "CDJ-3000X 4", presenceType: CDJ_PRESENCE_TYPE, ipBytes: this.ipBytes, macBytes: this.macBytes },
      { id: MIXER_DEVICE_ID, kind: "mixer", name: "DJM-V10", presenceType: MIXER_PRESENCE_TYPE, ipBytes: this.ipBytes, macBytes: this.macBytes },
    ];
    this.remoteDb = options.dbEnabled
      ? new RemoteDbServer({
          bindAddress: this.bindAddress,
          dbPort: options.dbPort,
          getRuntimeState: () => this.stateLoader.runtimeSnapshot(),
          log: (message) => {
            console.log(`[${nowIso()}] ${message}`);
          },
        })
      : null;
  }

  async bindSocket(socket, port) {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(port, this.bindAddress, () => {
        socket.off("error", reject);
        resolve();
      });
    });
    socket.setBroadcast(true);
  }

  async start() {
    await this.stateLoader.load(true);
    if (this.remoteDb) {
      await this.remoteDb.start();
    }
    await Promise.all([
      this.bindSocket(this.announceSocket, ANNOUNCE_PORT),
      this.bindSocket(this.beatSocket, BEAT_PORT),
      this.bindSocket(this.statusSocket, STATUS_PORT),
    ]);

    if (this.options.startup) {
      void this.sendStartupSequence();
    }

    this.installIntervals();
    console.log(
      `[${nowIso()}] PRO DJ LINK emulator online on ${this.interface.name} (${this.bindAddress}) -> ${this.broadcastAddress} using state ${this.options.statePath}`,
    );
    if (this.remoteDb) {
      console.log(`[${nowIso()}] Remote DB query port ${REMOTEDB_QUERY_PORT} -> data port ${this.options.dbPort}`);
    }
  }

  async stop() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
    if (this.remoteDb) {
      await this.remoteDb.stop();
    }
    await Promise.all([
      new Promise((resolve) => this.announceSocket.close(resolve)),
      new Promise((resolve) => this.beatSocket.close(resolve)),
      new Promise((resolve) => this.statusSocket.close(resolve)),
    ]);
  }

  async sendPacket(socket, port, packet) {
    await new Promise((resolve, reject) => {
      socket.send(packet, port, this.broadcastAddress, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async sendStartupSequence() {
    const steps = ["initial", "claim-1", "claim-2", "final"];
    for (const step of steps) {
      for (const device of this.devices) {
        await this.sendPacket(this.announceSocket, ANNOUNCE_PORT, buildStartupPacket(device, step));
      }
      await sleep(150);
    }
  }

  installIntervals() {
    const install = async () => {
      const snapshot = await this.stateLoader.load();
      this.scheduleAnnounceLoop(snapshot.announceIntervalMs);
      this.scheduleStatusLoop(snapshot.statusIntervalMs);
      this.schedulePositionLoop(snapshot.positionIntervalMs);
      this.scheduleBeatLoop(snapshot.beatPollIntervalMs);
      this.scheduleOnAirLoop(snapshot.onAirIntervalMs);
      this.scheduleReloadLoop();
    };

    void install().catch((error) => {
      console.error(`[${nowIso()}] failed to install loops: ${error.message}`);
      process.exitCode = 1;
    });
  }

  replaceTimer(currentTimer, callback, intervalMs) {
    if (currentTimer) {
      clearInterval(currentTimer);
    }
    const nextTimer = setInterval(() => {
      void callback().catch((error) => {
        console.error(`[${nowIso()}] emulator loop error: ${error.message}`);
      });
    }, intervalMs);
    this.timers.push(nextTimer);
    return nextTimer;
  }

  scheduleAnnounceLoop(intervalMs) {
    this.announceTimer = this.replaceTimer(this.announceTimer, async () => {
      const peerCount = this.devices.length;
      const runtime = this.stateLoader.runtimeSnapshot();
      runtime.decks.forEach((deck) => {
        const device = this.devices.find((entry) => entry.id === deck.id);
        device.name = deck.name;
      });
      this.devices.find((entry) => entry.id === MIXER_DEVICE_ID).name = runtime.mixer.name;
      for (const device of this.devices) {
        await this.sendPacket(this.announceSocket, ANNOUNCE_PORT, buildKeepAlivePacket(device, peerCount));
      }
    }, intervalMs);
  }

  scheduleStatusLoop(intervalMs) {
    this.statusTimer = this.replaceTimer(this.statusTimer, async () => {
      const runtime = this.stateLoader.runtimeSnapshot();
      const masterDeck = selectMasterDeck(runtime.decks);
      for (const deck of runtime.decks) {
        const device = this.devices.find((entry) => entry.id === deck.id);
        device.name = deck.name;
        await this.sendPacket(this.statusSocket, STATUS_PORT, buildCdjStatusPacket(device, deck, this.packetCounter));
        this.packetCounter += 1;
      }
      const mixerDevice = this.devices.find((entry) => entry.id === MIXER_DEVICE_ID);
      mixerDevice.name = runtime.mixer.name;
      await this.sendPacket(this.statusSocket, STATUS_PORT, buildMixerStatusPacket(mixerDevice, runtime.mixer, masterDeck));
    }, intervalMs);
  }

  schedulePositionLoop(intervalMs) {
    this.positionTimer = this.replaceTimer(this.positionTimer, async () => {
      const runtime = this.stateLoader.runtimeSnapshot();
      for (const deck of runtime.decks) {
        if (!deck.trackId) {
          continue;
        }
        const device = this.devices.find((entry) => entry.id === deck.id);
        device.name = deck.name;
        await this.sendPacket(this.beatSocket, BEAT_PORT, buildAbsolutePositionPacket(device, deck));
      }
    }, intervalMs);
  }

  scheduleBeatLoop(intervalMs) {
    this.beatTimer = this.replaceTimer(this.beatTimer, async () => {
      const runtime = this.stateLoader.runtimeSnapshot();
      const masterDeck = selectMasterDeck(runtime.decks);
      if (!masterDeck || !masterDeck.playing || !masterDeck.beat) {
        this.lastBeatSignature = "";
        return;
      }

      const signature = `${masterDeck.id}:${masterDeck.beat}`;
      if (signature === this.lastBeatSignature) {
        return;
      }

      this.lastBeatSignature = signature;
      const device = this.devices.find((entry) => entry.id === masterDeck.id);
      device.name = masterDeck.name;
      await this.sendPacket(this.beatSocket, BEAT_PORT, buildBeatPacket(device, masterDeck));
    }, intervalMs);
  }

  scheduleOnAirLoop(intervalMs) {
    this.onAirTimer = this.replaceTimer(this.onAirTimer, async () => {
      const runtime = this.stateLoader.runtimeSnapshot();
      const mixerDevice = this.devices.find((entry) => entry.id === MIXER_DEVICE_ID);
      mixerDevice.name = runtime.mixer.name;
      await this.sendPacket(this.beatSocket, BEAT_PORT, buildOnAirPacket(mixerDevice, runtime.mixer));
    }, intervalMs);
  }

  scheduleReloadLoop() {
    this.reloadTimer = this.replaceTimer(this.reloadTimer, async () => {
      const before = this.stateLoader.lastMtimeMs;
      await this.stateLoader.load();
      if (this.stateLoader.lastMtimeMs !== before) {
        const snapshot = this.stateLoader.snapshot;
        this.scheduleAnnounceLoop(snapshot.announceIntervalMs);
        this.scheduleStatusLoop(snapshot.statusIntervalMs);
        this.schedulePositionLoop(snapshot.positionIntervalMs);
        this.scheduleBeatLoop(snapshot.beatPollIntervalMs);
        this.scheduleOnAirLoop(snapshot.onAirIntervalMs);
        console.log(`[${nowIso()}] reloaded emulator state from ${this.options.statePath}`);
      }
    }, 1000);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const emulator = new ProlinkEmulator(options);

  const shutdown = async (signal) => {
    console.log(`[${nowIso()}] stopping emulator on ${signal}`);
    try {
      await emulator.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await emulator.start();
}

main().catch((error) => {
  console.error(`[${nowIso()}] emulator failed: ${error.message}`);
  process.exitCode = 1;
});
