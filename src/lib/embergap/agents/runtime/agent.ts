// One autonomous runtime agent. Everything it knows lives in private fields
// here: its task queue, inbox, its replica of the shared event history, its
// duplicate filter, Lamport clock and sequence counter, what it believes about
// each peer, and its processing log. Nothing outside can read or change that
// state; `snapshot()` returns a copy.
//
// How it talks to peers (all through envelopes on the simulated network):
// - It pushes its own new events once to every peer it believes reachable.
//   For a peer it believes unreachable it holds them back (buffering): the
//   outbox is, per peer, what that peer has not yet confirmed holding.
// - Every second it sends each peer a digest of what it holds, reachable or
//   not, which doubles as the liveness probe. The peer answers with whatever
//   is missing and its own digest, and gets back whatever it lacks
//   (push-pull anti-entropy). This alone makes delivery reliable: it survives
//   loss, duplication, reordering and partitions, and relays third parties'
//   events, so pushes need no acknowledgements or retries.
// - A peer is reachable if it was heard from in the last few seconds. The
//   network never tells it.
// - Each event is validated, hash-checked and applied at most once, by id.
//   A second copy with the same content is counted and ignored; one with
//   different content is a conflict: every version is kept on record, and
//   every replica keeps the same one (the lowest hash).
// It writes its own observations and findings to the runtime store
// (write-only), so persistence never depends on reaching a peer.
import {
  AGENT_IDS,
  agentEventSchema,
  agentFindingSchema,
  observationSchema,
  stableId,
  syntheticId,
  type AgentEvent,
  type AgentFinding,
  type EmberGapRuntimeStore,
  type Observation,
} from "@/lib/embergap/contracts";
import { hashValue, stableStringify } from "./hash";
import {
  ProcessorError,
  type EvidenceHook,
  type EvidenceView,
  type ProcessorContext,
  type ProcessorResult,
  type Readiness,
  type RuntimeMode,
  type RuntimeTask,
  type TaskDraft,
  type TaskProcessor,
  type UpstreamResult,
} from "./processors";
import {
  AGENT_ID_PATTERN,
  MAX_EVENTS_PER_ENVELOPE,
  RUNTIME_SCHEMA_VERSION,
  RUN_ID_PATTERN,
  TASK_ID_PATTERN,
  envelopeSchema,
  eventIdFor,
  findingIdFor,
  runtimeEventSchema,
  type Digest,
  type Envelope,
  type RuntimeEvent,
  type SimTime,
  type TaskOutcome,
} from "./types";

export const DEFAULT_EPOCH_ISO = "2026-11-07T12:00:00.000Z";

export type AgentConfig = {
  id: string;
  /** Unique per run: a fresh UUID in production, a fixed id in tests. */
  runId: string;
  /** Every other agent this one may talk to. */
  peers: readonly string[];
  processors: readonly TaskProcessor<never>[];
  /** Evidence-driven work, for example fusion re-runs. */
  onEvidence?: EvidenceHook;
  /** Where it persists its own records. Write-only. */
  store?: EmberGapRuntimeStore;
  mode?: RuntimeMode;
  /** Wall-clock time of simulated time 0: fixed for synthetic runs, the real start for live ones. */
  epochIso?: string;
  /** Tasks it can run per step. Defaults to 1. */
  maxTasksPerStep?: number;
  /** How often it exchanges digests with each peer. Defaults to 1000 ms. */
  syncIntervalMs?: number;
  /** Silence after which a peer counts as unreachable. Defaults to 3000 ms. */
  reachabilityWindowMs?: number;
  /** Log entries kept. Defaults to 1000. */
  logLimit?: number;
};

export type TaskStatus = "queued" | "blocked" | "running" | "done" | "failed";

/** Inspection view of a task. Never includes its input, which may be private. */
export type TaskSnapshot = {
  id: string;
  kind: string;
  investigationId: string;
  status: TaskStatus;
  /** What it is waiting for, while blocked. */
  missing: string[];
  after: string[];
  /** How many times its processor ran. At most once per task. */
  runs: number;
  enqueuedAt: SimTime;
  startedAt?: SimTime;
  finishedAt?: SimTime;
  outputEventIds: string[];
  error?: { code: string; message: string };
};

export type PeerStatus = "unknown" | "reachable" | "unreachable";

export type PeerSnapshot = {
  id: string;
  status: PeerStatus;
  lastHeardAt?: SimTime;
  /** When it last told this agent what it holds. */
  lastDigestAt?: SimTime;
  /** Events this agent holds that the peer has not confirmed holding. */
  pendingEventIds: string[];
};

export type ConflictRecord = {
  eventId: string;
  /** The version every replica keeps: the lowest hash, whatever the arrival order. */
  keptHash: string;
  /** Every version seen, so nothing is silently discarded. */
  versions: RuntimeEvent[];
  detectedAt: SimTime;
};

export type AgentMetrics = {
  tasksCompleted: number;
  tasksFailed: number;
  processorRuns: number;
  eventsCreated: number;
  eventsReceived: number;
  duplicateEventsIgnored: number;
  duplicateEnvelopes: number;
  conflicts: number;
  envelopesReceived: number;
  envelopesRejected: number;
  eventsRejected: number;
  envelopesSent: number;
  pushesSent: number;
  /** Pushes held back because the peer looked unreachable. */
  pushesDeferred: number;
  syncRequestsSent: number;
  eventsSentBySync: number;
  storeWriteFailures: number;
};

export type AgentLogKind =
  | "task.queued"
  | "task.duplicate"
  | "task.blocked"
  | "task.unblocked"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "event.created"
  | "event.received"
  | "event.conflict"
  | "event.rejected"
  | "message.rejected"
  | "peer.reachable"
  | "peer.unreachable"
  | "sync.received-events"
  | "store.failed";

export type AgentLogEntry = {
  at: SimTime;
  agentId: string;
  kind: AgentLogKind;
  taskId?: string;
  eventId?: string;
  peer?: string;
  detail?: string;
};

export type AgentSnapshot = {
  schemaVersion: number;
  agentId: string;
  runId: string;
  mode: RuntimeMode;
  now: SimTime;
  lamport: number;
  /** Highest sequence number this agent has assigned to its own events. */
  lastSeq: number;
  tasks: TaskSnapshot[];
  /** The local replica, in display order: creation time, then origin, then seq. */
  events: RuntimeEvent[];
  historyHash: string;
  digest: Digest;
  /** The outbox: per peer, reachability and what it has not yet confirmed. */
  peers: PeerSnapshot[];
  conflicts: ConflictRecord[];
  metrics: AgentMetrics;
  log: AgentLogEntry[];
  logDropped: number;
};

type TaskRecord = {
  task: RuntimeTask;
  status: TaskStatus;
  missing: string[];
  runs: number;
  enqueuedAt: SimTime;
  startedAt?: SimTime;
  finishedAt?: SimTime;
  outputEventIds: string[];
  error?: { code: string; message: string };
};

type PeerRecord = {
  id: string;
  status: PeerStatus;
  lastHeardAt?: SimTime;
  lastDigest?: Digest;
  lastDigestAt?: SimTime;
  nextSyncAt: SimTime;
  syncNow: boolean;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EnvelopeBody = DistributiveOmit<Envelope, "id" | "from" | "to" | "sentAt">;
type UnhashedEvent = Omit<RuntimeEvent, "hash">;

const CANONICAL_AGENTS = new Set<string>(AGENT_IDS);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

/** Plain-data copy: what crosses any boundary into or out of an agent. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The hash covers every field except the hash itself. */
export function hashEvent(event: UnhashedEvent): string {
  return hashValue(event);
}

/** Creation time, then origin, then seq: the same order on every converged replica. */
export function displayOrder(a: RuntimeEvent, b: RuntimeEvent): number {
  return a.createdAt - b.createdAt || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0) || a.seq - b.seq;
}

export function historyHashOf(events: readonly RuntimeEvent[]): string {
  return hashValue([...events].sort((a, b) => (a.id < b.id ? -1 : 1)).map((event) => [event.id, event.hash]));
}

/** Fixed sentences for failures, so no exception or upstream text is ever shown. */
const FAILURE_MESSAGES: Record<string, string> = {
  no_processor: "This agent has no processor for this kind of task.",
  invalid_input: "The task input did not match what the processor expects.",
  invalid_output: "The processor returned output the runtime could not accept.",
  async_processor: "The processor returned a promise. Processors must be synchronous; fetch data before enqueueing the task.",
  processor_error: "The processor failed unexpectedly.",
};

const recordIdOf = (event: RuntimeEvent): string | undefined =>
  event.payload.kind === "observation"
    ? event.payload.observation.id
    : event.payload.kind === "finding"
      ? event.payload.finding.id
      : undefined;

export class RuntimeAgent {
  readonly id: string;
  readonly runId: string;
  readonly mode: RuntimeMode;

  #peers = new Map<string, PeerRecord>();
  #processors = new Map<string, TaskProcessor<never>>();
  #onEvidence?: EvidenceHook;
  #store?: EmberGapRuntimeStore;
  #epochMs: number;
  #options: { maxTasksPerStep: number; syncIntervalMs: number; reachabilityWindowMs: number; logLimit: number };

  #now: SimTime = 0;
  #lamport = 0;
  #seq = 0;
  #sendCounter = 0;
  #inbox: unknown[] = [];
  #tasks = new Map<string, TaskRecord>();
  #history = new Map<string, RuntimeEvent>();
  #contiguous = new Map<string, number>();
  #extra = new Map<string, Set<number>>();
  /** Record (observation or finding) UUID to the event that carries it. */
  #records = new Map<string, string>();
  /** Outcome event ids by task id. More than one means a task ran twice somewhere. */
  #outcomes = new Map<string, string[]>();
  #seenEnvelopes = new Set<string>();
  #conflicts = new Map<string, ConflictRecord>();
  #pendingConflictPush: RuntimeEvent[] = [];
  #newEvents: RuntimeEvent[] = [];
  #pendingWrites: Promise<void>[] = [];
  #log: AgentLogEntry[] = [];
  #logDropped = 0;
  #metrics: AgentMetrics = {
    tasksCompleted: 0,
    tasksFailed: 0,
    processorRuns: 0,
    eventsCreated: 0,
    eventsReceived: 0,
    duplicateEventsIgnored: 0,
    duplicateEnvelopes: 0,
    conflicts: 0,
    envelopesReceived: 0,
    envelopesRejected: 0,
    eventsRejected: 0,
    envelopesSent: 0,
    pushesSent: 0,
    pushesDeferred: 0,
    syncRequestsSent: 0,
    eventsSentBySync: 0,
    storeWriteFailures: 0,
  };

  constructor(config: AgentConfig) {
    if (!AGENT_ID_PATTERN.test(config.id)) throw new Error(`Invalid agent id: ${config.id}`);
    if (!RUN_ID_PATTERN.test(config.runId)) throw new Error(`Invalid run id: ${config.runId}`);
    this.id = config.id;
    this.runId = config.runId;
    this.mode = config.mode ?? "synthetic";
    const epochMs = Date.parse(config.epochIso ?? DEFAULT_EPOCH_ISO);
    if (!Number.isFinite(epochMs)) throw new Error("epochIso must be an ISO 8601 time");
    this.#epochMs = epochMs;
    this.#onEvidence = config.onEvidence;
    this.#store = config.store;
    this.#options = {
      maxTasksPerStep: config.maxTasksPerStep ?? 1,
      syncIntervalMs: config.syncIntervalMs ?? 1_000,
      reachabilityWindowMs: config.reachabilityWindowMs ?? 3_000,
      logLimit: config.logLimit ?? 1_000,
    };
    for (const peer of [...new Set(config.peers)].sort()) {
      if (peer === config.id || !AGENT_ID_PATTERN.test(peer)) throw new Error(`Invalid peer: ${peer}`);
      this.#peers.set(peer, { id: peer, status: "unknown", nextSyncAt: this.#options.syncIntervalMs, syncNow: false });
    }
    for (const processor of config.processors) {
      if (this.#processors.has(processor.kind)) throw new Error(`Two processors for ${processor.kind}`);
      if (this.mode === "live" && processor.syntheticOnly) {
        throw new Error(`${processor.kind} is a synthetic stand-in and cannot run in live mode`);
      }
      this.#processors.set(processor.kind, processor);
    }
  }

  // ---------------------------------------------------------------- inputs

  /** A task from this agent's own feed. Idempotent by task id. */
  enqueueTask(task: RuntimeTask): boolean {
    if (!TASK_ID_PATTERN.test(String(task.id))) throw new Error(`Invalid task id: ${String(task.id).slice(0, 40)}`);
    if (typeof task.kind !== "string" || !task.kind || typeof task.investigationId !== "string" || !task.investigationId) {
      throw new Error("A task needs a kind and an investigationId");
    }
    for (const id of task.after ?? []) if (!TASK_ID_PATTERN.test(String(id))) throw new Error("Invalid task id in after");
    if (this.#tasks.has(task.id)) {
      this.#record({ kind: "task.duplicate", taskId: task.id });
      return false;
    }
    this.#tasks.set(task.id, {
      task: deepFreeze(copy({ ...task, after: task.after ?? [] })),
      status: "queued",
      missing: [],
      runs: 0,
      enqueuedAt: this.#now,
      outputEventIds: [],
    });
    this.#record({ kind: "task.queued", taskId: task.id, detail: task.kind });
    return true;
  }

  /** Called by the host with whatever the network delivered. Validated in `step`. */
  deliver(envelopes: readonly unknown[]): void {
    for (const envelope of envelopes) this.#inbox.push(envelope);
  }

  // ---------------------------------------------------------------- the loop

  /** One unit of independent work. Returns what it wants to send. */
  async step(now: SimTime): Promise<Envelope[]> {
    if (now < this.#now) throw new Error("Time cannot go backwards");
    this.#now = now;
    const out: Envelope[] = [];

    const inbox = this.#inbox;
    this.#inbox = [];
    for (const raw of inbox) this.#receive(raw, out);

    this.#updateReachability();
    this.#runEvidenceHook();
    this.#runTasks(out);
    this.#syncWithPeers(out);

    const writes = this.#pendingWrites;
    this.#pendingWrites = [];
    await Promise.all(writes);

    this.#metrics.envelopesSent += out.length;
    return out.map(copy);
  }

  // ---------------------------------------------------------------- receiving

  #receive(raw: unknown, out: Envelope[]): void {
    this.#metrics.envelopesReceived += 1;
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.#metrics.envelopesRejected += 1;
      this.#record({ kind: "message.rejected", detail: `invalid envelope at ${parsed.error.issues[0]?.path.join(".") ?? "?"}` });
      return;
    }
    const envelope = parsed.data;
    const peer = this.#peers.get(envelope.from);
    if (envelope.to !== this.id || !peer) {
      this.#metrics.envelopesRejected += 1;
      this.#record({ kind: "message.rejected", detail: "misrouted or from an unknown agent", peer: envelope.from });
      return;
    }
    if (this.#seenEnvelopes.has(envelope.id)) this.#metrics.duplicateEnvelopes += 1;
    this.#seenEnvelopes.add(envelope.id);
    this.#heardFrom(peer);

    switch (envelope.type) {
      case "push":
        for (const event of envelope.events) this.#accept(event, envelope.from);
        return;
      case "sync-request": {
        peer.lastDigest = envelope.digest;
        peer.lastDigestAt = this.#now;
        const missing = this.#missingFor(envelope.digest);
        const events = missing.slice(0, MAX_EVENTS_PER_ENVELOPE);
        this.#metrics.eventsSentBySync += events.length;
        out.push(this.#envelope(peer.id, { type: "sync-response", digest: this.#digest(), events, more: missing.length > events.length }));
        return;
      }
      case "sync-response": {
        peer.lastDigest = envelope.digest;
        peer.lastDigestAt = this.#now;
        let applied = 0;
        for (const event of envelope.events) if (this.#accept(event, envelope.from)) applied += 1;
        if (applied) this.#record({ kind: "sync.received-events", peer: peer.id, detail: `${applied} event(s)` });
        // Push back whatever the peer lacks.
        const theyLack = this.#missingFor(envelope.digest);
        this.#metrics.eventsSentBySync += theyLack.length;
        this.#pushTo(peer.id, theyLack, out);
        if (envelope.more) peer.syncNow = true;
        return;
      }
    }
  }

  #heardFrom(peer: PeerRecord): void {
    peer.lastHeardAt = this.#now;
    if (peer.status === "reachable") return;
    if (peer.status === "unreachable") {
      this.#record({ kind: "peer.reachable", peer: peer.id });
      // Back in touch: reconcile straight away rather than at the next interval.
      peer.syncNow = true;
    }
    peer.status = "reachable";
  }

  #updateReachability(): void {
    for (const peer of this.#peers.values()) {
      const silentSince = peer.lastHeardAt ?? 0;
      if (peer.status !== "unreachable" && this.#now - silentSince > this.#options.reachabilityWindowMs) {
        peer.status = "unreachable";
        this.#record({ kind: "peer.unreachable", peer: peer.id, detail: "nothing heard recently" });
      }
    }
  }

  /** Validates and applies one received event. Returns true when it was new. */
  #accept(raw: unknown, from: string): boolean {
    const parsed = runtimeEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.runId !== this.runId) {
      this.#rejectEvent(raw, parsed.success ? "event from another run" : "invalid event");
      return false;
    }
    const event = parsed.data;
    const { hash, ...rest } = event;
    let recomputed = "";
    try {
      recomputed = hashEvent(rest);
    } catch {
      // Not JSON-safe: treated as a mismatch below.
    }
    if (recomputed !== hash) {
      this.#rejectEvent(raw, "hash mismatch");
      return false;
    }
    const existing = this.#history.get(event.id);
    if (!existing) {
      this.#insert(event);
      this.#lamport = Math.max(this.#lamport, event.lamport);
      this.#metrics.eventsReceived += 1;
      this.#record({ kind: "event.received", eventId: event.id, peer: from });
      return true;
    }
    if (existing.hash === event.hash) {
      this.#metrics.duplicateEventsIgnored += 1;
      return false;
    }
    this.#recordConflict(existing, event);
    return false;
  }

  #rejectEvent(raw: unknown, reason: string): void {
    this.#metrics.eventsRejected += 1;
    const id = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : undefined;
    this.#record({ kind: "event.rejected", eventId: id?.slice(0, 200), detail: reason });
  }

  #recordConflict(existing: RuntimeEvent, incoming: RuntimeEvent): void {
    const record = this.#conflicts.get(existing.id) ?? {
      eventId: existing.id,
      keptHash: existing.hash,
      versions: [existing],
      detectedAt: this.#now,
    };
    if (record.versions.some((version) => version.hash === incoming.hash)) return;
    record.versions.push(deepFreeze(copy(incoming)));
    record.versions.sort((a, b) => (a.hash < b.hash ? -1 : 1));
    this.#metrics.conflicts += 1;
    this.#record({ kind: "event.conflict", eventId: existing.id, detail: `${record.versions.length} versions of one id` });
    // Deterministic: every replica keeps the lowest hash, whatever arrived first.
    const kept = record.versions[0];
    record.keptHash = kept.hash;
    this.#history.set(kept.id, kept);
    this.#conflicts.set(existing.id, record);
    // Show every version to every peer, so each one records the conflict too.
    this.#pendingConflictPush.push(...record.versions);
  }

  #insert(event: RuntimeEvent): void {
    const frozen = deepFreeze(copy(event));
    this.#history.set(frozen.id, frozen);
    this.#newEvents.push(frozen);
    const recordId = recordIdOf(frozen);
    if (recordId && !this.#records.has(recordId)) this.#records.set(recordId, frozen.id);
    if (frozen.payload.kind === "outcome") {
      const ids = this.#outcomes.get(frozen.taskId) ?? [];
      ids.push(frozen.id);
      this.#outcomes.set(frozen.taskId, ids.sort());
    }
    const contiguous = this.#contiguous.get(frozen.origin) ?? 0;
    const extra = this.#extra.get(frozen.origin) ?? new Set<number>();
    if (frozen.seq > contiguous) extra.add(frozen.seq);
    let next = contiguous;
    while (extra.has(next + 1)) {
      next += 1;
      extra.delete(next);
    }
    this.#contiguous.set(frozen.origin, next);
    this.#extra.set(frozen.origin, extra);
  }

  /** Hash of one origin's events 1..contiguous, to spot two versions of one event. */
  #prefixHash(origin: string): string {
    const upTo = this.#contiguous.get(origin) ?? 0;
    const pairs: Array<[number, string]> = [];
    for (let seq = 1; seq <= upTo; seq += 1) {
      pairs.push([seq, this.#history.get(eventIdFor(this.runId, origin, seq))?.hash ?? ""]);
    }
    return hashValue(pairs);
  }

  #digest(): Digest {
    const contiguous: Record<string, number> = {};
    const extra: Record<string, number[]> = {};
    const prefixHash: Record<string, string> = {};
    for (const origin of [...this.#contiguous.keys()].sort()) {
      contiguous[origin] = this.#contiguous.get(origin) ?? 0;
      prefixHash[origin] = this.#prefixHash(origin);
      const seqs = [...(this.#extra.get(origin) ?? [])].sort((a, b) => a - b);
      if (seqs.length) extra[origin] = seqs;
    }
    return { contiguous, extra, prefixHash };
  }

  /**
   * Events this replica holds that a peer with `digest` lacks, in (origin, seq)
   * order. When both hold the same prefix of an origin but it hashes
   * differently, that whole prefix is included so the peer sees the conflict.
   */
  #missingFor(digest: Digest): RuntimeEvent[] {
    const probe = new Set<string>();
    for (const [origin, mine] of this.#contiguous) {
      if (mine > 0 && digest.contiguous[origin] === mine && digest.prefixHash[origin] !== this.#prefixHash(origin)) {
        probe.add(origin);
      }
    }
    return [...this.#history.values()]
      .filter((event) => {
        if (probe.has(event.origin) && event.seq <= (this.#contiguous.get(event.origin) ?? 0)) return true;
        const theirs = digest.contiguous[event.origin] ?? 0;
        return event.seq > theirs && !(digest.extra[event.origin] ?? []).includes(event.seq);
      })
      .sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : a.seq - b.seq));
  }

  // ---------------------------------------------------------------- sending

  #envelope(to: string, body: EnvelopeBody): Envelope {
    this.#sendCounter += 1;
    return { id: `${this.id}>${to}#${this.#sendCounter}`, from: this.id, to, sentAt: this.#now, ...body } as Envelope;
  }

  /** Best-effort push, in bounded batches. Anti-entropy covers any loss. */
  #pushTo(to: string, events: readonly RuntimeEvent[], out: Envelope[]): void {
    for (let start = 0; start < events.length; start += MAX_EVENTS_PER_ENVELOPE) {
      out.push(this.#envelope(to, { type: "push", events: events.slice(start, start + MAX_EVENTS_PER_ENVELOPE) }));
      this.#metrics.pushesSent += 1;
    }
  }

  /** Own new events go to every peer that seems reachable; the rest wait for reconciliation. */
  #publish(events: readonly RuntimeEvent[], out: Envelope[]): void {
    if (events.length === 0) return;
    for (const peer of this.#peers.values()) {
      if (peer.status === "unreachable") this.#metrics.pushesDeferred += 1;
      else this.#pushTo(peer.id, events, out);
    }
  }

  #syncWithPeers(out: Envelope[]): void {
    if (this.#pendingConflictPush.length) {
      const versions = this.#pendingConflictPush;
      this.#pendingConflictPush = [];
      for (const peer of this.#peers.keys()) this.#pushTo(peer, versions, out);
    }
    // Every peer, reachable or not: this is also how a healed link is noticed.
    for (const peer of this.#peers.values()) {
      if (!peer.syncNow && this.#now < peer.nextSyncAt) continue;
      peer.syncNow = false;
      peer.nextSyncAt = this.#now + this.#options.syncIntervalMs;
      this.#metrics.syncRequestsSent += 1;
      out.push(this.#envelope(peer.id, { type: "sync-request", digest: this.#digest() }));
    }
  }

  // ---------------------------------------------------------------- evidence

  #evidenceView(): EvidenceView {
    const all = () => [...this.#history.values()].sort(displayOrder);
    const matches = (event: RuntimeEvent, filter: { investigationId?: string; origin?: string }) =>
      (filter.investigationId === undefined || event.investigationId === filter.investigationId) &&
      (filter.origin === undefined || event.origin === filter.origin);
    return {
      events: (filter = {}) => all().filter((event) => matches(event, filter)),
      observations: (filter = {}) =>
        all().flatMap((event) =>
          event.payload.kind === "observation" &&
          matches(event, filter) &&
          (filter.source === undefined || event.payload.observation.source === filter.source)
            ? [event.payload.observation]
            : [],
        ),
      findings: (filter = {}) =>
        all().flatMap((event) => (event.payload.kind === "finding" && matches(event, filter) ? [event.payload.finding] : [])),
      hasRecord: (recordId) => this.#records.has(recordId),
    };
  }

  #runEvidenceHook(): void {
    if (!this.#onEvidence || this.#newEvents.length === 0) {
      this.#newEvents = [];
      return;
    }
    const newEvents = this.#newEvents;
    this.#newEvents = [];
    let drafts: TaskDraft[] = [];
    try {
      drafts = this.#onEvidence({ agentId: this.id, now: this.#now, mode: this.mode, evidence: this.#evidenceView(), newEvents });
    } catch {
      this.#record({ kind: "task.failed", detail: "the evidence hook threw; no task was created" });
      return;
    }
    for (const draft of drafts) this.#enqueueDraft(draft, undefined);
  }

  #enqueueDraft(draft: TaskDraft, fallbackInvestigationId: string | undefined): void {
    const investigationId = draft.investigationId ?? fallbackInvestigationId;
    if (!investigationId) return;
    try {
      this.enqueueTask({ id: draft.id, kind: draft.kind, input: draft.input, investigationId, after: draft.after });
    } catch {
      this.#record({ kind: "task.failed", detail: "a follow-up task was invalid and was not queued" });
    }
  }

  // ---------------------------------------------------------------- tasks

  /** Whether every task in `after` has finished and all its output is held here. */
  #upstream(after: readonly string[]): { missing: string[]; results: UpstreamResult[] } {
    const missing: string[] = [];
    const results: UpstreamResult[] = [];
    for (const taskId of after) {
      // If a task somehow ran twice, use the same outcome everywhere: the lowest id.
      const outcomeId = this.#outcomes.get(taskId)?.[0];
      const outcomeEvent = outcomeId ? this.#history.get(outcomeId) : undefined;
      if (!outcomeEvent || outcomeEvent.payload.kind !== "outcome") {
        missing.push(`result of ${taskId}`);
        continue;
      }
      const { outcome } = outcomeEvent.payload;
      const absent = outcome.producedEventIds.filter((id) => !this.#history.has(id));
      if (absent.length) {
        missing.push(`${absent.length} of ${outcome.producedEventIds.length} events from ${taskId}`);
        continue;
      }
      const produced = outcome.producedEventIds.map((id) => this.#history.get(id) as RuntimeEvent);
      results.push({
        taskId,
        origin: outcomeEvent.origin,
        status: outcome.status,
        error: outcome.error,
        observations: produced.flatMap((event) => (event.payload.kind === "observation" ? [event.payload.observation] : [])),
        findings: produced.flatMap((event) => (event.payload.kind === "finding" ? [event.payload.finding] : [])),
      });
    }
    return { missing, results };
  }

  #runTasks(out: Envelope[]): void {
    const waiting = [...this.#tasks.values()]
      .filter((record) => record.status === "queued" || record.status === "blocked")
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt || (a.task.id < b.task.id ? -1 : 1));

    // First decide, for every waiting task, whether local evidence now allows
    // it, so a snapshot never shows a runnable task as blocked.
    const runnable: Array<{ record: TaskRecord; processor: TaskProcessor<unknown>; context: ProcessorContext<unknown> }> = [];
    for (const record of waiting) {
      const processor = this.#processors.get(record.task.kind) as TaskProcessor<unknown> | undefined;
      if (!processor) {
        this.#fail(record, "no_processor", out);
        continue;
      }
      const input = processor.input.safeParse(record.task.input);
      if (!input.success) {
        this.#fail(record, "invalid_input", out);
        continue;
      }
      const upstream = this.#upstream(record.task.after ?? []);
      const context: ProcessorContext<unknown> = {
        agentId: this.id,
        task: { ...record.task, input: input.data },
        input: input.data,
        now: this.#now,
        nowIso: this.#iso(this.#now),
        mode: this.mode,
        evidence: this.#evidenceView(),
        upstream: upstream.results,
      };
      let readiness: Readiness = upstream.missing.length ? { ready: false, missing: upstream.missing } : { ready: true };
      if (readiness.ready && processor.ready) {
        try {
          readiness = processor.ready(context);
        } catch (error) {
          this.#fail(record, this.#errorCode(error), out, error);
          continue;
        }
      }
      if (!readiness.ready) {
        const missing = [...readiness.missing].sort();
        if (record.status !== "blocked" || missing.join("|") !== record.missing.join("|")) {
          record.status = "blocked";
          record.missing = missing;
          this.#record({ kind: "task.blocked", taskId: record.task.id, detail: `waiting for ${missing.join(", ")}` });
        }
        continue;
      }
      if (record.status === "blocked") {
        record.status = "queued";
        record.missing = [];
        this.#record({ kind: "task.unblocked", taskId: record.task.id });
      }
      runnable.push({ record, processor, context });
    }

    for (const { record, processor, context } of runnable.slice(0, this.#options.maxTasksPerStep)) {
      record.status = "running";
      record.runs += 1;
      record.startedAt = this.#now;
      this.#metrics.processorRuns += 1;
      this.#record({ kind: "task.started", taskId: record.task.id });

      let result: ProcessorResult;
      try {
        result = processor.run(context);
      } catch (error) {
        this.#fail(record, this.#errorCode(error), out, error);
        continue;
      }
      if (result && typeof (result as unknown as { then?: unknown }).then === "function") {
        this.#fail(record, "async_processor", out);
        continue;
      }
      const committed = this.#commit(record, result ?? {});
      if (!committed) {
        this.#fail(record, "invalid_output", out);
        continue;
      }
      record.status = "done";
      record.finishedAt = this.#now;
      record.outputEventIds = committed.map((event) => event.id);
      this.#metrics.tasksCompleted += 1;
      this.#record({ kind: "task.completed", taskId: record.task.id, detail: `${committed.length - 1} output(s)` });
      this.#publish(committed, out);
      this.#persist(committed);
      for (const followUp of result.followUps ?? []) this.#enqueueDraft(followUp, record.task.investigationId);
    }
  }

  #iso(time: SimTime): string {
    return new Date(this.#epochMs + time).toISOString();
  }

  #errorCode(error: unknown): string {
    return error instanceof ProcessorError && /^[a-z][a-z0-9_]{0,39}$/.test(error.code) ? error.code : "processor_error";
  }

  /**
   * Builds and validates every output, plus the task's outcome event, before
   * assigning anything: a task's output is all or nothing, and what the origin
   * hashes is exactly what every receiver will rebuild.
   */
  #commit(record: TaskRecord, result: ProcessorResult): RuntimeEvent[] | null {
    try {
      const observations = result.observations ?? [];
      const findings = result.findings ?? [];
      if (observations.length + findings.length > 200) return null;
      for (const followUp of result.followUps ?? []) {
        if (!TASK_ID_PATTERN.test(String(followUp.id)) || typeof followUp.kind !== "string") return null;
      }
      const isSynthetic = this.mode === "synthetic";
      const nowIso = this.#iso(this.#now);
      let seq = this.#seq;
      let lamport = this.#lamport;
      const unhashed: UnhashedEvent[] = [];
      const localRecords = new Map<string, string>();
      const head = (outputIndex: number, causes: string[]): Omit<UnhashedEvent, "payload"> => {
        seq += 1;
        lamport += 1;
        return {
          schemaVersion: RUNTIME_SCHEMA_VERSION,
          id: eventIdFor(this.runId, this.id, seq),
          runId: this.runId,
          origin: this.id,
          seq,
          lamport,
          createdAt: this.#now,
          investigationId: record.task.investigationId,
          taskId: record.task.id,
          outputIndex,
          causes,
        };
      };

      for (const draft of observations) {
        const parsed = observationSchema.safeParse(draft);
        if (!parsed.success || parsed.data.investigationId !== record.task.investigationId) return null;
        // A live run must never publish fixture data as if it were real.
        if (!isSynthetic && parsed.data.provenance.isSynthetic) return null;
        const event = { ...head(unhashed.length, []), payload: { kind: "observation" as const, observation: parsed.data } };
        localRecords.set(parsed.data.id, event.id);
        unhashed.push(event);
      }
      const references = new Set(result.references ?? []);
      for (const draft of findings) {
        const evidenceIds = draft.evidenceIds ?? [];
        const causes: string[] = [];
        for (const id of evidenceIds) {
          const eventId = localRecords.get(id) ?? this.#records.get(id);
          if (eventId) causes.push(eventId);
          else if (!references.has(id)) return null; // Cites evidence this agent does not hold.
        }
        const base = head(unhashed.length, [...new Set(causes)]);
        const parsed = agentFindingSchema.safeParse({
          recommendation: null,
          ...draft,
          id: findingIdFor(this.runId, this.id, base.seq, isSynthetic),
          investigationId: record.task.investigationId,
          agentId: this.id,
          createdAt: nowIso,
          evidenceIds,
          isSynthetic,
        });
        if (!parsed.success) return null;
        localRecords.set(parsed.data.id, base.id);
        unhashed.push({ ...base, payload: { kind: "finding", finding: parsed.data } });
      }
      const producedEventIds = unhashed.map((event) => event.id);
      const outcome: TaskOutcome = { taskId: record.task.id, taskKind: record.task.kind, status: "done", producedEventIds };
      unhashed.push({ ...head(unhashed.length, producedEventIds), payload: { kind: "outcome", outcome } });

      const events = this.#finalize(unhashed);
      if (!events) return null;
      this.#seq = seq;
      this.#lamport = lamport;
      for (const event of events) this.#insertOwn(event, record.task.id);
      return events;
    } catch {
      return null;
    }
  }

  /** JSON-normalises, hashes and validates with the receiver's own schema. */
  #finalize(unhashed: UnhashedEvent[]): RuntimeEvent[] | null {
    const events: RuntimeEvent[] = [];
    for (const draft of unhashed) {
      const normalised = JSON.parse(stableStringify(draft)) as UnhashedEvent;
      const parsed = runtimeEventSchema.safeParse({ ...normalised, hash: hashEvent(normalised) });
      if (!parsed.success) return null;
      // Parsing applies defaults and drops unknown keys: hash what receivers will hold.
      const { hash: _ignored, ...kept } = parsed.data;
      void _ignored;
      events.push({ ...kept, hash: hashEvent(kept) });
    }
    return events;
  }

  #insertOwn(event: RuntimeEvent, taskId: string): void {
    this.#insert(event);
    this.#metrics.eventsCreated += 1;
    this.#record({ kind: "event.created", taskId, eventId: event.id, detail: event.payload.kind });
  }

  /** Writes this agent's own records to the store. A failing store never stops the agent. */
  #persist(events: readonly RuntimeEvent[]): void {
    const store = this.#store;
    if (!store) return;
    const observations: Observation[] = [];
    const findings: AgentFinding[] = [];
    for (const event of events) {
      if (event.payload.kind === "observation") observations.push(event.payload.observation);
      if (event.payload.kind === "finding") findings.push(event.payload.finding);
    }
    const timeline: AgentEvent[] = CANONICAL_AGENTS.has(this.id)
      ? findings.flatMap((finding) => {
          const parsed = agentEventSchema.safeParse({
            id: finding.isSynthetic
              ? syntheticId(`runtime/finding_recorded/${finding.id}`)
              : stableId(`runtime:finding_recorded:${finding.id}`),
            investigationId: finding.investigationId,
            type: "finding_recorded",
            actor: this.id,
            occurredAt: finding.createdAt,
            recordedAt: finding.createdAt,
            idempotencyKey: `finding_recorded:${finding.id}`,
            messageId: null,
            summary: `The ${this.id} agent recorded a "${finding.assessment}" finding.`,
            details: { findingId: finding.id, assessment: finding.assessment, reasonCodes: finding.reasonCodes },
            isSynthetic: finding.isSynthetic,
          });
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    const write = async () => {
      if (observations.length) await store.saveObservations(observations);
      for (const finding of findings) await store.saveFinding(finding);
      if (timeline.length) await store.appendEvents(timeline);
    };
    this.#pendingWrites.push(
      write().catch(() => {
        this.#metrics.storeWriteFailures += 1;
        this.#record({ kind: "store.failed", detail: "the runtime store refused a write" });
      }),
    );
  }

  #fail(record: TaskRecord, code: string, out: Envelope[], error?: unknown): void {
    const message =
      error instanceof ProcessorError && code === error.code ? error.message.slice(0, 300) : (FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.processor_error);
    record.status = "failed";
    record.finishedAt = this.#now;
    record.error = { code, message };
    this.#metrics.tasksFailed += 1;
    this.#record({ kind: "task.failed", taskId: record.task.id, detail: code });
    // The failure itself is evidence ("this source could not be assessed"), and
    // dependents waiting on this task must not wait forever.
    const seq = this.#seq + 1;
    const lamport = this.#lamport + 1;
    const outcome: TaskOutcome = { taskId: record.task.id, taskKind: record.task.kind, status: "failed", producedEventIds: [], error: { code, message } };
    const events = this.#finalize([
      {
        schemaVersion: RUNTIME_SCHEMA_VERSION,
        id: eventIdFor(this.runId, this.id, seq),
        runId: this.runId,
        origin: this.id,
        seq,
        lamport,
        createdAt: this.#now,
        investigationId: record.task.investigationId,
        taskId: record.task.id,
        outputIndex: 0,
        causes: [],
        payload: { kind: "outcome", outcome },
      },
    ]);
    if (!events) return;
    this.#seq = seq;
    this.#lamport = lamport;
    this.#insertOwn(events[0], record.task.id);
    record.outputEventIds = [events[0].id];
    this.#publish(events, out);
  }

  // ---------------------------------------------------------------- inspection

  #record(entry: Omit<AgentLogEntry, "at" | "agentId">): void {
    this.#log.push({ at: this.#now, agentId: this.id, ...entry });
    if (this.#log.length > this.#options.logLimit) {
      this.#log.shift();
      this.#logDropped += 1;
    }
  }

  /** A copy of everything this agent holds. Changing it changes nothing here. */
  snapshot(): AgentSnapshot {
    const events = [...this.#history.values()].sort(displayOrder);
    const tasks = [...this.#tasks.values()]
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt || (a.task.id < b.task.id ? -1 : 1))
      .map(
        (record): TaskSnapshot => ({
          id: record.task.id,
          kind: record.task.kind,
          investigationId: record.task.investigationId,
          status: record.status,
          missing: record.missing,
          after: record.task.after ?? [],
          runs: record.runs,
          enqueuedAt: record.enqueuedAt,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          outputEventIds: record.outputEventIds,
          error: record.error,
        }),
      );
    const peers = [...this.#peers.values()].map(
      (peer): PeerSnapshot => ({
        id: peer.id,
        status: peer.status,
        lastHeardAt: peer.lastHeardAt,
        lastDigestAt: peer.lastDigestAt,
        pendingEventIds: (peer.lastDigest ? this.#missingFor(peer.lastDigest) : events).map((event) => event.id),
      }),
    );
    return copy({
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      agentId: this.id,
      runId: this.runId,
      mode: this.mode,
      now: this.#now,
      lamport: this.#lamport,
      lastSeq: this.#seq,
      tasks,
      events,
      historyHash: historyHashOf(events),
      digest: this.#digest(),
      peers,
      conflicts: [...this.#conflicts.values()],
      metrics: this.#metrics,
      log: this.#log,
      logDropped: this.#logDropped,
    });
  }
}
