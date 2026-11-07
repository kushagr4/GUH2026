import { NextResponse, type NextRequest } from "next/server";
import { investigationDetailResponseSchema } from "@/lib/embergap/contracts";
import { apiError, NO_STORE } from "@/lib/embergap/read/api-errors";
import { getInvestigationDetail } from "@/lib/embergap/read/investigations";
import { getReadRepository } from "@/lib/embergap/read/repository";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * GET /api/embergap/investigations/[id]
 * investigationDetailResponseSchema for an investigation the caller may see.
 * Anything else is 404, so IDs can't be probed.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/embergap/investigations/[id]">,
) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Please sign in.");

  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) {
    return apiError(429, "rate_limited", "Too many requests. Please wait a moment.", { retryAfterSeconds });
  }

  const { id } = await ctx.params;
  try {
    const lookup = await getInvestigationDetail(id, await getReadRepository());
    if (lookup.kind === "not_found") return apiError(404, "not_found", "Investigation not found.");
    if (lookup.kind === "error") return apiError(503, "unavailable", "The investigation is unavailable. Try again shortly.");

    const checked = investigationDetailResponseSchema.safeParse(lookup.data);
    if (!checked.success) {
      console.error("[embergap] investigation response broke the contract", checked.error.issues.slice(0, 5));
      return apiError(500, "internal", "The investigation could not be loaded.");
    }
    return NextResponse.json(checked.data, { headers: NO_STORE });
  } catch (error) {
    console.error("[embergap] investigation read failed", error);
    return apiError(503, "unavailable", "The investigation is unavailable. Try again shortly.");
  }
}
