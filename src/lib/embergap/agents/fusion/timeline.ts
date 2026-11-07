/**
 * EmberGap FUSION REPLAY SIMULATION of a communications partition.
 *
 * This is NOT the agent runtime, message bus or reconciliation engine (those
 * live under `agents/runtime/**`, owned by the data-runtime workstream). It is
 * a deterministic, fusion-level replay that shows how the human-review
 * recommendation changes as findings reach the fusion node across a simulated
 * partition. Use it for demos and tests on SYNTHETIC timelines only.
 *
 * Semantics:
 * - Every event's producer records its finding in its own local outbox at
 *   `at`, even while isolated: local progress continues.
 * - The fusion node receives a finding only when the producer is not isolated
 *   at that moment. Isolation uses the half-open window [startsAt, endsAt):
 *   an event exactly at `startsAt` IS isolated (buffered); an event exactly at
 *   `endsAt` is NOT isolated and is delivered in the reconciliation batch.
 * - Buffered findings are delivered at `endsAt`, ordered by `at`, then finding
 *   id, then kind ("produce" before "redeliver"). Input event order never matters.
 * - Re-delivering a finding id the fusion node already holds is idempotent and
 *   counted under `duplicatesIgnored`.
 * - `fuseFindings` is re-run at every time point (each delivery batch, plus the
 *   partition start and end), and one step is recorded per time point.
 *
 * Output is decision support for human review only. It never states that a
 * fire is real and never triggers any alert.
 */
import type {
  AgentDeps,
  AgentFinding,
  AgentId,
} from "@/lib/embergap/agents/validators/types";
import { fuseFindings } from "./fuse";
import type {
  EvidenceStrength,
  FusionContradiction,
  FusionGap,
  FusionRecommendation,
  FusionStatus,
  ReviewPriority,
} from "./types";

export type TimelineEventKind = "produce" | "redeliver";

export type TimelineEvent = {
  /** UTC ISO time at which the producer emits (or retries) this finding. */
  at: string;
  /** Producer. Must match `finding.agentId`, so every message stays attributable. */
  agentId: AgentId;
  finding: AgentFinding;
  /** "produce" (default) creates the finding; "redeliver" simulates a duplicate delivery. */
  kind?: TimelineEventKind;
};

export type TimelinePartition = {
  startsAt: string;
  endsAt: string;
  isolatedAgents: AgentId[];
};

export type TimelineInput = {
  investigationId: string;
  events: TimelineEvent[];
  partition?: TimelinePartition;
};

/** "before_partition" is also used for every step when no partition is configured. */
export type TimelinePhase = "before_partition" | "partitioned" | "reconciled";

export type TimelineRecommendation = {
  status: FusionStatus;
  reviewPriority: ReviewPriority;
  evidenceStrength: EvidenceStrength;
  gaps: FusionGap[];
  contradictions: FusionContradiction[];
  explanation: string[];
};

export type TimelineStep = {
  at: string;
  phase: TimelinePhase;
  /** Finding ids produced (kind "produce") at this time, isolated or not. */
  produced: string[];
  /** Finding ids newly applied by the fusion node at this time, in delivery order. */
  delivered: string[];
  /** Finding ids delivered again at this time and ignored (idempotent). */
  duplicateIds: string[];
  /** Outbox contents still waiting for the link after this step. */
  buffered: { agentId: AgentId; findingIds: string[] }[];
  recommendation: TimelineRecommendation;
};

export type TimelineMetrics = {
  /** "produce" events whose producer was isolated at that moment. */
  findingsProducedWhileIsolated: number;
  /** Unique finding ids the fusion node applied. */
  findingsDelivered: number;
  /** Deliveries of an id the fusion node already held. */
  duplicatesIgnored: number;
  /** Unique finding ids emitted by producers but never delivered. Always expected to be 0. */
  lostFindings: number;
  /** Final recommendation equals fusing every unique finding at once (status, strength, priority, gaps, contradictions). */
  converged: boolean;
};

export type TimelineResult = {
  investigationId: string;
  /** Always "fusion_replay_simulation": this is not the agent runtime. */
  mode: "fusion_replay_simulation";
  steps: TimelineStep[];
  metrics: TimelineMetrics;
  narrative: string[];
};

type NormalisedEvent = {
  t: number;
  at: string;
  agentId: AgentId;
  finding: AgentFinding;
  kind: TimelineEventKind;
};

function parseTime(iso: string, label: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Invalid timestamp for ${label}: ${JSON.stringify(iso)}`);
  return t;
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const kindRank = (kind: TimelineEventKind) => (kind === "produce" ? 0 : 1);
const byDeliveryOrder = (a: NormalisedEvent, b: NormalisedEvent) =>
  a.t - b.t ||
  compareStrings(a.finding.id, b.finding.id) ||
  kindRank(a.kind) - kindRank(b.kind) ||
  compareStrings(a.agentId, b.agentId);

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);
const label = (agentId: AgentId) => agentId.charAt(0).toUpperCase() + agentId.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function toStepRecommendation(rec: FusionRecommendation): TimelineRecommendation {
  return {
    status: rec.status,
    reviewPriority: rec.reviewPriority,
    evidenceStrength: rec.evidenceStrength,
    gaps: rec.gaps,
    contradictions: rec.contradictions,
    explanation: rec.explanation,
  };
}

/** The fields convergence is judged on. Generated ids and timestamps are excluded. */
const comparable = (rec: Pick<FusionRecommendation, "status" | "evidenceStrength" | "reviewPriority" | "gaps" | "contradictions">) =>
  JSON.stringify({
    status: rec.status,
    evidenceStrength: rec.evidenceStrength,
    reviewPriority: rec.reviewPriority,
    gaps: rec.gaps,
    contradictions: rec.contradictions,
  });

function summarise(rec: TimelineRecommendation): string {
  const parts = [
    `recommendation now ${rec.status} (${rec.reviewPriority} priority), evidence ${rec.evidenceStrength}`,
  ];
  if (rec.gaps.length > 0) {
    parts.push(`gaps (unknown, not negative evidence): ${rec.gaps.map((g) => g.agentId).join(", ")}`);
  }
  if (rec.contradictions.length > 0) {
    parts.push(
      `${plural(rec.contradictions.length, "contradiction")} recorded for human review, not resolved automatically`,
    );
  }
  return parts.join("; ");
}

/**
 * Replay a SYNTHETIC timeline through `fuseFindings` across a simulated
 * partition. Deterministic for a given set of events (input order is
 * irrelevant) and `deps`. Throws RangeError on malformed timestamps, an empty
 * or inverted partition window, or an event whose `agentId` does not match its
 * finding's producer.
 */
export function simulatePartitionTimeline(input: TimelineInput, deps: AgentDeps): TimelineResult {
  const events: NormalisedEvent[] = input.events
    .map((e, i) => {
      if (e.agentId !== e.finding.agentId) {
        throw new RangeError(
          `Event ${i} is attributed to ${e.agentId} but its finding was produced by ${e.finding.agentId}.`,
        );
      }
      return { t: parseTime(e.at, `event ${i}`), at: e.at, agentId: e.agentId, finding: e.finding, kind: e.kind ?? "produce" };
    })
    .sort(byDeliveryOrder);

  const partition = input.partition
    ? {
        start: parseTime(input.partition.startsAt, "partition.startsAt"),
        end: parseTime(input.partition.endsAt, "partition.endsAt"),
        isolated: new Set(input.partition.isolatedAgents),
      }
    : undefined;
  if (partition && partition.start >= partition.end) {
    throw new RangeError("partition.startsAt must be before partition.endsAt.");
  }

  const isIsolated = (agentId: AgentId, t: number) =>
    partition !== undefined && partition.isolated.has(agentId) && t >= partition.start && t < partition.end;
  const phaseAt = (t: number): TimelinePhase =>
    partition === undefined || t < partition.start
      ? "before_partition"
      : t < partition.end
        ? "partitioned"
        : "reconciled";

  const timePoints = new Set(events.map((e) => e.t));
  if (partition) {
    timePoints.add(partition.start);
    timePoints.add(partition.end);
  }

  const outboxes = new Map<AgentId, NormalisedEvent[]>();
  const received: AgentFinding[] = [];
  const seen = new Set<string>();
  const steps: TimelineStep[] = [];
  const isolatedAgentList = partition ? [...partition.isolated].sort() : [];
  const narrative: string[] = [
    `SYNTHETIC fusion replay simulation for ${input.investigationId} (not the agent runtime). Times are UTC. Output is decision support for human review only, not an alert.`,
  ];
  let producedWhileIsolated = 0;
  let duplicatesIgnored = 0;

  for (const t of [...timePoints].sort((a, b) => a - b)) {
    const time = hhmm(t);
    const here = events.filter((e) => e.t === t);
    const toDeliver: NormalisedEvent[] = [];
    const isolatedProduced = new Map<AgentId, number>();
    const isolatedRetries: NormalisedEvent[] = [];

    if (partition && t === partition.start) {
      narrative.push(
        `${time} Communications partition begins (simulated): ${isolatedAgentList.map(label).join(", ")} isolated from the fusion node; isolated agents keep processing local tasks.`,
      );
    }

    for (const e of here) {
      if (isIsolated(e.agentId, t)) {
        outboxes.set(e.agentId, [...(outboxes.get(e.agentId) ?? []), e]);
        if (e.kind === "produce") {
          producedWhileIsolated += 1;
          isolatedProduced.set(e.agentId, (isolatedProduced.get(e.agentId) ?? 0) + 1);
        } else {
          isolatedRetries.push(e);
        }
      } else {
        toDeliver.push(e);
      }
    }

    const reconciling = partition !== undefined && t === partition.end;
    const flushed = new Set<NormalisedEvent>();
    if (reconciling) {
      for (const queued of outboxes.values()) {
        toDeliver.push(...queued);
        for (const e of queued) flushed.add(e);
      }
      outboxes.clear();
    }
    toDeliver.sort(byDeliveryOrder);

    const delivered: string[] = [];
    const duplicateIds: string[] = [];
    let flushedApplied = 0;
    for (const e of toDeliver) {
      // Every copy goes to fusion, whose own R1 dedupe handles content conflicts
      // order-independently; the replay counts duplicates for the demo metrics.
      received.push(e.finding);
      if (seen.has(e.finding.id)) {
        duplicateIds.push(e.finding.id);
        duplicatesIgnored += 1;
      } else {
        seen.add(e.finding.id);
        delivered.push(e.finding.id);
        if (flushed.has(e)) flushedApplied += 1;
      }
    }

    const recommendation = toStepRecommendation(
      fuseFindings({ investigationId: input.investigationId, findings: [...received] }, deps),
    );
    const buffered = [...outboxes.entries()]
      .filter(([, queued]) => queued.length > 0)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([agentId, queued]) => ({ agentId, findingIds: queued.map((e) => e.finding.id) }));

    steps.push({
      at: new Date(t).toISOString(),
      phase: phaseAt(t),
      produced: here.filter((e) => e.kind === "produce").map((e) => e.finding.id),
      delivered,
      duplicateIds,
      buffered,
      recommendation,
    });

    for (const [agentId, n] of [...isolatedProduced.entries()].sort(([a], [b]) => compareStrings(a, b))) {
      narrative.push(`${time} ${label(agentId)} agent isolated; produced ${plural(n, "finding")} locally (buffered).`);
    }
    for (const e of isolatedRetries) {
      narrative.push(`${time} ${label(e.agentId)} agent retried delivery of ${e.finding.id} while isolated (buffered).`);
    }
    const dupText = duplicateIds.length > 0 ? `, ${plural(duplicateIds.length, "duplicate")} ignored` : "";
    if (reconciling) {
      const direct = delivered.length - flushedApplied;
      const directText = direct > 0 ? `, ${plural(direct, "new finding")} received directly` : "";
      narrative.push(
        `${time} Link restored; ${plural(flushedApplied, "buffered finding")} delivered${directText}${dupText || ", 0 duplicates ignored"}; ${summarise(recommendation)}.`,
      );
    } else if (delivered.length > 0) {
      const from = [...new Set(toDeliver.filter((e) => delivered.includes(e.finding.id)).map((e) => e.agentId))];
      narrative.push(
        `${time} Fusion received ${plural(delivered.length, "finding")} from ${from.join(", ")}${dupText}; ${summarise(recommendation)}.`,
      );
    } else if (duplicateIds.length > 0) {
      narrative.push(
        `${time} ${plural(duplicateIds.length, "duplicate")} of ${[...new Set(duplicateIds)].join(", ")} ignored (idempotent); recommendation unchanged.`,
      );
    }
  }

  const emitted = new Set(events.map((e) => e.finding.id));
  const lostFindings = [...emitted].filter((id) => !seen.has(id)).length;
  const reference = fuseFindings(
    { investigationId: input.investigationId, findings: events.map((e) => e.finding) },
    deps,
  );
  const final =
    steps.at(-1)?.recommendation ??
    toStepRecommendation(fuseFindings({ investigationId: input.investigationId, findings: [] }, deps));
  const converged = comparable(final) === comparable(reference);

  narrative.push(
    `Replay complete: ${plural(seen.size, "unique finding")} delivered, ${lostFindings} lost, ${plural(duplicatesIgnored, "duplicate")} ignored; ` +
      (converged
        ? "final recommendation matches fusing all findings at once (converged)."
        : "final recommendation does NOT match fusing all findings at once; investigate before demoing."),
  );

  return {
    investigationId: input.investigationId,
    mode: "fusion_replay_simulation",
    steps,
    metrics: {
      findingsProducedWhileIsolated: producedWhileIsolated,
      findingsDelivered: seen.size,
      duplicatesIgnored,
      lostFindings,
      converged,
    },
    narrative,
  };
}
