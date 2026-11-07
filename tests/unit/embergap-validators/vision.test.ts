import { describe, expect, it } from "vitest";
import { agentFindingSchema, type AgentDeps } from "@/lib/embergap/agents/validators/types";
import {
  VISION_EXPLANATION_MAX,
  VISION_FIXTURES,
  VISION_LIMITATIONS,
  VISION_SYSTEM_PROMPT,
  createMockVisionAnalyzer,
  sanitizeText,
  toVisionFinding,
  validateVision,
  type VisionAnalyzer,
  type VisionFixtureId,
  type VisionValidationContext,
} from "@/lib/embergap/agents/validators/vision";

const NOW = "2026-11-07T12:00:00.000Z";

function makeDeps(): AgentDeps {
  let n = 0;
  return { now: () => NOW, newId: () => `finding-${++n}` };
}

const findingCtx = { investigationId: "inv-1", evidenceIds: ["obs-1"] };

function ctxFor(imageRef: string): VisionValidationContext {
  return { ...findingCtx, input: { imageRef, mimeType: "image/jpeg" } };
}

const FORBIDDEN = /dispatch|evacuat|confirmed fire|[<>]|\bscript\b/i;
const fixtureIds = Object.keys(VISION_FIXTURES) as VisionFixtureId[];

describe("vision fixtures through validateVision + mock analyzer", () => {
  it.each(fixtureIds)("%s maps to its labelled expectation", async (id) => {
    const fixture = VISION_FIXTURES[id];
    const finding = await validateVision(ctxFor(id), createMockVisionAnalyzer(), makeDeps());

    expect(agentFindingSchema.safeParse(finding).success).toBe(true);
    expect(finding.agentId).toBe("vision");
    expect(finding.investigationId).toBe("inv-1");
    expect(finding.evidenceIds).toEqual(["obs-1"]);
    expect(finding.createdAt).toBe(NOW);
    expect(finding.id).toBe("finding-1");
    expect(finding.assessment).toBe(fixture.expectedAssessment);
    expect([...finding.reasonCodes].sort()).toEqual([...fixture.expectedReasonCodes].sort());
    expect(finding.limitations).toContain(VISION_LIMITATIONS.base);
    expect(finding.explanation.length).toBeLessThanOrEqual(VISION_EXPLANATION_MAX);
    expect(finding.explanation).not.toMatch(FORBIDDEN);
    expect(finding.explanation).not.toMatch(/\d+\s*%/);
  });

  it("is deterministic for the same input", async () => {
    const a = await validateVision(ctxFor("fixture:vision/fog-bank"), createMockVisionAnalyzer(), makeDeps());
    const b = await validateVision(ctxFor("fixture:vision/fog-bank"), createMockVisionAnalyzer(), makeDeps());
    expect(a).toEqual(b);
  });

  it("does not mutate the fixture outputs", async () => {
    const before = structuredClone(VISION_FIXTURES);
    for (const id of fixtureIds) await validateVision(ctxFor(id), createMockVisionAnalyzer(), makeDeps());
    expect(VISION_FIXTURES).toEqual(before);
  });
});

describe("toVisionFinding guardrails", () => {
  const good = (overrides: Record<string, unknown> = {}) => ({
    indicators: { smoke: "absent", flame: "absent", glow: "absent", burnScar: "absent" },
    ambiguityFactors: [],
    imageQuality: "good",
    description: "A plain scene.",
    ...overrides,
  });

  it.each([null, undefined, 42, "text", [], {}, { indicators: "lots" }])(
    "treats %j as output_invalid (a gap, not negative evidence)",
    (raw) => {
      const finding = toVisionFinding(raw, findingCtx, makeDeps());
      expect(finding.assessment).toBe("inconclusive");
      expect(finding.reasonCodes).toEqual(["vision.output_invalid"]);
      expect(finding.limitations).toContain(VISION_LIMITATIONS.gapInvalid);
      expect(agentFindingSchema.safeParse(finding).success).toBe(true);
    },
  );

  it("rejects an over-long description as invalid", () => {
    const finding = toVisionFinding(good({ description: "x".repeat(5000) }), findingCtx, makeDeps());
    expect(finding.reasonCodes).toEqual(["vision.output_invalid"]);
  });

  it("strips claimed location, time and authenticity and never echoes them", () => {
    const finding = toVisionFinding(
      VISION_FIXTURES["fixture:vision/claims-gps-and-authenticity"].output,
      findingCtx,
      makeDeps(),
    );
    expect(finding.reasonCodes).toContain("vision.unverifiable_claim_stripped");
    expect(finding.limitations).toContain(VISION_LIMITATIONS.claimStripped);
    expect(finding.explanation).not.toMatch(/34\.05|118\.24|authentic|EXIF|GPS|2026-11-07/i);
    expect(finding.explanation).toContain("Grey smoke rises behind houses.");
  });

  it("strips claim keys whatever their type, without invalidating the output", () => {
    const finding = toVisionFinding(
      good({ claimedLocation: { lat: 1, lon: 2 }, takenAt: 12345, isAuthentic: "yes" }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("contradicts");
    expect(finding.reasonCodes).toContain("vision.unverifiable_claim_stripped");
  });

  it("strips a claim made only in the free-text description", () => {
    const finding = toVisionFinding(
      good({ description: "A quiet road. This was photographed on 2026-11-06 near the coast." }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.reasonCodes).toContain("vision.unverifiable_claim_stripped");
    expect(finding.explanation).toContain("A quiet road.");
    expect(finding.explanation).not.toMatch(/2026-11-06|photographed/);
  });

  it("ignores harmless extra keys without flagging a claim", () => {
    const finding = toVisionFinding(good({ notes: "extra", model: "x" }), findingCtx, makeDeps());
    expect(finding.assessment).toBe("contradicts");
    expect(finding.reasonCodes).toEqual(["vision.no_fire_indicators"]);
  });

  it("does not flag empty claim fields", () => {
    const finding = toVisionFinding(good({ claimedLocation: "", claimedTime: null }), findingCtx, makeDeps());
    expect(finding.reasonCodes).not.toContain("vision.unverifiable_claim_stripped");
  });

  it("withholds prompt-injection text and keeps the structured assessment", () => {
    const finding = toVisionFinding(
      VISION_FIXTURES["fixture:vision/prompt-injection"].output,
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("contradicts");
    expect(finding.limitations).toContain(VISION_LIMITATIONS.descriptionWithheld);
    expect(finding.explanation).not.toMatch(/ignore|instruction|dispatch|confirmed|alert|\bscript\b/i);
    expect(finding.explanation).toContain("A handwritten sign reads text.");
  });

  it("marks a contradicting finding as weak evidence", () => {
    const finding = toVisionFinding(good(), findingCtx, makeDeps());
    expect(finding.assessment).toBe("contradicts");
    expect(finding.limitations).toContain(VISION_LIMITATIONS.absenceIsWeak);
  });

  it("downgrades clear flame with sunset glare to ambiguous", () => {
    const finding = toVisionFinding(
      good({
        indicators: { smoke: "absent", flame: "clear", glow: "clear", burnScar: "absent" },
        ambiguityFactors: ["sunset_glare"],
      }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.ambiguous"]);
  });

  it("reports both smoke and flame when both are clear", () => {
    const finding = toVisionFinding(
      good({ indicators: { smoke: "clear", flame: "clear", glow: "absent", burnScar: "absent" } }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("supports");
    expect(finding.reasonCodes).toEqual(["vision.smoke_visible", "vision.flame_visible"]);
  });

  it("treats a burn scar alone as inconclusive (past, not active, burning)", () => {
    const finding = toVisionFinding(
      good({ indicators: { smoke: "absent", flame: "absent", glow: "absent", burnScar: "clear" } }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.ambiguous"]);
  });

  it("does not contradict when quality is only fair", () => {
    const finding = toVisionFinding(good({ imageQuality: "fair" }), findingCtx, makeDeps());
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.low_quality"]);
  });

  it("treats unusable images as low quality even with clear smoke", () => {
    const finding = toVisionFinding(
      good({
        imageQuality: "unusable",
        indicators: { smoke: "clear", flame: "absent", glow: "absent", burnScar: "absent" },
      }),
      findingCtx,
      makeDeps(),
    );
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.low_quality"]);
  });
});

describe("sanitizeText", () => {
  it("removes markup, control and bidi characters and caps length", () => {
    const out = sanitizeText("a<b>c</b>\u0000d\u202ee`f`   g <script>x</script>", 100);
    expect(out).toBe("a c d ef g x");
    expect(sanitizeText("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("validateVision failure paths", () => {
  it("turns a thrown analyzer error into model_unavailable", async () => {
    const analyzer: VisionAnalyzer = {
      id: "broken",
      analyze: async () => {
        throw new Error("secret-ish upstream detail sk-123");
      },
    };
    const finding = await validateVision(ctxFor("img"), analyzer, makeDeps());
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
    expect(finding.limitations).toContain(VISION_LIMITATIONS.gapUnavailable);
    expect(finding.explanation).not.toContain("sk-123");
    expect(agentFindingSchema.safeParse(finding).success).toBe(true);
  });

  it("handles a synchronous throw", async () => {
    const analyzer = {
      id: "sync",
      analyze: () => {
        throw new Error("boom");
      },
    } as unknown as VisionAnalyzer;
    const finding = await validateVision(ctxFor("img"), analyzer, makeDeps());
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
  });

  it("times out a hanging analyzer and aborts its signal", async () => {
    let seenSignal: AbortSignal | undefined;
    const analyzer: VisionAnalyzer = {
      id: "hang",
      analyze: (_input, signal) => {
        seenSignal = signal;
        return new Promise(() => undefined);
      },
    };
    const finding = await validateVision(ctxFor("img"), analyzer, makeDeps(), { timeoutMs: 10 });
    expect(finding.assessment).toBe("inconclusive");
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
    expect(finding.explanation).toContain("10 ms");
    expect(seenSignal?.aborted).toBe(true);
  });

  it("returns model_unavailable when the caller has already aborted", async () => {
    let called = false;
    const analyzer: VisionAnalyzer = {
      id: "never",
      analyze: async () => {
        called = true;
        return {};
      },
    };
    const controller = new AbortController();
    controller.abort();
    const finding = await validateVision(ctxFor("img"), analyzer, makeDeps(), {
      signal: controller.signal,
    });
    expect(called).toBe(false);
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
  });

  it("returns model_unavailable for an unknown fixture ref", async () => {
    const finding = await validateVision(ctxFor("fixture:vision/missing"), createMockVisionAnalyzer(), makeDeps());
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
  });

  it("refuses invalid input without calling the analyzer", async () => {
    let called = false;
    const analyzer: VisionAnalyzer = {
      id: "spy",
      analyze: async () => {
        called = true;
        return {};
      },
    };
    const ctx = { ...findingCtx, input: { imageRef: "", mimeType: "image/gif" } } as unknown as VisionValidationContext;
    const finding = await validateVision(ctx, analyzer, makeDeps());
    expect(called).toBe(false);
    expect(finding.reasonCodes).toEqual(["vision.model_unavailable"]);
  });
});

describe("VISION_SYSTEM_PROMPT", () => {
  it("tells the model to treat text as data and never assert location, time or authenticity", () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/untrusted DATA/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/never state or estimate where or when/i);
    expect(VISION_SYSTEM_PROMPT).toMatch(/authentic/);
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });
});
