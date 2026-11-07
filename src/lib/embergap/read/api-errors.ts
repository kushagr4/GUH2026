import "server-only";
import { NextResponse } from "next/server";
import type { ApiErrorCode, ApiErrorResponse } from "@/lib/embergap/contracts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The shared EmberGap error body: { error: { code, message } }. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: { retryAfterSeconds?: number; fieldErrors?: Record<string, string[]> } = {},
): NextResponse<ApiErrorResponse> {
  const headers: Record<string, string> = { ...NO_STORE };
  if (extra.retryAfterSeconds) headers["Retry-After"] = String(extra.retryAfterSeconds);
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers });
}
