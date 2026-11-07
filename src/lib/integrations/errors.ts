import "server-only";
import { NextResponse } from "next/server";

export type IntegrationErrorKind =
  | "not_configured"
  | "bad_request"
  | "not_found"
  | "unauthorized"
  | "quota_exceeded"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "upstream"
  | "invalid_response"
  | "network";

/**
 * The status our own API returns. A rejected key or an empty credit balance is
 * the server's problem, not the caller's, so those become 503 rather than 401/402.
 */
const STATUS_BY_KIND: Record<IntegrationErrorKind, number> = {
  not_configured: 503,
  bad_request: 400,
  not_found: 404,
  unauthorized: 503,
  quota_exceeded: 503,
  rate_limited: 429,
  timeout: 504,
  cancelled: 499,
  upstream: 502,
  invalid_response: 502,
  network: 502,
};

const USER_MESSAGES: Record<IntegrationErrorKind, (name: string, wait?: number) => string> = {
  not_configured: (name) => `${name} is not set up on this server.`,
  bad_request: (name) => `${name} could not handle that request. Check the input and try again.`,
  not_found: (name) => `${name} could not find that.`,
  unauthorized: (name) => `${name} rejected this server's credentials.`,
  quota_exceeded: (name) => `${name} has run out of free usage for now.`,
  rate_limited: (name, wait) =>
    `${name} is busy. Try again${wait ? ` in ${wait} second${wait === 1 ? "" : "s"}` : " shortly"}.`,
  timeout: (name) => `${name} took too long to respond.`,
  cancelled: () => "The request was cancelled.",
  upstream: (name) => `${name} is having problems. Try again shortly.`,
  invalid_response: (name) => `${name} returned something unexpected.`,
  network: (name) => `Could not reach ${name}.`,
};

export class IntegrationError extends Error {
  readonly integration: string;
  readonly kind: IntegrationErrorKind;
  /** The status to return from our own API. */
  readonly status: number;
  /** The status the external service returned, when there was one. */
  readonly upstreamStatus?: number;
  readonly retryAfterSeconds?: number;

  /**
   * `message` is for server logs. It must never contain a key or token: the
   * HTTP client scrubs known secrets, but don't add any yourself.
   */
  constructor(
    integration: string,
    kind: IntegrationErrorKind,
    message: string,
    details: { upstreamStatus?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "IntegrationError";
    this.integration = integration;
    this.kind = kind;
    this.status = STATUS_BY_KIND[kind];
    this.upstreamStatus = details.upstreamStatus;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }

  /** Safe to show to users: no keys, no upstream bodies, no internals. */
  get userMessage(): string {
    return USER_MESSAGES[this.kind](this.integration, this.retryAfterSeconds);
  }
}

export function isIntegrationError(error: unknown): error is IntegrationError {
  return error instanceof IntegrationError;
}

/** For Server Actions: a message that is always safe to return to the browser. */
export function integrationErrorMessage(error: unknown): string {
  if (error instanceof IntegrationError) return error.userMessage;
  console.error("[integrations] unexpected error", error);
  return "Something went wrong. Please try again.";
}

/** For route handlers: the right status, a safe message and Retry-After when known. */
export function integrationErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof IntegrationError)) {
    console.error("[integrations] unexpected error", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
  return NextResponse.json(
    { error: error.userMessage, kind: error.kind },
    {
      status: error.status,
      headers: error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined,
    },
  );
}
