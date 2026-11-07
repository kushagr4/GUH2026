import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_NOW, SYNTHETIC_SCENARIOS, mapFeatureSchema, type InvestigationDetailResponse } from "@/lib/embergap/contracts";

/* ------------------------------------------------------------------------- */
/* The Supabase read repository behind Outrolife's GET routes                */
/* ------------------------------------------------------------------------- */

const repo = vi.hoisted(() => ({ listMapInvestigations: vi.fn(), getInvestigationDetail: vi.fn() }));
vi.mock("@/features/embergap/repository", () => repo);

const getCurrentUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUser }));
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));
const orchestrator = vi.hoisted(() => ({ canRunAgents: vi.fn(() => true), getRunState: vi.fn(), scheduleInvestigation: vi.fn(() => true) }));
vi.mock("@/features/embergap/orchestrator", () => orchestrator);

const { createSupabaseReadRepository } = await import("@/features/embergap/read-repository");
const { fixtureReadRepository } = await import("@/lib/embergap/read/fixture-repository");
const { POST: retry } = await import("@/app/api/embergap/runs/route");
const { firmsPassProcessor } = await import("@/features/embergap/processors");

const viewer = { userId: "00000000-0000-4000-8000-0000000000aa", isReviewer: false };
const client = {} as never;

describe("createSupabaseReadRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts the database's investigations first and keeps the synthetic ones once", async () => {
    const fixtures = await fixtureReadRepository.listMapInvestigations({ bbox: null, limit: 50 });
    if (!fixtures.ok) throw new Error("fixtures");
    const live = {
      ...fixtures.data.features[0],
      id: "10000000-0000-4000-8000-000000000001",
      investigationId: "10000000-0000-4000-8000-000000000001",
      provenance: { ...fixtures.data.features[0].provenance, isSynthetic: false },
    };
    // A legacy (UK) seed row for a synthetic id: replaced by the Italy fixture.
    const legacySeed = { ...fixtures.data.features[1], location: { ...fixtures.data.features[1].location, latitude: 53.5, longitude: -1.9 } };
    repo.listMapInvestigations.mockResolvedValue({ ok: true, data: { features: [live, legacySeed], truncated: false } });

    const result = await createSupabaseReadRepository(client, viewer).listMapInvestigations({ bbox: null, limit: 50 });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.features[0].id).toBe(live.id);
    const ids = result.data.features.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No UK coordinates in the Italian demonstration.
    expect(result.data.features.every((feature) => feature.location.latitude < 48)).toBe(true);
    expect(result.data.features.every((feature) => mapFeatureSchema.safeParse(feature).success)).toBe(true);
  });

  it("falls back to the labelled fixtures when the database is unreachable", async () => {
    repo.listMapInvestigations.mockResolvedValue({ ok: false, error: { kind: "unavailable", message: "x" } });
    const result = await createSupabaseReadRepository(client, viewer).listMapInvestigations({ bbox: null, limit: 50 });
    expect(result.ok && result.data.features.every((feature) => feature.provenance.isSynthetic)).toBe(true);
  });

  it("returns the database's detail for a submitted report, and the Italy fixtures for synthetic ids", async () => {
    const detail = { investigation: { id: "x" } } as unknown as InvestigationDetailResponse;
    repo.getInvestigationDetail.mockResolvedValueOnce({ ok: true, data: detail });
    await expect(createSupabaseReadRepository(client, viewer).getInvestigationDetail("10000000-0000-4000-8000-000000000001")).resolves.toEqual({ ok: true, data: detail });

    repo.getInvestigationDetail.mockResolvedValue({ ok: false, error: { kind: "not_found", message: "x" } });
    const synthetic = await createSupabaseReadRepository(client, viewer).getInvestigationDetail(SYNTHETIC_SCENARIOS[0].investigationId);
    expect(synthetic.ok && synthetic.data.investigation.location.latitude).toBeCloseTo(40.12, 1);
    expect(repo.getInvestigationDetail).toHaveBeenCalledTimes(1);
    const missing = await createSupabaseReadRepository(client, viewer).getInvestigationDetail("10000000-0000-4000-8000-000000000009");
    expect(missing).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});

/* ------------------------------------------------------------------------- */
/* POST /api/embergap/runs: restart an interrupted assessment                */
/* ------------------------------------------------------------------------- */

const INVESTIGATION = "10000000-0000-4000-8000-000000000001";
function investigationRow(row: unknown) {
  from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) });
}
const call = (body: unknown) => retry(new Request("http://localhost/api/embergap/runs", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/embergap/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: crypto.randomUUID() });
  });

  it("needs a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await call({ investigationId: INVESTIGATION })).status).toBe(401);
  });

  it("is 404 for an investigation RLS hides, and 409 for synthetic demos", async () => {
    investigationRow(null);
    expect((await call({ investigationId: INVESTIGATION })).status).toBe(404);
    investigationRow({ id: INVESTIGATION, is_synthetic: true });
    expect((await call({ investigationId: INVESTIGATION })).status).toBe(409);
  });

  it("leaves a finished run alone and restarts an interrupted one", async () => {
    investigationRow({ id: INVESTIGATION, is_synthetic: false });
    orchestrator.getRunState.mockResolvedValueOnce({ state: "finished", runId: "r" });
    const finished = await call({ investigationId: INVESTIGATION });
    expect(await finished.json()).toEqual({ state: "finished" });
    expect(orchestrator.scheduleInvestigation).not.toHaveBeenCalled();

    orchestrator.getRunState.mockResolvedValueOnce({ state: "interrupted", runId: "r" });
    const restarted = await call({ investigationId: INVESTIGATION });
    expect(restarted.status).toBe(202);
    expect(await restarted.json()).toEqual({ state: "scheduled" });
    expect(orchestrator.scheduleInvestigation).toHaveBeenCalledWith(INVESTIGATION, { onlyIfIncomplete: true });
  });
});

/* ------------------------------------------------------------------------- */
/* The satellite agent's FIRMS processor                                     */
/* ------------------------------------------------------------------------- */

const center = { latitude: 53.5, longitude: -2 };
function firmsInput(detections: { latitude: number; longitude: number; observedAt: string }[]) {
  return {
    product: "VIIRS_SNPP_NRT",
    availability: { source: "firms" as const, state: "available" as const, checkedAt: SYNTHETIC_NOW, latestObservedAt: SYNTHETIC_NOW, maxAgeSeconds: 43_200, windowStart: "2026-11-06T12:00:00.000Z", windowEnd: SYNTHETIC_NOW, message: null },
    center,
    radiusKm: 5,
    reportObservedAt: "2026-11-07T11:00:00.000Z",
    detections: detections.map((detection, index) => ({
      id: `row-${index}`,
      ...detection,
      retrievedAt: SYNTHETIC_NOW,
      evidence: { instrument: "VIIRS", satellite: "N", confidence: "high" as const, frpMegawatts: 4, brightnessKelvin: 330, dayNight: "day" as const, distanceKm: null, version: null, scanKm: 0.4, trackKm: 0.4 },
      isSynthetic: true,
    })),
  };
}
function runFirms(input: ReturnType<typeof firmsInput>) {
  const parsed = firmsPassProcessor.input.parse(input);
  return firmsPassProcessor.run({
    agentId: "satellite",
    task: { id: "t", investigationId: SYNTHETIC_SCENARIOS[0].investigationId, kind: "satellite.firms", input: parsed },
    input: parsed,
    now: 0,
    nowIso: SYNTHETIC_NOW,
    mode: "synthetic",
    evidence: { events: () => [], observations: () => [], findings: () => [], hasRecord: () => false },
    upstream: [],
  });
}

describe("firmsPassProcessor", () => {
  it("supports for a timely detection near the report, with its distance", () => {
    const result = runFirms(firmsInput([{ latitude: 53.505, longitude: -2.001, observedAt: "2026-11-07T10:40:00.000Z" }]));
    expect(result.findings?.[0]).toMatchObject({ assessment: "supports", strength: "moderate", reasonCodes: ["thermal_anomaly_nearby"] });
    expect(result.observations?.[0].source === "firms" && result.observations[0].evidence?.distanceKm).toBeLessThan(1);
  });

  it("ignores detections outside the radius: a non-detection with its coverage, never a contradiction", () => {
    const result = runFirms(firmsInput([{ latitude: 53.7, longitude: -2, observedAt: "2026-11-07T10:40:00.000Z" }]));
    expect(result.findings?.[0]).toMatchObject({ assessment: "inconclusive", reasonCodes: ["no_thermal_detection_in_window"] });
    expect(result.findings?.[0].limitations).toContain("no_detection_is_not_absence");
    expect(result.observations?.[0]).toMatchObject({ sourceState: "not_observed", coverage: { radiusKm: 5 } });
  });

  it("treats a nearby detection far from the report time as stale, not support", () => {
    const result = runFirms(firmsInput([{ latitude: 53.501, longitude: -2, observedAt: "2026-11-05T09:00:00.000Z" }]));
    expect(result.findings?.[0]).toMatchObject({ assessment: "inconclusive", reasonCodes: ["source_stale"] });
  });
});

/* ------------------------------------------------------------------------- */
/* Deployment status: why a report can't be saved                            */
/* ------------------------------------------------------------------------- */

describe("getEmbergapStatus", () => {
  function statusClient(tableError: { code: string } | null, bucketError: { message: string } | null) {
    return {
      from: () => ({ select: () => ({ limit: async () => ({ error: tableError }) }) }),
      storage: { from: () => ({ list: async () => ({ error: bucketError }) }) },
    } as never;
  }

  it("names missing migrations and a missing secret key as the fixes", async () => {
    const { getEmbergapStatus } = await import("@/features/embergap/status");
    orchestrator.canRunAgents.mockReturnValueOnce(false);
    const status = await getEmbergapStatus(statusClient({ code: "PGRST205" }, { message: "Bucket not found" }), "u");
    expect(status.ok).toBe(false);
    expect(status.database.reports.detail).toMatch(/migrations are not applied/);
    expect(status.database.photo_bucket.ok).toBe(false);
    expect(status.fix.join(" ")).toMatch(/npm run db:push/);
    expect(status.fix.join(" ")).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("is ok when the tables and bucket exist and agents can run", async () => {
    const { getEmbergapStatus } = await import("@/features/embergap/status");
    const status = await getEmbergapStatus(statusClient(null, null), "u");
    expect(status.ok).toBe(true);
    expect(status.fix).toEqual([]);
  });
});
