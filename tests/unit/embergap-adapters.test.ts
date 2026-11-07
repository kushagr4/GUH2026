import { describe, expect, it } from "vitest";
import { toCanonicalFinding } from "@/features/embergap/adapters";
import { createDeterministicDeps, fuseFindings, FUSION_SCENARIOS } from "@/lib/embergap/agents/fusion";
import { agentFindingSchema, SYNTHETIC_SCENARIOS, VISION_REQUIRED_LIMITATIONS } from "@/lib/embergap/contracts";

const INVESTIGATION = SYNTHETIC_SCENARIOS[0].investigationId;

describe("toCanonicalFinding bridges the #6 validators and fusion to the contracts", () => {
  it("turns every scenario finding into a valid canonical finding", () => {
    let count = 0;
    for (const scenario of FUSION_SCENARIOS) {
      for (const finding of scenario.input.findings) {
        const canonical = toCanonicalFinding(finding, { investigationId: INVESTIGATION, isSynthetic: true });
        expect(agentFindingSchema.safeParse(canonical).success, `${scenario.id}/${finding.id}`).toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
  });

  it("turns every fusion result into a context finding whose advice is in recommendation", () => {
    for (const scenario of FUSION_SCENARIOS) {
      const result = fuseFindings(scenario.input, createDeterministicDeps("fusion"));
      const canonical = toCanonicalFinding(result.finding, {
        investigationId: INVESTIGATION,
        isSynthetic: true,
        recommendation: result,
      });
      expect(canonical.assessment).toBe("context");
      expect(canonical.strength).toBeNull();
      expect(canonical.recommendation?.recommendedStatus).toBe(result.status);
      expect(canonical.recommendation?.reviewPriority).toBe(result.reviewPriority);
    }
  });

  it("keeps the validators' caveats as notes and adds the required codes", () => {
    const vision = FUSION_SCENARIOS.flatMap((scenario) => scenario.input.findings).find((finding) => finding.agentId === "vision");
    expect(vision).toBeDefined();
    const canonical = toCanonicalFinding(vision!, { investigationId: INVESTIGATION, isSynthetic: true });
    expect(canonical.limitations).toEqual(expect.arrayContaining([...VISION_REQUIRED_LIMITATIONS, "synthetic_data"]));
    expect(canonical.limitationNotes).toEqual(vision!.limitations.slice(0, 10));
  });

  it("is deterministic, so redelivery stays idempotent", () => {
    const finding = FUSION_SCENARIOS[0].input.findings[0];
    const context = { investigationId: INVESTIGATION, isSynthetic: true };
    expect(toCanonicalFinding(finding, context).id).toBe(toCanonicalFinding(finding, context).id);
  });
});
