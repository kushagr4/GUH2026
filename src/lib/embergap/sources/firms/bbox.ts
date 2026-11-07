import type { Bbox } from "./types";

/** Largest viewport the map API accepts, to keep FIRMS queries and responses small. */
export const MAX_BBOX_SPAN = { lon: 30, lat: 20 } as const;

export type BboxParseResult =
  | { ok: true; bbox: Bbox }
  | { ok: false; error: string };

/**
 * Parses `minLon,minLat,maxLon,maxLat` (the FIRMS and GeoJSON order). Refuses
 * anything outside the globe, inverted, empty or larger than MAX_BBOX_SPAN.
 * Boxes that cross the antimeridian are not supported.
 */
export function parseBbox(raw: string | null | undefined): BboxParseResult {
  if (!raw) return { ok: false, error: "bbox is required: minLon,minLat,maxLon,maxLat" };
  if (raw.length > 100) return { ok: false, error: "bbox is too long" };

  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => !/^-?\d{1,3}(\.\d{1,7})?$/.test(part))) {
    return { ok: false, error: "bbox must be four numbers: minLon,minLat,maxLon,maxLat" };
  }

  const [minLon, minLat, maxLon, maxLat] = parts.map(Number) as [number, number, number, number];
  if ([minLon, maxLon].some((lon) => lon < -180 || lon > 180)) {
    return { ok: false, error: "bbox longitudes must be between -180 and 180" };
  }
  if ([minLat, maxLat].some((lat) => lat < -90 || lat > 90)) {
    return { ok: false, error: "bbox latitudes must be between -90 and 90" };
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    return { ok: false, error: "bbox minimums must be smaller than its maximums" };
  }
  if (maxLon - minLon > MAX_BBOX_SPAN.lon || maxLat - minLat > MAX_BBOX_SPAN.lat) {
    return {
      ok: false,
      error: `bbox is too large: at most ${MAX_BBOX_SPAN.lon} degrees wide and ${MAX_BBOX_SPAN.lat} tall`,
    };
  }
  return { ok: true, bbox: { minLon, minLat, maxLon, maxLat } };
}

export function bboxContains(bbox: Bbox, latitude: number, longitude: number): boolean {
  return (
    longitude >= bbox.minLon &&
    longitude <= bbox.maxLon &&
    latitude >= bbox.minLat &&
    latitude <= bbox.maxLat
  );
}

/** The FIRMS AREA_COORDINATES path segment: west,south,east,north. */
export function formatBbox(bbox: Bbox): string {
  return [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].join(",");
}
