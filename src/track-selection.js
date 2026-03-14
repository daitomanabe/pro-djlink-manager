const ACTIVE_TRACK_STATES = new Set(["PLAYING", "LOOPING"]);
const PLAYABLE_TRACK_STATES = new Set(["PLAYING", "LOOPING", "PAUSED"]);

const DEFAULT_SELECTION_MODE = "balanced";
const DEFAULT_SELECTION_HOLD_SECONDS = 12;
const DEFAULT_SELECTION_PROFILES = {
  balanced: {
    statePlaying: 140,
    stateLooping: 135,
    statePaused: 40,
    stateOther: -120,
    mixerLevel: 126,
    explicitMaster: 90,
    transportAdvancing: 55,
    recentStart: 55,
    recentLoad: 24,
    nearTrackStart: 34,
    stickyIncumbent: 32,
    positionRecency: 18,
    challengerMargin: 22,
  },
  master_first: {
    statePlaying: 138,
    stateLooping: 132,
    statePaused: 30,
    stateOther: -120,
    mixerLevel: 112,
    explicitMaster: 135,
    transportAdvancing: 44,
    recentStart: 34,
    recentLoad: 16,
    nearTrackStart: 22,
    stickyIncumbent: 20,
    positionRecency: 12,
    challengerMargin: 18,
  },
  recent_start: {
    statePlaying: 142,
    stateLooping: 138,
    statePaused: 24,
    stateOther: -120,
    mixerLevel: 118,
    explicitMaster: 72,
    transportAdvancing: 50,
    recentStart: 82,
    recentLoad: 28,
    nearTrackStart: 45,
    stickyIncumbent: 16,
    positionRecency: 14,
    challengerMargin: 16,
  },
  lowest_position: {
    statePlaying: 138,
    stateLooping: 134,
    statePaused: 18,
    stateOther: -120,
    mixerLevel: 104,
    explicitMaster: 64,
    transportAdvancing: 42,
    recentStart: 28,
    recentLoad: 16,
    nearTrackStart: 28,
    stickyIncumbent: 12,
    positionRecency: 60,
    challengerMargin: 12,
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBpm(rawBpm) {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) {
    return null;
  }

  if (rawBpm >= 1000) {
    return Number((rawBpm / 100).toFixed(2));
  }

  return Number(rawBpm.toFixed(2));
}

function activeStateWeight(layer, profile) {
  if (layer.state === "PLAYING") {
    return profile.statePlaying;
  }

  if (layer.state === "LOOPING") {
    return profile.stateLooping;
  }

  if (layer.state === "PAUSED") {
    return profile.statePaused;
  }

  return profile.stateOther;
}

function detectMasterLayer(layers) {
  const activeLayers = layers.filter((layer) => ACTIVE_TRACK_STATES.has(layer.state) && layer.trackId > 0);
  if (!activeLayers.length) {
    return { layer: null, available: false };
  }

  const explicitMaster = activeLayers.filter((layer) => layer.syncMaster === 1);
  if (explicitMaster.length === 1) {
    return { layer: explicitMaster[0].layer, available: true };
  }

  const groupedByFlag = new Map();
  for (const layer of activeLayers) {
    if (layer.syncMaster == null) {
      continue;
    }

    const count = groupedByFlag.get(layer.syncMaster) || 0;
    groupedByFlag.set(layer.syncMaster, count + 1);
  }

  if (groupedByFlag.size === 2) {
    for (const [flag, count] of groupedByFlag.entries()) {
      if (count === 1) {
        const uniqueLayer = activeLayers.find((layer) => layer.syncMaster === flag);
        if (uniqueLayer) {
          return { layer: uniqueLayer.layer, available: true };
        }
      }
    }
  }

  return { layer: null, available: false };
}

function scaleRecentBonus(nowMs, timestampMs, maxBonus, windowMs) {
  if (!timestampMs || nowMs < timestampMs) {
    return 0;
  }

  const age = nowMs - timestampMs;
  if (age >= windowMs) {
    return 0;
  }

  const ratio = 1 - age / windowMs;
  return Number((maxBonus * ratio).toFixed(2));
}

function positionRecencyBonus(currentPosition, maxBonus) {
  if (!Number.isFinite(currentPosition) || currentPosition < 0) {
    return 0;
  }

  const firstMinuteRatio = clamp(1 - currentPosition / 60000, 0, 1);
  return Number((firstMinuteRatio * maxBonus).toFixed(2));
}

function scoreLayer({ layer, incumbentLayer, masterLayer, masterSignalAvailable, nowMs, holdMs, profile }) {
  if (layer.trackId <= 0 || !PLAYABLE_TRACK_STATES.has(layer.state)) {
    return null;
  }

  const reasons = [];
  let score = 0;

  const stateScore = activeStateWeight(layer, profile);
  score += stateScore;
  reasons.push({ label: `state:${layer.state.toLowerCase()}`, score: stateScore });

  if (Number.isFinite(layer.mixerLevel)) {
    const mixerBonus = Number((clamp(layer.mixerLevel, 0, 1) * profile.mixerLevel).toFixed(2));
    score += mixerBonus;
    reasons.push({ label: "mixer-level", score: mixerBonus });
  }

  if (masterSignalAvailable && layer.layer === masterLayer) {
    score += profile.explicitMaster;
    reasons.push({ label: "explicit-master", score: profile.explicitMaster });
  }

  if (layer.isTransportAdvancing) {
    score += profile.transportAdvancing;
    reasons.push({ label: "transport-advancing", score: profile.transportAdvancing });
  }

  const startBonus = scaleRecentBonus(nowMs, layer.lastPlaybackStartEpochMs, profile.recentStart, 120000);
  if (startBonus > 0) {
    score += startBonus;
    reasons.push({ label: "recent-play-start", score: startBonus });
  }

  const loadBonus = scaleRecentBonus(nowMs, layer.lastTrackChangeEpochMs, profile.recentLoad, 90000);
  if (loadBonus > 0) {
    score += loadBonus;
    reasons.push({ label: "recent-track-load", score: loadBonus });
  }

  const positionBonus = positionRecencyBonus(layer.currentPosition, profile.positionRecency);
  if (positionBonus > 0) {
    score += positionBonus;
    reasons.push({ label: "early-position", score: positionBonus });
  }

  if (Number.isFinite(layer.currentPosition) && layer.currentPosition <= 30000) {
    score += profile.nearTrackStart;
    reasons.push({ label: "first-30s-window", score: profile.nearTrackStart });
  }

  if (incumbentLayer && incumbentLayer === layer.layer) {
    score += profile.stickyIncumbent;
    reasons.push({ label: "sticky-incumbent", score: profile.stickyIncumbent });

    if (holdMs > 0) {
      const holdBonus = scaleRecentBonus(nowMs, Date.now() - holdMs, 0, holdMs);
      if (holdBonus > 0) {
        score += holdBonus;
      }
    }
  }

  return {
    layer: layer.layer,
    trackId: layer.trackId,
    trackTitle: layer.trackTitle,
    trackArtist: layer.trackArtist,
    score: Number(score.toFixed(2)),
    reasons,
  };
}

function selectAudibleTrack({ layers, currentTrack, selectionMode, holdSeconds }) {
  const mode = DEFAULT_SELECTION_PROFILES[selectionMode] ? selectionMode : DEFAULT_SELECTION_MODE;
  const profile = DEFAULT_SELECTION_PROFILES[mode];
  const nowMs = Date.now();
  const holdMs = Math.max(0, Number(holdSeconds || DEFAULT_SELECTION_HOLD_SECONDS) * 1000);
  const incumbentLayer = currentTrack?.layer || null;
  const { layer: masterLayer, available: masterSignalAvailable } = detectMasterLayer(layers);
  const mixerSignalAvailable = layers.some((layer) => Number.isFinite(layer.mixerLevel));

  const candidates = layers
    .map((layer) =>
      scoreLayer({
        layer,
        incumbentLayer,
        masterLayer,
        masterSignalAvailable,
        nowMs,
        holdMs,
        profile,
      }),
    )
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.layer - right.layer;
    });

  if (!candidates.length) {
    return {
      mode,
      selectedLayer: null,
      masterLayer,
      masterSignalAvailable,
      mixerSignalAvailable,
      candidates: [],
      reason: "No playable layer.",
    };
  }

  let winner = candidates[0];
  const incumbentCandidate = incumbentLayer ? candidates.find((candidate) => candidate.layer === incumbentLayer) : null;
  if (incumbentCandidate && winner.layer !== incumbentCandidate.layer) {
    const incumbentAgeMs = currentTrack?.detectedAt ? nowMs - Date.parse(currentTrack.detectedAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(incumbentAgeMs) && incumbentAgeMs < holdMs) {
      const requiredLead = profile.challengerMargin;
      if (winner.score < incumbentCandidate.score + requiredLead) {
        winner = {
          ...incumbentCandidate,
          reasons: incumbentCandidate.reasons.concat({
            label: "stickiness-hold-window",
            score: 0,
          }),
        };
      }
    }
  }

  return {
    mode,
    selectedLayer: winner.layer,
    masterLayer,
    masterSignalAvailable,
    mixerSignalAvailable,
    candidates,
    reason: winner.reasons.map((entry) => entry.label).join(", "),
  };
}

module.exports = {
  ACTIVE_TRACK_STATES,
  DEFAULT_SELECTION_HOLD_SECONDS,
  DEFAULT_SELECTION_MODE,
  DEFAULT_SELECTION_PROFILES,
  normalizeBpm,
  selectAudibleTrack,
};
