/**
 * EmberGap validation pipeline: witness -> vision -> fusion, in one call.
 *
 * IMPORTANT: this is a CONVENIENCE for wiring and the offline demo. In the
 * distributed runtime each agent runs separately, with its own inbox, state
 * and failure modes, and fusion only sees the findings that actually arrive.
 * This function is NOT a hidden central decision engine: it makes no
 * decisions of its own. It calls each independent validator, turns a
 * validator crash into an explicit data gap for that agent, and hands the
 * resulting findings to the same deterministic `fuseFindings` rules the
 * runtime uses. The output is a review recommendation for a HUMAN.
 */
import {
  agentFindingSchema,
  type AgentDeps,
  type AgentFinding,
  type AgentId,
  type SourceState,
  type WitnessReport,
} from "@/lib/embergap/agents/validators/types";
import { createMockVisionAnalyzer } from "@/lib/embergap/agents/validators/vision/mock";
import type { VisionAnalyzer, VisionInput } from "@/lib/embergap/agents/validators/vision/analyzer";
import { VISION_REASON, VISION_LIMITATIONS } from "@/lib/embergap/agents/validators/vision/guardrails";
import { validateVision } from "@/lib/embergap/agents/validators/vision/validate";
import { assessWitnessReports } from "@/lib/embergap/agents/validators/witness/assess";
import type { WitnessOptions } from "@/lib/embergap/agents/validators/witness/options";
import type { WitnessAssessment } from "@/lib/embergap/agents/validators/witness/types";
import { fuseFindings } from "./fuse";
import type { FusionInput, FusionRecommendation } from "./types";

/** Agents whose findings may arrive from OTHER teams' workers (FIRMS, Open-Meteo). */
export const EXTERNAL_AGENT_IDS: readonly AgentId[] = ["satellite", "weather"] as const;

/** Reason code for a witness validator that crashed. Paired with sourceState "unavailable". */
export const WITNESS_AGENT_FAILED = "witness.agent_failed" as const;

export type PipelineVisionInput = VisionInput & {
  /** Observation / media ids the vision finding is about. Defaults to none. */
  evidenceIds?: string[];
};

export type PipelineInput = {
  investigationId: string;
  witnessReports: readonly WitnessReport[];
  /** The submitted photo, if any. No photo means vision stays a data gap. */
  vision?: PipelineVisionInput;
  /**
   * Findings from other agents (satellite, weather). Untrusted: only valid
   * satellite/weather findings for this investigation are accepted, so an
   * external producer can never write a witness, vision or fusion finding.
   */
  externalFindings?: readonly AgentFinding[];
  sourceStates?: FusionInput["sourceStates"];
  /** Always explicit. Use `withMockVisionAnalyzer` for synthetic/offline runs. */
  visionAnalyzer: VisionAnalyzer;
};

export type PipelineOptions = {
  visionTimeoutMs?: number;
  witnessOptions?: Partial<WitnessOptions>;
  /**
   * "live" is only honoured with a non-mock analyzer; a mock analyzer always
   * yields "synthetic". Defaults to "synthetic" for the mock analyzer and
   * "live" otherwise.
   */
  mode?: PipelineMode;
  signal?: AbortSignal;
};

export type PipelineMode = "synthetic" | "live";

export type PipelineStep = {
  agentId: AgentId;
  startedAt: string;
  finishedAt: string;
  findingId: string;
  /** "failed" means the validator threw and a gap finding was recorded instead. */
  status: "completed" | "failed";
};

export type PipelineResult = {
  investigationId: string;
  /** Null only when the witness validator itself failed. */
  witness: WitnessAssessment | null;
  /** Null when no photo was submitted. */
  vision: AgentFinding | null;
  /** Every finding handed to fusion, in pipeline order. */
  findings: AgentFinding[];
  /** External findings rejected before fusion (wrong agent, investigation or shape). */
  rejectedExternalFindingIds: string[];
  /** The exact fusion input, so the recommendation can be replayed and audited. */
  fusionInput: FusionInput;
  recommendation: FusionRecommendation;
  mode: PipelineMode;
  steps: PipelineStep[];
};

/** Explicitly opt into the deterministic mock analyzer (SYNTHETIC fixtures only). */
export function withMockVisionAnalyzer(input: Omit<PipelineInput, "visionAnalyzer">): PipelineInput {
  return { ...input, visionAnalyzer: createMockVisionAnalyzer() };
}

function failedFinding(
  investigationId: string,
  agentId: "witness" | "vision",
  deps: AgentDeps,
): AgentFinding {
  // The thrown error is never copied: it may contain untrusted input.
  return {
    id: deps.newId(),
    investigationId,
    agentId,
    createdAt: deps.now(),
    evidenceIds: [],
    assessment: "inconclusive",
    reasonCodes: [agentId === "vision" ? VISION_REASON.modelUnavailable : WITNESS_AGENT_FAILED],
    explanation: `The ${agentId} agent failed to run; recorded as a data gap, not as evidence for or against a fire.`,
    limitations: [
      agentId === "vision"
        ? VISION_LIMITATIONS.gapUnavailable
        : "Witness validation failed; witness evidence is unknown, not evidence of absence.",
    ],
  };
}

function acceptExternal(
  investigationId: string,
  findings: readonly AgentFinding[],
): { accepted: AgentFinding[]; rejectedIds: string[] } {
  const accepted: AgentFinding[] = [];
  const rejectedIds: string[] = [];
  for (const raw of findings) {
    const parsed = agentFindingSchema.safeParse(raw);
    if (
      parsed.success &&
      parsed.data.investigationId === investigationId &&
      EXTERNAL_AGENT_IDS.includes(parsed.data.agentId)
    ) {
      accepted.push(parsed.data);
    } else {
      const id = (raw as { id?: unknown } | null)?.id;
      rejectedIds.push(typeof id === "string" ? id : "");
    }
  }
  return { accepted, rejectedIds };
}

/**
 * Run witness -> vision (with timeout) -> fusion. Never throws because of a
 * validator: a crash becomes an inconclusive finding plus sourceState
 * "unavailable" for that agent, which fusion treats as a data gap. It only
 * throws if `deps` itself throws. Deterministic given deterministic deps and
 * a deterministic analyzer.
 */
export async function runValidationPipeline(
  input: PipelineInput,
  deps: AgentDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const { investigationId } = input;
  const steps: PipelineStep[] = [];
  const sourceStates: Partial<Record<AgentId, SourceState>> = { ...input.sourceStates };

  // 1. Witness agent.
  let witness: WitnessAssessment | null = null;
  let witnessFinding: AgentFinding;
  const witnessStart = deps.now();
  try {
    witness = assessWitnessReports(investigationId, input.witnessReports, deps, options.witnessOptions);
    witnessFinding = witness.finding;
  } catch {
    witnessFinding = failedFinding(investigationId, "witness", deps);
    sourceStates.witness = "unavailable";
  }
  steps.push({
    agentId: "witness",
    startedAt: witnessStart,
    finishedAt: deps.now(),
    findingId: witnessFinding.id,
    status: witness ? "completed" : "failed",
  });

  // 2. Vision agent (only when a photo was submitted).
  let vision: AgentFinding | null = null;
  if (input.vision) {
    const { evidenceIds = [], ...visionInput } = input.vision;
    const visionStart = deps.now();
    let status: PipelineStep["status"] = "completed";
    try {
      vision = await validateVision(
        { investigationId, evidenceIds, input: visionInput },
        input.visionAnalyzer,
        deps,
        { timeoutMs: options.visionTimeoutMs, signal: options.signal },
      );
    } catch {
      vision = failedFinding(investigationId, "vision", deps);
      sourceStates.vision = "unavailable";
      status = "failed";
    }
    steps.push({
      agentId: "vision",
      startedAt: visionStart,
      finishedAt: deps.now(),
      findingId: vision.id,
      status,
    });
  }

  // 3. External findings, then fusion.
  const { accepted, rejectedIds } = acceptExternal(investigationId, input.externalFindings ?? []);
  const findings = [witnessFinding, ...(vision ? [vision] : []), ...accepted];
  const fusionInput: FusionInput = {
    investigationId,
    findings,
    ...(Object.keys(sourceStates).length > 0 ? { sourceStates } : {}),
  };
  const fusionStart = deps.now();
  const recommendation = fuseFindings(fusionInput, deps);
  steps.push({
    agentId: "fusion",
    startedAt: fusionStart,
    finishedAt: deps.now(),
    findingId: recommendation.finding.id,
    status: "completed",
  });

  const isMock = input.visionAnalyzer.id === "mock";
  const mode: PipelineMode = isMock ? "synthetic" : (options.mode ?? "live");

  return {
    investigationId,
    witness,
    vision,
    findings,
    rejectedExternalFindingIds: rejectedIds,
    fusionInput,
    recommendation,
    mode,
    steps,
  };
}
