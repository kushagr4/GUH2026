import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SYNTHETIC_NOW, syntheticId, type Observation } from "@/lib/embergap/contracts";
import { RuntimeAgent, hashEvent } from "@/lib/embergap/agents/runtime/agent";
import { createInProcessHost } from "@/lib/embergap/agents/runtime/hosts/in-process";
import { PERFECT_LINK, createSimulatedNetwork, type LinkPolicy } from "@/lib/embergap/agents/runtime/network";
import { ProcessorError, defineProcessor, type ProcessorResult, type TaskProcessor } from "@/lib/embergap/agents/runtime/processors";
import { createSimulation } from "@/lib/embergap/agents/runtime/simulation";
import { createMemoryRuntimeStore } from "@/lib/embergap/agents/runtime/store";
import type { Envelope, RuntimeEvent } from "@/lib/embergap/agents/runtime/types";

// Small agents with trivial processors, so these tests isolate the runtime:
// delivery, partitions, duplicates, ordering, relay, conflicts and recovery.
const INV = syntheticId("runtime-test/investigation");

function observationFor(taskId: string): Observation {
  return {
    id: syntheticId(`runtime-test/${taskId}`),
    investigationId: INV,
    source: "eonet",
    sourceRecordId: null,
    observedAt: null,
    retrievedAt: SYNTHETIC_NOW,
    location: null,
    coverage: { windowStart: "2026-11-07T00:00:00.000Z", windowEnd: "2026-11-07T12:00:00.000Z", radiusKm: 10 },
    sourceState: "not_observed",
    provenance: { provider: "runtime test", product: null, url: null, license: null, isSynthetic: true },
    evidence: null,
  };
}

const note = defineProcessor({
  kind: "note",
  input: z.object({}).passthrough(),
  run: ({ task }): ProcessorResult => ({ observations: [observationFor(task.id)] }),
});
/** Records how many upstream observations it saw, as its own observation id suffix. */
const summary = defineProcessor({
  kind: "summary",
  input: z.object({}).passthrough(),
  run: ({ task, upstream }): ProcessorResult => ({
    observations: [observationFor(`${task.id}/${upstream.map((item) => `${item.status}-${item.observations.length}`).join("+")}`)],
  }),
});
const crash = defineProcessor({
  kind: "crash",
  input: z.object({}).passthrough(),
  run: () => {
    throw new Error("secret upstream body: do not show");
  },
});
const PROCESSORS = [note, summary, crash] as unknown as TaskProcessor<never>[];

function world(ids: string[], options: { seed?: number; link?: LinkPolicy; runId?: string } = {}) {
  const runId = options.runId ?? "t1";
  const agents = ids.map((id) => new RuntimeAgent({ id, runId, peers: ids.filter((peer) => peer !== id), processors: PROCESSORS }));
  const network = createSimulatedNetwork({ nodes: ids, seed: options.seed ?? 7, defaultLink: options.link ?? PERFECT_LINK });
  const simulation = createSimulation({ host: createInProcessHost(agents), network, runId });
  return { agents, network, simulation };
}

const task = (id: string, kind = "note", after?: string[]) => ({ id, kind, investigationId: INV, input: {}, ...(after ? { after } : {}) });
const LOSSY: LinkPolicy = { lossRate: 0.3, duplicateRate: 0.2, minDelayMs: 50, maxDelayMs: 900 };

describe("simulated network", () => {
  const push = (id: string, from: string, to: string): Extract<Envelope, { type: "push" }> => ({ id, from, to, sentAt: 0, type: "push", events: [{}] });

  it("delivers a serialized copy after the link delay, so the sender can't change it later", () => {
    const network = createSimulatedNetwork({ nodes: ["a", "b"], seed: 1 });
    const envelope = push("a>b#1", "a", "b");
    network.send(envelope, 0);
    (envelope.events as unknown[]).push("tampered");
    expect(network.deliverDue(49).size).toBe(0);
    const delivered = network.deliverDue(50).get("b")!;
    expect(delivered).toEqual([push("a>b#1", "a", "b")]);
  });

  it("cuts only the links between partition groups, and checks link state at delivery time", () => {
    const network = createSimulatedNetwork({ nodes: ["a", "b", "c", "d"], seed: 1 });
    network.send(push("a>c#1", "a", "c"), 0); // In flight when the partition starts: lost.
    network.partition([["a", "b"], ["c", "d"]], 10);
    network.send(push("a>b#1", "a", "b"), 10);
    network.send(push("c>d#1", "c", "d"), 10);
    network.send(push("b>d#1", "b", "d"), 10);
    const delivered = network.deliverDue(100);
    expect([...delivered.keys()]).toEqual(["b", "d"]);
    expect(network.status().totals).toMatchObject({ delivered: 2, droppedPartition: 2 });
    expect(network.isLinkUp("a", "b")).toBe(true);
    expect(network.isLinkUp("b", "c")).toBe(false);

    network.send(push("a>c#2", "a", "c"), 100); // Due after the heal: arrives.
    network.heal(120);
    expect(network.deliverDue(200).get("c")).toHaveLength(1);
  });

  it("replays the same loss, duplication and jitter from the same seed", () => {
    const run = (seed: number) => {
      const network = createSimulatedNetwork({ nodes: ["a", "b"], seed, defaultLink: LOSSY });
      for (let index = 0; index < 200; index += 1) network.send(push(`a>b#${index}`, "a", "b"), index);
      network.deliverDue(10_000);
      return network.status().totals;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
    expect(run(42).droppedLoss).toBeGreaterThan(30);
    expect(run(42).duplicated).toBeGreaterThan(10);
  });

  it("applies scripted drop, duplicate and delay rules exactly", () => {
    const network = createSimulatedNetwork({ nodes: ["a", "b"], seed: 1 });
    network.addRule({ match: { from: "a", type: "push" }, action: { kind: "drop" }, times: 1 });
    network.addRule({ match: { to: "b" }, action: { kind: "duplicate" }, times: 1 });
    network.send(push("a>b#1", "a", "b"), 0);
    network.send(push("a>b#2", "a", "b"), 0);
    network.addRule({ match: { to: "b" }, action: { kind: "delay", extraMs: 5_000 }, times: 1 });
    network.send(push("a>b#3", "a", "b"), 0);
    expect(network.deliverDue(100).get("b")?.map((item) => item.id)).toEqual(["a>b#2", "a>b#2"]);
    expect(network.deliverDue(5_100).get("b")?.map((item) => item.id)).toEqual(["a>b#3"]);
    expect(network.status().totals).toMatchObject({ droppedRule: 1, duplicated: 1 });
  });
});

describe("independent agents", () => {
  it("own their state: snapshots are copies, and a peer knows nothing until a message arrives", async () => {
    const { agents, simulation } = world(["weather", "witness"]);
    await simulation.apply({ kind: "enqueue", agentId: "weather", task: task("w1") });
    await simulation.tick();
    const [weather, witness] = agents;
    const snapshot = weather.snapshot();
    snapshot.events.length = 0;
    snapshot.tasks[0].status = "failed";
    expect(weather.snapshot().events).toHaveLength(2);
    expect(weather.snapshot().tasks[0].status).toBe("done");
    // The witness agent never ran the task and doesn't hold the result yet.
    expect(witness.snapshot().tasks).toEqual([]);
    expect(witness.snapshot().events).toEqual([]);
    await simulation.runUntil(1_000);
    expect(witness.snapshot().events).toHaveLength(2);
    expect(witness.snapshot().tasks).toEqual([]);
  });

  it("enqueues a task once per id, and records nothing private about its input", async () => {
    const { agents } = world(["weather", "witness"]);
    expect(agents[0].enqueueTask({ ...task("t1"), input: { secret: "report text" } })).toBe(true);
    expect(agents[0].enqueueTask(task("t1"))).toBe(false);
    expect(JSON.stringify(agents[0].snapshot())).not.toContain("report text");
  });
});

describe("delivery, duplicates and ordering", () => {
  it("converges on a lossy, duplicating, reordering network, applying every event once", async () => {
    const ids = ["satellite", "vision", "weather", "witness"];
    const { simulation } = world(ids, { link: LOSSY, seed: 11 });
    ids.forEach((id, index) => simulation.schedule({ at: index * 100, kind: "enqueue", agentId: id, task: task(`${id}-1`) }));
    const run = await simulation.runUntilSettled({ maxTime: 60_000 });
    const status = await simulation.status();
    expect(run.settled).toBe(true);
    expect(new Set(Object.values(status.historyHashes)).size).toBe(1);
    for (const agent of status.agents) {
      expect(agent.events).toHaveLength(8); // 4 tasks x (observation + outcome)
      expect(new Set(agent.events.map((event) => event.id)).size).toBe(8);
      for (const event of agent.events) {
        const { hash, ...rest } = event;
        expect(hashEvent(rest)).toBe(hash);
      }
    }
    const ignored = status.agents.reduce((sum, agent) => sum + agent.metrics.duplicateEventsIgnored, 0);
    expect(ignored).toBeGreaterThan(0);
  });

  it("ends with the same history whatever order the same events arrive in", async () => {
    const source = world(["weather", "witness"]);
    await source.simulation.apply({ kind: "enqueue", agentId: "weather", task: task("o1") });
    await source.simulation.apply({ kind: "enqueue", agentId: "weather", task: task("o2") });
    await source.simulation.tick();
    await source.simulation.tick();
    const events = source.agents[0].snapshot().events;
    expect(events).toHaveLength(4);
    const orders = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]];
    const hashes = await Promise.all(
      orders.map(async (order) => {
        const receiver = new RuntimeAgent({ id: "witness", runId: "t1", peers: ["weather"], processors: [] });
        let time = 0;
        for (const index of order) {
          receiver.deliver([{ id: `weather>witness#${index}`, from: "weather", to: "witness", sentAt: 0, type: "push", events: [events[index]] }]);
          await receiver.step((time += 1));
        }
        // Delivering everything again changes nothing.
        receiver.deliver([{ id: "weather>witness#again", from: "weather", to: "witness", sentAt: 0, type: "push", events }]);
        await receiver.step(10);
        const snapshot = receiver.snapshot();
        expect(snapshot.metrics.duplicateEventsIgnored).toBe(4);
        expect(snapshot.digest.contiguous.weather).toBe(4);
        return snapshot.historyHash;
      }),
    );
    expect(new Set(hashes).size).toBe(1);
  });

  it("relays events through a third agent when a link is cut for the whole run", async () => {
    const ids = ["satellite", "vision", "weather"];
    const { simulation } = world(ids, { seed: 3 });
    simulation.schedule({ at: 0, kind: "cut-link", a: "satellite", b: "weather" });
    simulation.schedule({ at: 100, kind: "enqueue", agentId: "satellite", task: task("s1") });
    await simulation.runUntil(20_000);
    const status = await simulation.status();
    // Never "settled": satellite and weather can't confirm each other directly. But they agree.
    expect(status.converged).toBe(true);
    expect(status.pendingTasks).toEqual([]);
    const weather = status.agents.find((agent) => agent.agentId === "weather")!;
    expect(weather.events.filter((event) => event.origin === "satellite")).toHaveLength(2);
  });
});

describe("partitions and recovery", () => {
  it("keeps both sides working, makes cross-partition work wait, then reconciles", async () => {
    const ids = ["satellite", "vision", "weather", "witness"];
    const { simulation } = world(ids, { link: { lossRate: 0.1, duplicateRate: 0.05, minDelayMs: 50, maxDelayMs: 400 }, seed: 5 });
    simulation.schedule([
      { at: 1_000, kind: "partition", groups: [["vision", "weather"], ["satellite", "witness"]] },
      { at: 1_500, kind: "enqueue", agentId: "satellite", task: task("pass") },
      { at: 1_500, kind: "enqueue", agentId: "weather", task: task("local") },
      { at: 1_500, kind: "enqueue", agentId: "weather", task: task("needs-pass", "summary", ["pass"]) },
      { at: 8_000, kind: "heal" },
    ]);
    await simulation.runUntil(7_900);
    const during = await simulation.status();
    const weather = during.agents.find((agent) => agent.agentId === "weather")!;
    expect(weather.tasks.find((item) => item.id === "local")?.status).toBe("done");
    expect(weather.tasks.find((item) => item.id === "needs-pass")).toMatchObject({ status: "blocked", missing: ["result of pass"], runs: 0 });
    expect(during.agents.find((agent) => agent.agentId === "satellite")!.tasks[0].status).toBe("done");
    expect(weather.peers.find((peer) => peer.id === "satellite")?.status).toBe("unreachable");
    expect(weather.peers.find((peer) => peer.id === "vision")?.status).toBe("reachable");
    expect(weather.peers.find((peer) => peer.id === "satellite")?.pendingEventIds.length).toBeGreaterThan(0);
    expect(during.converged).toBe(false);

    expect((await simulation.runUntilSettled({ maxTime: 30_000 })).settled).toBe(true);
    const after = await simulation.status();
    const done = after.agents.find((agent) => agent.agentId === "weather")!.tasks.find((item) => item.id === "needs-pass")!;
    expect(done).toMatchObject({ status: "done", runs: 1 });
    expect(done.finishedAt).toBeGreaterThanOrEqual(8_000);
    // It saw the pass's complete output: one observation from a finished task.
    const own = after.agents[0].events.find((event) => event.taskId === "needs-pass" && event.payload.kind === "observation");
    expect(own?.payload.kind === "observation" && own.payload.observation.id).toBe(syntheticId("runtime-test/needs-pass/done-1"));
    expect(after.reconciliations).toHaveLength(1);
    expect(after.reconciliations[0]).toMatchObject({ completedWhileIsolated: 2, isolated: ["satellite", "witness"] });
    expect(after.reconciliations[0].redelivered).toBeGreaterThan(0);
    expect(after.agents.every((agent) => agent.peers.every((peer) => peer.status === "reachable" && peer.pendingEventIds.length === 0))).toBe(true);
  });

  it("always stops at the time limit, reporting work that can never run", async () => {
    const { simulation } = world(["weather", "witness"]);
    simulation.schedule({ at: 0, kind: "enqueue", agentId: "weather", task: task("orphan", "summary", ["never-scheduled"]) });
    const run = await simulation.runUntilSettled({ maxTime: 5_000 });
    expect(run).toEqual({ settled: false, at: 5_000, stopReason: "max-time" });
    expect((await simulation.status()).pendingTasks).toEqual([
      { agentId: "weather", taskId: "orphan", kind: "summary", status: "blocked", missing: ["result of never-scheduled"] },
    ]);
  });
});

describe("validation, conflicts and failures", () => {
  async function oneEvent() {
    const { agents, simulation } = world(["weather", "witness"]);
    await simulation.apply({ kind: "enqueue", agentId: "weather", task: task("e1") });
    await simulation.tick();
    return { agents, simulation, event: agents[0].snapshot().events[0] };
  }

  it("rejects an event whose content doesn't match its hash, and a finding in another agent's name", async () => {
    const { event } = await oneEvent();
    const receiver = new RuntimeAgent({ id: "witness", runId: "t1", peers: ["weather"], processors: [] });
    const tampered = structuredClone(event) as RuntimeEvent;
    if (tampered.payload.kind === "observation") tampered.payload.observation.sourceRecordId = "forged";
    receiver.deliver([{ id: "weather>witness#1", from: "weather", to: "witness", sentAt: 0, type: "push", events: [tampered, { id: "junk" }] }]);
    await receiver.step(1);
    expect(receiver.snapshot().events).toEqual([]);
    expect(receiver.snapshot().metrics.eventsRejected).toBe(2);
  });

  it("detects two versions of one event and converges every replica on the same one", async () => {
    const ids = ["vision", "weather", "witness"];
    const { agents, simulation } = world(ids, { seed: 9 });
    await simulation.apply({ kind: "enqueue", agentId: "weather", task: task("c1") });
    await simulation.runUntilSettled({ maxTime: 10_000 });
    const original = agents[1].snapshot().events[0];
    const { hash: _hash, ...rest } = original;
    void _hash;
    const forged = { ...rest, createdAt: rest.createdAt + 1 };
    const forgedEvent = { ...forged, hash: hashEvent(forged) };
    // Only the witness agent sees the second version, directly.
    agents[2].deliver([{ id: "vision>witness#forged", from: "vision", to: "witness", sentAt: 0, type: "push", events: [forgedEvent] }]);
    // Give the witness's push of both versions time to arrive (best effort, so a fixed time, not "settled").
    await simulation.runUntil(simulation.now() + 5_000);
    const status = await simulation.status();
    expect(new Set(Object.values(status.historyHashes)).size).toBe(1);
    const kept = [original.hash, forgedEvent.hash].sort()[0];
    for (const agent of status.agents) {
      expect(agent.events.find((event) => event.id === original.id)?.hash).toBe(kept);
      expect(agent.conflicts.map((conflict) => conflict.versions.length)).toEqual([2]);
    }
  });

  it("turns a crashing processor into a failed task with a safe message, and dependents still run", async () => {
    const store = createMemoryRuntimeStore();
    const ids = ["weather", "witness"];
    const agents = ids.map((id) => new RuntimeAgent({ id, runId: "t2", peers: ids.filter((peer) => peer !== id), processors: PROCESSORS, store }));
    const simulation = createSimulation({ host: createInProcessHost(agents), network: createSimulatedNetwork({ nodes: ids, seed: 1 }), runId: "t2" });
    simulation.schedule([
      { at: 0, kind: "enqueue", agentId: "weather", task: task("boom", "crash") },
      { at: 0, kind: "enqueue", agentId: "witness", task: task("next", "summary", ["boom"]) },
    ]);
    expect((await simulation.runUntilSettled({ maxTime: 10_000 })).settled).toBe(true);
    const status = await simulation.status();
    const failed = status.agents[0].tasks[0];
    expect(failed).toMatchObject({ status: "failed", error: { code: "processor_error", message: "The processor failed unexpectedly." } });
    expect(JSON.stringify(status)).not.toContain("secret upstream body");
    const next = status.agents[1].tasks[0];
    expect(next).toMatchObject({ status: "done", runs: 1 });
    expect(status.agents[1].events.some((event) => event.payload.kind === "observation" && event.payload.observation.id === syntheticId("runtime-test/next/failed-0"))).toBe(true);
  });

  it("fails async processors, invalid inputs and missing processors without stopping the agent", async () => {
    const asyncProcessor = defineProcessor({ kind: "async", input: z.object({}), run: (() => Promise.resolve({})) as unknown as () => ProcessorResult });
    const typed = defineProcessor({ kind: "typed", input: z.object({ n: z.number() }), run: () => ({}) });
    const agent = new RuntimeAgent({ id: "weather", runId: "t3", peers: [], processors: [asyncProcessor, typed] as unknown as TaskProcessor<never>[] });
    agent.enqueueTask({ ...task("a1"), kind: "async" });
    agent.enqueueTask({ ...task("a2"), kind: "typed", input: { n: "x" } });
    agent.enqueueTask({ ...task("a3"), kind: "unknown" });
    for (let time = 100; time <= 500; time += 100) await agent.step(time);
    expect(agent.snapshot().tasks.map((item) => [item.id, item.status, item.error?.code])).toEqual([
      ["a1", "failed", "async_processor"],
      ["a2", "failed", "invalid_input"],
      ["a3", "failed", "no_processor"],
    ]);
  });

  it("keeps a ProcessorError's own safe message", async () => {
    const expected = defineProcessor({
      kind: "expected",
      input: z.object({}),
      run: () => {
        throw new ProcessorError("source_timeout", "The source took too long.");
      },
    });
    const agent = new RuntimeAgent({ id: "weather", runId: "t4", peers: [], processors: [expected] as unknown as TaskProcessor<never>[] });
    agent.enqueueTask({ ...task("p1"), kind: "expected" });
    await agent.step(100);
    expect(agent.snapshot().tasks[0].error).toEqual({ code: "source_timeout", message: "The source took too long." });
  });

  it("refuses synthetic stand-ins and synthetic records in live mode", async () => {
    const standIn = defineProcessor({ kind: "fixture", syntheticOnly: true, input: z.object({}), run: () => ({}) });
    expect(() => new RuntimeAgent({ id: "satellite", runId: "t5", peers: [], processors: [standIn] as unknown as TaskProcessor<never>[], mode: "live" })).toThrow(/synthetic stand-in/);
    const live = new RuntimeAgent({ id: "weather", runId: "t5", peers: [], processors: PROCESSORS, mode: "live" });
    live.enqueueTask(task("l1"));
    await live.step(100);
    expect(live.snapshot().tasks[0]).toMatchObject({ status: "failed", error: { code: "invalid_output" } });
  });

  it("persists its own records idempotently through the runtime store", async () => {
    const store = createMemoryRuntimeStore();
    const agent = new RuntimeAgent({ id: "weather", runId: "t6", peers: [], processors: PROCESSORS, store });
    agent.enqueueTask(task("s1"));
    await agent.step(100);
    await store.saveObservations([observationFor("s1")]);
    expect(store.contents()).toMatchObject({ observations: [{ id: syntheticId("runtime-test/s1") }], duplicatesIgnored: 1 });
  });
});
