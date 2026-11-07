import { describe, expect, it } from "vitest";
import { createDeterministicDeps, fuseFindings } from "@/lib/embergap/agents/fusion";
import {
  comparableRecommendation,
  mergeFindingSets,
  simulateDecentralisedFusion,
  type DecentralisedInput,
  type DecentralisedResult,
  type FindingSet,
} from "@/lib/embergap/agents/fusion/decentralised";
import {
  DECENTRALISED_SCENARIOS,
  type DecentralisedExpectedView,
} from "@/lib/embergap/agents/fusion/decentralised-scenarios";
import type { AgentFinding, AgentId, Assessment } from "@/lib/embergap/agents/validators/types";

const deps = () => createDeterministicDeps("decentralised-test");
const run = (input: DecentralisedInput) => simulateDecentralisedFusion(input, deps());
const scenario = (id: string) => {
  const s = DECENTRALISED_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`missing scenario ${id}`);
  return s;
};

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

const INV = "syn-decentralised-unit";
const T = (minute: number) => new Date(Date.UTC(2026, 10, 7, 14, minute, 0)).toISOString();
function f(id: string, agentId: AgentId, assessment: Assessment, reasonCodes: string[], minute = 0): AgentFinding {
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
const setOf = (...findings: AgentFinding[]): FindingSet => new Map(findings.map((x) => [x.id, x]));
const entries = (s: FindingSet) => JSON.stringify([...s.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

const finalNodes = (r: DecentralisedResult) => r.steps.at(-1)?.nodes ?? [];
function expectView(r: DecentralisedResult, node: string, view: DecentralisedExpectedView) {
  const rec = finalNodes(r).find((n) => n.node === node)?.recommendation;
  expect(rec, node).toBeDefined();
  expect(rec?.status).toBe(view.status);
  expect(rec?.evidenceStrength).toBe(view.evidenceStrength);
  expect(rec?.reviewPriority).toBe(view.reviewPriority);
  expect(rec?.gaps.map((g) => g.agentId).sort()).toEqual([...view.gapAgents].sort());
  expect((rec?.contradictions.length ?? 0) > 0).toBe(view.hasContradiction);
}

describe("mergeFindingSets (G-Set CRDT)", () => {
  const a = setOf(f("a", "witness", "supports", ["witness.single_report"]));
  const b = setOf(f("b", "vision", "supports", ["vision.smoke_visible"]), f("a", "witness", "supports", ["witness.single_report"]));
  const c = setOf(f("c", "satellite", "supports", ["satellite.thermal_anomaly"]));
  // Same id, different content: a misbehaving producer. Merge must still be order-independent.
  const conflict = setOf(f("a", "witness", "inconclusive", ["witness.single_report"]));

  it("is commutative", () => {
    for (const [x, y] of [
      [a, b],
      [b, c],
      [a, conflict],
    ]) {
      expect(entries(mergeFindingSets(x, y))).toBe(entries(mergeFindingSets(y, x)));
    }
  });

  it("is associative", () => {
    for (const [x, y, z] of [
      [a, b, c],
      [conflict, a, b],
      [c, conflict, a],
    ]) {
      expect(entries(mergeFindingSets(mergeFindingSets(x, y), z))).toBe(
        entries(mergeFindingSets(x, mergeFindingSets(y, z))),
      );
    }
  });

  it("is idempotent and has the empty set as identity", () => {
    for (const x of [a, b, c, conflict]) {
      expect(entries(mergeFindingSets(x, x))).toBe(entries(x));
      expect(entries(mergeFindingSets(x, new Map()))).toBe(entries(x));
    }
  });

  it("only grows: the merge contains every id from both sides, and leaves its inputs untouched", () => {
    const merged = mergeFindingSets(b, c);
    expect([...merged.keys()]).toEqual(["a", "b", "c"]);
    expect(b.size).toBe(2);
    expect(c.size).toBe(1);
  });
});

describe("simulateDecentralisedFusion: scenarios", () => {
  it("every scenario is labelled synthetic", () => {
    expect(DECENTRALISED_SCENARIOS).toHaveLength(3);
    for (const s of DECENTRALISED_SCENARIOS) {
      expect(s.synthetic).toBe(true);
      expect(s.input.investigationId).toMatch(/^syn-/);
      for (const e of s.input.events) expect(e.finding.limitations.join(" ")).toMatch(/synthetic/i);
    }
  });

  for (const s of DECENTRALISED_SCENARIOS) {
    it(`${s.id}: matches its expected outcome`, () => {
      const r = run(s.input);
      expect(r.mode).toBe("decentralised_fusion_simulation");
      expect(r.metrics.divergedDuringPartition).toBe(s.expected.divergedDuringPartition);
      expect(r.metrics.converged).toBe(s.expected.converged);
      expect(r.metrics.componentsConverged).toBe(s.expected.componentsConverged);
      expect(r.metrics.roundsToConvergeAfterHeal).toBe(s.expected.roundsToConvergeAfterHeal);
      expect(r.metrics.findingsProducedWhileIsolated).toBe(s.expected.findingsProducedWhileIsolated);
      expect(r.metrics.lostFindings).toBe(0);
      for (const node of s.expected.connectedNodes) expectView(r, node, s.expected.finalConnected);
      if (s.expected.isolated) expectView(r, s.expected.isolated.node, s.expected.isolated.view);
    });
  }

  it("headline: the two sides reach different local recommendations while split", () => {
    const r = run(scenario("headline").input);
    const split = r.steps.find((st) => st.at === T(6));
    expect(split?.phase).toBe("partitioned");
    const view = (node: string) => split?.nodes.find((n) => n.node === node)?.recommendation;
    expect(view("satellite")?.status).toBe("investigating");
    expect(view("weather")?.status).toBe("investigating");
    expect(view("witness")?.status).toBe("needs_human_review");
    expect(view("vision")?.status).toBe("needs_human_review");
    // Each side only knows its own side's new findings.
    const known = (node: string) => split?.nodes.find((n) => n.node === node)?.knownFindingIds ?? [];
    expect(known("satellite")).not.toContain("syn-headline-w2");
    expect(known("witness")).not.toContain("syn-headline-s1");
  });

  it("headline: converges after healing, with phases and rounds counted", () => {
    const r = run(scenario("headline").input);
    const phases = r.steps.map((st) => st.phase);
    expect(phases[0]).toBe("connected");
    expect(phases).toContain("partitioned");
    expect(phases.at(-1)).toBe("converged");
    expect(r.metrics.roundsToConvergeAfterHeal).toBe(1);
    expect(r.metrics.duplicateMerges).toBeGreaterThan(0);
    const final = finalNodes(r);
    expect(final).toHaveLength(4);
    expect(new Set(final.map((n) => comparableRecommendation(n.recommendation))).size).toBe(1);
  });

  it("lossy: drops messages yet converges with no finding lost, in more rounds than the lossless run", () => {
    const lossless = run(scenario("headline").input);
    const lossy = run(scenario("lossy").input);
    expect(lossy.metrics.messagesDropped).toBeGreaterThan(0);
    expect(lossy.metrics.converged).toBe(true);
    expect(lossy.metrics.lostFindings).toBe(0);
    expect(lossy.metrics.roundsToConvergeAfterHeal ?? 0).toBeGreaterThan(lossless.metrics.roundsToConvergeAfterHeal ?? 0);
    expect(lossy.steps.some((st) => st.phase === "healing")).toBe(true);
  });

  it("lossy: converges eventually for many seeds, even at high loss", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = run({ ...scenario("lossy").input, dropRate: 0.6, seed, maxExtraRounds: 100 });
      expect(r.metrics.converged, `seed ${seed}`).toBe(true);
      expect(r.metrics.lostFindings).toBe(0);
    }
  });

  it("isolated node: keeps making local progress and holds its own view", () => {
    const r = run(scenario("isolated-node").input);
    const sat = finalNodes(r).find((n) => n.node === "satellite");
    expect(sat?.knownFindingIds).toEqual(["syn-isolated-node-s1"]);
    expect(r.steps.every((st) => st.phase === "partitioned")).toBe(true);
    expect(r.narrative.join("\n")).toMatch(/Satellite node produced 1 finding .*while cut off/);
  });

  it("isolated node: its absence is a gap for the connected nodes, never a contradiction", () => {
    const r = run(scenario("isolated-node").input);
    for (const node of ["vision", "weather", "witness"]) {
      const rec = finalNodes(r).find((n) => n.node === node)?.recommendation;
      expect(rec?.gaps.map((g) => g.agentId)).toContain("satellite");
      expect(rec?.contradictions).toEqual([]);
      expect(finalNodes(r).find((n) => n.node === node)?.knownFindingIds).not.toContain("syn-isolated-node-s1");
    }
    expect(r.metrics.roundsToConvergeAfterHeal).toBeNull();
  });
});

describe("simulateDecentralisedFusion: properties", () => {
  it("has no fusion node and rejects one", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      const r = run(s.input);
      expect(r.nodes).not.toContain("fusion");
      for (const st of r.steps) expect(st.nodes.map((n) => n.node)).not.toContain("fusion");
    }
    const input = scenario("headline").input;
    expect(() => run({ ...input, nodes: [...input.nodes, "fusion"] })).toThrow(RangeError);
  });

  it("never gossips local recommendations: known sets hold source findings only", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      const produced = new Set(s.input.events.map((e) => e.finding.id));
      for (const st of run(s.input).steps) {
        for (const n of st.nodes) for (const id of n.knownFindingIds) expect(produced.has(id)).toBe(true);
      }
    }
    const input = scenario("headline").input;
    const fusionFinding = { ...f("fx", "fusion", "supports", []), investigationId: input.investigationId };
    expect(() =>
      run({ ...input, events: [...input.events, { at: T(1), kind: "produce", node: "witness", finding: fusionFinding }] }),
    ).toThrow(RangeError);
  });

  it("rejects an event whose node does not match its finding's producer", () => {
    const input = scenario("headline").input;
    const bad = { ...input.events[0], node: "vision" as const };
    expect(() => run({ ...input, events: [bad] })).toThrow(RangeError);
  });

  it("is deterministic: two runs are deep-equal", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      expect(simulateDecentralisedFusion(s.input, deps())).toEqual(simulateDecentralisedFusion(s.input, deps()));
    }
  });

  it("is independent of event input order", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      const base = run(s.input);
      for (const seed of [3, 11, 42]) {
        const shuffled = run({ ...s.input, events: shuffle(s.input.events, seed), links: shuffle(s.input.links, seed) });
        expect(shuffled.steps).toEqual(base.steps);
        expect(shuffled.metrics).toEqual(base.metrics);
        expect(shuffled.narrative).toEqual(base.narrative);
      }
    }
  });

  it("every converged node's recommendation equals the global fuseFindings result", () => {
    for (const s of DECENTRALISED_SCENARIOS.filter((x) => x.expected.converged)) {
      const r = run(s.input);
      const global = fuseFindings(
        { investigationId: s.input.investigationId, findings: s.input.events.map((e) => e.finding) },
        deps(),
      );
      for (const n of finalNodes(r)) {
        expect(comparableRecommendation(n.recommendation)).toBe(comparableRecommendation(global));
        expect(n.knownFindingIds).toEqual(s.input.events.map((e) => e.finding.id).sort());
      }
    }
  });

  it("never loses a finding", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      const r = run(s.input);
      expect(r.metrics.lostFindings).toBe(0);
      const held = new Set(finalNodes(r).flatMap((n) => n.knownFindingIds));
      for (const e of s.input.events) expect(held.has(e.finding.id)).toBe(true);
    }
  });

  it("a node adds its own finding immediately, before any gossip round", () => {
    const r = run({
      investigationId: INV,
      nodes: ["witness", "vision"],
      links: [["witness", "vision"]],
      events: [{ at: T(0), kind: "produce", node: "witness", finding: f("w1", "witness", "supports", ["witness.single_report"]) }],
      rounds: [{ at: T(5) }],
    });
    const first = r.steps[0];
    expect(first.gossipRound).toBe(false);
    expect(first.nodes.find((n) => n.node === "witness")?.knownFindingIds).toEqual(["w1"]);
    expect(first.nodes.find((n) => n.node === "vision")?.knownFindingIds).toEqual([]);
    expect(r.metrics.converged).toBe(true);
  });

  it("re-delivered copies are idempotent and counted as duplicate merges", () => {
    const w1 = f("w1", "witness", "supports", ["witness.single_report"]);
    const r = run({
      investigationId: INV,
      nodes: ["witness", "vision", "weather"],
      // Digests stop neighbours resending w1 once they hold it; the producer re-emitting the
      // same id is the one duplicate, applied once.
      links: [
        ["witness", "vision"],
        ["vision", "weather"],
        ["weather", "witness"],
      ],
      events: [
        { at: T(0), kind: "produce", node: "witness", finding: w1 },
        { at: T(1), kind: "produce", node: "witness", finding: w1 },
      ],
    });
    expect(r.metrics.duplicateMerges).toBe(1);
    expect(finalNodes(r).every((n) => n.knownFindingIds.length === 1)).toBe(true);
  });
});

describe("simulateDecentralisedFusion: narrative", () => {
  it("uses cautious wording: no verdicts, actions or percentages", () => {
    for (const s of DECENTRALISED_SCENARIOS) {
      const text = run(s.input).narrative.join("\n");
      expect(text).not.toMatch(/confirm|dispatch|evacuat|verified|probabilit|%/i);
      expect(text).toMatch(/SYNTHETIC/);
      expect(text).toMatch(/not a deployed network/);
      expect(text).toMatch(/human review/);
    }
  });

  it("headline narrative tells the split, local decisions and convergence", () => {
    const text = run(scenario("headline").input).narrative.join("\n");
    expect(text).toMatch(/14:02 Links cut \(simulated\)/);
    expect(text).toMatch(/\[Satellite \+ Weather\] and \[Vision \+ Witness\]/);
    expect(text).toMatch(/Local views differ/);
    expect(text).toMatch(/14:09 Gossip converged in 1 round after links were restored; all 4 nodes agree locally: needs_human_review \(high priority; evidence strong\)\. 0 findings lost/);
  });
});
