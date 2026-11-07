import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Map presets for the demonstration area: Italy, where the six shared
 * synthetic scenarios are placed. The places are real so the map is
 * recognisable; every report and investigation shown in demo mode is SYNTHETIC.
 * Every preset fits the map API's bbox limit (30 x 20 degrees).
 */
export type MapRegion = { id: string; name: string; bbox: Bbox };

export const DEMO_REGIONS: readonly MapRegion[] = [
  {
    id: "italy",
    name: "Italy (all scenarios)",
    bbox: { minLongitude: 6.5, minLatitude: 35.5, maxLongitude: 19.0, maxLatitude: 47.5 },
  },
  {
    id: "sardinia",
    name: "Sardinia",
    bbox: { minLongitude: 7.9, minLatitude: 38.7, maxLongitude: 10.0, maxLatitude: 41.4 },
  },
  {
    id: "sicily",
    name: "Sicily",
    bbox: { minLongitude: 12.2, minLatitude: 36.5, maxLongitude: 15.8, maxLatitude: 38.4 },
  },
  {
    id: "calabria",
    name: "Calabria",
    bbox: { minLongitude: 15.5, minLatitude: 37.8, maxLongitude: 17.3, maxLatitude: 40.2 },
  },
];

export const DEFAULT_REGION = DEMO_REGIONS[0]!;

/** Where each synthetic scenario is placed, for labels. */
export const SCENARIO_PLACE: Record<string, string> = {
  "corroborated-smoke": "Sardinia",
  "misleading-photo": "Tuscany",
  "missing-satellite-pass": "Calabria",
  "weather-timeout": "Puglia",
  "repeated-witness": "Lazio",
  "partition-recovery": "Sicily",
};
