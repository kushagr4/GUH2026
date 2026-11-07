import "server-only";
// The EmberGap partition demonstration: four independent agents, two shared
// synthetic scenarios from @/lib/embergap/contracts, and a network partition.
//
// Built for serverless: one call runs the whole deterministic simulation in
// memory, in milliseconds, inside a single request. Nothing runs in the
// background and nothing touches the filesystem. Persistence goes through the
// contract's EmberGapRuntimeStore (Mac's Supabase store in the app), whose
// writes are idempotent, so running the same runId again never duplicates rows.
// To show the demo step by step across requests, pass `stopAtMs`: the same
// seed and runId replay to exactly the same state, so no agent state has to be
// kept between requests.
//
// Phases:
//   connected   (0-4 s)   every agent works on investigation A; evidence replicates
//   partitioned (4-12 s)  {weather, vision} | {satellite, fusion}: both sides keep
//                         working (new passes, investigation B, a weather timeout);
//                         tasks that need the other side's evidence wait for it
//   recovered   (12 s on) links restored; anti-entropy reconciles; waiting tasks run
import {
  SYNTHETIC_NOW,
  SYNTHETIC_SCENARIOS,
  syntheticId,
  toPublicLocation,
  type AgentEvent,
  type AgentFinding,
  type EmberGapRuntimeStore,
  type Observation,
} from "@/lib/embergap/contracts";
import { SYNTHETIC_EONET_EMPTY_RESPONSE, SYNTHETIC_EONET_RESPONSE, syntheticEonetContext } from "@/lib/embergap/sources/eonet/fixtures";
import { eonetWindow } from "@/lib/embergap/sources/eonet/normalize";
import { syntheticOpenMeteoResponse, syntheticWeatherContext, unavailableWeatherContext } from "@/lib/embergap/sources/weather/fixtures";
import { hashEvent, type AgentMetrics, type PeerStatus, type TaskSnapshot } from "../agent";
import { createInProcessHost } from "../hosts/in-process";
import { createSimulatedNetwork, type LinkPolicy, type NetworkStatus } from "../network";
import type { RuntimeTask } from "../processors";
import { createSimulation, type Reconciliation, type RuntimeStatus, type ScenarioAction, type TimelineEntry } from "../simulation";
import { createMemoryRuntimeStore } from "../store";
import { createDemoAgents, DEMO_AGENT_IDS, type DemoAgentOptions } from "./demo-agents";

export const DEMO_PHASES = { connectedAt: 0, partitionedAt: 4_000, recoveredAt: 12_000 } as const;
export const DEMO_PARTITION: string[][] = [
  ["vision", "weather"],
  ["fusion", "satellite"],
];
/** 10% loss, 5% duplication and 50-400 ms of jitter on every link, seeded. */
export const DEMO_LINK: LinkPolicy = { lossRate: 0.1, duplicateRate: 0.05, minDelayMs: 50, maxDelayMs: 400 };

export type PartitionDemoOptions = {
  seed?: number;
  /** Unique per run in the app (crypto.randomUUID()); fixed in tests. */
  runId?: string;
  /** Hard cap on simulated time. The run is always bounded. Defaults to 60 s. */
  maxTimeMs?: number;
  /** Replay only up to this simulated time, for step-by-step display. */
  stopAtMs?: number;
  link?: Partial<LinkPolicy>;
  /** Where records and partition facts go. Defaults to an in-memory store. */
  store?: EmberGapRuntimeStore;
  /** Swap a stand-in for a real processor, for example Danil's vision validator. */
  processors?: DemoAgentOptions["processors"];
  onEvidence?: DemoAgentOptions["onEvidence"];
};

export type PhaseSummary = {
  name: "connected" | "partitioned" | "recovered";
  startMs: number;
  endMs: number;
  /** Tasks each agent finished during this phase. */
  tasksCompleted: Record<string, number>;
  /** Events each agent created during this phase. */
  eventsCreated: Record<string, number>;
  /** At the end of the phase. */
  blockedTasks: Array<{ agentId: string; taskId: string; kind: string; missing: string[] }>;
  /** At the end of the phase: what each agent believes about each peer. */
  reachability: Record<string, Record<string, PeerStatus>>;
  /** At the end of the phase: per agent, events not yet confirmed by each peer. */
  unconfirmed: Record<string, Record<string, number>>;
  historyHashes: Record<string, string>;
  /**
   * At the end of the phase, per investigation: the latest recommendation the
   * fusion agent made from the evidence that had reached IT. During the
   * partition this differs from what the full evidence supports.
   */
  fusion: Record<string, { recommendedStatus: string; reviewPriority: string; independentSourceCount: number; sourceFindings: number; gaps: string[] } | null>;
};

export type DemoCheck = { name: string; passed: boolean; detail: string };

export type PartitionDemoResult = {
  schemaVersion: 1;
  runId: string;
  seed: number;
  mode: "synthetic";
  host: "in-process";
  /** All times below are simulated milliseconds, not wall-clock time. */
  clock: "simulated";
  scenarioIds: string[];
  investigationIds: string[];
  /** False when `stopAtMs` cut the run short. */
  complete: boolean;
  phases: PhaseSummary[];
  partition: { groups: string[][]; startedAtMs: number; healedAtMs: number };
  convergence: {
    converged: boolean;
    settled: boolean;
    settledAtMs: number | null;
    msAfterHeal: number | null;
    historyHashes: Record<string, string>;
  };
  reconciliation: Reconciliation | null;
  checks: DemoCheck[];
  agents: Array<{
    agentId: string;
    lastSeq: number;
    eventCount: number;
    historyHash: string;
    metrics: AgentMetrics;
    tasks: TaskSnapshot[];
  }>;
  network: NetworkStatus;
  /** What the store received, in the contract's own shapes. */
  records: { observations: Observation[]; findings: AgentFinding[]; events: AgentEvent[] } | null;
  /** The merged timeline, trimmed to what a dashboard shows. */
  timeline: TimelineEntry[];
  /** The demo's story in order, for a dashboard to step through. Only stages the run reached. */
  stages: DemoStage[];
};

export type DemoStage = {
  stage: "connected" | "partitioned" | "working_in_isolation" | "reconnected" | "reconciled";
  /** Simulated milliseconds. */
  atMs: number;
  detail: string;
};

/** Builds the five stages from the run's own phase summaries and reconciliation. */
export function demoStages(phases: readonly PhaseSummary[], reconciliation: Reconciliation | null, settledAtMs: number | null): DemoStage[] {
  const stages: DemoStage[] = [];
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, value) => total + value, 0);
  const [connected, partitioned] = phases;
  if (connected) {
    stages.push({ stage: "connected", atMs: connected.startMs, detail: `All agents connected. Each works through its own queue: ${sum(connected.tasksCompleted)} task(s) finished and shared.` });
  }
  if (partitioned) {
    stages.push({ stage: "partitioned", atMs: partitioned.startMs, detail: `Network split: ${DEMO_PARTITION.map((group) => group.join(" + ")).join(" | ")}. No agent is paused.` });
    const blocked = partitioned.blockedTasks.map((task) => task.taskId.split(":").slice(1).join(":"));
    stages.push({
      stage: "working_in_isolation",
      atMs: partitioned.startMs,
      detail: `${sum(partitioned.tasksCompleted)} task(s) finished on both sides while cut off; agents hold different evidence (${new Set(Object.values(partitioned.historyHashes)).size} distinct histories).${blocked.length ? ` Waiting for evidence from across the cut: ${blocked.join(", ")}.` : ""}`,
    });
    if (phases.length > 2) stages.push({ stage: "reconnected", atMs: partitioned.endMs, detail: "Links restored. Agents exchange digests and send each other what is missing." });
  }
  if (reconciliation && settledAtMs !== null) {
    stages.push({
      stage: "reconciled",
      atMs: settledAtMs,
      detail: `Every agent holds the same history. ${reconciliation.redelivered} event(s) caught up, ${reconciliation.duplicatesIgnored} duplicate(s) ignored, and fusion re-ran on the full evidence.`,
    });
  }
  return stages;
}

const scenario = (id: (typeof SYNTHETIC_SCENARIOS)[number]["id"]) => {
  const found = SYNTHETIC_SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown scenario ${id}`);
  return found;
};

const HOUR_MS = 3_600_000;
const DEMO_INVESTIGATIONS = [scenario("partition-recovery").investigationId, scenario("weather-timeout").investigationId];

/** Every input the agents receive, built from labelled synthetic fixtures. */
export function demoActions(): ScenarioAction[] {
  const a = scenario("partition-recovery");
  const b = scenario("weather-timeout");
  const placeA = toPublicLocation(a.report);
  const placeB = toPublicLocation(b.report);
  const weatherQuery = (place: { latitude: number; longitude: number }, at: string) => ({
    latitude: place.latitude,
    longitude: place.longitude,
    timeOfInterest: at,
    hoursBefore: 24,
    hoursAfter: 6,
  });
  const queryA = weatherQuery(placeA, a.report.observedAt);
  const weatherA = syntheticWeatherContext(
    queryA,
    syntheticOpenMeteoResponse({
      startIso: new Date(Math.floor(Date.parse(a.report.observedAt) / HOUR_MS) * HOUR_MS - 24 * HOUR_MS).toISOString(),
      hours: 31,
      profile: "fire-weather",
      currentIso: SYNTHETIC_NOW,
      gridCell: { latitude: 53.463, longitude: -1.857, elevation: 410 },
    }),
    { retrievedAt: SYNTHETIC_NOW },
  );
  // The "weather-timeout" scenario: Open-Meteo didn't answer. Unknown, not negative.
  const weatherB = unavailableWeatherContext(weatherQuery(placeB, b.report.observedAt), { retrievedAt: SYNTHETIC_NOW, kind: "timeout" });
  const eonetQuery = (place: { latitude: number; longitude: number }, at: string) => ({
    latitude: place.latitude,
    longitude: place.longitude,
    radiusKm: 50,
    limit: 50,
    ...eonetWindow(at),
  });
  const eonetA = syntheticEonetContext(eonetQuery(placeA, a.report.observedAt), SYNTHETIC_EONET_RESPONSE, { retrievedAt: SYNTHETIC_NOW });
  const eonetB = syntheticEonetContext(eonetQuery(placeB, b.report.observedAt), SYNTHETIC_EONET_EMPTY_RESPONSE, { retrievedAt: SYNTHETIC_NOW });
  const pass = (passId: string, satellite: string, windowStart: string, windowEnd: string, detections: unknown[]) => ({
    passId,
    satellite,
    instrument: "VIIRS",
    windowStart,
    windowEnd,
    radiusKm: 10,
    detections,
  });
  const detection = (latitude: number, longitude: number, acquiredAt: string, distanceKm: number, frpMegawatts: number) => ({
    latitude,
    longitude,
    acquiredAt,
    frpMegawatts,
    brightnessKelvin: 336.5,
    confidence: "nominal",
    distanceKm,
  });
  const task = (investigationId: string, name: string, kind: string, input: unknown, after?: string[]): RuntimeTask => ({
    id: `${investigationId}:${name}`,
    investigationId,
    kind,
    input,
    ...(after ? { after: after.map((producer) => `${investigationId}:${producer}`) } : {}),
  });
  const enqueue = (at: number, agentId: string, runtimeTask: RuntimeTask): ScenarioAction => ({ at, kind: "enqueue", agentId, task: runtimeTask });
  const A = a.investigationId;
  const B = b.investigationId;
  const later = DEMO_PHASES.partitionedAt + 500;

  return [
    { at: DEMO_PHASES.connectedAt, kind: "phase", name: "connected" },
    enqueue(0, "weather", task(A, "weather/context", "weather.context", { context: weatherA })),
    enqueue(0, "weather", task(A, "weather/eonet", "eonet.context", { context: eonetA, timeOfInterest: a.report.observedAt })),
    enqueue(0, "satellite", task(A, "satellite/pass-1", "satellite.pass", pass("a-pass-1", "NOAA-20", "2026-11-07T11:30:00.000Z", "2026-11-07T12:00:00.000Z", [detection(53.466, -1.846, "2026-11-07T11:52:00.000Z", 0.6, 14.2)]))),
    enqueue(0, "vision", task(A, "vision/assess", "vision.assess", { mediaId: syntheticId("runtime-demo/partition-recovery/media"), reportObservedAt: a.report.observedAt, labels: ["smoke plume", "hillside"], smokeLike: true })),
    enqueue(0, "weather", task(A, "weather/detection-1", "weather.detection-context", { context: weatherA }, ["satellite/pass-1"])),

    { at: DEMO_PHASES.partitionedAt, kind: "phase", name: "partitioned" },
    { at: DEMO_PHASES.partitionedAt, kind: "partition", groups: DEMO_PARTITION },
    // Isolated side: a second satellite pass over A, and the first over B.
    enqueue(later, "satellite", task(A, "satellite/pass-2", "satellite.pass", pass("a-pass-2", "Suomi-NPP", "2026-11-07T11:55:00.000Z", "2026-11-07T12:00:00.000Z", [detection(53.468, -1.861, "2026-11-07T11:58:00.000Z", 0.9, 22.8), detection(53.455, -1.84, "2026-11-07T11:58:00.000Z", 1.4, 9.6)]))),
    enqueue(later, "satellite", task(B, "satellite/pass-1", "satellite.pass", pass("b-pass-1", "NOAA-20", "2026-11-07T10:45:00.000Z", "2026-11-07T11:15:00.000Z", [detection(53.61, -1.92, "2026-11-07T11:05:00.000Z", 1.1, 11.3)]))),
    // Main side: investigation B arrives, and its weather source times out.
    enqueue(later, "weather", task(B, "weather/context", "weather.context", { context: weatherB })),
    enqueue(later, "weather", task(B, "weather/eonet", "eonet.context", { context: eonetB, timeOfInterest: b.report.observedAt })),
    enqueue(later, "vision", task(B, "vision/assess", "vision.assess", { mediaId: syntheticId("runtime-demo/weather-timeout/media"), reportObservedAt: b.report.observedAt, labels: ["smoke"], smokeLike: true })),
    // These need satellite evidence from across the cut, so they wait.
    enqueue(later, "weather", task(A, "weather/detection-2", "weather.detection-context", { context: weatherA }, ["satellite/pass-2"])),
    enqueue(later, "weather", task(B, "weather/detection-1", "weather.detection-context", { context: weatherB }, ["satellite/pass-1"])),

    { at: DEMO_PHASES.recoveredAt, kind: "phase", name: "recovered" },
    { at: DEMO_PHASES.recoveredAt, kind: "heal" },
  ];
}

const TIMELINE_KINDS = new Set(["task.blocked", "task.unblocked", "task.completed", "task.failed", "peer.unreachable", "peer.reachable", "sync.received-events", "event.conflict"]);

function summarisePhase(name: PhaseSummary["name"], startMs: number, endMs: number, status: RuntimeStatus): PhaseSummary {
  const within = (time: number | undefined) => time !== undefined && time >= startMs && time < endMs;
  const tasksCompleted: Record<string, number> = {};
  const eventsCreated: Record<string, number> = {};
  const reachability: Record<string, Record<string, PeerStatus>> = {};
  const unconfirmed: Record<string, Record<string, number>> = {};
  const fusionAgent = status.agents.find((agent) => agent.agentId === "fusion");
  const fusion: PhaseSummary["fusion"] = {};
  for (const investigationId of DEMO_INVESTIGATIONS) {
    const findings = (fusionAgent?.events ?? []).flatMap((event) =>
      event.payload.kind === "finding" && event.investigationId === investigationId ? [event.payload.finding] : [],
    );
    const latest = findings.filter((finding) => finding.agentId === "fusion" && finding.recommendation).at(-1);
    fusion[investigationId] = latest?.recommendation
      ? {
          recommendedStatus: latest.recommendation.recommendedStatus,
          reviewPriority: latest.recommendation.reviewPriority,
          independentSourceCount: latest.recommendation.independentSourceCount,
          sourceFindings: findings.filter((finding) => finding.agentId !== "fusion").length,
          gaps: latest.recommendation.evidenceGaps,
        }
      : null;
  }
  for (const agent of status.agents) {
    tasksCompleted[agent.agentId] = agent.tasks.filter((task) => task.status === "done" && within(task.finishedAt)).length;
    eventsCreated[agent.agentId] = agent.events.filter((event) => event.origin === agent.agentId && within(event.createdAt)).length;
    reachability[agent.agentId] = Object.fromEntries(agent.peers.map((peer) => [peer.id, peer.status]));
    unconfirmed[agent.agentId] = Object.fromEntries(agent.peers.map((peer) => [peer.id, peer.pendingEventIds.length]));
  }
  return {
    name,
    startMs,
    endMs,
    tasksCompleted,
    eventsCreated,
    blockedTasks: status.pendingTasks
      .filter((task) => task.status === "blocked")
      .map(({ agentId, taskId, kind, missing }) => ({ agentId, taskId, kind, missing })),
    reachability,
    unconfirmed,
    historyHashes: status.historyHashes,
    fusion,
  };
}

/** Checks that can fail: each compares replicas with each origin's own records. */
export function demoChecks(final: RuntimeStatus, actions: readonly ScenarioAction[]): DemoCheck[] {
  const checks: DemoCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const agents = final.agents;

  const recomputedOk = agents.every((agent) => agent.events.every((event) => {
    const { hash, ...rest } = event;
    return hashEvent(rest) === hash;
  }));
  add("identical histories", final.converged && recomputedOk, `history hashes: ${[...new Set(Object.values(final.historyHashes))].join(", ")}`);

  const missing: string[] = [];
  for (const origin of agents) {
    for (const holder of agents) {
      const seqs = new Set(holder.events.filter((event) => event.origin === origin.agentId).map((event) => event.seq));
      for (let seq = 1; seq <= origin.lastSeq; seq += 1) if (!seqs.has(seq)) missing.push(`${holder.agentId} lacks ${origin.agentId}#${seq}`);
    }
  }
  add("no event lost", missing.length === 0, missing.length ? missing.slice(0, 5).join("; ") : "every replica holds every origin's events 1..lastSeq");

  const scheduled = actions.flatMap((action) => (action.kind === "enqueue" ? [action.task.id] : []));
  const reference = agents[0]?.events ?? [];
  const duplicates = scheduled.filter((taskId) => reference.filter((event) => event.payload.kind === "outcome" && event.taskId === taskId).length !== 1);
  const ranTwice = agents.flatMap((agent) => agent.tasks.filter((task) => task.runs > 1).map((task) => task.id));
  add("each task processed exactly once", duplicates.length === 0 && ranTwice.length === 0, duplicates.length || ranTwice.length ? `problems: ${[...duplicates, ...ranTwice].join(", ")}` : `${scheduled.length} tasks, one outcome each`);

  const reconciliation = final.reconciliations[0];
  if (reconciliation) {
    const side = new Map<string, number>();
    reconciliation.groups.forEach((group, index) => group.forEach((id) => side.set(id, index)));
    const busySides = new Set(
      agents.flatMap((agent) =>
        agent.tasks.some((task) => task.status === "done" && task.finishedAt !== undefined && task.finishedAt >= reconciliation.startedAt && task.finishedAt < reconciliation.healedAt)
          ? [side.get(agent.agentId)]
          : [],
      ),
    );
    add("work continued on both sides of the partition", busySides.size === reconciliation.groups.length, `${reconciliation.completedWhileIsolated} task(s) finished while partitioned`);
    const waited = agents.flatMap((agent) => agent.tasks.filter((task) => task.after.length > 0 && (task.finishedAt ?? 0) >= reconciliation.healedAt));
    add("cross-partition tasks waited for the evidence, then ran", waited.length > 0 && waited.every((task) => task.status === "done" && task.runs === 1), waited.map((task) => task.id).join(", ") || "none");
  } else {
    add("partition reconciled", false, "no reconciliation was recorded");
  }
  add("settled", final.settled, final.pendingTasks.length ? `pending: ${final.pendingTasks.map((task) => task.taskId).join(", ")}` : "nothing pending");
  return checks;
}

/** Runs the whole demonstration. Deterministic for a given seed and runId. */
export async function runPartitionDemo(options: PartitionDemoOptions = {}): Promise<PartitionDemoResult> {
  const seed = options.seed ?? 2026;
  const runId = options.runId ?? "demo-partition";
  const maxTimeMs = options.maxTimeMs ?? 60_000;
  const memory = options.store ? null : createMemoryRuntimeStore();
  const store = options.store ?? memory!;
  // createDemoAgents defaults to Danil's vision validator and fusion, so fusion
  // visibly re-decides as evidence reaches it. Pass processors to swap any of them.
  const agents = createDemoAgents({ runId, store, processors: options.processors, onEvidence: options.onEvidence, epochIso: SYNTHETIC_NOW });
  const network = createSimulatedNetwork({ nodes: [...DEMO_AGENT_IDS], seed, defaultLink: { ...DEMO_LINK, ...options.link } });
  const simulation = createSimulation({ host: createInProcessHost(agents), network, store, runId, isSynthetic: true, epochIso: SYNTHETIC_NOW });
  const actions = demoActions();
  simulation.schedule(actions);

  const stopAt = Math.min(options.stopAtMs ?? Number.POSITIVE_INFINITY, maxTimeMs);
  const phases: PhaseSummary[] = [];
  const boundaries: Array<[PhaseSummary["name"], number, number]> = [
    ["connected", DEMO_PHASES.connectedAt, DEMO_PHASES.partitionedAt],
    ["partitioned", DEMO_PHASES.partitionedAt, DEMO_PHASES.recoveredAt],
  ];
  for (const [name, start, end] of boundaries) {
    if (stopAt < end) break;
    await simulation.runUntil(end);
    phases.push(summarisePhase(name, start, end, await simulation.status()));
  }
  let settledAtMs: number | null = null;
  if (stopAt >= DEMO_PHASES.recoveredAt) {
    const run = Number.isFinite(stopAt) && options.stopAtMs !== undefined
      ? (await simulation.runUntil(stopAt), { settled: (await simulation.status()).settled, at: simulation.now() })
      : await simulation.runUntilSettled({ maxTime: maxTimeMs });
    if (run.settled) settledAtMs = run.at;
    phases.push(summarisePhase("recovered", DEMO_PHASES.recoveredAt, simulation.now() + 1, await simulation.status()));
  } else {
    await simulation.runUntil(stopAt);
  }

  const final = await simulation.status();
  const timeline = (await simulation.timeline(final))
    .filter((entry) => entry.source === "scenario" || (entry.source === "network" && entry.kind !== "dropped" && entry.kind !== "duplicated" && entry.kind !== "delayed") || (entry.source === "agent" && TIMELINE_KINDS.has(entry.kind)))
    .slice(0, 400);
  const contents = memory?.contents();
  const complete = settledAtMs !== null;

  return {
    schemaVersion: 1,
    runId,
    seed,
    mode: "synthetic",
    host: "in-process",
    clock: "simulated",
    scenarioIds: ["partition-recovery", "weather-timeout"],
    investigationIds: [scenario("partition-recovery").investigationId, scenario("weather-timeout").investigationId],
    complete,
    phases,
    partition: { groups: DEMO_PARTITION, startedAtMs: DEMO_PHASES.partitionedAt, healedAtMs: DEMO_PHASES.recoveredAt },
    convergence: {
      converged: final.converged,
      settled: final.settled,
      settledAtMs,
      msAfterHeal: settledAtMs === null ? null : settledAtMs - DEMO_PHASES.recoveredAt,
      historyHashes: final.historyHashes,
    },
    reconciliation: final.reconciliations[0] ?? null,
    checks: complete ? demoChecks(final, actions) : [],
    agents: final.agents.map((agent) => ({
      agentId: agent.agentId,
      lastSeq: agent.lastSeq,
      eventCount: agent.events.length,
      historyHash: agent.historyHash,
      metrics: agent.metrics,
      tasks: agent.tasks,
    })),
    network: final.network,
    records: contents ? { observations: contents.observations, findings: contents.findings, events: contents.events } : null,
    timeline,
    stages: demoStages(phases, final.reconciliations[0] ?? null, settledAtMs),
  };
}
