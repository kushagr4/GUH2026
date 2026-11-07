/**
 * EmberGap fusion rule table.
 *
 * Every decision fusion makes comes from one of the ordered rules below, and
 * each rule contributes one explanation line, so a human reviewer can audit
 * exactly why a recommendation was produced. Rules are deterministic and
 * pure. Changing any rule must bump FUSION_RULES_VERSION.
 *
 * Scientific limits encoded here:
 * - Missing, unavailable, stale or not-observed data is a GAP (unknown), never
 *   evidence that there is no fire. A satellite no-detection is a gap.
 * - Weather is context: it can never count as independent support.
 * - Vision describes the reporter's own photo, so it cannot authenticate it and
 *   is not independent of that reporter. A single witness is a weak signal only.
 * - evidenceStrength is a qualitative count of independent source types. It is
 *   not a probability and never a confirmation.
 */
import type {
  AgentFinding,
  SourceState,
} from "@/lib/embergap/agents/validators/types";
import type {
  AgentEvidenceKind,
  EvidenceStrength,
  FusionStatus,
  ReviewPriority,
  SourceAgentId,
} from "./types";

export const FUSION_RULES_VERSION = "fusion-rules/1.0.0" as const;

/** Source agents in a fixed order, so every output is order-independent. */
export const SOURCE_AGENTS: readonly SourceAgentId[] = [
  "satellite",
  "vision",
  "weather",
  "witness",
] as const;

/** Reason codes that mean "no usable observation", i.e. a data gap. */
export const GAP_REASON_CODES: ReadonlySet<string> = new Set([
  "vision.model_unavailable",
  "vision.output_invalid",
  "satellite.no_detection",
  "satellite.not_observed",
  "satellite.unavailable",
  "satellite.stale",
  "weather.unavailable",
  "weather.stale",
]);

export const WITNESS_CORROBORATION = "witness.independent_corroboration";
export const WITNESS_SINGLE_REPORT = "witness.single_report";

/** Wording that must accompany every recommendation. */
export const STANDARD_LIMITATIONS: readonly string[] = [
  "Decision support for human review only.",
  "This is not a fire confirmation.",
  "This is not an emergency alert. Anyone in immediate danger should contact emergency services directly.",
  "evidenceStrength is a qualitative, rule-based label, not a probability and not calibrated.",
  "Missing or unavailable data is unknown, not evidence that there is no fire.",
  "Vision findings describe a submitted photo; they cannot authenticate its time, place or origin.",
];

// ---------------------------------------------------------------------------
// Stage 1: classify each source agent's latest finding (first matching rule wins)
// ---------------------------------------------------------------------------

export type ClassificationContext = {
  agentId: SourceAgentId;
  latest?: AgentFinding;
  sourceState?: SourceState;
};

export type ClassificationRule = {
  id: string;
  description: string;
  kind: AgentEvidenceKind;
  matches: (ctx: ClassificationContext) => boolean;
  reason: (ctx: ClassificationContext) => string;
};

const has = (ctx: ClassificationContext, code: string) =>
  ctx.latest?.reasonCodes.includes(code) ?? false;

const gapCodes = (ctx: ClassificationContext) =>
  (ctx.latest?.reasonCodes ?? []).filter((code) => GAP_REASON_CODES.has(code)).sort();

export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    id: "C1-missing",
    description: "No finding has arrived from this agent: a data gap.",
    kind: "gap",
    matches: (ctx) => ctx.latest === undefined,
    reason: (ctx) =>
      ctx.sourceState && ctx.sourceState !== "available"
        ? `No ${ctx.agentId} finding received (source ${ctx.sourceState}); treated as unknown, not as negative evidence.`
        : `No ${ctx.agentId} finding received yet; treated as unknown, not as negative evidence.`,
  },
  {
    id: "C2-source-state",
    description: "The source is stale, unavailable or not observed: a data gap.",
    kind: "gap",
    matches: (ctx) => ctx.sourceState !== undefined && ctx.sourceState !== "available",
    reason: (ctx) =>
      `${ctx.agentId} source is ${ctx.sourceState}; its finding is treated as a data gap, not as evidence either way.`,
  },
  {
    id: "C3-gap-reason",
    description: "The finding reports no usable observation (e.g. model unavailable, satellite no-detection): a data gap.",
    kind: "gap",
    matches: (ctx) => gapCodes(ctx).length > 0,
    reason: (ctx) =>
      `${ctx.agentId} reported ${gapCodes(ctx).join(", ")}; recorded as a data gap. Absence of a detection is not evidence of absence.`,
  },
  {
    id: "C4-contradicts",
    description: "An available finding contradicts the report.",
    kind: "contradiction",
    matches: (ctx) => ctx.latest?.assessment === "contradicts",
    reason: (ctx) => `${ctx.agentId} finding contradicts the report.`,
  },
  {
    id: "C5-weather-context",
    description: "Weather support is context only and never counts as independent support.",
    kind: "context_support",
    matches: (ctx) => ctx.agentId === "weather" && ctx.latest?.assessment === "supports",
    reason: () =>
      "Weather conditions are consistent with fire spread; this is context only and cannot confirm a fire.",
  },
  {
    id: "C6-witness-corroborated",
    description: "Two or more independent, coherent witnesses: independent support from the witness source.",
    kind: "support",
    matches: (ctx) =>
      ctx.agentId === "witness" &&
      ctx.latest?.assessment === "supports" &&
      has(ctx, WITNESS_CORROBORATION),
    reason: () =>
      "Independent witnesses are coherent in time and space; counted as ONE supporting source (witness), however many reports there are.",
  },
  {
    id: "C7-witness-single",
    description: "An uncorroborated witness report is a weak signal, never independent support.",
    kind: "weak_signal",
    matches: (ctx) =>
      ctx.agentId === "witness" &&
      (ctx.latest?.assessment === "supports" || has(ctx, WITNESS_SINGLE_REPORT)),
    reason: () =>
      "Only one independent witness so far; a weak signal that is not corroborated.",
  },
  {
    id: "C8-supports",
    description: "An available finding supports the report.",
    kind: "support",
    matches: (ctx) => ctx.latest?.assessment === "supports",
    reason: (ctx) =>
      ctx.agentId === "vision"
        ? "Vision describes possible fire indicators in the submitted photo (a description, not authentication)."
        : `${ctx.agentId} finding supports the report.`,
  },
  {
    id: "C9-inconclusive",
    description: "Anything else is inconclusive.",
    kind: "inconclusive",
    matches: () => true,
    reason: (ctx) => `${ctx.agentId} finding is inconclusive.`,
  },
];

export function classify(ctx: ClassificationContext): {
  kind: AgentEvidenceKind;
  ruleId: string;
  reason: string;
} {
  // C9 always matches, so find() never returns undefined in practice.
  const rule = CLASSIFICATION_RULES.find((r) => r.matches(ctx)) ?? CLASSIFICATION_RULES[CLASSIFICATION_RULES.length - 1];
  return { kind: rule.kind, ruleId: rule.id, reason: rule.reason(ctx) };
}

// ---------------------------------------------------------------------------
// Stage 2: evidence strength from the number of independent supporting sources
// ---------------------------------------------------------------------------

export type StrengthContext = {
  /** Distinct source agents classified as "support". Weather never appears here. */
  independentSupporters: SourceAgentId[];
  hasWeakSignal: boolean;
  hasContextSupport: boolean;
};

export type StrengthRule = {
  id: string;
  description: string;
  strength: EvidenceStrength;
  matches: (ctx: StrengthContext) => boolean;
  reason: (ctx: StrengthContext) => string;
};

const list = (agents: SourceAgentId[]) => agents.join(" + ");

export const STRENGTH_RULES: readonly StrengthRule[] = [
  {
    id: "S1-three-plus-sources",
    description: "Three or more independent source types support the report.",
    strength: "strong",
    matches: (ctx) => ctx.independentSupporters.length >= 3,
    reason: (ctx) =>
      `${ctx.independentSupporters.length} independent source types support the report (${list(ctx.independentSupporters)}): strong evidence for review.`,
  },
  {
    id: "S2-two-sources",
    description: "Two independent source types support the report.",
    strength: "moderate",
    matches: (ctx) => ctx.independentSupporters.length === 2,
    reason: (ctx) =>
      `2 independent source types support the report (${list(ctx.independentSupporters)}): moderate evidence for review.`,
  },
  {
    id: "S3-one-source",
    description: "One source type alone is at most weak.",
    strength: "weak",
    matches: (ctx) => ctx.independentSupporters.length === 1,
    reason: (ctx) =>
      `Only one source type supports the report (${list(ctx.independentSupporters)}); a single source is capped at weak.`,
  },
  {
    id: "S4-signal-only",
    description: "Only a single witness and/or weather context: capped at weak.",
    strength: "weak",
    matches: (ctx) => ctx.hasWeakSignal || ctx.hasContextSupport,
    reason: (ctx) =>
      ctx.hasWeakSignal && ctx.hasContextSupport
        ? "Only an uncorroborated witness and weather context; capped at weak."
        : ctx.hasWeakSignal
          ? "Only an uncorroborated witness report; capped at weak."
          : "Only weather context; weather alone can never exceed weak.",
  },
  {
    id: "S5-none",
    description: "No supporting evidence.",
    strength: "none",
    matches: () => true,
    reason: () => "No finding supports the report.",
  },
];

export function strengthFor(ctx: StrengthContext): {
  strength: EvidenceStrength;
  ruleId: string;
  reason: string;
} {
  const rule = STRENGTH_RULES.find((r) => r.matches(ctx)) ?? STRENGTH_RULES[STRENGTH_RULES.length - 1];
  return { strength: rule.strength, ruleId: rule.id, reason: rule.reason(ctx) };
}

// ---------------------------------------------------------------------------
// Stage 3: status and review priority (first matching rule wins)
// ---------------------------------------------------------------------------

export type DecisionContext = {
  strength: EvidenceStrength;
  contradictionCount: number;
  gapCount: number;
  sourceAgentCount: number;
};

export type DecisionRule = {
  id: string;
  description: string;
  status: FusionStatus;
  priority: ReviewPriority;
  matches: (ctx: DecisionContext) => boolean;
  reason: (ctx: DecisionContext) => string;
};

export const DECISION_RULES: readonly DecisionRule[] = [
  {
    id: "D1-contradiction",
    description: "Support plus a real contradiction: a human must resolve it. Never silently resolved.",
    status: "needs_human_review",
    priority: "high",
    matches: (ctx) => ctx.contradictionCount > 0,
    reason: (ctx) =>
      `${ctx.contradictionCount} contradiction(s) between supporting and contradicting findings; fusion does not resolve them, so a human must review with high priority.`,
  },
  {
    id: "D2-no-support",
    description: "No supporting evidence: insufficient evidence (which is not evidence of no fire).",
    status: "insufficient_evidence",
    priority: "low",
    matches: (ctx) => ctx.strength === "none",
    reason: (ctx) =>
      `No supporting evidence and ${ctx.gapCount} of ${ctx.sourceAgentCount} sources are data gaps: insufficient evidence. Missing data is not evidence that there is no fire.`,
  },
  {
    id: "D3-strong",
    description: "Strong evidence: human review with high priority.",
    status: "needs_human_review",
    priority: "high",
    matches: (ctx) => ctx.strength === "strong",
    reason: () => "Strong, independent evidence: recommend human review with high priority.",
  },
  {
    id: "D4-moderate",
    description: "Moderate evidence: human review with medium priority.",
    status: "needs_human_review",
    priority: "medium",
    matches: (ctx) => ctx.strength === "moderate",
    reason: () => "Moderate, independent evidence: recommend human review with medium priority.",
  },
  {
    id: "D5-weak",
    description: "Weak evidence: keep investigating, low priority, until more independent evidence arrives.",
    status: "investigating",
    priority: "low",
    matches: () => true,
    reason: () =>
      "Weak evidence only: keep investigating at low priority until independent evidence arrives.",
  },
];

export function decide(ctx: DecisionContext): {
  status: FusionStatus;
  priority: ReviewPriority;
  ruleId: string;
  reason: string;
} {
  const rule = DECISION_RULES.find((r) => r.matches(ctx)) ?? DECISION_RULES[DECISION_RULES.length - 1];
  return { status: rule.status, priority: rule.priority, ruleId: rule.id, reason: rule.reason(ctx) };
}
