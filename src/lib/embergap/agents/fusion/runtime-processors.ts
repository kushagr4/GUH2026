/**
 * Danil's validators and fusion as processors for Claude PC's agent runtime
 * (`agents/runtime/**`). The runtime owns ids, delivery, gossip, partitions and
 * reconciliation; these processors only turn a task plus the agent's LOCAL
 * evidence into canonical findings (`@/lib/embergap/contracts`).
 *
 * - `danilVisionProcessor` ("vision.assess") replaces the runtime's synthetic
 *   `visionStandIn`. It runs Danil's guardrails (`toVisionFinding`) on model
 *   output that the SERVER fetched before enqueueing, or on a labelled
 *   synthetic fixture.
 * - `danilFusionProcessor` ("fusion.fuse") runs `fuseFindings` over the
 *   findings the fusion agent itself holds, so during a partition it decides
 *   with what has reached it, and re-runs as gossip delivers more.
 * - `danilFusionOnEvidence` enqueues one fusion task per distinct evidence set.
 *
 * Processor rules (runtime/processors.ts): synchronous and pure, no I/O, never
 * invent missing evidence. Output is decision support for human review only.
 *
 * Imports runtime/processors directly, not runtime/index, so this module never
 * pulls the server-only partition demo into callers of the fusion index.
 */
import { z } from "zod";
import {
  idSchema,
  reasonCodeSchema,
  stableId,
  syntheticId,
  timestampSchema,
  VISION_REQUIRED_LIMITATIONS,
  type AgentFinding as CanonicalFinding,
  type FusionRecommendationInput,
  type LimitationCode,
  type Observation,
} from "@/lib/embergap/contracts";
import { fnv1a64 } from "@/lib/embergap/agents/runtime/hash";
import {
  defineProcessor,
  type EvidenceHook,
  type FindingDraft,
  type RuntimeMode,
  type TaskDraft,
  type TaskProcessor,
} from "@/lib/embergap/agents/runtime/processors";
import { VISION_LIMITATIONS, VISION_REASON, toVisionFinding } from "@/lib/embergap/agents/validators/vision/guardrails";
import { VISION_FIXTURES } from "@/lib/embergap/agents/validators/vision/mock";
import type { AgentDeps, AgentFinding } from "@/lib/embergap/agents/validators/types";
import { fuseFindings } from "./fuse";
import { STANDARD_LIMITATIONS } from "./rules";
import type { FusionRecommendation } from "./types";

// ---------------------------------------------------------------------------
// Canonical -> provisional
// ---------------------------------------------------------------------------

/**
 * Canonical finding to the provisional shape fusion consumes. `context`
 * becomes `inconclusive`: background never counts as support. Reason codes are
 * kept (fusion's rules understand the contract's well-known codes), and
 * limitation codes plus notes become plain strings.
 */
export function fromCanonicalFinding(f: CanonicalFinding): AgentFinding {
  return {
    id: f.id,
    investigationId: f.investigationId,
    agentId: f.agentId,
    createdAt: f.createdAt,
    evidenceIds: [...f.evidenceIds],
    assessment: f.assessment === "context" ? "inconclusive" : f.assessment,
    reasonCodes: [...f.reasonCodes],
    explanation: f.explanation,
    limitations: [...f.limitations, ...f.limitationNotes],
  };
}

/** A pure AgentDeps for code that discards the generated id (the runtime assigns real ids). */
const draftDeps = (nowIso: string): AgentDeps => ({ now: () => nowIso, newId: () => "runtime-draft" });

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

/** Provisional vision reason codes mapped to the contract's well-known codes where one exists. */
export const VISION_REASON_TO_CANONICAL: Readonly<Record<string, string>> = {
  [VISION_REASON.smokeVisible]: "smoke_like_features_visible",
  [VISION_REASON.noFireIndicators]: "no_smoke_like_features_visible",
  [VISION_REASON.lowQuality]: "image_unclear",
};

/** Danil's fixed vision caveats mapped to limitation codes. */
const VISION_LIMITATION_CODES: ReadonlyArray<[string, LimitationCode]> = [
  [VISION_LIMITATIONS.notCalibrated, "model_output_uncalibrated"],
  [VISION_LIMITATIONS.absenceIsWeak, "no_detection_is_not_absence"],
  [VISION_LIMITATIONS.gapUnavailable, "source_unavailable"],
  [VISION_LIMITATIONS.gapInvalid, "model_output_invalid"],
  [VISION_LIMITATIONS.claimStripped, "unverifiable_claim_removed"],
  [VISION_LIMITATIONS.descriptionWithheld, "description_withheld"],
];

const FIXTURE_KEYS = new Set(Object.keys(VISION_FIXTURES));
/** Synthetic-mode fallback when a stand-in style task carries no model output. */
const SYNTHETIC_FALLBACK = { smokeLike: "fixture:vision/clear-smoke-column", unclear: "fixture:vision/blurry-image" } as const;

export const danilVisionInputSchema = z.object({
  mediaId: idSchema,
  reportObservedAt: timestampSchema,
  labels: z.array(z.string().min(1).max(100)).max(30),
  smokeLike: z.boolean(),
  /**
   * Raw model output, fetched by the server BEFORE the task is enqueued, or a
   * VISION_FIXTURES key (synthetic mode only). Untrusted: the guardrails decide.
   */
  modelOutput: z.unknown().optional(),
  /** Model name for provenance, e.g. the Claude model id. */
  model: z.string().trim().min(1).max(100).optional(),
});
export type DanilVisionInput = z.infer<typeof danilVisionInputSchema>;

type ResolvedOutput = { raw: unknown; fixture: string | null };

function resolveModelOutput(input: DanilVisionInput, mode: RuntimeMode): ResolvedOutput {
  const { modelOutput } = input;
  if (typeof modelOutput === "string") {
    // Fixture keys are synthetic: a live run never resolves one, so it is invalid output.
    if (mode === "synthetic" && FIXTURE_KEYS.has(modelOutput)) {
      return { raw: structuredClone(VISION_FIXTURES[modelOutput as keyof typeof VISION_FIXTURES].output), fixture: modelOutput };
    }
    return { raw: undefined, fixture: null };
  }
  if (modelOutput === undefined && mode === "synthetic") {
    // A stand-in style task (labels + smokeLike only): pick the matching labelled fixture.
    const key = input.smokeLike ? SYNTHETIC_FALLBACK.smokeLike : SYNTHETIC_FALLBACK.unclear;
    return { raw: structuredClone(VISION_FIXTURES[key].output), fixture: key };
  }
  return { raw: modelOutput, fixture: null };
}

/** Map a provisional vision finding (from Danil's guardrails) to a canonical draft. */
export function toCanonicalVisionDraft(finding: AgentFinding, options: { isSynthetic: boolean }): FindingDraft {
  const invalid = finding.reasonCodes.includes(VISION_REASON.outputInvalid);
  const reasonCodes = [
    ...new Set(finding.reasonCodes.map((code) => VISION_REASON_TO_CANONICAL[code] ?? code)),
  ].filter((code) => reasonCodeSchema.safeParse(code).success);
  const limitations = new Set<LimitationCode>(VISION_REQUIRED_LIMITATIONS);
  for (const [note, code] of VISION_LIMITATION_CODES) if (finding.limitations.includes(note)) limitations.add(code);
  if (invalid) limitations.add("model_output_invalid");
  if (options.isSynthetic) limitations.add("synthetic_data");
  const directional = finding.assessment === "supports" || finding.assessment === "contradicts";
  return {
    assessment: finding.assessment,
    // A photo from the reporter is never more than weak on its own.
    strength: directional ? "weak" : null,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : [VISION_REASON.outputInvalid],
    limitations: [...limitations].slice(0, 20),
    limitationNotes: finding.limitations.map((note) => note.slice(0, 300)).slice(0, 10),
    evidenceIds: [...finding.evidenceIds],
    explanation: finding.explanation.trim() || "Vision assessment recorded without an explanation.",
  };
}

/**
 * "vision.assess": replaces the runtime's `visionStandIn`. Same input and
 * observation shape, plus optional `modelOutput`. Missing or invalid output
 * becomes inconclusive with `model_output_invalid`, except in synthetic mode,
 * where a task without `modelOutput` uses the labelled fixture matching
 * `smokeLike`, so the runtime demo's existing tasks keep working.
 */
export const danilVisionProcessor = defineProcessor({
  kind: "vision.assess",
  input: danilVisionInputSchema,
  run({ task, input, nowIso, mode }) {
    const { raw, fixture } = resolveModelOutput(input, mode);
    const isSynthetic = mode === "synthetic" || fixture !== null;
    const name = `vision/${task.investigationId}/${input.mediaId}`;
    const observation: Observation = {
      id: isSynthetic ? syntheticId(name) : stableId(name),
      investigationId: task.investigationId,
      source: "vision",
      sourceRecordId: input.mediaId,
      observedAt: input.reportObservedAt,
      retrievedAt: nowIso,
      location: null,
      coverage: null,
      sourceState: "available",
      provenance: {
        provider: "EmberGap vision validator",
        product: fixture ? `synthetic fixture ${fixture}` : (input.model ?? "vision model"),
        url: null,
        license: null,
        isSynthetic,
      },
      evidence: { mediaId: input.mediaId, model: fixture ? "synthetic-fixture" : (input.model ?? null), labels: input.labels, contentSha256: null },
    };
    const provisional = toVisionFinding(
      raw,
      { investigationId: task.investigationId, evidenceIds: [observation.id] },
      draftDeps(nowIso),
    );
    return { observations: [observation], findings: [toCanonicalVisionDraft(provisional, { isSynthetic })] };
  },
});

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

/** Contract recommendation from a provisional fusion result. Only direct support and real contradictions are listed. */
export function toCanonicalRecommendation(rec: FusionRecommendation): FusionRecommendationInput {
  const idsOfKind = (kind: "support" | "contradiction") =>
    rec.agents.flatMap((agent) => (agent.kind === kind && agent.findingId ? [agent.findingId] : []));
  return {
    recommendedStatus: rec.status,
    reviewPriority: rec.reviewPriority,
    independentSourceCount: rec.independentSupportCount,
    supportingFindingIds: idsOfKind("support").filter((id) => idSchema.safeParse(id).success),
    contradictingFindingIds: idsOfKind("contradiction").filter((id) => idSchema.safeParse(id).success),
    evidenceGaps: rec.gaps.map((gap) => `${gap.agentId}: ${gap.reason}`.slice(0, 300)).slice(0, 20),
    possibleDuplicateReportIds: [],
  };
}

function fusionExplanation(rec: FusionRecommendation, considered: number): string {
  const parts = [
    "Decision support for human review only; not an alert.",
    `The fusion agent fused the ${considered} source finding(s) it holds locally: ${rec.status} (${rec.reviewPriority} priority), evidence ${rec.evidenceStrength} from ${rec.independentSupportCount} independent source type(s).`,
  ];
  if (rec.gaps.length > 0) {
    parts.push(`Data gaps (unknown, not negative evidence): ${rec.gaps.map((g) => g.agentId).join(", ")}.`);
  }
  if (rec.contradictions.length > 0) {
    parts.push(`${rec.contradictions.length} contradiction(s) left for a human reviewer, not resolved automatically.`);
  }
  return parts.join(" ");
}

export const danilFusionInputSchema = z.object({
  /** Hash of the evidence set that triggered this run, for audit. Fusion reads evidence locally. */
  evidenceKey: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});

/**
 * "fusion.fuse": fuses the findings this agent holds for the task's
 * investigation and returns ONE fusion finding: assessment "context",
 * strength null, with the canonical recommendation.
 */
export const danilFusionProcessor = defineProcessor({
  kind: "fusion.fuse",
  input: danilFusionInputSchema,
  run({ task, evidence, nowIso, mode }) {
    const held = evidence.findings({ investigationId: task.investigationId }).filter((f) => f.agentId !== "fusion");
    const rec = fuseFindings(
      { investigationId: task.investigationId, findings: held.map(fromCanonicalFinding) },
      draftDeps(nowIso),
    );
    const isSynthetic = mode === "synthetic" || held.some((f) => f.isSynthetic);
    const limitations: LimitationCode[] = [
      "heuristic_thresholds_uncalibrated",
      ...(rec.gaps.length > 0 ? (["no_detection_is_not_absence"] as const) : []),
      ...(isSynthetic ? (["synthetic_data"] as const) : []),
    ];
    const finding: FindingDraft = {
      assessment: "context",
      strength: null,
      reasonCodes: rec.finding.reasonCodes.filter((code) => reasonCodeSchema.safeParse(code).success).slice(0, 20),
      limitations,
      limitationNotes: STANDARD_LIMITATIONS.map((note) => note.slice(0, 300)).slice(0, 10),
      evidenceIds: rec.finding.evidenceIds.filter((id) => evidence.hasRecord(id)).slice(0, 100),
      explanation: fusionExplanation(rec, held.length),
      recommendation: toCanonicalRecommendation(rec),
    };
    return { findings: [finding] };
  },
});

/** Stable 16-hex key of a set of finding ids. */
export function evidenceKey(findingIds: Iterable<string>): string {
  return fnv1a64([...new Set(findingIds)].sort().join("\n"));
}

/**
 * Evidence hook for the fusion agent: one `fusion.fuse` task per investigation
 * whose source findings changed, with an id derived from that exact set, so
 * each evidence set fuses exactly once and the agent's own fusion finding
 * (excluded from the key) never re-triggers it.
 */
export const danilFusionOnEvidence: EvidenceHook = ({ evidence, newEvents }) => {
  const touched = [
    ...new Set(
      newEvents
        .filter((event) => event.payload.kind === "finding" && event.payload.finding.agentId !== "fusion")
        .map((event) => event.investigationId),
    ),
  ].sort();
  return touched.flatMap((investigationId): TaskDraft[] => {
    const ids = evidence
      .findings({ investigationId })
      .filter((f) => f.agentId !== "fusion")
      .map((f) => f.id);
    if (ids.length === 0) return [];
    const key = evidenceKey(ids);
    return [{ id: `fusion:${investigationId}:${key}`, kind: "fusion.fuse", investigationId, input: { evidenceKey: key } }];
  });
};

/** Pass to `runPartitionDemo` / `createDemoAgents` as `processors`. */
export const DANIL_PROCESSORS: { vision: readonly TaskProcessor<never>[]; fusion: readonly TaskProcessor<never>[] } = {
  vision: [danilVisionProcessor] as unknown as TaskProcessor<never>[],
  fusion: [danilFusionProcessor] as unknown as TaskProcessor<never>[],
};

/** Pass to `runPartitionDemo` / `createDemoAgents` as `onEvidence`. */
export const DANIL_ON_EVIDENCE: { fusion: EvidenceHook } = { fusion: danilFusionOnEvidence };
