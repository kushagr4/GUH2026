import type { Bbox } from "@/lib/embergap/contracts";

/**
 * Map presets around the shared synthetic scenarios (all in the Pennines).
 * The places are real so the map is recognisable; every report and
 * investigation shown in demo mode is SYNTHETIC.
 */
export type MapRegion = { id: string; name: string; bbox: Bbox };

export const DEMO_REGIONS: readonly MapRegion[] = [
  {
    id: "pennines",
    name: "South Pennines (all scenarios)",
    bbox: { minLongitude: -2.75, minLatitude: 53.3, maxLongitude: -1.55, maxLatitude: 54.0 },
  },
  {
    id: "peak-district",
    name: "Dark Peak close-up",
    bbox: { minLongitude: -2.15, minLatitude: 53.35, maxLongitude: -1.7, maxLatitude: 53.65 },
  },
];

export const DEFAULT_REGION = DEMO_REGIONS[0]!;
