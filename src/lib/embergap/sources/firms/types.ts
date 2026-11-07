/**
 * NASA FIRMS thermal-anomaly types, owned by the Outrolife workstream.
 *
 * PROVISIONAL: these shapes stay local until Claude Mac's canonical
 * `src/lib/embergap/contracts.ts` lands. Then they should import or map to the
 * shared `Observation` and `SourceState` types rather than keep a second copy.
 *
 * A FIRMS detection is a satellite thermal anomaly, NOT a confirmed fire. No
 * detection is NOT evidence that there is no fire: clouds, smoke, the time of
 * the last overpass and small or low-intensity fires all cause gaps.
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

/** Same vocabulary as the architecture doc's SourceState. */
export type SourceState = "available" | "stale" | "unavailable" | "not_observed";

/** "demo" is labelled synthetic data. "live" is a real FIRMS query. */
export type DataMode = "demo" | "live";

/** West, south, east, north in degrees, the order FIRMS uses. */
export type Bbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type FirmsConfidence = "low" | "nominal" | "high";

export type FirmsDetection = {
  /** Stable for the same pixel and overpass, so repeated fetches deduplicate. */
  id: string;
  source: "firms";
  product: FirmsSource;
  satellite: string | null;
  instrument: string | null;
  latitude: number;
  longitude: number;
  /** When the satellite observed the pixel (UTC ISO). */
  observedAt: string;
  /** When we fetched it (UTC ISO). */
  retrievedAt: string;
  /**
   * The product's own detection-confidence class. It is instrument-specific
   * and NOT a calibrated probability that a fire exists.
   */
  confidence: FirmsConfidence | null;
  /** As FIRMS sent it, for audit: "l"/"n"/"h" for VIIRS, 0-100 for MODIS. */
  confidenceRaw: string | null;
  /** Fire radiative power in megawatts, when reported. */
  frpMw: number | null;
  /** Brightness temperature in kelvin (VIIRS I-4 or MODIS channel 21/22). */
  brightnessK: number | null;
  dayNight: "day" | "night" | null;
  /** True for the labelled synthetic demo fixtures. */
  synthetic: boolean;
};

export type FirmsResult = {
  mode: DataMode;
  /**
   * available: the query worked and found detections.
   * not_observed: the query worked and found none. Unknown, not negative.
   * unavailable: not configured, or the request failed. Nothing is known.
   */
  sourceState: SourceState;
  product: FirmsSource;
  bbox: Bbox;
  /** How many days back the query covered. */
  dayRange: number;
  retrievedAt: string | null;
  detections: FirmsDetection[];
  /** Plain-language limits to show next to the data. */
  limitations: string[];
  /** Safe to show users. Never contains a key or an upstream body. */
  error?: string;
};

/** Shown with every FIRMS result, whatever its state. */
export const FIRMS_LIMITATIONS = [
  "Thermal anomalies are satellite observations, not confirmed fires.",
  "No detection does not mean no fire: cloud, smoke, overpass timing and small fires all cause gaps.",
  "Near-real-time detections can arrive hours after the overpass.",
] as const;
