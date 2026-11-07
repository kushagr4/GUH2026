import {
  comparableRecommendation,
  type DecentralisedPhase,
  type DecentralisedResult,
  type DecentralisedStep,
  type GossipLink,
} from "@/lib/embergap/agents/fusion";
import type { EvidenceStrength, FusionStatus, ReviewPriority } from "@/lib/embergap/agents/fusion/types";

/** Pure, JSON-safe view model for the "Every node decides" section. No percentages anywhere. */

export type EveryNodeSnapshotId = "before" | "during" | "after";

export type EveryNodeTile = {
  node: string;
  name: string;
  knownFindings: number;
  status: FusionStatus;
  statusLabel: string;
  priority: ReviewPriority;
  priorityLabel: string;
  strengthLabel: string;
  /** Index into the snapshot's islands (0 when the network is whole). */
  island: number;
  /** Tiles with the same key hold the same local recommendation. */
  recommendationKey: string;
  /** Index of this recommendation among the distinct ones in the snapshot (0, 1, ...). */
  variant: number;
};

export type EveryNodeSnapshot = {
  id: EveryNodeSnapshotId;
  title: string;
  phase: DecentralisedPhase;
  cutLinks: [string, string][];
  /** Connected groups of node ids; one group when no link is cut. */
  islands: string[][];
  allAgree: boolean;
  tiles: EveryNodeTile[];
};

export type EveryNodeViewModel = {
  snapshots: EveryNodeSnapshot[];
  divergedDuringPartition: boolean;
  roundsToConvergeAfterHeal: number | null;
  lostFindings: number;
  converged: boolean;
  summary: string;
};

/** Fixed tile order: a 2×2 grid with the two islands on separate rows. */
export const TILE_ORDER = ["witness", "vision", "satellite", "weather"] as const;

const NODE_NAMES: Record<string, string> = {
  witness: "Witness agent",
  vision: "Vision agent",
  satellite: "Satellite agent",
  weather: "Weather agent",
};

const STATUS_LABEL: Record<FusionStatus, string> = {
  investigating: "still investigating",
  needs_human_review: "needs human review",
  insufficient_evidence: "not enough evidence yet",
};

const PRIORITY_LABEL: Record<ReviewPriority, string> = {
  high: "high priority",
  medium: "medium priority",
  low: "low priority",
};

const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: "strong evidence",
  moderate: "moderate evidence",
  weak: "weak evidence",
  none: "no supporting evidence",
};

const SNAPSHOTS: { id: EveryNodeSnapshotId; title: string; phases: DecentralisedPhase[] }[] = [
  { id: "before", title: "Before split", phases: ["connected"] },
  { id: "during", title: "During split", phases: ["partitioned"] },
  { id: "after", title: "After healing", phases: ["converged", "healing"] },
];

function lastStepOf(steps: DecentralisedStep[], phases: DecentralisedPhase[]): DecentralisedStep | undefined {
  for (const phase of phases) {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].phase === phase) return steps[i];
  }
  return undefined;
}

const linkKey = (a: string, b: string) => [a, b].sort().join("|");

function islandsOf(nodes: string[], links: readonly GossipLink[], cut: [string, string][]): string[][] {
  const cutSet = new Set(cut.map(([a, b]) => linkKey(a, b)));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of links) {
    if (cutSet.has(linkKey(a, b))) continue;
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  const seen = new Set<string>();
  const islands: string[][] = [];
  for (const start of TILE_ORDER.filter((n) => nodes.includes(n))) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start as string];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop() as string;
      group.push(n);
      for (const next of adjacency.get(n) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    islands.push(TILE_ORDER.filter((n) => group.includes(n)));
  }
  return islands;
}

function toSnapshot(
  spec: (typeof SNAPSHOTS)[number],
  step: DecentralisedStep,
  links: readonly GossipLink[],
): EveryNodeSnapshot {
  const nodeIds = step.nodes.map((n) => n.node as string);
  const cutLinks = step.cutLinks.map(([a, b]) => [a, b] as [string, string]);
  const islands = islandsOf(nodeIds, links, cutLinks);
  const variants: string[] = [];
  const byNode = new Map(step.nodes.map((n) => [n.node as string, n]));
  const tiles: EveryNodeTile[] = [];
  for (const id of TILE_ORDER) {
    const view = byNode.get(id);
    if (!view) continue;
    const rec = view.recommendation;
    const key = comparableRecommendation(rec);
    if (!variants.includes(key)) variants.push(key);
    tiles.push({
      node: id,
      name: NODE_NAMES[id] ?? id,
      knownFindings: view.knownFindingIds.length,
      status: rec.status,
      statusLabel: STATUS_LABEL[rec.status],
      priority: rec.reviewPriority,
      priorityLabel: PRIORITY_LABEL[rec.reviewPriority],
      strengthLabel: STRENGTH_LABEL[rec.evidenceStrength],
      island: Math.max(
        0,
        islands.findIndex((g) => g.includes(id)),
      ),
      recommendationKey: key,
      variant: variants.indexOf(key),
    });
  }
  return {
    id: spec.id,
    title: spec.title,
    phase: step.phase,
    cutLinks,
    islands,
    allAgree: variants.length <= 1,
    tiles,
  };
}

export function buildEveryNodeViewModel(result: DecentralisedResult, links: readonly GossipLink[]): EveryNodeViewModel {
  const snapshots: EveryNodeSnapshot[] = [];
  for (const spec of SNAPSHOTS) {
    const step = lastStepOf(result.steps, spec.phases);
    if (step) snapshots.push(toSnapshot(spec, step, links));
  }
  const m = result.metrics;
  const parts: string[] = [m.divergedDuringPartition ? "Islands disagreed while split" : "Islands stayed in step while split"];
  if (m.roundsToConvergeAfterHeal !== null) {
    const n = m.roundsToConvergeAfterHeal;
    parts.push(`agreed again ${n} gossip round${n === 1 ? "" : "s"} after healing`);
  }
  parts.push(`${m.lostFindings} findings lost`);
  if (m.converged) parts.push("all nodes now match the shared answer");
  return {
    snapshots,
    divergedDuringPartition: m.divergedDuringPartition,
    roundsToConvergeAfterHeal: m.roundsToConvergeAfterHeal,
    lostFindings: m.lostFindings,
    converged: m.converged,
    summary: parts.join(" · "),
  };
}
