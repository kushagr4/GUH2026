import type { AgentDeps, AgentFinding, Assessment } from "../types";
import { visionModelOutputSchema, type VisionModelOutput } from "./schema";

export const VISION_REASON = {
  smokeVisible: "vision.smoke_visible",
  flameVisible: "vision.flame_visible",
  noFireIndicators: "vision.no_fire_indicators",
  ambiguous: "vision.ambiguous",
  lowQuality: "vision.low_quality",
  modelUnavailable: "vision.model_unavailable",
  outputInvalid: "vision.output_invalid",
  unverifiableClaimStripped: "vision.unverifiable_claim_stripped",
} as const;

export const VISION_LIMITATIONS = {
  base: "Model-assisted description only; cannot verify image authenticity, time or location.",
  notCalibrated: "Indicator labels are descriptive model judgements, not calibrated probabilities.",
  absenceIsWeak:
    "No visible fire indicators in this image is weak evidence; it does not rule out a fire outside the frame or at another time.",
  gapUnavailable:
    "Vision analysis was unavailable; recorded as a data gap, not as evidence for or against a fire.",
  gapInvalid:
    "Vision model output failed validation; recorded as a data gap, not as evidence for or against a fire.",
  claimStripped:
    "The model asserted a location, time or authenticity it cannot verify; that claim was removed.",
  descriptionWithheld:
    "Part of the model description was withheld because it contained instruction-like or operational language.",
} as const;

/** Maximum length of the finding explanation shown to reviewers. */
export const VISION_EXPLANATION_MAX = 600;
const DESCRIPTION_EXCERPT_MAX = 300;

export type VisionFindingContext = {
  investigationId: string;
  /** Observation / media ids this finding is about. */
  evidenceIds: string[];
};

// Keys a model may add to assert things it cannot know. Matched case-insensitively
// against every top-level key that is not part of the requested output.
const REQUESTED_KEYS = new Set(["indicators", "ambiguityFactors", "imageQuality", "description"]);
const CLAIM_KEY_PATTERN =
  /claim|locat|gps|coord|lat|lon|geo|place|address|time|date|taken|captured|exif|authentic|genuine|verif|real|original|tamper|manipulat|edit/i;

// Sentences in the free-text description that assert unverifiable facts.
const CLAIM_SENTENCE_PATTERNS: RegExp[] = [
  /-?\d{1,3}\.\d{2,}\s*°?\s*[NSns]?\s*,\s*-?\d{1,3}\.\d{2,}/, // decimal coordinates
  /\d{1,3}\s*°\s*\d{1,2}\s*['′]/, // degrees-minutes
  /\b(gps|exif|geotag\w*|metadata|latitude|longitude|coordinates?)\b/i,
  /\b(authentic|genuine|unedited|unaltered|untampered|not\s+(been\s+)?(edited|altered|manipulated|doctored|faked))\b/i,
  /\b(taken|captured|photographed|shot)\s+(at|on|in|near|from|today|yesterday)\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/, // ISO dates
  /\b\d{1,2}:\d{2}\b/, // clock times
];

// Sentences that look like instructions to a downstream system, or operational
// emergency language a vision description must never carry.
const INSTRUCTION_SENTENCE_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(instruction|rule|prompt|previous|above|guideline)s?\b/i,
  /\b(system|developer)\s+(prompt|message|instruction)s?\b/i,
  /\byou\s+(are|must|should|will)\b/i,
  /\b(assistant|AI model|language model)\b/i,
  /\b(dispatch|evacuat\w*|alert|emergency\s+services|fire\s+brigade|firefighters?|first\s+responders?)\b/i,
  /\bconfirm(ed|s)?\b/i,
  /\b(mark|set|classify|label|report)\s+(this|it|the)\b/i,
  /https?:\/\/|www\./i,
];

// C0/C1 controls, zero-width and bidi override characters.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Plain, single-line, capped text. Removes markup characters so it can never render as HTML. */
export function sanitizeText(value: string, max: number): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(UNSAFE_CHARS, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>`{}[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

type CleanedDescription = { text: string; claimStripped: boolean; withheld: boolean };

function cleanDescription(description: string): CleanedDescription {
  const sentences = sanitizeText(description, Number.MAX_SAFE_INTEGER)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  let claimStripped = false;
  let withheld = false;
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (INSTRUCTION_SENTENCE_PATTERNS.some((p) => p.test(sentence))) {
      withheld = true;
    } else if (CLAIM_SENTENCE_PATTERNS.some((p) => p.test(sentence))) {
      claimStripped = true;
    } else {
      kept.push(sentence);
    }
  }
  return { text: sanitizeText(kept.join(" "), DESCRIPTION_EXCERPT_MAX), claimStripped, withheld };
}

/** Remove claim-like top-level keys (any value type) before schema parsing. */
function stripClaimKeys(raw: Record<string, unknown>): {
  rest: Record<string, unknown>;
  stripped: boolean;
} {
  const rest: Record<string, unknown> = {};
  let stripped = false;
  for (const [key, value] of Object.entries(raw)) {
    if (!REQUESTED_KEYS.has(key) && CLAIM_KEY_PATTERN.test(key)) {
      // A present-but-empty claim (null/undefined/"") asserts nothing.
      if (value !== undefined && value !== null && value !== "") stripped = true;
      continue;
    }
    rest[key] = value;
  }
  return { rest, stripped };
}

type Mapping = { assessment: Assessment; reasonCodes: string[]; summary: string };

function mapIndicators(output: VisionModelOutput): Mapping {
  const { indicators, ambiguityFactors, imageQuality } = output;

  if (imageQuality === "poor" || imageQuality === "unusable") {
    return {
      assessment: "inconclusive",
      reasonCodes: [VISION_REASON.lowQuality],
      summary: `Image quality is ${imageQuality}, so visible indicators cannot be assessed reliably.`,
    };
  }

  const levels = [indicators.smoke, indicators.flame, indicators.glow, indicators.burnScar];
  const anyIndicator = levels.some((l) => l !== "absent");
  const clearSmoke = indicators.smoke === "clear";
  const clearFlame = indicators.flame === "clear";
  const factors = ambiguityFactors.length > 0 ? ambiguityFactors.join(", ") : "";

  if ((clearSmoke || clearFlame) && ambiguityFactors.length === 0) {
    const reasonCodes: string[] = [];
    const seen: string[] = [];
    if (clearSmoke) {
      reasonCodes.push(VISION_REASON.smokeVisible);
      seen.push("smoke");
    }
    if (clearFlame) {
      reasonCodes.push(VISION_REASON.flameVisible);
      seen.push("flame");
    }
    return {
      assessment: "supports",
      reasonCodes,
      summary: `The model describes visible ${seen.join(" and ")} with no listed look-alike factors.`,
    };
  }

  if (anyIndicator) {
    const why =
      ambiguityFactors.length > 0
        ? `possible look-alike factors are present (${factors})`
        : indicators.burnScar !== "absent" && !clearSmoke && !clearFlame
          ? "indicators are only tentative or suggest past rather than active burning"
          : "indicators are only tentative";
    return {
      assessment: "inconclusive",
      reasonCodes: [VISION_REASON.ambiguous],
      summary: `The model notes possible fire-like features, but ${why}.`,
    };
  }

  if (ambiguityFactors.length > 0) {
    return {
      assessment: "inconclusive",
      reasonCodes: [VISION_REASON.ambiguous],
      summary: `No fire indicators described; the scene shows ${factors}.`,
    };
  }

  if (imageQuality === "good") {
    return {
      assessment: "contradicts",
      reasonCodes: [VISION_REASON.noFireIndicators],
      summary: "The model describes no visible smoke, flame, glow or burn scar in this image.",
    };
  }

  return {
    assessment: "inconclusive",
    reasonCodes: [VISION_REASON.lowQuality],
    summary: `No fire indicators described, but image quality is only ${imageQuality}.`,
  };
}

function finding(
  ctx: VisionFindingContext,
  deps: AgentDeps,
  assessment: Assessment,
  reasonCodes: string[],
  explanation: string,
  limitations: string[],
): AgentFinding {
  return {
    id: deps.newId(),
    investigationId: ctx.investigationId,
    agentId: "vision",
    createdAt: deps.now(),
    evidenceIds: [...ctx.evidenceIds],
    assessment,
    reasonCodes: [...new Set(reasonCodes)],
    explanation: sanitizeText(explanation, VISION_EXPLANATION_MAX),
    limitations: [...new Set(limitations)],
  };
}

/** Inconclusive gap finding used when no model output exists at all. */
export function visionUnavailableFinding(
  ctx: VisionFindingContext,
  deps: AgentDeps,
  detail = "The vision analyzer did not return a result.",
): AgentFinding {
  return finding(
    ctx,
    deps,
    "inconclusive",
    [VISION_REASON.modelUnavailable],
    detail,
    [VISION_LIMITATIONS.base, VISION_LIMITATIONS.gapUnavailable],
  );
}

/**
 * Turn untrusted vision-model output into an AgentFinding for human review.
 * Never throws. The assessment is derived only from the structured fields;
 * free text can never change it.
 */
export function toVisionFinding(
  raw: unknown,
  ctx: VisionFindingContext,
  deps: AgentDeps,
): AgentFinding {
  const invalid = () =>
    finding(
      ctx,
      deps,
      "inconclusive",
      [VISION_REASON.outputInvalid],
      "The vision model output did not match the expected structure and was discarded.",
      [VISION_LIMITATIONS.base, VISION_LIMITATIONS.gapInvalid],
    );

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return invalid();

  const { rest, stripped: claimKeysStripped } = stripClaimKeys(raw as Record<string, unknown>);
  const parsed = visionModelOutputSchema.safeParse(rest);
  if (!parsed.success) return invalid();

  const mapping = mapIndicators(parsed.data);
  const description = cleanDescription(parsed.data.description);
  const claimStripped = claimKeysStripped || description.claimStripped;

  const reasonCodes = [...mapping.reasonCodes];
  const limitations: string[] = [VISION_LIMITATIONS.base, VISION_LIMITATIONS.notCalibrated];
  if (mapping.assessment === "contradicts") limitations.push(VISION_LIMITATIONS.absenceIsWeak);
  if (claimStripped) {
    reasonCodes.push(VISION_REASON.unverifiableClaimStripped);
    limitations.push(VISION_LIMITATIONS.claimStripped);
  }
  if (description.withheld) limitations.push(VISION_LIMITATIONS.descriptionWithheld);

  const explanation = description.text
    ? `${mapping.summary} Model description (untrusted): "${description.text}"`
    : mapping.summary;

  return finding(ctx, deps, mapping.assessment, reasonCodes, explanation, limitations);
}
