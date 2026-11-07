// Pure builder: turns the runtime's partition demonstration into a compact,
// JSON-safe view model for the Network page. Everything here is read from the
// run itself (phases, tasks, timeline, findings, replayed snapshots); nothing
// is invented. Fields the run does not provide are left out.
import { SYNTHETIC_NOW } from "@/lib/embergap/contracts";
import type { PartitionDemoResult } from "@/lib/embergap/agents/runtime";

export type StageId = "connected" | "partitioned" | "working_in_isolation" | "reconnected" | "reconciled";

export const NODE_IDS = ["weather", "satellite", "vision", "fusion"] as const;
export type NodeId = (typeof NODE_IDS)[number];

export type FusionView = {
  report: string;
  status: string;
  priority: string;
  independentSources: number;
  gaps: string[];
};

export type NodeView = {
  id: string;
  label: string;
  /** Peers this agent itself believes it can reach at this moment. */
  reachable: string[];
  /** Tasks this agent finished so far. */
  tasksCompleted: number;
  /** Tasks waiting for evidence that has not reached this agent yet. */
  blockedOn: string[];
  /** Events in this agent's own replica, from a deterministic replay to this moment. */
  knows: { events?: number; findings: number };
  latestFinding?: { assessment: string; reasonCodes: string[]; summary: string; report: string };
  /** Only on the fusion agent: its current recommendation per report. */
  fusion?: FusionView[];
};

export type StageView = {
  id: StageId;
  label: string;
  /** The simulated moment this snapshot shows, in ms. */
  simTimeMs: number;
  detail: string;
  split: boolean;
  links: Array<{ a: string; b: string; up: boolean }>;
  nodes: NodeView[];
};

export type NetworkViewModel = {
  groups: string[][];
  stages: StageView[];
  metrics: {
    redelivered: number | null;
    duplicatesIgnored: number | null;
    completedWhileIsolated: number | null;
    settleMsAfterHeal: number | null;
    droppedByPartition: number;
    droppedByLoss: number;
    duplicatedOnWire: number;
    messagesSent: number;
  };
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

const STAGE_LABELS: Record<StageId, string> = {
  connected: "Connected",
  partitioned: "Network splits",
  working_in_isolation: "Working in isolation",
  reconnected: "Reconnected",
  reconciled: "Reconciled",
};

const NODE_LABELS: Record<string, string> = {
  weather: "Weather agent",
  satellite: "Satellite agent",
  vision: "Vision agent",
  fusion: "Fusion agent",
};

/**
 * The simulated moment each stage is shown at. "Partitioned" is shown once
 * the agents have had time to notice the silence on their own; "reconnected"
 * just after the heal, before reconciliation finishes.
 */
export function stageSnapshotTimes(full: PartitionDemoResult): Record<StageId, number> {
  const { startedAtMs, healedAtMs } = full.partition;
  const settled = full.convergence.settledAtMs ?? healedAtMs + 5_000;
  return {
    connected: startedAtMs - 1,
    partitioned: startedAtMs + 3_000,
    working_in_isolation: healedAtMs - 1,
    reconnected: Math.min(healedAtMs + 300, settled - 1),
    reconciled: settled,
  };
}

const EPOCH_MS = Date.parse(SYNTHETIC_NOW);

function reportLabel(full: PartitionDemoResult, investigationId: string) {
  const index = full.investigationIds.indexOf(investigationId);
  return index === 0 ? "Report A" : index === 1 ? "Report B" : "Other report";
}

function taskName(taskId: string) {
  return taskId.split(":").slice(1).join(":") || taskId;
}

function humanise(code: string) {
  return code.replace(/^fusion\./, "").replace(/[._-]+/g, " ");
}

function reachabilityAt(full: PartitionDemoResult, agentId: string, t: number): string[] {
  const base = full.phases[0]?.reachability[agentId] ?? {};
  const status: Record<string, string> = { ...base };
  if (t >= full.partition.startedAtMs) {
    for (const entry of full.timeline) {
      if (entry.source !== "agent" || entry.agentId !== agentId || entry.at > t) continue;
      if (entry.at < full.partition.startedAtMs) continue;
      const peer = entry.peer;
      if (!peer) continue;
      if (entry.kind === "peer.unreachable") status[peer] = "unreachable";
      if (entry.kind === "peer.reachable") status[peer] = "reachable";
    }
  }
  return Object.entries(status)
    .filter(([, value]) => value === "reachable")
    .map(([peer]) => peer)
    .sort();
}

function linksFrom(result: PartitionDemoResult | undefined, full: PartitionDemoResult, split: boolean) {
  const pairs: Array<{ a: string; b: string; up: boolean }> = [];
  const ids = [...NODE_IDS];
  const side = new Map<string, number>();
  full.partition.groups.forEach((group, index) => group.forEach((id) => side.set(id, index)));
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]!;
      const b = ids[j]!;
      let up: boolean;
      if (result) {
        const ab = result.network.links.find((link) => link.from === a && link.to === b);
        const ba = result.network.links.find((link) => link.from === b && link.to === a);
        up = Boolean(ab?.up && ba?.up);
      } else {
        up = !split || side.get(a) === side.get(b);
      }
      pairs.push({ a, b, up });
    }
  }
  return pairs;
}

/**
 * Builds the view model from the full run plus optional replays of the same
 * run stopped at each stage's snapshot time (for per-agent replica sizes and
 * live link state).
 */
export function buildNetworkViewModel(
  full: PartitionDemoResult,
  replays: Partial<Record<StageId, PartitionDemoResult>> = {},
): NetworkViewModel {
  const times = stageSnapshotTimes(full);
  const findings = full.records?.findings ?? [];
  const at = (iso: string) => Date.parse(iso) - EPOCH_MS;

  const stages: StageView[] = full.stages.map((stage) => {
    const id = stage.stage as StageId;
    const t = times[id];
    const split = id === "partitioned" || id === "working_in_isolation";
    const replay = replays[id];

    const nodes: NodeView[] = NODE_IDS.map((agentId) => {
      const agent = full.agents.find((item) => item.agentId === agentId);
      const tasks = agent?.tasks ?? [];
      const tasksCompleted = tasks.filter((task) => task.status === "done" && task.finishedAt !== undefined && task.finishedAt <= t).length;
      const blockedOn = tasks
        .filter((task) => task.after.length > 0 && task.enqueuedAt <= t && (task.finishedAt === undefined || task.finishedAt > t))
        .flatMap((task) => task.after.map((producer) => `${taskName(producer)} result (${reportLabel(full, task.investigationId)})`));
      const own = findings.filter((finding) => finding.agentId === agentId && at(finding.createdAt) <= t);
      const latest = own.at(-1);
      const replayAgent = replay?.agents.find((item) => item.agentId === agentId);
      const node: NodeView = {
        id: agentId,
        label: NODE_LABELS[agentId] ?? agentId,
        reachable: reachabilityAt(full, agentId, t),
        tasksCompleted,
        blockedOn,
        knows: { findings: own.length, ...(replayAgent ? { events: replayAgent.eventCount } : {}) },
      };
      if (latest) {
        node.latestFinding = {
          assessment: latest.assessment,
          reasonCodes: latest.reasonCodes.filter((code) => !code.startsWith("fusion.rule.")).map(humanise),
          summary: latest.explanation,
          report: reportLabel(full, latest.investigationId),
        };
      }
      if (agentId === "fusion") {
        node.fusion = full.investigationIds.flatMap((investigationId) => {
          const recommendation = own.filter((finding) => finding.investigationId === investigationId && finding.recommendation).at(-1)?.recommendation;
          return recommendation
            ? [{
                report: reportLabel(full, investigationId),
                status: recommendation.recommendedStatus,
                priority: recommendation.reviewPriority,
                independentSources: recommendation.independentSourceCount,
                gaps: recommendation.evidenceGaps,
              }]
            : [];
        });
      }
      return node;
    });

    return { id, label: STAGE_LABELS[id], simTimeMs: t, detail: stage.detail, split, links: linksFrom(replay, full, split), nodes };
  });

  const reconciliation = full.reconciliation;
  return {
    groups: full.partition.groups,
    stages,
    metrics: {
      redelivered: reconciliation?.redelivered ?? null,
      duplicatesIgnored: reconciliation?.duplicatesIgnored ?? null,
      completedWhileIsolated: reconciliation?.completedWhileIsolated ?? null,
      settleMsAfterHeal: full.convergence.msAfterHeal,
      droppedByPartition: full.network.totals.droppedPartition,
      droppedByLoss: full.network.totals.droppedLoss,
      duplicatedOnWire: full.network.totals.duplicated,
      messagesSent: full.network.totals.sent,
    },
    checks: full.checks.map(({ name, passed, detail }) => ({ name, passed, detail })),
  };
}
