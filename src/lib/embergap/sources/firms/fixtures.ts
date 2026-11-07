import type { FirmsConfidence, FirmsDetection, FirmsSource } from "./types";

/**
 * SYNTHETIC DEMO DATA. None of these detections happened. They are placed in
 * two demo regions so the map, the investigations and the "missing satellite
 * pass" case can be shown offline and deterministically. Times are relative
 * to `now`, so the demo always looks current and tests stay repeatable.
 */
type FixtureRow = {
  key: string;
  product: FirmsSource;
  satellite: string;
  instrument: string;
  latitude: number;
  longitude: number;
  minutesAgo: number;
  confidence: FirmsConfidence;
  confidenceRaw: string;
  frpMw: number;
  brightnessK: number;
  dayNight: "day" | "night";
};

const ROWS: FixtureRow[] = [
  // Peak District demo region: two adjacent VIIRS pixels from one overpass,
  // near the corroborated synthetic report (demo-inv-ridge).
  {
    key: "pd-ridge-1",
    product: "VIIRS_SNPP_NRT",
    satellite: "N",
    instrument: "VIIRS",
    latitude: 53.4561,
    longitude: -1.8724,
    minutesAgo: 48,
    confidence: "high",
    confidenceRaw: "h",
    frpMw: 6.4,
    brightnessK: 338.2,
    dayNight: "day",
  },
  {
    key: "pd-ridge-2",
    product: "VIIRS_SNPP_NRT",
    satellite: "N",
    instrument: "VIIRS",
    latitude: 53.4549,
    longitude: -1.8767,
    minutesAgo: 48,
    confidence: "nominal",
    confidenceRaw: "n",
    frpMw: 3.1,
    brightnessK: 329.7,
    dayNight: "day",
  },
  // An anomaly with no report attached, to show the map is not report-only.
  {
    key: "pd-moor-night",
    product: "VIIRS_NOAA20_NRT",
    satellite: "1",
    instrument: "VIIRS",
    latitude: 53.5121,
    longitude: -2.0313,
    minutesAgo: 5 * 60 + 12,
    confidence: "low",
    confidenceRaw: "l",
    frpMw: 1.2,
    brightnessK: 301.4,
    dayNight: "night",
  },
  // Sierra foothills demo region: MODIS and VIIRS near the repeated-witness
  // synthetic report (demo-inv-witness).
  {
    key: "sf-valley-modis",
    product: "MODIS_NRT",
    satellite: "Aqua",
    instrument: "MODIS",
    latitude: 38.7471,
    longitude: -121.0552,
    minutesAgo: 3 * 60 + 10,
    confidence: "nominal",
    confidenceRaw: "62",
    frpMw: 14.8,
    brightnessK: 322.5,
    dayNight: "day",
  },
  {
    key: "sf-valley-viirs",
    product: "VIIRS_NOAA20_NRT",
    satellite: "1",
    instrument: "VIIRS",
    latitude: 38.7462,
    longitude: -121.0571,
    minutesAgo: 2 * 60 + 5,
    confidence: "high",
    confidenceRaw: "h",
    frpMw: 9.6,
    brightnessK: 341.0,
    dayNight: "day",
  },
  // Old enough to show as stale.
  {
    key: "sf-ridge-old",
    product: "VIIRS_SNPP_NRT",
    satellite: "N",
    instrument: "VIIRS",
    latitude: 39.1052,
    longitude: -120.4518,
    minutesAgo: 20 * 60 + 30,
    confidence: "nominal",
    confidenceRaw: "n",
    frpMw: 2.2,
    brightnessK: 318.9,
    dayNight: "night",
  },
];

export function demoFirmsDetections(now: Date): FirmsDetection[] {
  const retrievedAt = now.toISOString();
  return ROWS.map((row) => ({
    id: `firms:demo:${row.key}`,
    source: "firms",
    product: row.product,
    satellite: row.satellite,
    instrument: row.instrument,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt: new Date(now.getTime() - row.minutesAgo * 60_000).toISOString(),
    retrievedAt,
    confidence: row.confidence,
    confidenceRaw: row.confidenceRaw,
    frpMw: row.frpMw,
    brightnessK: row.brightnessK,
    dayNight: row.dayNight,
    synthetic: true,
  }));
}
