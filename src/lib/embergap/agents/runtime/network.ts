// A simulated, partitionable network between runtime agents.
//
// Envelopes travel as serialized JSON, like bytes on a wire: the sender can't
// change one after sending it, and the receiver gets its own copy. Each directed
// link has its own loss, duplication and delay (jitter reorders messages), and
// can be cut. A cut link drops what crosses it but never pauses an agent: agents
// keep running on both sides and only find out from missing acknowledgements.
// Link state is checked when an envelope would be delivered, so something in
// flight when a link goes down is lost, and something due after it comes back
// arrives. Everything random comes from one seeded generator, so a scenario
// replays identically.
import { createRandom } from "./random";
import type { Envelope, EnvelopeType, SimTime } from "./types";

export type LinkPolicy = {
  /** Probability that an envelope is lost, 0 to 1. */
  lossRate: number;
  /** Probability that an envelope is delivered twice, 0 to 1. */
  duplicateRate: number;
  minDelayMs: number;
  maxDelayMs: number;
};

export const PERFECT_LINK: LinkPolicy = { lossRate: 0, duplicateRate: 0, minDelayMs: 50, maxDelayMs: 50 };

/** Scripted faults for exact tests: drop, delay or duplicate matching envelopes. */
export type FaultRule = {
  match: { from?: string; to?: string; type?: EnvelopeType };
  action: { kind: "drop" } | { kind: "delay"; extraMs: number } | { kind: "duplicate" };
  /** Applies to this many matching envelopes, then stops. Unlimited when omitted. */
  times?: number;
};

export type DropReason = "loss" | "partition" | "rule";

export type NetworkLogEntry =
  | { at: SimTime; kind: "link-down" | "link-up"; from: string; to: string }
  | { at: SimTime; kind: "dropped"; reason: DropReason; from: string; to: string; envelopeId: string; type: EnvelopeType }
  | { at: SimTime; kind: "duplicated" | "delayed"; from: string; to: string; envelopeId: string; type: EnvelopeType };

export type LinkStats = {
  sent: number;
  delivered: number;
  droppedLoss: number;
  droppedPartition: number;
  droppedRule: number;
  duplicated: number;
};

export type LinkStatus = { from: string; to: string; up: boolean } & LinkStats;

export type NetworkStatus = {
  links: LinkStatus[];
  totals: LinkStats;
  inFlight: number;
};

export type SimulatedNetwork = {
  readonly nodes: readonly string[];
  send(envelope: Envelope, now: SimTime): void;
  /** Removes and returns every envelope due by `now`, grouped by recipient. */
  deliverDue(now: SimTime): Map<string, Envelope[]>;
  /** Islands: links inside a group stay as they are, links between groups go down. */
  partition(groups: readonly (readonly string[])[], now: SimTime): void;
  cutLink(a: string, b: string, now: SimTime, options?: { oneWay?: boolean }): void;
  healLink(a: string, b: string, now: SimTime, options?: { oneWay?: boolean }): void;
  /** Brings every link back up. */
  heal(now: SimTime): void;
  isLinkUp(from: string, to: string): boolean;
  setLinkPolicy(from: string, to: string, policy: Partial<LinkPolicy>, options?: { oneWay?: boolean }): void;
  addRule(rule: FaultRule): void;
  status(): NetworkStatus;
  /** Link changes, drops and scripted faults, oldest first. */
  log(): NetworkLogEntry[];
};

type InFlight = { deliverAt: SimTime; order: number; from: string; to: string; id: string; type: EnvelopeType; wire: string };

const MAX_LOG = 5_000;

function checkPolicy(policy: LinkPolicy): LinkPolicy {
  const { lossRate, duplicateRate, minDelayMs, maxDelayMs } = policy;
  const isRate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (!isRate(lossRate) || !isRate(duplicateRate)) throw new RangeError("Rates must be between 0 and 1");
  if (!(minDelayMs >= 0) || !(maxDelayMs >= minDelayMs) || !Number.isFinite(maxDelayMs)) {
    throw new RangeError("Delays must satisfy 0 <= minDelayMs <= maxDelayMs");
  }
  return { ...policy };
}

const zeroStats = (): LinkStats => ({
  sent: 0,
  delivered: 0,
  droppedLoss: 0,
  droppedPartition: 0,
  droppedRule: 0,
  duplicated: 0,
});

export function createSimulatedNetwork(options: {
  nodes: readonly string[];
  seed: number;
  defaultLink?: LinkPolicy;
}): SimulatedNetwork {
  const nodes = [...new Set(options.nodes)].sort();
  if (nodes.length !== options.nodes.length) throw new Error("Node ids must be unique");
  const random = createRandom(options.seed);
  const defaultPolicy = checkPolicy(options.defaultLink ?? PERFECT_LINK);
  const policies = new Map<string, LinkPolicy>();
  const down = new Set<string>();
  const stats = new Map<string, LinkStats>();
  const rules: Array<FaultRule & { remaining: number }> = [];
  const log: NetworkLogEntry[] = [];
  let queue: InFlight[] = [];
  let order = 0;

  const key = (from: string, to: string) => `${from}->${to}`;
  const known = (id: string) => {
    if (!nodes.includes(id)) throw new Error(`Unknown node: ${id}`);
  };
  const statsFor = (from: string, to: string) => {
    let entry = stats.get(key(from, to));
    if (!entry) stats.set(key(from, to), (entry = zeroStats()));
    return entry;
  };
  const record = (entry: NetworkLogEntry) => {
    if (log.length < MAX_LOG) log.push(entry);
  };
  const pairs = (a: string, b: string, oneWay?: boolean) => (oneWay ? [[a, b]] : [[a, b], [b, a]]);

  function setDown(from: string, to: string, isDown: boolean, now: SimTime) {
    const linkKey = key(from, to);
    if (down.has(linkKey) === isDown) return;
    if (isDown) down.add(linkKey);
    else down.delete(linkKey);
    record({ at: now, kind: isDown ? "link-down" : "link-up", from, to });
  }

  function enqueue(item: Omit<InFlight, "order">) {
    queue.push({ ...item, order: order++ });
  }

  function matchingRule(envelope: Envelope) {
    return rules.find(
      (rule) =>
        rule.remaining > 0 &&
        (rule.match.from === undefined || rule.match.from === envelope.from) &&
        (rule.match.to === undefined || rule.match.to === envelope.to) &&
        (rule.match.type === undefined || rule.match.type === envelope.type),
    );
  }

  return {
    nodes,

    send(envelope, now) {
      known(envelope.from);
      known(envelope.to);
      if (envelope.from === envelope.to) throw new Error("An agent cannot send to itself");
      const link = statsFor(envelope.from, envelope.to);
      link.sent += 1;
      const base = { from: envelope.from, to: envelope.to, id: envelope.id, type: envelope.type };
      const wire = JSON.stringify(envelope);
      const policy = policies.get(key(envelope.from, envelope.to)) ?? defaultPolicy;
      const delay = () => policy.minDelayMs + random.int(0, policy.maxDelayMs - policy.minDelayMs);

      const rule = matchingRule(envelope);
      let extraDelay = 0;
      let forceDuplicate = false;
      if (rule) {
        rule.remaining -= 1;
        if (rule.action.kind === "drop") {
          link.droppedRule += 1;
          record({ at: now, kind: "dropped", reason: "rule", envelopeId: envelope.id, ...base });
          return;
        }
        if (rule.action.kind === "delay") {
          extraDelay = rule.action.extraMs;
          record({ at: now, kind: "delayed", envelopeId: envelope.id, ...base });
        }
        if (rule.action.kind === "duplicate") forceDuplicate = true;
      }

      if (random.chance(policy.lossRate)) {
        link.droppedLoss += 1;
        record({ at: now, kind: "dropped", reason: "loss", envelopeId: envelope.id, ...base });
        return;
      }
      enqueue({ ...base, deliverAt: now + delay() + extraDelay, wire });
      if (forceDuplicate || random.chance(policy.duplicateRate)) {
        link.duplicated += 1;
        record({ at: now, kind: "duplicated", envelopeId: envelope.id, ...base });
        enqueue({ ...base, deliverAt: now + delay() + extraDelay, wire });
      }
    },

    deliverDue(now) {
      const due = queue.filter((item) => item.deliverAt <= now);
      if (due.length === 0) return new Map();
      queue = queue.filter((item) => item.deliverAt > now);
      due.sort((a, b) => a.deliverAt - b.deliverAt || a.order - b.order);
      const byRecipient = new Map<string, Envelope[]>();
      for (const item of due) {
        const link = statsFor(item.from, item.to);
        if (down.has(key(item.from, item.to))) {
          link.droppedPartition += 1;
          record({ at: now, kind: "dropped", reason: "partition", from: item.from, to: item.to, envelopeId: item.id, type: item.type });
          continue;
        }
        link.delivered += 1;
        const inbox = byRecipient.get(item.to) ?? [];
        inbox.push(JSON.parse(item.wire) as Envelope);
        byRecipient.set(item.to, inbox);
      }
      return new Map([...byRecipient.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    },

    partition(groups, now) {
      const seen = new Map<string, number>();
      groups.forEach((group, index) =>
        group.forEach((id) => {
          known(id);
          if (seen.has(id)) throw new Error(`${id} is in more than one group`);
          seen.set(id, index);
        }),
      );
      for (const id of nodes) if (!seen.has(id)) throw new Error(`${id} is in no group`);
      for (const from of nodes) {
        for (const to of nodes) {
          if (from !== to && seen.get(from) !== seen.get(to)) setDown(from, to, true, now);
        }
      }
    },

    cutLink(a, b, now, cutOptions = {}) {
      known(a);
      known(b);
      for (const [from, to] of pairs(a, b, cutOptions.oneWay)) setDown(from, to, true, now);
    },

    healLink(a, b, now, healOptions = {}) {
      known(a);
      known(b);
      for (const [from, to] of pairs(a, b, healOptions.oneWay)) setDown(from, to, false, now);
    },

    heal(now) {
      for (const linkKey of [...down].sort()) {
        const [from, to] = linkKey.split("->");
        setDown(from, to, false, now);
      }
    },

    isLinkUp: (from, to) => !down.has(key(from, to)),

    setLinkPolicy(from, to, policy, policyOptions = {}) {
      known(from);
      known(to);
      for (const [a, b] of pairs(from, to, policyOptions.oneWay)) {
        policies.set(key(a, b), checkPolicy({ ...(policies.get(key(a, b)) ?? defaultPolicy), ...policy }));
      }
    },

    addRule(rule) {
      if (rule.times !== undefined && !(Number.isInteger(rule.times) && rule.times > 0)) {
        throw new RangeError("times must be a positive integer");
      }
      if (rule.action.kind === "delay" && !(rule.action.extraMs >= 0)) throw new RangeError("extraMs must be >= 0");
      rules.push({ ...rule, remaining: rule.times ?? Number.POSITIVE_INFINITY });
    },

    status() {
      const links: LinkStatus[] = [];
      const totals = zeroStats();
      for (const from of nodes) {
        for (const to of nodes) {
          if (from === to) continue;
          const link = stats.get(key(from, to)) ?? zeroStats();
          links.push({ from, to, up: !down.has(key(from, to)), ...link });
          for (const field of Object.keys(totals) as Array<keyof LinkStats>) totals[field] += link[field];
        }
      }
      return { links, totals, inFlight: queue.length };
    },

    log: () => log.map((entry) => ({ ...entry })),
  };
}
