import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoInvestigations } from "@/lib/embergap/read/demo-investigations";
import { approximateLocation } from "@/lib/embergap/read/geo";
import type { InvestigationDetail, MapResponse } from "@/lib/embergap/read/types";

const getCurrentUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUser }));

const { GET: getMap } = await import("@/app/api/embergap/map/route");
const { GET: getInvestigation } = await import("@/app/api/embergap/investigations/[id]/route");

const PEAK = "-2.15,53.25,-1.55,53.6";

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
  delete process.env.EMBERGAP_FIRMS_MODE;
  // A unique id per test keeps the module-level rate limiters apart.
  getCurrentUser.mockResolvedValue({ id: crypto.randomUUID(), email: "a@b.co" });
});

describe("GET /api/embergap/map", () => {
  it("requires a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await mapRequest(`bbox=${PEAK}`);
    expect(response.status).toBe(401);
  });

  it.each([
    ["no bbox", ""],
    ["a bad bbox", "bbox=1,2,3"],
    ["a huge bbox", "bbox=-60,0,0,20"],
    ["a zero limit", `bbox=${PEAK}&limit=0`],
    ["a huge limit", `bbox=${PEAK}&limit=5000`],
    ["a text limit", `bbox=${PEAK}&limit=lots`],
  ])("rejects %s with 400", async (_label, query) => {
    const response = await mapRequest(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  });

  it("returns demo features with provenance, freshness and no-store", async () => {
    const response = await mapRequest(`bbox=${PEAK}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = (await response.json()) as MapResponse;
    expect(body.sources.firms.mode).toBe("demo");
    expect(body.features.some((f) => f.kind === "investigation")).toBe(true);
    expect(body.features.some((f) => f.kind === "thermal_anomaly")).toBe(true);
    for (const feature of body.features) {
      expect(feature.provenance.label).toBeTruthy();
      expect(["fresh", "recent", "stale"]).toContain(feature.freshness);
    }
  });

  it("never exposes exact report coordinates or report text", async () => {
    const body = (await (await mapRequest(`bbox=${PEAK}`)).json()) as MapResponse;
    const text = JSON.stringify(body);
    for (const item of demoInvestigations(new Date())) {
      expect(text).not.toContain(String(item.report.latitude));
      expect(text).not.toContain(String(item.report.longitude));
      expect(text).not.toContain(item.report.summary);
    }
    const ridge = body.features.find((f) => f.investigationId === "demo-inv-ridge");
    const approx = approximateLocation(53.4532, -1.8791);
    expect(ridge).toMatchObject({ latitude: approx.latitude, longitude: approx.longitude });
    expect(ridge?.locationPrecisionKm).toBeGreaterThanOrEqual(2);
  });

  it("bounds the response with limit and says when it is truncated", async () => {
    const body = (await (await mapRequest(`bbox=${PEAK}&limit=1`)).json()) as MapResponse;
    expect(body.features).toHaveLength(1);
    expect(body.truncated).toBe(true);
    expect(body.total).toBeGreaterThan(1);
  });
});

describe("GET /api/embergap/investigations/[id]", () => {
  it("requires a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await investigationRequest("demo-inv-ridge");
    expect(response.status).toBe(401);
  });

  it.each(["does-not-exist", "../../etc/passwd", "DEMO-INV-RIDGE", "x".repeat(65)])(
    "returns 404 for %s",
    async (id) => {
      const response = await investigationRequest(id);
      expect(response.status).toBe(404);
    },
  );

  it("returns findings, gaps and an approximate location", async () => {
    const response = await investigationRequest("demo-inv-witness");
    expect(response.status).toBe(200);
    const body = (await response.json()) as InvestigationDetail;
    expect(body.mode).toBe("demo");
    expect(body.findings.map((f) => f.agentId)).toEqual(
      expect.arrayContaining(["vision", "satellite", "weather", "witness", "fusion"]),
    );
    expect(body.findings.find((f) => f.agentId === "satellite")?.deliveredAfterPartition).toBe(true);
    expect(body.activity.some((event) => event.kind === "link_partitioned")).toBe(true);
    expect(body.activity.some((event) => event.kind === "duplicate_ignored")).toBe(true);
    expect(body.report.latitude).not.toBe(38.7448);
    expect(body.report.locationPrecisionKm).toBeGreaterThanOrEqual(2);
  });

  it("keeps the missing satellite pass as unknown, not negative", async () => {
    const body = (await (await investigationRequest("demo-inv-gap")).json()) as InvestigationDetail;
    const firms = body.evidence.find((item) => item.source === "firms");
    expect(firms?.state).toBe("not_observed");
    expect(body.recommendation.summary).toMatch(/gap, not evidence/);
    expect(JSON.stringify(body)).not.toMatch(/\d+(\.\d+)?\s?%\s*(confidence|likely|probability)/i);
  });
});
