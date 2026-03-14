const { TCNetLayerStatus } = require("node-tcnet");

const ARTIST_NAME = "Daito Manabe";
const SEGMENT_DURATION_MS = 22000;
const TRANSITION_DURATION_MS = 6000;
const DEFAULT_TICK_MS = 400;

const TITLE_HEADS = [
  "Xylq",
  "Qern",
  "Aevr",
  "Syln",
  "Mxrte",
  "Cindr",
  "Plinq",
  "Ravn",
  "Vektra",
  "Nyrb",
  "Tessr",
  "Oqta",
  "Draxl",
  "Kyrn",
  "Zyph",
  "Linthe",
];

const TITLE_MIDDLES = [
  "Drift",
  "Fold",
  "Mesh",
  "Grid",
  "Coil",
  "Phase",
  "Offset",
  "Quant",
  "Form",
  "Hexline",
  "Shift",
  "Frame",
  "Splice",
  "Vector",
  "Null",
  "Axis",
];

const TITLE_TAILS = [
  "71",
  "Null",
  "3",
  "Unit",
  "12",
  "Cell",
  "04",
  "Fold",
  "6",
  "Loop",
  "Vector",
  "Arc",
  "M",
  "Grid",
  "II",
  "Pulse",
];

const GENRE_BANK = [
  ["abstract techno", "broken electro", "machine funk"],
  ["IDM", "micro-groove", "dub architecture"],
  ["off-grid club", "mechanical soul", "post-techno"],
  ["leftfield rhythm science", "minimal electro", "textural techno"],
];

const MOOD_BANK = [
  ["tensile", "nocturnal", "focused"],
  ["warm", "alien", "patient"],
  ["dry", "hypnotic", "analytical"],
  ["smoky", "precise", "restless"],
];

const TEXTURE_BANK = [
  ["granular hats", "rubber bass", "glass clicks"],
  ["matte sub pulses", "shaved snares", "folded noise"],
  ["hollow kicks", "satin pads", "metal filaments"],
  ["compressed tom ghosts", "dusty transients", "wire chatter"],
];

const VISUAL_BANK = [
  ["wireframe corridors", "tilted grids", "signal dust"],
  ["split planes", "kinetic scaffolds", "soft strobes"],
  ["monochrome waveforms", "floating markers", "precision beams"],
  ["offset lattices", "raster pulses", "cold halos"],
];

const COLOR_BANK = [
  ["graphite", "cold silver", "ice cyan"],
  ["charcoal", "soft white", "frost blue"],
  ["gunmetal", "mist grey", "pale mint"],
  ["obsidian", "white smoke", "steel blue"],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildTitle(index) {
  const head = TITLE_HEADS[index % TITLE_HEADS.length];
  const middle = TITLE_MIDDLES[(index * 3) % TITLE_MIDDLES.length];
  const tail = TITLE_TAILS[(index * 5 + 2) % TITLE_TAILS.length];
  return index % 2 === 0 ? `${head} ${middle}-${tail}` : `${head} ${middle} ${tail}`;
}

function buildSummary(index) {
  const moods = MOOD_BANK[index % MOOD_BANK.length];
  const textures = TEXTURE_BANK[(index + 1) % TEXTURE_BANK.length];
  const visuals = VISUAL_BANK[(index + 2) % VISUAL_BANK.length];
  const colors = COLOR_BANK[(index + 3) % COLOR_BANK.length];

  return `A ${moods[0]}, ${moods[1]} rhythm frame with ${textures[0]}, ${textures[1]}, and ${textures[2]}. The groove feels ${moods[2]} and architectural rather than explosive, holding tension inside a clipped monochrome field before opening into ${visuals[0]} and ${visuals[1]} accents. In the room it reads as ${colors[0]}, ${colors[1]}, and ${colors[2]} with a disciplined, machine-soul pulse.`;
}

function buildTrackCatalog(size = 16) {
  return Array.from({ length: size }, (_, index) => {
    const bpm = 108 + ((index * 7) % 25) + ((index % 3) * 0.4);
    return {
      trackId: 4100 + index,
      trackKey: 1000 + index,
      title: buildTitle(index),
      artist: ARTIST_NAME,
      bpm,
      bpmScaled: Math.round(bpm * 100),
      trackLength: 330000 + ((index * 17000) % 140000),
      likelyGenres: GENRE_BANK[index % GENRE_BANK.length],
      moods: MOOD_BANK[(index + 1) % MOOD_BANK.length],
      textures: TEXTURE_BANK[(index + 2) % TEXTURE_BANK.length],
      visualKeywords: VISUAL_BANK[(index + 3) % VISUAL_BANK.length],
      colorPalette: COLOR_BANK[index % COLOR_BANK.length],
      atmosphereSummary: buildSummary(index),
      confidence: Number((0.82 + (index % 5) * 0.03).toFixed(2)),
    };
  });
}

class DummyPlaybackEngine {
  constructor({ layers, tickMs = DEFAULT_TICK_MS } = {}) {
    this.layers = [...(layers || [1, 2, 3, 4])];
    this.tickMs = tickMs;
    this.catalog = buildTrackCatalog();
    this.trackCatalogById = new Map(this.catalog.map((track) => [track.trackId, track]));
    this.segmentDurationMs = SEGMENT_DURATION_MS;
    this.transitionDurationMs = TRANSITION_DURATION_MS;
    this.started = false;
    this.mainIndex = 0;
    this.segmentStartedAtMs = 0;
    this.transitionStarted = false;
    this.transitionStartedAtMs = 0;
    this.trackCursor = 0;
    this.decks = new Map();
  }

  start(now = Date.now()) {
    this.started = true;
    this.mainIndex = 0;
    this.segmentStartedAtMs = now;
    this.transitionStarted = false;
    this.transitionStartedAtMs = 0;
    this.trackCursor = 0;
    this.decks.clear();

    for (const layer of this.layers) {
      this.decks.set(layer, this.createDeck(layer));
    }

    const main = this.getRoleDeck(0);
    const cue = this.getRoleDeck(1);
    const accent = this.getRoleDeck(2);
    const archive = this.getRoleDeck(3);

    this.loadTrack(main, this.takeNextTrack(), now, { pausedPositionMs: 12000 });
    this.setDeckPlaying(main, now - 14000, { basePositionMs: 12000 });

    this.loadTrack(cue, this.takeNextTrack(), now, { pausedPositionMs: 8000 });
    this.setDeckPaused(cue, { pausedPositionMs: 8000 });

    this.loadTrack(accent, this.takeNextTrack(), now, { pausedPositionMs: 32000 });
    this.setDeckLooping(accent, now - 52000, { basePositionMs: 32000 });

    this.loadTrack(archive, this.takeNextTrack(), now, { pausedPositionMs: 16000 });
    this.setDeckPaused(archive, { pausedPositionMs: 16000 });
  }

  stop() {
    this.started = false;
  }

  takeNextTrack() {
    const template = this.catalog[this.trackCursor % this.catalog.length];
    this.trackCursor += 1;
    return { ...template };
  }

  createDeck(layer) {
    return {
      layer,
      track: null,
      stateCode: TCNetLayerStatus.IDLE,
      loadedAtMs: 0,
      startedAtMs: 0,
      basePositionMs: 0,
      pausedPositionMs: 0,
    };
  }

  getRoleDeck(offset) {
    const layer = this.layers[(this.mainIndex + offset) % this.layers.length];
    return this.decks.get(layer);
  }

  loadTrack(deck, track, now, { pausedPositionMs = 0 } = {}) {
    deck.track = { ...track };
    deck.loadedAtMs = now;
    deck.basePositionMs = 0;
    deck.startedAtMs = 0;
    deck.pausedPositionMs = pausedPositionMs;
  }

  setDeckPlaying(deck, startedAtMs, { basePositionMs = 0 } = {}) {
    deck.stateCode = TCNetLayerStatus.PLAYING;
    deck.startedAtMs = startedAtMs;
    deck.basePositionMs = basePositionMs;
    deck.pausedPositionMs = basePositionMs;
  }

  setDeckLooping(deck, startedAtMs, { basePositionMs = 0 } = {}) {
    deck.stateCode = TCNetLayerStatus.LOOPING;
    deck.startedAtMs = startedAtMs;
    deck.basePositionMs = basePositionMs;
    deck.pausedPositionMs = basePositionMs;
  }

  setDeckPaused(deck, { pausedPositionMs = 0 } = {}) {
    deck.stateCode = TCNetLayerStatus.PAUSED;
    deck.startedAtMs = 0;
    deck.basePositionMs = pausedPositionMs;
    deck.pausedPositionMs = pausedPositionMs;
  }

  currentPosition(deck, now) {
    if (!deck.track) {
      return 0;
    }

    if (deck.stateCode === TCNetLayerStatus.PLAYING) {
      return clamp(deck.basePositionMs + Math.max(0, now - deck.startedAtMs), 0, deck.track.trackLength);
    }

    if (deck.stateCode === TCNetLayerStatus.LOOPING) {
      const windowLength = Math.max(8000, Math.min(deck.track.trackLength, 32000));
      return (deck.basePositionMs + Math.max(0, now - deck.startedAtMs)) % windowLength;
    }

    return clamp(deck.pausedPositionMs || 0, 0, deck.track.trackLength);
  }

  startTransition(now) {
    if (this.transitionStarted) {
      return;
    }

    const cue = this.getRoleDeck(1);
    if (cue?.track) {
      this.setDeckPlaying(cue, now, { basePositionMs: 0 });
    }

    this.transitionStarted = true;
    this.transitionStartedAtMs = now;
  }

  rotateSegment(now) {
    if (!this.transitionStarted) {
      this.startTransition(now - Math.min(this.transitionDurationMs, this.tickMs));
    }

    const outgoingMain = this.getRoleDeck(0);
    if (outgoingMain?.track) {
      this.setDeckPaused(outgoingMain, { pausedPositionMs: this.currentPosition(outgoingMain, now) });
    }

    this.mainIndex = (this.mainIndex + 1) % this.layers.length;
    this.segmentStartedAtMs += this.segmentDurationMs;
    this.transitionStarted = false;
    this.transitionStartedAtMs = 0;

    const nextCue = this.getRoleDeck(1);
    if (nextCue) {
      this.loadTrack(nextCue, this.takeNextTrack(), now, { pausedPositionMs: 6000 + (this.mainIndex % 4) * 2000 });
      this.setDeckPaused(nextCue, { pausedPositionMs: 6000 + (this.mainIndex % 4) * 2000 });
    }

    const accent = this.getRoleDeck(2);
    if (accent?.track) {
      const accentOffset = 28000 + ((this.mainIndex + accent.layer) % 5) * 7000;
      this.setDeckLooping(accent, now - 36000, { basePositionMs: accentOffset });
    }
  }

  update(now = Date.now()) {
    if (!this.started) {
      this.start(now);
    }

    while (now - this.segmentStartedAtMs >= this.segmentDurationMs) {
      this.rotateSegment(this.segmentStartedAtMs + this.segmentDurationMs);
    }

    const elapsedInSegment = now - this.segmentStartedAtMs;
    const transitionThreshold = this.segmentDurationMs - this.transitionDurationMs;
    if (elapsedInSegment >= transitionThreshold) {
      this.startTransition(now);
    }

    return this.buildFrame(now);
  }

  buildFrame(now) {
    const elapsedInSegment = now - this.segmentStartedAtMs;
    const transitionThreshold = this.segmentDurationMs - this.transitionDurationMs;
    const transitionRatio = clamp(
      (elapsedInSegment - transitionThreshold) / this.transitionDurationMs,
      0,
      1,
    );
    const mainLayer = this.layers[this.mainIndex];
    const cueLayer = this.layers[(this.mainIndex + 1) % this.layers.length];
    const accentLayer = this.layers[(this.mainIndex + 2) % this.layers.length];

    const layers = this.layers.map((layer) => {
      const deck = this.decks.get(layer);
      const track = deck.track;
      const position = this.currentPosition(deck, now);
      const bpm = track?.bpmScaled || 0;
      const beatIndex = bpm > 0 ? Math.floor((position / 60000) * (bpm / 100)) : 0;
      const beatNumber = beatIndex % 4 === 0 ? 4 : beatIndex % 4;
      let mixerLevel = 0.02;

      if (layer === mainLayer) {
        mixerLevel = this.transitionStarted ? 0.96 - transitionRatio * 0.78 : 0.96;
      } else if (layer === cueLayer) {
        mixerLevel = this.transitionStarted ? 0.08 + transitionRatio * 0.88 : 0.04;
      } else if (layer === accentLayer) {
        mixerLevel = 0.18 + Math.sin((elapsedInSegment / this.segmentDurationMs) * Math.PI) * 0.09;
      }

      if (deck.stateCode === TCNetLayerStatus.PAUSED) {
        mixerLevel = Math.min(mixerLevel, 0.05);
      }

      if (!track) {
        return {
          layer,
          trackId: -1,
          trackTitle: "",
          trackArtist: "",
          trackKey: null,
          stateCode: TCNetLayerStatus.IDLE,
          currentPosition: 0,
          trackLength: 0,
          beatMarker: 0,
          beatNumber: 0,
          bpm: 0,
          speed: 100,
          pitchBend: 0,
          syncMaster: 0,
          mixerLevel: 0,
          channelFader: 0,
        };
      }

      return {
        layer,
        trackId: track.trackId,
        trackTitle: track.title,
        trackArtist: track.artist,
        trackKey: track.trackKey,
        stateCode: deck.stateCode,
        currentPosition: Math.round(position),
        trackLength: track.trackLength,
        beatMarker: beatIndex,
        beatNumber,
        bpm,
        speed: 100,
        pitchBend: 0,
        syncMaster: layer === mainLayer ? 1 : 0,
        mixerLevel: Number(clamp(mixerLevel, 0, 1).toFixed(3)),
        channelFader: Number(clamp(mixerLevel, 0, 1).toFixed(3)),
      };
    });

    return {
      generatedAtMs: now,
      mainLayer,
      cueLayer,
      transitionRatio,
      layers,
    };
  }

  buildAnalysis(track, ruleBased) {
    const template = this.trackCatalogById.get(track.trackId);
    if (!template) {
      return null;
    }

    return {
      basis: "Simulated GPT atmosphere for manual capture. Derived from synthetic metadata and mixer telemetry.",
      confidence: template.confidence,
      likelyGenres: [...template.likelyGenres],
      moods: [...template.moods],
      textures: [...template.textures],
      visualKeywords: [...template.visualKeywords],
      colorPalette: [...template.colorPalette],
      atmosphereSummary: template.atmosphereSummary,
      playbackRole: ruleBased?.deterministic?.playbackRole || "main_playback",
      source: "dummy-manual-mode",
    };
  }
}

module.exports = {
  ARTIST_NAME,
  DEFAULT_TICK_MS,
  DummyPlaybackEngine,
};
