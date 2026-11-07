import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_SCENARIOS,
  VISION_REQUIRED_LIMITATIONS,
  agentFindingSchema,
  fusionRecommendationSchema,
  syntheticId,
  type AgentFinding as CanonicalFinding,
  type AgentFindingInput,
} from "@/lib/embergap/contracts";
import { createDeterministicDeps, fuseFindings } from "@/lib/embergap/agents/fusion";
import { FUSION_RULES_VERSION, GAP_REASON_CODES } from "@/lib/embergap/agents/fusion/rules";
import {
  DANIL_ON_EVIDENCE,
  DANIL_PROCESSORS,
  danilFusionOnEvidence,
  danilFusionProcessor,
  danilVisionInputSchema,
  danilVisionProcessor,
  evidenceKey,
  fromCanonicalFinding,
  toCanonicalRecommendation,
} from "@/lib/embergap/agents/fusion/runtime-processors";
import { runPartitionDemo, type PartitionDemoResult } from "@/lib/embergap/agents/runtime";
import type {
  EvidenceView,
  FindingDraft,
  ProcessorContext,
  RuntimeMode,
  TaskProcessor,
} from "@/lib/embergap/agents/runtime/processors";
import type { RuntimeEvent } from "@/lib/embergap/agents/runtime/types";
import { VISION_LIMITATIONS } from "@/lib/embergap/agents/validators/vision/guardrails";
import { VISION_FIXTURES } from "@/lib/embergap/agents/validators/vision/mock";

const INV = syntheticId("runtime-processors-test/investigation");
const NOW = "2026-11-07T12:00:00.000Z";
const deps = () => createDeterministicDeps("runtime-processors-test");

let seq = 0;
function canonical(partial: Partial<AgentFindingInput> & Pick<AgentFindingInput, "agentId" | "assessment" | "reasonCodes">): CanonicalFinding {
  seq += 1;
  const directional = partial.assessment === "supports" || partial.assessment === "contradicts";
  return agentFindingSchema.parse({
    id: syntheticId(`runtime-processors-test/finding/${seq}`),
    investigationId: INV,
    createdAt: `2026-11-07T11:${String(10 + seq).padStart(2, "0")}:00.000Z`,
    evidenceIds: [syntheticId(`runtime-processors-test/obs/${seq}`)],
    strength: directional ? "weak" : null,
    explanation: "SYNTHETIC test finding.",
    limitations: [],
    recommendation: null,
    isSynthetic: true,
    ...partial,
  });
}

function evidenceOf(findings: CanonicalFinding[], records: string[] = []): EvidenceView {
  const ids = new Set([...findings.map((f) => f.id), ...findings.flatMap((f) => f.evidenceIds), ...records]);
  return {
    events: () => [],
    observations: () => [],
    findings: (filter) => findings.filter((f) => !filter?.investigationId || f.investigationId === filter.investigationId),
    hasRecord: (id) => ids.has(id),
  };
}

function context<I>(processor: TaskProcessor<I>, rawInput: unknown, options: { mode?: RuntimeMode; evidence?: EvidenceView } = {}): ProcessorContext<I> {
  const input = processor.input.parse(rawInput);
  return {
    agentId: processor.kind.split(".")[0],
    task: { id: `${INV}:${processor.kind}`, investigationId: INV, kind: processor.kind, input },
    input,
    now: 0,
    nowIso: NOW,
    mode: options.mode ?? "synthetic",
    evidence: options.evidence ?? evidenceOf([]),
    upstream: [],
  };
}

/** Fill in what the runtime adds, then validate with the contract like the runtime does. */
function complete(draft: FindingDraft, agentId: CanonicalFinding["agentId"]): CanonicalFinding {
  return agentFindingSchema.parse({
    ...draft,
    id: syntheticId(`runtime-processors-test/draft/${agentId}/${++seq}`),
    investigationId: INV,
    agentId,
    createdAt: NOW,
    isSynthetic: true,
    evidenceIds: draft.evidenceIds ?? [],
    recommendation: draft.recommendation ?? null,
  });
}

const MEDIA = syntheticId("runtime-processors-test/media");
const visionInput = (extra: Record<string, unknown> = {}) => ({
  mediaId: MEDIA,
  reportObservedAt: "2026-11-07T11:40:00.000Z",
  labels: ["smoke plume"],
  smokeLike: true,
  ...extra,
});
const runVision = (extra: Record<string, unknown> = {}, mode: RuntimeMode = "synthetic") => {
  const result = danilVisionProcessor.run(context(danilVisionProcessor, visionInput(extra), { mode }));
  return { result, finding: complete(result.findings![0], "vision") };
};

describe("fromCanonicalFinding", () => {
  it("maps context to inconclusive, keeps reason codes and flattens limitations", () => {
    const weather = canonical({
      agentId: "weather",
      assessment: "context",
      reasonCodes: ["dry_or_windy_conditions"],
      limitations: ["weather_is_context_only"],
      limitationNotes: ["Model output, not station data."],
    });
    const out = fromCanonicalFinding(weather);
    expect(out.assessment).toBe("inconclusive");
    expect(out.reasonCodes).toEqual(["dry_or_windy_conditions"]);
    expect(out.limitations).toEqual(["weather_is_context_only", "Model output, not station data."]);
    expect(out.id).toBe(weather.id);
    expect(out.agentId).toBe("weather");
  });
});

describe("fusion over canonical findings", () => {
  const fuse = (findings: CanonicalFinding[]) =>
    fuseFindings({ investigationId: INV, findings: findings.map(fromCanonicalFinding) }, deps());

  it("treats the contract's absence codes as gaps, never contradictions", () => {
    expect(FUSION_RULES_VERSION).toBe("fusion-rules/1.1.0");
    for (const code of ["satellite_pass_gap", "no_thermal_detection_in_window", "source_unavailable", "source_stale"]) {
      expect(GAP_REASON_CODES.has(code)).toBe(true);
    }
    const rec = fuse([
      canonical({ agentId: "satellite", assessment: "inconclusive", reasonCodes: ["no_thermal_detection_in_window"], limitations: ["no_detection_is_not_absence"] }),
      canonical({ agentId: "weather", assessment: "inconclusive", reasonCodes: ["source_unavailable"], limitations: ["weather_is_context_only", "source_unavailable"] }),
      canonical({ agentId: "vision", assessment: "inconclusive", reasonCodes: ["source_stale"], limitations: [...VISION_REQUIRED_LIMITATIONS] }),
      canonical({ agentId: "witness", assessment: "inconclusive", reasonCodes: ["satellite_pass_gap"], limitations: ["no_detection_is_not_absence"] }),
    ]);
    expect(rec.gaps.map((g) => g.agentId).sort()).toEqual(["satellite", "vision", "weather", "witness"]);
    expect(rec.contradictions).toEqual([]);
    expect(rec.status).toBe("insufficient_evidence");
  });

  it("counts the contract's well-known support codes as independent support", () => {
    const rec = fuse([
      canonical({ agentId: "satellite", assessment: "supports", reasonCodes: ["thermal_anomaly_nearby"] }),
      canonical({ agentId: "vision", assessment: "supports", reasonCodes: ["smoke_like_features_visible"], limitations: [...VISION_REQUIRED_LIMITATIONS] }),
      canonical({ agentId: "witness", assessment: "supports", reasonCodes: ["independent_reports_nearby"] }),
      canonical({ agentId: "weather", assessment: "context", reasonCodes: ["dry_or_windy_conditions"], limitations: ["weather_is_context_only"] }),
    ]);
    expect(rec.independentSupportCount).toBe(3);
    expect(rec.agents.find((a) => a.agentId === "satellite")?.kind).toBe("support");
    expect(rec.agents.find((a) => a.agentId === "witness")?.kind).toBe("support");
    expect(rec.agents.find((a) => a.agentId === "weather")?.kind).not.toBe("support");
    expect(rec.evidenceStrength).toBe("strong");
    expect(rec.status).toBe("needs_human_review");
  });

  it("a single canonical witness without corroboration stays a weak signal", () => {
    const rec = fuse([canonical({ agentId: "witness", assessment: "supports", reasonCodes: ["witness.single_report"] })]);
    expect(rec.agents.find((a) => a.agentId === "witness")?.kind).toBe("weak_signal");
    expect(rec.independentSupportCount).toBe(0);
  });
});

describe("danilVisionProcessor", () => {
  it("accepts the runtime stand-in's input unchanged", () => {
    expect(danilVisionInputSchema.safeParse({ mediaId: MEDIA, reportObservedAt: NOW, labels: [], smokeLike: false }).success).toBe(true);
    expect(danilVisionProcessor.kind).toBe("vision.assess");
    expect(danilVisionProcessor.syntheticOnly).toBeUndefined();
  });

  it("maps a clear-smoke fixture to a valid canonical supports finding with the required limitations", () => {
    const { result, finding } = runVision({ modelOutput: "fixture:vision/clear-smoke-column" });
    expect(finding.assessment).toBe("supports");
    expect(finding.strength).toBe("weak");
    expect(finding.reasonCodes).toEqual(["smoke_like_features_visible"]);
    for (const code of VISION_REQUIRED_LIMITATIONS) expect(finding.limitations).toContain(code);
    expect(finding.limitations).toContain("synthetic_data");
    expect(finding.limitations).toContain("model_output_uncalibrated");
    const observation = result.observations![0];
    expect(finding.evidenceIds).toEqual([observation.id]);
    expect(observation.provenance.provider).toBe("EmberGap vision validator");
    expect(observation.provenance.isSynthetic).toBe(true);
  });

  it("maps no indicators and low quality to the contract's well-known codes", () => {
    const none = runVision({ modelOutput: VISION_FIXTURES["fixture:vision/no-indicators"].output }).finding;
    expect(none.assessment).toBe("contradicts");
    expect(none.reasonCodes).toEqual(["no_smoke_like_features_visible"]);
    expect(none.limitations).toContain("no_detection_is_not_absence");
    const blurry = runVision({ modelOutput: "fixture:vision/blurry-image" }).finding;
    expect(blurry.assessment).toBe("inconclusive");
    expect(blurry.reasonCodes).toEqual(["image_unclear"]);
    expect(blurry.strength).toBeNull();
  });

  it("keeps namespaced codes where the contract has none, and records stripped claims", () => {
    expect(runVision({ modelOutput: "fixture:vision/fog-bank" }).finding.reasonCodes).toEqual(["vision.ambiguous"]);
    expect(runVision({ modelOutput: "fixture:vision/flames-at-night" }).finding.reasonCodes).toEqual(["vision.flame_visible"]);
    const claims = runVision({ modelOutput: "fixture:vision/claims-gps-and-authenticity" }).finding;
    expect(claims.reasonCodes).toEqual(["smoke_like_features_visible", "vision.unverifiable_claim_stripped"]);
    expect(claims.limitations).toContain("unverifiable_claim_removed");
  });

  it("never lets prompt-injection text through into the explanation", () => {
    const finding = runVision({ modelOutput: "fixture:vision/prompt-injection" }).finding;
    expect(finding.explanation).not.toMatch(/ignore|dispatch|evacuat|confirm/i);
    expect(finding.limitations).toContain("description_withheld");
  });

  it("gives inconclusive plus model_output_invalid for invalid output", () => {
    for (const modelOutput of [{ nonsense: true }, [1, 2], 42, "fixture:vision/does-not-exist", VISION_FIXTURES["fixture:vision/malformed-output"].output]) {
      const finding = runVision({ modelOutput }).finding;
      expect(finding.assessment, JSON.stringify(modelOutput)).toBe("inconclusive");
      expect(finding.reasonCodes).toEqual(["vision.output_invalid"]);
      expect(finding.limitations).toContain("model_output_invalid");
      expect(finding.limitationNotes).toContain(VISION_LIMITATIONS.gapInvalid);
    }
  });

  it("in live mode, missing output and synthetic fixture keys are invalid, never invented", () => {
    for (const extra of [{}, { modelOutput: "fixture:vision/clear-smoke-column" }]) {
      const { result, finding } = runVision(extra, "live");
      expect(finding.assessment).toBe("inconclusive");
      expect(finding.limitations).toContain("model_output_invalid");
      expect(finding.limitations).not.toContain("synthetic_data");
      expect(result.observations![0].provenance.isSynthetic).toBe(false);
      expect(result.observations![0].id.startsWith("00000000-")).toBe(false);
    }
  });

  it("live mode with real model output assesses it and records the model", () => {
    const { result, finding } = runVision({ modelOutput: VISION_FIXTURES["fixture:vision/clear-smoke-column"].output, model: "claude-test-model" }, "live");
    expect(finding.assessment).toBe("supports");
    expect(finding.limitations).not.toContain("synthetic_data");
    expect(result.observations![0].evidence).toMatchObject({ model: "claude-test-model" });
  });

  it("in synthetic mode, a stand-in style task falls back to the labelled fixture matching smokeLike", () => {
    expect(runVision({ smokeLike: true }).finding.reasonCodes).toEqual(["smoke_like_features_visible"]);
    expect(runVision({ smokeLike: false }).finding.reasonCodes).toEqual(["image_unclear"]);
  });

  it("is pure: the same input gives the same output", () => {
    expect(runVision({ modelOutput: "fixture:vision/fog-bank" }).result).toEqual(runVision({ modelOutput: "fixture:vision/fog-bank" }).result);
  });
});

describe("danilFusionProcessor", () => {
  const sat = canonical({ agentId: "satellite", assessment: "supports", reasonCodes: ["thermal_anomaly_nearby"] });
  const vis = canonical({ agentId: "vision", assessment: "supports", reasonCodes: ["smoke_like_features_visible"], limitations: [...VISION_REQUIRED_LIMITATIONS] });
  const wea = canonical({ agentId: "weather", assessment: "context", reasonCodes: ["dry_or_windy_conditions"], limitations: ["weather_is_context_only"] });

  it("returns one valid fusion finding: context, null strength, canonical recommendation", () => {
    const result = danilFusionProcessor.run(context(danilFusionProcessor, {}, { evidence: evidenceOf([sat, vis, wea]) }));
    expect(result.findings).toHaveLength(1);
    expect(result.observations).toBeUndefined();
    const finding = complete(result.findings![0], "fusion");
    expect(finding.assessment).toBe("context");
    expect(finding.strength).toBeNull();
    const rec = fusionRecommendationSchema.parse(finding.recommendation);
    expect(rec.recommendedStatus).toBe("needs_human_review");
    expect(rec.reviewPriority).toBe("medium");
    expect(rec.independentSourceCount).toBe(2);
    expect(rec.supportingFindingIds.sort()).toEqual([sat.id, vis.id].sort());
    expect(rec.contradictingFindingIds).toEqual([]);
    expect(rec.evidenceGaps).toEqual([expect.stringMatching(/^witness: /)]);
    expect(rec.possibleDuplicateReportIds).toEqual([]);
    expect(finding.explanation).toMatch(/human review only/);
    expect(finding.explanation).not.toMatch(/confirm|dispatch|evacuat|%/i);
    expect(finding.limitations).toContain("synthetic_data");
  });

  it("matches fuseFindings over the same evidence, and ignores earlier fusion findings", () => {
    const earlier = canonical({
      agentId: "fusion",
      assessment: "context",
      reasonCodes: ["fusion.status.investigating"],
      recommendation: { recommendedStatus: "investigating", reviewPriority: "low", supportingFindingIds: [], contradictingFindingIds: [], evidenceGaps: [], possibleDuplicateReportIds: [] },
    });
    const result = danilFusionProcessor.run(context(danilFusionProcessor, {}, { evidence: evidenceOf([earlier, sat, vis, wea]) }));
    const expected = toCanonicalRecommendation(
      fuseFindings({ investigationId: INV, findings: [sat, vis, wea].map(fromCanonicalFinding) }, deps()),
    );
    expect(result.findings![0].recommendation).toEqual(expected);
    expect(result.findings![0].evidenceIds).not.toContain(earlier.id);
  });

  it("with no evidence, recommends insufficient_evidence and lists every source as a gap", () => {
    const finding = complete(danilFusionProcessor.run(context(danilFusionProcessor, {})).findings![0], "fusion");
    expect(finding.recommendation?.recommendedStatus).toBe("insufficient_evidence");
    expect(finding.recommendation?.evidenceGaps).toHaveLength(4);
    expect(finding.limitations).toContain("no_detection_is_not_absence");
  });

  it("keeps contradictions visible for a human", () => {
    const witness = canonical({ agentId: "witness", assessment: "supports", reasonCodes: ["independent_reports_nearby"] });
    const visNo = canonical({ agentId: "vision", assessment: "contradicts", reasonCodes: ["no_smoke_like_features_visible"], limitations: [...VISION_REQUIRED_LIMITATIONS] });
    const finding = complete(danilFusionProcessor.run(context(danilFusionProcessor, {}, { evidence: evidenceOf([sat, witness, visNo]) })).findings![0], "fusion");
    expect(finding.recommendation?.contradictingFindingIds).toEqual([visNo.id]);
    expect(finding.recommendation?.reviewPriority).toBe("high");
    expect(finding.explanation).toMatch(/contradiction/);
  });
});

describe("danilFusionOnEvidence", () => {
  const sat = canonical({ agentId: "satellite", assessment: "supports", reasonCodes: ["thermal_anomaly_nearby"] });
  const vis = canonical({ agentId: "vision", assessment: "supports", reasonCodes: ["smoke_like_features_visible"], limitations: [...VISION_REQUIRED_LIMITATIONS] });
  const fusionFinding = canonical({
    agentId: "fusion",
    assessment: "context",
    reasonCodes: ["fusion.status.investigating"],
    recommendation: { recommendedStatus: "investigating", reviewPriority: "low", supportingFindingIds: [], contradictingFindingIds: [], evidenceGaps: [], possibleDuplicateReportIds: [] },
  });
  const eventFor = (finding: CanonicalFinding) =>
    ({ investigationId: finding.investigationId, payload: { kind: "finding", finding } }) as unknown as RuntimeEvent;
  const hook = (held: CanonicalFinding[], fresh: CanonicalFinding[]) =>
    danilFusionOnEvidence({ agentId: "fusion", now: 0, mode: "synthetic", evidence: evidenceOf(held), newEvents: fresh.map(eventFor) });

  it("derives the task id from the evidence set, so each set fuses once", () => {
    const [task] = hook([sat], [sat]);
    expect(task).toMatchObject({ kind: "fusion.fuse", investigationId: INV, id: `fusion:${INV}:${evidenceKey([sat.id])}` });
    expect(hook([sat], [sat])).toEqual([task]);
    const [next] = hook([sat, vis], [vis]);
    expect(next.id).not.toBe(task.id);
    expect(evidenceKey([vis.id, sat.id])).toBe(evidenceKey([sat.id, vis.id]));
  });

  it("its own fusion finding never re-triggers fusion", () => {
    expect(hook([sat, fusionFinding], [fusionFinding])).toEqual([]);
    expect(hook([sat, fusionFinding], [sat])[0].id).toBe(hook([sat], [sat])[0].id);
  });

  it("is exported as the runtime's plug-in shape", () => {
    expect(DANIL_PROCESSORS.vision.map((p) => p.kind)).toEqual(["vision.assess"]);
    expect(DANIL_PROCESSORS.fusion.map((p) => p.kind)).toEqual(["fusion.fuse"]);
    expect(DANIL_ON_EVIDENCE.fusion).toBe(danilFusionOnEvidence);
  });
});

describe("integration: Claude PC's partition demo with Danil's processors", () => {
  afterEach(() => vi.unstubAllGlobals());

  const A = SYNTHETIC_SCENARIOS.find((s) => s.id === "partition-recovery")!.investigationId;
  const B = SYNTHETIC_SCENARIOS.find((s) => s.id === "weather-timeout")!.investigationId;
  const run = (runId = "danil-integration") => runPartitionDemo({ runId, processors: DANIL_PROCESSORS, onEvidence: DANIL_ON_EVIDENCE });
  const latestFusion = (result: PartitionDemoResult, investigationId: string) =>
    result.records!.findings
      .filter((f) => f.agentId === "fusion" && f.investigationId === investigationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .at(-1);

  it("keeps every demo check passing, makes no network calls, and is deterministic", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is not allowed in this test");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const first = await run();
    const second = await run();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first.complete).toBe(true);
    expect(first.checks.filter((c) => !c.passed)).toEqual([]);
    expect(first.checks).toHaveLength(6);
    expect(second.records).toEqual(first.records);
    expect(second.convergence.historyHashes).toEqual(first.convergence.historyHashes);
  });

  it("produces valid fusion findings with recommendations, fused during the partition and again after healing", async () => {
    const result = await run();
    const fusion = result.records!.findings.filter((f) => f.agentId === "fusion");
    expect(fusion.length).toBeGreaterThan(2);
    for (const f of fusion) {
      expect(agentFindingSchema.safeParse(f).success).toBe(true);
      expect(f.recommendation).not.toBeNull();
      expect(f.assessment).toBe("context");
    }
    const fusionAgent = result.agents.find((a) => a.agentId === "fusion")!;
    const finished = fusionAgent.tasks.filter((t) => t.kind === "fusion.fuse").map((t) => t.finishedAt ?? -1);
    expect(finished.some((t) => t >= result.partition.startedAtMs && t < result.partition.healedAtMs)).toBe(true);
    expect(finished.some((t) => t >= result.partition.healedAtMs)).toBe(true);
    expect(fusionAgent.tasks.every((t) => t.runs === 1)).toBe(true);
  });

  it("vision findings come from Danil's processor, not the stand-in", async () => {
    const result = await run();
    const vision = result.records!.findings.filter((f) => f.agentId === "vision");
    expect(vision.length).toBe(2);
    for (const f of vision) {
      expect(f.explanation).not.toMatch(/stand-in/i);
      expect(f.limitationNotes).toContain(VISION_LIMITATIONS.base);
      expect(f.reasonCodes).toEqual(["smoke_like_features_visible"]);
    }
    const providers = result.records!.observations.filter((o) => o.source === "vision").map((o) => o.provenance.provider);
    expect(new Set(providers)).toEqual(new Set(["EmberGap vision validator"]));
  });

  it("after healing, the final fusion recommendation reflects all evidence for each investigation", async () => {
    const result = await run();
    for (const investigationId of [A, B]) {
      const sources = result.records!.findings.filter((f) => f.investigationId === investigationId && f.agentId !== "fusion");
      const expected = toCanonicalRecommendation(
        fuseFindings({ investigationId, findings: sources.map(fromCanonicalFinding) }, deps()),
      );
      const final = latestFusion(result, investigationId);
      expect(final?.recommendation).toEqual(fusionRecommendationSchema.parse(expected));
      // Fused after the partition healed, from evidence that crossed the cut.
      expect(Date.parse(final!.createdAt)).toBeGreaterThanOrEqual(Date.parse(NOW) + result.partition.healedAtMs);
    }
    const a = latestFusion(result, A)!.recommendation!;
    expect(a.recommendedStatus).toBe("needs_human_review");
    expect(a.independentSourceCount).toBe(2);
    // No witness agent runs in the demo: an honest gap, not negative evidence.
    expect(a.evidenceGaps.some((gap) => gap.startsWith("witness:"))).toBe(true);
  });
});
