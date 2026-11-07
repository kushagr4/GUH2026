import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError, type DbResult } from "@/lib/db/result";
import {
  agentEventSchema,
  agentFindingSchema,
  classifyFreshness,
  investigationSchema,
  MAP_MAX_LIMIT,
  observationSchema,
  REPORT_MEDIA_BUCKET,
  reportViewSchema,
  SOURCE_MAX_AGE_SECONDS,
  type AgentEvent,
  type AgentFinding,
  type Bbox,
  type Investigation,
  type InvestigationDetailResponse,
  type InvestigationStatus,
  type InvestigationSummary,
  type MapFeature,
  type MediaView,
  type Observation,
  type Provenance,
  type ReportMediaMimeType,
  type ReportSubmissionRequest,
  type ReportView,
  type SourceAvailability,
  type SourceKind,
} from "@/lib/embergap/contracts";
import type { Database, TablesInsert } from "@/lib/supabase/database.types";

/**
 * EmberGap data access. Every function takes the caller's own Supabase client,
 * so RLS decides what is visible; nothing here uses the service role. Read
 * models never select owner_id, so reporter identity never leaves the database.
 */
export type EmbergapClient = SupabaseClient<Database>;

/** Who is asking. Build it with getEmbergapViewer() in a route or Server Component. */
export type EmbergapViewer = { userId: string; isReviewer: boolean };

/** Postgres returns "+00:00"; the contracts use "Z". */
function toIso(value: string): string;
function toIso(value: string | null): string | null;
function toIso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Writes: report submission                                                  */
/* -------------------------------------------------------------------------- */

export async function insertReportMedia(
  client: EmbergapClient,
  media: { id: string; objectPath: string; mimeType: ReportMediaMimeType; sizeBytes: number },
): Promise<DbResult<{ id: string }>> {
  const { error } = await client.from("report_media").insert({
    id: media.id,
    object_path: media.objectPath,
    mime_type: media.mimeType,
    size_bytes: media.sizeBytes,
  });
  if (!error) return { ok: true, data: { id: media.id } };
  if (error.code === "23505") {
    // A retry of the same submission. RLS shows the row only if it is ours.
    const existing = await client.from("report_media").select("id").eq("id", media.id).maybeSingle();
    if (existing.data) return { ok: true, data: { id: media.id } };
    return { ok: false, error: toDbError({ code: "42501" }) };
  }
  return { ok: false, error: toDbError(error) };
}

export type CreatedReport = {
  reportId: string;
  investigationId: string;
  investigationStatus: InvestigationStatus;
  mediaId: string | null;
  submittedAt: string;
  replayed: boolean;
};

const REPORT_RETURNING = "id, investigation_id, created_at, media_id";

/**
 * Inserts the report. A trigger opens the investigation and records the
 * report_submitted event in the same statement. Retrying with the same
 * clientRequestId returns the original report with `replayed: true`.
 */
export async function createReport(
  client: EmbergapClient,
  userId: string,
  input: ReportSubmissionRequest,
): Promise<DbResult<CreatedReport>> {
  // investigation_id is set by the trigger; reporters have no grant to set it.
  const row: Omit<TablesInsert<"reports">, "investigation_id"> = {
    client_request_id: input.clientRequestId,
    observed_at: input.observedAt,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    location_uncertainty_m: input.location.uncertaintyMeters,
    description: input.description,
    media_id: input.media?.mediaId ?? null,
  };
  const { data, error } = await client
    .from("reports")
    .insert(row as TablesInsert<"reports">)
    .select(REPORT_RETURNING)
    .single();

  if (data) {
    return {
      ok: true,
      data: {
        reportId: data.id,
        investigationId: data.investigation_id,
        investigationStatus: "unreviewed",
        mediaId: data.media_id,
        submittedAt: toIso(data.created_at),
        replayed: false,
      },
    };
  }

  if (error?.code === "23505" && error.message.includes("reports_owner_request_unique")) {
    const existing = await client
      .from("reports")
      .select(REPORT_RETURNING)
      .eq("owner_id", userId)
      .eq("client_request_id", input.clientRequestId)
      .maybeSingle();
    if (!existing.data) return { ok: false, error: toDbError(existing.error ?? { code: "PGRST116" }) };
    const investigation = await client
      .from("investigations")
      .select("status")
      .eq("id", existing.data.investigation_id)
      .maybeSingle();
    return {
      ok: true,
      data: {
        reportId: existing.data.id,
        investigationId: existing.data.investigation_id,
        investigationStatus: (investigation.data?.status ?? "unreviewed") as InvestigationStatus,
        mediaId: existing.data.media_id,
        submittedAt: toIso(existing.data.created_at),
        replayed: true,
      },
    };
  }

  if (error?.code === "23505") {
    return { ok: false, error: { kind: "conflict", message: "That photo is already attached to another report.", code: error.code } };
  }
  return { ok: false, error: toDbError(error ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Reads: map and investigation projections                                   */
/* -------------------------------------------------------------------------- */

const INVESTIGATION_COLUMNS =
  "id, status, review_priority, public_latitude, public_longitude, public_precision_m, report_count, sources, latest_evidence_at, review_outcome, review_note, reviewed_at, is_synthetic, synthetic_scenario_id, opened_at, updated_at";

type InvestigationRow = Pick<
  Database["public"]["Tables"]["investigations"]["Row"],
  | "id"
  | "status"
  | "review_priority"
  | "public_latitude"
  | "public_longitude"
  | "public_precision_m"
  | "report_count"
  | "sources"
  | "latest_evidence_at"
  | "review_outcome"
  | "review_note"
  | "reviewed_at"
  | "is_synthetic"
  | "synthetic_scenario_id"
  | "opened_at"
  | "updated_at"
>;

export const REPORTER_PROVENANCE: Provenance = {
  provider: "EmberGap reporters",
  product: null,
  url: null,
  license: null,
  isSynthetic: false,
};

export const SYNTHETIC_PROVENANCE: Provenance = {
  provider: "EmberGap synthetic fixtures",
  product: null,
  url: null,
  license: null,
  isSynthetic: true,
};

function toSummary(row: InvestigationRow): InvestigationSummary {
  return {
    id: row.id,
    status: row.status as InvestigationStatus,
    reviewPriority: row.review_priority as Investigation["reviewPriority"],
    location: {
      latitude: Number(row.public_latitude),
      longitude: Number(row.public_longitude),
      precisionMeters: row.public_precision_m,
    },
    openedAt: toIso(row.opened_at),
    updatedAt: toIso(row.updated_at),
    latestEvidenceAt: toIso(row.latest_evidence_at),
    reportCount: row.report_count,
    sources: row.sources as SourceKind[],
    isSynthetic: row.is_synthetic,
    syntheticScenarioId: row.synthetic_scenario_id,
  };
}

function toInvestigation(row: InvestigationRow): Investigation {
  return {
    ...toSummary(row),
    reviewOutcome: row.review_outcome as Investigation["reviewOutcome"],
    reviewedAt: toIso(row.reviewed_at),
    reviewNote: row.review_note,
  };
}

/** One investigation as a map marker: coarse location, no reporter, text or photo. */
export function toMapFeature(investigation: InvestigationSummary, now = new Date().toISOString()): MapFeature {
  return {
    id: investigation.id,
    kind: "investigation",
    location: investigation.location,
    investigationId: investigation.id,
    status: investigation.status,
    reviewPriority: investigation.reviewPriority,
    observedAt: investigation.latestEvidenceAt,
    freshness: classifyFreshness({
      latestObservedAt: investigation.latestEvidenceAt,
      checkedAt: now,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.human,
    }),
    sources: investigation.sources,
    provenance: investigation.isSynthetic ? SYNTHETIC_PROVENANCE : REPORTER_PROVENANCE,
  };
}

export type InvestigationList = { investigations: InvestigationSummary[]; truncated: boolean };

/**
 * Investigations the caller may see inside `bbox` (or anywhere), most recently
 * updated first. Never more than `limit`, which is capped at MAP_MAX_LIMIT.
 */
export async function listInvestigations(
  client: EmbergapClient,
  query: { bbox: Bbox | null; limit: number },
): Promise<DbResult<InvestigationList>> {
  const limit = Math.min(Math.max(1, Math.trunc(query.limit) || 1), MAP_MAX_LIMIT);
  let request = client.from("investigations").select(INVESTIGATION_COLUMNS);
  if (query.bbox) {
    request = request
      .gte("public_latitude", query.bbox.minLatitude)
      .lte("public_latitude", query.bbox.maxLatitude)
      .gte("public_longitude", query.bbox.minLongitude)
      .lte("public_longitude", query.bbox.maxLongitude);
  }
  const { data, error } = await request.order("updated_at", { ascending: false }).order("id").limit(limit + 1);
  if (error) return { ok: false, error: toDbError(error) };
  const rows = data ?? [];
  return {
    ok: true,
    data: {
      investigations: rows.slice(0, limit).map(toSummary),
      truncated: rows.length > limit,
    },
  };
}

/** The same list as map markers, ready for GET /api/embergap/map. */
export async function listMapInvestigations(
  client: EmbergapClient,
  query: { bbox: Bbox | null; limit: number },
): Promise<DbResult<{ features: MapFeature[]; truncated: boolean }>> {
  const result = await listInvestigations(client, query);
  if (!result.ok) return result;
  const now = new Date().toISOString();
  return {
    ok: true,
    data: {
      features: result.data.investigations.map((investigation) => toMapFeature(investigation, now)),
      truncated: result.data.truncated,
    },
  };
}

const DETAIL_LIMIT = 200;
const MEDIA_URL_SECONDS = 300;

function availabilityFor(
  source: SourceKind,
  observations: Observation[],
  now: string,
): SourceAvailability | null {
  const own = observations.filter((observation) => observation.source === source);
  if (own.length === 0) return null;
  const newest = own.reduce((a, b) => (a.retrievedAt >= b.retrievedAt ? a : b));
  const observedTimes = own.map((observation) => observation.observedAt).filter((time): time is string => time !== null);
  const latestObservedAt = observedTimes.length ? observedTimes.reduce((a, b) => (a >= b ? a : b)) : null;
  const maxAgeSeconds = SOURCE_MAX_AGE_SECONDS[source];
  const state =
    newest.sourceState === "unavailable" || newest.sourceState === "not_observed"
      ? newest.sourceState
      : classifyFreshness({ latestObservedAt, checkedAt: now, maxAgeSeconds });
  return { source, state, checkedAt: newest.retrievedAt, latestObservedAt, maxAgeSeconds, message: null };
}

/**
 * Everything the caller may see about one investigation, or not_found if RLS
 * hides it. Rows that fail their contract are left out rather than breaking
 * the page, so one bad worker write can't take the dashboard down.
 */
export async function getInvestigationDetail(
  client: EmbergapClient,
  viewer: EmbergapViewer,
  investigationId: string,
): Promise<DbResult<InvestigationDetailResponse>> {
  const [investigationResult, reportsResult, observationsResult, findingsResult, eventsResult] = await Promise.all([
    client.from("investigations").select(INVESTIGATION_COLUMNS).eq("id", investigationId).maybeSingle(),
    client
      .from("reports")
      .select(
        "id, investigation_id, observed_at, created_at, description, latitude, longitude, location_uncertainty_m, media_id, is_synthetic",
      )
      .eq("investigation_id", investigationId)
      .order("created_at")
      .limit(50),
    client
      .from("observations")
      .select(
        "id, investigation_id, source, source_record_id, source_state, observed_at, retrieved_at, latitude, longitude, coverage, evidence, provenance, is_synthetic",
      )
      .eq("investigation_id", investigationId)
      .order("recorded_at", { ascending: false })
      .limit(DETAIL_LIMIT),
    client
      .from("agent_findings")
      .select(
        "id, investigation_id, agent_id, created_at, evidence_ids, assessment, strength, reason_codes, explanation, limitations, recommendation, is_synthetic",
      )
      .eq("investigation_id", investigationId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_LIMIT),
    client
      .from("agent_events")
      .select(
        "id, investigation_id, type, actor, occurred_at, recorded_at, idempotency_key, message_id, summary, details, is_synthetic",
      )
      .eq("investigation_id", investigationId)
      .order("occurred_at", { ascending: false })
      .limit(DETAIL_LIMIT),
  ]);

  const failure = [investigationResult, reportsResult, observationsResult, findingsResult, eventsResult].find(
    (result) => result.error,
  );
  if (failure?.error) return { ok: false, error: toDbError(failure.error) };
  if (!investigationResult.data) return { ok: false, error: toDbError({ code: "PGRST116" }) };

  const investigation = investigationSchema.safeParse(toInvestigation(investigationResult.data));
  if (!investigation.success) return { ok: false, error: toDbError({}) };

  const reportRows = reportsResult.data ?? [];
  const reports: ReportView[] = reportRows.flatMap((row) => {
    const parsed = reportViewSchema.safeParse({
      id: row.id,
      investigationId: row.investigation_id,
      observedAt: toIso(row.observed_at),
      submittedAt: toIso(row.created_at),
      description: row.description,
      location: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        uncertaintyMeters: row.location_uncertainty_m,
      },
      mediaIds: row.media_id ? [row.media_id] : [],
      verification: investigation.data.status === "reviewed" ? "reviewed" : "unverified",
      isSynthetic: row.is_synthetic,
    });
    return parsed.success ? [parsed.data] : [];
  });

  const media = await loadMediaViews(client, reportRows);

  const observations: Observation[] = (observationsResult.data ?? []).flatMap((row) => {
    const parsed = observationSchema.safeParse({
      id: row.id,
      investigationId: row.investigation_id,
      source: row.source,
      sourceRecordId: row.source_record_id,
      observedAt: toIso(row.observed_at),
      retrievedAt: toIso(row.retrieved_at),
      location: row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
      coverage: row.coverage,
      sourceState: row.source_state,
      provenance: row.provenance,
      evidence: row.evidence,
    });
    return parsed.success ? [parsed.data] : [];
  });

  const findings: AgentFinding[] = (findingsResult.data ?? []).flatMap((row) => {
    const parsed = agentFindingSchema.safeParse({
      id: row.id,
      investigationId: row.investigation_id,
      agentId: row.agent_id,
      createdAt: toIso(row.created_at),
      evidenceIds: row.evidence_ids,
      assessment: row.assessment,
      strength: row.strength,
      reasonCodes: row.reason_codes,
      explanation: row.explanation,
      limitations: row.limitations,
      recommendation: row.recommendation,
      isSynthetic: row.is_synthetic,
    });
    return parsed.success ? [parsed.data] : [];
  });

  const events: AgentEvent[] = (eventsResult.data ?? []).flatMap((row) => {
    const parsed = agentEventSchema.safeParse({
      id: row.id,
      investigationId: row.investigation_id,
      type: row.type,
      actor: row.actor,
      occurredAt: toIso(row.occurred_at),
      recordedAt: toIso(row.recorded_at),
      idempotencyKey: row.idempotency_key,
      messageId: row.message_id,
      summary: row.summary,
      details: row.details,
      isSynthetic: row.is_synthetic,
    });
    return parsed.success ? [parsed.data] : [];
  });

  const now = new Date().toISOString();
  const sourceAvailability = (["firms", "weather", "eonet", "vision"] as const)
    .map((source) => availabilityFor(source, observations, now))
    .filter((entry): entry is SourceAvailability => entry !== null);
  if (reports.length > 0) {
    const latestObservedAt = reports.map((report) => report.observedAt).reduce((a, b) => (a >= b ? a : b));
    sourceAvailability.unshift({
      source: "human",
      state: classifyFreshness({ latestObservedAt, checkedAt: now, maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.human }),
      checkedAt: now,
      latestObservedAt,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.human,
      message: null,
    });
  }

  return {
    ok: true,
    data: {
      investigation: investigation.data,
      viewerAccess: investigation.data.isSynthetic ? "synthetic" : viewer.isReviewer ? "reviewer" : "reporter",
      reports,
      media,
      observations,
      findings,
      events,
      sourceAvailability,
      generatedAt: now,
    },
  };
}

/** Short-lived signed URLs for the photos this viewer may see. Storage RLS decides. */
async function loadMediaViews(
  client: EmbergapClient,
  reportRows: { id: string; media_id: string | null }[],
): Promise<MediaView[]> {
  const byMedia = new Map(reportRows.filter((row) => row.media_id).map((row) => [row.media_id as string, row.id]));
  if (byMedia.size === 0) return [];
  const { data: rows } = await client
    .from("report_media")
    .select("id, object_path, mime_type, size_bytes, is_synthetic")
    .in("id", [...byMedia.keys()]);
  if (!rows?.length) return [];
  const { data: signed } = await client.storage
    .from(REPORT_MEDIA_BUCKET)
    .createSignedUrls(rows.map((row) => row.object_path), MEDIA_URL_SECONDS);
  const expiresAt = new Date(Date.now() + MEDIA_URL_SECONDS * 1_000).toISOString();
  return rows.map((row) => {
    const url = signed?.find((entry) => entry.path === row.object_path && !entry.error)?.signedUrl ?? null;
    return {
      id: row.id,
      reportId: byMedia.get(row.id) as string,
      mimeType: row.mime_type as ReportMediaMimeType,
      sizeBytes: row.size_bytes,
      url,
      urlExpiresAt: url ? expiresAt : null,
      isSynthetic: row.is_synthetic,
    };
  });
}
