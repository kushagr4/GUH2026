import "server-only";
import { z } from "zod";
import { readIntegrationEnv, type EnvSource, type IntegrationStatus } from "./env";
import { IntegrationError } from "./errors";
import { createApiClient, type ApiClientOptions } from "./http";

/**
 * ElevenLabs speech: text-to-speech, speech-to-text (Scribe) and voices.
 * OPTIONAL: off until ELEVENLABS_API_KEY is set, so nothing runs or spends
 * credit before then. See docs/sponsor-comparison.md.
 *
 * Checked 7 Nov 2026: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 * and https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
const NAME = "ElevenLabs";

/** Free plan, as documented on 7 Nov 2026. Credits are shared by every product. */
export const ELEVENLABS_FREE_TIER = { monthlyCredits: 10_000, concurrentRequests: 2 } as const;

/** "George", the voice in ElevenLabs' own quickstart. */
export const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
/** The fastest model, and half the price per character of Multilingual v2. */
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
export const DEFAULT_STT_MODEL = "scribe_v2";

/** Per request. Model limits are higher; short clips keep latency and cost down. */
export const MAX_SPEECH_CHARACTERS = 2500;
export const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ELEVENLABS_ENV = {
  apiKey: {
    name: "ELEVENLABS_API_KEY",
    pattern: /^[A-Za-z0-9_-]{20,}$/,
    hint: "be an ElevenLabs API key",
  },
  voiceId: {
    name: "ELEVENLABS_VOICE_ID",
    required: false,
    default: DEFAULT_VOICE_ID,
    pattern: /^[A-Za-z0-9]{10,40}$/,
    hint: "be a voice ID",
  },
  modelId: {
    name: "ELEVENLABS_MODEL_ID",
    required: false,
    default: DEFAULT_TTS_MODEL,
    pattern: /^[a-z0-9_]{3,60}$/,
    hint: "be a model ID such as eleven_flash_v2_5",
  },
  maxCharactersPerDay: {
    name: "ELEVENLABS_MAX_CHARACTERS_PER_DAY",
    required: false,
    default: "5000",
    pattern: /^\d{1,7}$/,
    hint: "be a whole number",
  },
} as const;

/** Formats available on the Free plan. mp3_44100_192 and 44.1 kHz PCM/WAV need paid plans. */
export type SpeechFormat = "mp3_44100_128" | "mp3_44100_64" | "mp3_22050_32" | "opus_48000_64";

const CONTENT_TYPES: Record<SpeechFormat, string> = {
  mp3_44100_128: "audio/mpeg",
  mp3_44100_64: "audio/mpeg",
  mp3_22050_32: "audio/mpeg",
  opus_48000_64: "audio/ogg",
};

export type SpeechAudio = {
  audio: ArrayBuffer;
  contentType: string;
  /** Characters sent, which is what ElevenLabs bills. */
  characters: number;
};

export type SpeakOptions = {
  voiceId?: string;
  modelId?: string;
  format?: SpeechFormat;
  /** ISO 639-1, for models that support it. */
  languageCode?: string;
  voiceSettings?: { stability?: number; similarity_boost?: number; style?: number; speed?: number };
  signal?: AbortSignal;
};

export type TranscriptWord = { text: string; start?: number; end?: number; speaker?: string };
export type Transcript = { text: string; languageCode?: string; words: TranscriptWord[] };

export type TranscribeOptions = {
  modelId?: string;
  /** ISO 639-1 or 639-3. Detected automatically if omitted. */
  languageCode?: string;
  /** Label who is speaking. */
  diarize?: boolean;
  signal?: AbortSignal;
};

export type Voice = { id: string; name: string; category?: string; previewUrl?: string };
export type Usage = { tier?: string; used: number; limit: number; remaining: number; resetsAt?: string };

export type ElevenLabsClient = {
  /** Text to audio, buffered. Costs credits per character. */
  speak(text: string, options?: SpeakOptions): Promise<SpeechAudio>;
  /** Audio or video file to text, with word timings. */
  transcribe(file: Blob, options?: TranscribeOptions): Promise<Transcript>;
  /** Premade voices, which every plan can use through the API. */
  listVoices(options?: { signal?: AbortSignal }): Promise<Voice[]>;
  /** Credits used this period. Needs a key allowed to read the user's subscription. */
  getUsage(options?: { signal?: AbortSignal }): Promise<Usage>;
  /**
   * A 15-minute, single-use token for the browser to talk to ElevenLabs
   * directly (live captions, streaming speech) without seeing the API key.
   */
  createBrowserToken(type: "realtime_scribe" | "tts_websocket"): Promise<string>;
};

const transcriptSchema = z.object({
  text: z.string(),
  language_code: z.string().nullish(),
  words: z
    .array(
      z.object({
        text: z.string(),
        type: z.string().nullish(),
        start: z.number().nullish(),
        end: z.number().nullish(),
        speaker_id: z.string().nullish(),
      }),
    )
    .nullish(),
});

const voicesSchema = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string(),
      name: z.string(),
      category: z.string().nullish(),
      preview_url: z.string().nullish(),
    }),
  ),
});

const subscriptionSchema = z.object({
  tier: z.string().nullish(),
  character_count: z.number(),
  character_limit: z.number(),
  next_character_count_reset_unix: z.number().nullish(),
});

const tokenSchema = z.object({ token: z.string().min(1) });

/** A per-instance daily character allowance, so a loop can't drain the month. */
function createCharacterBudget(limit: number, now: () => number = Date.now) {
  const day = 24 * 60 * 60_000;
  let windowStart = now();
  let used = 0;
  return {
    take(characters: number): number | null {
      const time = now();
      if (time - windowStart >= day) {
        windowStart = time;
        used = 0;
      }
      if (used + characters > limit) return Math.ceil((windowStart + day - time) / 1000);
      used += characters;
      return null;
    },
    refund(characters: number) {
      used = Math.max(0, used - characters);
    },
  };
}

/** Turns ElevenLabs' own error codes into clear kinds and messages. */
function remap(error: unknown): never {
  if (error instanceof IntegrationError && error.upstreamStatus !== undefined) {
    const text = error.message;
    const details = { upstreamStatus: error.upstreamStatus, retryAfterSeconds: error.retryAfterSeconds };
    if (/unusual[_ ]activity|free[_ ]tier[_ ]usage[_ ]disabled/i.test(text)) {
      throw new IntegrationError(NAME, "unauthorized", text, {
        ...details,
        publicMessage:
          "ElevenLabs has paused free-tier use for this account or network. Try another network, or the deployed app.",
      });
    }
    if (/quota_exceeded|insufficient_credits/i.test(text)) {
      throw new IntegrationError(NAME, "quota_exceeded", text, details);
    }
    if (/concurrent_limit_exceeded|too_many_concurrent_requests|system_busy/i.test(text)) {
      throw new IntegrationError(NAME, "rate_limited", text, details);
    }
  }
  throw error;
}

export function createElevenLabsClient(
  config: {
    apiKey: string;
    voiceId?: string;
    modelId?: string;
    maxCharactersPerDay?: number;
    now?: () => number;
  } & Pick<ApiClientOptions, "fetch" | "sleep">,
): ElevenLabsClient {
  const api = createApiClient({
    integration: NAME,
    baseUrl: "https://api.elevenlabs.io",
    headers: { "xi-api-key": config.apiKey },
    secrets: [config.apiKey],
    timeoutMs: 30_000,
    // No per-minute limit is documented; this only stops runaway loops.
    rateLimits: [{ limit: 30, windowMs: 60_000 }],
    maxConcurrent: ELEVENLABS_FREE_TIER.concurrentRequests,
    fetch: config.fetch,
    sleep: config.sleep,
  });
  const budget = createCharacterBudget(config.maxCharactersPerDay ?? 5000, config.now);

  return {
    async speak(text, options = {}) {
      const clean = text.trim();
      if (!clean || clean.length > MAX_SPEECH_CHARACTERS) {
        throw new IntegrationError(
          NAME,
          "bad_request",
          `ElevenLabs: text must be 1 to ${MAX_SPEECH_CHARACTERS} characters`,
        );
      }
      const wait = budget.take(clean.length);
      if (wait !== null) {
        throw new IntegrationError(NAME, "rate_limited", "ElevenLabs: daily character budget used", {
          retryAfterSeconds: wait,
          publicMessage: "Today's speech allowance on this server is used up.",
        });
      }

      const format = options.format ?? "mp3_44100_128";
      try {
        const result = await api.requestBinary({
          method: "POST",
          path: `/v1/text-to-speech/${encodeURIComponent(options.voiceId ?? config.voiceId ?? DEFAULT_VOICE_ID)}`,
          query: { output_format: format },
          body: {
            text: clean,
            model_id: options.modelId ?? config.modelId ?? DEFAULT_TTS_MODEL,
            ...(options.languageCode ? { language_code: options.languageCode } : {}),
            ...(options.voiceSettings ? { voice_settings: options.voiceSettings } : {}),
          },
          accept: "*/*",
          maxBytes: 20 * 1024 * 1024,
          signal: options.signal,
        });
        return {
          audio: result.data,
          contentType: result.contentType.startsWith("audio/") ? result.contentType : CONTENT_TYPES[format],
          characters: clean.length,
        };
      } catch (error) {
        // A definite refusal, or our own limit, generated nothing, so give the budget back.
        const definite = error instanceof IntegrationError && error.kind !== "timeout" && error.kind !== "network" && error.kind !== "cancelled";
        if (definite) budget.refund(clean.length);
        remap(error);
      }
    },

    async transcribe(file, options = {}) {
      if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_AUDIO_UPLOAD_BYTES) {
        throw new IntegrationError(NAME, "bad_request", "ElevenLabs: audio must be between 1 byte and 10 MB");
      }
      if (file.type && !/^(audio|video)\//.test(file.type)) {
        throw new IntegrationError(NAME, "bad_request", "ElevenLabs: only audio or video files can be transcribed");
      }
      const form = new FormData();
      form.set("model_id", options.modelId ?? DEFAULT_STT_MODEL);
      form.set("file", file, file instanceof File ? file.name : "audio");
      if (options.languageCode) form.set("language_code", options.languageCode);
      if (options.diarize) form.set("diarize", "true");
      form.set("tag_audio_events", "false");

      try {
        const result = await api.request({
          method: "POST",
          path: "/v1/speech-to-text",
          body: form,
          schema: transcriptSchema,
          timeoutMs: 120_000,
          signal: options.signal,
        });
        return {
          text: result.text,
          languageCode: result.language_code ?? undefined,
          words: (result.words ?? [])
            .filter((word) => !word.type || word.type === "word")
            .map((word) => ({
              text: word.text,
              start: word.start ?? undefined,
              end: word.end ?? undefined,
              speaker: word.speaker_id ?? undefined,
            })),
        };
      } catch (error) {
        remap(error);
      }
    },

    async listVoices(options = {}) {
      try {
        const result = await api.request({
          path: "/v2/voices",
          query: { category: "premade", page_size: 50 },
          schema: voicesSchema,
          signal: options.signal,
        });
        return result.voices.map((voice) => ({
          id: voice.voice_id,
          name: voice.name,
          category: voice.category ?? undefined,
          previewUrl: voice.preview_url ?? undefined,
        }));
      } catch (error) {
        remap(error);
      }
    },

    async getUsage(options = {}) {
      try {
        const result = await api.request({
          path: "/v1/user/subscription",
          schema: subscriptionSchema,
          signal: options.signal,
        });
        return {
          tier: result.tier ?? undefined,
          used: result.character_count,
          limit: result.character_limit,
          remaining: Math.max(0, result.character_limit - result.character_count),
          resetsAt: result.next_character_count_reset_unix
            ? new Date(result.next_character_count_reset_unix * 1000).toISOString()
            : undefined,
        };
      } catch (error) {
        remap(error);
      }
    },

    async createBrowserToken(type) {
      try {
        const result = await api.request({
          method: "POST",
          path: `/v1/single-use-token/${type}`,
          schema: tokenSchema,
        });
        return result.token;
      } catch (error) {
        remap(error);
      }
    },
  };
}

let cached: { key: string; client: ElevenLabsClient } | undefined;

/**
 * The shared client, so its limits apply across requests. Throws a
 * not_configured IntegrationError while ELEVENLABS_API_KEY is unset.
 */
export function getElevenLabs(env: EnvSource = process.env): ElevenLabsClient {
  const config = readIntegrationEnv(ELEVENLABS_ENV, env);
  if (config.state !== "ready") {
    throw new IntegrationError(NAME, "not_configured", `ElevenLabs is ${config.state}: ${config.reason}`);
  }
  const { apiKey, voiceId, modelId, maxCharactersPerDay } = config.values;
  const key = [apiKey, voiceId, modelId, maxCharactersPerDay].join("|");
  if (cached?.key !== key) {
    cached = {
      key,
      client: createElevenLabsClient({
        apiKey,
        voiceId,
        modelId,
        maxCharactersPerDay: Number(maxCharactersPerDay),
      }),
    };
  }
  return cached.client;
}

export function elevenLabsStatus(env: EnvSource = process.env): IntegrationStatus {
  const config = readIntegrationEnv(ELEVENLABS_ENV, env);
  return {
    id: "elevenlabs",
    name: NAME,
    state: config.state,
    detail:
      config.state === "ready"
        ? `Key is set. Model ${config.values.modelId}, at most ${config.values.maxCharactersPerDay} characters a day on this server.`
        : config.state === "off"
          ? "Off (optional). Set ELEVENLABS_API_KEY to turn it on."
          : config.reason,
    variables: Object.values(ELEVENLABS_ENV).map((spec) => spec.name),
    docs: "https://elevenlabs.io/docs/api-reference",
  };
}
