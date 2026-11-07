import type { z } from "zod";
import type { Bbox, SourceAvailability, Timestamp, firmsEvidenceSchema } from "@/lib/embergap/contracts";

/**
 * FIRMS adapter types (Outrolife). Shared shapes come from
 * `@/lib/embergap/contracts`; only adapter-internal types live here.
 *
 * A FIRMS detection is a satellite thermal anomaly, NOT a confirmed fire. No
 * detection is NOT evidence that there is no fire.
 */

/** FIRMS area API sources, as listed at firms.modaps.eosdis.nasa.gov/api/area (7 Nov 2026). */
export const FIRMS_SOURCES = [
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "MODIS_NRT",
  "LANDSAT_NRT",
] as const;

export type FirmsSource = (typeof FIRMS_SOURCES)[number];

export type FirmsEvidence = z.infer<typeof firmsEvidenceSchema>;

/** One detection, ready to become a map feature or an observation. */
export type FirmsDetection = {
  /** stableId(...) for real rows, syntheticId(...) for fixtures. */
  id: string;
  product: FirmsSource;
  latitude: number;
  longitude: number;
  observedAt: Timestamp;
  retrievedAt: Timestamp;
  evidence: FirmsEvidence;
  isSynthetic: boolean;
};

export type FirmsResult = {
  product: FirmsSource;
  dayRange: number;
  detections: FirmsDetection[];
  /** Contract-shaped health of the source for this query. */
  availability: SourceAvailability;
};

export type { Bbox };
