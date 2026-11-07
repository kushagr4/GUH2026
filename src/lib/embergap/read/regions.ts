import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Map presets for the demonstration area: Italy. The six shared synthetic
 * scenarios (SYNTHETIC_SCENARIOS) are placed across Italy, and labelled
 * synthetic FIRMS detections sit in Campania's wine country. The places are
 * real so the map is recognisable; every report, investigation and detection
 * shown in demo mode is SYNTHETIC. Every preset fits the map API's bbox limit
 * (30 x 20 degrees).
 */
export type MapRegion = { id: string; name: string; bbox: Bbox };

export const DEMO_REGIONS: readonly MapRegion[] = [
  {
    id: "italy",
    name: "Italy",
    bbox: { minLongitude: 6.5, minLatitude: 35.5, maxLongitude: 19.0, maxLatitude: 47.5 },
  },
  {
    id: "campania-vineyards",
    name: "Campania vineyards",
    bbox: { minLongitude: 14.25, minLatitude: 40.7, maxLongitude: 15.15, maxLatitude: 41.32 },
  },
];

export const DEFAULT_REGION = DEMO_REGIONS[0]!;
/** The preset that shows every shared synthetic scenario. */
export const SCENARIO_REGION = DEFAULT_REGION;

/** Where each synthetic scenario is placed, for labels. */
export const SCENARIO_PLACE: Record<string, string> = {
  "corroborated-smoke": "Sardinia",
  "misleading-photo": "Tuscany",
  "missing-satellite-pass": "Calabria",
  "weather-timeout": "Puglia",
  "repeated-witness": "Lazio",
  "partition-recovery": "Sicily",
};
