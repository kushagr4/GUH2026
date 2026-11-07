import "server-only";
import { after } from "next/server";
import { DANIL_PROCESSORS } from "@/lib/embergap/agents/fusion/runtime-processors";
import {
  PERFECT_LINK,
  RuntimeAgent,
  createInProcessHost,
  createSimulatedNetwork,
  createSimulation,
  type ScenarioAction,
  type TaskProcessor,
} from "@/lib/embergap/agents/runtime";
import { eonetContextProcessor, weatherContextProcessor } from "@/lib/embergap/agents/runtime/scenarios/demo-agents";
import type { VisionAnalyzer } from "@/lib/embergap/agents/validators/vision";
import {
  SYNTHETIC_NOW,
  stableId,
  toPublicLocation,
  type AgentEvent,
  type AgentEventType,
  type AgentFinding,
  type AgentId,
  type AgentReport,
  type EmberGapRuntimeStore,
  type Id,
  type InvestigationStatus,
  type ReviewPriority,
  type Timestamp,
} from "@/lib/embergap/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAC_PROCESSORS, type VisionGapReason, type WitnessTaskInput } from "./processors";
import { createSupabaseRuntimeStore, loadAgentReports, loadMediaRef } from "./runtime";
import { liveSourceGatherer, syntheticSourceGatherer, type SourceGatherer } from "./sources";
import { getLiveVisionAnalyzer } from "./vision";

/**
 * Investigation runs that fit Vercel's serverless model (Claude Mac).
 *
 * 1. The request that created a report schedules a run with after()
 *    (scheduleInvestigation). There are no long-lived workers, timers or
 *    in-memory buses between requests.
 * 2. The run gathers evidence on the server, concurrently and each with a
 *    deadline: NASA FIRMS (Outrolife), Open-Meteo and NASA EONET (Claude PC),
 *    and the photo through a live vision model when one is configured (Danil).
 * 3. Five independent agents (witness, vision, satellite, weather, fusion) run
 *    in Claude PC's runtime, each with its own queue, processors and replica.
 *    They share nothing but the simulated network. Each writes its own
 *    observations and findings through EmberGapRuntimeStore. Fusion (Danil)
 *    runs once every source task has an outcome, on the evidence it holds.
 * 4. The fusion agent's recommendation becomes the automated status, with a
 *    status_changed event that explains it. A failed run records a visible,
 *    retryable failure instead of leaving the investigation silently stuck.
 *
 * Every id derives from the investigation and its reports (the run id), and
 * every write is idempotent, so a retried run never duplicates anything.
 */

export type InvestigationRun = {
  investigationId: Id;
  /** The investigation's reports, oldest first: the first is the one that opened it. */
  reports: AgentReport[];
  store: EmberGapRuntimeStore;
  now: () => Timestamp;
  /** Stable per investigation and name, so a retried run writes the same IDs. */
  newId: (name: string) => Id;
  /** Aborts when the run's time budget is spent. */
  signal: AbortSignal;
  /** Where evidence comes from. Defaults to live sources, or fixtures for synthetic investigations. */
  gather?: SourceGatherer;
  /** A live vision model (Danil). Null or missing: the photo is reported as not analysed. */
  visionAnalyzer?: VisionAnalyzer | null;
  /** The private Storage reference for a photo, for the vision analyzer. */
  loadMediaRef?: (mediaId: Id) => Promise<{ imageRef: string; mimeType: string } | null>;
  /** Extra simulated network actions, for example a partition in a demo or test. */
  networkActions?: ScenarioAction[];
};

export type InvestigationRunner = (run: InvestigationRun) => Promise<RunSummary>;

export type RunSummary = {
  runId: string;
  mode: "live" | "synthetic";
  /** Task id to its outcome. */
  tasks: Record<string, "done" | "failed" | "pending">;
  status: InvestigationStatus;
  reviewPriority: ReviewPriority | null;
  fusionFindingId: Id | null;
  storeWriteFailures: number;
};

/** Stays well inside the route's maxDuration (60 s), so the run can finish its writes. */
export const RUN_BUDGET_MS = 45_000;
/** A run that started this long ago without finishing was interrupted, and may run again. */
export const RUN_STALE_MS = 75_000;
const VISION_TIMEOUT_MS = 20_000;
/** Simulated time is milliseconds of agent work, not wall time: a run takes a few ms. */
const MAX_SIMULATED_MS = 60_000;

export const RUN_AGENT_IDS = ["fusion", "satellite", "vision", "weather", "witness"] as const satisfies readonly AgentId[];

/** One run per (investigation, report set). Lowercase UUID, as the runtime's run id pattern needs. */
export function runIdFor(investigationId: Id, reports: readonly { id: string }[]): string {
  return stableId(`run:${investigationId}:${reports.map((report) => report.id).sort().join(",")}`);
}

export const runEventKeys = (runId: string) => ({
  started: `status_changed:${runId}:started`,
  finished: `status_changed:${runId}:finished`,
  failed: (attempt: string) => `status_changed:${runId}:failed:${attempt}`,
});

function systemEvent(
  run: InvestigationRun,
  type: AgentEventType,
  idempotencyKey: string,
  summary: string,
  isSynthetic: boolean,
  details: Record<string, unknown> | null = null,
  at: Timestamp = run.now(),
): AgentEvent {
  return {
    id: stableId(`${run.investigationId}:event:${idempotencyKey}`),
    investigationId: run.investigationId,
    type,
    actor: "system",
    occurredAt: at,
    recordedAt: at,
    idempotencyKey,
    messageId: null,
    summary: summary.slice(0, 300),
    details,
    isSynthetic,
  };
}

const PROCESSORS: Record<(typeof RUN_AGENT_IDS)[number], readonly TaskProcessor<never>[]> = {
  weather: [weatherContextProcessor, eonetContextProcessor] as unknown as TaskProcessor<never>[],
  satellite: MAC_PROCESSORS.satellite,
  vision: [...DANIL_PROCESSORS.vision, ...MAC_PROCESSORS.vision],
  witness: MAC_PROCESSORS.witness,
  fusion: DANIL_PROCESSORS.fusion,
};

function witnessInput(reports: readonly AgentReport[]): WitnessTaskInput {
  return {
    reports: reports.map((report) => {
      const place = toPublicLocation(report.location);
      return {
        id: report.id,
        reporterId: report.reporterKey,
        observedAt: report.observedAt,
        submittedAt: report.submittedAt,
        latitude: place.latitude,
        longitude: place.longitude,
        locationPrecisionM: place.precisionMeters,
        description: report.description,
        ...(report.media?.sha256 ? { photoSha256: report.media.sha256 } : {}),
      };
    }),
  };
}

/** The vision task: Danil's validator on real model output, or an honest gap. Never a fixture for a real photo. */
async function visionTask(run: InvestigationRun, report: AgentReport): Promise<{ kind: string; input: unknown }> {
  const gap = (reason: VisionGapReason) => ({ kind: "vision.unavailable", input: { reason, mediaId: report.media?.mediaId ?? null } });
  if (!report.media) return gap("no_photo");
  const analyzer = run.visionAnalyzer;
  if (!analyzer || !run.loadMediaRef) return gap("not_configured");
  try {
    const ref = await run.loadMediaRef(report.media.mediaId);
    if (!ref) return gap("model_failed");
    const place = toPublicLocation(report.location);
    const signal = AbortSignal.any([run.signal, AbortSignal.timeout(VISION_TIMEOUT_MS)]);
    const modelOutput = await analyzer.analyze(
      {
        imageRef: ref.imageRef,
        mimeType: ref.mimeType as "image/jpeg",
        reportDescription: report.description,
        approxLatitude: place.latitude,
        approxLongitude: place.longitude,
        observedAt: report.observedAt,
      },
      signal,
    );
    return {
      kind: "vision.assess",
      input: { mediaId: report.media.mediaId, reportObservedAt: report.observedAt, labels: [], smokeLike: false, modelOutput, model: analyzer.id },
    };
  } catch {
    return gap("model_failed");
  }
}

/**
 * The runner: real evidence, Claude PC's runtime, Danil's validators and
 * fusion, Mac's FIRMS and witness processors, persisted through the store.
 */
export const runtimeRunner: InvestigationRunner = async (run) => {
  const isSynthetic = run.reports.every((report) => report.isSynthetic);
  const mode = isSynthetic ? "synthetic" : "live";
  const runId = runIdFor(run.investigationId, run.reports);
  const keys = runEventKeys(runId);
  const opener = run.reports[0];
  const latest = run.reports.at(-1) ?? opener;
  const subject = { investigationId: run.investigationId, location: toPublicLocation(opener.location), observedAt: opener.observedAt };

  const taskId = (name: string) => `${runId}:${name}`;
  const sourceTasks = [
    { agent: "witness", id: taskId("witness") },
    { agent: "vision", id: taskId("vision") },
    { agent: "satellite", id: taskId("satellite") },
    { agent: "weather", id: taskId("weather") },
    { agent: "weather", id: taskId("eonet") },
  ] as const;
  const fusionTaskId = taskId("fusion");

  const startedAt = isSynthetic ? SYNTHETIC_NOW : run.now();
  await run.store.setAutomatedStatus(run.investigationId, "investigating", null);
  await run.store.appendEvents([
    systemEvent(run, "status_changed", keys.started, "Automated assessment started: five independent agents are gathering and assessing evidence.", isSynthetic, { runId, status: "investigating", mode }, startedAt),
    ...[...sourceTasks, { agent: "fusion", id: fusionTaskId }].map(({ agent, id }) =>
      systemEvent(run, "task_queued", `task_queued:${id}`, `Queued a task for the ${agent} agent (${id.slice(runId.length + 1)}).`, isSynthetic, { taskId: id, agentId: agent }, startedAt),
    ),
  ]);

  // All I/O happens before the agents run: the runtime's processors are pure.
  const gather = run.gather ?? (isSynthetic ? syntheticSourceGatherer : liveSourceGatherer);
  const [sources, vision] = await Promise.all([gather(subject, { signal: run.signal, now: new Date(run.now()) }), visionTask(run, latest)]);
  if (run.signal.aborted) throw new RunAbortedError();

  const epochIso = startedAt;
  const agents = RUN_AGENT_IDS.map(
    (id) =>
      new RuntimeAgent({
        id,
        runId,
        peers: RUN_AGENT_IDS.filter((peer) => peer !== id),
        processors: PROCESSORS[id],
        store: run.store,
        mode,
        epochIso,
      }),
  );
  const network = createSimulatedNetwork({ nodes: [...RUN_AGENT_IDS], seed: 2026, defaultLink: PERFECT_LINK });
  const simulation = createSimulation({ host: createInProcessHost(agents), network, store: run.store, runId, isSynthetic, epochIso });
  const enqueue = (agentId: string, id: string, kind: string, input: unknown, afterIds?: string[]): ScenarioAction => ({
    at: 0,
    kind: "enqueue",
    agentId,
    task: { id, investigationId: run.investigationId, kind, input, ...(afterIds ? { after: afterIds } : {}) },
  });
  simulation.schedule([
    enqueue("witness", taskId("witness"), "witness.assess", witnessInput(run.reports)),
    enqueue("vision", taskId("vision"), vision.kind, vision.input),
    enqueue("satellite", taskId("satellite"), "satellite.firms", sources.firms),
    enqueue("weather", taskId("weather"), "weather.context", { context: sources.weather }),
    enqueue("weather", taskId("eonet"), "eonet.context", { context: sources.eonet, timeOfInterest: subject.observedAt }),
    // Fusion waits for every source task's outcome. A failed task still counts, as a gap.
    enqueue("fusion", fusionTaskId, "fusion.fuse", {}, sourceTasks.map((task) => task.id)),
    ...(run.networkActions ?? []),
  ]);
  await simulation.runUntilSettled({ maxTime: MAX_SIMULATED_MS });
  const status = await simulation.status();

  const tasks: RunSummary["tasks"] = {};
  for (const agent of status.agents) {
    for (const task of agent.tasks) tasks[task.id] = task.status === "done" || task.status === "failed" ? task.status : "pending";
  }
  const storeWriteFailures = status.agents.reduce((sum, agent) => sum + agent.metrics.storeWriteFailures, 0);
  if (storeWriteFailures > 0) throw new RunIncompleteError("store_write_failed");

  const fusionAgent = status.agents.find((agent) => agent.agentId === "fusion");
  const fusion = fusionAgent?.events
    .flatMap((event) => (event.payload.kind === "finding" && event.payload.finding.agentId === "fusion" ? [event.payload.finding] : []))
    .at(-1) as AgentFinding | undefined;
  const failedTasks = Object.entries(tasks).filter(([, state]) => state !== "done").map(([id]) => id.slice(runId.length + 1));

  let finalStatus: InvestigationStatus;
  let priority: ReviewPriority | null;
  let summary: string;
  if (fusion?.recommendation) {
    finalStatus = fusion.recommendation.recommendedStatus;
    priority = fusion.recommendation.reviewPriority;
    const next =
      finalStatus === "investigating"
        ? "Too little independent evidence to recommend review yet; it stays open for new reports or evidence."
        : finalStatus === "insufficient_evidence"
          ? "The evidence gathered cannot support or rule out a fire."
          : "A human reviewer should look at it.";
    summary = `Automated assessment finished: ${finalStatus.replaceAll("_", " ")} (${priority} priority). ${next} Decision support, not an alert.`;
  } else {
    // Fusion could not run: a human should look at the individual findings.
    finalStatus = "needs_human_review";
    priority = "medium";
    summary = "Automated assessment finished without a fusion recommendation. A human reviewer should look at the individual findings.";
  }
  await run.store.setAutomatedStatus(run.investigationId, finalStatus as "needs_human_review", priority);
  // After every agent record: agents stamp simulated time, which runs ahead of the wall clock.
  const finishedAt = [status.nowIso, run.now()].reduce((a, b) => (a >= b ? a : b));
  await run.store.appendEvents([
    systemEvent(
      run,
      "status_changed",
      keys.finished,
      summary,
      isSynthetic,
      {
        runId,
        mode,
        status: finalStatus,
        reviewPriority: priority,
        fusionFindingId: fusion?.id ?? null,
        evidenceGaps: fusion?.recommendation?.evidenceGaps ?? [],
        tasksNotCompleted: failedTasks,
      },
      finishedAt,
    ),
  ]);

  return { runId, mode, tasks, status: finalStatus, reviewPriority: priority, fusionFindingId: fusion?.id ?? null, storeWriteFailures };
};

/** Kept for callers of the earlier interim API. */
export const defaultRunner = runtimeRunner;

export class RunAbortedError extends Error {
  readonly code = "run_budget_exceeded";
  constructor() {
    super("The investigation run ran out of time.");
    this.name = "RunAbortedError";
  }
}

export class RunIncompleteError extends Error {
  constructor(readonly code: string) {
    super(`The investigation run did not finish (${code}).`);
    this.name = "RunIncompleteError";
  }
}

const FAILURE_CODES = new Set(["run_budget_exceeded", "store_write_failed"]);

/**
 * Records a visible, retryable failure: an event that says what stopped (a
 * fixed code, never an upstream message) and a status a human will look at.
 * Best effort: if the database itself is down, there is nothing to write to.
 */
async function recordFailure(run: InvestigationRun, error: unknown): Promise<void> {
  const runId = runIdFor(run.investigationId, run.reports);
  const code = error instanceof Error && "code" in error && FAILURE_CODES.has(String(error.code)) ? String(error.code) : "run_failed";
  const isSynthetic = run.reports.every((report) => report.isSynthetic);
  try {
    await run.store.appendEvents([
      systemEvent(
        run,
        "status_changed",
        runEventKeys(runId).failed(run.now()),
        `The automated assessment stopped before finishing (${code}). Findings already recorded are kept; it can be retried without duplicating anything.`,
        isSynthetic,
        { runId, outcome: "failed", code, retryable: true },
      ),
    ]);
    await run.store.setAutomatedStatus(run.investigationId, "needs_human_review", "medium");
  } catch {
    // Nothing more to do: the investigation stays as it was and can be retried.
  }
}

export type RunState = { state: "none" | "running" | "finished" | "interrupted"; runId: string | null };

/** Whether this investigation's current report set has a finished, running or interrupted run. */
export async function getRunState(investigationId: Id, now = Date.now()): Promise<RunState> {
  const admin = createAdminClient();
  const reports = await loadAgentReports(admin, investigationId);
  if (reports.length === 0) return { state: "none", runId: null };
  const runId = runIdFor(investigationId, reports);
  const keys = runEventKeys(runId);
  const { data, error } = await admin
    .from("agent_events")
    .select("idempotency_key, occurred_at")
    .eq("investigation_id", investigationId)
    .in("idempotency_key", [keys.started, keys.finished]);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.some((row) => row.idempotency_key === keys.finished)) return { state: "finished", runId };
  const started = rows.find((row) => row.idempotency_key === keys.started);
  if (!started) return { state: "none", runId };
  // A failure event never blocks a retry; only a recent start counts as running.
  return { state: now - Date.parse(started.occurred_at) < RUN_STALE_MS ? "running" : "interrupted", runId };
}

/** Runs one investigation now, within a time budget. Server-side only (service role). */
export async function runInvestigation(investigationId: Id, runner: InvestigationRunner = runtimeRunner): Promise<RunSummary | null> {
  const admin = createAdminClient();
  const reports = await loadAgentReports(admin, investigationId);
  if (reports.length === 0) return null;
  const run: InvestigationRun = {
    investigationId,
    reports,
    store: createSupabaseRuntimeStore(admin),
    now: () => new Date().toISOString(),
    newId: (name) => stableId(`${investigationId}:${name}`),
    signal: AbortSignal.timeout(RUN_BUDGET_MS),
    visionAnalyzer: getLiveVisionAnalyzer(),
    loadMediaRef: (mediaId) => loadMediaRef(admin, mediaId),
  };
  try {
    return await runner(run);
  } catch (error) {
    await recordFailure(run, error);
    throw error;
  }
}

/** True when this deployment can run agents: they need the server-only secret key. */
export function canRunAgents(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

/**
 * Starts the agents after the response is sent (Next.js after(), which Vercel
 * keeps alive up to the route's maxDuration). Returns false, and does nothing,
 * when the secret key isn't configured: reports still work and wait.
 * With `onlyIfIncomplete`, a finished or still-running run is left alone, so
 * a replayed submission or a retry request only restarts interrupted work.
 */
export function scheduleInvestigation(
  investigationId: Id,
  options: { runner?: InvestigationRunner; onlyIfIncomplete?: boolean } = {},
): boolean {
  if (!canRunAgents()) return false;
  after(async () => {
    try {
      if (options.onlyIfIncomplete) {
        const { state } = await getRunState(investigationId);
        if (state === "finished" || state === "running") return;
      }
      await runInvestigation(investigationId, options.runner);
    } catch (error) {
      console.error("embergap: investigation run failed", {
        investigationId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  });
  return true;
}
