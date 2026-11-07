/**
 * EmberGap DECENTRALISED FUSION SIMULATION: every actor fuses locally, with no hub.
 *
 * HONEST SCOPE: this is a deterministic, IN-PROCESS SIMULATION of a gossip
 * network, used for demos and tests on SYNTHETIC data. It is not a deployed
 * network, not the agent runtime and not its message transport (those live
 * under `agents/runtime/**`, owned by the data-runtime workstream).
 *
 * Model:
 * - One node per SOURCE actor (witness, vision, satellite, weather). There is
 *   NO fusion node. Each node holds a local grow-only set (G-Set CRDT) of
 *   source findings keyed by id, and computes its OWN recommendation by
 *   running the pure `fuseFindings` over that set.
 * - Only source findings spread. Local recommendations are never gossiped, so
 *   there is no fusion-of-fusion and no node can impose its verdict on another.
 * - A node adds its own produced finding to its own set immediately, even
 *   while cut off: local progress never waits for the network.
 * - Anti-entropy gossip runs in synchronous rounds. In each round every node
 *   compares digests (finding ids) with each neighbour whose link is not cut,
 *   and sends the findings that neighbour lacks, computed from start-of-round
 *   snapshots. The digest exchange is modelled as free; only the message that
 *   carries findings can be dropped. Dropped messages are not tracked: the
 *   next round's digest comparison simply sends the missing findings again,
 *   which is why anti-entropy is self-healing.
 * - Message loss uses a seeded mulberry32 PRNG, so a run is reproducible.
 * - Partitions cut links on the half-open window [startsAt, endsAt). Omitting
 *   `endsAt` keeps the links cut for the whole run.
 *
 * Because merge is a set union (commutative, associative, idempotent) and
 * fusion is a pure function of the set, nodes that have exchanged everything
 * hold the same set and therefore the same recommendation.
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
  SourceAgentId,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A G-Set of findings keyed by finding id. */
export type FindingSet = ReadonlyMap<string, AgentFinding>;

/** An undirected link between two actor nodes. */
export type GossipLink = readonly [AgentId, AgentId];

export type DecentralisedEvent = {
  /** UTC ISO time at which the node produces the finding. */
  at: string;
  kind: "produce";
  /** Producer. Must match `finding.agentId`, so every finding stays attributable. */
  node: AgentId;
  finding: AgentFinding;
};

export type DecentralisedPartition = {
  startsAt: string;
  /** Omit to keep these links cut for the whole run. */
  endsAt?: string;
  cutLinks: GossipLink[];
};

export type DecentralisedInput = {
  investigationId: string;
  /** Source actors only. "fusion" is rejected: there is no central fusion node. */
  nodes: AgentId[];
  /** Undirected topology. */
  links: GossipLink[];
  events: DecentralisedEvent[];
  partitions?: DecentralisedPartition[];
  /** Explicit gossip round times. Default: every `gossipIntervalMs` across the timeline. */
  rounds?: { at: string }[];
  /** Interval between generated rounds, and between extra rounds after the timeline. Default 60 000. */
  gossipIntervalMs?: number;
  /** Extra rounds allowed after the last scheduled time until connected nodes agree. Default 20. */
  maxExtraRounds?: number;
  /** Probability in [0, 1) that a finding-carrying message is dropped. Default 0. */
  dropRate?: number;
  /** Seed for the message-loss PRNG. Default 1. */
  seed?: number;
};

export type DecentralisedPhase = "connected" | "partitioned" | "healing" | "converged";

export type DecentralisedNodeRecommendation = {
  status: FusionStatus;
  reviewPriority: ReviewPriority;
  evidenceStrength: EvidenceStrength;
  gaps: FusionGap[];
  contradictions: FusionContradiction[];
};

export type DecentralisedNodeView = {
  node: SourceAgentId;
  knownFindingIds: string[];
  /** This node's OWN recommendation, from `fuseFindings` over its local set. */
  recommendation: DecentralisedNodeRecommendation;
};

export type DecentralisedStep = {
  at: string;
  phase: DecentralisedPhase;
  /** Whether a gossip round ran at this time. */
  gossipRound: boolean;
  /** Links cut at this time, each as a sorted pair. */
  cutLinks: [SourceAgentId, SourceAgentId][];
  /** Finding ids produced at this time. */
  produced: string[];
  nodes: DecentralisedNodeView[];
  messagesSent: number;
  messagesDropped: number;
};

export type DecentralisedMetrics = {
  /** Some partitioned step had nodes holding different local recommendations. */
  divergedDuringPartition: boolean;
  /**
   * Gossip rounds from the moment the last partition healed until every node
   * agreed. 0 when nodes already agreed at heal time. null when no partition
   * healed (none configured, or one never ends) or nodes never converged.
   */
  roundsToConvergeAfterHeal: number | null;
  /** Every node holds the union of all produced findings and its recommendation equals `fuseFindings(union)`. */
  converged: boolean;
  /** Every pair of nodes still linked at the end holds the same set (each connected component agrees). */
  componentsConverged: boolean;
  /** Produced finding ids held by no node at the end. Always expected to be 0. */
  lostFindings: number;
  /** Received findings the receiver already held. Applied once (idempotent) and ignored. */
  duplicateMerges: number;
  /** Findings produced while the producer could not reach every other node. */
  findingsProducedWhileIsolated: number;
  totalRounds: number;
  messagesSent: number;
  messagesDropped: number;
};

export type DecentralisedResult = {
  investigationId: string;
  /** Always "decentralised_fusion_simulation": an in-process simulation, not a deployed network. */
  mode: "decentralised_fusion_simulation";
  nodes: SourceAgentId[];
  steps: DecentralisedStep[];
  metrics: DecentralisedMetrics;
  narrative: string[];
};

// ---------------------------------------------------------------------------
// G-Set merge
// ---------------------------------------------------------------------------

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable JSON with sorted keys, used to pick one copy of a conflicting id deterministically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Merge two G-Sets of findings: a set union keyed by finding id. Pure, and
 * commutative, associative and idempotent. If both sides hold DIFFERENT
 * content under one id (a misbehaving producer), the canonically smaller copy
 * wins, so the choice never depends on merge order. The result is sorted by id.
 */
export function mergeFindingSets(a: FindingSet, b: FindingSet): Map<string, AgentFinding> {
  const out = new Map<string, AgentFinding>();
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort(compareStrings);
  for (const id of ids) {
    const x = a.get(id);
    const y = b.get(id);
    if (x && y) out.set(id, canonical(y) < canonical(x) ? y : x);
    else if (x) out.set(id, x);
    else if (y) out.set(id, y);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tiny seeded PRNG (mulberry32). Deterministic, no dependencies. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseTime(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Invalid timestamp for ${what}: ${JSON.stringify(iso)}`);
  return t;
}

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);
const label = (node: string) => node.charAt(0).toUpperCase() + node.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sameIds = (a: ReadonlySet<string> | FindingSet, b: ReadonlySet<string> | FindingSet) =>
  a.size === b.size && [...a.keys()].every((id) => b.has(id));

function toNodeRecommendation(rec: FusionRecommendation): DecentralisedNodeRecommendation {
  return {
    status: rec.status,
    reviewPriority: rec.reviewPriority,
    evidenceStrength: rec.evidenceStrength,
    gaps: rec.gaps,
    contradictions: rec.contradictions,
  };
}

/** The fields agreement is judged on. Generated ids and timestamps are excluded. */
export const comparableRecommendation = (rec: DecentralisedNodeRecommendation) =>
  JSON.stringify({
    status: rec.status,
    evidenceStrength: rec.evidenceStrength,
    reviewPriority: rec.reviewPriority,
    gaps: rec.gaps,
    contradictions: rec.contradictions,
  });

function describeView(rec: DecentralisedNodeRecommendation): string {
  const parts = [`${rec.reviewPriority} priority`, `evidence ${rec.evidenceStrength}`];
  if (rec.gaps.length > 0) {
    parts.push(`gaps (unknown, not negative evidence): ${rec.gaps.map((g) => g.agentId).join(", ")}`);
  }
  if (rec.contradictions.length > 0) {
    parts.push(`${plural(rec.contradictions.length, "contradiction")} left for a human reviewer`);
  }
  return `${rec.status} (${parts.join("; ")})`;
}

function validateNodes(nodes: AgentId[]): SourceAgentId[] {
  const out = new Set<SourceAgentId>();
  for (const node of nodes) {
    if (node === "fusion") {
      throw new RangeError("Decentralised fusion has no central fusion node; nodes must be source actors only.");
    }
    out.add(node);
  }
  if (out.size === 0) throw new RangeError("At least one node is required.");
  return [...out].sort(compareStrings);
}

function normaliseLinks(
  links: readonly GossipLink[],
  nodes: ReadonlySet<string>,
  what: string,
): [SourceAgentId, SourceAgentId][] {
  const byKey = new Map<string, [SourceAgentId, SourceAgentId]>();
  links.forEach(([a, b], i) => {
    if (!nodes.has(a) || !nodes.has(b)) {
      throw new RangeError(`${what}[${i}] references a node that is not in the network: ${a}–${b}.`);
    }
    if (a === b) throw new RangeError(`${what}[${i}] links ${a} to itself.`);
    const pair = [a, b].sort(compareStrings) as [SourceAgentId, SourceAgentId];
    byKey.set(linkKey(a, b), pair);
  });
  return [...byKey.entries()].sort(([x], [y]) => compareStrings(x, y)).map(([, pair]) => pair);
}

type NormalisedEvent = { t: number; node: SourceAgentId; finding: AgentFinding };

type NormalisedPartition = {
  start: number;
  end: number;
  cut: Set<string>;
  cutLinks: [SourceAgentId, SourceAgentId][];
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Simulate decentralised, hub-free fusion over a SYNTHETIC gossip network.
 * Deterministic for a given input (event order is irrelevant), seed and `deps`.
 * Throws RangeError on a "fusion" node, unknown or self links, malformed
 * timestamps, an inverted partition window, an invalid drop rate or interval,
 * or an event whose node does not match its finding's producer.
 */
export function simulateDecentralisedFusion(
  input: DecentralisedInput,
  deps: AgentDeps,
): DecentralisedResult {
  const nodes = validateNodes(input.nodes);
  const nodeSet = new Set<string>(nodes);
  const links = normaliseLinks(input.links, nodeSet, "links");

  const dropRate = input.dropRate ?? 0;
  if (!(dropRate >= 0 && dropRate < 1)) throw new RangeError("dropRate must be in [0, 1).");
  const interval = input.gossipIntervalMs ?? 60_000;
  if (!(Number.isFinite(interval) && interval > 0)) throw new RangeError("gossipIntervalMs must be positive.");
  const maxExtraRounds = input.maxExtraRounds ?? 20;
  const rand = mulberry32(input.seed ?? 1);

  const partitions: NormalisedPartition[] = (input.partitions ?? []).map((p, i) => {
    const start = parseTime(p.startsAt, `partitions[${i}].startsAt`);
    const end = p.endsAt === undefined ? Number.POSITIVE_INFINITY : parseTime(p.endsAt, `partitions[${i}].endsAt`);
    if (start >= end) throw new RangeError(`partitions[${i}].startsAt must be before endsAt.`);
    const cutLinks = normaliseLinks(p.cutLinks, nodeSet, `partitions[${i}].cutLinks`);
    return { start, end, cutLinks, cut: new Set(cutLinks.map(([a, b]) => linkKey(a, b))) };
  });

  const events: NormalisedEvent[] = input.events
    .map((e, i) => {
      if (e.finding.agentId === "fusion") {
        throw new RangeError(`Event ${i} carries a fusion finding; only source findings are gossiped.`);
      }
      if (!nodeSet.has(e.node)) throw new RangeError(`Event ${i} is produced by unknown node ${e.node}.`);
      if (e.node !== e.finding.agentId) {
        throw new RangeError(`Event ${i} is attributed to ${e.node} but its finding was produced by ${e.finding.agentId}.`);
      }
      return { t: parseTime(e.at, `event ${i}`), node: e.node as SourceAgentId, finding: e.finding };
    })
    .sort((a, b) => a.t - b.t || compareStrings(a.node, b.node) || compareStrings(a.finding.id, b.finding.id));

  // Time points: events, partition boundaries and gossip rounds.
  const basePoints = new Set<number>(events.map((e) => e.t));
  for (const p of partitions) {
    basePoints.add(p.start);
    if (Number.isFinite(p.end)) basePoints.add(p.end);
  }
  const roundTimes = new Set<number>();
  if (input.rounds) {
    input.rounds.forEach((r, i) => roundTimes.add(parseTime(r.at, `rounds[${i}].at`)));
  } else if (basePoints.size > 0) {
    const first = Math.min(...basePoints);
    const last = Math.max(...basePoints);
    for (let t = first; t <= last; t += interval) roundTimes.add(t);
  }
  const scheduled = [...new Set([...basePoints, ...roundTimes])].sort((a, b) => a - b);

  const healAt =
    partitions.length > 0 && partitions.every((p) => Number.isFinite(p.end))
      ? Math.max(...partitions.map((p) => p.end))
      : undefined;

  // State.
  const sets = new Map<SourceAgentId, Map<string, AgentFinding>>(nodes.map((n) => [n, new Map()]));
  let union = new Map<string, AgentFinding>();
  const steps: DecentralisedStep[] = [];
  const narrative: string[] = [
    `SYNTHETIC decentralised fusion simulation for ${input.investigationId}: ${plural(nodes.length, "actor node")} (${nodes.map(label).join(", ")}), no central fusion node. ` +
      "In-process simulation of a gossip network, not a deployed network. Times are UTC. Output is decision support for human review only, not an alert.",
  ];
  let duplicateMerges = 0;
  let producedWhileIsolated = 0;
  let totalSent = 0;
  let totalDropped = 0;
  let totalRounds = 0;
  let roundsAfterHeal = 0;
  let roundsToConvergeAfterHeal: number | null = null;
  let divergedDuringPartition = false;
  let previousViews: string | undefined;

  const cutAt = (t: number) => {
    const cut = new Set<string>();
    for (const p of partitions) if (t >= p.start && t < p.end) for (const k of p.cut) cut.add(k);
    return cut;
  };
  const neighbours = (node: SourceAgentId, cut: ReadonlySet<string>) =>
    links
      .filter(([a, b]) => (a === node || b === node) && !cut.has(linkKey(a, b)))
      .map(([a, b]) => (a === node ? b : a));
  const componentsAt = (cut: ReadonlySet<string>): SourceAgentId[][] => {
    const seen = new Set<SourceAgentId>();
    const out: SourceAgentId[][] = [];
    for (const start of nodes) {
      if (seen.has(start)) continue;
      const component: SourceAgentId[] = [];
      const queue = [start];
      seen.add(start);
      while (queue.length > 0) {
        const n = queue.shift() as SourceAgentId;
        component.push(n);
        for (const m of neighbours(n, cut)) {
          if (!seen.has(m)) {
            seen.add(m);
            queue.push(m);
          }
        }
      }
      out.push(component.sort(compareStrings));
    }
    return out;
  };
  const componentsConsistent = (cut: ReadonlySet<string>) =>
    links.every(([a, b]) => cut.has(linkKey(a, b)) || sameIds(sets.get(a) as FindingSet, sets.get(b) as FindingSet));
  const globallyAgreed = () => nodes.every((n) => sameIds(sets.get(n) as FindingSet, union));
  const setOf = (n: SourceAgentId) => sets.get(n) as Map<string, AgentFinding>;
  const fuseLocal = (findings: Iterable<AgentFinding>) =>
    toNodeRecommendation(fuseFindings({ investigationId: input.investigationId, findings: [...findings] }, deps));

  function gossip(cut: ReadonlySet<string>): { sent: number; dropped: number } {
    const snapshot = new Map(nodes.map((n) => [n, new Set(setOf(n).keys())]));
    const deliveries: { to: SourceAgentId; findings: AgentFinding[] }[] = [];
    let sent = 0;
    let dropped = 0;
    for (const [a, b] of links) {
      if (cut.has(linkKey(a, b))) continue;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const theirs = snapshot.get(to) as Set<string>;
        const missing = [...(snapshot.get(from) as Set<string>)].filter((id) => !theirs.has(id)).sort(compareStrings);
        if (missing.length === 0) continue;
        sent += 1;
        if (dropRate > 0 && rand() < dropRate) {
          dropped += 1;
          continue;
        }
        const source = setOf(from);
        deliveries.push({ to, findings: missing.map((id) => source.get(id) as AgentFinding) });
      }
    }
    for (const { to, findings } of deliveries) {
      const target = setOf(to);
      for (const f of findings) if (target.has(f.id)) duplicateMerges += 1;
      sets.set(to, mergeFindingSets(target, new Map(findings.map((f) => [f.id, f]))));
    }
    return { sent, dropped };
  }

  function processPoint(t: number, isRound: boolean) {
    const time = hhmm(t);
    const cut = cutAt(t);
    const components = componentsAt(cut);
    const componentOf = (n: SourceAgentId) => components.find((c) => c.includes(n)) ?? [n];

    for (const p of partitions) {
      if (p.start === t) {
        const sides = components.map((c) => `[${c.map(label).join(" + ")}]`).join(" and ");
        narrative.push(
          `${time} Links cut (simulated): ${p.cutLinks.map(([a, b]) => `${a}–${b}`).join(", ")}. ` +
            `Network splits into ${sides}; each side keeps fusing locally with only what it knows.`,
        );
      }
      if (p.end === t) {
        narrative.push(
          `${time} Links restored (simulated): ${p.cutLinks.map(([a, b]) => `${a}–${b}`).join(", ")}. Anti-entropy gossip resumes.`,
        );
      }
    }

    // 1. Local production: always immediate, even when cut off.
    const here = events.filter((e) => e.t === t);
    const producedBy = new Map<SourceAgentId, string[]>();
    for (const e of here) {
      const single = new Map([[e.finding.id, e.finding]]);
      if (setOf(e.node).has(e.finding.id)) duplicateMerges += 1;
      sets.set(e.node, mergeFindingSets(setOf(e.node), single));
      union = mergeFindingSets(union, single);
      producedBy.set(e.node, [...(producedBy.get(e.node) ?? []), e.finding.id]);
      if (componentOf(e.node).length < nodes.length) producedWhileIsolated += 1;
    }
    for (const [node, ids] of producedBy) {
      const unreachable = nodes.filter((n) => !componentOf(node).includes(n));
      narrative.push(
        `${time} ${label(node)} node produced ${plural(ids.length, "finding")} and added it to its own set immediately` +
          (unreachable.length > 0
            ? ` while cut off from ${unreachable.map(label).join(", ")} (local progress, no hub needed).`
            : "."),
      );
    }

    // Already agreed at heal time, before any round: 0 rounds needed.
    if (healAt !== undefined && t >= healAt && roundsToConvergeAfterHeal === null && globallyAgreed()) {
      roundsToConvergeAfterHeal = roundsAfterHeal;
    }

    // 2. Anti-entropy gossip round.
    let sent = 0;
    let dropped = 0;
    if (isRound) {
      ({ sent, dropped } = gossip(cut));
      totalRounds += 1;
      totalSent += sent;
      totalDropped += dropped;
      if (healAt !== undefined && t >= healAt) roundsAfterHeal += 1;
      if (dropped > 0) {
        narrative.push(
          `${time} Gossip round: ${plural(sent, "message")} sent, ${dropped} dropped (simulated loss); the next round's digest comparison resends what is missing.`,
        );
      }
    }

    // 3. Every node fuses locally over its own set.
    const views: DecentralisedNodeView[] = nodes.map((node) => ({
      node,
      knownFindingIds: [...setOf(node).keys()].sort(compareStrings),
      recommendation: fuseLocal(setOf(node).values()),
    }));
    const agreed = globallyAgreed();
    let justConverged = false;
    if (healAt !== undefined && t >= healAt && roundsToConvergeAfterHeal === null && agreed) {
      roundsToConvergeAfterHeal = roundsAfterHeal;
      justConverged = true;
    }

    const active = partitions.some((p) => t >= p.start && t < p.end);
    const phase: DecentralisedPhase = active
      ? "partitioned"
      : !partitions.some((p) => p.start <= t)
        ? "connected"
        : agreed
          ? "converged"
          : "healing";

    const distinct = new Map<string, SourceAgentId[]>();
    for (const v of views) {
      const key = comparableRecommendation(v.recommendation);
      distinct.set(key, [...(distinct.get(key) ?? []), v.node]);
    }
    if (phase === "partitioned" && distinct.size > 1) divergedDuringPartition = true;

    steps.push({
      at: new Date(t).toISOString(),
      phase,
      gossipRound: isRound,
      cutLinks: links.filter(([a, b]) => cut.has(linkKey(a, b))).map(([a, b]) => [a, b]),
      produced: here.map((e) => e.finding.id),
      nodes: views,
      messagesSent: sent,
      messagesDropped: dropped,
    });

    // 4. Narrate only when the set of local views changes.
    const viewKey = JSON.stringify([...distinct.entries()]);
    if (justConverged) {
      const lost = [...union.keys()].filter((id) => !nodes.some((n) => setOf(n).has(id))).length;
      narrative.push(
        `${time} Gossip converged in ${plural(roundsToConvergeAfterHeal ?? 0, "round")} after links were restored; ` +
          `all ${nodes.length} nodes agree locally: ${describeView(views[0].recommendation)}. ` +
          `${lost} findings lost, ${plural(duplicateMerges, "duplicate merge")} ignored so far.`,
      );
    } else if (viewKey !== previousViews) {
      if (distinct.size === 1) {
        narrative.push(`${time} All ${nodes.length} nodes agree locally: ${describeView(views[0].recommendation)}.`);
      } else {
        const groups = [...distinct.values()].map((group) => {
          const rec = views.find((v) => v.node === group[0])?.recommendation ?? views[0].recommendation;
          return `${group.map(label).join(" + ")}: ${describeView(rec)}`;
        });
        narrative.push(`${time} Local views differ, each node deciding on its own evidence. ${groups.join(". ")}.`);
      }
    }
    previousViews = viewKey;
  }

  for (const t of scheduled) processPoint(t, roundTimes.has(t));
  // Extra rounds after the timeline until every still-linked pair agrees.
  const last = scheduled.at(-1);
  if (last !== undefined) {
    for (let extra = 1; extra <= maxExtraRounds && !componentsConsistent(cutAt(last + interval * extra)); extra++) {
      processPoint(last + interval * extra, true);
    }
  }

  // Metrics.
  const finalT = steps.length > 0 ? Date.parse(steps[steps.length - 1].at) : 0;
  const reference = comparableRecommendation(fuseLocal(union.values()));
  const finalViews = steps.at(-1)?.nodes ?? [];
  const lostFindings = [...union.keys()].filter((id) => !nodes.some((n) => setOf(n).has(id))).length;
  const converged =
    globallyAgreed() && finalViews.every((v) => comparableRecommendation(v.recommendation) === reference);
  const componentsConverged = componentsConsistent(cutAt(finalT));

  narrative.push(
    `Simulation complete: ${plural(union.size, "unique finding")} produced, ${lostFindings} lost, ` +
      `${plural(duplicateMerges, "duplicate merge")} ignored, ${plural(totalSent, "message")} sent, ${totalDropped} dropped over ${plural(totalRounds, "gossip round")}. ` +
      (converged
        ? "Every node's local recommendation matches fusing all findings at once (converged)."
        : componentsConverged
          ? "Nodes that can still reach each other agree; a node that stayed cut off keeps its own local view, and its missing evidence is a gap for the others, not a contradiction."
          : "Nodes have NOT converged; investigate before demoing."),
  );

  return {
    investigationId: input.investigationId,
    mode: "decentralised_fusion_simulation",
    nodes,
    steps,
    metrics: {
      divergedDuringPartition,
      roundsToConvergeAfterHeal,
      converged,
      componentsConverged,
      lostFindings,
      duplicateMerges,
      findingsProducedWhileIsolated: producedWhileIsolated,
      totalRounds,
      messagesSent: totalSent,
      messagesDropped: totalDropped,
    },
    narrative,
  };
}
