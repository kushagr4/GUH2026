import type { AgentFinding } from "../types";
import type { WitnessOptions } from "./options";
import type { WitnessReasonCode } from "./reason-codes";

/** Why two reports were linked into the same source group. */
export type WitnessLinkKind = "same_reporter" | "same_photo" | "similar_text";

export type WitnessLink = {
  /** Report IDs, lexicographically ordered (`a < b`). */
  a: string;
  b: string;
  kind: WitnessLinkKind;
  /** Trigram Jaccard similarity, only for `similar_text`. */
  similarity?: number;
};

/**
 * How one input report was treated. Every valid input report appears exactly
 * once; nothing is silently dropped.
 */
export type WitnessReportDisposition = {
  reportId: string;
  reporterId: string;
  sourceGroupId: string;
  /**
   * `primary`: the report representing its source group.
   * `duplicate_submission`: same reporter as an earlier report in the group.
   * `shared_origin`: a different reporter whose photo or text matches the group.
   */
  role: "primary" | "duplicate_submission" | "shared_origin";
  /** Coherent in time and space with the anchor report. */
  coherent: boolean;
  /** Distance to the anchor (km), rounded to 0.01 km. */
  distanceFromAnchorKm: number;
  /** Absolute `observedAt` difference to the anchor (minutes), rounded. */
  minutesFromAnchor: number;
  /** Distance allowed for this pair: base + both precisions (capped), km. */
  allowedDistanceKm: number;
  reasonCodes: WitnessReasonCode[];
};

/** A group of reports treated as ONE independent source. */
export type WitnessSourceGroup = {
  sourceGroupId: string;
  representativeReportId: string;
  reportIds: string[];
  reporterIds: string[];
  links: WitnessLink[];
  /** At least one member is coherent with the anchor, so the group counts once. */
  countsTowardCorroboration: boolean;
};

export type WitnessInvalidReport = {
  reportId: string;
  reasonCodes: WitnessReasonCode[];
  /** Fixed, code-generated problem descriptions (never echo report text). */
  problems: string[];
};

export type WitnessAssessment = {
  finding: AgentFinding;
  /** The report the coherent cluster is centred on, or null when there are none. */
  anchorReportId: string | null;
  /** Number of distinct coherent source groups. Never double-counts. */
  effectiveIndependentCount: number;
  sourceGroups: WitnessSourceGroup[];
  reports: WitnessReportDisposition[];
  invalidReports: WitnessInvalidReport[];
  options: WitnessOptions;
};
