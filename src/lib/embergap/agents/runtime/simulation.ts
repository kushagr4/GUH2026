// The simulation driver: a clock and a wire, not a controller.
//
// Each tick it (1) applies scenario inputs that are due: new tasks for an
// agent's own queue, partitions and repairs of the network; (2) hands each agent
// whatever the network delivered; (3) lets every agent take one step; (4) passes
// what they sent to the network, in agent-id order so runs are reproducible.
// It never reads an agent's state to decide anything for it. As the "system"
// endpoint of the contracts it records partition facts for the timeline:
// partition_started, partition_healed and, once every replica agrees again,
// reconciled with the numbers the demo shows. Status reads snapshots, read-only.
import {
  AGENT_IDS,
  agentEventSchema,
  stableId,
  syntheticId,
  type AgentEvent,
  type AgentId,
  type EmberGapRuntimeStore,
} from "@/lib/embergap/contracts";
import { DEFAULT_EPOCH_ISO, type AgentLogEntry } from "./agent";
import type { AgentHost, HostKind, HostedAgentSnapshot } from "./host";
import type { NetworkLogEntry, NetworkStatus, SimulatedNetwork } from "./network";
import type { RuntimeTask } from "./processors";
import type { SimTime } from "./types";

export type ScenarioAction =
  | { at: SimTime; kind: "enqueue"; agentId: string; task: RuntimeTask }
  /** The first group is the main side; agents in the other groups count as isolated. */
  | { at: SimTime; kind: "partition"; groups: string[][] }
  | { at: SimTime; kind: "cut-link"; a: string; b: string; oneWay?: boolean }
  | { at: SimTime; kind: "heal-link"; a: string; b: string; oneWay?: boolean }
  | { at: SimTime; kind: "heal" }
  /** Marks the start of a named phase, for summaries. */
  | { at: SimTime; kind: "phase"; name: string };

export type ScenarioLogEntry = { at: SimTime; kind: ScenarioAction["kind"]; detail: string };

export type TimelineEntry =
  | ({ source: "scenario" } & ScenarioLogEntry)
  | ({ source: "network" } & NetworkLogEntry)
  | ({ source: "agent" } & AgentLogEntry);

export type PendingTask = { agentId: string; taskId: string; kind: string; status: string; missing: string[] };

/** The numbers recorded in the contract's `reconciled` event. */
export type Reconciliation = {
  partitionId: string;
  isolated: string[];
  groups: string[][];
  startedAt: SimTime;
  healedAt: SimTime;
  reconciledAt: SimTime;
  /** Events created on one side during the partition that reached the other side after it healed. */
  redelivered: number;
  /** Copies ignored because the event was already held, between the heal and reconciliation. */
  duplicatesIgnored: number;
  /** Tasks finished while the partition lasted, on either side. */
  completedWhileIsolated: number;
};

/** Everything a dashboard needs, as plain JSON. */
export type RuntimeStatus = {
  now: SimTime;
  nowIso: string;
  host: HostKind;
  phase: string | null;
  network: NetworkStatus;
  agents: HostedAgentSnapshot[];
  historyHashes: Record<string, string>;
  /** Every agent holds exactly the same event history. */
  converged: boolean;
  /**
   * Converged, no task waiting or running anywhere, and every agent has had
   * every peer confirm, by digest, that it holds everything.
   */
  settled: boolean;
  /** Tasks not done or failed, with what each is waiting for. */
  pendingTasks: PendingTask[];
  reconciliations: Reconciliation[];
};

export type Simulation = {
  readonly host: AgentHost;
  readonly network: SimulatedNetwork;
  readonly tickMs: number;
  now(): SimTime;
  phase(): string | null;
  schedule(actions: ScenarioAction | readonly ScenarioAction[]): void;
  /** Applies an action now, for an interactive demo. Same effect as scheduling it. */
  apply(action: DistributiveOmitAt<ScenarioAction>): Promise<void>;
  tick(): Promise<void>;
  runUntil(time: SimTime): Promise<void>;
  /**
   * Ticks until settled or `maxTime`, always bounded. Also stops when `signal`
   * aborts or `wallClockBudgetMs` of real time is spent, which keeps a run
   * inside a serverless function's limit. Says why it stopped.
   */
  runUntilSettled(options: {
    maxTime: SimTime;
    checkEveryMs?: number;
    signal?: AbortSignal;
    wallClockBudgetMs?: number;
  }): Promise<{ settled: boolean; at: SimTime; stopReason: "settled" | "max-time" | "cancelled" | "budget" }>;
  status(): Promise<RuntimeStatus>;
  scenarioLog(): ScenarioLogEntry[];
  /** Scenario, network and agent logs merged in time order. */
  timeline(status?: RuntimeStatus): Promise<TimelineEntry[]>;
};

type DistributiveOmitAt<T> = T extends unknown ? Omit<T, "at"> : never;

const SOURCE_ORDER = { scenario: 0, network: 1, agent: 2 } as const;
const CANONICAL_AGENTS = new Set<string>(AGENT_IDS);

export function createSimulation(options: {
  host: AgentHost;
  network: SimulatedNetwork;
  /** Where partition facts go. Optional for plain runtime tests. */
  store?: EmberGapRuntimeStore;
  runId?: string;
  isSynthetic?: boolean;
  tickMs?: number;
  epochIso?: string;
}): Simulation {
  const { host, network, store } = options;
  const runId = options.runId ?? "run";
  const isSynthetic = options.isSynthetic ?? true;
  const tickMs = options.tickMs ?? 100;
  if (!(tickMs > 0)) throw new RangeError("tickMs must be positive");
  const epochMs = Date.parse(options.epochIso ?? DEFAULT_EPOCH_ISO);
  const agentIds = [...host.agentIds].sort();
  for (const id of agentIds) if (!network.nodes.includes(id)) throw new Error(`${id} is not on the network`);

  let now: SimTime = 0;
  let phase: string | null = null;
  let order = 0;
  let partitionCount = 0;
  const queue: Array<ScenarioAction & { order: number }> = [];
  const scenarioLog: ScenarioLogEntry[] = [];
  const investigations = new Set<string>();
  const reconciliations: Reconciliation[] = [];
  type ActivePartition = { partitionId: string; isolated: string[]; groups: string[][]; startedAt: SimTime };
  type HealedPartition = ActivePartition & { healedAt: SimTime; duplicatesAtHeal: number };
  let partition: ActivePartition | null = null;
  let awaitingReconciliation: HealedPartition | null = null;

  const iso = (time: SimTime) => new Date(epochMs + time).toISOString();
  const idFor = (name: string) => (isSynthetic ? syntheticId(`runtime/${name}`) : stableId(`runtime:${name}`));

  /** One timeline fact per in-flight investigation, as the contract asks. */
  async function recordSystemEvent(type: "partition_started" | "partition_healed" | "reconciled", details: Record<string, unknown>, summary: string) {
    if (!store) return;
    const partitionId = String(details.partitionId);
    const events: AgentEvent[] = [];
    for (const investigationId of [...investigations].sort()) {
      const parsed = agentEventSchema.safeParse({
        id: idFor(`${runId}/${type}/${partitionId}/${investigationId}`),
        investigationId,
        type,
        actor: "system",
        occurredAt: iso(now),
        recordedAt: iso(now),
        idempotencyKey: `${type}:${partitionId}`,
        messageId: null,
        summary,
        details,
        isSynthetic,
      });
      if (parsed.success) events.push(parsed.data);
    }
    if (events.length) await store.appendEvents(events);
  }

  async function applyAction(action: DistributiveOmitAt<ScenarioAction>): Promise<void> {
    const log = (detail: string) => scenarioLog.push({ at: now, kind: action.kind, detail });
    switch (action.kind) {
      case "enqueue": {
        investigations.add(action.task.investigationId);
        const accepted = await host.enqueue(action.agentId, action.task);
        log(`${action.task.kind} (${action.task.id}) to ${action.agentId}${accepted ? "" : ", already queued"}`);
        return;
      }
      case "partition": {
        network.partition(action.groups, now);
        partitionCount += 1;
        const isolated = action.groups.slice(1).flat().sort();
        partition = { partitionId: idFor(`${runId}/partition/${partitionCount}`), isolated, groups: action.groups.map((group) => [...group]), startedAt: now };
        log(action.groups.map((group) => `{${group.join(", ")}}`).join(" | "));
        const canonical = isolated.filter((id): id is AgentId => CANONICAL_AGENTS.has(id));
        if (canonical.length) {
          await recordSystemEvent(
            "partition_started",
            { partitionId: partition.partitionId, isolated: canonical },
            `Network partition: ${canonical.join(", ")} cut off from the other agents. Agents keep working.`,
          );
        }
        return;
      }
      case "cut-link":
        network.cutLink(action.a, action.b, now, { oneWay: action.oneWay });
        log(`${action.a} ${action.oneWay ? "->" : "<->"} ${action.b}`);
        return;
      case "heal-link":
        network.healLink(action.a, action.b, now, { oneWay: action.oneWay });
        log(`${action.a} ${action.oneWay ? "->" : "<->"} ${action.b}`);
        return;
      case "heal": {
        network.heal(now);
        log("all links restored");
        if (partition) {
          const snapshots = await Promise.all(agentIds.map((id) => host.snapshot(id)));
          const duplicatesAtHeal = snapshots.reduce((sum, agent) => sum + agent.metrics.duplicateEventsIgnored, 0);
          awaitingReconciliation = { ...partition, healedAt: now, duplicatesAtHeal };
          const canonical = partition.isolated.filter((id): id is AgentId => CANONICAL_AGENTS.has(id));
          if (canonical.length) {
            await recordSystemEvent(
              "partition_healed",
              { partitionId: partition.partitionId, isolated: canonical },
              "Network restored. Agents are exchanging what they missed.",
            );
          }
          partition = null;
        }
        return;
      }
      case "phase":
        phase = action.name;
        log(action.name);
        return;
    }
  }

  async function tick(): Promise<void> {
    now += tickMs;
    const due = queue.filter((action) => action.at <= now).sort((a, b) => a.at - b.at || a.order - b.order);
    for (const action of due) {
      queue.splice(queue.indexOf(action), 1);
      await applyAction(action);
    }
    const deliveries = network.deliverDue(now);
    await Promise.all(
      agentIds.map((id) => {
        const envelopes = deliveries.get(id);
        return envelopes?.length ? host.deliver(id, envelopes) : undefined;
      }),
    );
    const outputs = await Promise.all(agentIds.map((id) => host.step(id, now)));
    outputs.forEach((envelopes) => envelopes.forEach((envelope) => network.send(envelope, now)));
  }

  async function status(): Promise<RuntimeStatus> {
    const agents = await Promise.all(agentIds.map((id) => host.snapshot(id)));
    const historyHashes = Object.fromEntries(agents.map((agent) => [agent.agentId, agent.historyHash]));
    const converged = new Set(Object.values(historyHashes)).size <= 1;
    const pendingTasks = agents.flatMap((agent) =>
      agent.tasks
        .filter((task) => task.status !== "done" && task.status !== "failed")
        .map((task) => ({ agentId: agent.agentId, taskId: task.id, kind: task.kind, status: task.status, missing: task.missing })),
    );
    // A blocked task counts too: a run with work stuck on missing evidence has not settled.
    const busy = pendingTasks.length > 0;
    const unconfirmed = agents.some((agent) => agent.peers.some((peer) => peer.pendingEventIds.length > 0));
    const settled = converged && !busy && !unconfirmed;

    if (settled && awaitingReconciliation) {
      const done = awaitingReconciliation;
      awaitingReconciliation = null;
      const sideOf = new Map<string, number>();
      done.groups.forEach((group, index) => group.forEach((id) => sideOf.set(id, index)));
      const during = (time: number | undefined) => time !== undefined && time >= done.startedAt && time < done.healedAt;
      const reconciliation: Reconciliation = {
        partitionId: done.partitionId,
        isolated: done.isolated,
        groups: done.groups,
        startedAt: done.startedAt,
        healedAt: done.healedAt,
        reconciledAt: now,
        redelivered: agents.reduce(
          (sum, agent) =>
            sum + agent.events.filter((event) => during(event.createdAt) && sideOf.get(event.origin) !== sideOf.get(agent.agentId)).length,
          0,
        ),
        duplicatesIgnored: agents.reduce((sum, agent) => sum + agent.metrics.duplicateEventsIgnored, 0) - done.duplicatesAtHeal,
        completedWhileIsolated: agents.reduce(
          (sum, agent) => sum + agent.tasks.filter((task) => task.status === "done" && during(task.finishedAt)).length,
          0,
        ),
      };
      reconciliations.push(reconciliation);
      const canonical = done.isolated.filter((id): id is AgentId => CANONICAL_AGENTS.has(id));
      if (canonical.length) {
        await recordSystemEvent(
          "reconciled",
          {
            partitionId: done.partitionId,
            isolated: canonical,
            redelivered: reconciliation.redelivered,
            duplicatesIgnored: reconciliation.duplicatesIgnored,
            completedWhileIsolated: reconciliation.completedWhileIsolated,
          },
          `Reconciled: every agent holds the same history. ${reconciliation.redelivered} event(s) caught up, ${reconciliation.duplicatesIgnored} duplicate(s) ignored, ${reconciliation.completedWhileIsolated} task(s) finished while partitioned.`,
        );
      }
    }

    return {
      now,
      nowIso: iso(now),
      host: host.kind,
      phase,
      network: network.status(),
      agents,
      historyHashes,
      converged,
      settled,
      pendingTasks,
      reconciliations: reconciliations.map((item) => ({ ...item, isolated: [...item.isolated], groups: item.groups.map((group) => [...group]) })),
    };
  }

  return {
    host,
    network,
    tickMs,
    now: () => now,
    phase: () => phase,
    schedule(actions) {
      for (const action of Array.isArray(actions) ? actions : [actions]) {
        if (!(action.at >= 0)) throw new RangeError("Actions need a time of 0 or later");
        queue.push({ ...action, order: order++ });
      }
    },
    apply: applyAction,
    tick,
    async runUntil(time) {
      while (now + tickMs <= time) await tick();
    },
    async runUntilSettled({ maxTime, checkEveryMs = 500, signal, wallClockBudgetMs }) {
      // Real time is read only to enforce the budget; it never changes what agents do.
      const deadline = wallClockBudgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + wallClockBudgetMs;
      let nextCheck = now;
      while (now + tickMs <= maxTime) {
        if (signal?.aborted) return { settled: false, at: now, stopReason: "cancelled" as const };
        if (Date.now() > deadline) return { settled: false, at: now, stopReason: "budget" as const };
        await tick();
        if (now >= nextCheck) {
          nextCheck = now + checkEveryMs;
          const pendingActions = queue.length > 0;
          if (!pendingActions && (await status()).settled) return { settled: true, at: now, stopReason: "settled" as const };
        }
      }
      const settled = (await status()).settled;
      return { settled, at: now, stopReason: settled ? ("settled" as const) : ("max-time" as const) };
    },
    status,
    scenarioLog: () => scenarioLog.map((entry) => ({ ...entry })),
    async timeline(given) {
      const current = given ?? (await status());
      const entries: TimelineEntry[] = [
        ...scenarioLog.map((entry) => ({ source: "scenario" as const, ...entry })),
        ...network.log().map((entry) => ({ source: "network" as const, ...entry })),
        ...current.agents.flatMap((agent) => agent.log.map((entry) => ({ source: "agent" as const, ...entry }))),
      ];
      return entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.at - b.entry.at || SOURCE_ORDER[a.entry.source] - SOURCE_ORDER[b.entry.source] || a.index - b.index)
        .map(({ entry }) => entry);
    },
  };
}
