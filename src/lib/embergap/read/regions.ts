import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Map presets. Italy is the default: the six shared synthetic scenarios
 * (SYNTHETIC_SCENARIOS) are placed across Italy, and labelled synthetic FIRMS
 * detections sit in Campania's wine country. The two wide presets cover all of
 * Europe, and Europe with North Africa and the Middle East, for live NASA
 * FIRMS data. The places are real so the map is recognisable; every report,
 * investigation and detection shown in demo mode is SYNTHETIC. Every preset
 * fits the map API's bbox limit (MAX_FIRMS_BBOX_SPAN, 100 x 70 degrees).
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
  {
    id: "europe",
    name: "Europe",
    bbox: { minLongitude: -25.0, minLatitude: 34.0, maxLongitude: 45.0, maxLatitude: 71.5 },
  },
  {
    id: "europe-africa-asia",
    name: "Europe, North Africa & Middle East",
    bbox: { minLongitude: -25.0, minLatitude: 15.0, maxLongitude: 65.0, maxLatitude: 71.5 },
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
