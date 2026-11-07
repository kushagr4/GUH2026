import "server-only";
import { after } from "next/server";
import { runValidationPipeline } from "@/lib/embergap/agents/fusion/pipeline";
import type { WitnessReport } from "@/lib/embergap/agents/validators/types";
import { createMockVisionAnalyzer } from "@/lib/embergap/agents/validators/vision";
import {
  stableId,
  type AgentEventType,
  type AgentReport,
  type EmberGapRuntimeStore,
  type EventActor,
  type Id,
  type Timestamp,
} from "@/lib/embergap/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCanonicalFinding } from "./adapters";
import { createSupabaseRuntimeStore, loadAgentReports } from "./runtime";

/**
 * Agent orchestration that fits Vercel's serverless model.
 *
 * - There are no long-lived workers and no in-memory message bus between
 *   requests. A run is one short, bounded function invocation, started with
 *   after() by the request that created the report (scheduleInvestigation).
 * - Durable state lives in Supabase: queued tasks and progress as agent_events,
 *   each agent's attributed findings, and the automated status. Investigation
 *   views read it, live through Realtime.
 * - Every write is idempotent (stable IDs, idempotency keys), so a retried or
 *   repeated run never duplicates anything.
 * - Delays, partitions and reconciliation are a deterministic SIMULATION inside
 *   a run (Claude PC's runtime), not real network partitions or permanent
 *   independent workers. Vercel provides neither, and the demo says so.
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
};

/**
 * One investigation run. Claude PC's distributed-agent runtime implements this
 * signature; until then defaultRunner is used.
 */
export type InvestigationRunner = (run: InvestigationRun) => Promise<void>;

/** Stays well inside the route's maxDuration (60 s), so the run can finish its writes. */
export const RUN_BUDGET_MS = 45_000;

const AGENTS_TO_QUEUE = ["witness", "vision", "satellite", "weather", "fusion"] as const;

function event(
  run: InvestigationRun,
  type: AgentEventType,
  actor: EventActor,
  key: string,
  summary: string,
  isSynthetic: boolean,
) {
  const at = run.now();
  return {
    id: run.newId(`event:${key}`),
    investigationId: run.investigationId,
    type,
    actor,
    occurredAt: at,
    recordedAt: at,
    idempotencyKey: `${type}:${run.newId(`key:${key}`)}`,
    messageId: null,
    summary,
    details: null,
    isSynthetic,
  };
}

function toWitnessReport(report: AgentReport): WitnessReport {
  return {
    id: report.id,
    investigationId: report.investigationId,
    reporterId: report.reporterKey,
    observedAt: report.observedAt,
    submittedAt: report.submittedAt,
    latitude: report.location.latitude,
    longitude: report.location.longitude,
    locationPrecisionM: report.location.uncertaintyMeters,
    description: report.description,
    photoSha256: report.media?.sha256 ?? undefined,
  };
}

/**
 * Interim runner (Claude Mac's integration) until Claude PC's runtime lands.
 * It queues a task per agent, runs Danil's validation pipeline (witness and
 * fusion; vision only once a live analyzer exists), and records each agent's
 * finding separately. Satellite and weather are recorded as data gaps, never
 * as invented observations, until their adapters are wired in.
 */
export const defaultRunner: InvestigationRunner = async (run) => {
  const isSynthetic = run.reports.every((report) => report.isSynthetic);
  await run.store.appendEvents(
    AGENTS_TO_QUEUE.map((agent) =>
      event(run, "task_queued", "system", `task:${agent}`, `Queued an assessment task for the ${agent} agent.`, isSynthetic),
    ),
  );

  let sequence = 0;
  const result = await runValidationPipeline(
    {
      investigationId: run.investigationId,
      witnessReports: run.reports.map(toWitnessReport),
      // Not integrated yet: unknown, never negative.
      sourceStates: { satellite: "unavailable", weather: "unavailable", vision: "unavailable" },
      // No live Claude Vision analyzer exists yet, so no `vision` input is passed and
      // real photos are not analysed. The pipeline requires an analyzer; the mock one
      // is never invoked without a vision input.
      visionAnalyzer: createMockVisionAnalyzer(),
    },
    { now: run.now, newId: () => run.newId(`finding:${sequence++}`) },
    { signal: run.signal },
  );

  const target = run.reports[0];
  for (const finding of result.findings) {
    const canonical = toCanonicalFinding(finding, {
      investigationId: run.investigationId,
      reportId: finding.agentId === "witness" ? (run.reports.at(-1)?.id ?? target.id) : null,
      isSynthetic,
    });
    await run.store.saveFinding(canonical);
    await run.store.appendEvents([
      event(run, "finding_recorded", canonical.agentId, `finding:${canonical.id}`, `The ${canonical.agentId} agent recorded a finding.`, isSynthetic),
    ]);
  }
  const fusion = toCanonicalFinding(result.recommendation.finding, {
    investigationId: run.investigationId,
    isSynthetic,
    recommendation: result.recommendation,
  });
  await run.store.saveFinding(fusion);
  await run.store.appendEvents([
    event(run, "finding_recorded", "fusion", `finding:${fusion.id}`, "The fusion agent recorded a review recommendation.", isSynthetic),
  ]);
  await run.store.setAutomatedStatus(run.investigationId, result.recommendation.status, result.recommendation.reviewPriority);
};

/** Runs one investigation now, within a time budget. Server-side only (service role). */
export async function runInvestigation(investigationId: Id, runner: InvestigationRunner = defaultRunner): Promise<void> {
  const admin = createAdminClient();
  const reports = await loadAgentReports(admin, investigationId);
  if (reports.length === 0) return;
  await runner({
    investigationId,
    reports,
    store: createSupabaseRuntimeStore(admin),
    now: () => new Date().toISOString(),
    newId: (name) => stableId(`${investigationId}:${name}`),
    signal: AbortSignal.timeout(RUN_BUDGET_MS),
  });
}

/** True when this deployment can run agents: they need the server-only secret key. */
export function canRunAgents(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

/**
 * Starts the agents for a new report after the response is sent (Next.js
 * after(), which Vercel keeps alive up to the route's maxDuration). Returns
 * false, and does nothing, when the secret key isn't configured: reports still
 * work, and the investigation simply waits.
 */
export function scheduleInvestigation(investigationId: Id, runner?: InvestigationRunner): boolean {
  if (!canRunAgents()) return false;
  after(async () => {
    try {
      await runInvestigation(investigationId, runner);
    } catch (error) {
      console.error("embergap: investigation run failed", {
        investigationId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  });
  return true;
}
