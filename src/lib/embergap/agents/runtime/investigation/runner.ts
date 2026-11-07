import "server-only";
// An adapter with the exact shape of Mac's InvestigationRunner
// (src/features/embergap/orchestrator.ts), so the orchestrator can switch to
// the agent runtime with one argument:
//
//   scheduleInvestigation(investigationId, createRuntimeInvestigationRunner());
//
// It gathers upstream data FIRST (Open-Meteo and EONET through Claude PC's
// SourceAdapters, FIRMS through Outrolife's getThermalAnomalies), all within the
// run's signal, then runs the agents on the prepared inputs. A source that
// fails is recorded as unavailable: unknown, never negative. The type is
// structural, so this file doesn't import Mac's orchestration module.
import {
  SYNTHETIC_SCENARIOS,
  toPublicLocation,
  type AgentFinding,
  type AgentReport,
  type EmberGapRuntimeStore,
  type Id,
  type Observation,
  type SourceAdapter,
  type SourceAvailability,
  type Timestamp,
} from "@/lib/embergap/contracts";
import type { DanilVisionInput } from "@/lib/embergap/agents/fusion/runtime-processors";
import { createEonetSourceAdapter } from "@/lib/embergap/sources/eonet/eonet";
import { getThermalAnomalies } from "@/lib/embergap/sources/firms";
import { createOpenMeteoSourceAdapter } from "@/lib/embergap/sources/weather/open-meteo";
import { firmsObservationsFor } from "./inputs";
import { DEFAULT_SIMULATED_PARTITION, runInvestigationAgents, type InvestigationAgentsResult, type SimulatedPartition } from "./run";

/** Structurally identical to InvestigationRun in src/features/embergap/orchestrator.ts. */
export type RuntimeInvestigationRun = {
  investigationId: Id;
  reports: AgentReport[];
  store: EmberGapRuntimeStore;
  now: () => Timestamp;
  newId: (name: string) => Id;
  signal: AbortSignal;
};

export type Subject = Parameters<SourceAdapter>[0]["subject"];

export type GatheredInputs = { observations: Observation[]; sourceAvailability: SourceAvailability[] };

export type RuntimeRunnerOptions = {
  /** Replaces the default source gathering (Open-Meteo, EONET, FIRMS). */
  gather?: (run: RuntimeInvestigationRun, subject: Subject) => Promise<GatheredInputs>;
  /** Danil's validated witness findings, canonical (for example his pipeline through Mac's toCanonicalFinding). */
  witnessFindings?: (run: RuntimeInvestigationRun) => Promise<AgentFinding[]>;
  /** Model output the server fetched for the report's photo, for Danil's vision processor. */
  vision?: (run: RuntimeInvestigationRun) => Promise<DanilVisionInput | null>;
  /** Show agents working through a simulated partition within the run. */
  simulatePartition?: boolean | SimulatedPartition;
  /** Called with the run's summary, for logs or a demo panel. */
  onResult?: (result: InvestigationAgentsResult) => void;
};

/** The public-precision place and time the source agents look at. */
export function subjectFor(investigationId: string, report: AgentReport): Subject {
  return {
    location: toPublicLocation(report.location),
    observedAt: report.observedAt,
    syntheticScenarioId: SYNTHETIC_SCENARIOS.find((scenario) => scenario.investigationId === investigationId)?.id ?? null,
  };
}

/** Default gathering: all three sources in parallel, each bounded by the run's signal. */
export async function gatherSources(run: RuntimeInvestigationRun, subject: Subject): Promise<GatheredInputs> {
  const checkedAt = run.now();
  const portInput = { investigationId: run.investigationId, subject, checkedAt, signal: run.signal };
  const span = 0.25; // degrees around the public point, for FIRMS
  const [weather, eonet, firms] = await Promise.all([
    createOpenMeteoSourceAdapter()(portInput),
    createEonetSourceAdapter()(portInput),
    getThermalAnomalies({
      bbox: {
        minLongitude: Math.max(-180, subject.location.longitude - span),
        minLatitude: Math.max(-90, subject.location.latitude - span),
        maxLongitude: Math.min(180, subject.location.longitude + span),
        maxLatitude: Math.min(90, subject.location.latitude + span),
      },
      dayRange: 2,
      signal: run.signal,
    })
      .then((result) => firmsObservationsFor(result, { investigationId: run.investigationId, location: subject.location, observedAt: subject.observedAt }))
      .catch(() => null),
  ]);
  return {
    observations: [...weather.observations, ...eonet.observations, ...(firms?.observations ?? [])],
    sourceAvailability: [
      weather.availability,
      eonet.availability,
      firms?.availability ?? {
        source: "firms",
        state: "unavailable",
        checkedAt,
        latestObservedAt: null,
        maxAgeSeconds: 12 * 3_600,
        windowStart: null,
        windowEnd: null,
        message: "NASA FIRMS could not be reached.",
      },
    ],
  };
}

/** Builds an InvestigationRunner that runs Claude PC's agent runtime. */
export function createRuntimeInvestigationRunner(options: RuntimeRunnerOptions = {}) {
  return async (run: RuntimeInvestigationRun): Promise<void> => {
    const target = run.reports[0];
    if (!target) return;
    const mode = run.reports.every((report) => report.isSynthetic) ? "synthetic" : "live";
    const subject = subjectFor(run.investigationId, target);
    const [gathered, witnessFindings, vision] = await Promise.all([
      (options.gather ?? gatherSources)(run, subject),
      options.witnessFindings?.(run) ?? Promise.resolve([]),
      options.vision?.(run) ?? Promise.resolve(null),
    ]);
    const latest = run.reports.at(-1) ?? target;
    const partition = options.simulatePartition === true ? DEFAULT_SIMULATED_PARTITION : options.simulatePartition || null;
    const result = await runInvestigationAgents({
      investigationId: run.investigationId,
      // Stable for a retry of the same run; new when a later report starts a new run.
      runId: run.newId(`runtime-run:${run.reports.length}:${latest.id}`),
      mode,
      startedAt: run.now(),
      reports: run.reports.map((report) => ({ id: report.id, observedAt: report.observedAt, hasMedia: report.media !== null })),
      observations: gathered.observations,
      sourceAvailability: gathered.sourceAvailability,
      witnessFindings,
      vision,
      store: run.store,
      signal: run.signal,
      partition,
    });
    options.onResult?.(result);
  };
}
