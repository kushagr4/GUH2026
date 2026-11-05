import type { z } from "zod";

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiRequest = {
  messages: AiMessage[];
  system?: string;
  signal?: AbortSignal;
};

export type AiErrorKind =
  | "auth"
  | "rate_limited"
  | "unavailable"
  | "refused"
  | "invalid_output"
  | "bad_request"
  | "unknown";

const STATUS_BY_KIND: Record<AiErrorKind, number> = {
  auth: 503,
  rate_limited: 429,
  unavailable: 503,
  refused: 422,
  invalid_output: 502,
  bad_request: 400,
  unknown: 502,
};

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = STATUS_BY_KIND[kind];
  }
}

/** The small surface the app depends on, so providers can be swapped on the day. */
export interface AiProvider {
  readonly id: string;
  readonly model: string;
  streamText(request: AiRequest): AsyncIterable<string>;
  generateText(request: AiRequest): Promise<string>;
  generateObject<Schema extends z.ZodType>(
    request: AiRequest,
    schema: Schema,
  ): Promise<z.infer<Schema>>;
}
