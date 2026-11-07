import { SYNTHETIC_NOW, syntheticId } from "@/lib/embergap/contracts";
import type { FirmsDetection, FirmsEvidence, FirmsSource } from "./types";

/**
 * SYNTHETIC DEMO DATA. None of these detections happened. They sit next to
 * the shared SYNTHETIC_SCENARIOS from the contracts, at fixed times before
 * SYNTHETIC_NOW, so the demo and the tests are deterministic:
 *
 * - corroborated-smoke: two adjacent VIIRS pixels 13 minutes before the report
 * - weather-timeout: one MODIS detection before the report
 * - repeated-witness: one VIIRS detection before the reports
 * - partition-recovery: one VIIRS detection before the report
 * - missing-satellite-pass and misleading-photo: deliberately none nearby
 * - one unlinked night detection, old enough to be stale
 * - Campania wine country (the default map view): unlinked detections on the
 *   Vesuvius vineyard slopes, in Irpinia and in the Sannio
 */
type Row = {
  key: string;
  product: FirmsSource;
  latitude: number;
  longitude: number;
  observedAt: string;
  evidence: Omit<FirmsEvidence, "distanceKm">;
};

const VIIRS = { instrument: "VIIRS", version: "2.0NRT", scanKm: 0.39, trackKm: 0.36 } as const;

const ROWS: Row[] = [
  {
    key: "corroborated-smoke/detection-1",
    product: "VIIRS_SNPP_NRT",
    latitude: 53.5491,
    longitude: -1.9772,
    observedAt: "2026-11-07T08:52:00.000Z",
    evidence: { ...VIIRS, satellite: "N", confidence: "high", frpMegawatts: 6.4, brightnessKelvin: 338.2, dayNight: "day" },
  },
  {
    key: "corroborated-smoke/detection-2",
    product: "VIIRS_SNPP_NRT",
    latitude: 53.5482,
    longitude: -1.9809,
    observedAt: "2026-11-07T08:52:00.000Z",
    evidence: { ...VIIRS, satellite: "N", confidence: "nominal", frpMegawatts: 3.1, brightnessKelvin: 329.7, dayNight: "day" },
  },
  {
    key: "weather-timeout/detection-1",
    product: "MODIS_NRT",
    latitude: 53.6043,
    longitude: -1.9268,
    observedAt: "2026-11-07T10:31:00.000Z",
    evidence: {
      instrument: "MODIS",
      satellite: "Terra",
      confidence: 64,
      frpMegawatts: 12.2,
      brightnessKelvin: 321.4,
      dayNight: "day",
      version: "6.1NRT",
      scanKm: 1.1,
      trackKm: 1.0,
    },
  },
  {
    key: "repeated-witness/detection-1",
    product: "VIIRS_NOAA20_NRT",
    latitude: 53.9152,
    longitude: -1.8287,
    observedAt: "2026-11-07T11:02:00.000Z",
    evidence: { ...VIIRS, satellite: "1", confidence: "nominal", frpMegawatts: 2.7, brightnessKelvin: 327.9, dayNight: "day" },
  },
  {
    key: "partition-recovery/detection-1",
    product: "VIIRS_NOAA21_NRT",
    latitude: 53.4641,
    longitude: -1.8496,
    observedAt: "2026-11-07T11:38:00.000Z",
    evidence: { ...VIIRS, satellite: "2", confidence: "high", frpMegawatts: 9.6, brightnessKelvin: 341.0, dayNight: "day" },
  },
  {
    key: "unlinked/night-detection",
    product: "VIIRS_NOAA20_NRT",
    latitude: 53.7012,
    longitude: -2.1043,
    observedAt: "2026-11-06T23:40:00.000Z",
    evidence: { ...VIIRS, satellite: "1", confidence: "low", frpMegawatts: 1.2, brightnessKelvin: 301.4, dayNight: "night" },
  },
  // Campania: two adjacent pixels above the Terzigno vineyards on Vesuvius.
  {
    key: "campania/vesuvius-terzigno-1",
    product: "VIIRS_NOAA20_NRT",
    latitude: 40.8048,
    longitude: 14.4721,
    observedAt: "2026-11-07T11:24:00.000Z",
    evidence: { ...VIIRS, satellite: "1", confidence: "high", frpMegawatts: 11.3, brightnessKelvin: 343.6, dayNight: "day" },
  },
  {
    key: "campania/vesuvius-terzigno-2",
    product: "VIIRS_NOAA20_NRT",
    latitude: 40.8031,
    longitude: 14.4769,
    observedAt: "2026-11-07T11:24:00.000Z",
    evidence: { ...VIIRS, satellite: "1", confidence: "nominal", frpMegawatts: 6.2, brightnessKelvin: 331.9, dayNight: "day" },
  },
  {
    key: "campania/vesuvius-boscotrecase",
    product: "VIIRS_SNPP_NRT",
    latitude: 40.7869,
    longitude: 14.4402,
    observedAt: "2026-11-07T10:41:00.000Z",
    evidence: { ...VIIRS, satellite: "N", confidence: "nominal", frpMegawatts: 4.1, brightnessKelvin: 326.4, dayNight: "day" },
  },
  {
    key: "campania/irpinia-taurasi",
    product: "MODIS_NRT",
    latitude: 41.0123,
    longitude: 14.9541,
    observedAt: "2026-11-07T09:58:00.000Z",
    evidence: {
      instrument: "MODIS",
      satellite: "Aqua",
      confidence: 58,
      frpMegawatts: 15.4,
      brightnessKelvin: 323.8,
      dayNight: "day",
      version: "6.1NRT",
      scanKm: 1.0,
      trackKm: 1.0,
    },
  },
  {
    key: "campania/irpinia-lapio",
    product: "VIIRS_NOAA21_NRT",
    latitude: 40.9842,
    longitude: 14.9468,
    observedAt: "2026-11-07T11:46:00.000Z",
    evidence: { ...VIIRS, satellite: "2", confidence: "low", frpMegawatts: 1.9, brightnessKelvin: 309.2, dayNight: "day" },
  },
  {
    key: "campania/sannio-guardia",
    product: "VIIRS_SNPP_NRT",
    latitude: 41.2486,
    longitude: 14.5974,
    observedAt: "2026-11-06T22:30:00.000Z",
    evidence: { ...VIIRS, satellite: "N", confidence: "low", frpMegawatts: 1.4, brightnessKelvin: 303.1, dayNight: "night" },
  },
];

export function demoFirmsDetections(): FirmsDetection[] {
  return ROWS.map((row) => ({
    id: syntheticId(`outrolife/firms/${row.key}`),
    product: row.product,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt: row.observedAt,
    retrievedAt: SYNTHETIC_NOW,
    evidence: { ...row.evidence, distanceKm: null },
    isSynthetic: true,
  }));
}

/** The detection IDs for a scenario, for linking investigation evidence. */
export function demoDetectionIds(scenario: string): string[] {
  return ROWS.filter((row) => row.key.startsWith(`${scenario}/`)).map((row) =>
    syntheticId(`outrolife/firms/${row.key}`),
  );
}
