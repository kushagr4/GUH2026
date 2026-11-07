/**
 * LABELLED SYNTHETIC timelines for the fusion replay simulation
 * (`simulatePartitionTimeline`). Every finding, id and timestamp here is
 * invented for demonstration and testing. None of it is real data, and no
 * timeline describes a real incident. This replays FUSION only; it is not the
 * agent runtime or its transport.
 */
import type {
  AgentFinding,
  AgentId,
  Assessment,
} from "@/lib/embergap/agents/validators/types";
import type { TimelineEvent, TimelineInput, TimelinePhase } from "./timeline";
import type {
  EvidenceStrength,
  FusionStatus,
  ReviewPriority,
  SourceAgentId,
} from "./types";

export type TimelineScenario = {
  id: string;
  title: string;
  /** Always true: these are labelled synthetic fixtures. */
  synthetic: true;
  description: string;
  input: TimelineInput;
  expected: {
    phases: TimelinePhase[];
    findingsProducedWhileIsolated: number;
    duplicatesIgnored: number;
    final: {
      status: FusionStatus;
      evidenceStrength: EvidenceStrength;
      reviewPriority: ReviewPriority;
      gapAgents: SourceAgentId[];
      hasContradiction: boolean;
    };
  };
};

/** 2026-11-07 14:mm UTC, synthetic. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 7, 14, minute, 0)).toISOString();

function builder(scenarioId: string) {
  const investigationId = `syn-timeline-${scenarioId}`;
  const findings = new Map<string, AgentFinding>();
  const make = (
    id: string,
    agentId: AgentId,
    assessment: Assessment,
    reasonCodes: string[],
    minute: number,
  ): AgentFinding => {
    const finding: AgentFinding = {
      id: `syn-${scenarioId}-${id}`,
      investigationId,
      agentId,
      createdAt: at(minute),
      evidenceIds: [`syn-obs-${scenarioId}-${id}`],
      assessment,
      reasonCodes,
      explanation: `SYNTHETIC ${agentId} finding for timeline ${scenarioId}.`,
      limitations: ["Synthetic fixture, not real data."],
    };
    findings.set(id, finding);
    return finding;
  };
  /** A producer emits a new finding at the finding's own createdAt. */
  const produce = (f: AgentFinding): TimelineEvent => ({ at: f.createdAt, agentId: f.agentId, finding: f });
  /** The producer re-sends an already-produced finding (e.g. after a lost acknowledgement). */
  const redeliver = (localId: string, minute: number): TimelineEvent => {
    const f = findings.get(localId);
    if (!f) throw new Error(`Unknown synthetic finding ${localId}`);
    return { at: at(minute), agentId: f.agentId, finding: f, kind: "redeliver" };
  };
  return { investigationId, make, produce, redeliver };
}

function headline(): TimelineScenario {
  const { investigationId, make, produce, redeliver } = builder("headline");
  return {
    id: "headline",
    title: "Satellite and weather isolated, then reconciled",
    synthetic: true,
    description:
      "A single witness and a smoke photo arrive. Satellite and weather lose their link to fusion but keep producing findings locally. A second, independent witness arrives during the partition, so the recommendation updates with the gaps visible. On reconnection the buffered findings and one duplicate retry are delivered, and fusion converges.",
    input: {
      investigationId,
      partition: { startsAt: at(2), endsAt: at(10), isolatedAgents: ["satellite", "weather"] },
      events: [
        produce(make("w1", "witness", "inconclusive", ["witness.single_report"], 0)),
        produce(make("v1", "vision", "supports", ["vision.smoke_visible"], 1)),
        produce(make("s1", "satellite", "supports", ["satellite.thermal_anomaly"], 3)),
        produce(make("we1", "weather", "supports", ["weather.dry_windy"], 4)),
        produce(make("w2", "witness", "supports", ["witness.independent_corroboration"], 5)),
        redeliver("s1", 6),
      ],
    },
    expected: {
      phases: [
        "before_partition",
        "before_partition",
        "partitioned",
        "partitioned",
        "partitioned",
        "partitioned",
        "partitioned",
        "reconciled",
      ],
      findingsProducedWhileIsolated: 2,
      duplicatesIgnored: 1,
      final: {
        status: "needs_human_review",
        evidenceStrength: "strong",
        reviewPriority: "high",
        gapAgents: [],
        hasContradiction: false,
      },
    },
  };
}

function contradiction(): TimelineScenario {
  const { investigationId, make, produce } = builder("contradiction");
  return {
    id: "contradiction",
    title: "Isolated vision agent produces a contradicting finding",
    synthetic: true,
    description:
      "Corroborated witnesses and a satellite thermal anomaly support the report. The vision agent is isolated and, while offline, assesses the photo as showing no fire indicators. After reconnection the contradiction is recorded for a human reviewer and the earlier support stays visible: nothing is silently overwritten.",
    input: {
      investigationId,
      partition: { startsAt: at(2), endsAt: at(8), isolatedAgents: ["vision"] },
      events: [
        produce(make("w1", "witness", "supports", ["witness.independent_corroboration"], 0)),
        produce(make("we1", "weather", "inconclusive", ["weather.calm"], 0)),
        produce(make("s1", "satellite", "supports", ["satellite.thermal_anomaly"], 1)),
        produce(make("v1", "vision", "contradicts", ["vision.no_fire_indicators"], 4)),
      ],
    },
    expected: {
      phases: ["before_partition", "before_partition", "partitioned", "partitioned", "reconciled"],
      findingsProducedWhileIsolated: 1,
      duplicatesIgnored: 0,
      final: {
        status: "needs_human_review",
        evidenceStrength: "moderate",
        reviewPriority: "high",
        gapAgents: [],
        hasContradiction: true,
      },
    },
  };
}

function offlineAgent(): TimelineScenario {
  const { investigationId, make, produce, redeliver } = builder("offline-agent");
  return {
    id: "offline-agent",
    title: "Satellite agent offline for the whole timeline",
    synthetic: true,
    description:
      "The satellite agent is isolated for the entire timeline and has no local observation to report. Witness, vision and weather findings arrive normally, including one duplicate delivery. Satellite stays a data gap throughout: unknown, never negative evidence.",
    input: {
      investigationId,
      partition: { startsAt: at(0), endsAt: at(12), isolatedAgents: ["satellite"] },
      events: [
        produce(make("w1", "witness", "inconclusive", ["witness.single_report"], 1)),
        produce(make("v1", "vision", "supports", ["vision.smoke_visible"], 3)),
        produce(make("we1", "weather", "supports", ["weather.dry_windy"], 5)),
        produce(make("w2", "witness", "supports", ["witness.independent_corroboration"], 7)),
        redeliver("v1", 8),
      ],
    },
    expected: {
      phases: [
        "partitioned",
        "partitioned",
        "partitioned",
        "partitioned",
        "partitioned",
        "partitioned",
        "reconciled",
      ],
      findingsProducedWhileIsolated: 0,
      duplicatesIgnored: 1,
      final: {
        status: "needs_human_review",
        evidenceStrength: "moderate",
        reviewPriority: "medium",
        gapAgents: ["satellite"],
        hasContradiction: false,
      },
    },
  };
}

export const TIMELINE_SCENARIOS: readonly TimelineScenario[] = [headline(), contradiction(), offlineAgent()];
