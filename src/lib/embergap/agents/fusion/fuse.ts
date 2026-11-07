/**
 * EmberGap evidence fusion: reconcile independent agents' findings into a
 * transparent REVIEW RECOMMENDATION for a human. Decision support only.
 *
 * Guarantees:
 * - Deterministic: the same set of findings gives the same recommendation in
 *   any order, and delivering a finding twice is idempotent.
 * - Counts independent SOURCE types, not raw findings.
 * - Gaps (missing, unavailable, stale, not-observed, no-detection) are never contradictions.
 * - Contradictions are recorded and escalated, never silently resolved.
 * - Untrusted text (finding explanations) is never copied into the output.
 */
import {
  agentFindingSchema,
  type AgentDeps,
  type AgentFinding,
} from "@/lib/embergap/agents/validators/types";
import {
  FUSION_RULES_VERSION,
  SOURCE_AGENTS,
  STANDARD_LIMITATIONS,
  classify,
  decide,
  strengthFor,
} from "./rules";
import type {
  AgentClassification,
  FindingIdsByAgent,
  FusionAudit,
  FusionContradiction,
  FusionGap,
  FusionInput,
  FusionRecommendation,
  SourceAgentId,
} from "./types";

const time = (iso: string) => Date.parse(iso);

/** Stable JSON with sorted keys, used to compare duplicate deliveries deterministically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const byCreatedThenId = (a: AgentFinding, b: AgentFinding) =>
  time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

type Normalised = { byAgent: Map<SourceAgentId, AgentFinding[]>; audit: FusionAudit };

/** Validate, scope, deduplicate and group findings. Independent of input order. */
function normalise(input: FusionInput): Normalised {
  const audit: FusionAudit = {
    acceptedFindingIds: [],
    duplicateFindingIds: [],
    conflictingDuplicateIds: [],
    invalidFindingCount: 0,
    otherInvestigationFindingIds: [],
    fusionFindingIdsIgnored: [],
    futureFindingIds: [],
  };
  const asOf = input.observedAt === undefined ? undefined : time(input.observedAt);
  const unique = new Map<string, { finding: AgentFinding; key: string }>();
  const duplicates = new Set<string>();
  const conflicts = new Set<string>();

  for (const raw of input.findings) {
    const parsed = agentFindingSchema.safeParse(raw);
    if (!parsed.success) {
      audit.invalidFindingCount += 1;
      continue;
    }
    const finding = parsed.data;
    const key = canonical(finding);
    const existing = unique.get(finding.id);
    if (existing) {
      duplicates.add(finding.id);
      if (existing.key !== key) {
        conflicts.add(finding.id);
        // Keep the canonically smaller copy so the choice is order-independent.
        if (key < existing.key) unique.set(finding.id, { finding, key });
      }
      continue;
    }
    unique.set(finding.id, { finding, key });
  }

  const byAgent = new Map<SourceAgentId, AgentFinding[]>();
  const other: string[] = [];
  const fusionIgnored: string[] = [];
  const future: string[] = [];
  const accepted: string[] = [];
  for (const { finding } of unique.values()) {
    if (finding.investigationId !== input.investigationId) {
      other.push(finding.id);
      continue;
    }
    if (finding.agentId === "fusion") {
      fusionIgnored.push(finding.id);
      continue;
    }
    if (asOf !== undefined && time(finding.createdAt) > asOf) {
      future.push(finding.id);
      continue;
    }
    accepted.push(finding.id);
    const group = byAgent.get(finding.agentId) ?? [];
    group.push(finding);
    byAgent.set(finding.agentId, group);
  }
  for (const group of byAgent.values()) group.sort(byCreatedThenId);

  audit.acceptedFindingIds = sorted(accepted);
  audit.duplicateFindingIds = sorted(duplicates);
  audit.conflictingDuplicateIds = sorted(conflicts);
  audit.otherInvestigationFindingIds = sorted(other);
  audit.fusionFindingIdsIgnored = sorted(fusionIgnored);
  audit.futureFindingIds = sorted(future);
  return { byAgent, audit };
}

function auditLines(audit: FusionAudit, agents: AgentClassification[]): string[] {
  const lines: string[] = [];
  if (audit.duplicateFindingIds.length > 0) {
    lines.push(
      `[R1-dedupe] ${audit.duplicateFindingIds.length} finding id(s) were delivered more than once and applied once: ${audit.duplicateFindingIds.join(", ")}.`,
    );
  }
  if (audit.conflictingDuplicateIds.length > 0) {
    lines.push(
      `[R1-dedupe] Finding id(s) delivered with different content: ${audit.conflictingDuplicateIds.join(", ")}. One copy was chosen deterministically; the producer should be investigated.`,
    );
  }
  if (audit.invalidFindingCount > 0) {
    lines.push(`[R2-validate] ${audit.invalidFindingCount} malformed finding(s) were rejected.`);
  }
  if (audit.otherInvestigationFindingIds.length > 0) {
    lines.push(
      `[R2-validate] Ignored ${audit.otherInvestigationFindingIds.length} finding(s) belonging to another investigation.`,
    );
  }
  if (audit.fusionFindingIdsIgnored.length > 0) {
    lines.push(`[R2-validate] Ignored ${audit.fusionFindingIdsIgnored.length} finding(s) from the fusion agent itself.`);
  }
  if (audit.futureFindingIds.length > 0) {
    lines.push(`[R2-validate] Ignored ${audit.futureFindingIds.length} finding(s) created after the as-of time.`);
  }
  for (const agent of agents) {
    if (agent.supersededFindingIds.length > 0) {
      lines.push(
        `[R3-latest] ${agent.agentId}: using latest finding ${agent.findingId}; earlier finding(s) kept for audit: ${agent.supersededFindingIds.join(", ")}.`,
      );
    }
  }
  return lines;
}

function addId(target: FindingIdsByAgent, agentId: SourceAgentId, id: string | undefined) {
  if (id === undefined) return;
  target[agentId] = [...(target[agentId] ?? []), id];
}

/**
 * Fuse independent agents' findings into a review recommendation.
 * Pure apart from `deps.now()` (timestamp) and `deps.newId()` (fusion finding id).
 */
export function fuseFindings(input: FusionInput, deps: AgentDeps): FusionRecommendation {
  const { byAgent, audit } = normalise(input);

  const agents: AgentClassification[] = SOURCE_AGENTS.map((agentId) => {
    const group = byAgent.get(agentId) ?? [];
    const latest = group.at(-1);
    const result = classify({ agentId, latest, sourceState: input.sourceStates?.[agentId] });
    return {
      agentId,
      kind: result.kind,
      findingId: latest?.id,
      supersededFindingIds: group.slice(0, -1).map((f) => f.id),
      ruleId: result.ruleId,
      reason: result.reason,
    };
  });

  const supporting: FindingIdsByAgent = {};
  const contradicting: FindingIdsByAgent = {};
  const inconclusive: FindingIdsByAgent = {};
  const gaps: FusionGap[] = [];
  for (const agent of agents) {
    switch (agent.kind) {
      case "support":
      case "weak_signal":
      case "context_support":
        addId(supporting, agent.agentId, agent.findingId);
        break;
      case "contradiction":
        addId(contradicting, agent.agentId, agent.findingId);
        break;
      case "gap":
        gaps.push({ agentId: agent.agentId, reason: agent.reason });
        addId(inconclusive, agent.agentId, agent.findingId);
        break;
      case "inconclusive":
        addId(inconclusive, agent.agentId, agent.findingId);
        break;
    }
  }

  const ofKind = (kind: AgentClassification["kind"]) =>
    agents.filter((a) => a.kind === kind).map((a) => a.agentId);
  const independentSupporters = ofKind("support");
  const contradictors = ofKind("contradiction");
  const weakSignals = ofKind("weak_signal");
  const contextSupport = ofKind("context_support");

  // A contradiction needs DIRECT support on the other side. Tension with only a
  // weak signal or weather context is explained but not escalated.
  const contradictions: FusionContradiction[] =
    independentSupporters.length === 0
      ? []
      : contradictors.map((contradictor) => ({
          agents: [contradictor, ...independentSupporters].sort(),
          explanation: `${contradictor} contradicts support from ${independentSupporters.join(" + ")}. Not resolved automatically; a human reviewer must weigh it.`,
        }));

  const strength = strengthFor({
    independentSupporters,
    hasWeakSignal: weakSignals.length > 0,
    hasContextSupport: contextSupport.length > 0,
  });
  const decision = decide({
    strength: strength.strength,
    contradictionCount: contradictions.length,
    gapCount: gaps.length,
    sourceAgentCount: SOURCE_AGENTS.length,
  });

  const explanation: string[] = [
    "Decision support for human review only. This is not a fire confirmation and not an emergency alert.",
    ...auditLines(audit, agents),
    ...agents.map((a) => `[${a.ruleId}] ${a.reason}`),
  ];
  for (const c of contradictions) explanation.push(`[D1-contradiction] ${c.explanation}`);
  if (contradictions.length === 0 && contradictors.length > 0) {
    explanation.push(
      `[T1-tension] ${contradictors.join(" + ")} contradicts the report, but there is no independent support to weigh it against; recorded for review, not proof of no fire.`,
    );
  }
  explanation.push(`[${strength.ruleId}] ${strength.reason}`);
  explanation.push(`[${decision.ruleId}] ${decision.reason}`);
  if (gaps.length > 0) {
    explanation.push(
      `[G1-gaps] Data gaps: ${gaps.map((g) => g.agentId).join(", ")}. These remain unknown and are not counted against the report.`,
    );
  }

  const reasonCodes = [
    `fusion.status.${decision.status}`,
    `fusion.priority.${decision.priority}`,
    `fusion.strength.${strength.strength}`,
    ...(contradictions.length > 0 ? ["fusion.contradiction"] : []),
    ...gaps.map((g) => `fusion.gap.${g.agentId}`),
    `fusion.rule.${strength.ruleId}`,
    `fusion.rule.${decision.ruleId}`,
  ];

  const usedFindingIds = sorted(
    agents.flatMap((a) => (a.findingId === undefined ? [] : [a.findingId])),
  );

  const finding: AgentFinding = {
    id: deps.newId(),
    investigationId: input.investigationId,
    agentId: "fusion",
    createdAt: deps.now(),
    evidenceIds: usedFindingIds,
    // Fusion never asserts "contradicts": absence and weak evidence are not proof of no fire.
    assessment:
      contradictions.length === 0 && (strength.strength === "strong" || strength.strength === "moderate")
        ? "supports"
        : "inconclusive",
    reasonCodes,
    explanation: explanation.join("\n"),
    limitations: [...STANDARD_LIMITATIONS],
  };

  return {
    investigationId: input.investigationId,
    status: decision.status,
    reviewPriority: decision.priority,
    evidenceStrength: strength.strength,
    independentSupportCount: independentSupporters.length,
    supporting,
    contradicting,
    inconclusive,
    contradictions,
    gaps,
    agents,
    explanation,
    finding,
    audit,
    rulesVersion: FUSION_RULES_VERSION,
  };
}

/** The evaluation definition of "flagged for review": needs_human_review at high or medium priority. */
export function isFlaggedForReview(rec: Pick<FusionRecommendation, "status" | "reviewPriority">): boolean {
  return (
    rec.status === "needs_human_review" &&
    (rec.reviewPriority === "high" || rec.reviewPriority === "medium")
  );
}
