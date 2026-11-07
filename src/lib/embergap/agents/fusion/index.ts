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
export {
  EXTERNAL_AGENT_IDS,
  WITNESS_AGENT_FAILED,
  runValidationPipeline,
  withMockVisionAnalyzer,
  type PipelineInput,
  type PipelineVisionInput,
  type PipelineOptions,
  type PipelineMode,
  type PipelineStep,
  type PipelineResult,
} from "./pipeline";
export {
  DEMO_AREA,
  RAW_SCENARIOS,
  RAW_SCENARIO_VISION_TIMEOUT_MS,
  createRawScenarioDeps,
  evaluateRawScenarios,
  runRawScenario,
  type RawEvaluation,
  type RawScenario,
} from "./raw-scenarios";
export {
  DEMO_DISCLAIMER,
  DEMO_MIN_PUBLIC_PRECISION_M,
  buildDemoInvestigations,
  decimalsForPrecision,
  toApproxLocation,
  type DemoAgentStep,
  type DemoFinding,
  type DemoInvestigation,
} from "./demo-export";
export {
  simulatePartitionTimeline,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelineInput,
  type TimelineMetrics,
  type TimelinePartition,
  type TimelinePhase,
  type TimelineRecommendation,
  type TimelineResult,
  type TimelineStep,
} from "./timeline";
export { TIMELINE_SCENARIOS, type TimelineScenario } from "./timeline-scenarios";
export {
  comparableRecommendation,
  mergeFindingSets,
  simulateDecentralisedFusion,
  type DecentralisedEvent,
  type DecentralisedInput,
  type DecentralisedMetrics,
  type DecentralisedNodeRecommendation,
  type DecentralisedNodeView,
  type DecentralisedPartition,
  type DecentralisedPhase,
  type DecentralisedResult,
  type DecentralisedStep,
  type FindingSet,
  type GossipLink,
} from "./decentralised";
export {
  DECENTRALISED_SCENARIOS,
  type DecentralisedExpectedView,
  type DecentralisedScenario,
} from "./decentralised-scenarios";
export {
  VALIDATION_ON_EVIDENCE,
  VALIDATION_PROCESSORS,
  VISION_REASON_TO_CANONICAL,
  fusionTaskInputSchema,
  fusionOnEvidence,
  fusionProcessor,
  visionTaskInputSchema,
  visionValidatorProcessor,
  evidenceKey,
  fromCanonicalFinding,
  toCanonicalRecommendation,
  toCanonicalVisionDraft,
  type VisionTaskInput,
} from "./runtime-processors";
