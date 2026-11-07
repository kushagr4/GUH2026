import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_SCENARIOS,
  apiErrorResponseSchema,
  humanPublicLocationSchema,
  investigationDetailResponseSchema,
  mapResponseSchema,
  type InvestigationReadRepository,
} from "@/lib/embergap/contracts";
import { fixtureDetails, fixtureReadRepository } from "@/lib/embergap/read/fixture-repository";

const getCurrentUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUser }));

let repository: InvestigationReadRepository = fixtureReadRepository;
vi.mock("@/lib/embergap/read/repository", () => ({ getReadRepository: async () => repository }));

const { GET: getMap } = await import("@/app/api/embergap/map/route");
const { GET: getInvestigation } = await import("@/app/api/embergap/investigations/[id]/route");

const ITALY = "6.5,35.5,19,47.5"; // Italy, the demonstration area
const PARTITION = SYNTHETIC_SCENARIOS.find((s) => s.id === "partition-recovery")!;
const MISSING_PASS = SYNTHETIC_SCENARIOS.find((s) => s.id === "missing-satellite-pass")!;

function mapRequest(query: string) {
  return getMap(new NextRequest(`http://localhost/api/embergap/map?${query}`));
}

function investigationRequest(id: string) {
  return getInvestigation(new NextRequest(`http://localhost/api/embergap/investigations/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  repository = fixtureReadRepository;
  delete process.env.EMBERGAP_FIRMS_MODE;
  // A unique id per test keeps the module-level rate limiters apart.
  getCurrentUser.mockResolvedValue({ id: crypto.randomUUID(), email: "a@b.co" });
});

describe("synthetic fixture repository", () => {
  it("has one contract-valid investigation per shared scenario", () => {
    const details = fixtureDetails();
    expect([...details.keys()].sort()).toEqual(SYNTHETIC_SCENARIOS.map((s) => s.investigationId).sort());
    for (const scenario of SYNTHETIC_SCENARIOS) {
      const detail = details.get(scenario.investigationId)!;
      const parsed = investigationDetailResponseSchema.safeParse(detail);
      expect(parsed.success, `${scenario.id}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(true);
      expect(detail.reports.map((r) => r.id)).toEqual([...scenario.reportIds]);
      expect(detail.investigation.syntheticScenarioId).toBe(scenario.id);
      expect(detail.findings.some((f) => f.agentId === "fusion" && f.recommendation)).toBe(true);
    }
  });
});

describe("GET /api/embergap/map", () => {
  it("requires a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await mapRequest(`bbox=${ITALY}`);
    expect(response.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe("unauthorized");
  });

  it.each([
    ["a bad bbox", "bbox=1,2,3"],
    ["an inverted bbox", "bbox=-1.55,53.3,-2.75,54"],
    ["a huge bbox", "bbox=-150,-60,0,20"],
    ["a zero limit", `bbox=${ITALY}&limit=0`],
    ["a huge limit", `bbox=${ITALY}&limit=5000`],
    ["a text limit", `bbox=${ITALY}&limit=lots`],
  ])("rejects %s with validation_failed", async (_label, query) => {
    const response = await mapRequest(query);
    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe("validation_failed");
  });

  it("returns a contract-valid synthetic map with no-store", async () => {
    const response = await mapRequest(`bbox=${ITALY}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = mapResponseSchema.parse(await response.json());
    expect(body.mode).toBe("synthetic");
    expect(body.features.filter((f) => f.kind === "investigation")).toHaveLength(SYNTHETIC_SCENARIOS.length);
    expect(body.features.some((f) => f.kind === "thermal_anomaly")).toBe(true);
    expect(body.sourceAvailability.map((s) => s.source)).toEqual(["firms"]);
  });

  it("never exposes report text or reporters' chosen points", async () => {
    const body = mapResponseSchema.parse(await (await mapRequest(`bbox=${ITALY}`)).json());
    const text = JSON.stringify(body);
    for (const detail of fixtureDetails().values()) {
      for (const report of detail.reports) expect(text).not.toContain(report.description);
    }
    for (const feature of body.features.filter((f) => f.kind === "investigation")) {
      expect(humanPublicLocationSchema.safeParse(feature.location).success).toBe(true);
    }
  });

  it("bounds the response with limit and says when it is truncated", async () => {
    const body = mapResponseSchema.parse(await (await mapRequest(`bbox=${ITALY}&limit=1`)).json());
    expect(body.features).toHaveLength(1);
    expect(body.truncated).toBe(true);
  });

  it("maps a repository failure to unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repository = {
      ...fixtureReadRepository,
      listMapInvestigations: async () => ({ ok: false, error: { kind: "unavailable", message: "db down" } }),
    };
    const response = await mapRequest(`bbox=${ITALY}`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("db down");
  });
});

describe("GET /api/embergap/investigations/[id]", () => {
  it("requires a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await investigationRequest(PARTITION.investigationId);
    expect(response.status).toBe(401);
  });

  it.each(["not-a-uuid", "../../etc/passwd", "00000000-0000-4000-8000-000000000000"])(
    "returns not_found for %s",
    async (id) => {
      const response = await investigationRequest(id);
      expect(response.status).toBe(404);
      expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe("not_found");
    },
  );

  it("returns a contract-valid detail with the partition story", async () => {
    const response = await investigationRequest(PARTITION.investigationId);
    expect(response.status).toBe(200);
    const body = investigationDetailResponseSchema.parse(await response.json());
    expect(body.viewerAccess).toBe("synthetic");
    const types = body.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["partition_started", "partition_healed", "duplicate_ignored", "reconciled"]));
    expect(body.events[0]!.occurredAt >= body.events.at(-1)!.occurredAt).toBe(true);
  });

  it("keeps a missing satellite pass as not_observed with the window checked", async () => {
    const body = investigationDetailResponseSchema.parse(
      await (await investigationRequest(MISSING_PASS.investigationId)).json(),
    );
    const firms = body.sourceAvailability.find((s) => s.source === "firms")!;
    expect(firms.state).toBe("not_observed");
    expect(firms.windowEnd).toBe("2026-11-07T08:52:00.000Z");
    const satellite = body.findings.find((f) => f.agentId === "satellite")!;
    expect(satellite.assessment).toBe("inconclusive");
    expect(satellite.limitations).toContain("no_detection_is_not_absence");
  });

  it("maps a repository failure to unavailable, not 404", async () => {
    repository = {
      ...fixtureReadRepository,
      getInvestigationDetail: async () => ({ ok: false, error: { kind: "unavailable", message: "db down" } }),
    };
    const response = await investigationRequest(PARTITION.investigationId);
    expect(response.status).toBe(503);
  });
});
