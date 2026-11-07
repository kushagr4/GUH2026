/**
 * PROVISIONAL EmberGap types for the validation + fusion workstream (Developer B).
 *
 * These mirror the illustrative interfaces in docs/architecture.md
 * ("Contract-first collaboration") until Claude Mac publishes the real
 * `src/lib/embergap/contracts.ts`. When that lands, replace the body of this
 * file with re-exports from contracts so validators and fusion change in one place.
 *
 * Do not import this file from outside validators/** and fusion/**.
 */
import { z } from "zod";

export const PROVISIONAL_CONTRACT_VERSION = "0.1.0-provisional" as const;

export type SourceKind = "human" | "firms" | "eonet" | "weather" | "vision";
export type AgentId = "vision" | "satellite" | "weather" | "witness" | "fusion";
export type SourceState = "available" | "stale" | "unavailable" | "not_observed";
export type InvestigationStatus =
  | "unreviewed"
  | "investigating"
  | "needs_human_review"
  | "insufficient_evidence"
  | "reviewed";
export type Assessment = "supports" | "contradicts" | "inconclusive";

/** A normalised observation from any source. UTC ISO timestamps; latitude before longitude. */
export type Observation = {
  id: string;
  source: SourceKind;
  sourceRecordId?: string;
  observedAt: string;
  ingestedAt: string;
  latitude?: number;
  longitude?: number;
  sourceState: SourceState;
  /** Source-specific, validated at the boundary. Never trust blindly. */
  evidence: Record<string, unknown>;
};

/** Append-only, source-attributed assessment produced by one agent. */
export type AgentFinding = {
  id: string;
  investigationId: string;
  agentId: AgentId;
  createdAt: string;
  evidenceIds: string[];
  assessment: Assessment;
  reasonCodes: string[];
  explanation: string;
  limitations: string[];
};

export type AgentMessage = {
  id: string;
  investigationId: string;
  from: AgentId;
  to: AgentId;
  kind: string;
  createdAt: string;
  correlationId: string;
  payload: unknown;
};

/**
 * Human witness report as seen by validators. Coordinates are already
 * approximate (privacy-reduced) by the time they reach agents.
 */
export type WitnessReport = {
  id: string;
  investigationId: string;
  reporterId: string;
  observedAt: string;
  submittedAt: string;
  latitude: number;
  longitude: number;
  /** Approximate location precision in metres. */
  locationPrecisionM: number;
  description: string;
  /** Hash of the photo bytes, if a photo was attached (for shared-origin detection). */
  photoSha256?: string;
};

export const agentIdSchema = z.enum(["vision", "satellite", "weather", "witness", "fusion"]);
export const assessmentSchema = z.enum(["supports", "contradicts", "inconclusive"]);

export const agentFindingSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  agentId: agentIdSchema,
  createdAt: z.iso.datetime(),
  evidenceIds: z.array(z.string()),
  assessment: assessmentSchema,
  reasonCodes: z.array(z.string()),
  explanation: z.string(),
  limitations: z.array(z.string()),
});

/** Injected clock and ID generator so validators/fusion stay deterministic in tests. */
export type AgentDeps = {
  now: () => string;
  newId: () => string;
};
