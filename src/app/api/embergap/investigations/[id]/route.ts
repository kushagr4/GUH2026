import { NextResponse, type NextRequest } from "next/server";
import { getInvestigationForUser } from "@/lib/embergap/read/investigations";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(status: number, error: string, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * GET /api/embergap/investigations/[id]
 * The investigation, its source-attributed findings, gaps and activity, if the
 * caller may see it. Anything else is 404, so ids can't be probed.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/embergap/investigations/[id]">,
) {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "Please sign in.");

  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) {
    return errorResponse(429, "Too many requests. Please wait a moment.", {
      "Retry-After": String(retryAfterSeconds),
    });
  }

  const { id } = await ctx.params;
  try {
    const investigation = await getInvestigationForUser(id, user);
    if (!investigation) return errorResponse(404, "Investigation not found.");
    return NextResponse.json(investigation, { headers: NO_STORE });
  } catch (error) {
    console.error("[embergap] investigation read failed", error);
    return errorResponse(500, "The investigation could not be loaded.");
  }
}
