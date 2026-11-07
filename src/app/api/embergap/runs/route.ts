import { z } from "zod";
import { apiError, apiJson, readBodyText } from "@/features/embergap/api";
import { canRunAgents, getRunState, scheduleInvestigation } from "@/features/embergap/orchestrator";
import { idSchema } from "@/lib/embergap/contracts";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/embergap/runs { investigationId }: restarts the automated
 * assessment of an investigation the caller can see, if its last run was
 * interrupted or failed. A finished or running assessment is left alone, and
 * a restart never duplicates anything (stable ids, idempotent writes).
 * Responds 202 { state } with "scheduled", "running" or "finished".
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ investigationId: idSchema });
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Please sign in.");
  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) return apiError(429, "rate_limited", "Please wait before retrying.", { retryAfterSeconds });

  const text = await readBodyText(request, 1_024);
  if (text === null) return apiError(413, "payload_too_large", "The request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, "validation_failed", "The request body must be JSON.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(400, "validation_failed", "investigationId must be a UUID.");
  const { investigationId } = parsed.data;

  // RLS decides visibility: reporters see their own, reviewers see all.
  const supabase = await createClient();
  const { data: investigation, error } = await supabase
    .from("investigations")
    .select("id, is_synthetic")
    .eq("id", investigationId)
    .maybeSingle();
  if (error) return apiError(503, "unavailable", "Please try again shortly.");
  if (!investigation) return apiError(404, "not_found", "Investigation not found.");
  if (investigation.is_synthetic) {
    return apiError(409, "conflict", "Synthetic demo investigations are seeded with their evidence and are not re-run.");
  }
  if (!canRunAgents()) return apiError(503, "unavailable", "Automated assessment is not configured on this server.");

  try {
    const { state } = await getRunState(investigationId);
    if (state === "finished" || state === "running") return apiJson(202, { state });
  } catch {
    return apiError(503, "unavailable", "Please try again shortly.");
  }
  scheduleInvestigation(investigationId, { onlyIfIncomplete: true });
  return apiJson(202, { state: "scheduled" });
}
