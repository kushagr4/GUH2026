// Runs the five agents on ONE real or synthetic investigation, from prepared,
// canonical inputs. This is the stable entry point for a backend orchestrator.
//
// It is a deterministic, single-process SIMULATION of independent agents: each
// agent has its own queue and replica and decides from what has reached it,
// messages cross a simulated network, and an optional simulated partition
// shows agents working apart and reconciling. It finishes inside one short
// serverless call and makes no network requests: fetch upstream data first.
//
// Outputs go through the contract's EmberGapRuntimeStore (idempotent): source
// observations, each agent's findings, fusion recommendations (re-run as
// evidence arrives), finding_recorded, task_queued and message_delivered
// (evidence-sharing) events, partition and reconciliation events, and the
// automated status from the latest fusion recommendation.
import {
  AGENT_IDS,
  agentEventSchema,
  stableId,
  syntheticId,
  type AgentEvent,
  type AgentFinding,
  type AgentId,
  type EmberGapRuntimeStore,
  type Observation,
  type SourceAvailability,
  type Timestamp,
} from "@/lib/embergap/contracts";
import {
  fusionOnEvidence,
  fusionProcessor,
  visionValidatorProcessor,
  type VisionTaskInput,
} from "@/lib/embergap/agents/fusion/runtime-processors";
import { RuntimeAgent } from "../agent";
import { createInProcessHost } from "../hosts/in-process";
import { PERFECT_LINK, createSimulatedNetwork, type LinkPolicy } from "../network";
import type { EvidenceHook, RuntimeMode, RuntimeTask, TaskProcessor } from "../processors";
import { createSimulation, type Reconciliation, type ScenarioAction } from "../simulation";
import {
  eonetObservationsProcessor,
  satelliteObservationsProcessor,
  weatherObservationsProcessor,
  witnessFindingsProcessor,
} from "./inputs";

export const INVESTIGATION_AGENT_IDS = ["fusion", "satellite", "vision", "weather", "witness"] as const satisfies readonly AgentId[];

/** A simulated partition inside the run, for showing agents working apart. */
export type SimulatedPartition = { startMs: number; healMs: number; groups: AgentId[][] };

/** The demo's default: the source side keeps working, fusion and witness wait for the heal. */
export const DEFAULT_SIMULATED_PARTITION: SimulatedPartition = {
  startMs: 200,
  healMs: 6_000,
  groups: [
    ["satellite", "vision", "weather"],
    ["fusion", "witness"],
  ],
};

export type InvestigationAgentsInput = {
  investigationId: string;
  /** Stable per run, so a retried run rewrites the same ids: lowercase UUID or slug. */
  runId: string;
  mode: RuntimeMode;
  /** Real time at simulated time 0. */
  startedAt: Timestamp;
  /** The investigation's reports, by id only: their text and location never enter the runtime. */
  reports: Array<{ id: string; observedAt: Timestamp; hasMedia: boolean }>;
  /** Canonical observations from the source adapters: weather, eonet and firms. */
  observations?: Observation[];
  /** What each source reported about itself, including those with no observations. */
  sourceAvailability?: SourceAvailability[];
  /** Danil's validated witness findings, canonical. */
  witnessFindings?: AgentFinding[];
  /** Model output the server already fetched for one photo, for Danil's vision processor. */
  vision?: VisionTaskInput | null;
  store: EmberGapRuntimeStore;
  signal?: AbortSignal;
  /** Real-time budget for the simulation loop. Defaults to 10 s; it normally needs well under 1 s. */
  budgetMs?: number;
  /** Simulated network faults. Defaults to a perfect network. */
  link?: Partial<LinkPolicy>;
  partition?: SimulatedPartition | null;
  seed?: number;
  /** Replace a processor by kind, for example a different vision validator. */
  processors?: Partial<Record<AgentId, readonly TaskProcessor<never>[]>>;
  onEvidence?: Partial<Record<AgentId, EvidenceHook>>;
};

export type InvestigationAgentsResult = {
  investigationId: string;
  runId: string;
  mode: RuntimeMode;
  host: "in-process";
  clock: "simulated";
  stopReason: "settled" | "max-time" | "cancelled" | "budget";
  settled: boolean;
  converged: boolean;
  simulatedMs: number;
  wallMs: number;
  tasks: Array<{ agentId: string; taskId: string; kind: string; status: string; runs: number; error?: { code: string; message: string } }>;
  /** Every finding in the converged history, including each fusion run. */
  findings: AgentFinding[];
  /** The latest fusion finding, whose recommendation set the automated status. */
  recommendation: AgentFinding | null;
  reconciliation: Reconciliation | null;
  /** Per agent: how many records it holds from each other agent. */
  evidenceSharing: Array<{ agentId: string; fromAgent: string; records: number }>;
  historyHashes: Record<string, string>;
  /** Inputs dropped before the run, for example synthetic records in a live run. */
  rejectedInputs: number;
};

const DEFAULT_PROCESSORS: Record<(typeof INVESTIGATION_AGENT_IDS)[number], readonly TaskProcessor<never>[]> = {
  weather: [weatherObservationsProcessor, eonetObservationsProcessor] as unknown as TaskProcessor<never>[],
  satellite: [satelliteObservationsProcessor] as unknown as TaskProcessor<never>[],
  vision: [visionValidatorProcessor] as unknown as TaskProcessor<never>[],
  witness: [witnessFindingsProcessor] as unknown as TaskProcessor<never>[],
  fusion: [fusionProcessor] as unknown as TaskProcessor<never>[],
};

const CANONICAL = new Set<string>(AGENT_IDS);

export async function runInvestigationAgents(input: InvestigationAgentsInput): Promise<InvestigationAgentsResult> {
  const started = Date.now();
  const isSynthetic = input.mode === "synthetic";
  const idFor = (name: string) => (isSynthetic ? syntheticId(`runtime/${name}`) : stableId(`runtime:${name}`));

  // Live runs never mix in fixtures: drop synthetic inputs and count them.
  let rejectedInputs = 0;
  const keep = <T extends { provenance?: { isSynthetic: boolean }; isSynthetic?: boolean }>(items: readonly T[]) =>
    items.filter((item) => {
      const synthetic = item.provenance?.isSynthetic ?? item.isSynthetic ?? false;
      const ok = isSynthetic || !synthetic;
      if (!ok) rejectedInputs += 1;
      return ok;
    });
  const observations = keep((input.observations ?? []).filter((item) => item.investigationId === input.investigationId));
  const witnessFindings = keep((input.witnessFindings ?? []).filter((item) => item.investigationId === input.investigationId));

  const agents = INVESTIGATION_AGENT_IDS.map((id) => {
    const custom = input.processors?.[id] ?? [];
    const kinds = new Set(custom.map((processor) => processor.kind));
    return new RuntimeAgent({
      id,
      runId: input.runId,
      peers: INVESTIGATION_AGENT_IDS.filter((peer) => peer !== id),
      processors: [...DEFAULT_PROCESSORS[id].filter((processor) => !kinds.has(processor.kind)), ...custom],
      onEvidence: input.onEvidence?.[id] ?? (id === "fusion" ? fusionOnEvidence : undefined),
      store: input.store,
      mode: input.mode,
      epochIso: input.startedAt,
    });
  });
  const network = createSimulatedNetwork({ nodes: [...INVESTIGATION_AGENT_IDS], seed: input.seed ?? 1, defaultLink: { ...PERFECT_LINK, ...input.link } });
  const simulation = createSimulation({
    host: createInProcessHost(agents),
    network,
    store: input.store,
    runId: input.runId,
    isSynthetic,
    epochIso: input.startedAt,
  });

  // Each agent gets only its own feed.
  const tasks: Array<{ agentId: AgentId; task: RuntimeTask }> = [];
  const task = (agentId: AgentId, name: string, kind: string, taskInput: unknown) =>
    tasks.push({ agentId, task: { id: `${input.investigationId}:${name}`, investigationId: input.investigationId, kind, input: taskInput } });
  const availability = (source: SourceAvailability["source"]) => input.sourceAvailability?.find((item) => item.source === source) ?? null;
  for (const [source, agentId, kind] of [
    ["weather", "weather", "weather.observations"],
    ["eonet", "weather", "eonet.observations"],
    ["firms", "satellite", "satellite.observations"],
  ] as const) {
    const own = observations.filter((item) => item.source === source);
    const state = availability(source);
    if (own.length > 0 || state) task(agentId, `${agentId}/${source}`, kind, { observations: own, availability: state });
  }
  if (input.vision) task("vision", "vision/assess", "vision.assess", input.vision);
  if (witnessFindings.length > 0) {
    task("witness", "witness/findings", "witness.findings", { findings: witnessFindings, reportIds: input.reports.map((report) => report.id) });
  }

  const actions: ScenarioAction[] = tasks.map(({ agentId, task: runtimeTask }) => ({ at: 0, kind: "enqueue", agentId, task: runtimeTask }));
  if (input.partition) {
    actions.push({ at: input.partition.startMs, kind: "partition", groups: input.partition.groups.map((group) => [...group]) });
    actions.push({ at: input.partition.healMs, kind: "heal" });
  }
  simulation.schedule(actions);

  // The intake records report_submitted; the runtime records what it queued.
  const queued: AgentEvent[] = tasks.flatMap(({ agentId, task: runtimeTask }) => {
    const parsed = agentEventSchema.safeParse({
      id: idFor(`${input.runId}/task_queued/${runtimeTask.id}`),
      investigationId: input.investigationId,
      type: "task_queued",
      actor: "system",
      occurredAt: input.startedAt,
      recordedAt: input.startedAt,
      idempotencyKey: `task_queued:${runtimeTask.id}`,
      messageId: null,
      summary: `Queued ${runtimeTask.kind} for the ${agentId} agent.`,
      details: { taskId: runtimeTask.id, kind: runtimeTask.kind, agentId },
      isSynthetic,
    });
    return parsed.success ? [parsed.data] : [];
  });
  if (queued.length) await input.store.appendEvents(queued);

  const run = await simulation.runUntilSettled({ maxTime: 60_000, signal: input.signal, wallClockBudgetMs: input.budgetMs ?? 10_000 });
  const status = await simulation.status();

  // The converged history, from the fusion agent's replica (identical to every other when settled).
  const fusionView = status.agents.find((agent) => agent.agentId === "fusion") ?? status.agents[0];
  const findings = fusionView.events.flatMap((event) => (event.payload.kind === "finding" ? [event.payload.finding] : []));
  const fusionFindings = findings.filter((finding) => finding.agentId === "fusion" && finding.recommendation);
  const recommendation = fusionFindings.at(-1) ?? null;
  if (recommendation?.recommendation) {
    await input.store.setAutomatedStatus(input.investigationId, recommendation.recommendation.recommendedStatus, recommendation.recommendation.reviewPriority);
  }

  // Evidence sharing, as one timeline fact per (receiver, origin) pair.
  const evidenceSharing = status.agents.flatMap((agent) => {
    const counts = new Map<string, number>();
    for (const event of agent.events) {
      if (event.origin !== agent.agentId && event.payload.kind !== "outcome") counts.set(event.origin, (counts.get(event.origin) ?? 0) + 1);
    }
    return [...counts.entries()].sort().map(([fromAgent, records]) => ({ agentId: agent.agentId, fromAgent, records }));
  });
  const shared: AgentEvent[] = evidenceSharing.flatMap((item) => {
    if (!CANONICAL.has(item.agentId)) return [];
    const parsed = agentEventSchema.safeParse({
      id: idFor(`${input.runId}/message_delivered/${item.fromAgent}/${item.agentId}`),
      investigationId: input.investigationId,
      type: "message_delivered",
      actor: item.agentId,
      occurredAt: status.nowIso,
      recordedAt: status.nowIso,
      idempotencyKey: `message_delivered:${input.runId}:${item.fromAgent}:${item.agentId}`,
      messageId: null,
      summary: `The ${item.agentId} agent received ${item.records} record(s) shared by the ${item.fromAgent} agent.`,
      details: { from: item.fromAgent, to: item.agentId, records: item.records },
      isSynthetic,
    });
    return parsed.success ? [parsed.data] : [];
  });
  if (shared.length) await input.store.appendEvents(shared);

  return {
    investigationId: input.investigationId,
    runId: input.runId,
    mode: input.mode,
    host: "in-process",
    clock: "simulated",
    stopReason: run.stopReason,
    settled: run.settled,
    converged: status.converged,
    simulatedMs: status.now,
    wallMs: Date.now() - started,
    tasks: status.agents.flatMap((agent) =>
      agent.tasks.map((item) => ({ agentId: agent.agentId, taskId: item.id, kind: item.kind, status: item.status, runs: item.runs, error: item.error })),
    ),
    findings,
    recommendation,
    reconciliation: status.reconciliations[0] ?? null,
    evidenceSharing,
    historyHashes: status.historyHashes,
    rejectedInputs,
  };
}
