import { z } from "zod";

/**
 * Tunable thresholds for witness correlation. Defaults are heuristics chosen
 * for a hackathon prototype, not calibrated values.
 */
export type WitnessOptions = {
  /**
   * Base distance (km) within which two reports may describe the same event.
   * Each report's `locationPrecisionM` is added on top, because coordinates
   * are approximate (privacy-reduced).
   */
  maxDistanceKm: number;
  /** Maximum difference between `observedAt` times (ms) for the same event. */
  maxTimeDifferenceMs: number;
  /**
   * Upper bound for the per-report precision allowance (m). Stops a report
   * with a huge stated imprecision from being "coherent" with everything.
   */
  maxLocationPrecisionM: number;
  /** Character-trigram Jaccard similarity at or above which texts are near-identical. */
  textSimilarityThreshold: number;
  /**
   * Minimum normalised text length (characters) before text similarity is
   * considered. Short generic texts ("smoke!") are often written independently.
   */
  minTextLengthForSimilarity: number;
  /** Tolerated clock skew: `observedAt` may be at most this far after `submittedAt`. */
  clockSkewToleranceMs: number;
};

export const DEFAULT_WITNESS_OPTIONS: Readonly<WitnessOptions> = Object.freeze({
  maxDistanceKm: 5,
  maxTimeDifferenceMs: 3 * 60 * 60 * 1000,
  maxLocationPrecisionM: 10_000,
  textSimilarityThreshold: 0.8,
  minTextLengthForSimilarity: 20,
  clockSkewToleranceMs: 10 * 60 * 1000,
});

export const witnessOptionsSchema = z.object({
  maxDistanceKm: z.number().finite().nonnegative(),
  maxTimeDifferenceMs: z.number().finite().nonnegative(),
  maxLocationPrecisionM: z.number().finite().nonnegative(),
  textSimilarityThreshold: z.number().min(0).max(1),
  minTextLengthForSimilarity: z.number().int().nonnegative(),
  clockSkewToleranceMs: z.number().finite().nonnegative(),
});

/** Merge partial options with defaults and validate. Throws on invalid configuration. */
export function resolveWitnessOptions(options?: Partial<WitnessOptions>): WitnessOptions {
  return witnessOptionsSchema.parse({ ...DEFAULT_WITNESS_OPTIONS, ...options });
}
