import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Map presets. The places are real so the map is recognisable; every report,
 * investigation and detection shown in demo mode is SYNTHETIC.
 *
 * Campania's wine country is the default view. The six shared synthetic
 * scenarios (SYNTHETIC_SCENARIOS in the contracts, seeded by the migration)
 * are still in the South Pennines until the contract moves them, so that
 * preset stays available.
 */
export type MapRegion = { id: string; name: string; bbox: Bbox };

export const DEMO_REGIONS: readonly MapRegion[] = [
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
  {
    id: "pennines",
    name: "Pennines (demo scenarios)",
    bbox: { minLongitude: -2.75, minLatitude: 53.3, maxLongitude: -1.55, maxLatitude: 54.0 },
  },
];

export const DEFAULT_REGION = DEMO_REGIONS[0]!;
export const SCENARIO_REGION = DEMO_REGIONS.find((region) => region.id === "pennines")!;
