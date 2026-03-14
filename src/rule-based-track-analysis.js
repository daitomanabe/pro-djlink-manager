function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferTempoBand(bpm) {
  if (!Number.isFinite(bpm)) {
    return "unknown";
  }

  if (bpm < 95) {
    return "slow";
  }
  if (bpm < 110) {
    return "mid_slow";
  }
  if (bpm < 122) {
    return "groove";
  }
  if (bpm < 128) {
    return "club";
  }
  if (bpm < 136) {
    return "peak";
  }
  return "fast";
}

function inferTrackWindow(currentPosition, trackLength) {
  if (!Number.isFinite(currentPosition) || currentPosition < 0) {
    return "unknown";
  }

  if (currentPosition <= 30000) {
    return "intro";
  }

  if (currentPosition <= 90000) {
    return "early";
  }

  if (Number.isFinite(trackLength) && trackLength > 0) {
    const ratio = currentPosition / trackLength;
    if (ratio >= 0.82) {
      return "outro";
    }
    if (ratio >= 0.58) {
      return "late";
    }
  }

  return "mid";
}

function inferPlaybackRole({ state, isTransportAdvancing, currentPosition, selection, layer }) {
  if (state === "PAUSED") {
    return "cue_or_hold";
  }

  const candidate = selection?.candidates?.find((entry) => entry.layer === layer);
  const isWinningLayer = selection?.selectedLayer === layer;

  if (!isWinningLayer && state === "PLAYING") {
    return "supporting_or_blend_layer";
  }

  if (currentPosition <= 30000) {
    return "freshly_started";
  }

  if (isTransportAdvancing && candidate?.reasons?.some((reason) => reason.label === "sticky-incumbent")) {
    return "established_main_playback";
  }

  if (isTransportAdvancing) {
    return "main_playback";
  }

  return "uncertain";
}

function inferRuleEnergy({ bpm, state, isTransportAdvancing, currentPosition }) {
  let energy = 45;

  if (Number.isFinite(bpm)) {
    if (bpm >= 128) {
      energy += 22;
    } else if (bpm >= 122) {
      energy += 16;
    } else if (bpm >= 115) {
      energy += 10;
    } else if (bpm >= 105) {
      energy += 4;
    } else {
      energy -= 4;
    }
  }

  if (state === "LOOPING") {
    energy += 5;
  }

  if (state === "PAUSED") {
    energy -= 18;
  }

  if (isTransportAdvancing) {
    energy += 8;
  } else {
    energy -= 10;
  }

  if (Number.isFinite(currentPosition) && currentPosition <= 45000) {
    energy -= 4;
  }

  return clamp(Math.round(energy), 0, 100);
}

function buildRuleBasedTrackAnalysis({ track, layer, selection }) {
  const currentPosition = Number.isFinite(track.currentPosition) ? track.currentPosition : null;
  const trackLength = Number.isFinite(track.trackLength) && track.trackLength > 0 ? track.trackLength : null;
  const bpm = Number.isFinite(track.bpm) ? track.bpm : null;
  const tempoBand = inferTempoBand(bpm);
  const trackWindow = inferTrackWindow(currentPosition, trackLength);
  const playbackRole = inferPlaybackRole({
    state: track.state,
    isTransportAdvancing: Boolean(layer.isTransportAdvancing),
    currentPosition: currentPosition ?? Number.POSITIVE_INFINITY,
    selection,
    layer: track.layer,
  });
  const energy = inferRuleEnergy({
    bpm,
    state: track.state,
    isTransportAdvancing: Boolean(layer.isTransportAdvancing),
    currentPosition: currentPosition ?? Number.POSITIVE_INFINITY,
  });

  const flags = [];
  if (layer.isTransportAdvancing) {
    flags.push("transport_advancing");
  }
  if (currentPosition != null && currentPosition <= 30000) {
    flags.push("new_track_window");
  }
  if (selection?.selectedLayer === track.layer) {
    flags.push("selected_as_audible");
  }
  if (selection?.masterLayer === track.layer && selection.masterSignalAvailable) {
    flags.push("master_correlated");
  }

  const confidenceSignals = [
    selection?.selectedLayer === track.layer,
    layer.isTransportAdvancing,
    track.state === "PLAYING" || track.state === "LOOPING",
    Number.isFinite(track.selectionScore),
  ].filter(Boolean).length;

  return {
    generatedAt: new Date().toISOString(),
    ruleSource: "bridge-telemetry",
    deterministic: {
      state: track.state,
      isTransportAdvancing: Boolean(layer.isTransportAdvancing),
      currentPositionMs: currentPosition,
      trackLengthMs: trackLength,
      bpm,
      tempoBand,
      trackWindow,
      playbackRole,
      energy,
      flags,
      confidence: Number((confidenceSignals / 4).toFixed(2)),
    },
    selection: {
      mode: selection?.mode || null,
      selectedLayer: selection?.selectedLayer || null,
      masterLayer: selection?.masterLayer || null,
      masterSignalAvailable: Boolean(selection?.masterSignalAvailable),
      mixerSignalAvailable: Boolean(selection?.mixerSignalAvailable),
      score: track.selectionScore,
      reason: track.selectionReason,
    },
  };
}

module.exports = {
  buildRuleBasedTrackAnalysis,
};
