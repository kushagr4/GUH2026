import { describe, expect, it } from "vitest";
import {
  DEFAULT_WITNESS_OPTIONS,
  haversineKm,
  normaliseText,
  resolveWitnessOptions,
  textSimilarity,
} from "@/lib/embergap/agents/validators/witness";

describe("haversineKm", () => {
  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(51.5, -0.12, 51.5, -0.12)).toBe(0);
    expect(haversineKm(51.5, -0.12, 53.48, -2.24)).toBeCloseTo(haversineKm(53.48, -2.24, 51.5, -0.12), 9);
  });

  it("matches known distances", () => {
    // One degree of latitude is about 111.2 km.
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
    // London to Manchester is roughly 262 km great-circle.
    expect(haversineKm(51.5074, -0.1278, 53.4808, -2.2426)).toBeGreaterThan(255);
    expect(haversineKm(51.5074, -0.1278, 53.4808, -2.2426)).toBeLessThan(270);
  });

  it("handles the antimeridian", () => {
    expect(haversineKm(0, 179.9, 0, -179.9)).toBeCloseTo(22.2, 0);
  });
});

describe("text similarity", () => {
  it("normalises case, punctuation and diacritics", () => {
    expect(normaliseText("  Fumée!!  près du CAMP-site ")).toBe("fumee pres du camp site");
  });

  it("scores identical text 1 and unrelated text low", () => {
    expect(textSimilarity("Smoke over the ridge", "smoke, over the RIDGE!")).toBe(1);
    expect(textSimilarity("Smoke over the ridge", "Lovely picnic by the lake")).toBeLessThan(0.3);
  });

  it("scores a lightly edited copy above the default threshold", () => {
    const original = "URGENT: massive wildfire spreading fast near Oak Valley, share this now!!";
    expect(textSimilarity(original, `${original} Please share`)).toBeGreaterThanOrEqual(
      DEFAULT_WITNESS_OPTIONS.textSimilarityThreshold,
    );
  });

  it("returns 0 for two empty texts", () => {
    expect(textSimilarity("", "")).toBe(0);
  });
});

describe("resolveWitnessOptions", () => {
  it("fills defaults and validates overrides", () => {
    expect(resolveWitnessOptions()).toEqual(DEFAULT_WITNESS_OPTIONS);
    expect(resolveWitnessOptions({ maxDistanceKm: 2 }).maxDistanceKm).toBe(2);
    expect(() => resolveWitnessOptions({ textSimilarityThreshold: 1.5 })).toThrow();
  });
});
