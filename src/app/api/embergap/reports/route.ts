import { z } from "zod";
import { apiError, apiErrorFromDb, apiJson, readBodyText } from "@/features/embergap/api";
import { scheduleInvestigation } from "@/features/embergap/orchestrator";
import { MISSING_SCHEMA_CODES } from "@/features/embergap/status";
import { submitReport } from "@/features/embergap/submit";
import { reportSubmissionRequestSchema, reportSubmissionResponseSchema } from "@/lib/embergap/contracts";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/embergap/reports: an authenticated reporter submits an unverified
 * report. Contract: reportSubmissionRequestSchema in, reportSubmissionResponseSchema
 * out (201 new, 200 replay), apiErrorResponseSchema on failure.
 */
export const dynamic = "force-dynamic";
// Covers the agent run scheduled with after() (orchestrator RUN_BUDGET_MS is 45 s).
export const maxDuration = 60;

const MAX_BODY_BYTES = 16 * 1024;

// Per server instance. The database's per-reporter unique key is the backstop.
const perMinute = createRateLimiter({ limit: 5, windowMs: 60_000 });
const perHour = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Please sign in to submit a report.");

  for (const limiter of [perMinute, perHour]) {
    const { allowed, retryAfterSeconds } = limiter.check(user.id);
    if (!allowed) {
      return apiError(
        429,
        "rate_limited",
        "You've sent several reports in a short time. Please wait before sending another.",
        { retryAfterSeconds },
        { "Retry-After": String(retryAfterSeconds) },
      );
    }
  }

  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (text === null) return apiError(413, "payload_too_large", "The report is too large.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, "validation_failed", "The request body must be JSON.");
  }

  const parsed = reportSubmissionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const { formErrors, fieldErrors } = z.flattenError(parsed.error);
    return apiError(400, "validation_failed", formErrors[0] ?? "Some fields need attention.", {
      fieldErrors: Object.fromEntries(
        Object.entries(fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])),
      ),
    });
  }

  const result = await submitReport(await createClient(), user.id, parsed.data);
  if (!result.ok) {
    if (result.reason === "media_invalid") return apiError(400, "media_invalid", result.message);
    if (MISSING_SCHEMA_CODES.has(result.error.code ?? "")) {
      // The hosted project doesn't have the EmberGap tables yet: say so plainly.
      console.error("embergap: report submission failed: the EmberGap migrations are not applied to this Supabase project (npm run db:push)", { code: result.error.code });
      return apiError(503, "unavailable", "Reports can't be saved yet: the database is still being set up. Please try again later.");
    }
    if (result.error.kind === "unknown" || result.error.kind === "unavailable") {
      console.error("embergap: report submission failed", { kind: result.error.kind, code: result.error.code });
    }
    return apiErrorFromDb(result.error);
  }

  const response = reportSubmissionResponseSchema.parse({ ...result.data, verification: "unverified" });
  // A replay restarts the agents only if the first run never finished (for
  // example, Vercel cut it short). Runs are idempotent either way.
  scheduleInvestigation(result.data.investigationId, { onlyIfIncomplete: result.data.replayed });
  return apiJson(result.data.replayed ? 200 : 201, response);
}
