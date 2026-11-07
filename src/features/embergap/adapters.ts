import {
  agentFindingSchema,
  idSchema,
  LIMITATION_CODES,
  reasonCodeSchema,
  syntheticId,
  VISION_REQUIRED_LIMITATIONS,
  type AgentFinding,
  type FusionRecommendationInput,
  type LimitationCode,
} from "@/lib/embergap/contracts";
import type { AgentFinding as ProvisionalFinding } from "@/lib/embergap/agents/validators/types";
import type { FusionRecommendation as ProvisionalRecommendation } from "@/lib/embergap/agents/fusion/types";

/**
 * Integration bridge (Claude Mac): turns findings from the validators and fusion
 * merged in #6, which still use their provisional types, into canonical
 * AgentFindings that the runtime store and the read APIs accept. Remove it once
 * those modules emit canonical findings themselves.
 */

/** Keeps UUIDs, and maps anything else (such as "syn-…") to a stable synthetic UUID. */
function toUuid(id: string): string {
  return idSchema.safeParse(id).success ? id : syntheticId(`validators/${id}`);
}

/** Free-text caveats from the validators, matched to limitation codes. */
const LIMITATION_PATTERNS: [RegExp, LimitationCode[]][] = [
  [/authenticity|cannot verify image/i, [...VISION_REQUIRED_LIMITATIONS]],
  [/calibrat|not a probability|probabilit/i, ["model_output_uncalibrated"]],
  [/does not rule out|not evidence that there is no|absence/i, ["no_detection_is_not_absence"]],
  [/unavailable/i, ["source_unavailable"]],
  [/failed validation/i, ["model_output_invalid"]],
  [/claim was removed/i, ["unverifiable_claim_removed"]],
  [/withheld/i, ["description_withheld"]],
  [/unverified human claims/i, ["human_report_unverified"]],
  [/approximate|privacy-reduced/i, ["low_spatial_precision"]],
  [/independence|shared|coordinated/i, ["possible_shared_origin"]],
  [/thresholds|heuristic/i, ["heuristic_thresholds_uncalibrated"]],
  [/synthetic/i, ["synthetic_data"]],
];

function limitationCodesFor(notes: string[]): LimitationCode[] {
  const codes = new Set<LimitationCode>();
  for (const note of notes) {
    for (const [pattern, mapped] of LIMITATION_PATTERNS) {
      if (pattern.test(note)) mapped.forEach((code) => codes.add(code));
    }
  }
  return [...codes].filter((code) => (LIMITATION_CODES as readonly string[]).includes(code));
}

const ABSENCE_CODE = /no_detection|no_reports|unavailable|gap|stale/i;

export function toCanonicalFinding(
  finding: ProvisionalFinding,
  context: {
    investigationId: string;
    reportId?: string | null;
    isSynthetic: boolean;
    /** The fusion recommendation object, for the fusion agent's finding. */
    recommendation?: ProvisionalRecommendation;
  },
): AgentFinding {
  const reasonCodes = finding.reasonCodes.filter((code) => reasonCodeSchema.safeParse(code).success);
  const limitations = new Set(limitationCodesFor(finding.limitations));
  if (finding.agentId === "vision") VISION_REQUIRED_LIMITATIONS.forEach((code) => limitations.add(code));
  if (finding.agentId === "weather") limitations.add("weather_is_context_only");
  if (finding.reasonCodes.some((code) => ABSENCE_CODE.test(code))) limitations.add("no_detection_is_not_absence");
  if (context.isSynthetic) limitations.add("synthetic_data");

  // Weather and fusion can't support or contradict; absent data can't contradict.
  let assessment: AgentFinding["assessment"] = finding.assessment;
  if (finding.agentId === "fusion" || finding.agentId === "weather") assessment = finding.agentId === "fusion" || assessment !== "inconclusive" ? "context" : "inconclusive";
  if (assessment === "contradicts" && (finding.agentId === "satellite" || finding.reasonCodes.some((code) => ABSENCE_CODE.test(code)))) {
    assessment = "inconclusive";
  }
  const directional = assessment === "supports" || assessment === "contradicts";

  let recommendation: FusionRecommendationInput | null = null;
  if (finding.agentId === "fusion") {
    const source = context.recommendation;
    // Only direct support and real contradictions: never weather context, weak
    // single-witness signals, inconclusive findings or data gaps.
    const idsOfKind = (kind: "support" | "contradiction") =>
      (source?.agents ?? []).flatMap((agent) => (agent.kind === kind && agent.findingId ? [toUuid(agent.findingId)] : []));
    recommendation = {
      recommendedStatus: source?.status ?? "needs_human_review",
      reviewPriority: source?.reviewPriority ?? "medium",
      independentSourceCount: source?.independentSupportCount ?? 0,
      supportingFindingIds: idsOfKind("support"),
      contradictingFindingIds: idsOfKind("contradiction"),
      evidenceGaps: (source?.gaps ?? []).map((gap) => `${gap.agentId}: ${gap.reason}`.slice(0, 300)).slice(0, 20),
      possibleDuplicateReportIds: [],
    };
  }

  return agentFindingSchema.parse({
    id: toUuid(finding.id),
    investigationId: context.investigationId,
    reportId: context.reportId ?? null,
    agentId: finding.agentId,
    createdAt: finding.createdAt,
    evidenceIds: finding.evidenceIds.map(toUuid).slice(0, 100),
    assessment,
    // The provisional findings carry no strength; "weak" is the conservative default.
    strength: directional ? "weak" : null,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : [`${finding.agentId}.unspecified`],
    explanation: finding.explanation.slice(0, 2_000) || "No explanation given.",
    limitations: [...limitations].slice(0, 20),
    limitationNotes: finding.limitations.map((note) => note.slice(0, 300)).slice(0, 10),
    recommendation,
    isSynthetic: context.isSynthetic,
  });
}
