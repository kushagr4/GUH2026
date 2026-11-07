/**
 * Read-only projections served by GET /api/embergap/map and
 * GET /api/embergap/investigations/[id] (Outrolife workstream).
 *
 * PROVISIONAL: InvestigationStatus, AgentId and the finding shape follow the
 * illustrative interfaces in docs/architecture.md. When Claude Mac's canonical
 * `src/lib/embergap/contracts.ts` lands, import those instead of these copies.
 */
import type { Bbox, DataMode, FirmsResult, SourceState } from "@/lib/embergap/sources/firms/types";

export type { Bbox, DataMode, SourceState };

export type InvestigationStatus =
  | "unreviewed"
  | "investigating"
  | "needs_human_review"
  | "insufficient_evidence"
  | "reviewed";

export type AgentId = "vision" | "satellite" | "weather" | "witness" | "fusion";
export type SourceKind = "human" | "firms" | "eonet" | "weather" | "vision";
export type Assessment = "supports" | "contradicts" | "inconclusive";

/** Review priority words, never a percentage: nothing here is calibrated. */
export type ReviewPriority = "high" | "medium" | "low" | "undetermined";

export type Freshness = "fresh" | "recent" | "stale";

export type MapFeature = {
  id: string;
  kind: "thermal_anomaly" | "investigation";
  title: string;
  /** Approximate. Reports are snapped to a grid; never a reporter's exact position. */
  latitude: number;
  longitude: number;
  locationPrecisionKm: number;
  observedAt: string;
  ageMinutes: number;
  freshness: Freshness;
  reviewStatus: InvestigationStatus | null;
  priority: ReviewPriority | null;
  provenance: {
    source: "firms" | "reports";
    mode: DataMode;
    label: string;
  };
  investigationId: string | null;
  /** Thermal anomalies only: the product's own class, not a fire probability. */
  confidence: "low" | "nominal" | "high" | null;
  frpMw: number | null;
};

export type MapSourceStatus = {
  mode: DataMode;
  state: SourceState;
  retrievedAt: string | null;
  note: string;
  limitations: string[];
  error?: string;
};

export type MapResponse = {
  generatedAt: string;
  bbox: Bbox;
  limit: number;
  total: number;
  truncated: boolean;
  features: MapFeature[];
  sources: {
    firms: MapSourceStatus & { product: FirmsResult["product"]; dayRange: number };
    investigations: MapSourceStatus;
  };
};

export type AgentFindingView = {
  id: string;
  agentId: AgentId;
  createdAt: string;
  assessment: Assessment;
  reasonCodes: string[];
  explanation: string;
  limitations: string[];
  evidenceIds: string[];
  /** Produced while the agent was cut off, delivered after the link came back. */
  deliveredAfterPartition: boolean;
};

export type EvidenceSourceView = {
  source: SourceKind;
  label: string;
  state: SourceState;
  observedAt: string | null;
  retrievedAt: string | null;
  summary: string;
  limitations: string[];
};

export type ActivityEvent = {
  id: string;
  at: string;
  actor: AgentId | "system";
  kind:
    | "report_received"
    | "task_queued"
    | "finding_recorded"
    | "link_partitioned"
    | "link_restored"
    | "duplicate_ignored"
    | "recommendation_updated";
  detail: string;
};

export type InvestigationDetail = {
  id: string;
  title: string;
  region: string;
  status: InvestigationStatus;
  mode: DataMode;
  createdAt: string;
  updatedAt: string;
  report: {
    observedAt: string;
    latitude: number;
    longitude: number;
    locationPrecisionKm: number;
    summary: string;
    hasPhoto: boolean;
    relatedReportCount: number;
  };
  recommendation: {
    priority: ReviewPriority;
    summary: string;
    reasonCodes: string[];
    contradictions: string[];
    gaps: string[];
  };
  evidence: EvidenceSourceView[];
  findings: AgentFindingView[];
  activity: ActivityEvent[];
};
