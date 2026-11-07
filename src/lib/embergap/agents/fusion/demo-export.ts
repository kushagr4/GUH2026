/**
 * UI-friendly, JSON-serialisable export of the SYNTHETIC raw scenarios for the
 * dashboard/map team. Every investigation is run through the real validators
 * and fusion via `runRawScenario`.
 *
 * Privacy: no reporter ids, report ids, photo hashes or exact coordinates are
 * exported. Locations are rounded to a coarse public precision.
 */
import type { AgentDeps, AgentId, Assessment } from "@/lib/embergap/agents/validators/types";
import type { PipelineMode, PipelineStep } from "./pipeline";
import { RAW_SCENARIOS, createRawScenarioDeps, runRawScenario, type RawScenario } from "./raw-scenarios";
import type {
  EvidenceStrength,
  FusionContradiction,
  FusionGap,
  FusionStatus,
  ReviewPriority,
} from "./types";

export const DEMO_DISCLAIMER =
  "Synthetic demo data. Decision support for human review; not a fire confirmation or emergency alert." as const;

/** Minimum public location precision (metres). Exported locations are never finer than this. */
export const DEMO_MIN_PUBLIC_PRECISION_M = 1000;

const METRES_PER_DEGREE_LAT = 111_320;

export type DemoFinding = {
  agentId: AgentId;
  assessment: Assessment;
  reasonCodes: string[];
  explanation: string;
  limitations: string[];
};

export type DemoAgentStep = Pick<PipelineStep, "agentId" | "startedAt" | "finishedAt" | "status">;

export type DemoInvestigation = {
  id: string;
  title: string;
  description: string;
  synthetic: true;
  mode: PipelineMode;
  approxLocation: { latitude: number; longitude: number; precisionM: number };
  status: FusionStatus;
  reviewPriority: ReviewPriority;
  evidenceStrength: EvidenceStrength;
  independentSupportCount: number;
  explanation: string[];
  contradictions: FusionContradiction[];
  gaps: FusionGap[];
  /** Source agents' findings (witness, vision, satellite, weather), in pipeline order. */
  findings: DemoFinding[];
  agentSteps: DemoAgentStep[];
  rulesVersion: string;
  disclaimer: typeof DEMO_DISCLAIMER;
};

/** Decimal places whose grid is at least as coarse as `precisionM`. */
export function decimalsForPrecision(precisionM: number): number {
  const decimals = Math.floor(Math.log10(METRES_PER_DEGREE_LAT / precisionM));
  return Math.min(5, Math.max(0, decimals));
}

/** Round to a public precision (never finer than DEMO_MIN_PUBLIC_PRECISION_M). */
export function toApproxLocation(location: RawScenario["location"]): DemoInvestigation["approxLocation"] {
  const precisionM = Math.max(DEMO_MIN_PUBLIC_PRECISION_M, location.precisionM);
  const factor = 10 ** decimalsForPrecision(precisionM);
  // `+ 0` normalises -0, so JSON round-trips deep-equal.
  const round = (v: number) => Math.round(v * factor) / factor + 0;
  return { latitude: round(location.latitude), longitude: round(location.longitude), precisionM };
}

/**
 * Run every raw scenario through the pipeline and return the dashboard shape.
 * Deterministic: each scenario gets fresh deps from `makeDeps`, so repeated
 * calls return deep-equal output.
 */
export async function buildDemoInvestigations(
  makeDeps: (scenarioId: string) => AgentDeps = createRawScenarioDeps,
): Promise<DemoInvestigation[]> {
  const out: DemoInvestigation[] = [];
  for (const scenario of RAW_SCENARIOS) {
    const result = await runRawScenario(scenario, makeDeps(scenario.id));
    const rec = result.recommendation;
    out.push({
      id: scenario.investigationId,
      title: `${scenario.title} (synthetic)`,
      description: scenario.description,
      synthetic: true,
      mode: result.mode,
      approxLocation: toApproxLocation(scenario.location),
      status: rec.status,
      reviewPriority: rec.reviewPriority,
      evidenceStrength: rec.evidenceStrength,
      independentSupportCount: rec.independentSupportCount,
      explanation: [...rec.explanation],
      contradictions: rec.contradictions.map((c) => ({ agents: [...c.agents], explanation: c.explanation })),
      gaps: rec.gaps.map((g) => ({ agentId: g.agentId, reason: g.reason })),
      findings: result.findings.map((f) => ({
        agentId: f.agentId,
        assessment: f.assessment,
        reasonCodes: [...f.reasonCodes],
        explanation: f.explanation,
        limitations: [...f.limitations],
      })),
      agentSteps: result.steps.map((s) => ({
        agentId: s.agentId,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        status: s.status,
      })),
      rulesVersion: rec.rulesVersion,
      disclaimer: DEMO_DISCLAIMER,
    });
  }
  return out;
}
