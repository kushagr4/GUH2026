import type { Bbox } from "./types";

/**
 * Map presets. The places are real so the map is recognisable, but every
 * report and investigation shown in demo mode is SYNTHETIC.
 */
export type MapRegion = { id: string; name: string; bbox: Bbox };

export const DEMO_REGIONS: readonly MapRegion[] = [
  {
    id: "peak-district",
    name: "Peak District, UK",
    bbox: { minLon: -2.15, minLat: 53.25, maxLon: -1.55, maxLat: 53.6 },
  },
  {
    id: "sierra-foothills",
    name: "Sierra Nevada foothills, California",
    bbox: { minLon: -121.3, minLat: 38.6, maxLon: -120.3, maxLat: 39.2 },
  },
];

export const DEFAULT_REGION = DEMO_REGIONS[0]!;
