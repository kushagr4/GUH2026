export * from "./types";
export {
  CLASSIFICATION_RULES,
  DECISION_RULES,
  FUSION_RULES_VERSION,
  GAP_REASON_CODES,
  SOURCE_AGENTS,
  STANDARD_LIMITATIONS,
  STRENGTH_RULES,
} from "./rules";
export { fuseFindings, isFlaggedForReview } from "./fuse";
export { FUSION_SCENARIOS, type FusionScenario, type GroundTruth } from "./scenarios";
export {
  createDeterministicDeps,
  evaluateScenarios,
  fusionStrategy,
  singleSourceBaseline,
  type EvaluationCounts,
  type EvaluationReport,
  type EvaluationStrategy,
  type Outcome,
  type ScenarioResult,
  type StrategyDecision,
} from "./evaluate";
