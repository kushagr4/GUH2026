import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  agentEventSchema,
  agentFindingSchema,
  agentReportSchema,
  observationSchema,
  REPORT_MEDIA_BUCKET,
  toPublicLocation,
  type AgentEvent,
  type AgentFinding,
  type AgentReport,
  type EmberGapRuntimeStore,
  type Id,
  type Observation,
  type PublicLocation,
  type ReportMediaMimeType,
  type SyntheticScenarioId,
} from "@/lib/embergap/contracts";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server-side plumbing for the agent runtime (Claude PC) and validators
 * (Danil). Workers have no user session, so these take a service-role client:
 * createAdminClient() from @/lib/supabase/admin. Never call them from a route
 * that a browser can reach with arbitrary input.
 */
type AdminClient = SupabaseClient<Database>;

export class RuntimeStoreError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
  ) {
    super(`EmberGap runtime store: ${operation} failed${code ? ` (${code})` : ""}.`);
    this.name = "RuntimeStoreError";
  }
}

/**
 * EmberGapRuntimeStore over Supabase. Every write is idempotent: a redelivered
 * event (same investigation and idempotencyKey), observation or finding (same
 * id) is ignored. Inputs are validated against the contracts first, so a buggy
 * worker can't store a finding that breaks the scientific rules.
 */
export function createSupabaseRuntimeStore(admin: AdminClient): EmberGapRuntimeStore {
  return {
    async appendEvents(events: AgentEvent[]) {
      if (events.length === 0) return;
      const rows = events.map((input) => {
        const event = agentEventSchema.parse(input);
        return {
          id: event.id,
          investigation_id: event.investigationId,
          type: event.type,
          actor: event.actor,
          occurred_at: event.occurredAt,
          recorded_at: event.recordedAt,
          idempotency_key: event.idempotencyKey,
          message_id: event.messageId,
          summary: event.summary,
          details: event.details as Database["public"]["Tables"]["agent_events"]["Insert"]["details"],
          is_synthetic: event.isSynthetic,
        };
      });
      const { error } = await admin
        .from("agent_events")
        .upsert(rows, { onConflict: "investigation_id,idempotency_key", ignoreDuplicates: true });
      if (error) throw new RuntimeStoreError("appendEvents", error.code);
    },

    async saveObservations(observations: Observation[]) {
      if (observations.length === 0) return;
      const rows = observations.map((input) => {
        const observation = observationSchema.parse(input);
        return {
          id: observation.id,
          investigation_id: observation.investigationId,
          source: observation.source,
          source_record_id: observation.sourceRecordId,
          source_state: observation.sourceState,
          observed_at: observation.observedAt,
          retrieved_at: observation.retrievedAt,
          latitude: observation.location?.latitude ?? null,
          longitude: observation.location?.longitude ?? null,
          coverage: observation.coverage,
          evidence: observation.evidence as Database["public"]["Tables"]["observations"]["Insert"]["evidence"],
          provenance: observation.provenance,
          is_synthetic: observation.provenance.isSynthetic,
        };
      });
      const { error } = await admin.from("observations").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new RuntimeStoreError("saveObservations", error.code);
    },

    async saveFinding(input: AgentFinding) {
      const finding = agentFindingSchema.parse(input);
      const { error } = await admin.from("agent_findings").upsert(
        {
          id: finding.id,
          investigation_id: finding.investigationId,
          report_id: finding.reportId,
          agent_id: finding.agentId,
          created_at: finding.createdAt,
          evidence_ids: finding.evidenceIds,
          assessment: finding.assessment,
          strength: finding.strength,
          reason_codes: finding.reasonCodes,
          explanation: finding.explanation,
          limitations: finding.limitations,
          limitation_notes: finding.limitationNotes,
          recommendation: finding.recommendation,
          is_synthetic: finding.isSynthetic,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new RuntimeStoreError("saveFinding", error.code);
    },

    async setAutomatedStatus(investigationId, status, reviewPriority) {
      // Software never changes a reviewed investigation.
      const { error } = await admin
        .from("investigations")
        .update({ status, review_priority: reviewPriority })
        .eq("id", investigationId)
        .neq("status", "reviewed");
      if (error) throw new RuntimeStoreError("setAutomatedStatus", error.code);
    },
  };
}

/**
 * An opaque, stable key per reporter account, so the witness agent can tell one
 * person reporting twice from two people. It is not the auth user ID and can't
 * be reversed into one without already knowing it. Synthetic reports share one
 * key per investigation (the repeated-witness scenario is one person).
 */
export function reporterKeyFor(ownerId: string | null, investigationId: string): string {
  const seed = ownerId ? `reporter:${ownerId}` : `synthetic-reporter:${investigationId}`;
  const hex = createHash("sha256").update(`embergap:${seed}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const head = hex.slice(0, 8).replace(/^0/, "1"); // never looks synthetic
  return `${head}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The reports of one investigation, as vision and witness agents receive them. Oldest first, at most 50. */
export async function loadAgentReports(admin: AdminClient, investigationId: Id): Promise<AgentReport[]> {
  const { data: rows, error } = await admin
    .from("reports")
    .select(
      "id, investigation_id, owner_id, observed_at, created_at, description, latitude, longitude, location_uncertainty_m, media_id, is_synthetic",
    )
    .eq("investigation_id", investigationId)
    .order("created_at")
    .limit(50);
  if (error) throw new RuntimeStoreError("loadAgentReports", error.code);
  if (!rows?.length) return [];

  const mediaIds = rows.map((row) => row.media_id).filter((id): id is string => id !== null);
  const media = new Map<string, { mimeType: ReportMediaMimeType; sha256: string | null }>();
  if (mediaIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await admin
      .from("report_media")
      .select("id, mime_type, sha256")
      .in("id", mediaIds);
    if (mediaError) throw new RuntimeStoreError("loadAgentReports", mediaError.code);
    for (const row of mediaRows ?? []) {
      media.set(row.id, { mimeType: row.mime_type as ReportMediaMimeType, sha256: row.sha256 });
    }
  }

  return rows.map((row) => {
    const photo = row.media_id ? media.get(row.media_id) : undefined;
    return agentReportSchema.parse({
      id: row.id,
      investigationId: row.investigation_id,
      observedAt: row.observed_at,
      submittedAt: row.created_at,
      description: row.description,
      location: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        uncertaintyMeters: row.location_uncertainty_m,
      },
      reporterKey: reporterKeyFor(row.owner_id, row.investigation_id),
      media: row.media_id && photo ? { mediaId: row.media_id, mimeType: photo.mimeType, sha256: photo.sha256 } : null,
      isSynthetic: row.is_synthetic,
    });
  });
}

/** The coarse "where and when" for a task_assigned message about a report. */
export function taskSubjectFor(
  report: AgentReport,
  syntheticScenarioId: SyntheticScenarioId | null,
): { location: PublicLocation; observedAt: string; syntheticScenarioId: SyntheticScenarioId | null } {
  return { location: toPublicLocation(report.location), observedAt: report.observedAt, syntheticScenarioId };
}

/** The bytes of a report photo, for the vision agent. Null if it is missing. */
export async function loadReportImage(
  admin: AdminClient,
  mediaId: Id,
): Promise<{ mimeType: ReportMediaMimeType; bytes: Uint8Array } | null> {
  const { data: row } = await admin.from("report_media").select("object_path, mime_type").eq("id", mediaId).maybeSingle();
  if (!row) return null;
  const { data, error } = await admin.storage.from(REPORT_MEDIA_BUCKET).download(row.object_path);
  if (error || !data) return null;
  return { mimeType: row.mime_type as ReportMediaMimeType, bytes: new Uint8Array(await data.arrayBuffer()) };
}
