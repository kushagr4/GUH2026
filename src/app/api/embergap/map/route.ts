import { NextResponse, type NextRequest } from "next/server";
import { parseBbox } from "@/lib/embergap/sources/firms/bbox";
import { getMapData, parseLimit } from "@/lib/embergap/read/map";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";

// A map refetches on every viewport change, so this is generous, but it still
// stops a scraper walking the whole globe.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(status: number, error: string, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * GET /api/embergap/map?bbox=minLon,minLat,maxLon,maxLat&limit=50
 * Read-only, signed-in, viewport-bounded public-safe map features.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "Please sign in.");

  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) {
    return errorResponse(429, "Too many map requests. Please wait a moment.", {
      "Retry-After": String(retryAfterSeconds),
    });
  }

  const params = request.nextUrl.searchParams;
  const bbox = parseBbox(params.get("bbox"));
  if (!bbox.ok) return errorResponse(400, bbox.error);
  const limit = parseLimit(params.get("limit"));
  if (!limit.ok) return errorResponse(400, limit.error);

  try {
    const data = await getMapData({ bbox: bbox.bbox, limit: limit.limit, signal: request.signal });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    console.error("[embergap] map read failed", error);
    return errorResponse(500, "The map could not be loaded.");
  }
}
