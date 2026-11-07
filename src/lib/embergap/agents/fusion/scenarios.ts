/**
 * LABELLED SYNTHETIC fusion scenarios. Every finding, id and timestamp here is
 * invented for testing and demonstration. None of it is real data, and no
 * scenario describes a real incident.
 *
 * `groundTruth` is the label the scenario author assigned to the synthetic
 * situation, so strategies can be evaluated on the same fixtures. These
 * scenarios were written alongside the fusion rules, so results on them show
 * behaviour, not real-world accuracy.
 */
import type {
  AgentFinding,
  AgentId,
  Assessment,
} from "@/lib/embergap/agents/validators/types";
import type {
  EvidenceStrength,
  FusionInput,
  FusionStatus,
  ReviewPriority,
  SourceAgentId,
} from "./types";

export type GroundTruth = "fire" | "no_fire";

export type FusionScenario = {
  id: string;
  title: string;
  /** Always true: these are labelled synthetic fixtures. */
  synthetic: true;
  description: string;
  groundTruth: GroundTruth;
  input: FusionInput;
  expected: {
    status: FusionStatus;
    evidenceStrength: EvidenceStrength;
    reviewPriority: ReviewPriority;
    gapAgents: SourceAgentId[];
    hasContradiction: boolean;
  };
};

const at = (minute: number) => {
  const d = new Date(Date.UTC(2026, 10, 7, 9, 0, 0));
  d.setUTCMinutes(minute);
  return d.toISOString();
};

function finding(
  investigationId: string,
  id: string,
  agentId: AgentId,
  assessment: Assessment,
  reasonCodes: string[],
  minute: number,
): AgentFinding {
  return {
    id: `syn-${investigationId}-${id}`,
    investigationId: `syn-${investigationId}`,
    agentId,
    createdAt: at(minute),
    evidenceIds: [`syn-obs-${investigationId}-${id}`],
    assessment,
    reasonCodes,
    explanation: `SYNTHETIC ${agentId} finding for scenario ${investigationId}.`,
    limitations: ["Synthetic fixture, not real data."],
  };
}

/** Builds one scenario; `inv` is reused as the investigation id suffix. */
function scenario(
  inv: string,
  meta: Omit<FusionScenario, "id" | "synthetic" | "input"> & {
    findings: (make: (id: string, agentId: AgentId, a: Assessment, codes: string[], minute: number) => AgentFinding) => AgentFinding[];
    sourceStates?: FusionInput["sourceStates"];
  },
): FusionScenario {
  const make = (id: string, agentId: AgentId, a: Assessment, codes: string[], minute: number) =>
    finding(inv, id, agentId, a, codes, minute);
  return {
    id: inv,
    title: meta.title,
    synthetic: true,
    description: meta.description,
    groundTruth: meta.groundTruth,
    input: {
      investigationId: `syn-${inv}`,
      findings: meta.findings(make),
      ...(meta.sourceStates ? { sourceStates: meta.sourceStates } : {}),
    },
    expected: meta.expected,
  };
}

export const FUSION_SCENARIOS: readonly FusionScenario[] = [
  scenario("genuine-fire", {
    title: "Genuine fire with full corroboration",
    description: "Independent witnesses, visible smoke, a satellite thermal anomaly and dry windy weather.",
    groundTruth: "fire",
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 5),
      m("v", "vision", "supports", ["vision.smoke_visible", "vision.flame_visible"], 6),
      m("s", "satellite", "supports", ["satellite.thermal_anomaly"], 12),
      m("we", "weather", "supports", ["weather.dry_windy"], 3),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "strong", reviewPriority: "high", gapAgents: [], hasContradiction: false },
  }),
  scenario("fog-photo", {
    title: "Misleading smoke photo (fog), no other support",
    description: "One reporter photographs valley fog; vision describes it as smoke. No satellite detection, humid weather.",
    groundTruth: "no_fire",
    findings: (m) => [
      m("w", "witness", "inconclusive", ["witness.single_report"], 5),
      m("v", "vision", "supports", ["vision.smoke_visible"], 6),
      m("s", "satellite", "contradicts", ["satellite.no_detection"], 20),
      m("we", "weather", "inconclusive", ["weather.humid"], 4),
    ],
    expected: { status: "investigating", evidenceStrength: "weak", reviewPriority: "low", gapAgents: ["satellite"], hasContradiction: false },
  }),
  scenario("missing-firms-pass", {
    title: "Missing FIRMS pass, witnesses and vision agree",
    description: "No satellite overpass yet. Corroborating witnesses and visible smoke keep it reviewable; the satellite gap is noted.",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 8),
      m("v", "vision", "supports", ["vision.smoke_visible"], 7),
      m("we", "weather", "supports", ["weather.dry_windy"], 2),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "moderate", reviewPriority: "medium", gapAgents: ["satellite"], hasContradiction: false },
  }),
  scenario("vision-timeout", {
    title: "Vision API timeout",
    description: "The vision model is unavailable; witnesses and a satellite anomaly still agree.",
    groundTruth: "fire",
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 8),
      m("v", "vision", "inconclusive", ["vision.model_unavailable"], 9),
      m("s", "satellite", "supports", ["satellite.thermal_anomaly"], 15),
      m("we", "weather", "inconclusive", ["weather.calm"], 2),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "moderate", reviewPriority: "medium", gapAgents: ["vision"], hasContradiction: false },
  }),
  scenario("repeated-witness", {
    title: "Repeated witness (same reporter, three submissions)",
    description: "One reporter submits steam from a field three times. The witness agent marks duplicates; it stays one weak signal.",
    groundTruth: "no_fire",
    findings: (m) => [
      m("w1", "witness", "inconclusive", ["witness.single_report"], 5),
      m("w2", "witness", "inconclusive", ["witness.single_report", "witness.duplicate_submission"], 9),
      m("w3", "witness", "inconclusive", ["witness.single_report", "witness.duplicate_submission"], 14),
      m("v", "vision", "inconclusive", ["vision.ambiguous"], 6),
      m("s", "satellite", "contradicts", ["satellite.no_detection"], 20),
      m("we", "weather", "inconclusive", ["weather.humid"], 2),
    ],
    expected: { status: "investigating", evidenceStrength: "weak", reviewPriority: "low", gapAgents: ["satellite"], hasContradiction: false },
  }),
  (() => {
    const base = scenario("duplicate-delivery", {
      title: "Duplicate message delivery",
      description: "Every finding is delivered twice by an at-least-once transport. Each must be applied once.",
      groundTruth: "fire",
      findings: (m) => [
        m("w", "witness", "supports", ["witness.independent_corroboration"], 5),
        m("v", "vision", "supports", ["vision.smoke_visible"], 6),
        m("s", "satellite", "supports", ["satellite.thermal_anomaly"], 11),
      ],
      expected: { status: "needs_human_review", evidenceStrength: "strong", reviewPriority: "high", gapAgents: ["weather"], hasContradiction: false },
    });
    const once = base.input.findings;
    return { ...base, input: { ...base.input, findings: [...once, ...once.map((x) => ({ ...x }))] } };
  })(),
  scenario("out-of-order", {
    title: "Out-of-order findings",
    description: "A vision retry succeeds after a timeout, but the messages arrive newest first. The latest finding is used; the earlier one stays in the audit.",
    groundTruth: "fire",
    sourceStates: { satellite: "unavailable" },
    findings: (m) => [
      m("v2", "vision", "supports", ["vision.smoke_visible"], 18),
      m("we", "weather", "supports", ["weather.dry_windy"], 1),
      m("v1", "vision", "inconclusive", ["vision.model_unavailable"], 7),
      m("w", "witness", "supports", ["witness.independent_corroboration"], 4),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "moderate", reviewPriority: "medium", gapAgents: ["satellite"], hasContradiction: false },
  }),
  scenario("offline-weather", {
    title: "Offline agent (weather never arrives)",
    description: "The weather agent is partitioned and never reports. Witnesses and satellite agree; vision is low quality.",
    groundTruth: "fire",
    sourceStates: { weather: "unavailable" },
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 6),
      m("v", "vision", "inconclusive", ["vision.low_quality"], 7),
      m("s", "satellite", "supports", ["satellite.thermal_anomaly"], 13),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "moderate", reviewPriority: "medium", gapAgents: ["weather"], hasContradiction: false },
  }),
  scenario("contradictory", {
    title: "Contradictory evidence",
    description: "Witnesses agree, but vision sees no fire indicators in the submitted photo (pointed away from the smoke). Must go to a human.",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 6),
      m("v", "vision", "contradicts", ["vision.no_fire_indicators"], 7),
      m("we", "weather", "supports", ["weather.dry_windy"], 2),
    ],
    expected: { status: "needs_human_review", evidenceStrength: "weak", reviewPriority: "high", gapAgents: ["satellite"], hasContradiction: true },
  }),
  scenario("industrial-chimney", {
    title: "Industrial chimney false alarm",
    description: "Several neighbours independently report a plume from a factory chimney. Vision flags industrial smoke as ambiguous; no satellite detection.",
    groundTruth: "no_fire",
    findings: (m) => [
      m("w", "witness", "supports", ["witness.independent_corroboration"], 6),
      m("v", "vision", "inconclusive", ["vision.ambiguous"], 7),
      m("s", "satellite", "contradicts", ["satellite.no_detection"], 16),
      m("we", "weather", "inconclusive", ["weather.calm"], 2),
    ],
    expected: { status: "investigating", evidenceStrength: "weak", reviewPriority: "low", gapAgents: ["satellite"], hasContradiction: false },
  }),
  scenario("weather-only", {
    title: "Fire-conducive weather only",
    description: "Hot, dry, windy conditions and nothing else. Weather alone can never exceed weak.",
    groundTruth: "no_fire",
    findings: (m) => [m("we", "weather", "supports", ["weather.dry_windy"], 1)],
    expected: { status: "investigating", evidenceStrength: "weak", reviewPriority: "low", gapAgents: ["satellite", "vision", "witness"], hasContradiction: false },
  }),
  scenario("single-reporter-early-fire", {
    title: "Early fire seen by one reporter only",
    description: "A real early-stage fire seen by one person with a blurry photo and no satellite pass yet. Fusion keeps investigating at low priority (a known false-negative risk).",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    findings: (m) => [
      m("w", "witness", "inconclusive", ["witness.single_report"], 5),
      m("v", "vision", "inconclusive", ["vision.low_quality"], 6),
      m("we", "weather", "supports", ["weather.dry_windy"], 2),
    ],
    expected: { status: "investigating", evidenceStrength: "weak", reviewPriority: "low", gapAgents: ["satellite"], hasContradiction: false },
  }),
];
