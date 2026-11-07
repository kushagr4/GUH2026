import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Largest viewport for a live FIRMS query, to keep requests and responses
 * small. Parsing itself uses the shared contract's `parseBbox`.
 */
export const MAX_FIRMS_BBOX_SPAN = { lon: 30, lat: 20 } as const;

export function isWithinFirmsSpan(bbox: Bbox): boolean {
  return (
    bbox.maxLongitude - bbox.minLongitude <= MAX_FIRMS_BBOX_SPAN.lon &&
    bbox.maxLatitude - bbox.minLatitude <= MAX_FIRMS_BBOX_SPAN.lat
  );
}

export function bboxContains(bbox: Bbox | null, latitude: number, longitude: number): boolean {
  if (!bbox) return true;
  return (
    longitude >= bbox.minLongitude &&
    longitude <= bbox.maxLongitude &&
    latitude >= bbox.minLatitude &&
    latitude <= bbox.maxLatitude
  );
}

/** The FIRMS AREA_COORDINATES path segment: west,south,east,north. */
export function formatBbox(bbox: Bbox): string {
  return [bbox.minLongitude, bbox.minLatitude, bbox.maxLongitude, bbox.maxLatitude].join(",");
}
