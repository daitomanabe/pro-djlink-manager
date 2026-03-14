const state = {
  lastPayload: null,
  formDirty: false,
  activeView: window.localStorage.getItem("pdj-view") || "onair",
};

let mixVisualizer = null;
const TAU = Math.PI * 2;
const TEXT_FIT_STEP = 0.5;
let textFitFrame = 0;

const elements = {
  bridgeHeadlineStatus: document.getElementById("bridgeHeadlineStatus"),
  bridgeStatusText: document.getElementById("bridgeStatusText"),
  bridgeMetaText: document.getElementById("bridgeMetaText"),
  oscStatusText: document.getElementById("oscStatusText"),
  oscMetaText: document.getElementById("oscMetaText"),
  analysisStatusText: document.getElementById("analysisStatusText"),
  analysisMetaText: document.getElementById("analysisMetaText"),
  currentTrackTitle: document.getElementById("currentTrackTitle"),
  currentTrackMeta: document.getElementById("currentTrackMeta"),
  detailTitle: document.getElementById("detailTitle"),
  detailArtist: document.getElementById("detailArtist"),
  detailLayer: document.getElementById("detailLayer"),
  detailTrackId: document.getElementById("detailTrackId"),
  detailChangedAt: document.getElementById("detailChangedAt"),
  detailPosition: document.getElementById("detailPosition"),
  currentTrackProgressFill: document.getElementById("currentTrackProgressFill"),
  layerGrid: document.getElementById("layerGrid"),
  channelMeters: document.getElementById("channelMeters"),
  mixerTelemetryNote: document.getElementById("mixerTelemetryNote"),
  selectionModeDetail: document.getElementById("selectionModeDetail"),
  selectionLayerDetail: document.getElementById("selectionLayerDetail"),
  selectionMasterDetail: document.getElementById("selectionMasterDetail"),
  selectionMixerDetail: document.getElementById("selectionMixerDetail"),
  selectionReasonText: document.getElementById("selectionReasonText"),
  selectionList: document.getElementById("selectionList"),
  analysisEnergy: document.getElementById("analysisEnergy"),
  analysisConfidence: document.getElementById("analysisConfidence"),
  analysisMixRole: document.getElementById("analysisMixRole"),
  analysisBasis: document.getElementById("analysisBasis"),
  analysisSummary: document.getElementById("analysisSummary"),
  analysisGenres: document.getElementById("analysisGenres"),
  analysisMoods: document.getElementById("analysisMoods"),
  analysisTextures: document.getElementById("analysisTextures"),
  analysisVisuals: document.getElementById("analysisVisuals"),
  routeTarget: document.getElementById("routeTarget"),
  routeTargetMeta: document.getElementById("routeTargetMeta"),
  routeCurrentAddress: document.getElementById("routeCurrentAddress"),
  routeChangedAddress: document.getElementById("routeChangedAddress"),
  routeProfileAddress: document.getElementById("routeProfileAddress"),
  routeProfilePath: document.getElementById("routeProfilePath"),
  eventList: document.getElementById("eventList"),
  flashMessage: document.getElementById("flashMessage"),
  settingsForm: document.getElementById("settingsForm"),
  bridgeInterface: document.getElementById("bridgeInterface"),
  oscHost: document.getElementById("oscHost"),
  oscPort: document.getElementById("oscPort"),
  currentTrackAddress: document.getElementById("currentTrackAddress"),
  trackChangedAddress: document.getElementById("trackChangedAddress"),
  testAddress: document.getElementById("testAddress"),
  trackProfileAddress: document.getElementById("trackProfileAddress"),
  selectionMode: document.getElementById("selectionMode"),
  selectionHoldSeconds: document.getElementById("selectionHoldSeconds"),
  analysisModel: document.getElementById("analysisModel"),
  analysisAutoAnalyze: document.getElementById("analysisAutoAnalyze"),
  analysisFocus: document.getElementById("analysisFocus"),
  saveButton: document.getElementById("saveButton"),
  connectButton: document.getElementById("connectButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  testOscButton: document.getElementById("testOscButton"),
  analyzeButton: document.getElementById("analyzeButton"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]")),
  monitorBridgeState: document.getElementById("monitorBridgeState"),
  monitorBridgeMeta: document.getElementById("monitorBridgeMeta"),
  monitorDeckCoverage: document.getElementById("monitorDeckCoverage"),
  monitorDeckCoverageMeta: document.getElementById("monitorDeckCoverageMeta"),
  monitorTransportState: document.getElementById("monitorTransportState"),
  monitorTransportMeta: document.getElementById("monitorTransportMeta"),
  monitorMixerState: document.getElementById("monitorMixerState"),
  monitorMixerStateMeta: document.getElementById("monitorMixerStateMeta"),
  monitorLayerGrid: document.getElementById("monitorLayerGrid"),
  monitorMixerFeed: document.getElementById("monitorMixerFeed"),
  monitorMainDeck: document.getElementById("monitorMainDeck"),
  monitorMasterDeck: document.getElementById("monitorMasterDeck"),
  monitorHoldTime: document.getElementById("monitorHoldTime"),
  monitorMixerReason: document.getElementById("monitorMixerReason"),
  monitorChannelMeters: document.getElementById("monitorChannelMeters"),
  monitorSelectionSummary: document.getElementById("monitorSelectionSummary"),
  monitorReasonTokens: document.getElementById("monitorReasonTokens"),
  monitorSelectionList: document.getElementById("monitorSelectionList"),
  monitorEventList: document.getElementById("monitorEventList"),
  mixVisualizerCanvas: document.getElementById("mixVisualizerCanvas"),
  vizCurrentTrack: document.getElementById("vizCurrentTrack"),
  vizCurrentMeta: document.getElementById("vizCurrentMeta"),
  vizMasterStats: document.getElementById("vizMasterStats"),
  vizMasterWave: document.getElementById("vizMasterWave"),
  vizDeckWaveGrid: document.getElementById("vizDeckWaveGrid"),
  vizMeterStack: document.getElementById("vizMeterStack"),
  vizBeatRadar: document.getElementById("vizBeatRadar"),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveFitBox(node) {
  const target = node.dataset.fitBox || "self";
  if (target === "self") {
    return node;
  }

  if (target === "parent") {
    return node.parentElement || node;
  }

  return node.closest(target) || node.parentElement || node;
}

function resolveFitCard(node) {
  const target = node.dataset.fitCard;
  if (!target) {
    return null;
  }

  if (target === "parent") {
    return node.parentElement;
  }

  return node.closest(target);
}

function measureTextArea(node, box) {
  const textRect = node.getBoundingClientRect();
  const displayWidth = Math.ceil(Math.max(textRect.width, node.scrollWidth));
  const displayHeight = Math.ceil(Math.max(textRect.height, node.scrollHeight));
  const availableWidth = Math.max(0, box.clientWidth);
  const availableHeight = Math.max(0, box.clientHeight);

  return {
    displayWidth,
    displayHeight,
    availableWidth,
    availableHeight,
    widthOverflow: displayWidth - availableWidth,
    heightOverflow: displayHeight - availableHeight,
  };
}

function resetMeasuredText(root = document) {
  const cards = root.querySelectorAll("[data-fit-base]");
  for (const card of cards) {
    const base = Number.parseFloat(card.dataset.fitBase || "0");
    if (base > 0) {
      card.style.minHeight = `${base}px`;
    } else {
      card.style.removeProperty("min-height");
    }
  }

  const texts = root.querySelectorAll("[data-fit-text]");
  for (const text of texts) {
    const max = Number.parseFloat(text.dataset.fitMax || "0");
    if (max > 0) {
      text.style.fontSize = `${max}px`;
    } else {
      text.style.removeProperty("font-size");
    }
  }
}

function applyMeasuredTextFit(root = document) {
  resetMeasuredText(root);

  const texts = root.querySelectorAll("[data-fit-text]");
  for (const text of texts) {
    const box = resolveFitBox(text);
    if (!box || box.clientWidth <= 0 || box.clientHeight <= 0) {
      continue;
    }

    const computed = window.getComputedStyle(text);
    const max = Number.parseFloat(text.dataset.fitMax || computed.fontSize || "0");
    const min = Number.parseFloat(text.dataset.fitMin || Math.max(8, max - 2));
    const axis = text.dataset.fitAxis || "both";

    let size = max;
    let metrics = measureTextArea(text, box);

    const hasOverflow = (currentMetrics) =>
      (axis === "both" || axis === "width") && currentMetrics.widthOverflow > 0.5
        ? true
        : (axis === "both" || axis === "height") && currentMetrics.heightOverflow > 0.5;

    while (hasOverflow(metrics) && size - TEXT_FIT_STEP >= min) {
      size = Math.max(min, size - TEXT_FIT_STEP);
      text.style.fontSize = `${size}px`;
      metrics = measureTextArea(text, box);
    }

    if (!hasOverflow(metrics)) {
      continue;
    }

    const card = resolveFitCard(text);
    if (!card) {
      continue;
    }

    const base = Number.parseFloat(card.dataset.fitBase || "0");
    const grow = Number.parseFloat(card.dataset.fitGrow || "0");
    if (!(base > 0 && grow > 0)) {
      continue;
    }

    const growth = clamp(Math.ceil(Math.max(metrics.heightOverflow, 0) + 6), 0, grow);
    card.style.minHeight = `${base + growth}px`;
  }
}

function scheduleMeasuredTextFit() {
  window.cancelAnimationFrame(textFitFrame);
  textFitFrame = window.requestAnimationFrame(() => applyMeasuredTextFit(document));
}

function setActiveView(view) {
  state.activeView = view;
  window.localStorage.setItem("pdj-view", view);
  document.body.classList.toggle("visualizer-mode", view === "visualizer");

  for (const button of elements.tabButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of elements.viewPanels) {
    const active = panel.dataset.viewPanel === view;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }

  if (mixVisualizer) {
    mixVisualizer.setActive(view === "visualizer");
  }

  scheduleMeasuredTextFit();
}

function setFlash(message, tone = "success") {
  if (!message) {
    elements.flashMessage.hidden = true;
    elements.flashMessage.textContent = "";
    elements.flashMessage.removeAttribute("data-tone");
    return;
  }

  elements.flashMessage.hidden = false;
  elements.flashMessage.dataset.tone = tone;
  elements.flashMessage.textContent = message;

  window.clearTimeout(setFlash.timeoutId);
  setFlash.timeoutId = window.setTimeout(() => setFlash(""), 3500);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTrackProgress(track) {
  if (!track || !Number.isFinite(track.currentPosition)) {
    return "-";
  }

  const current = formatDuration(track.currentPosition);
  const total = Number.isFinite(track.trackLength) && track.trackLength > 0 ? formatDuration(track.trackLength) : "--:--";
  return `${current} / ${total}`;
}

function formatBpm(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return `${Number(value).toFixed(1)} BPM`;
}

function compactMeta(parts) {
  return parts.filter((part) => typeof part === "string" && part.trim().length > 0).join(" · ");
}

function scoreMap(candidates) {
  return new Map((candidates || []).map((candidate) => [candidate.layer, candidate]));
}

function progressRatio(currentPosition, trackLength) {
  if (Number.isFinite(trackLength) && trackLength > 0 && Number.isFinite(currentPosition) && currentPosition >= 0) {
    return clamp(currentPosition / trackLength, 0, 1);
  }

  if (Number.isFinite(currentPosition) && currentPosition >= 0) {
    return clamp(currentPosition / 300000, 0, 1);
  }

  return 0;
}

function layerStateTag(layer) {
  if (layer.isTransportAdvancing) {
    return "advancing";
  }

  if (layer.state === "PAUSED") {
    return "paused";
  }

  if (layer.state === "IDLE") {
    return "idle";
  }

  return "stable";
}

function layerFocusPercent(layer, candidate, maxScore) {
  if (Number.isFinite(layer?.mixerLevel)) {
    return clamp(layer.mixerLevel * 100, 0, 100);
  }

  if (candidate && maxScore > 0) {
    return clamp((candidate.score / maxScore) * 100, 4, 100);
  }

  if (layer.isTransportAdvancing) {
    return 22;
  }

  if (layer.trackId > 0) {
    return 10;
  }

  return 0;
}

function isLayerLoaded(layer) {
  return Number.isFinite(layer?.trackId) && layer.trackId > 0;
}

function hasLayerMetadata(layer) {
  return Boolean(
    (layer?.trackTitle && layer.trackTitle.trim()) ||
      (layer?.trackArtist && layer.trackArtist.trim()) ||
      formatBpm(Number.isFinite(layer?.bpm) ? layer.bpm / 100 : null),
  );
}

function hasLayerSignal(layer) {
  return Boolean(layer && typeof layer.state === "string" && layer.state.length > 0);
}

function normalizeLayerBpm(layer) {
  return Number.isFinite(layer?.bpm) && layer.bpm > 0 ? layer.bpm / 100 : null;
}

function computeBeatPhase(layer) {
  const bpm = normalizeLayerBpm(layer);
  if (!Number.isFinite(bpm) || !Number.isFinite(layer?.currentPosition)) {
    return 0;
  }

  return ((((layer.currentPosition / 60000) * bpm) % 1) + 1) % 1;
}

function computeVisualizerDecks(payload) {
  const candidates = payload.selection?.evaluation?.candidates || [];
  const candidateMap = scoreMap(candidates);
  const maxScore = candidates.reduce((highest, candidate) => Math.max(highest, candidate.score || 0), 1);
  const selectedLayer = payload.selection?.evaluation?.selectedLayer || payload.currentTrack?.layer || null;

  return (payload.layers || []).slice(0, 4).map((layer) => {
    const candidate = candidateMap.get(layer.layer);
    const bpm = normalizeLayerBpm(layer) || 0;
    const level = Number.isFinite(layer.mixerLevel)
      ? clamp(layer.mixerLevel, 0, 1)
      : clamp(layerFocusPercent(layer, candidate, maxScore) / 100, 0, 1);
    return {
      layer: layer.layer,
      title: layer.trackTitle || `Layer ${layer.layer}`,
      artist: layer.trackArtist || "",
      state: layer.state,
      bpm,
      level,
      selected: selectedLayer === layer.layer,
      phase: computeBeatPhase(layer),
      progress: progressRatio(layer.currentPosition, layer.trackLength),
      trackId: layer.trackId,
      trackLength: layer.trackLength,
      currentPosition: layer.currentPosition,
      beatNumber: layer.beatNumber || 0,
      moving: Boolean(layer.isTransportAdvancing),
    };
  });
}

function compactMonitorEventMessage(entry) {
  const message = `${entry?.message || ""}`.trim();
  if (!message) {
    return "Awaiting signal events";
  }

  if (/^Dummy manual mode started\.?$/i.test(message)) {
    return "Dummy mode started";
  }

  const sentMatch = message.match(/^Sent\s+(\S+)\s+to\s+([^.]+)\.?$/i);
  if (sentMatch) {
    return `${sentMatch[1]} -> ${sentMatch[2]}`;
  }

  const nowPlayingMatch = message.match(/^Now playing:\s+(.+)\s+on Layer\s+(\d+)\.?$/i);
  if (nowPlayingMatch) {
    return `${nowPlayingMatch[1]} · L${nowPlayingMatch[2]}`;
  }

  const loadedMatch = message.match(/^Layer\s+(\d+)\s+loaded\s+(.+)\.?$/i);
  if (loadedMatch) {
    return `L${loadedMatch[1]} loaded ${loadedMatch[2]}`;
  }

  return message;
}

function compactSelectionSummary(selection) {
  const reasons = `${selection?.reason || ""}`
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!reasons.length) {
    return "Waiting for rule-based scoring.";
  }

  return reasons.slice(0, 4).join(" · ");
}

function waveformData(deck, samples = 72) {
  const seed = Math.max(1, deck.trackId || deck.layer * 11);
  const baseAmplitude = 0.18 + deck.level * 0.34;
  const phase = deck.phase * TAU;
  const primary = 2 + (seed % 5);
  const secondary = 5 + (seed % 7);
  const tertiary = 9 + (seed % 11);
  const values = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const envelope = 0.7 + Math.sin(t * Math.PI) * 0.3;
    const value =
      Math.sin(t * TAU * primary + phase) * 0.62 +
      Math.sin(t * TAU * secondary - phase * 1.4) * 0.24 +
      Math.cos(t * TAU * tertiary + phase * 0.35) * 0.14;
    values.push(value * baseAmplitude * envelope);
  }

  return values;
}

function buildWavePaths(deck, width, height) {
  const samples = waveformData(deck, 84);
  const mid = height / 2;
  const amplitude = height * 0.88;
  const linePoints = [];
  const topPoints = [];
  const bottomPoints = [];

  samples.forEach((sample, index) => {
    const x = (index / (samples.length - 1)) * width;
    const y = mid - sample * amplitude;
    linePoints.push(`${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    topPoints.push([x, y]);
    bottomPoints.unshift([x, mid]);
  });

  const fillPath = [
    `M 0 ${mid.toFixed(2)}`,
    ...topPoints.map(([x, y], index) => `${index === 0 ? "L" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`),
    ...bottomPoints.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`),
    "Z",
  ].join(" ");

  return {
    linePath: linePoints.join(" "),
    fillPath,
  };
}

function renderWaveSvg(svg, deck, { width, height, compact = false }) {
  if (!svg) {
    return;
  }

  const { linePath, fillPath } = buildWavePaths(deck, width, height);
  const progressX = (deck.progress || 0) * width;
  const pulseOpacity = (0.16 + deck.level * 0.48).toFixed(2);
  const strokeOpacity = deck.selected ? "0.96" : "0.74";
  const markerRadius = compact ? 3.2 : 5.2;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="none" />
    <g opacity="0.16" stroke="#ffffff" stroke-width="1">
      <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" />
      <line x1="${width * 0.25}" y1="0" x2="${width * 0.25}" y2="${height}" />
      <line x1="${width * 0.5}" y1="0" x2="${width * 0.5}" y2="${height}" />
      <line x1="${width * 0.75}" y1="0" x2="${width * 0.75}" y2="${height}" />
    </g>
    <path d="${fillPath}" fill="#ffffff" fill-opacity="${pulseOpacity}" />
    <path d="${linePath}" fill="none" stroke="#ffffff" stroke-opacity="${strokeOpacity}" stroke-width="${compact ? 1.35 : 2.2}" />
    <line x1="${progressX}" y1="0" x2="${progressX}" y2="${height}" stroke="#ffffff" stroke-opacity="0.92" stroke-width="${compact ? 1.1 : 1.5}" />
    <circle cx="${progressX}" cy="${height / 2}" r="${markerRadius}" fill="#ffffff" fill-opacity="0.96" />
  `;
}

function renderMonitorReasonTokens(selection) {
  if (!elements.monitorReasonTokens) {
    return;
  }

  elements.monitorReasonTokens.innerHTML = "";
  const reasons = (selection.reason || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);

  const tokens = reasons.length ? reasons : ["awaiting_signal"];
  for (const label of tokens.slice(0, 3)) {
    const token = document.createElement("span");
    token.className = "monitor-reason-token";
    token.textContent = label.replace(/_/g, " ");
    elements.monitorReasonTokens.append(token);
  }
}

function syncInterfaceOptions(payload) {
  const currentValue = elements.bridgeInterface.value;
  const desiredValue = payload.bridge.interfaceName || currentValue;

  elements.bridgeInterface.innerHTML = "";

  for (const network of payload.networkInterfaces) {
    const option = document.createElement("option");
    option.value = network.name;
    option.textContent = `${network.name} (${network.address})`;
    elements.bridgeInterface.append(option);
  }

  if (!payload.networkInterfaces.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No IPv4 interface detected";
    elements.bridgeInterface.append(option);
  }

  elements.bridgeInterface.value = desiredValue || payload.networkInterfaces[0]?.name || "";
}

function syncForm(payload) {
  if (state.formDirty && state.lastPayload) {
    return;
  }

  syncInterfaceOptions(payload);
  elements.oscHost.value = payload.osc.host;
  elements.oscPort.value = payload.osc.port;
  elements.currentTrackAddress.value = payload.osc.currentTrackAddress;
  elements.trackChangedAddress.value = payload.osc.trackChangedAddress;
  elements.testAddress.value = payload.osc.testAddress;
  elements.trackProfileAddress.value = payload.osc.trackProfileAddress || "/pro-dj-link/trackProfile";
  elements.selectionMode.value = payload.selection.mode;
  elements.selectionHoldSeconds.value = payload.selection.holdSeconds;
  elements.analysisModel.value = payload.analysis.model;
  elements.analysisAutoAnalyze.checked = payload.analysis.autoAnalyze;
  elements.analysisFocus.value = payload.analysis.focus;
}

function renderChipRow(container, items, fallbackLabel) {
  container.innerHTML = "";
  const inline = document.createElement("span");
  inline.textContent = items?.length ? items.slice(0, 6).join(" / ") : fallbackLabel;
  container.append(inline);
}

function renderLayers(payload) {
  elements.layerGrid.innerHTML = "";

  const candidateByLayer = scoreMap(payload.selection.evaluation.candidates);

  for (const layer of payload.layers) {
    const candidate = candidateByLayer.get(layer.layer);
    const row = document.createElement("article");
    row.className = `deck-row${payload.currentTrack?.layer === layer.layer ? " active" : ""}`;

    const head = document.createElement("div");
    head.className = "deck-row-head";

    const layerLabel = document.createElement("span");
    layerLabel.className = "deck-layer";
    layerLabel.textContent = `Layer ${layer.layer}`;

    const pill = document.createElement("span");
    pill.className = "state-pill";
    pill.dataset.state = layer.state;
    pill.textContent = layer.state;

    head.append(layerLabel, pill);

    const titleWrap = document.createElement("div");
    titleWrap.className = "deck-row-title";

    const title = document.createElement("strong");
    title.textContent = layer.trackTitle || "No track loaded";

    const artist = document.createElement("p");
    artist.textContent = layer.trackArtist || "Unknown artist";

    titleWrap.append(title, artist);

    const bpm = deckStat("BPM", formatBpm(Number.isFinite(layer.bpm) ? layer.bpm / 100 : null) || "-");
    const position = deckStat("Position", formatDuration(layer.currentPosition));
    const trackId = deckStat("Track ID", isLayerLoaded(layer) ? `${layer.trackId}` : "-");
    const mode = deckStat("Mode", layerStateTag(layer));

    const trace = document.createElement("div");
    trace.className = "deck-row-trace";

    const progressTrack = document.createElement("div");
    progressTrack.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${Math.max(2, progressRatio(layer.currentPosition, layer.trackLength) * 100)}%`;
    progressTrack.append(fill);

    const reasons = document.createElement("p");
    reasons.textContent = candidate
      ? compactMeta([
          candidate.reasons
            .slice(0, 2)
            .map((reason) => reason.label)
            .join(" · "),
          candidate.score != null ? `focus ${candidate.score.toFixed(1)}` : "",
        ])
      : layer.metadataError || "No audible weight assigned.";

    trace.append(progressTrack, reasons);

    row.append(head, titleWrap, bpm, position, trackId, mode, trace);
    elements.layerGrid.append(row);
  }
}

function deckStat(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "deck-stat";

  const title = document.createElement("span");
  title.textContent = label;

  const content = document.createElement("strong");
  content.textContent = value || "-";

  wrapper.append(title, content);
  return wrapper;
}

function buildChannelMeter(layer, candidate, maxScore, selectedLayer) {
  const channel = document.createElement("article");
  channel.className = `channel-meter${selectedLayer === layer.layer ? " selected" : ""}`;

  const label = document.createElement("span");
  label.className = "deck-layer";
  label.textContent = `L${layer.layer}`;

  const main = document.createElement("div");
  main.className = "channel-meter-main";

  const source = document.createElement("div");
  source.className = "channel-meter-label";
  source.textContent = layer.trackTitle || `Track ${isLayerLoaded(layer) ? layer.trackId : layer.layer}`;

  const detail = document.createElement("div");
  detail.className = "channel-meter-detail";
  detail.textContent = compactMeta([
    layer.trackArtist || (isLayerLoaded(layer) ? "Loaded track" : "No loaded track"),
    layer.state,
  ]);

  const bar = document.createElement("div");
  bar.className = "channel-bar";

  const fill = document.createElement("div");
  fill.className = "channel-bar-fill";

  const percentValue = layerFocusPercent(layer, candidate, maxScore);
  fill.style.width = `${Math.max(percentValue, 6)}%`;
  bar.append(fill);

  main.append(source, detail, bar);

  const percent = document.createElement("div");
  percent.className = "channel-meter-value";
  percent.textContent = `${Math.round(percentValue)}%`;

  channel.append(label, main, percent);
  return channel;
}

function renderChannelMeterList(container, layers, candidates, selectedLayer) {
  const candidateMap = scoreMap(candidates);
  const maxScore = (candidates || []).reduce((highest, candidate) => Math.max(highest, candidate.score), 0);

  container.innerHTML = "";

  for (const layer of layers) {
    container.append(buildChannelMeter(layer, candidateMap.get(layer.layer), maxScore, selectedLayer));
  }
}

function renderCandidateList(container, candidates, selectedLayer, limit = 3) {
  container.innerHTML = "";

  const items = candidates.length
    ? candidates.slice(0, limit)
    : [{ layer: "-", trackTitle: "No candidates", trackArtist: "", score: 0, reasons: [] }];

  for (const candidate of items) {
    const item = document.createElement("article");
    item.className = `candidate-card${selectedLayer === candidate.layer ? " selected" : ""}`;

    const title = document.createElement("strong");
    title.textContent =
      candidate.layer === "-"
        ? "No audible deck"
        : `Layer ${candidate.layer} · ${candidate.trackTitle || `Track ${candidate.trackId || "-"}`}`;

    const meta = document.createElement("small");
    meta.textContent =
      candidate.layer === "-"
        ? "Waiting for scoring."
        : `${candidate.trackArtist || "Unknown artist"} · score ${candidate.score.toFixed(1)}`;

    const reasons = document.createElement("small");
    reasons.textContent =
      candidate.layer === "-"
        ? "No rule-based signal yet."
        : candidate.reasons
            .slice(0, 4)
            .map((reason) => reason.label)
            .join(" · ");

    item.append(title, meta, reasons);
    container.append(item);
  }
}

function renderMonitorCandidateList(container, candidates, selectedLayer, limit = 3) {
  container.innerHTML = "";
  const maxScore = candidates.reduce((highest, candidate) => Math.max(highest, candidate.score || 0), 1);
  const items = candidates.length
    ? candidates.slice(0, limit)
    : [{ layer: "-", trackTitle: "No candidates", trackArtist: "", score: 0, reasons: [] }];

  items.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = `candidate-card monitor-candidate-card${selectedLayer === candidate.layer ? " selected" : ""}`;
    card.dataset.fitBase = "34";
    card.dataset.fitGrow = "10";

    const rank = document.createElement("div");
    rank.className = "monitor-candidate-rank";
    const rankValue = document.createElement("strong");
    rankValue.textContent = candidate.layer === "-" ? "--" : `#${index + 1}`;
    const rankMeta = document.createElement("span");
    rankMeta.textContent = candidate.layer === "-" ? "No deck" : `L${candidate.layer}`;
    rank.append(rankValue, rankMeta);

    const main = document.createElement("div");
    main.className = "monitor-candidate-main";
    const title = document.createElement("strong");
    title.dataset.fitText = "true";
    title.dataset.fitBox = ".monitor-candidate-main";
    title.dataset.fitCard = ".monitor-candidate-card";
    title.dataset.fitAxis = "width";
    title.dataset.fitMin = "8.5";
    title.dataset.fitMax = "10";
    title.textContent =
      candidate.layer === "-" ? "Waiting for scoring" : candidate.trackTitle || `Track ${candidate.trackId || "-"}`;
    main.append(title);

    const score = document.createElement("div");
    score.className = "monitor-candidate-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = candidate.layer === "-" ? "--" : candidate.score.toFixed(1);
    const bar = document.createElement("div");
    bar.className = "monitor-score-bar";
    const fill = document.createElement("span");
    fill.style.width = `${candidate.layer === "-" ? 8 : Math.max(8, (candidate.score / maxScore) * 100)}%`;
    bar.append(fill);
    score.append(scoreValue, bar);

    card.append(rank, main, score);
    container.append(card);
  });
}

function renderSelection(payload) {
  const selection = payload.selection.evaluation;
  const candidates = selection.candidates || [];

  elements.selectionModeDetail.textContent = payload.selection.mode;
  elements.selectionLayerDetail.textContent = selection.selectedLayer ? `Layer ${selection.selectedLayer}` : "-";
  elements.selectionMasterDetail.textContent = selection.masterSignalAvailable
    ? `Layer ${selection.masterLayer}`
    : "Unavailable";
  elements.selectionMixerDetail.textContent = selection.mixerSignalAvailable ? "Live Feed" : "Estimated";
  elements.selectionReasonText.textContent = selection.reason || "Waiting for deck telemetry.";
  elements.mixerTelemetryNote.textContent = selection.mixerSignalAvailable
    ? "Direct DJM channel telemetry available"
    : "Estimated channel audibility from CDJ transport";

  renderChannelMeterList(elements.channelMeters, payload.layers, candidates, selection.selectedLayer);
  renderCandidateList(elements.selectionList, candidates, selection.selectedLayer, 3);

  elements.monitorMixerFeed.textContent = selection.mixerSignalAvailable ? "Live feed" : "Estimated";
  elements.monitorMainDeck.textContent = selection.selectedLayer ? `Layer ${selection.selectedLayer}` : "-";
  elements.monitorMasterDeck.textContent = selection.masterSignalAvailable
    ? `Layer ${selection.masterLayer}`
    : "Unavailable";
  elements.monitorHoldTime.textContent = `${payload.selection.holdSeconds} sec`;
  elements.monitorMixerReason.textContent = selection.mixerSignalAvailable
    ? "Mixer state is coming from direct telemetry."
    : "Mixer state is inferred from CDJ transport and recent deck focus.";
  elements.monitorSelectionSummary.textContent = compactSelectionSummary(selection);
  renderMonitorReasonTokens(selection);

  renderChannelMeterList(elements.monitorChannelMeters, payload.layers, candidates, selection.selectedLayer);
  renderMonitorCandidateList(elements.monitorSelectionList, candidates, selection.selectedLayer, 2);
}

function renderAnalysis(payload) {
  const analysis = payload.analysis;
  const result = analysis.result;
  const ruleBased = analysis.ruleBased;

  let status = "Not configured";
  if (analysis.configured) {
    status = analysis.running ? "Analyzing" : "Ready";
  }
  if (analysis.lastError) {
    status = "Error";
  }

  elements.analysisStatusText.textContent = status;
  elements.analysisMetaText.textContent =
    analysis.lastError ||
    (analysis.configured
      ? `${analysis.model}${analysis.updatedAt ? ` · ${formatDateTime(analysis.updatedAt)}` : ""}${
          analysis.savedProfilePath ? ` · ${analysis.savedProfilePath.split("/").pop()}` : ""
        }`
      : "Set OPENAI_API_KEY to enable analysis");

  elements.analysisEnergy.textContent =
    ruleBased?.deterministic?.energy != null ? `${ruleBased.deterministic.energy}` : "-";
  elements.analysisConfidence.textContent =
    result?.confidence != null ? `${Math.round(result.confidence * 100)}%` : "-";
  elements.analysisMixRole.textContent = ruleBased?.deterministic?.playbackRole || "-";
  elements.analysisBasis.textContent = result?.basis || ruleBased?.ruleSource || "Metadata-only inference";
  elements.analysisSummary.textContent = result?.atmosphereSummary || "No GPT atmosphere summary yet.";

  renderChipRow(elements.analysisGenres, result?.likelyGenres, "No genres");
  renderChipRow(elements.analysisMoods, result?.moods, "No moods");
  renderChipRow(elements.analysisTextures, result?.textures, "No textures");
  renderChipRow(
    elements.analysisVisuals,
    [...(result?.visualKeywords || []), ...(result?.colorPalette || [])],
    "No visuals",
  );
}

function renderRouting(payload) {
  elements.routeTarget.textContent = `${payload.osc.host}:${payload.osc.port}`;
  elements.routeTargetMeta.textContent = payload.bridge.lastChange
    ? `Last change ${formatDateTime(payload.bridge.lastChange)}`
    : "Awaiting track changes";
  elements.routeCurrentAddress.textContent = payload.osc.currentTrackAddress;
  elements.routeChangedAddress.textContent = payload.osc.trackChangedAddress;
  elements.routeProfileAddress.textContent = payload.osc.trackProfileAddress || "/pro-dj-link/trackProfile";
  elements.routeProfilePath.textContent = payload.analysis.savedProfilePath
    ? payload.analysis.savedProfilePath.split("/").pop()
    : "No profile saved yet";
}

function renderEventList(container, entries, fallbackMessage = "Waiting for activity.", limit = 3) {
  container.innerHTML = "";

  const safeEntries = entries.length
    ? entries.slice(0, limit)
    : [{ id: "empty", message: fallbackMessage, type: "system", at: null }];

  for (const entry of safeEntries) {
    const item = document.createElement("li");

    const message = document.createElement("strong");
    message.textContent = entry.message;

    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = `${entry.type || "system"}${entry.at ? ` · ${formatDateTime(entry.at)}` : ""}`;

    item.append(message, meta);
    container.append(item);
  }
}

function renderMonitorEventList(container, entries, fallbackMessage = "Waiting for signal events.", limit = 4) {
  container.innerHTML = "";
  const safeEntries = entries.length
    ? entries.slice(0, limit)
    : [{ id: "empty", message: fallbackMessage, type: "system", at: null }];

  for (const entry of safeEntries) {
    const item = document.createElement("li");
    item.className = "monitor-event-item";
    item.dataset.fitBase = "34";
    item.dataset.fitGrow = "8";

    const pill = document.createElement("span");
    pill.className = "event-type-pill";
    pill.textContent = entry.type || "system";

    const main = document.createElement("div");
    main.className = "monitor-event-main";
    const message = document.createElement("strong");
    message.dataset.fitText = "true";
    message.dataset.fitBox = ".monitor-event-main";
    message.dataset.fitCard = ".monitor-event-item";
    message.dataset.fitAxis = "width";
    message.dataset.fitMin = "8";
    message.dataset.fitMax = "10";
    message.textContent = compactMonitorEventMessage(entry);

    main.append(message);
    item.append(pill, main);
    container.append(item);
  }
}

function renderEvents(payload) {
  renderEventList(elements.eventList, payload.events, "Waiting for activity.", 3);
  renderMonitorEventList(elements.monitorEventList, payload.events, "Waiting for signal events.", 2);
}

function renderVisualizerHud(payload) {
  const decks = computeVisualizerDecks(payload);
  const currentTrack = payload.currentTrack;
  const selected = decks.find((deck) => deck.selected) || decks[0] || null;

  elements.vizCurrentTrack.textContent = currentTrack?.title || "No Active Track";
  elements.vizCurrentMeta.textContent = currentTrack
    ? compactMeta([
        currentTrack.artist || "Unknown artist",
        `Layer ${currentTrack.layer}`,
        formatBpm(currentTrack.bpm),
      ])
    : "Waiting for transport";
  elements.vizMasterStats.textContent = selected
    ? compactMeta([`L${selected.layer}`, formatBpm(selected.bpm), `${Math.round(selected.level * 100)}%`])
    : "No signal";

  if (selected) {
    renderWaveSvg(elements.vizMasterWave, selected, { width: 640, height: 96 });
  } else {
    elements.vizMasterWave.innerHTML = "";
  }

  elements.vizDeckWaveGrid.innerHTML = "";
  decks.forEach((deck) => {
    const card = document.createElement("article");
    card.className = `viz-wave-card${deck.selected ? " is-selected" : ""}`;

    const head = document.createElement("div");
    head.className = "viz-wave-head";
    const label = document.createElement("strong");
    label.textContent = `L${deck.layer}`;
    const meta = document.createElement("span");
    meta.className = "viz-wave-meta";
    meta.textContent = formatBpm(deck.bpm) || "No BPM";
    head.append(label, meta);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 180 28");
    svg.setAttribute("preserveAspectRatio", "none");
    renderWaveSvg(svg, deck, { width: 180, height: 28, compact: true });

    const caption = document.createElement("div");
    caption.className = "viz-wave-caption";
    const left = document.createElement("span");
    left.textContent = deck.title;
    const right = document.createElement("span");
    right.textContent = `${Math.round(deck.level * 100)}%`;
    caption.append(left, right);

    card.append(head, svg, caption);
    elements.vizDeckWaveGrid.append(card);
  });

  elements.vizMeterStack.innerHTML = "";
  decks.forEach((deck) => {
    const column = document.createElement("article");
    column.className = `viz-meter-column${deck.selected ? " is-selected" : ""}`;

    const track = document.createElement("div");
    track.className = "viz-meter-track";
    const litSegments = Math.round(deck.level * 18);
    for (let index = 17; index >= 0; index -= 1) {
      const segment = document.createElement("span");
      segment.className = "viz-meter-segment";
      if (index < litSegments) {
        segment.classList.add(index < 3 ? "is-live" : "is-mid");
      }
      track.append(segment);
    }

    const label = document.createElement("span");
    label.className = "viz-meter-label";
    label.textContent = `L${deck.layer}`;
    column.append(track, label);
    elements.vizMeterStack.append(column);
  });

  elements.vizBeatRadar.innerHTML = "";
  decks.forEach((deck) => {
    const row = document.createElement("div");
    row.className = "viz-beat-row";

    const label = document.createElement("span");
    label.className = "viz-beat-label";
    label.textContent = `L${deck.layer}`;

    const cells = document.createElement("div");
    cells.className = "viz-beat-cells";
    const hotIndex = Math.floor(deck.phase * 8) % 8;
    for (let index = 0; index < 8; index += 1) {
      const cell = document.createElement("span");
      cell.className = "viz-beat-cell";
      if (index === hotIndex) {
        cell.classList.add("is-hot");
      } else if (Math.abs(index - hotIndex) === 1 || Math.abs(index - hotIndex) === 7) {
        cell.classList.add("is-warm");
      }
      cells.append(cell);
    }

    row.append(label, cells);
    elements.vizBeatRadar.append(row);
  });
}

function telemetryFlag(label, value, status) {
  const flag = document.createElement("div");
  flag.className = "telemetry-flag";
  flag.dataset.status = status;

  const title = document.createElement("span");
  title.textContent = label;

  const content = document.createElement("strong");
  content.textContent = value;

  flag.append(title, content);
  return flag;
}

function renderMonitorLayers(payload) {
  elements.monitorLayerGrid.innerHTML = "";

  const selection = payload.selection.evaluation;
  const candidates = selection.candidates || [];
  const candidateByLayer = scoreMap(candidates);
  const maxScore = candidates.reduce((highest, candidate) => Math.max(highest, candidate.score), 0);

  for (const layer of payload.layers) {
    const candidate = candidateByLayer.get(layer.layer);
    const row = document.createElement("article");
    row.className = `monitor-layer-row${selection.selectedLayer === layer.layer ? " active" : ""}`;

    const head = document.createElement("div");
    head.className = "monitor-layer-head";

    const layerLabel = document.createElement("span");
    layerLabel.className = "deck-layer";
    layerLabel.textContent = `Layer ${layer.layer}`;

    const statePill = document.createElement("span");
    statePill.className = "state-pill";
    statePill.dataset.state = layer.state;
    statePill.textContent = layer.state;

    head.append(layerLabel, statePill);

    const track = document.createElement("div");
    track.className = "monitor-layer-track";

    const title = document.createElement("strong");
    title.textContent = layer.trackTitle || "No track loaded";

    const artist = document.createElement("p");
    artist.textContent = layer.trackArtist || "Unknown artist";

    track.append(title, artist);

    const flags = document.createElement("div");
    flags.className = "monitor-flag-grid";
    flags.append(
      telemetryFlag("Seen", hasLayerSignal(layer) ? "OK" : "No", hasLayerSignal(layer) ? "ok" : "off"),
      telemetryFlag("Loaded", isLayerLoaded(layer) ? "Yes" : "No", isLayerLoaded(layer) ? "ok" : "warn"),
      telemetryFlag(
        "Moving",
        layer.isTransportAdvancing ? "Yes" : "No",
        layer.isTransportAdvancing ? "ok" : "warn",
      ),
      telemetryFlag("Meta", hasLayerMetadata(layer) ? "Yes" : "No", hasLayerMetadata(layer) ? "ok" : "warn"),
    );

    const meta = document.createElement("div");
    meta.className = "monitor-layer-meta";

    const meter = document.createElement("strong");
    meter.textContent = compactMeta([
      formatBpm(Number.isFinite(layer.bpm) ? layer.bpm / 100 : null) || "BPM -",
      `Pos ${formatDuration(layer.currentPosition)}`,
      `Focus ${Math.round(layerFocusPercent(layer, candidate, maxScore))}%`,
    ]);

    const detail = document.createElement("p");
    detail.textContent = candidate
      ? candidate.reasons
          .slice(0, 3)
          .map((reason) => reason.label)
          .join(" · ")
      : layer.metadataError || "No audible weight assigned.";

    meta.append(meter, detail);

    row.append(head, track, flags, meta);
    elements.monitorLayerGrid.append(row);
  }
}

function renderMonitorOverview(payload, bridgeStatus) {
  const layers = payload.layers || [];
  const loadedLayers = layers.filter(isLayerLoaded).length;
  const metadataLayers = layers.filter(hasLayerMetadata).length;
  const movingLayers = layers.filter((layer) => layer.isTransportAdvancing).length;
  const selection = payload.selection.evaluation;

  elements.monitorBridgeState.textContent = bridgeStatus;
  elements.monitorBridgeMeta.textContent =
    payload.bridge.lastError ||
    (payload.bridge.interfaceName
      ? compactMeta([payload.bridge.interfaceName, payload.bridge.interfaceAddress])
      : "No interface selected");

  elements.monitorDeckCoverage.textContent = `${layers.length} layers`;
  elements.monitorDeckCoverageMeta.textContent = `${loadedLayers} loaded · ${metadataLayers} metadata`;

  elements.monitorTransportState.textContent = `${movingLayers} moving`;
  elements.monitorTransportMeta.textContent = payload.currentTrack
    ? `On air Layer ${payload.currentTrack.layer}`
    : "No active playback";

  elements.monitorMixerState.textContent = selection.mixerSignalAvailable ? "Live feed" : "Estimated";
  elements.monitorMixerStateMeta.textContent = compactMeta([
    selection.selectedLayer ? `selected L${selection.selectedLayer}` : "No main deck",
    selection.masterSignalAvailable ? `master L${selection.masterLayer}` : "No master signal",
  ]);
}

function renderMonitor(payload, bridgeStatus) {
  renderMonitorOverview(payload, bridgeStatus);
  renderMonitorLayers(payload);
}

function render(payload) {
  state.lastPayload = payload;
  syncForm(payload);

  if (mixVisualizer) {
    mixVisualizer.updatePayload(payload);
  }

  const bridgeStatus = payload.bridge.connecting
    ? "Connecting"
    : payload.bridge.connected
      ? "Connected"
      : "Disconnected";

  elements.bridgeHeadlineStatus.textContent = payload.currentTrack
    ? `On Air: Layer ${payload.currentTrack.layer}`
    : `Bridge: ${bridgeStatus}`;
  elements.bridgeStatusText.textContent = bridgeStatus;
  elements.bridgeMetaText.textContent =
    payload.bridge.lastError ||
    (payload.bridge.interfaceName
      ? `${payload.bridge.interfaceName}${payload.bridge.interfaceAddress ? ` (${payload.bridge.interfaceAddress})` : ""}`
      : "Network interface not selected");

  elements.oscStatusText.textContent = `${payload.osc.host}:${payload.osc.port}`;
  elements.oscMetaText.textContent = payload.osc.trackProfileAddress || "Ready to send";

  const currentTrack = payload.currentTrack;
  elements.currentTrackTitle.textContent = currentTrack ? currentTrack.title : "No active track";
  elements.currentTrackMeta.textContent = currentTrack
    ? compactMeta([currentTrack.artist || "Unknown artist", `Layer ${currentTrack.layer}`, formatBpm(currentTrack.bpm)])
    : "Waiting for Bridge data";

  elements.detailTitle.textContent = currentTrack ? currentTrack.title : "No active track";
  elements.detailArtist.textContent = currentTrack
    ? compactMeta([currentTrack.artist || "Unknown artist", currentTrack.state])
    : "-";
  elements.detailLayer.textContent = currentTrack?.layer ? `Layer ${currentTrack.layer}` : "-";
  elements.detailTrackId.textContent = currentTrack?.trackId ? `${currentTrack.trackId}` : "-";
  elements.detailChangedAt.textContent = currentTrack ? formatDateTime(currentTrack.detectedAt) : "-";
  elements.detailPosition.textContent = formatTrackProgress(currentTrack);
  elements.currentTrackProgressFill.style.width = `${Math.max(
    2,
    progressRatio(currentTrack?.currentPosition, currentTrack?.trackLength) * 100,
  )}%`;

  renderLayers(payload);
  renderSelection(payload);
  renderAnalysis(payload);
  renderRouting(payload);
  renderEvents(payload);
  renderMonitor(payload, bridgeStatus);
  renderVisualizerHud(payload);
  scheduleMeasuredTextFit();

  elements.connectButton.disabled = payload.bridge.connecting || payload.bridge.connected || !payload.networkInterfaces.length;
  elements.disconnectButton.disabled = !payload.bridge.connected && !payload.bridge.connecting;
  elements.testOscButton.disabled = !payload.osc.host || !payload.osc.port;
  elements.analyzeButton.disabled = !payload.currentTrack || payload.analysis.running;
}

async function apiRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function refreshState() {
  const response = await fetch("/api/state");
  const payload = await response.json();
  render(payload);
}

function currentFormPayload() {
  return {
    bridgeInterface: elements.bridgeInterface.value,
    oscHost: elements.oscHost.value.trim(),
    oscPort: elements.oscPort.value,
    currentTrackAddress: elements.currentTrackAddress.value.trim(),
    trackChangedAddress: elements.trackChangedAddress.value.trim(),
    testAddress: elements.testAddress.value.trim(),
    trackProfileAddress: elements.trackProfileAddress.value.trim(),
    selectionMode: elements.selectionMode.value,
    selectionHoldSeconds: elements.selectionHoldSeconds.value,
    analysisModel: elements.analysisModel.value.trim(),
    analysisAutoAnalyze: elements.analysisAutoAnalyze.checked,
    analysisFocus: elements.analysisFocus.value.trim(),
  };
}

async function saveSettings() {
  const payload = await apiRequest("/api/config", currentFormPayload());
  state.formDirty = false;
  render(payload);
  setFlash("Settings saved.", "success");
}

function attachFormHandlers() {
  elements.settingsForm.addEventListener("input", () => {
    state.formDirty = true;
  });

  elements.saveButton.addEventListener("click", async () => {
    try {
      await saveSettings();
    } catch (error) {
      setFlash(error.message, "error");
    }
  });

  elements.connectButton.addEventListener("click", async () => {
    try {
      await saveSettings();
      const payload = await apiRequest("/api/connect");
      render(payload);
      setFlash("Bridge connected.", "success");
    } catch (error) {
      setFlash(error.message, "error");
    }
  });

  elements.disconnectButton.addEventListener("click", async () => {
    try {
      const payload = await apiRequest("/api/disconnect");
      render(payload);
      setFlash("Bridge disconnected.", "success");
    } catch (error) {
      setFlash(error.message, "error");
    }
  });

  elements.testOscButton.addEventListener("click", async () => {
    try {
      await saveSettings();
      const payload = await apiRequest("/api/test-osc");
      render(payload);
      setFlash("Test OSC sent.", "success");
    } catch (error) {
      setFlash(error.message, "error");
    }
  });

  elements.analyzeButton.addEventListener("click", async () => {
    try {
      await saveSettings();
      const payload = await apiRequest("/api/analyze-current");
      render(payload);
      setFlash("Track analyzed.", "success");
    } catch (error) {
      setFlash(error.message, "error");
    }
  });
}

function attachViewHandlers() {
  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  }
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      render(payload.payload);
    }
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connectSocket, 1500);
  });
}

mixVisualizer = window.MixVisualizerRenderer ? new window.MixVisualizerRenderer(elements.mixVisualizerCanvas) : null;
setActiveView(state.activeView);
attachFormHandlers();
attachViewHandlers();
connectSocket();
window.addEventListener("resize", scheduleMeasuredTextFit);
document.fonts?.ready?.then(scheduleMeasuredTextFit).catch(() => {});
refreshState().catch((error) => setFlash(error.message, "error"));
