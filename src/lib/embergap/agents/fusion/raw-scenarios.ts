/**
 * LABELLED SYNTHETIC raw scenarios. Unlike `FUSION_SCENARIOS` (hand-written
 * findings), these start from RAW inputs (witness reports, a vision fixture
 * image ref, and synthetic satellite/weather findings standing in for other
 * teams' agents) and run through the REAL witness and vision validators via
 * `runValidationPipeline`.
 *
 * Every report, reporter, id, timestamp and coordinate here is invented. The
 * area is a fictional demo location ("Emberwood Ridge"); no scenario describes
 * a real incident or a real person. `groundTruth` is the label the scenario
 * author assigned, and the scenarios were written alongside the rules, so
 * results show behaviour, not real-world accuracy.
 */
import type {
  AgentDeps,
  AgentFinding,
  Assessment,
  WitnessReport,
} from "@/lib/embergap/agents/validators/types";
import type { VisionAnalyzer } from "@/lib/embergap/agents/validators/vision/analyzer";
import { createMockVisionAnalyzer, type VisionFixtureId } from "@/lib/embergap/agents/validators/vision/mock";
import {
  evaluateScenarios,
  fusionStrategy,
  singleSourceBaseline,
  type EvaluationReport,
} from "./evaluate";
import { runValidationPipeline, type PipelineResult } from "./pipeline";
import type { FusionScenario, GroundTruth } from "./scenarios";
import type { FusionInput } from "./types";

/** Fictional demo area centre. Coordinates are synthetic and already approximate. */
export const DEMO_AREA = Object.freeze({
  name: "Emberwood Ridge (fictional demo area)",
  latitude: 53.42,
  longitude: -1.78,
});

/** Vision timeout used by the "vision-timeout" scenario (ms). Short so demos stay fast. */
export const RAW_SCENARIO_VISION_TIMEOUT_MS = 25;

export type RawScenario = {
  id: string;
  title: string;
  /** Always true: these are labelled synthetic fixtures. */
  synthetic: true;
  description: string;
  groundTruth: GroundTruth;
  investigationId: string;
  /** Synthetic, approximate scenario location (the demo export coarsens it further). */
  location: { latitude: number; longitude: number; precisionM: number };
  witnessReports: WitnessReport[];
  vision?: { imageRef: VisionFixtureId; reportDescription?: string; evidenceIds: string[] };
  /** "timeout": the analyzer never answers, so the pipeline's vision timeout fires. */
  visionBehaviour?: "fixture" | "timeout";
  externalFindings: AgentFinding[];
  sourceStates?: FusionInput["sourceStates"];
  expected: FusionScenario["expected"] & {
    /** Distinct coherent witness source groups the witness validator should count. */
    witnessIndependentCount: number;
    /** Reason codes the vision finding must carry, or null when no photo was submitted. */
    visionReasonCodes: string[] | null;
  };
};

const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

type ReportSpec = {
  n: number;
  reporter: string;
  minute: number;
  /** Offsets from the scenario centre, in degrees. */
  dLat?: number;
  dLon?: number;
  text: string;
  photo?: string;
};

type ExternalSpec = {
  agentId: "satellite" | "weather";
  assessment: Assessment;
  reasonCodes: string[];
  minute: number;
  explanation: string;
};

function build(
  id: string,
  offset: { dLat: number; dLon: number },
  meta: Pick<RawScenario, "title" | "description" | "groundTruth" | "expected" | "sourceStates" | "visionBehaviour"> & {
    reports: ReportSpec[];
    vision?: { imageRef: VisionFixtureId; reportDescription?: string; fromReport: number };
    external?: ExternalSpec[];
  },
): RawScenario {
  const investigationId = `syn-raw-${id}`;
  const latitude = DEMO_AREA.latitude + offset.dLat;
  const longitude = DEMO_AREA.longitude + offset.dLon;
  const reportId = (n: number) => `syn-raw-${id}-report-${n}`;
  const witnessReports: WitnessReport[] = meta.reports.map((r) => ({
    id: reportId(r.n),
    investigationId,
    reporterId: `syn-reporter-${r.reporter}`,
    observedAt: at(r.minute),
    submittedAt: at(r.minute + 5),
    latitude: latitude + (r.dLat ?? 0),
    longitude: longitude + (r.dLon ?? 0),
    locationPrecisionM: 500,
    description: r.text,
    ...(r.photo ? { photoSha256: r.photo } : {}),
  }));
  const externalFindings: AgentFinding[] = (meta.external ?? []).map((e) => ({
    id: `syn-raw-${id}-${e.agentId}`,
    investigationId,
    agentId: e.agentId,
    createdAt: at(e.minute),
    evidenceIds: [`syn-raw-${id}-${e.agentId}-obs`],
    assessment: e.assessment,
    reasonCodes: e.reasonCodes,
    explanation: `SYNTHETIC ${e.agentId} finding: ${e.explanation}`,
    limitations: ["Synthetic fixture standing in for another team's agent; not real data."],
  }));
  return {
    id,
    title: meta.title,
    synthetic: true,
    description: meta.description,
    groundTruth: meta.groundTruth,
    investigationId,
    location: { latitude, longitude, precisionM: 500 },
    witnessReports,
    ...(meta.vision
      ? {
          vision: {
            imageRef: meta.vision.imageRef,
            ...(meta.vision.reportDescription ? { reportDescription: meta.vision.reportDescription } : {}),
            evidenceIds: [reportId(meta.vision.fromReport)],
          },
        }
      : {}),
    ...(meta.visionBehaviour ? { visionBehaviour: meta.visionBehaviour } : {}),
    externalFindings,
    ...(meta.sourceStates ? { sourceStates: meta.sourceStates } : {}),
    expected: meta.expected,
  };
}

const SAT_ANOMALY: Omit<ExternalSpec, "minute"> = {
  agentId: "satellite",
  assessment: "supports",
  reasonCodes: ["satellite.thermal_anomaly"],
  explanation: "a thermal anomaly within the search radius during a recent overpass.",
};
const SAT_NO_DETECTION: Omit<ExternalSpec, "minute"> = {
  agentId: "satellite",
  assessment: "inconclusive",
  reasonCodes: ["satellite.no_detection"],
  explanation: "no thermal anomaly detected; small or obscured fires are often missed.",
};
const WEATHER = {
  dryWindy: {
    agentId: "weather",
    assessment: "supports",
    reasonCodes: ["weather.dry_windy"],
    explanation: "warm, dry and windy conditions (context only).",
  },
  humid: {
    agentId: "weather",
    assessment: "inconclusive",
    reasonCodes: ["weather.humid"],
    explanation: "humid, low-wind conditions (context only).",
  },
  calm: {
    agentId: "weather",
    assessment: "inconclusive",
    reasonCodes: ["weather.calm"],
    explanation: "calm conditions (context only).",
  },
  rain: {
    agentId: "weather",
    assessment: "contradicts",
    reasonCodes: ["weather.active_precipitation"],
    explanation: "moderate rain reported for the coarse forecast grid cell at the observed time.",
  },
} as const satisfies Record<string, Omit<ExternalSpec, "minute">>;

const COPIED_TEXT = "Thick grey smoke rising above the pine ridge east of the reservoir track";

export const RAW_SCENARIOS: readonly RawScenario[] = [
  build("genuine-fire", { dLat: 0, dLon: 0 }, {
    title: "Genuine fire: three reports (one copy-pasted), smoke photo, satellite anomaly",
    description:
      "Two independent reporters plus a third who copy-pasted the first report's text. Vision sees a clear smoke column; a synthetic satellite finding reports a thermal anomaly; weather is dry and windy.",
    groundTruth: "fire",
    reports: [
      { n: 1, reporter: "a", minute: 0, text: COPIED_TEXT, photo: "syn-photo-genuine-1" },
      { n: 2, reporter: "b", minute: 12, dLat: 0.012, dLon: -0.01, text: "Column of smoke visible from the village road, drifting north" },
      { n: 3, reporter: "c", minute: 20, dLat: -0.008, text: COPIED_TEXT },
    ],
    vision: { imageRef: "fixture:vision/clear-smoke-column", fromReport: 1 },
    external: [
      { ...SAT_ANOMALY, minute: 25 },
      { ...WEATHER.dryWindy, minute: 2 },
    ],
    expected: {
      status: "needs_human_review",
      evidenceStrength: "strong",
      reviewPriority: "high",
      gapAgents: [],
      hasContradiction: false,
      witnessIndependentCount: 2,
      visionReasonCodes: ["vision.smoke_visible"],
    },
  }),
  build("fog-photo", { dLat: 0.05, dLon: 0.06 }, {
    title: "Fog photo only (misleading)",
    description:
      "One reporter photographs a white layer in a valley. Vision lists fog as a look-alike, the satellite reports no detection (a gap) and weather is humid.",
    groundTruth: "no_fire",
    reports: [{ n: 1, reporter: "d", minute: 3, text: "White smoke filling the whole valley below the farm", photo: "syn-photo-fog-1" }],
    vision: { imageRef: "fixture:vision/fog-bank", fromReport: 1 },
    external: [
      { ...SAT_NO_DETECTION, minute: 30 },
      { ...WEATHER.humid, minute: 1 },
    ],
    expected: {
      status: "investigating",
      evidenceStrength: "weak",
      reviewPriority: "low",
      gapAgents: ["satellite"],
      hasContradiction: false,
      witnessIndependentCount: 1,
      visionReasonCodes: ["vision.ambiguous"],
    },
  }),
  build("missing-firms-pass", { dLat: -0.05, dLon: 0.06 }, {
    title: "Missing FIRMS pass: witnesses and smoke photo, no satellite overpass yet",
    description:
      "No satellite overpass has happened yet (not observed, a gap). Two independent witnesses and a clear smoke photo keep it reviewable.",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    reports: [
      { n: 1, reporter: "e", minute: 0, text: "Smoke coming up from the heather on the hillside above the quarry", photo: "syn-photo-firms-1" },
      { n: 2, reporter: "f", minute: 18, dLat: 0.01, dLon: 0.01, text: "Saw a brown haze and a smell of burning while cycling past the moor" },
    ],
    vision: { imageRef: "fixture:vision/clear-smoke-column", fromReport: 1 },
    external: [{ ...WEATHER.dryWindy, minute: 1 }],
    expected: {
      status: "needs_human_review",
      evidenceStrength: "moderate",
      reviewPriority: "medium",
      gapAgents: ["satellite"],
      hasContradiction: false,
      witnessIndependentCount: 2,
      visionReasonCodes: ["vision.smoke_visible"],
    },
  }),
  build("vision-timeout", { dLat: 0.05, dLon: -0.06 }, {
    title: "Vision timeout: witnesses and satellite still agree",
    description:
      "The vision analyzer never answers and the pipeline's timeout fires (a gap). Two independent witnesses and a satellite anomaly still agree.",
    groundTruth: "fire",
    visionBehaviour: "timeout",
    reports: [
      { n: 1, reporter: "g", minute: 0, text: "Orange glow and smoke behind the forestry plantation", photo: "syn-photo-timeout-1" },
      { n: 2, reporter: "h", minute: 9, dLat: -0.01, text: "Plume of smoke seen from the dam car park, getting bigger" },
    ],
    vision: { imageRef: "fixture:vision/flames-at-night", fromReport: 1 },
    external: [
      { ...SAT_ANOMALY, minute: 22 },
      { ...WEATHER.calm, minute: 1 },
    ],
    expected: {
      status: "needs_human_review",
      evidenceStrength: "moderate",
      reviewPriority: "medium",
      gapAgents: ["vision"],
      hasContradiction: false,
      witnessIndependentCount: 2,
      visionReasonCodes: ["vision.model_unavailable"],
    },
  }),
  build("same-reporter-spam", { dLat: -0.05, dLon: -0.06 }, {
    title: "Same reporter spamming three submissions",
    description:
      "One reporter submits three reports with a blurry photo. The witness agent groups them as one source; the satellite reports no detection (a gap).",
    groundTruth: "no_fire",
    reports: [
      { n: 1, reporter: "i", minute: 0, text: "Fire near the old barn, please look", photo: "syn-photo-spam-1" },
      { n: 2, reporter: "i", minute: 6, text: "Still burning by the barn, why has nobody come", photo: "syn-photo-spam-2" },
      { n: 3, reporter: "i", minute: 11, text: "Third report: definitely a fire at the barn" },
    ],
    vision: { imageRef: "fixture:vision/blurry-image", fromReport: 1 },
    external: [
      { ...SAT_NO_DETECTION, minute: 28 },
      { ...WEATHER.humid, minute: 1 },
    ],
    expected: {
      status: "investigating",
      evidenceStrength: "weak",
      reviewPriority: "low",
      gapAgents: ["satellite"],
      hasContradiction: false,
      witnessIndependentCount: 1,
      visionReasonCodes: ["vision.low_quality"],
    },
  }),
  build("industrial-chimney", { dLat: 0.1, dLon: 0 }, {
    title: "Industrial chimney false alarm",
    description:
      "Two neighbours independently report a plume. Vision flags industrial and steam look-alikes; the satellite reports no detection (a gap).",
    groundTruth: "no_fire",
    reports: [
      { n: 1, reporter: "j", minute: 0, text: "Big white plume over the industrial estate, looks like smoke", photo: "syn-photo-chimney-1" },
      { n: 2, reporter: "k", minute: 15, dLat: 0.005, dLon: 0.008, text: "Something is burning near the factory units by the canal" },
    ],
    vision: { imageRef: "fixture:vision/industrial-chimney", fromReport: 1 },
    external: [
      { ...SAT_NO_DETECTION, minute: 26 },
      { ...WEATHER.calm, minute: 1 },
    ],
    expected: {
      status: "investigating",
      evidenceStrength: "weak",
      reviewPriority: "low",
      gapAgents: ["satellite"],
      hasContradiction: false,
      witnessIndependentCount: 2,
      visionReasonCodes: ["vision.ambiguous"],
    },
  }),
  build("weather-contradiction", { dLat: -0.1, dLon: 0 }, {
    title: "Contradiction: smoke photo and witnesses, but weather reports rain",
    description:
      "Two independent witnesses and a clear smoke photo, but the synthetic weather finding reports rain for the coarse forecast grid cell. Fusion records the contradiction and escalates it to a human rather than resolving it.",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    reports: [
      { n: 1, reporter: "l", minute: 0, text: "Dark smoke over the woods south of the golf course", photo: "syn-photo-rain-1" },
      { n: 2, reporter: "m", minute: 14, dLat: -0.01, dLon: 0.006, text: "Can see flames through the trees from the bridleway" },
    ],
    vision: { imageRef: "fixture:vision/clear-smoke-column", fromReport: 1 },
    external: [{ ...WEATHER.rain, minute: 4 }],
    expected: {
      status: "needs_human_review",
      evidenceStrength: "moderate",
      reviewPriority: "high",
      gapAgents: ["satellite"],
      hasContradiction: true,
      witnessIndependentCount: 2,
      visionReasonCodes: ["vision.smoke_visible"],
    },
  }),
  build("single-early-witness", { dLat: 0, dLon: 0.12 }, {
    title: "Single early witness",
    description:
      "An early-stage fire seen by one person with a blurry photo, before any satellite overpass. Fusion keeps investigating at low priority (a known false-negative risk).",
    groundTruth: "fire",
    sourceStates: { satellite: "not_observed" },
    reports: [{ n: 1, reporter: "n", minute: 0, text: "Small fire just started in the dry grass by the footpath", photo: "syn-photo-early-1" }],
    vision: { imageRef: "fixture:vision/blurry-image", fromReport: 1 },
    external: [{ ...WEATHER.dryWindy, minute: 1 }],
    expected: {
      status: "investigating",
      evidenceStrength: "weak",
      reviewPriority: "low",
      gapAgents: ["satellite"],
      hasContradiction: false,
      witnessIndependentCount: 1,
      visionReasonCodes: ["vision.low_quality"],
    },
  }),
];

/**
 * Deterministic deps for one raw scenario: ids are `syn-raw-<id>-finding-N`
 * and the clock advances one second per call from a fixed synthetic start,
 * so the agent-step trace shows ordering.
 */
export function createRawScenarioDeps(scenarioId: string): AgentDeps {
  const start = Date.UTC(2026, 10, 7, 10, 0, 0);
  let ticks = 0;
  let ids = 0;
  return {
    now: () => new Date(start + ticks++ * 1000).toISOString(),
    newId: () => `syn-raw-${scenarioId}-finding-${++ids}`,
  };
}

/** Analyzer that never answers but honours abort, to exercise the vision timeout. */
function hangingAnalyzer(): VisionAnalyzer {
  return {
    id: "mock",
    analyze: (_input, signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Vision analysis aborted.")), { once: true });
      }),
  };
}

/** Run one raw scenario through the real validators and fusion (synthetic mode). */
export function runRawScenario(
  scenario: RawScenario,
  deps: AgentDeps = createRawScenarioDeps(scenario.id),
): Promise<PipelineResult> {
  const visionAnalyzer =
    scenario.visionBehaviour === "timeout" ? hangingAnalyzer() : createMockVisionAnalyzer();
  return runValidationPipeline(
    {
      investigationId: scenario.investigationId,
      witnessReports: scenario.witnessReports,
      ...(scenario.vision
        ? {
            vision: {
              imageRef: scenario.vision.imageRef,
              mimeType: "image/jpeg",
              evidenceIds: scenario.vision.evidenceIds,
              ...(scenario.vision.reportDescription
                ? { reportDescription: scenario.vision.reportDescription }
                : {}),
            },
          }
        : {}),
      externalFindings: scenario.externalFindings,
      ...(scenario.sourceStates ? { sourceStates: scenario.sourceStates } : {}),
      visionAnalyzer,
    },
    deps,
    { mode: "synthetic", visionTimeoutMs: RAW_SCENARIO_VISION_TIMEOUT_MS },
  );
}

export type RawEvaluation = {
  /** Source-aware fusion on the pipeline's findings. */
  fusion: EvaluationReport;
  /** Single-source baseline on the SAME findings. */
  baseline: EvaluationReport;
  /** The pipeline output per scenario, in RAW_SCENARIOS order. */
  pipelineResults: PipelineResult[];
};

/**
 * Run every raw scenario through the pipeline once, then evaluate fusion and
 * the single-source baseline on exactly the same findings. MEASURED counts
 * only: no rates or percentages, and the fixture set is small and
 * author-designed.
 */
export async function evaluateRawScenarios(
  scenarios: readonly RawScenario[] = RAW_SCENARIOS,
  makeDeps: (scenario: RawScenario) => AgentDeps = (s) => createRawScenarioDeps(s.id),
): Promise<RawEvaluation> {
  const pipelineResults: PipelineResult[] = [];
  for (const scenario of scenarios) pipelineResults.push(await runRawScenario(scenario, makeDeps(scenario)));

  const asFusionScenarios: FusionScenario[] = scenarios.map((s, i) => ({
    id: s.id,
    title: s.title,
    synthetic: true,
    description: s.description,
    groundTruth: s.groundTruth,
    input: pipelineResults[i].fusionInput,
    expected: {
      status: s.expected.status,
      evidenceStrength: s.expected.evidenceStrength,
      reviewPriority: s.expected.reviewPriority,
      gapAgents: s.expected.gapAgents,
      hasContradiction: s.expected.hasContradiction,
    },
  }));
  const deps = (s: FusionScenario) => createRawScenarioDeps(`${s.id}-eval`);
  return {
    fusion: evaluateScenarios(asFusionScenarios, fusionStrategy, deps),
    baseline: evaluateScenarios(asFusionScenarios, singleSourceBaseline, deps),
    pipelineResults,
  };
}
