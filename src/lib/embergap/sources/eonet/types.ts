// NASA EONET v3 wildfire context: normalised, source-specific types.
//
// EONET records are CURATED EVENT METADATA copied from agencies such as IRWIN
// (US) and GDACS, not sensor observations. Only fires of about 500 acres or more
// are ingested, the collection is not exhaustive, latency is undocumented, and
// `closed: null` does not mean a fire is still burning. So an empty result means
// "no EONET record", never "no fire". Checked 7 Nov 2026 against
// https://eonet.gsfc.nasa.gov/docs/v3 and https://eonet.gsfc.nasa.gov/event-curation
//
// The canonical shapes other workstreams consume are Observation and
// SourceAvailability from @/lib/embergap/contracts (see ./observations.ts).
import { z } from "zod";
import { provenanceSchema, type Provenance } from "@/lib/embergap/contracts";

export function eonetProvenance(isSynthetic: boolean): Provenance {
  return {
    provider: "NASA EONET",
    product: isSynthetic ? "events v3 (synthetic fixture)" : "events v3",
    url: "https://eonet.gsfc.nasa.gov/docs/v3",
    license: null,
    isSynthetic,
  };
}

/** Caveats every consumer must show alongside EONET context. */
export const EONET_LIMITATIONS = [
  "EONET is a curated, non-exhaustive record of larger events; it is not a live fire detection feed.",
  "Wildfires are only recorded once they reach about 500 acres, and ingestion delay is undocumented.",
  "No matching EONET record does not mean there is no fire.",
  "A record without a closed date is not evidence that a fire is still burning.",
  "EONET times of day are unreliable; dates are compared at day precision.",
  "The wildfires category includes prescribed burns (titles with Rx).",
] as const;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const eonetQuerySchema = z.object({
  latitude,
  longitude,
  /** Search radius around the point, in kilometres. */
  radiusKm: z.number().min(1).max(500),
  /** Inclusive UTC dates, YYYY-MM-DD. */
  start: day,
  end: day,
  limit: z.number().int().min(1).max(100),
});
export type EonetQuery = z.infer<typeof eonetQuerySchema>;

export const eonetGeometrySchema = z.object({
  /** UTC ISO 8601. Meaning (ignition, discovery or report time) is undocumented. */
  date: z.string().max(40),
  shape: z.enum(["point", "polygon"]),
  /** The point, or the centre of the polygon's outer ring. */
  latitude,
  longitude,
  magnitude: z.object({ value: z.number(), unit: z.string().max(40) }).nullable(),
});
export type EonetGeometry = z.infer<typeof eonetGeometrySchema>;

export const eonetEventRecordSchema = z.object({
  id: z.string().regex(/^EONET_\d{1,10}$/),
  title: z.string().max(300),
  description: z.string().max(1000).nullable(),
  /** EONET's own API link for the event: the stable reference to cite. */
  link: z.string().max(300),
  /** Set when EONET closes the event. Null does not mean "still burning". */
  closedAt: z.string().max(40).nullable(),
  /** The title marks it as a prescribed (Rx) burn. Never present it as an uncontrolled fire. */
  prescribedBurnLikely: z.boolean(),
  sources: z.array(z.object({ id: z.string().max(60), url: z.string().max(500) })).max(20),
  geometry: z.array(eonetGeometrySchema).min(1).max(200),
});
export type EonetEventRecord = z.infer<typeof eonetEventRecordSchema>;

export const eonetMatchSchema = z.object({
  event: eonetEventRecordSchema,
  /** Distance from the query point to the event's nearest geometry, in km. */
  distanceKm: z.number().nonnegative(),
  /** Date of that nearest geometry. */
  nearestGeometryDate: z.string().max(40),
});
export type EonetMatch = z.infer<typeof eonetMatchSchema>;

/**
 * What the EONET adapter returns. It never throws for an upstream failure:
 * - `available`: EONET answered and at least one record matched.
 * - `not_observed`: EONET answered and no record matched. Unknown, not negative.
 * - `unavailable`: EONET could not be read; `error` says why, safely.
 */
export const eonetContextSchema = z.object({
  source: z.literal("eonet"),
  query: eonetQuerySchema,
  sourceState: z.enum(["available", "not_observed", "unavailable"]),
  /** When this server got the data, UTC ISO 8601. */
  retrievedAt: z.string().max(40),
  /** Served from this server's cache rather than a fresh request. */
  fromCache: z.boolean(),
  /** Records in the padded search box, before the radius and date filter. */
  recordsInBox: z.number().int().nonnegative(),
  /** Records within the radius and dates, nearest first. */
  matches: z.array(eonetMatchSchema).max(100),
  /** EONET returned as many records as the limit, so some may be missing. */
  possiblyTruncated: z.boolean(),
  limitations: z.array(z.string().max(300)).max(10),
  provenance: provenanceSchema,
  error: z.object({ kind: z.string().max(40), message: z.string().max(300) }).optional(),
});
export type EonetContext = z.infer<typeof eonetContextSchema>;
