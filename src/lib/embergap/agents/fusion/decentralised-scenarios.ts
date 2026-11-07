/**
 * LABELLED SYNTHETIC scenarios for the decentralised fusion simulation
 * (`simulateDecentralisedFusion`). Every finding, id and timestamp here is
 * invented for demonstration and testing. None of it is real data, and no
 * scenario describes a real incident. This simulates a gossip network in
 * process; it is not a deployed network or the agent runtime.
 */
import type {
  AgentFinding,
  AgentId,
  Assessment,
} from "@/lib/embergap/agents/validators/types";
import type { DecentralisedEvent, DecentralisedInput, GossipLink } from "./decentralised";
import type {
  EvidenceStrength,
  FusionStatus,
  ReviewPriority,
  SourceAgentId,
} from "./types";

export type DecentralisedExpectedView = {
  status: FusionStatus;
  evidenceStrength: EvidenceStrength;
  reviewPriority: ReviewPriority;
  gapAgents: SourceAgentId[];
  hasContradiction: boolean;
};

export type DecentralisedScenario = {
  id: string;
  title: string;
  /** Always true: these are labelled synthetic fixtures. */
  synthetic: true;
  description: string;
  input: DecentralisedInput;
  expected: {
    divergedDuringPartition: boolean;
    converged: boolean;
    componentsConverged: boolean;
    roundsToConvergeAfterHeal: number | null;
    findingsProducedWhileIsolated: number;
    /** Final local view shared by every node that is still connected to the others. */
    finalConnected: DecentralisedExpectedView;
    /** Nodes in the connected majority at the end. */
    connectedNodes: SourceAgentId[];
    /** A node that stays cut off, with its own final local view. */
    isolated?: { node: SourceAgentId; view: DecentralisedExpectedView };
  };
};

/** 2026-11-07 14:mm UTC, synthetic. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 7, 14, minute, 0)).toISOString();

const ALL: SourceAgentId[] = ["satellite", "vision", "weather", "witness"];
/** Ring: satellite – weather – vision – witness – satellite. */
const RING: GossipLink[] = [
  ["satellite", "weather"],
  ["weather", "vision"],
  ["vision", "witness"],
  ["witness", "satellite"],
];
const MESH: GossipLink[] = [
  ["satellite", "vision"],
  ["satellite", "weather"],
  ["satellite", "witness"],
  ["vision", "weather"],
  ["vision", "witness"],
  ["weather", "witness"],
];

function builder(scenarioId: string) {
  const investigationId = `syn-decentralised-${scenarioId}`;
  const produce = (
    id: string,
    agentId: AgentId,
    assessment: Assessment,
    reasonCodes: string[],
    minute: number,
  ): DecentralisedEvent => {
    const finding: AgentFinding = {
      id: `syn-${scenarioId}-${id}`,
      investigationId,
      agentId,
      createdAt: at(minute),
      evidenceIds: [`syn-obs-${scenarioId}-${id}`],
      assessment,
      reasonCodes,
      explanation: `SYNTHETIC ${agentId} finding for decentralised scenario ${scenarioId}.`,
      limitations: ["Synthetic fixture, not real data."],
    };
    return { at: finding.createdAt, kind: "produce", node: agentId, finding };
  };
  return { investigationId, produce };
}

/** Shared event script for the headline and lossy scenarios, so they compare like for like. */
function splitEvents(produce: ReturnType<typeof builder>["produce"]): DecentralisedEvent[] {
  return [
    produce("w1", "witness", "inconclusive", ["witness.single_report"], 0),
    produce("v1", "vision", "supports", ["vision.smoke_visible"], 3),
    produce("s1", "satellite", "supports", ["satellite.thermal_anomaly"], 4),
    produce("we1", "weather", "supports", ["weather.dry_windy"], 5),
    produce("w2", "witness", "supports", ["witness.independent_corroboration"], 6),
  ];
}

const SPLIT_PARTITION = {
  startsAt: at(2),
  endsAt: at(9),
  cutLinks: [
    ["weather", "vision"],
    ["witness", "satellite"],
  ] as GossipLink[],
};

const STRONG_HIGH: DecentralisedExpectedView = {
  status: "needs_human_review",
  evidenceStrength: "strong",
  reviewPriority: "high",
  gapAgents: [],
  hasContradiction: false,
};

function headline(): DecentralisedScenario {
  const { investigationId, produce } = builder("headline");
  return {
    id: "headline",
    title: "Ring splits in two, each side decides alone, then gossip converges",
    synthetic: true,
    description:
      "Four actor nodes in a ring, no fusion hub. A single witness report spreads before the partition. The ring then splits into {satellite, weather} and {vision, witness}. Each side keeps producing findings and fusing locally, so their recommendations differ. When the links come back, anti-entropy gossip exchanges the missing findings and every node independently reaches the same recommendation.",
    input: {
      investigationId,
      nodes: [...ALL],
      links: RING,
      partitions: [SPLIT_PARTITION],
      events: splitEvents(produce),
    },
    expected: {
      divergedDuringPartition: true,
      converged: true,
      componentsConverged: true,
      roundsToConvergeAfterHeal: 1,
      findingsProducedWhileIsolated: 4,
      finalConnected: STRONG_HIGH,
      connectedNodes: [...ALL],
    },
  };
}

function lossy(): DecentralisedScenario {
  const { investigationId, produce } = builder("lossy");
  return {
    id: "lossy",
    title: "Same split on lossy links (30% simulated message loss)",
    synthetic: true,
    description:
      "The headline script, but roughly three in ten gossip messages are dropped (seeded, reproducible). Nothing tracks the dropped messages: each round's digest comparison resends whatever a neighbour still lacks, so the network converges with no finding lost, only in more rounds.",
    input: {
      investigationId,
      nodes: [...ALL],
      links: RING,
      partitions: [SPLIT_PARTITION],
      events: splitEvents(produce),
      dropRate: 0.3,
      seed: 7,
    },
    expected: {
      divergedDuringPartition: true,
      converged: true,
      componentsConverged: true,
      roundsToConvergeAfterHeal: 3,
      findingsProducedWhileIsolated: 4,
      finalConnected: STRONG_HIGH,
      connectedNodes: [...ALL],
    },
  };
}

function isolatedNode(): DecentralisedScenario {
  const { investigationId, produce } = builder("isolated-node");
  return {
    id: "isolated-node",
    title: "Satellite node cut off for the whole run",
    synthetic: true,
    description:
      "A full mesh where every satellite link stays cut. The satellite node still records its own thermal-anomaly finding and fuses locally, so it has its own (weaker) view. The other three nodes converge among themselves; for them the satellite is a data gap, unknown and never a contradiction.",
    input: {
      investigationId,
      nodes: [...ALL],
      links: MESH,
      partitions: [
        {
          startsAt: at(0),
          cutLinks: [
            ["satellite", "vision"],
            ["satellite", "weather"],
            ["satellite", "witness"],
          ],
        },
      ],
      events: [
        produce("w1", "witness", "inconclusive", ["witness.single_report"], 0),
        produce("v1", "vision", "supports", ["vision.smoke_visible"], 1),
        produce("s1", "satellite", "supports", ["satellite.thermal_anomaly"], 2),
        produce("we1", "weather", "supports", ["weather.dry_windy"], 3),
        produce("w2", "witness", "supports", ["witness.independent_corroboration"], 4),
      ],
    },
    expected: {
      divergedDuringPartition: true,
      converged: false,
      componentsConverged: true,
      roundsToConvergeAfterHeal: null,
      findingsProducedWhileIsolated: 5,
      finalConnected: {
        status: "needs_human_review",
        evidenceStrength: "moderate",
        reviewPriority: "medium",
        gapAgents: ["satellite"],
        hasContradiction: false,
      },
      connectedNodes: ["vision", "weather", "witness"],
      isolated: {
        node: "satellite",
        view: {
          status: "investigating",
          evidenceStrength: "weak",
          reviewPriority: "low",
          gapAgents: ["vision", "weather", "witness"],
          hasContradiction: false,
        },
      },
    },
  };
}

export const DECENTRALISED_SCENARIOS: readonly DecentralisedScenario[] = [headline(), lossy(), isolatedNode()];
