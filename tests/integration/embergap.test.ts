import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitReport } from "@/features/embergap/submit";
import { getInvestigationDetail, listMapInvestigations } from "@/features/embergap/repository";
import {
  investigationDetailResponseSchema,
  mapFeatureSchema,
  REPORT_MEDIA_BUCKET,
  reportMediaObjectPath,
  reportSubmissionRequestSchema,
  SYNTHETIC_SCENARIOS,
  VISION_REQUIRED_LIMITATIONS,
} from "@/lib/embergap/contracts";
import { readTestEnv } from "../support/test-env";
import {
  cleanupTestUser,
  createAdmin,
  createAnon,
  createTestUser,
  type TestClient,
  type TestUser,
} from "../support/test-users";

const env = readTestEnv();

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xd9,
]);
const EXIF_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0e, ...ascii("Exif"), 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0xff, 0xd9,
]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...ascii("IEND"), 0, 0, 0, 0]);

const TABLES = ["reports", "report_media", "investigations", "observations", "agent_findings", "agent_events"] as const;
const PEAK_DISTRICT = { minLongitude: -2.7, minLatitude: 53.3, maxLongitude: -1.7, maxLatitude: 54 };

function reportInput(overrides: Record<string, unknown> = {}) {
  return reportSubmissionRequestSchema.parse({
    clientRequestId: crypto.randomUUID(),
    observedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    location: { latitude: 53.4808, longitude: -2.2426, uncertaintyMeters: 500 },
    description: "Integration test: grey smoke over the hills to the east.",
    ...overrides,
  });
}

async function upload(client: TestClient, path: string, bytes: Uint8Array<ArrayBuffer>, contentType = "image/jpeg") {
  return client.storage.from(REPORT_MEDIA_BUCKET).upload(path, new Blob([bytes], { type: contentType }), {
    contentType,
    upsert: false,
  });
}

describe.skipIf(!env)("EmberGap reports, RLS and private photos", () => {
  let alice: TestUser;
  let bob: TestUser;
  let anon: TestClient;
  let aliceReport: { reportId: string; investigationId: string };

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createTestUser(env!), createTestUser(env!)]);
    anon = createAnon(env!);
    const result = await submitReport(alice.client, alice.id, reportInput());
    if (!result.ok) throw new Error(`Could not create the shared report: ${JSON.stringify(result)}`);
    aliceReport = result.data;
  });

  afterAll(async () => {
    await Promise.all([alice && cleanupTestUser(env!, alice), bob && cleanupTestUser(env!, bob)]);
  });

  it("refuses anonymous access to every EmberGap table", async () => {
    for (const table of TABLES) {
      const { error } = await anon.from(table).select("id").limit(1);
      expect(error?.code, table).toBe("42501");
    }
  });

  it("opens an unreviewed investigation with exactly one event, at coarse precision", async () => {
    const { data: investigation } = await alice.client
      .from("investigations")
      .select("status, report_count, sources, public_latitude, public_longitude, public_precision_m")
      .eq("id", aliceReport.investigationId)
      .single();
    expect(investigation).toEqual({
      status: "unreviewed",
      report_count: 1,
      sources: ["human"],
      public_latitude: 53.48,
      public_longitude: -2.24,
      public_precision_m: 1000,
    });

    const { data: stored } = await alice.client.from("reports").select("latitude, longitude").eq("id", aliceReport.reportId).single();
    expect(stored).toEqual({ latitude: 53.481, longitude: -2.243 });

    const { data: events } = await alice.client
      .from("agent_events")
      .select("type, actor, idempotency_key")
      .eq("investigation_id", aliceReport.investigationId);
    expect(events).toEqual([
      { type: "report_submitted", actor: "reporter", idempotency_key: `report_submitted:${aliceReport.reportId}` },
    ]);
  });

  it("replays a retried submission instead of duplicating it", async () => {
    const input = reportInput();
    const first = await submitReport(alice.client, alice.id, input);
    const again = await submitReport(alice.client, alice.id, input);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.data).toMatchObject({
      reportId: first.data.reportId,
      investigationId: first.data.investigationId,
      replayed: true,
    });
    const { count } = await alice.client
      .from("agent_events")
      .select("id", { count: "exact", head: true })
      .eq("investigation_id", first.data.investigationId);
    expect(count).toBe(1);
  });

  it("hides one reporter's reports and investigations from another, but shares synthetic data", async () => {
    const reports = await bob.client.from("reports").select("id").eq("id", aliceReport.reportId);
    const investigations = await bob.client.from("investigations").select("id").eq("id", aliceReport.investigationId);
    for (const result of [reports, investigations]) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    const { data: events } = await bob.client.from("agent_events").select("id").eq("investigation_id", aliceReport.investigationId);
    expect(events).toEqual([]);

    const { data: synthetic } = await bob.client.from("investigations").select("synthetic_scenario_id").eq("is_synthetic", true);
    expect(synthetic?.map((row) => row.synthetic_scenario_id).sort()).toEqual(
      SYNTHETIC_SCENARIOS.map((scenario) => scenario.id).sort(),
    );
  });

  it("never lets a reporter write investigations, observations, findings or events", async () => {
    const id = crypto.randomUUID();
    const attempts = [
      alice.client.from("investigations").insert({ public_latitude: 1, public_longitude: 1, public_precision_m: 1000 }),
      alice.client.from("observations").insert({
        investigation_id: aliceReport.investigationId,
        source: "firms",
        source_state: "unavailable",
        provenance: {},
      }),
      alice.client.from("agent_findings").insert({
        id,
        investigation_id: aliceReport.investigationId,
        agent_id: "fusion",
        assessment: "supports",
        reason_codes: ["fake"],
        explanation: "Confirmed fire.",
        created_at: new Date().toISOString(),
      }),
      alice.client.from("agent_events").insert({
        investigation_id: aliceReport.investigationId,
        type: "status_changed",
        actor: "reviewer",
        idempotency_key: id,
        summary: "Marked confirmed.",
      }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.error?.code).toBe("42501");
    }
  });

  it("never lets a reporter change a status or set server-owned report fields", async () => {
    const { data: updated } = await alice.client
      .from("investigations")
      .update({ status: "insufficient_evidence" })
      .eq("id", aliceReport.investigationId)
      .select("id");
    expect(updated ?? []).toEqual([]);
    const { data: still } = await alice.client.from("investigations").select("status").eq("id", aliceReport.investigationId).single();
    expect(still?.status).toBe("unreviewed");

    const base = {
      client_request_id: crypto.randomUUID(),
      observed_at: new Date().toISOString(),
      latitude: 53.4,
      longitude: -2.2,
      location_uncertainty_m: 500,
      description: "Attempting to forge server-owned fields.",
    };
    // Each payload sets exactly one server-owned column; the cast skips the
    // generated Insert type, which (correctly) knows nothing of the trigger.
    for (const forged of [
      { is_synthetic: true },
      { owner_id: bob.id },
      { investigation_id: aliceReport.investigationId },
    ]) {
      const { error } = await alice.client.from("reports").insert({ ...base, ...forged } as never);
      expect(error?.code, Object.keys(forged)[0]).toBe("42501");
    }
    // The same payload without forged fields is accepted, so the denials above are about those fields.
    expect((await alice.client.from("reports").insert(base as never)).error).toBeNull();
  });

  it("enforces the reporting rules in the database too", async () => {
    const { error } = await alice.client.from("reports").insert({
      client_request_id: crypto.randomUUID(),
      observed_at: new Date(Date.now() - 5 * 24 * 3_600_000).toISOString(),
      latitude: 53.4,
      longitude: -2.2,
      location_uncertainty_m: 500,
      description: "An observation from five days ago.",
    } as never);
    expect(error?.code).toBe("23514");
  });

  it("keeps photos private, verifies them, and links them to the report", async () => {
    const mediaId = crypto.randomUUID();
    const path = reportMediaObjectPath(alice.id, mediaId, "image/jpeg");
    expect((await upload(alice.client, path, JPEG)).error).toBeNull();

    // Bob can neither read nor write inside Alice's folder.
    expect((await bob.client.storage.from(REPORT_MEDIA_BUCKET).download(path)).error).not.toBeNull();
    expect((await upload(bob.client, reportMediaObjectPath(alice.id, crypto.randomUUID(), "image/jpeg"), JPEG)).error).not.toBeNull();
    // Paths other than <user id>/<uuid>.<ext>, and other types, are refused.
    expect((await upload(alice.client, `${alice.id}/holiday.jpg`, JPEG)).error).not.toBeNull();
    expect((await upload(alice.client, reportMediaObjectPath(alice.id, crypto.randomUUID(), "image/png").replace(".png", ".gif"), JPEG, "image/gif")).error).not.toBeNull();

    const result = await submitReport(alice.client, alice.id, reportInput({ media: { mediaId, mimeType: "image/jpeg" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mediaId).toBe(mediaId);

    const detail = await getInvestigationDetail(alice.client, { userId: alice.id, isReviewer: false }, result.data.investigationId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.media).toHaveLength(1);
    expect(detail.data.media[0]).toMatchObject({ id: mediaId, reportId: result.data.reportId, mimeType: "image/jpeg" });
    expect(detail.data.media[0].url).toMatch(/^https?:\/\//);

    // Bob can't attach Alice's photo to his own report.
    const stolen = await submitReport(bob.client, bob.id, reportInput({ media: { mediaId, mimeType: "image/jpeg" } }));
    expect(stolen.ok).toBe(false);
  });

  it("rejects photos with location metadata, a mismatched type, or no upload", async () => {
    const exifId = crypto.randomUUID();
    await upload(alice.client, reportMediaObjectPath(alice.id, exifId, "image/jpeg"), EXIF_JPEG);
    const pngAsJpegId = crypto.randomUUID();
    await upload(alice.client, reportMediaObjectPath(alice.id, pngAsJpegId, "image/jpeg"), PNG);

    for (const mediaId of [exifId, pngAsJpegId, crypto.randomUUID()]) {
      const result = await submitReport(alice.client, alice.id, reportInput({ media: { mediaId, mimeType: "image/jpeg" } }));
      expect(result).toMatchObject({ ok: false, reason: "media_invalid" });
    }
  });

  it("serves bounded, privacy-safe map projections", async () => {
    const map = await listMapInvestigations(bob.client, { bbox: PEAK_DISTRICT, limit: 3 });
    expect(map.ok).toBe(true);
    if (!map.ok) return;
    expect(map.data.features).toHaveLength(3);
    expect(map.data.truncated).toBe(true);
    for (const feature of map.data.features) {
      expect(mapFeatureSchema.safeParse(feature).success).toBe(true);
      expect(feature.provenance.isSynthetic).toBe(true);
      expect(JSON.stringify(feature)).not.toMatch(/owner|description|media/i);
    }

    const own = await listMapInvestigations(alice.client, { bbox: null, limit: 200 });
    expect(own.ok && own.data.features.some((feature) => feature.id === aliceReport.investigationId)).toBe(true);
    const others = await listMapInvestigations(bob.client, { bbox: null, limit: 200 });
    expect(others.ok && others.data.features.some((feature) => feature.id === aliceReport.investigationId)).toBe(false);
  });

  it("serves investigation detail only to those allowed to see it", async () => {
    const own = await getInvestigationDetail(alice.client, { userId: alice.id, isReviewer: false }, aliceReport.investigationId);
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(investigationDetailResponseSchema.safeParse(own.data).success).toBe(true);
    expect(own.data.viewerAccess).toBe("reporter");
    expect(own.data.reports).toHaveLength(1);
    expect(own.data.reports[0].verification).toBe("unverified");
    expect(own.data.events.map((event) => event.type)).toEqual(["report_submitted"]);
    expect(JSON.stringify(own.data)).not.toContain(alice.id);

    const hidden = await getInvestigationDetail(bob.client, { userId: bob.id, isReviewer: false }, aliceReport.investigationId);
    expect(hidden).toMatchObject({ ok: false, error: { kind: "not_found" } });

    const { data: synthetic } = await bob.client.from("investigations").select("id").eq("synthetic_scenario_id", "repeated-witness").single();
    const shared = await getInvestigationDetail(bob.client, { userId: bob.id, isReviewer: false }, synthetic!.id);
    expect(shared.ok && shared.data.viewerAccess).toBe("synthetic");
    expect(shared.ok && shared.data.reports).toHaveLength(2);
  });

  describe.skipIf(!env?.secretKey)("with the service role (agent workers)", () => {
    it("appends findings idempotently, enforces the science, and never rewrites them", async () => {
      const admin = createAdmin(env!);
      const finding = {
        id: crypto.randomUUID(),
        investigation_id: aliceReport.investigationId,
        agent_id: "vision",
        assessment: "supports",
        strength: "weak",
        reason_codes: ["smoke_like_features_visible"],
        explanation: "The photo shows a grey plume consistent with smoke.",
        limitations: [...VISION_REQUIRED_LIMITATIONS],
        created_at: new Date().toISOString(),
      };
      expect((await admin.from("agent_findings").insert(finding)).error).toBeNull();
      expect((await admin.from("agent_findings").insert(finding)).error?.code).toBe("23505");
      expect((await admin.from("agent_findings").upsert(finding, { onConflict: "id", ignoreDuplicates: true })).error).toBeNull();
      expect((await admin.from("agent_findings").update({ explanation: "Rewritten." }).eq("id", finding.id)).error?.code).toBe("42501");

      const satelliteDenies = { ...finding, id: crypto.randomUUID(), agent_id: "satellite", assessment: "contradicts", limitations: [] };
      expect((await admin.from("agent_findings").insert(satelliteDenies)).error?.code).toBe("23514");
      const visionWithoutLimits = { ...finding, id: crypto.randomUUID(), limitations: [] };
      expect((await admin.from("agent_findings").insert(visionWithoutLimits)).error?.code).toBe("23514");

      const { data: seen } = await alice.client.from("agent_findings").select("id").eq("investigation_id", aliceReport.investigationId);
      expect(seen?.map((row) => row.id)).toEqual([finding.id]);
      const { data: unseen } = await bob.client.from("agent_findings").select("id").eq("investigation_id", aliceReport.investigationId);
      expect(unseen).toEqual([]);
    });

    it("records each event key once", async () => {
      const admin = createAdmin(env!);
      const event = {
        investigation_id: aliceReport.investigationId,
        type: "message_delivered",
        actor: "system",
        idempotency_key: `delivered:${crypto.randomUUID()}`,
        summary: "Delivered a task to the satellite agent.",
      };
      expect((await admin.from("agent_events").insert(event)).error).toBeNull();
      const duplicate = await admin
        .from("agent_events")
        .upsert(event, { onConflict: "investigation_id,idempotency_key", ignoreDuplicates: true })
        .select("id");
      expect(duplicate.error).toBeNull();
      expect(duplicate.data).toEqual([]);
    });

    // Last, because it turns Bob into a reviewer.
    it("grants reviewer access only through app_metadata, never user_metadata", async () => {
      await bob.client.auth.updateUser({ data: { embergap_role: "reviewer" } });
      await bob.client.auth.refreshSession();
      const { data: selfPromoted } = await bob.client.from("reports").select("id").eq("id", aliceReport.reportId);
      expect(selfPromoted).toEqual([]);

      const admin = createAdmin(env!);
      await admin.auth.admin.updateUserById(bob.id, { app_metadata: { embergap_role: "reviewer" } });
      await bob.client.auth.signInWithPassword({ email: bob.email, password: bob.password });
      const { data: asReviewer } = await bob.client.from("reports").select("id").eq("id", aliceReport.reportId);
      expect(asReviewer?.map((row) => row.id)).toEqual([aliceReport.reportId]);

      const { data: reviewed, error } = await bob.client
        .from("investigations")
        .update({ status: "reviewed", review_outcome: "inconclusive", reviewed_at: new Date().toISOString(), reviewed_by: bob.id })
        .eq("id", aliceReport.investigationId)
        .select("status");
      expect(error).toBeNull();
      expect(reviewed).toEqual([{ status: "reviewed" }]);
    });
  });
});
