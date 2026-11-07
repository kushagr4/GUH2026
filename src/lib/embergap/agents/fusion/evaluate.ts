/**
 * Evaluation harness: run a strategy over labelled synthetic scenarios and
 * report MEASURED counts only (true/false positives and negatives). No rates
 * or percentages are invented; derive them yourself from the counts if needed,
 * remembering the fixture set is small and author-designed.
 *
 * "Flagged for review" means status needs_human_review with priority high or medium.
 */
import {
  agentFindingSchema,
  type AgentDeps,
} from "@/lib/embergap/agents/validators/types";
import { fuseFindings, isFlaggedForReview } from "./fuse";
import type { FusionScenario, GroundTruth } from "./scenarios";
import type { FusionInput, FusionRecommendation } from "./types";

export type StrategyDecision = {
  flagged: boolean;
  rationale: string;
  recommendation?: FusionRecommendation;
};

export type EvaluationStrategy = {
  name: string;
  description: string;
  decide: (input: FusionInput, deps: AgentDeps) => StrategyDecision;
};

export type Outcome = "true_positive" | "false_positive" | "true_negative" | "false_negative";

export type ScenarioResult = {
  scenarioId: string;
  groundTruth: GroundTruth;
  flagged: boolean;
  outcome: Outcome;
  rationale: string;
  /** Only for strategies that return a recommendation: does it match the scenario's expected outcome? */
  matchesExpected: boolean | null;
  recommendation?: FusionRecommendation;
};

export type EvaluationCounts = {
  total: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** Scenarios where a recommendation differed from the expected outcome (null-match scenarios excluded). */
  expectationMismatches: number;
};

export type EvaluationReport = {
  strategy: string;
  description: string;
  results: ScenarioResult[];
  counts: EvaluationCounts;
};

/** Deterministic clock and id generator for one scenario. */
export function createDeterministicDeps(
  prefix: string,
  now = "2026-11-07T12:00:00.000Z",
): AgentDeps {
  let n = 0;
  return { now: () => now, newId: () => `${prefix}-fusion-${++n}` };
}

/** The distributed, source-aware strategy: fuseFindings plus the flagged-for-review rule. */
export const fusionStrategy: EvaluationStrategy = {
  name: "fusion",
  description:
    "Source-aware fusion rules: flagged when fuseFindings returns needs_human_review with high or medium priority.",
  decide: (input, deps) => {
    const recommendation = fuseFindings(input, deps);
    return {
      flagged: isFlaggedForReview(recommendation),
      rationale: `${recommendation.status} / ${recommendation.reviewPriority} / ${recommendation.evidenceStrength}`,
      recommendation,
    };
  },
};

/**
 * Single-source baseline: flag if ANY valid finding for the investigation
 * (from any source agent, fusion excluded) has assessment "supports". No
 * deduplication by source, no gap handling and no corroboration requirement.
 */
export const singleSourceBaseline: EvaluationStrategy = {
  name: "single-source-baseline",
  description: "Flag if any single valid source finding for the investigation supports the report.",
  decide: (input) => {
    const supporters = input.findings
      .filter((f) => agentFindingSchema.safeParse(f).success)
      .filter((f) => f.investigationId === input.investigationId && f.agentId !== "fusion")
      .filter((f) => f.assessment === "supports")
      .map((f) => f.agentId);
    const agents = [...new Set(supporters)].sort();
    return {
      flagged: agents.length > 0,
      rationale: agents.length > 0 ? `supported by ${agents.join(", ")}` : "no supporting finding",
    };
  },
};

function outcomeFor(groundTruth: GroundTruth, flagged: boolean): Outcome {
  if (groundTruth === "fire") return flagged ? "true_positive" : "false_negative";
  return flagged ? "false_positive" : "true_negative";
}

function matches(scenario: FusionScenario, rec: FusionRecommendation): boolean {
  const gapAgents = rec.gaps.map((g) => g.agentId).sort();
  return (
    rec.status === scenario.expected.status &&
    rec.evidenceStrength === scenario.expected.evidenceStrength &&
    rec.reviewPriority === scenario.expected.reviewPriority &&
    rec.contradictions.length > 0 === scenario.expected.hasContradiction &&
    gapAgents.join(",") === [...scenario.expected.gapAgents].sort().join(",")
  );
}

export function evaluateScenarios(
  scenarios: readonly FusionScenario[],
  strategy: EvaluationStrategy,
  makeDeps: (scenario: FusionScenario) => AgentDeps = (s) => createDeterministicDeps(s.id),
): EvaluationReport {
  const results: ScenarioResult[] = scenarios.map((scenario) => {
    const decision = strategy.decide(scenario.input, makeDeps(scenario));
    return {
      scenarioId: scenario.id,
      groundTruth: scenario.groundTruth,
      flagged: decision.flagged,
      outcome: outcomeFor(scenario.groundTruth, decision.flagged),
      rationale: decision.rationale,
      matchesExpected: decision.recommendation ? matches(scenario, decision.recommendation) : null,
      ...(decision.recommendation ? { recommendation: decision.recommendation } : {}),
    };
  });
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  return {
    strategy: strategy.name,
    description: strategy.description,
    results,
    counts: {
      total: results.length,
      truePositives: count("true_positive"),
      falsePositives: count("false_positive"),
      trueNegatives: count("true_negative"),
      falseNegatives: count("false_negative"),
      expectationMismatches: results.filter((r) => r.matchesExpected === false).length,
    },
  };
}
