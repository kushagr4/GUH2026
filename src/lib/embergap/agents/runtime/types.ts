// Wire formats for the EmberGap agent runtime: replicated events, the envelopes
// agents exchange, and the digest used for anti-entropy reconciliation.
//
// Event payloads are the canonical records from @/lib/embergap/contracts
// (Observation, AgentFinding), validated with the contract's own schemas, so
// its scientific rules (weather is context, no detection is not absence, vision
// limitations, ...) hold for everything that replicates. Envelopes and the
// digest are internal transport details and are never persisted.
import { z } from "zod";
import { agentFindingSchema, observationSchema, stableId, syntheticId } from "@/lib/embergap/contracts";

export const RUNTIME_SCHEMA_VERSION = 1;

/** Simulated milliseconds since the scenario started. Never wall-clock time. */
export type SimTime = number;

export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
/** Lowercase letters, digits and hyphens: a UUID fits. */
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/;

export const agentIdSchema = z.string().regex(AGENT_ID_PATTERN);

/** `<runId>:<origin>:<seq>`. Unique per run, and the same on every replica. */
export function eventIdFor(runId: string, origin: string, seq: number): string {
  return `${runId}:${origin}:${seq}`;
}

/**
 * The UUID of a finding an agent creates, derived from its event: synthetic
 * runs get syntheticId (00000000- prefix), live runs a stable non-synthetic id.
 */
export function findingIdFor(runId: string, origin: string, seq: number, isSynthetic: boolean): string {
  const name = `runtime/${runId}/${origin}/${seq}`;
  return isSynthetic ? syntheticId(name) : stableId(name);
}

const eventId = z.string().min(5).max(200);

/**
 * Every task ends with exactly one outcome event, written by the runtime, not
 * the processor: what it produced, or that it failed and why. Dependent tasks
 * wait for it, so they never run on half an input, and a failure is evidence
 * of unavailability that travels like everything else.
 */
export const taskOutcomeSchema = z.object({
  taskId: z.string().regex(TASK_ID_PATTERN),
  taskKind: z.string().min(1).max(80),
  status: z.enum(["done", "failed"]),
  /** Every other event the task produced, in output order. */
  producedEventIds: z.array(eventId).max(200),
  /** A code and a fixed, safe sentence. Never upstream or exception text. */
  error: z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), message: z.string().max(300) }).optional(),
});
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>;

const eventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("observation"), observation: observationSchema }),
  z.object({ kind: z.literal("finding"), finding: agentFindingSchema }),
  z.object({ kind: z.literal("outcome"), outcome: taskOutcomeSchema }),
]);
export type EventPayload = z.infer<typeof eventPayloadSchema>;

export const runtimeEventSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_SCHEMA_VERSION),
    id: eventId,
    runId: z.string().regex(RUN_ID_PATTERN),
    /** The agent that created the event. Only it can assign this id. */
    origin: agentIdSchema,
    /** Per-origin sequence number: 1, 2, 3, ... with no gaps at the origin. */
    seq: z.number().int().positive(),
    /** Lamport timestamp: greater than that of every event in `causes`. */
    lamport: z.number().int().positive(),
    /** Simulated time of creation. */
    createdAt: z.number().int().nonnegative(),
    investigationId: z.string().min(1).max(100),
    /** The task that produced it, and its position in that task's output. */
    taskId: z.string().regex(TASK_ID_PATTERN),
    outputIndex: z.number().int().nonnegative(),
    /** Events this one was derived from (provenance). */
    causes: z.array(eventId).max(100),
    payload: eventPayloadSchema,
    /** FNV-1a over every other field, recomputed and checked on receipt. */
    hash: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .superRefine((event, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["payload"] });
    if (event.id !== eventIdFor(event.runId, event.origin, event.seq)) issue("id does not match runId, origin and seq");
    const { payload } = event;
    if (payload.kind === "observation" && payload.observation.investigationId !== event.investigationId) {
      issue("observation belongs to another investigation");
    }
    if (payload.kind === "finding") {
      const { finding } = payload;
      // Attribution: an agent can only publish findings in its own name, under the id derived from its event.
      if (finding.agentId !== event.origin) issue("a finding's agentId must be its origin");
      if (finding.investigationId !== event.investigationId) issue("finding belongs to another investigation");
      if (finding.id !== findingIdFor(event.runId, event.origin, event.seq, finding.isSynthetic)) issue("finding id is not derived from its event");
    }
    if (payload.kind === "outcome" && payload.outcome.taskId !== event.taskId) issue("outcome task mismatch");
  });
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

/**
 * What a replica holds, for anti-entropy: per origin, the highest sequence
 * number below which it has everything (`contiguous`), any sequence numbers it
 * holds above that gap (`extra`), and a hash of the contiguous prefix. Two
 * replicas with the same count but different hashes hold different versions of
 * some event, so they exchange that origin's events and resolve the conflict.
 */
export const digestSchema = z.object({
  contiguous: z.record(agentIdSchema, z.number().int().nonnegative()),
  extra: z.record(agentIdSchema, z.array(z.number().int().positive()).max(1000)),
  prefixHash: z.record(agentIdSchema, z.string().regex(/^[0-9a-f]{16}$/)),
});
export type Digest = z.infer<typeof digestSchema>;

export const MAX_EVENTS_PER_ENVELOPE = 50;

const envelopeBase = {
  /** `<from>><to>#<n>`, unique per sender. */
  id: z.string().min(5).max(120),
  from: agentIdSchema,
  to: agentIdSchema,
  sentAt: z.number().int().nonnegative(),
};
// Events stay `unknown` here and are validated one by one by the receiver.
const eventList = z.array(z.unknown()).max(MAX_EVENTS_PER_ENVELOPE);

export const envelopeSchema = z.discriminatedUnion("type", [
  /** Best-effort push of an agent's own new events. Anti-entropy makes it reliable. */
  z.object({ ...envelopeBase, type: z.literal("push"), events: eventList.min(1) }),
  /** "This is what I hold." Doubles as the liveness probe on every link. */
  z.object({ ...envelopeBase, type: z.literal("sync-request"), digest: digestSchema }),
  z.object({
    ...envelopeBase,
    type: z.literal("sync-response"),
    digest: digestSchema,
    events: eventList,
    /** True when more missing events remain than fit in one response. */
    more: z.boolean(),
  }),
]);
export type Envelope = z.infer<typeof envelopeSchema>;
export type EnvelopeType = Envelope["type"];
