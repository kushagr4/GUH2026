/**
 * Witness reason codes. The first six are the shared vocabulary fusion relies
 * on; `no_reports` and `invalid_report` are witness-local additions and are
 * always inconclusive (data gaps), never contradictions.
 */
export const WITNESS_REASON_CODES = {
  singleReport: "witness.single_report",
  independentCorroboration: "witness.independent_corroboration",
  duplicateSubmission: "witness.duplicate_submission",
  sharedOrigin: "witness.shared_origin",
  temporalIncoherent: "witness.temporal_incoherent",
  spatialIncoherent: "witness.spatial_incoherent",
  noReports: "witness.no_reports",
  invalidReport: "witness.invalid_report",
} as const;

export type WitnessReasonCode = (typeof WITNESS_REASON_CODES)[keyof typeof WITNESS_REASON_CODES];

/** Stable order in which reason codes appear on the finding. */
export const WITNESS_REASON_CODE_ORDER: readonly WitnessReasonCode[] = [
  WITNESS_REASON_CODES.independentCorroboration,
  WITNESS_REASON_CODES.singleReport,
  WITNESS_REASON_CODES.noReports,
  WITNESS_REASON_CODES.duplicateSubmission,
  WITNESS_REASON_CODES.sharedOrigin,
  WITNESS_REASON_CODES.temporalIncoherent,
  WITNESS_REASON_CODES.spatialIncoherent,
  WITNESS_REASON_CODES.invalidReport,
];
