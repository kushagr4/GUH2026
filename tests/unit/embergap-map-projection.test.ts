import { describe, expect, it } from "vitest";
import { SYNTHETIC_SCENARIOS } from "@/lib/embergap/contracts";
import { fitBbox, project, tilesFor } from "@/components/embergap/map/projection";
import { confidenceLabel, formatDuration, formatUtc, humanizeCode } from "@/components/embergap/dashboard/labels";
import { DEFAULT_REGION, DEMO_REGIONS } from "@/lib/embergap/read/regions";

describe("map projection", () => {
  it.each(DEMO_REGIONS.map((region) => [region.name, region.bbox] as const))(
    "fits %s inside the view",
    (_name, bbox) => {
      const view = fitBbox(bbox, 800, 520);
      expect(view.zoom).toBeGreaterThanOrEqual(8);
      for (const [lat, lon] of [
        [bbox.minLatitude, bbox.minLongitude],
        [bbox.maxLatitude, bbox.maxLongitude],
      ] as const) {
        const { left, top } = project(view, lat, lon);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(100);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(100);
      }
    },
  );

  it("the default region shows every shared scenario", () => {
    const view = fitBbox(DEFAULT_REGION.bbox, 800, 520);
    for (const scenario of SYNTHETIC_SCENARIOS) {
      const { left, top } = project(view, scenario.report.latitude, scenario.report.longitude);
      expect(left, scenario.id).toBeGreaterThan(0);
      expect(left, scenario.id).toBeLessThan(100);
      expect(top, scenario.id).toBeGreaterThan(0);
      expect(top, scenario.id).toBeLessThan(100);
    }
  });

  it("covers the whole view with tiles", () => {
    const view = fitBbox(DEFAULT_REGION.bbox, 800, 520);
    const tiles = tilesFor(view, "https://tile.example/{z}/{x}/{y}.png");
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.left + tile.width))).toBeGreaterThanOrEqual(100);
    expect(Math.min(...tiles.map((tile) => tile.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.top + tile.height))).toBeGreaterThanOrEqual(100);
    expect(tiles[0]?.url).toMatch(new RegExp(`^https://tile\\.example/${view.zoom}/\\d+/\\d+\\.png$`));
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
