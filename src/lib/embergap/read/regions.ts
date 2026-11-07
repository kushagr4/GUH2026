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
  {
    id: "campania-vineyards",
    name: "Campania vineyards",
    bbox: { minLongitude: 14.25, minLatitude: 40.7, maxLongitude: 15.15, maxLatitude: 41.32 },
  },
  {
    id: "vesuvius",
    name: "Vesuvius slopes",
    bbox: { minLongitude: 14.36, minLatitude: 40.75, maxLongitude: 14.53, maxLatitude: 40.85 },
  },
  {
    id: "irpinia",
    name: "Irpinia (Taurasi)",
    bbox: { minLongitude: 14.84, minLatitude: 40.94, maxLongitude: 15.04, maxLatitude: 41.05 },
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
