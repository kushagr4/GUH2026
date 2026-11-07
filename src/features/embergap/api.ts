import { NextResponse } from "next/server";
import type { DbError, DbErrorKind } from "@/lib/db/result";
import type { ApiErrorCode, ApiErrorResponse } from "@/lib/embergap/contracts";

/**
 * JSON helpers shared by every EmberGap route, so all of them return the
 * contract's `{ error: { code, message } }` shape and never cache private data.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export function apiJson<T>(status: number, body: T, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Omit<ApiErrorResponse["error"], "code" | "message"> = {},
  headers?: Record<string, string>,
) {
  const body: ApiErrorResponse = { error: { code, message, ...extra } };
  return apiJson(status, body, headers);
}

const FROM_DB: Record<DbErrorKind, [number, ApiErrorCode]> = {
  not_found: [404, "not_found"],
  unauthorized: [401, "unauthorized"],
  forbidden: [403, "forbidden"],
  conflict: [409, "conflict"],
  validation: [400, "validation_failed"],
  unavailable: [503, "unavailable"],
  unknown: [500, "internal"],
};

/** Maps a repository error to a response. `DbError.message` is already user-safe. */
export function apiErrorFromDb(error: DbError) {
  const [status, code] = FROM_DB[error.kind];
  return apiError(status, code, error.message);
}

/**
 * Reads at most `maxBytes` of the body, so an oversized or endless upload is
 * cut off instead of being buffered. Returns null if the body is too large.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
