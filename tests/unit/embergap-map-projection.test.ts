import { describe, expect, it } from "vitest";
import { fitBbox, project, tilesFor } from "@/components/embergap/map/projection";
import { approximateLocation, freshnessOf } from "@/lib/embergap/read/geo";
import { DEMO_REGIONS } from "@/lib/embergap/read/regions";

describe("map projection", () => {
  it.each(DEMO_REGIONS.map((region) => [region.name, region.bbox] as const))(
    "fits %s inside the view",
    (_name, bbox) => {
      const view = fitBbox(bbox, 800, 520);
      expect(view.zoom).toBeGreaterThanOrEqual(8);
      for (const [lat, lon] of [
        [bbox.minLat, bbox.minLon],
        [bbox.maxLat, bbox.maxLon],
      ] as const) {
        const { left, top } = project(view, lat, lon);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(100);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(100);
      }
    },
  );

  it("covers the whole view with tiles", () => {
    const view = fitBbox(DEMO_REGIONS[0]!.bbox, 800, 520);
    const tiles = tilesFor(view, "https://tile.example/{z}/{x}/{y}.png");
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.left + tile.width))).toBeGreaterThanOrEqual(100);
    expect(Math.min(...tiles.map((tile) => tile.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.top + tile.height))).toBeGreaterThanOrEqual(100);
    expect(tiles[0]?.url).toMatch(new RegExp(`^https://tile\\.example/${view.zoom}/\\d+/\\d+\\.png$`));
  });
});

describe("privacy and freshness helpers", () => {
  it("snaps nearby points to the same cell centre", () => {
    const a = approximateLocation(53.4532, -1.8791);
    const b = approximateLocation(53.4599, -1.8701);
    expect(a).toEqual(b);
    expect(a.latitude).not.toBe(53.4532);
    expect(a.precisionKm).toBeCloseTo(2.2, 1);
  });

  it("labels freshness by age", () => {
    expect(freshnessOf(30)).toBe("fresh");
    expect(freshnessOf(5 * 60)).toBe("recent");
    expect(freshnessOf(20 * 60)).toBe("stale");
  });
});
