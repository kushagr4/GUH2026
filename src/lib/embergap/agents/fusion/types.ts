/**
 * Types for the EmberGap evidence-fusion agent.
 *
 * Fusion produces a transparent, rule-based REVIEW RECOMMENDATION for a human.
 * It is decision support only: it never confirms a fire, never issues an
 * emergency alert and never marks an investigation as "reviewed".
 */
import type {
  AgentFinding,
  AgentId,
  SourceState,
} from "@/lib/embergap/agents/validators/types";

/** Agents whose findings fusion reconciles. Fusion never consumes its own output. */
export type SourceAgentId = Exclude<AgentId, "fusion">;

export type FusionInput = {
  investigationId: string;
  /** Untrusted: validated, deduplicated by id and order-normalised inside fusion. */
  findings: AgentFinding[];
  /** Availability of each source. Anything other than "available" is a data gap. */
  sourceStates?: Partial<Record<AgentId, SourceState>>;
  /**
   * Optional "as of" time (UTC ISO). Findings created after it are ignored, so
   * a timeline can be replayed exactly as fusion would have seen it then.
   */
  observedAt?: string;
};

/** Fusion only ever outputs these three statuses. "reviewed" is a human decision. */
export type FusionStatus = "investigating" | "needs_human_review" | "insufficient_evidence";
export type ReviewPriority = "high" | "medium" | "low";
/**
 * Qualitative, rule-based label describing how many INDEPENDENT source types
 * support the report. It is NOT a probability, NOT calibrated and NOT a confirmation.
 */
export type EvidenceStrength = "strong" | "moderate" | "weak" | "none";

/**
 * How fusion treated one agent's latest finding.
 * - support: direct, independent support (counts towards evidenceStrength)
 * - weak_signal: a single, uncorroborated witness report (never counted as independent support)
 * - context_support: contextual conditions only, e.g. weather (never counted as independent support)
 * - contradiction: a real, available finding against the report
 * - inconclusive: an available finding that neither supports nor contradicts
 * - gap: missing, unavailable, stale or not-observed data. Unknown, never negative evidence.
 */
export type AgentEvidenceKind =
  | "support"
  | "weak_signal"
  | "context_support"
  | "contradiction"
  | "inconclusive"
  | "gap";

export type AgentClassification = {
  agentId: SourceAgentId;
  kind: AgentEvidenceKind;
  /** Latest finding id used for the decision, if any finding arrived. */
  findingId?: string;
  /** Earlier findings from the same agent, kept visible for audit but not used. */
  supersededFindingIds: string[];
  ruleId: string;
  reason: string;
};

export type FindingIdsByAgent = Partial<Record<SourceAgentId, string[]>>;

export type FusionContradiction = { agents: SourceAgentId[]; explanation: string };
export type FusionGap = { agentId: SourceAgentId; reason: string };

export type FusionAudit = {
  /** Valid, unique findings for this investigation that fusion considered. */
  acceptedFindingIds: string[];
  /** Ids delivered more than once. Applied once (idempotent). */
  duplicateFindingIds: string[];
  /** Ids delivered more than once with DIFFERENT content. One copy is chosen deterministically. */
  conflictingDuplicateIds: string[];
  /** Number of inputs rejected by schema validation (untrusted input). */
  invalidFindingCount: number;
  /** Findings for another investigation, ignored. */
  otherInvestigationFindingIds: string[];
  /** Findings claiming to be from the fusion agent, ignored (fusion never consumes its own output). */
  fusionFindingIdsIgnored: string[];
  /** Findings created after `observedAt`, ignored. */
  futureFindingIds: string[];
};

export type FusionRecommendation = {
  investigationId: string;
  status: FusionStatus;
  reviewPriority: ReviewPriority;
  evidenceStrength: EvidenceStrength;
  /** Number of independent source types giving direct support. */
  independentSupportCount: number;
  supporting: FindingIdsByAgent;
  contradicting: FindingIdsByAgent;
  inconclusive: FindingIdsByAgent;
  contradictions: FusionContradiction[];
  gaps: FusionGap[];
  agents: AgentClassification[];
  /** Ordered, human-auditable explanation. Each line names the rule that produced it. */
  explanation: string[];
  /** The recommendation expressed as an append-only finding from the "fusion" agent. */
  finding: AgentFinding;
  audit: FusionAudit;
  rulesVersion: string;
};
