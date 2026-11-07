import { agentFindingSchema, type AgentDeps, type AgentFinding, type WitnessReport } from "../types";
import { haversineKm, isValidLatitude, isValidLongitude } from "./geo";
import { resolveWitnessOptions, type WitnessOptions } from "./options";
import {
  WITNESS_REASON_CODE_ORDER,
  WITNESS_REASON_CODES as CODES,
  type WitnessReasonCode,
} from "./reason-codes";
import { normaliseText, jaccard, trigrams } from "./text";
import type {
  WitnessAssessment,
  WitnessInvalidReport,
  WitnessLink,
  WitnessReportDisposition,
  WitnessSourceGroup,
} from "./types";

/** A report that passed validation, with parsed values cached. */
type Parsed = {
  report: WitnessReport;
  observedMs: number;
  submittedMs: number;
  /** Precision allowance in metres after capping. */
  precisionM: number;
  precisionCapped: boolean;
  photo: string | null;
  grams: Set<string> | null;
  sortKey: string;
};

const BASE_LIMITATIONS = [
  "Witness reports are unverified human claims; they may be mistaken, exaggerated or deliberately manipulated.",
  "Coordinates are approximate (privacy-reduced); spatial coherence allows for each report's stated location precision.",
  "Independence is inferred heuristically from reporter IDs, photo hashes and text similarity; coordinated accounts or re-encoded photos may not be detected.",
  "Distance and time thresholds are uncalibrated heuristics, and the outcome is not a probability.",
  "An absence of witness reports is not evidence that there is no fire.",
];

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Validate one report. Returns fixed problem strings (never echoes report
 * content, which is untrusted) or a parsed record.
 */
function parseReport(
  investigationId: string,
  report: WitnessReport,
  options: WitnessOptions,
): { ok: true; parsed: Parsed } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const r = report as Partial<Record<keyof WitnessReport, unknown>>;
  if (typeof r.id !== "string" || r.id.length === 0) problems.push("missing report id");
  if (typeof r.reporterId !== "string" || r.reporterId.length === 0)
    problems.push("missing reporter id");
  if (r.investigationId !== investigationId) problems.push("report belongs to a different investigation");
  const observedMs = typeof r.observedAt === "string" ? Date.parse(r.observedAt) : Number.NaN;
  const submittedMs = typeof r.submittedAt === "string" ? Date.parse(r.submittedAt) : Number.NaN;
  if (!Number.isFinite(observedMs)) problems.push("observedAt is not a valid timestamp");
  if (!Number.isFinite(submittedMs)) problems.push("submittedAt is not a valid timestamp");
  if (
    Number.isFinite(observedMs) &&
    Number.isFinite(submittedMs) &&
    observedMs - submittedMs > options.clockSkewToleranceMs
  ) {
    problems.push("observedAt is later than submittedAt beyond the clock-skew tolerance");
  }
  if (typeof r.latitude !== "number" || !isValidLatitude(r.latitude)) problems.push("latitude out of range");
  if (typeof r.longitude !== "number" || !isValidLongitude(r.longitude))
    problems.push("longitude out of range");
  if (
    typeof r.locationPrecisionM !== "number" ||
    !Number.isFinite(r.locationPrecisionM) ||
    r.locationPrecisionM < 0
  ) {
    problems.push("locationPrecisionM must be a non-negative number");
  }
  if (r.description !== undefined && typeof r.description !== "string")
    problems.push("description must be text");
  if (r.photoSha256 !== undefined && typeof r.photoSha256 !== "string")
    problems.push("photoSha256 must be text");
  if (problems.length > 0) return { ok: false, problems };

  const description = report.description ?? "";
  const normalised = normaliseText(description);
  const photo = report.photoSha256?.trim().toLowerCase() || null;
  const precisionCapped = report.locationPrecisionM > options.maxLocationPrecisionM;
  return {
    ok: true,
    parsed: {
      report,
      observedMs,
      submittedMs,
      precisionM: Math.min(report.locationPrecisionM, options.maxLocationPrecisionM),
      precisionCapped,
      photo,
      grams: normalised.length >= options.minTextLengthForSimilarity ? trigrams(normalised) : null,
      sortKey: JSON.stringify([
        report.reporterId,
        report.latitude,
        report.longitude,
        report.locationPrecisionM,
        description,
        photo,
      ]),
    },
  };
}

/** Total, stable order independent of input order. */
function compareParsed(a: Parsed, b: Parsed): number {
  return (
    a.observedMs - b.observedMs ||
    a.submittedMs - b.submittedMs ||
    compareStrings(a.report.id, b.report.id) ||
    compareStrings(a.sortKey, b.sortKey)
  );
}

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    // Smallest index becomes the root, keeping results deterministic.
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

type PairGeometry = { distanceKm: number; allowedKm: number; dtMs: number };

function geometry(a: Parsed, b: Parsed, options: WitnessOptions): PairGeometry {
  return {
    distanceKm: haversineKm(
      a.report.latitude,
      a.report.longitude,
      b.report.latitude,
      b.report.longitude,
    ),
    allowedKm: options.maxDistanceKm + (a.precisionM + b.precisionM) / 1000,
    dtMs: Math.abs(a.observedMs - b.observedMs),
  };
}

const isCoherent = (g: PairGeometry, options: WitnessOptions) =>
  g.dtMs <= options.maxTimeDifferenceMs && g.distanceKm <= g.allowedKm;

function orderReasonCodes(codes: Iterable<WitnessReasonCode>): WitnessReasonCode[] {
  const set = new Set(codes);
  return WITNESS_REASON_CODE_ORDER.filter((code) => set.has(code));
}

const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n} ${n === 1 ? singular : pluralForm}`;

/**
 * Deterministic witness-correlation validator.
 *
 * 1. Validates reports; invalid ones are listed with fixed problem strings.
 * 2. Links reports into source groups (union-find) when they share a reporter,
 *    a photo hash or near-identical text. Each group is ONE independent source.
 * 3. Picks the anchor report whose time/space neighbourhood contains the most
 *    distinct source groups (ties: more reports, then most central, then
 *    earliest). Reports incoherent with the anchor stay visible with
 *    `witness.temporal_incoherent` / `witness.spatial_incoherent`.
 * 4. Emits one `AgentFinding`: `supports` with 2+ coherent independent
 *    sources, otherwise `inconclusive`. Witnesses never `contradict`.
 *
 * The result does not depend on input order. Report text is untrusted: it is
 * only compared for similarity and never copied into the finding.
 */
export function assessWitnessReports(
  investigationId: string,
  reports: readonly WitnessReport[],
  deps: AgentDeps,
  options?: Partial<WitnessOptions>,
): WitnessAssessment {
  const opts = resolveWitnessOptions(options);

  // 1. Validate and order.
  const invalidReports: WitnessInvalidReport[] = [];
  const candidates: Parsed[] = [];
  for (const report of reports) {
    const result = parseReport(investigationId, report, opts);
    if (result.ok) candidates.push(result.parsed);
    else
      invalidReports.push({
        reportId: typeof report?.id === "string" ? report.id : "",
        reasonCodes: [CODES.invalidReport],
        problems: result.problems,
      });
  }
  candidates.sort(compareParsed);
  const valid: Parsed[] = [];
  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.report.id)) {
      invalidReports.push({
        reportId: candidate.report.id,
        reasonCodes: [CODES.invalidReport],
        problems: ["report id appears more than once"],
      });
      continue;
    }
    seenIds.add(candidate.report.id);
    valid.push(candidate);
  }
  invalidReports.sort(
    (a, b) =>
      compareStrings(a.reportId, b.reportId) ||
      compareStrings(a.problems.join("\n"), b.problems.join("\n")),
  );

  // 2. Source groups.
  const uf = new UnionFind(valid.length);
  const links: WitnessLink[] = [];
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const a = valid[i];
      const b = valid[j];
      const [idA, idB] = [a.report.id, b.report.id].sort(compareStrings);
      const pairLinks: WitnessLink[] = [];
      if (a.report.reporterId === b.report.reporterId)
        pairLinks.push({ a: idA, b: idB, kind: "same_reporter" });
      if (a.photo && a.photo === b.photo) pairLinks.push({ a: idA, b: idB, kind: "same_photo" });
      if (a.grams && b.grams) {
        const similarity = jaccard(a.grams, b.grams);
        if (similarity >= opts.textSimilarityThreshold)
          pairLinks.push({ a: idA, b: idB, kind: "similar_text", similarity: round(similarity, 3) });
      }
      if (pairLinks.length > 0) {
        uf.union(i, j);
        links.push(...pairLinks);
      }
    }
  }
  const groupRoot = valid.map((_, i) => uf.find(i));

  // 3. Anchor selection.
  let anchor = -1;
  let best = { groups: -1, reports: -1, spread: Number.POSITIVE_INFINITY };
  for (let i = 0; i < valid.length; i += 1) {
    const groups = new Set<number>();
    let count = 0;
    let spread = 0;
    for (let j = 0; j < valid.length; j += 1) {
      const g = geometry(valid[i], valid[j], opts);
      if (!isCoherent(g, opts)) continue;
      groups.add(groupRoot[j]);
      count += 1;
      spread += g.distanceKm;
    }
    const better =
      groups.size > best.groups ||
      (groups.size === best.groups && count > best.reports) ||
      (groups.size === best.groups && count === best.reports && spread < best.spread);
    if (better) {
      anchor = i;
      best = { groups: groups.size, reports: count, spread };
    }
  }

  const geometries = valid.map((p) => (anchor >= 0 ? geometry(valid[anchor], p, opts) : null));
  const coherent = geometries.map((g) => (g ? isCoherent(g, opts) : false));

  // Group membership in sorted order; representative = first coherent member.
  const members = new Map<number, number[]>();
  groupRoot.forEach((root, i) => members.set(root, [...(members.get(root) ?? []), i]));
  const groupInfo = [...members.values()].map((indices) => ({
    indices,
    representative: indices.find((i) => coherent[i]) ?? indices[0],
  }));
  groupInfo.sort((a, b) => a.representative - b.representative);
  const groupIdOf = new Map<number, string>();
  const representativeOf = new Map<number, number>();
  const sourceGroups: WitnessSourceGroup[] = groupInfo.map((info, n) => {
    const sourceGroupId = `witness-source-${n + 1}`;
    const ids = new Set(info.indices.map((i) => valid[i].report.id));
    for (const i of info.indices) {
      groupIdOf.set(i, sourceGroupId);
      representativeOf.set(i, info.representative);
    }
    return {
      sourceGroupId,
      representativeReportId: valid[info.representative].report.id,
      reportIds: info.indices.map((i) => valid[i].report.id),
      reporterIds: [...new Set(info.indices.map((i) => valid[i].report.reporterId))].sort(
        compareStrings,
      ),
      links: links.filter((link) => ids.has(link.a)),
      countsTowardCorroboration: info.indices.some((i) => coherent[i]),
    };
  });

  // 4. Per-report dispositions.
  const dispositions: WitnessReportDisposition[] = valid.map((p, i) => {
    const representative = representativeOf.get(i) ?? i;
    const group = members.get(groupRoot[i]) ?? [i];
    let role: WitnessReportDisposition["role"] = "primary";
    if (representative !== i) {
      const sameReporterEarlier = group.some(
        (k) =>
          k !== i &&
          (k < i || k === representative) &&
          valid[k].report.reporterId === p.report.reporterId,
      );
      role = sameReporterEarlier ? "duplicate_submission" : "shared_origin";
    }
    const g = geometries[i] as PairGeometry;
    const codes: WitnessReasonCode[] = [];
    if (role === "duplicate_submission") codes.push(CODES.duplicateSubmission);
    if (role === "shared_origin") codes.push(CODES.sharedOrigin);
    if (g.dtMs > opts.maxTimeDifferenceMs) codes.push(CODES.temporalIncoherent);
    if (g.distanceKm > g.allowedKm) codes.push(CODES.spatialIncoherent);
    return {
      reportId: p.report.id,
      reporterId: p.report.reporterId,
      sourceGroupId: groupIdOf.get(i) ?? "",
      role,
      coherent: coherent[i],
      distanceFromAnchorKm: round(g.distanceKm, 2),
      minutesFromAnchor: Math.round(g.dtMs / 60_000),
      allowedDistanceKm: round(g.allowedKm, 2),
      reasonCodes: codes,
    };
  });

  // 5. Finding.
  const effectiveIndependentCount = sourceGroups.filter((g) => g.countsTowardCorroboration).length;
  const duplicates = dispositions.filter((d) => d.role === "duplicate_submission").length;
  const sharedOrigin = dispositions.filter((d) => d.role === "shared_origin").length;
  const temporal = dispositions.filter((d) => d.reasonCodes.includes(CODES.temporalIncoherent)).length;
  const spatial = dispositions.filter((d) => d.reasonCodes.includes(CODES.spatialIncoherent)).length;
  const outliers = dispositions.filter((d) => !d.coherent).length;

  const findingCodes: WitnessReasonCode[] = [];
  if (valid.length === 0) findingCodes.push(CODES.noReports);
  else if (effectiveIndependentCount >= 2) findingCodes.push(CODES.independentCorroboration);
  else findingCodes.push(CODES.singleReport);
  for (const d of dispositions) findingCodes.push(...d.reasonCodes);
  if (invalidReports.length > 0) findingCodes.push(CODES.invalidReport);

  const window = `${opts.maxDistanceKm} km (plus stated location precision) and ${round(
    opts.maxTimeDifferenceMs / 3_600_000,
    2,
  )} h`;
  const parts: string[] = [];
  if (valid.length === 0) {
    parts.push(
      "No valid witness reports are available, so witness evidence is unknown (a data gap, not evidence of absence).",
    );
  } else if (effectiveIndependentCount >= 2) {
    parts.push(
      `${effectiveIndependentCount} apparently independent witness sources describe observations coherent within ${window}.`,
    );
  } else {
    parts.push(
      `Only one independent witness source is coherent within ${window}; this is not corroboration.`,
    );
  }
  if (valid.length > 0) {
    parts.push(`${plural(valid.length, "valid report")} considered.`);
    const notes: string[] = [];
    if (duplicates > 0)
      notes.push(`${plural(duplicates, "repeat submission")} from the same reporter not counted again`);
    if (sharedOrigin > 0)
      notes.push(
        `${plural(sharedOrigin, "report")} sharing a photo or near-identical text counted with its original source`,
      );
    if (outliers > 0)
      notes.push(
        `${plural(outliers, "report")} outside the window (${temporal} in time, ${spatial} in space) kept visible but excluded from corroboration`,
      );
    if (notes.length > 0) parts.push(`${notes.join("; ")}.`);
  }
  if (invalidReports.length > 0)
    parts.push(`${plural(invalidReports.length, "report")} failed validation and ${invalidReports.length === 1 ? "was" : "were"} excluded.`);
  parts.push("Witness evidence is unverified and is offered for human review only.");

  const limitations = [...BASE_LIMITATIONS];
  if (valid.some((p) => p.precisionCapped))
    limitations.push(
      `Some reports state a location precision above ${opts.maxLocationPrecisionM} m; the allowance was capped, so they may be wrongly treated as distant.`,
    );
  if (invalidReports.length > 0)
    limitations.push("Reports that failed validation were excluded from correlation.");

  const finding: AgentFinding = agentFindingSchema.parse({
    id: deps.newId(),
    investigationId,
    agentId: "witness",
    createdAt: deps.now(),
    evidenceIds: valid.map((p) => p.report.id),
    assessment: effectiveIndependentCount >= 2 ? "supports" : "inconclusive",
    reasonCodes: orderReasonCodes(findingCodes),
    explanation: parts.join(" "),
    limitations,
  });

  return {
    finding,
    anchorReportId: anchor >= 0 ? valid[anchor].report.id : null,
    effectiveIndependentCount,
    sourceGroups,
    reports: dispositions,
    invalidReports,
    options: opts,
  };
}
