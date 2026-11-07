import { NextResponse, type NextRequest } from "next/server";
import { mapQuerySchema, mapResponseSchema } from "@/lib/embergap/contracts";
import { MAX_FIRMS_BBOX_SPAN, isWithinFirmsSpan } from "@/lib/embergap/sources/firms/bbox";
import { apiError, NO_STORE } from "@/lib/embergap/read/api-errors";
import { getMapData } from "@/lib/embergap/read/map";
import { getReadRepository } from "@/lib/embergap/read/repository";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";

// A map refetches on every viewport change, so this is generous, but it still
// stops a scraper walking the whole globe.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * GET /api/embergap/map?bbox=minLon,minLat,maxLon,maxLat&limit=50
 * Read-only, signed-in, viewport-bounded public-safe map features
 * (mapResponseSchema from the shared contracts).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Please sign in.");

  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) {
    return apiError(429, "rate_limited", "Too many map requests. Please wait a moment.", { retryAfterSeconds });
  }

  const params = request.nextUrl.searchParams;
  const query = mapQuerySchema.safeParse({
    bbox: params.get("bbox") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!query.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of query.error.issues) {
      const field = String(issue.path[0] ?? "query");
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return apiError(400, "validation_failed", "Check bbox and limit.", { fieldErrors });
  }
  if (query.data.bbox && !isWithinFirmsSpan(query.data.bbox)) {
    return apiError(400, "validation_failed", "That area is too large.", {
      fieldErrors: {
        bbox: [`At most ${MAX_FIRMS_BBOX_SPAN.lon} degrees wide and ${MAX_FIRMS_BBOX_SPAN.lat} tall.`],
      },
    });
  }

  try {
    const data = await getMapData(query.data, { repository: await getReadRepository(), signal: request.signal });
    const checked = mapResponseSchema.safeParse(data);
    if (!checked.success) {
      console.error("[embergap] map response broke the contract", checked.error.issues.slice(0, 5));
      return apiError(500, "internal", "The map could not be loaded.");
    }
    return NextResponse.json(checked.data, { headers: NO_STORE });
  } catch (error) {
    console.error("[embergap] map read failed", error);
    return apiError(503, "unavailable", "The map is unavailable. Try again shortly.");
  }
}
