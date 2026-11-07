// Pure EONET helpers: the request box, the response schema, and matching
// records to a point and date window. No network, so they are unit-tested
// directly and safe to load in the runtime's worker threads.
import { z } from "zod";
import { haversineKm } from "../../agents/runtime/geo";
import type { EonetEventRecord, EonetGeometry, EonetMatch, EonetQuery } from "./types";

const KM_PER_DEGREE = 111.32;

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * EONET's bbox parameter, in ITS order: min_lon,max_lat,max_lon,min_lat (the
 * upper-left corner, then the lower-right). Not the GeoJSON order. The box is
 * padded to the radius; near the antimeridian it is clamped, which can miss
 * records across the date line (a documented limitation).
 */
export function eonetBbox(query: Pick<EonetQuery, "latitude" | "longitude" | "radiusKm">): string {
  const dLat = query.radiusKm / KM_PER_DEGREE;
  const cos = Math.max(0.01, Math.cos((query.latitude * Math.PI) / 180));
  const dLon = query.radiusKm / (KM_PER_DEGREE * cos);
  const minLon = Math.max(-180, query.longitude - dLon);
  const maxLon = Math.min(180, query.longitude + dLon);
  const minLat = Math.max(-90, query.latitude - dLat);
  const maxLat = Math.min(90, query.latitude + dLat);
  return [minLon, maxLat, maxLon, minLat].map(round4).join(",");
}

/** A window around an observation (60 days back, 1 ahead), as inclusive UTC dates for EONET. */
export function eonetWindow(observedAtIso: string, options: { daysBefore?: number; daysAfter?: number } = {}) {
  const at = Date.parse(observedAtIso);
  if (!Number.isFinite(at)) throw new RangeError("observedAt must be an ISO 8601 time");
  const dayMs = 86_400_000;
  const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // EONET only matches records whose own date falls in the window, so look well back.
  return { start: toDay(at - (options.daysBefore ?? 60) * dayMs), end: toDay(at + (options.daysAfter ?? 1) * dayMs) };
}

/** Checks dates for real: EONET answers 200 even to nonsense, so we must. */
export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// The live response, as checked on 7 Nov 2026. Unknown keys are ignored, and
// fields EONET may render as null are nullable.
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const rawGeometrySchema = z.object({
  magnitudeValue: z.number().nullable().optional(),
  magnitudeUnit: z.string().nullable().optional(),
  date: z.string().max(40),
  type: z.string().max(40),
  coordinates: z.unknown(),
});
const rawEventSchema = z.object({
  id: z.string().regex(/^EONET_\d{1,10}$/),
  title: z.string().max(300),
  description: z.string().max(1000).nullable().optional(),
  link: z.string().max(300),
  closed: z.string().max(40).nullable().optional(),
  categories: z.array(z.object({ id: z.string().max(60) })).max(20),
  sources: z.array(z.object({ id: z.string().max(60), url: z.string().max(500) })).max(20),
  geometry: z.array(rawGeometrySchema).max(200),
});
export const eonetResponseSchema = z.object({ events: z.array(rawEventSchema).max(1000) });
export type EonetResponse = z.infer<typeof eonetResponseSchema>;

function toGeometry(raw: z.infer<typeof rawGeometrySchema>): EonetGeometry | null {
  if (!Number.isFinite(Date.parse(raw.date))) return null;
  const magnitude =
    typeof raw.magnitudeValue === "number" && typeof raw.magnitudeUnit === "string"
      ? { value: raw.magnitudeValue, unit: raw.magnitudeUnit }
      : null;
  if (raw.type === "Point") {
    const point = position.safeParse(raw.coordinates);
    if (!point.success) return null;
    return { date: raw.date, shape: "point", longitude: point.data[0], latitude: point.data[1], magnitude };
  }
  if (raw.type === "Polygon") {
    // [[[lon, lat], ...], ...holes]: use the centre of the outer ring.
    const ring = z.array(z.array(position).min(3)).min(1).safeParse(raw.coordinates);
    if (!ring.success) return null;
    const outer = ring.data[0];
    const latitude = outer.reduce((sum, point) => sum + point[1], 0) / outer.length;
    const longitude = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
    return { date: raw.date, shape: "polygon", latitude, longitude, magnitude };
  }
  return null;
}

/** Keeps wildfire records with at least one usable geometry. */
export function toEventRecords(response: EonetResponse): EonetEventRecord[] {
  const records: EonetEventRecord[] = [];
  for (const raw of response.events) {
    if (!raw.categories.some((category) => category.id === "wildfires")) continue;
    const geometry = raw.geometry.map(toGeometry).filter((item): item is EonetGeometry => item !== null);
    if (geometry.length === 0) continue;
    records.push({
      id: raw.id,
      title: raw.title,
      description: raw.description ?? null,
      link: raw.link,
      closedAt: raw.closed ?? null,
      prescribedBurnLikely: /\bRx\b/i.test(raw.title),
      sources: raw.sources,
      geometry,
    });
  }
  return records;
}

/**
 * Records with a geometry inside the radius and the date window, nearest first.
 * The date check is ours because EONET's start/end semantics are undocumented.
 */
export function matchEvents(records: readonly EonetEventRecord[], query: EonetQuery): EonetMatch[] {
  const startMs = Date.parse(`${query.start}T00:00:00Z`);
  const endMs = Date.parse(`${query.end}T23:59:59.999Z`);
  const matches: EonetMatch[] = [];
  for (const event of records) {
    let best: { distanceKm: number; date: string } | null = null;
    for (const geometry of event.geometry) {
      const at = Date.parse(geometry.date);
      if (at < startMs || at > endMs) continue;
      const distanceKm = haversineKm(query.latitude, query.longitude, geometry.latitude, geometry.longitude);
      if (distanceKm <= query.radiusKm && (!best || distanceKm < best.distanceKm)) best = { distanceKm, date: geometry.date };
    }
    if (best) matches.push({ event, distanceKm: Math.round(best.distanceKm * 100) / 100, nearestGeometryDate: best.date });
  }
  return matches.sort((a, b) => a.distanceKm - b.distanceKm || (a.event.id < b.event.id ? -1 : 1));
}
