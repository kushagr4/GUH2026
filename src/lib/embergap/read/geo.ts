import type { Freshness } from "./types";

/** About 2.2 km north-south. Reports are shown at the centre of this grid cell. */
export const REPORT_GRID_DEGREES = 0.02;

/**
 * Snaps a point to the centre of its grid cell, so a public map never shows
 * where a reporter actually stood. Thermal anomalies are public satellite
 * pixels and keep their own (already ~375 m to 1 km) resolution.
 */
export function approximateLocation(
  latitude: number,
  longitude: number,
  gridDegrees = REPORT_GRID_DEGREES,
): { latitude: number; longitude: number; precisionKm: number } {
  const snap = (value: number) =>
    Number(((Math.floor(value / gridDegrees) + 0.5) * gridDegrees).toFixed(5));
  return {
    latitude: snap(latitude),
    longitude: snap(longitude),
    precisionKm: Math.round(gridDegrees * 111 * 10) / 10,
  };
}

export function ageMinutes(observedAt: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(observedAt)) / 60_000));
}

/** fresh: up to 3 hours. recent: up to 12 hours. stale: older. */
export function freshnessOf(minutes: number): Freshness {
  if (minutes <= 3 * 60) return "fresh";
  if (minutes <= 12 * 60) return "recent";
  return "stale";
}
