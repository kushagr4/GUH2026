import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorResponseSchema, reportSubmissionResponseSchema } from "@/lib/embergap/contracts";

const getCurrentUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUser }));

const createClient = vi.fn(async () => ({ fake: "client" }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const submitReport = vi.fn();
vi.mock("@/features/embergap/submit", () => ({ submitReport }));

const scheduleInvestigation = vi.fn(() => true);
vi.mock("@/features/embergap/orchestrator", () => ({ scheduleInvestigation }));

const { POST } = await import("@/app/api/embergap/reports/route");

const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const INVESTIGATION_ID = "00000000-0000-4000-8000-000000000002";

function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: crypto.randomUUID(),
    observedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    location: { latitude: 53.4668, longitude: -2.2339, uncertaintyMeters: 500 },
    description: "Grey smoke rising above the trees to the north.",
    ...overrides,
  };
}

function post(body: unknown, headers?: Record<string, string>) {
  return POST(
    new Request("http://localhost/api/embergap/reports", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function created(replayed = false) {
  return {
    ok: true,
    data: {
      reportId: REPORT_ID,
      investigationId: INVESTIGATION_ID,
      investigationStatus: "unreviewed",
      mediaId: null,
      submittedAt: "2026-11-07T14:00:00.000Z",
      replayed,
    },
  };
}

async function errorOf(response: Response) {
  return apiErrorResponseSchema.parse(await response.json()).error;
}

describe("POST /api/embergap/reports", () => {
  let userId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // A unique id per test keeps the module-level rate limiters apart.
    userId = crypto.randomUUID();
    getCurrentUser.mockResolvedValue({ id: userId, email: "reporter@example.test" });
    submitReport.mockResolvedValue(created());
  });

  it("requires a signed-in user and touches nothing otherwise", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await post(goodBody());
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("unauthorized");
    expect(submitReport).not.toHaveBeenCalled();
  });

  it("creates a report with the user's own client and returns the contract response", async () => {
    const body = goodBody();
    const response = await post(body);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = reportSubmissionResponseSchema.parse(await response.json());
    expect(json).toMatchObject({ reportId: REPORT_ID, investigationStatus: "unreviewed", verification: "unverified", replayed: false });
    expect(submitReport).toHaveBeenCalledWith({ fake: "client" }, userId, expect.objectContaining({ description: body.description, media: null }));
    expect(scheduleInvestigation).toHaveBeenCalledWith(INVESTIGATION_ID);
  });

  it("returns 200 for a replayed clientRequestId", async () => {
    submitReport.mockResolvedValue(created(true));
    const response = await post(goodBody());
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(scheduleInvestigation).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("validation_failed");
  });

  it("returns per-field errors the form can show", async () => {
    const response = await post(goodBody({ description: "smoke", location: { latitude: 99, longitude: 0, uncertaintyMeters: 500 } }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("validation_failed");
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["description", "location"]);
    expect(submitReport).not.toHaveBeenCalled();
  });

  it("rejects fields the server owns, such as a status or reporter id", async () => {
    const response = await post(goodBody({ status: "reviewed", reporterId: crypto.randomUUID() }));
    expect(response.status).toBe(400);
    expect(submitReport).not.toHaveBeenCalled();
  });

  it("refuses oversized bodies before parsing them", async () => {
    const response = await post(goodBody({ description: "x".repeat(20_000) }));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("payload_too_large");
  });

  it("explains an invalid photo", async () => {
    submitReport.mockResolvedValue({ ok: false, reason: "media_invalid", message: "The photo wasn't found." });
    const response = await post(goodBody({ media: { mediaId: crypto.randomUUID(), mimeType: "image/jpeg" } }));
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatchObject({ code: "media_invalid", message: "The photo wasn't found." });
  });

  it.each([
    ["forbidden", 403, "forbidden"],
    ["conflict", 409, "conflict"],
    ["unavailable", 503, "unavailable"],
    ["unknown", 500, "internal"],
  ] as const)("maps a %s database error without leaking it", async (kind, status, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    submitReport.mockResolvedValue({
      ok: false,
      reason: "db",
      error: { kind, message: "That value is not valid.", code: "XX000" },
    });
    const response = await post(goodBody());
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(apiErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe(code);
    expect(text).not.toMatch(/XX000|violates|constraint|relation/i);
  });

  it("rate-limits a reporter after five reports a minute", async () => {
    for (let i = 0; i < 5; i++) expect((await post(goodBody())).status).toBe(201);
    const response = await post(goodBody());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await errorOf(response)).retryAfterSeconds).toBeGreaterThan(0);
  });
});
