/**
 * A small result type for repository functions, so callers handle failure
 * explicitly and raw database errors never reach the UI.
 */
export type DbErrorKind =
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "validation"
  | "unavailable"
  | "unknown";

export type DbError = {
  kind: DbErrorKind;
  /** Safe to show to a user. */
  message: string;
  /** Original code, for logs and tests. */
  code?: string;
};

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: DbError };

type PostgrestLikeError = {
  code?: string;
  message?: string;
};

const MESSAGES: Record<DbErrorKind, string> = {
  not_found: "That record could not be found.",
  unauthorized: "Please sign in again.",
  forbidden: "You do not have access to that.",
  conflict: "That already exists.",
  validation: "That value is not valid.",
  unavailable: "The database is unavailable. Please try again shortly.",
  unknown: "Something went wrong. Please try again.",
};

export function classifyDbError(code: string | undefined): DbErrorKind {
  switch (code) {
    case "PGRST116":
      return "not_found";
    case "PGRST301":
    case "PGRST302":
    case "PGRST303":
      return "unauthorized";
    case "42501":
      return "forbidden";
    case "23505":
      return "conflict";
    case "22001":
    case "22P02":
    case "23502":
    case "23503":
    case "23514":
      return "validation";
    case "PGRST000":
    case "PGRST001":
    case "PGRST002":
    case "57P01":
      return "unavailable";
    default:
      return "unknown";
  }
}

export function toDbError(error: PostgrestLikeError): DbError {
  const kind = classifyDbError(error.code);
  return { kind, message: MESSAGES[kind], code: error.code };
}

/** Converts a supabase-js `{ data, error }` response. */
export function fromPostgrest<T>(response: {
  data: T | null;
  error: PostgrestLikeError | null;
}): DbResult<T> {
  if (response.error) return { ok: false, error: toDbError(response.error) };
  if (response.data === null) {
    return {
      ok: false,
      error: { kind: "not_found", message: MESSAGES.not_found },
    };
  }
  return { ok: true, data: response.data };
}
