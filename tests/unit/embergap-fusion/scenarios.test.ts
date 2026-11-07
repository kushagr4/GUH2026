import { describe, expect, it } from "vitest";
import {
  FUSION_SCENARIOS,
  createDeterministicDeps,
  evaluateScenarios,
  fuseFindings,
  fusionStrategy,
  singleSourceBaseline,
  type EvaluationReport,
} from "@/lib/embergap/agents/fusion";
import { agentFindingSchema } from "@/lib/embergap/agents/validators/types";

describe("labelled synthetic scenarios", () => {
  it("are clearly synthetic, uniquely named and schema-valid", () => {
    expect(FUSION_SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FUSION_SCENARIOS.map((s) => s.id)).size).toBe(FUSION_SCENARIOS.length);
    for (const s of FUSION_SCENARIOS) {
      expect(s.synthetic).toBe(true);
      expect(s.input.investigationId.startsWith("syn-")).toBe(true);
      for (const f of s.input.findings) {
        expect(agentFindingSchema.safeParse(f).success).toBe(true);
        expect(f.id.startsWith("syn-")).toBe(true);
        expect(f.investigationId).toBe(s.input.investigationId);
      }
    }
  });

  it.each(FUSION_SCENARIOS.map((s) => [s.id, s] as const))("%s produces its expected outcome", (_id, s) => {
    const rec = fuseFindings(s.input, createDeterministicDeps(s.id));
    expect({
      status: rec.status,
      evidenceStrength: rec.evidenceStrength,
      reviewPriority: rec.reviewPriority,
      gapAgents: rec.gaps.map((g) => g.agentId).sort(),
      hasContradiction: rec.contradictions.length > 0,
    }).toEqual({ ...s.expected, gapAgents: [...s.expected.gapAgents].sort() });
    expect(agentFindingSchema.safeParse(rec.finding).success).toBe(true);
  });

  it("duplicate delivery gives the same decision as single delivery", () => {
    const s = FUSION_SCENARIOS.find((x) => x.id === "duplicate-delivery")!;
    const unique = [...new Map(s.input.findings.map((f) => [f.id, f])).values()];
    expect(unique.length * 2).toBe(s.input.findings.length);
    const once = fuseFindings({ ...s.input, findings: unique }, createDeterministicDeps("a"));
    const twice = fuseFindings(s.input, createDeterministicDeps("a"));
    expect(twice.status).toBe(once.status);
    expect(twice.evidenceStrength).toBe(once.evidenceStrength);
    expect(twice.audit.duplicateFindingIds).toHaveLength(unique.length);
  });

  it("out-of-order delivery uses the latest vision finding and keeps the earlier one visible", () => {
    const s = FUSION_SCENARIOS.find((x) => x.id === "out-of-order")!;
    const rec = fuseFindings(s.input, createDeterministicDeps(s.id));
    const reversed = fuseFindings({ ...s.input, findings: [...s.input.findings].reverse() }, createDeterministicDeps(s.id));
    expect(reversed).toEqual(rec);
    expect(rec.agents.find((a) => a.agentId === "vision")).toMatchObject({
      findingId: "syn-out-of-order-v2",
      supersededFindingIds: ["syn-out-of-order-v1"],
    });
  });

  it("repeated witness submissions never raise evidence above weak", () => {
    const s = FUSION_SCENARIOS.find((x) => x.id === "repeated-witness")!;
    const rec = fuseFindings(s.input, createDeterministicDeps(s.id));
    expect(rec.independentSupportCount).toBe(0);
    expect(rec.agents.find((a) => a.agentId === "witness")?.supersededFindingIds).toHaveLength(2);
  });
});

describe("evaluateScenarios", () => {
  const consistent = (report: EvaluationReport) => {
    const c = report.counts;
    expect(c.total).toBe(FUSION_SCENARIOS.length);
    expect(c.truePositives + c.falsePositives + c.trueNegatives + c.falseNegatives).toBe(c.total);
    const fires = FUSION_SCENARIOS.filter((s) => s.groundTruth === "fire").length;
    expect(c.truePositives + c.falseNegatives).toBe(fires);
    expect(c.trueNegatives + c.falsePositives).toBe(c.total - fires);
    expect(report.results.map((r) => r.scenarioId)).toEqual(FUSION_SCENARIOS.map((s) => s.id));
  };

  it("produces consistent, deterministic counts for the fusion strategy", () => {
    const report = evaluateScenarios(FUSION_SCENARIOS, fusionStrategy);
    consistent(report);
    expect(report.counts.expectationMismatches).toBe(0);
    expect(report.results.every((r) => r.matchesExpected === true)).toBe(true);
    expect(evaluateScenarios(FUSION_SCENARIOS, fusionStrategy)).toEqual(report);
    // Measured on these author-designed fixtures, not a real-world accuracy claim.
    expect(report.counts).toMatchObject({
      truePositives: 7,
      falsePositives: 0,
      trueNegatives: 4,
      falseNegatives: 1,
    });
  });

  it("runs the single-source baseline on the same scenarios", () => {
    const report = evaluateScenarios(FUSION_SCENARIOS, singleSourceBaseline);
    consistent(report);
    expect(report.results.every((r) => r.matchesExpected === null)).toBe(true);
    expect(report.counts).toMatchObject({
      truePositives: 8,
      falsePositives: 3,
      trueNegatives: 1,
      falseNegatives: 0,
    });
  });

  it("the baseline flags any single supporting finding, fusion requires corroboration", () => {
    const weatherOnly = FUSION_SCENARIOS.filter((s) => s.id === "weather-only");
    expect(evaluateScenarios(weatherOnly, singleSourceBaseline).results[0].flagged).toBe(true);
    expect(evaluateScenarios(weatherOnly, fusionStrategy).results[0].flagged).toBe(false);
  });
});
