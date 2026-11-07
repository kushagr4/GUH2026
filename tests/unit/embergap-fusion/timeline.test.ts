import { describe, expect, it } from "vitest";
import { createDeterministicDeps, fuseFindings } from "@/lib/embergap/agents/fusion";
import {
  simulatePartitionTimeline,
  type TimelineEvent,
  type TimelineInput,
} from "@/lib/embergap/agents/fusion/timeline";
import { TIMELINE_SCENARIOS } from "@/lib/embergap/agents/fusion/timeline-scenarios";
import type { AgentFinding, AgentId, Assessment } from "@/lib/embergap/agents/validators/types";

const deps = () => createDeterministicDeps("timeline-test");
const run = (input: TimelineInput) => simulatePartitionTimeline(input, deps());

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const INV = "syn-timeline-unit";
const T = (minute: number) => new Date(Date.UTC(2026, 10, 7, 14, minute, 0)).toISOString();

function f(id: string, agentId: AgentId, assessment: Assessment, reasonCodes: string[], minute: number): AgentFinding {
  return {
    id,
    investigationId: INV,
    agentId,
    createdAt: T(minute),
    evidenceIds: [`obs-${id}`],
    assessment,
    reasonCodes,
    explanation: "synthetic",
    limitations: [],
  };
}
const ev = (finding: AgentFinding, minute: number, kind?: TimelineEvent["kind"]): TimelineEvent => ({
  at: T(minute),
  agentId: finding.agentId,
  finding,
  ...(kind ? { kind } : {}),
});

const scenario = (id: string) => {
  const s = TIMELINE_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`missing scenario ${id}`);
  return s;
};

describe("TIMELINE_SCENARIOS", () => {
  it("are all labelled synthetic with synthetic ids", () => {
    expect(TIMELINE_SCENARIOS).toHaveLength(3);
    for (const s of TIMELINE_SCENARIOS) {
      expect(s.synthetic).toBe(true);
      expect(s.input.investigationId).toMatch(/^syn-/);
      for (const e of s.input.events) {
        expect(e.finding.id).toMatch(/^syn-/);
        expect(e.finding.explanation).toMatch(/SYNTHETIC/);
      }
    }
  });

  describe.each(TIMELINE_SCENARIOS.map((s) => [s.id, s] as const))("%s", (_id, s) => {
    const result = run(s.input);
    const final = result.steps.at(-1)!.recommendation;

    it("follows the expected phases", () => {
      expect(result.steps.map((step) => step.phase)).toEqual(s.expected.phases);
    });

    it("reaches the expected final recommendation", () => {
      expect(final.status).toBe(s.expected.final.status);
      expect(final.evidenceStrength).toBe(s.expected.final.evidenceStrength);
      expect(final.reviewPriority).toBe(s.expected.final.reviewPriority);
      expect(final.gaps.map((g) => g.agentId)).toEqual(s.expected.final.gapAgents);
      expect(final.contradictions.length > 0).toBe(s.expected.final.hasContradiction);
    });

    it("loses nothing, converges and counts duplicates and isolated production", () => {
      expect(result.mode).toBe("fusion_replay_simulation");
      expect(result.metrics.lostFindings).toBe(0);
      expect(result.metrics.converged).toBe(true);
      expect(result.metrics.duplicatesIgnored).toBe(s.expected.duplicatesIgnored);
      expect(result.metrics.findingsProducedWhileIsolated).toBe(s.expected.findingsProducedWhileIsolated);
      expect(result.metrics.findingsDelivered).toBe(new Set(s.input.events.map((e) => e.finding.id)).size);
    });

    it("converges to fusing all unique findings at once", () => {
      const reference = fuseFindings(
        { investigationId: s.input.investigationId, findings: s.input.events.map((e) => e.finding) },
        deps(),
      );
      expect({
        status: final.status,
        evidenceStrength: final.evidenceStrength,
        reviewPriority: final.reviewPriority,
        gaps: final.gaps,
        contradictions: final.contradictions,
      }).toEqual({
        status: reference.status,
        evidenceStrength: reference.evidenceStrength,
        reviewPriority: reference.reviewPriority,
        gaps: reference.gaps,
        contradictions: reference.contradictions,
      });
    });

    it("gives the same result for shuffled event input", () => {
      for (const seed of [1, 7, 42, 2026]) {
        expect(run({ ...s.input, events: shuffle(s.input.events, seed) })).toEqual(result);
      }
    });

    it("uses cautious narrative wording", () => {
      const text = result.narrative.join("\n");
      expect(text).not.toMatch(/confirm|dispatch|evacuat/i);
      expect(text).not.toMatch(/%/);
      expect(result.narrative[0]).toMatch(/SYNTHETIC fusion replay simulation/);
      expect(result.narrative[0]).toMatch(/human review/);
    });

    it("never marks the investigation reviewed or emits percentages in step output", () => {
      for (const step of result.steps) {
        expect(step.recommendation.status).not.toBe("reviewed");
        expect(step.recommendation.explanation[0]).toMatch(/human review only/);
        expect(step.recommendation.explanation.join("\n")).not.toMatch(/%/);
      }
    });
  });
});

describe("headline scenario", () => {
  const s = scenario("headline");
  const result = run(s.input);
  const stepAt = (minute: number) => {
    const step = result.steps.find((x) => x.at === T(minute));
    if (!step) throw new Error(`no step at ${minute}`);
    return step;
  };

  it("records local production while isolated as buffered, not delivered", () => {
    const sat = stepAt(3);
    expect(sat.produced).toEqual(["syn-headline-s1"]);
    expect(sat.delivered).toEqual([]);
    expect(sat.buffered).toEqual([{ agentId: "satellite", findingIds: ["syn-headline-s1"] }]);
    expect(stepAt(4).buffered).toEqual([
      { agentId: "satellite", findingIds: ["syn-headline-s1"] },
      { agentId: "weather", findingIds: ["syn-headline-we1"] },
    ]);
  });

  it("updates the recommendation during the partition with the gaps visible", () => {
    const step = stepAt(5);
    expect(step.delivered).toEqual(["syn-headline-w2"]);
    expect(step.recommendation).toMatchObject({
      status: "needs_human_review",
      evidenceStrength: "moderate",
      reviewPriority: "medium",
    });
    expect(step.recommendation.gaps.map((g) => g.agentId)).toEqual(["satellite", "weather"]);
  });

  it("buffers the duplicate retry and ignores it on reconciliation", () => {
    expect(stepAt(6).buffered[0]).toEqual({
      agentId: "satellite",
      findingIds: ["syn-headline-s1", "syn-headline-s1"],
    });
    const reconcile = stepAt(10);
    expect(reconcile.phase).toBe("reconciled");
    expect(reconcile.delivered).toEqual(["syn-headline-s1", "syn-headline-we1"]);
    expect(reconcile.duplicateIds).toEqual(["syn-headline-s1"]);
    expect(reconcile.buffered).toEqual([]);
  });

  it("narrates isolation and reconciliation", () => {
    expect(result.narrative).toContain("14:03 Satellite agent isolated; produced 1 finding locally (buffered).");
    expect(result.narrative.some((l) => l.startsWith("14:10 Link restored; 2 buffered findings delivered, 1 duplicate ignored; recommendation now needs_human_review (high priority), evidence strong"))).toBe(true);
  });
});

describe("contradiction scenario", () => {
  const result = run(scenario("contradiction").input);

  it("records the contradiction and keeps the earlier support visible", () => {
    const before = result.steps.find((x) => x.phase === "partitioned")!.recommendation;
    expect(before.contradictions).toEqual([]);
    expect(before.evidenceStrength).toBe("moderate");

    const final = result.steps.at(-1)!.recommendation;
    expect(final.contradictions).toHaveLength(1);
    expect(final.contradictions[0].agents).toEqual(["satellite", "vision", "witness"]);
    expect(final.explanation.some((l) => l.startsWith("[D1-contradiction]"))).toBe(true);
    // Support is not overwritten by the late contradicting finding.
    expect(final.evidenceStrength).toBe("moderate");
    expect(result.narrative.at(-2)).toMatch(/contradiction recorded for human review, not resolved automatically/);
  });
});

describe("offline-agent scenario", () => {
  const result = run(scenario("offline-agent").input);

  it("keeps the offline agent as a gap at every step, never a contradiction", () => {
    for (const step of result.steps) {
      expect(step.recommendation.gaps.map((g) => g.agentId)).toContain("satellite");
      expect(step.recommendation.contradictions).toEqual([]);
      expect(step.buffered).toEqual([]);
    }
    const final = result.steps.at(-1)!.recommendation;
    expect(final.status).not.toBe("insufficient_evidence");
    expect(final.explanation.some((l) => /not as negative evidence/.test(l))).toBe(true);
  });

  it("matches fusing the same findings with no partition at all", () => {
    const { partition: _partition, ...noPartition } = scenario("offline-agent").input;
    void _partition;
    const plain = run(noPartition);
    expect(plain.steps.every((s) => s.phase === "before_partition")).toBe(true);
    const a = plain.steps.at(-1)!.recommendation;
    const b = result.steps.at(-1)!.recommendation;
    expect([a.status, a.evidenceStrength, a.reviewPriority, a.gaps]).toEqual([
      b.status,
      b.evidenceStrength,
      b.reviewPriority,
      b.gaps,
    ]);
  });
});

describe("partition boundaries (half-open window [startsAt, endsAt))", () => {
  const partition = { startsAt: T(2), endsAt: T(8), isolatedAgents: ["satellite"] as AgentId[] };
  const atStart = f("s-start", "satellite", "supports", ["satellite.thermal_anomaly"], 2);
  const atEnd = f("s-end", "satellite", "supports", ["satellite.thermal_anomaly"], 8);
  const witness = f("w", "witness", "supports", ["witness.independent_corroboration"], 0);
  const result = run({
    investigationId: INV,
    partition,
    events: [ev(witness, 0), ev(atStart, 2), ev(atEnd, 8)],
  });

  it("buffers an event exactly at startsAt", () => {
    const start = result.steps.find((s) => s.at === T(2))!;
    expect(start.phase).toBe("partitioned");
    expect(start.delivered).toEqual([]);
    expect(start.buffered).toEqual([{ agentId: "satellite", findingIds: ["s-start"] }]);
    expect(result.metrics.findingsProducedWhileIsolated).toBe(1);
  });

  it("delivers an event exactly at endsAt in the reconciliation batch, after buffered findings", () => {
    const end = result.steps.find((s) => s.at === T(8))!;
    expect(end.phase).toBe("reconciled");
    expect(end.delivered).toEqual(["s-start", "s-end"]);
    expect(result.metrics.lostFindings).toBe(0);
    expect(result.narrative).toContainEqual(
      expect.stringMatching(/^14:08 Link restored; 1 buffered finding delivered, 1 new finding received directly, 0 duplicates ignored/),
    );
  });
});

describe("duplicates and order", () => {
  const vision = f("v", "vision", "supports", ["vision.smoke_visible"], 0);
  const sat = f("s", "satellite", "supports", ["satellite.thermal_anomaly"], 3);

  it("ignores duplicate deliveries outside a partition idempotently", () => {
    const result = run({
      investigationId: INV,
      events: [ev(vision, 0), ev(vision, 1, "redeliver"), ev(vision, 2, "redeliver")],
    });
    expect(result.metrics.duplicatesIgnored).toBe(2);
    expect(result.metrics.findingsDelivered).toBe(1);
    expect(result.steps.map((s) => s.duplicateIds)).toEqual([[], ["v"], ["v"]]);
    expect(result.narrative).toContain("14:01 1 duplicate of v ignored (idempotent); recommendation unchanged.");
  });

  it("delivers buffered findings in a stable order regardless of input order", () => {
    const sat2 = f("s0", "satellite", "inconclusive", ["satellite.no_detection"], 3);
    const events = [ev(sat, 3), ev(sat2, 3), ev(vision, 0)];
    const partition = { startsAt: T(1), endsAt: T(5), isolatedAgents: ["satellite"] as AgentId[] };
    const a = run({ investigationId: INV, partition, events });
    const b = run({ investigationId: INV, partition, events: [...events].reverse() });
    expect(a).toEqual(b);
    expect(a.steps.at(-1)!.delivered).toEqual(["s", "s0"]);
  });
});

describe("input validation", () => {
  const vision = f("v", "vision", "supports", ["vision.smoke_visible"], 0);

  it("rejects an inverted partition window", () => {
    expect(() =>
      run({ investigationId: INV, events: [], partition: { startsAt: T(5), endsAt: T(5), isolatedAgents: [] } }),
    ).toThrow(RangeError);
  });

  it("rejects an event whose producer does not match the finding", () => {
    expect(() =>
      run({ investigationId: INV, events: [{ at: T(0), agentId: "satellite", finding: vision }] }),
    ).toThrow(/attributed to satellite/);
  });

  it("rejects malformed timestamps", () => {
    expect(() => run({ investigationId: INV, events: [{ at: "not-a-date", agentId: "vision", finding: vision }] })).toThrow(
      RangeError,
    );
  });

  it("handles an empty timeline", () => {
    const result = run({ investigationId: INV, events: [] });
    expect(result.steps).toEqual([]);
    expect(result.metrics).toEqual({
      findingsProducedWhileIsolated: 0,
      findingsDelivered: 0,
      duplicatesIgnored: 0,
      lostFindings: 0,
      converged: true,
    });
  });
});
