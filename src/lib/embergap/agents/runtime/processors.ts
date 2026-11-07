// The plug-in point for agent logic. A processor handles one task kind for one
// agent: it may add its own readiness check, and it turns a task into canonical
// observations and findings (from @/lib/embergap/contracts) and follow-up tasks.
// The runtime does everything else (ids, ordering, delivery, dedup,
// reconciliation, outcome records, persistence), so a validator is added or
// swapped by passing a processor, not by editing the runtime.
//
// Rules for processors, which keep runs reproducible and reviews honest:
// - Synchronous and pure: use only the task input, `upstream` and local
//   evidence. Do any I/O (Claude Vision, Open-Meteo, EONET, FIRMS) BEFORE the
//   task is enqueued, on the server, and put the result in the task input.
// - Never invent missing evidence. Report it as unknown or unavailable.
// - Throw ProcessorError with a safe, fixed message for an expected failure.
//   Any other error is recorded without its message, which may hold internals.
// - Reference private media by id, never by storage path, and never copy
//   report text into findings: replicated records are shown to investigators.
import type { z } from "zod";
import type { AgentFinding, AgentFindingInput, Observation } from "@/lib/embergap/contracts";
import type { RuntimeEvent, SimTime, TaskOutcome } from "./types";

/** `synthetic` runs on labelled fixtures; `live` refuses synthetic stand-ins and records. */
export type RuntimeMode = "synthetic" | "live";

export type RuntimeTask<Input = unknown> = {
  /** Unique within a run. Enqueueing the same id again does nothing. */
  id: string;
  investigationId: string;
  kind: string;
  input: Input;
  /**
   * Tasks, on any agent, whose complete output this task needs. It waits until
   * each one's outcome and every event that outcome lists are held locally.
   * A failed producer still counts as finished: the dependent sees the failure.
   */
  after?: string[];
};

/**
 * What a processor returns for a finding. The runtime fills in id,
 * investigationId, agentId, createdAt and isSynthetic, then validates the
 * whole record with the contract's agentFindingSchema.
 */
export type FindingDraft = Omit<AgentFindingInput, "id" | "investigationId" | "agentId" | "createdAt" | "isSynthetic" | "recommendation" | "evidenceIds"> & {
  /** Ids of observations in this result, or of records this agent already holds. */
  evidenceIds?: string[];
  /** Only the fusion agent sets this. */
  recommendation?: AgentFindingInput["recommendation"];
};

export type TaskDraft = { id: string; kind: string; input: unknown; investigationId?: string; after?: string[] };

export type ProcessorResult = {
  /** Canonical observations, for example from a SourceAdapter. Their ids are the source's own. */
  observations?: Observation[];
  /** evidenceIds must name observations in this result, or records this agent already holds. */
  findings?: FindingDraft[];
  /** More work for this same agent. */
  followUps?: TaskDraft[];
};

export type Readiness = { ready: true } | { ready: false; missing: string[] };

/** Read-only queries over what this agent holds. Results are frozen. */
export type EvidenceView = {
  events(filter?: { investigationId?: string; origin?: string }): readonly RuntimeEvent[];
  observations(filter?: { investigationId?: string; origin?: string; source?: Observation["source"] }): readonly Observation[];
  findings(filter?: { investigationId?: string; origin?: string }): readonly AgentFinding[];
  /** Whether a record (observation or finding) id is held. */
  hasRecord(recordId: string): boolean;
};

/** The complete output of one task this task waited for (`after`). */
export type UpstreamResult = {
  taskId: string;
  origin: string;
  status: TaskOutcome["status"];
  error?: TaskOutcome["error"];
  observations: readonly Observation[];
  findings: readonly AgentFinding[];
};

export type ProcessorContext<Input> = {
  agentId: string;
  task: RuntimeTask<Input>;
  /** The task input, already validated by the processor's schema. */
  input: Input;
  now: SimTime;
  /** `now` as UTC ISO 8601, from the run's epoch. */
  nowIso: string;
  mode: RuntimeMode;
  evidence: EvidenceView;
  /** One entry per `task.after` id, in the same order. */
  upstream: readonly UpstreamResult[];
};

export type TaskProcessor<Input = unknown> = {
  kind: string;
  /** Validates the task input before anything runs. */
  input: z.ZodType<Input>;
  /**
   * Fixture-backed stand-ins set this. An agent in live mode refuses to start
   * with one, so a live run can never publish invented observations.
   */
  syntheticOnly?: boolean;
  /** Extra readiness on top of `after`. Decide from local evidence only. */
  ready?(context: ProcessorContext<Input>): Readiness;
  /** Synchronous and pure. See the rules at the top of this file. */
  run(context: ProcessorContext<Input>): ProcessorResult;
};

/**
 * Evidence-driven work: called after an agent applies new events, local or
 * remote. Return tasks for this agent; ids are idempotent, so derive them from
 * the evidence (for example `fusion:<investigationId>:<n findings>`) to get
 * "once per evidence set" without polling. Danil's fusion re-runs hang here.
 */
export type EvidenceHook = (context: {
  agentId: string;
  now: SimTime;
  mode: RuntimeMode;
  evidence: EvidenceView;
  newEvents: readonly RuntimeEvent[];
}) => TaskDraft[];

/** Identity helper that keeps the input type attached to the processor. */
export function defineProcessor<Input>(processor: TaskProcessor<Input>): TaskProcessor<Input> {
  return processor;
}

/** An expected failure, with a fixed message that is safe to show in a dashboard. */
export class ProcessorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProcessorError";
    this.code = code;
  }
}
