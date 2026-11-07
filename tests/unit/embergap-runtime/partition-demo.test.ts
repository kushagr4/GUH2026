import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SYNTHETIC_SCENARIOS,
  syntheticId,
  agentEventSchema,
  agentFindingSchema,
  observationSchema,
  reconciledEventDetailsSchema,
  type AgentFinding,
} from "@/lib/embergap/contracts";
import {
  DEMO_PHASES,
  createMemoryRuntimeStore,
  defineProcessor,
  runPartitionDemo,
  type PartitionDemoResult,
  type TaskProcessor,
} from "@/lib/embergap/agents/runtime";
import { createEonetSourceAdapter, createEonetClient } from "@/lib/embergap/sources/eonet/eonet";
import { SYNTHETIC_EONET_RESPONSE } from "@/lib/embergap/sources/eonet/fixtures";

const A = SYNTHETIC_SCENARIOS.find((scenario) => scenario.id === "partition-recovery")!.investigationId;
const B = SYNTHETIC_SCENARIOS.find((scenario) => scenario.id === "weather-timeout")!.investigationId;

/** A timing-free view of what each task concluded: finding ids derive from (runId, agent, seq). */
function outcomes(result: PartitionDemoResult) {
  const findings = new Map<string, AgentFinding>(result.records!.findings.map((finding) => [finding.id, finding]));
  const out: Record<string, [string, string]> = {};
  for (const agent of result.agents) {
    for (const task of agent.tasks) {
      for (const eventId of task.outputEventIds) {
        const finding = findings.get(syntheticId(`runtime/${result.runId}/${agent.agentId}/${Number(eventId.split(":").at(-1))}`));
        if (finding) out[`${task.id.split(":").slice(1).join(":")}@${task.investigationId === A ? "A" : "B"}`] = [finding.assessment, finding.reasonCodes.join("+")];
      }
    }
  }
  return out;
}

describe("the partition demonstration", () => {
  it("settles, and every check passes", async () => {
    const result = await runPartitionDemo();
    expect(result.complete).toBe(true);
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.checks.map((check) => check.name)).toEqual([
      "identical histories",
      "no event lost",
      "each task processed exactly once",
      "work continued on both sides of the partition",
      "cross-partition tasks waited for the evidence, then ran",
      "settled",
    ]);
    expect(result.convergence.settledAtMs).toBeGreaterThan(DEMO_PHASES.recoveredAt);
  });

  it("holds the same invariants for other seeds", async () => {
    for (const seed of [1, 99, 31337]) {
      const result = await runPartitionDemo({ seed, runId: `seed-${seed}` });
      expect({ seed, failed: result.checks.filter((check) => !check.passed).map((check) => check.name) }).toEqual({ seed, failed: [] });
    }
  });

  it("shows agents working through the partition and waiting only for evidence from across it", async () => {
    const result = await runPartitionDemo();
    const [connected, partitioned, recovered] = result.phases;
    expect(connected.blockedTasks).toEqual([]);
    expect(partitioned.tasksCompleted.satellite).toBeGreaterThan(0);
    expect(partitioned.tasksCompleted.weather + partitioned.tasksCompleted.vision).toBeGreaterThan(0);
    expect(partitioned.blockedTasks.map((task) => [task.taskId.split(":").at(-1), task.missing])).toEqual([
      ["weather/detection-1", [`result of ${B}:satellite/pass-1`]],
      ["weather/detection-2", [`result of ${A}:satellite/pass-2`]],
    ]);
    expect(partitioned.reachability.weather).toEqual({ fusion: "unreachable", satellite: "unreachable", vision: "reachable" });
    expect(partitioned.unconfirmed.weather.satellite).toBeGreaterThan(0);
    expect(new Set(Object.values(partitioned.historyHashes)).size).toBeGreaterThan(1);
    expect(recovered.blockedTasks).toEqual([]);
    expect(recovered.tasksCompleted.weather).toBe(2);
    expect(Object.values(recovered.reachability).flatMap((peers) => Object.values(peers))).toEqual(Array(12).fill("reachable"));
    expect(result.reconciliation).toMatchObject({ isolated: ["fusion", "satellite"], completedWhileIsolated: 5 });
    expect(result.reconciliation!.redelivered).toBeGreaterThan(0);
  });

  it("writes canonical, synthetic records and the partition facts the timeline needs", async () => {
    const result = await runPartitionDemo();
    const { observations, findings, events } = result.records!;
    for (const observation of observations) expect(observationSchema.parse(observation).provenance.isSynthetic).toBe(true);
    for (const finding of findings) expect(agentFindingSchema.parse(finding).isSynthetic).toBe(true);
    for (const event of events) agentEventSchema.parse(event);
    expect(findings).toHaveLength(12);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "finding_recorded")).toHaveLength(12);
    expect(types.filter((type) => type === "partition_started")).toHaveLength(1);
    expect(types.filter((type) => type === "partition_healed")).toHaveLength(2);
    const reconciled = events.filter((event) => event.type === "reconciled");
    expect(reconciled.map((event) => event.investigationId).sort()).toEqual([A, B].sort());
    expect(reconciledEventDetailsSchema.parse(reconciled[0].details)).toMatchObject({ isolated: ["fusion", "satellite"], completedWhileIsolated: 5 });
    // Nothing private or internal in what investigators would see.
    expect(JSON.stringify(result)).not.toMatch(/secret|stack|Error:/);
  });

  it("concludes what each task should, whatever the timing", async () => {
    const result = await runPartitionDemo();
    expect(outcomes(result)).toEqual({
      "weather/context@A": ["context", "dry_or_windy_conditions"],
      "weather/eonet@A": ["context", "eonet_wildfire_event_nearby"],
      "satellite/pass-1@A": ["supports", "thermal_anomaly_nearby"],
      "vision/assess@A": ["supports", "smoke_like_features_visible"],
      "weather/detection-1@A": ["context", "dry_or_windy_conditions"],
      "satellite/pass-2@A": ["supports", "thermal_anomaly_nearby"],
      "weather/detection-2@A": ["context", "dry_or_windy_conditions"],
      "weather/context@B": ["inconclusive", "source_unavailable"],
      "weather/eonet@B": ["inconclusive", "eonet.no_matching_record"],
      "satellite/pass-1@B": ["supports", "thermal_anomaly_nearby"],
      "vision/assess@B": ["supports", "smoke_like_features_visible"],
      "weather/detection-1@B": ["inconclusive", "source_unavailable"],
    });
  });

  it("never treats missing or favourable data as evidence against a fire", async () => {
    const { findings } = (await runPartitionDemo()).records!;
    expect(findings.filter((finding) => finding.assessment === "contradicts")).toEqual([]);
    for (const finding of findings.filter((item) => item.agentId === "weather")) {
      expect(["context", "inconclusive"]).toContain(finding.assessment);
      expect(finding.limitations).toContain("weather_is_context_only");
      expect(finding.explanation).not.toMatch(/\b(towards|spread(s|ing)? (north|south|east|west)|rate of spread)\b/i);
    }
    const noRecord = findings.find((finding) => finding.reasonCodes.includes("eonet.no_matching_record"))!;
    expect(noRecord.limitations).toContain("no_detection_is_not_absence");
    expect(noRecord.explanation).toMatch(/not evidence that there is no fire/);
  });

  it("replays identically from the same seed, and step by step without keeping state between calls", async () => {
    const first = await runPartitionDemo({ seed: 7, runId: "replay" });
    const second = await runPartitionDemo({ seed: 7, runId: "replay" });
    expect(second).toEqual(first);
    const midway = await runPartitionDemo({ seed: 7, runId: "replay", stopAtMs: 8_000 });
    expect(midway.complete).toBe(false);
    expect(midway.phases.map((phase) => phase.name)).toEqual(["connected"]);
    expect(midway.agents.find((agent) => agent.agentId === "weather")!.tasks.filter((task) => task.status === "blocked")).toHaveLength(2);
  });

  it("is idempotent against the store, so a re-run never duplicates rows", async () => {
    const store = createMemoryRuntimeStore();
    await runPartitionDemo({ store, runId: "same" });
    const once = store.contents();
    await runPartitionDemo({ store, runId: "same" });
    const twice = store.contents();
    expect(twice.findings).toHaveLength(once.findings.length);
    expect(twice.observations).toHaveLength(once.observations.length);
    expect(twice.events).toHaveLength(once.events.length);
    expect(twice.duplicatesIgnored).toBeGreaterThan(once.duplicatesIgnored);
  });

  it("is plain JSON and small enough for a function response", async () => {
    const result = await runPartitionDemo();
    const text = JSON.stringify(result);
    expect(JSON.parse(text)).toEqual(result);
    expect(text.length).toBeLessThan(1_000_000);
  });

  it("lets a teammate replace a stand-in by kind without touching the runtime", async () => {
    const replacement = defineProcessor({
      kind: "vision.assess",
      input: z.object({ mediaId: z.string(), reportObservedAt: z.string() }).passthrough(),
      run: () => ({
        findings: [
          {
            assessment: "inconclusive",
            strength: null,
            reasonCodes: ["image_unclear"],
            explanation: "Replacement validator: unclear.",
            limitations: ["image_authenticity_unverifiable", "image_location_unverifiable", "image_time_unverifiable"],
          },
        ],
      }),
    });
    const result = await runPartitionDemo({ processors: { vision: [replacement] as unknown as TaskProcessor<never>[] } });
    const vision = result.records!.findings.filter((finding) => finding.agentId === "vision");
    expect(vision.map((finding) => finding.explanation)).toEqual(["Replacement validator: unclear.", "Replacement validator: unclear."]);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });
});

describe("source adapters through the shared port", () => {
  it("never throw, and a subject outside EONET's range becomes unavailable", async () => {
    const fetch = async () => new Response(JSON.stringify(SYNTHETIC_EONET_RESPONSE), { status: 200 });
    const adapter = createEonetSourceAdapter(createEonetClient({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => new Date("2026-11-07T12:00:00Z") }));
    const subject = { location: { latitude: 53.46, longitude: -1.85, precisionMeters: 1000 }, observedAt: "2026-11-07T11:45:00.000Z", syntheticScenarioId: null };
    const ok = await adapter({ investigationId: A, subject, checkedAt: "2026-11-07T12:00:00.000Z" });
    expect(ok.availability.state).toBe("available");
    expect(ok.observations[0]).toMatchObject({ source: "eonet", provenance: { isSynthetic: false } });
    const bad = await adapter({ investigationId: A, subject: { ...subject, location: { ...subject.location, latitude: 120 } }, checkedAt: "2026-11-07T12:00:00.000Z" });
    expect(bad.availability.state).toBe("unavailable");
  });
});
