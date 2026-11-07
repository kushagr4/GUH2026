// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runPartitionDemo, type PartitionDemoResult } from "@/lib/embergap/agents/runtime";
import { NetworkView } from "@/components/embergap/network/network-view";
import { REPORT_LABELS, buildNetworkViewModel, stageSnapshotTimes, type NetworkViewModel, type StageId } from "@/components/embergap/network/view-model";

afterEach(cleanup);

let full: PartitionDemoResult;
let model: NetworkViewModel;

beforeAll(async () => {
  full = await runPartitionDemo();
  const times = stageSnapshotTimes(full);
  const replays: Partial<Record<StageId, PartitionDemoResult>> = {};
  for (const stage of full.stages) {
    const id = stage.stage as StageId;
    replays[id] = id === "reconciled" ? full : await runPartitionDemo({ stopAtMs: times[id] });
  }
  model = buildNetworkViewModel(full, replays);
});

describe("buildNetworkViewModel", () => {
  it("has the five stages in order", () => {
    expect(model.stages.map((stage) => stage.id)).toEqual(["connected", "partitioned", "working_in_isolation", "reconnected", "reconciled"]);
    const times = model.stages.map((stage) => stage.simTimeMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("cuts the cross-partition links while split and restores them after", () => {
    const stage = (id: StageId) => model.stages.find((item) => item.id === id)!;
    expect(stage("connected").links.every((link) => link.up)).toBe(true);
    for (const id of ["partitioned", "working_in_isolation"] as const) {
      const links = stage(id).links;
      expect(links.find((link) => link.a === "weather" && link.b === "vision")?.up).toBe(true);
      expect(links.find((link) => link.a === "satellite" && link.b === "fusion")?.up).toBe(true);
      expect(links.filter((link) => !link.up)).toHaveLength(4);
    }
    expect(stage("reconnected").links.every((link) => link.up)).toBe(true);
    expect(stage("reconciled").links.every((link) => link.up)).toBe(true);
  });

  it("shows agents losing sight of the other side, and waiting tasks", () => {
    const isolated = model.stages.find((item) => item.id === "working_in_isolation")!;
    const weather = isolated.nodes.find((node) => node.id === "weather")!;
    expect(weather.reachable).toEqual(["vision"]);
    expect(weather.blockedOn.length).toBeGreaterThan(0);
    const reconciled = model.stages.at(-1)!;
    expect(reconciled.nodes.every((node) => node.blockedOn.length === 0 && node.reachable.length === 3)).toBe(true);
  });

  it("passes every runtime check", () => {
    expect(model.checks.length).toBeGreaterThan(0);
    expect(model.checks.every((check) => check.passed)).toBe(true);
  });

  it("has fusion recommendations, which change for report B after reconciliation", () => {
    const fusionAt = (id: StageId) => model.stages.find((item) => item.id === id)!.nodes.find((node) => node.id === "fusion")!.fusion!;
    const final = fusionAt("reconciled");
    expect(final.map((rec) => rec.report)).toEqual([...REPORT_LABELS]);
    const isolatedB = fusionAt("working_in_isolation").find((rec) => rec.report === REPORT_LABELS[1])!;
    const finalB = final.find((rec) => rec.report === REPORT_LABELS[1])!;
    expect(finalB.independentSources).toBeGreaterThan(isolatedB.independentSources);
  });

  it("is JSON-serialisable", () => {
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});

describe("NetworkView", () => {
  it("advances the stage with Next", () => {
    render(<NetworkView model={model} />);
    expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 2 of 5/)).toBeTruthy();
    expect(screen.getAllByText(/cut off, still working/i).length).toBeGreaterThan(0);
  });
});
