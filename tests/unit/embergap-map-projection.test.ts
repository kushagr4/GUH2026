import { describe, expect, it } from "vitest";
import { SYNTHETIC_SCENARIOS } from "@/lib/embergap/contracts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitCamera,
  panBy,
  tilesFor,
  toLatLon,
  toScreen,
  viewBbox,
  zoomAround,
} from "@/components/embergap/map/projection";
import { confidenceLabel, formatDuration, formatUtc, humanizeCode } from "@/components/embergap/dashboard/labels";
import { DEFAULT_REGION, DEMO_REGIONS } from "@/lib/embergap/read/regions";

const SIZE = { width: 1000, height: 650 };

describe("map camera", () => {
  it.each(DEMO_REGIONS.map((region) => [region.name, region.bbox] as const))("fits %s inside the view", (_name, bbox) => {
    const camera = fitCamera(bbox, SIZE);
    for (const [lat, lon] of [
      [bbox.minLatitude, bbox.minLongitude],
      [bbox.maxLatitude, bbox.maxLongitude],
    ] as const) {
      const { x, y } = toScreen(camera, SIZE, lat, lon);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(SIZE.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SIZE.height);
    }
  });

  it("the default region shows every shared scenario", () => {
    const camera = fitCamera(DEFAULT_REGION.bbox, SIZE);
    for (const scenario of SYNTHETIC_SCENARIOS) {
      const { x, y } = toScreen(camera, SIZE, scenario.report.latitude, scenario.report.longitude);
      expect(x, scenario.id).toBeGreaterThan(0);
      expect(x, scenario.id).toBeLessThan(SIZE.width);
      expect(y, scenario.id).toBeGreaterThan(0);
      expect(y, scenario.id).toBeLessThan(SIZE.height);
    }
  });

  it("round-trips screen and map coordinates", () => {
    const camera = fitCamera(DEFAULT_REGION.bbox, SIZE);
    const point = toLatLon(camera, SIZE, { x: 123, y: 456 });
    const back = toScreen(camera, SIZE, point.latitude, point.longitude);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(456, 6);
  });

  it("pans by the dragged distance", () => {
    const camera = fitCamera(DEFAULT_REGION.bbox, SIZE);
    const target = SYNTHETIC_SCENARIOS[0]!.report;
    const before = toScreen(camera, SIZE, target.latitude, target.longitude);
    const after = toScreen(panBy(camera, 40, -25), SIZE, target.latitude, target.longitude);
    expect(after.x - before.x).toBeCloseTo(40, 6);
    expect(after.y - before.y).toBeCloseTo(-25, 6);
  });

  it("zooms around the anchor and clamps the zoom range", () => {
    const camera = fitCamera(DEFAULT_REGION.bbox, SIZE);
    const anchor = { x: 300, y: 200 };
    const under = toLatLon(camera, SIZE, anchor);
    const zoomed = zoomAround(camera, SIZE, camera.zoom + 1.5, anchor);
    const stays = toScreen(zoomed, SIZE, under.latitude, under.longitude);
    expect(stays.x).toBeCloseTo(anchor.x, 4);
    expect(stays.y).toBeCloseTo(anchor.y, 4);
    expect(zoomAround(camera, SIZE, 99, anchor).zoom).toBe(MAX_ZOOM);
    expect(zoomAround(camera, SIZE, -5, anchor).zoom).toBe(MIN_ZOOM);
  });

  it("reports the visible area as a bbox", () => {
    const camera = fitCamera(DEFAULT_REGION.bbox, SIZE);
    const box = viewBbox(camera, SIZE);
    expect(box.minLongitude).toBeLessThanOrEqual(DEFAULT_REGION.bbox.minLongitude);
    expect(box.maxLatitude).toBeGreaterThanOrEqual(DEFAULT_REGION.bbox.maxLatitude);
  });

  it("covers the whole view with tiles at fractional zoom", () => {
    const camera = { ...fitCamera(DEFAULT_REGION.bbox, SIZE), zoom: 9.4 };
    const tiles = tilesFor(camera, SIZE, "https://tile.example/{z}/{x}/{y}.png");
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.x + t.size))).toBeGreaterThanOrEqual(SIZE.width);
    expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.y + t.size))).toBeGreaterThanOrEqual(SIZE.height);
    expect(tiles[0]?.url).toMatch(/^https:\/\/tile\.example\/9\/\d+\/\d+\.png$/);
  });
});

describe("labels", () => {
  it("never shows FIRMS confidence as a percentage", () => {
    expect(confidenceLabel(62)).not.toContain("%");
    expect(confidenceLabel("high")).toBe("high class");
    expect(confidenceLabel(null)).toBe("not reported");
  });

  it("formats durations, UTC times and codes", () => {
    expect(formatDuration(0)).toBe("under a minute");
    expect(formatDuration(190)).toBe("3 h 10 min");
    expect(formatUtc("2026-11-07T09:05:00.000Z")).toBe("7 Nov, 09:05 UTC");
    expect(formatUtc(null)).toBe("unknown time");
    expect(humanizeCode("fusion.rule.S2-two-independent")).toBe("fusion rule S2-two-independent");
  });
});
