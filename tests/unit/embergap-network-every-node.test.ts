import { describe, expect, it } from "vitest";
import { buildEveryNodeViewModel } from "@/components/embergap/network/decentralised-view-model";
import { createDeterministicDeps, DECENTRALISED_SCENARIOS, simulateDecentralisedFusion } from "@/lib/embergap/agents/fusion";

const headline = DECENTRALISED_SCENARIOS[0];
const build = () =>
  buildEveryNodeViewModel(simulateDecentralisedFusion(headline.input, createDeterministicDeps("t")), headline.input.links);

describe("buildEveryNodeViewModel", () => {
  it("returns before, during and after snapshots of four tiles", () => {
    const vm = build();
    expect(vm.snapshots.map((s) => s.id)).toEqual(["before", "during", "after"]);
    for (const s of vm.snapshots) expect(s.tiles).toHaveLength(4);
  });

  it("shows two islands that disagree during the split", () => {
    const during = build().snapshots[1];
    expect(during.islands).toHaveLength(2);
    expect(during.cutLinks.length).toBeGreaterThan(0);
    expect(new Set(during.tiles.map((t) => t.recommendationKey)).size).toBeGreaterThanOrEqual(2);
    expect(during.allAgree).toBe(false);
  });

  it("has all four agree after healing with nothing lost", () => {
    const vm = build();
    const after = vm.snapshots[2];
    expect(new Set(after.tiles.map((t) => t.recommendationKey)).size).toBe(1);
    expect(after.allAgree).toBe(true);
    expect(vm.lostFindings).toBe(0);
    expect(vm.converged).toBe(true);
    expect(vm.summary).toContain("0 findings lost");
  });

  it("is JSON-serialisable and never shows percentages", () => {
    const vm = build();
    const json = JSON.stringify(vm);
    expect(JSON.parse(json)).toEqual(vm);
    const labels = vm.snapshots.flatMap((s) => s.tiles.flatMap((t) => [t.statusLabel, t.priorityLabel, t.strengthLabel]));
    expect(labels.join(" ")).not.toMatch(/%/);
    expect(vm.summary).not.toMatch(/%|demo|synthetic|simulated/i);
  });
});
