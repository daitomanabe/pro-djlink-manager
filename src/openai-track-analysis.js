const OpenAI = require("openai");

const DEFAULT_ANALYSIS_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const DEFAULT_ANALYSIS_FOCUS =
  "Infer only the track atmosphere and non-deterministic characteristics needed for lighting, visuals, and set programming. Use only the supplied metadata and deterministic rule-based analysis. Do not claim to have listened to the audio.";

const TRACK_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "atmosphere_summary",
    "likely_genres",
    "moods",
    "textures",
    "visual_keywords",
    "color_palette",
    "confidence",
    "basis",
  ],
  properties: {
    atmosphere_summary: { type: "string" },
    likely_genres: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    moods: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    textures: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    visual_keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    color_palette: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    basis: { type: "string" },
  },
};

function sanitizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((entry) => `${entry || ""}`.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeAnalysisResult(parsed) {
  return {
    atmosphereSummary: `${parsed.atmosphere_summary || ""}`.trim(),
    likelyGenres: sanitizeStringArray(parsed.likely_genres),
    moods: sanitizeStringArray(parsed.moods),
    textures: sanitizeStringArray(parsed.textures),
    visualKeywords: sanitizeStringArray(parsed.visual_keywords),
    colorPalette: sanitizeStringArray(parsed.color_palette),
    confidence:
      Number.isFinite(parsed.confidence) ? Number(Math.max(0, Math.min(1, parsed.confidence)).toFixed(2)) : null,
    basis: `${parsed.basis || ""}`.trim(),
  };
}

class OpenAITrackAnalyzer {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = options.model || DEFAULT_ANALYSIS_MODEL;
    this.focus = options.focus || DEFAULT_ANALYSIS_FOCUS;
    this.client = this.apiKey ? new OpenAI({ apiKey: this.apiKey }) : null;
    this.cache = new Map();
  }

  isConfigured() {
    return Boolean(this.client);
  }

  updateConfig({ model, focus }) {
    if (typeof model === "string" && model.trim()) {
      this.model = model.trim();
    }

    if (typeof focus === "string" && focus.trim()) {
      this.focus = focus.trim();
    }
  }

  analysisKey(track) {
    return [this.model, this.focus, track.title, track.artist, track.trackId].join("::");
  }

  async analyzeTrack({ track, selection, ruleBased }) {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const cacheKey = this.analysisKey(track);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.responses.create({
      model: this.model,
      instructions:
        "You infer only atmospheric, genre-adjacent, and visual characteristics for a DJ track. Deterministic fields such as BPM, transport state, playback role, and energy are already decided rule-based. Do not restate them as guesses unless needed for basis. Never claim you listened to the audio. Keep claims calibrated and concise.",
      input: JSON.stringify(
        {
          focus: this.focus,
          current_track: track,
          selection,
          rule_based_analysis: ruleBased,
        },
        null,
        2,
      ),
      text: {
        format: {
          type: "json_schema",
          name: "track_characteristics",
          strict: true,
          description: "Metadata-based atmospheric characterization of the currently selected DJ track.",
          schema: TRACK_ANALYSIS_SCHEMA,
        },
        verbosity: "low",
      },
    });

    const outputText = `${response.output_text || ""}`.trim();
    if (!outputText) {
      throw new Error("OpenAI returned an empty analysis response.");
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (error) {
      throw new Error(`Failed to parse OpenAI analysis JSON: ${error.message}`);
    }

    const sanitized = sanitizeAnalysisResult(parsed);
    this.cache.set(cacheKey, sanitized);
    return sanitized;
  }
}

module.exports = {
  DEFAULT_ANALYSIS_FOCUS,
  DEFAULT_ANALYSIS_MODEL,
  OpenAITrackAnalyzer,
};
