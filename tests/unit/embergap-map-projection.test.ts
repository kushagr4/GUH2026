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
  viewTransform,
  zoomAround,
} from "@/components/embergap/map/projection";
import { confidenceLabel, formatDuration, formatUtc, humanizeCode } from "@/components/embergap/dashboard/labels";
import { DEFAULT_REGION, DEMO_REGIONS, SCENARIO_REGION } from "@/lib/embergap/read/regions";
import { demoFirmsDetections } from "@/lib/embergap/sources/firms/fixtures";

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

  it("the scenario region shows every shared scenario", () => {
    const camera = fitCamera(SCENARIO_REGION.bbox, SIZE);
    for (const scenario of SYNTHETIC_SCENARIOS) {
      const { x, y } = toScreen(camera, SIZE, scenario.report.latitude, scenario.report.longitude);
      expect(x, scenario.id).toBeGreaterThan(0);
      expect(x, scenario.id).toBeLessThan(SIZE.width);
      expect(y, scenario.id).toBeGreaterThan(0);
      expect(y, scenario.id).toBeLessThan(SIZE.height);
    }
  });

  it("the default view is Italy, and the Campania preset shows its synthetic detections", () => {
    expect(DEFAULT_REGION.id).toBe("italy");
    const campania = DEMO_REGIONS.find((region) => region.id === "campania-vineyards")!;
    const camera = fitCamera(campania.bbox, SIZE);
    const inView = demoFirmsDetections().filter((detection) => {
      const { x, y } = toScreen(camera, SIZE, detection.latitude, detection.longitude);
      return x > 0 && x < SIZE.width && y > 0 && y < SIZE.height;
    });
    expect(inView.length).toBeGreaterThanOrEqual(5);
    expect(inView.every((detection) => detection.isSynthetic)).toBe(true);
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
    const tiles = tilesFor(camera, SIZE, "https://{s}.tile.example/{z}/{x}/{y}.png");
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.x + t.size))).toBeGreaterThanOrEqual(SIZE.width);
    expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.y + t.size))).toBeGreaterThanOrEqual(SIZE.height);
    // Rounds the tile zoom up, so tiles are only ever scaled down (sharp).
    expect(tiles[0]?.url).toMatch(/^https:\/\/[abcd]\.tile\.example\/10\/\d+\/\d+\.png$/);
    expect(Math.max(...tiles.map((t) => t.size))).toBeLessThanOrEqual(257);
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

describe("smooth zooming helpers", () => {
  const camera = { latitude: 40.85, longitude: 14.27, zoom: 9.4 };

  it("maps points drawn for one camera onto another (pan and zoom)", () => {
    const next = zoomAround(panBy(camera, 120, -40), SIZE, 11.1, { x: 300, y: 200 });
    const t = viewTransform(camera, next, SIZE);
    expect(t.scale).toBeCloseTo(2 ** (11.1 - 9.4));
    for (const [lat, lon] of [
      [40.85, 14.27],
      [41.2, 13.9],
      [40.5, 14.8],
    ] as const) {
      const before = toScreen(camera, SIZE, lat, lon);
      const after = toScreen(next, SIZE, lat, lon);
      expect(t.scale * before.x + t.x).toBeCloseTo(after.x, 6);
      expect(t.scale * before.y + t.y).toBeCloseTo(after.y, 6);
    }
  });

  it("is the identity for the same camera", () => {
    const t = viewTransform(camera, camera, SIZE);
    expect(t.scale).toBe(1);
    expect(t.x).toBeCloseTo(0, 9);
    expect(t.y).toBeCloseTo(0, 9);
  });

  it("gives coarser placeholder tiles that cover the same view with fewer requests", () => {
    const sharp = tilesFor(camera, SIZE, "{z}/{x}/{y}");
    const coarse = tilesFor(camera, SIZE, "{z}/{x}/{y}", 1);
    expect(sharp[0]!.key.startsWith("10/")).toBe(true);
    expect(coarse[0]!.key.startsWith("9/")).toBe(true);
    expect(coarse.length).toBeLessThan(sharp.length);
    const covers = (tiles: typeof sharp) => {
      const minX = Math.min(...tiles.map((t) => t.x));
      const minY = Math.min(...tiles.map((t) => t.y));
      const maxX = Math.max(...tiles.map((t) => t.x + t.size));
      const maxY = Math.max(...tiles.map((t) => t.y + t.size));
      return minX <= 0 && minY <= 0 && maxX >= SIZE.width && maxY >= SIZE.height;
    };
    expect(covers(sharp)).toBe(true);
    expect(covers(coarse)).toBe(true);
    expect(new Set([...sharp, ...coarse].map((t) => t.key)).size).toBe(sharp.length + coarse.length);
  });
});

describe("wide regions", () => {
  it("every preset is accepted by the map API, and Europe, North Africa and the Middle East are covered", async () => {
    const { isWithinFirmsSpan } = await import("@/lib/embergap/sources/firms/bbox");
    for (const region of DEMO_REGIONS) expect(isWithinFirmsSpan(region.bbox), region.id).toBe(true);
    const wide = DEMO_REGIONS.find((region) => region.id === "europe-africa-asia")!.bbox;
    for (const [lat, lon] of [[51.5, -0.1], [64.1, -21.9], [30.0, 31.2], [33.6, -7.6], [35.7, 51.4], [41.0, 29.0]] as const) {
      expect(lat >= wide.minLatitude && lat <= wide.maxLatitude && lon >= wide.minLongitude && lon <= wide.maxLongitude, `${lat},${lon}`).toBe(true);
    }
  });
});
