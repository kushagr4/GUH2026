// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_MEDIA_MAX_BYTES, reportSubmissionRequestSchema } from "@/lib/embergap/contracts";
import { checkEncodedSize, checkPhotoSource, fitWithin } from "@/components/embergap/report/photo";
import {
  buildReportRequest,
  localDateTimeToUtcIso,
  mapApiError,
  toDateTimeLocalValue,
  type ReportFormValues,
} from "@/components/embergap/report/report-request";
import { lookupPostcode, parsePostcode, suggestedUncertaintyMeters } from "@/components/embergap/report/postcode";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const upload = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload }) } }),
}));

import { ReportForm } from "@/components/embergap/report/report-form";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const INVESTIGATION_ID = "33333333-3333-4333-8333-333333333333";

function values(overrides: Partial<ReportFormValues> = {}, now = new Date()): ReportFormValues {
  return {
    latitude: "53.480812345",
    longitude: "-2.242612345",
    uncertaintyMeters: 1_000,
    observedAtLocal: toDateTimeLocalValue(new Date(now.getTime() - 10 * 60_000)),
    description: "Thick grey smoke rising behind the hill.",
    ...overrides,
  };
}

describe("buildReportRequest", () => {
  it("builds a schema-valid body with UTC time and rounded coordinates", () => {
    const result = buildReportRequest(values(), { clientRequestId: CLIENT_ID, media: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.location).toEqual({ latitude: 53.48081, longitude: -2.24261, uncertaintyMeters: 1_000 });
    expect(result.data.observedAt).toMatch(/Z$/);
    expect(result.data.media).toBeNull();
    expect(reportSubmissionRequestSchema.safeParse(result.data).success).toBe(true);
  });

  it("converts a local datetime to the same instant in UTC", () => {
    const local = new Date(2026, 10, 7, 15, 30);
    expect(localDateTimeToUtcIso("2026-11-07T15:30")).toBe(local.toISOString());
    expect(localDateTimeToUtcIso("2026-02-31T10:00")).toBeNull();
    expect(localDateTimeToUtcIso("nope")).toBeNull();
  });

  it("rejects a future observed time", () => {
    const now = new Date();
    const future = toDateTimeLocalValue(new Date(now.getTime() + 60 * 60_000));
    const result = buildReportRequest(values({ observedAtLocal: future }), { clientRequestId: CLIENT_ID, media: null }, now);
    expect(result).toEqual({ ok: false, fieldErrors: expect.objectContaining({ observedAt: "That time is in the future." }) });
  });

  it("rejects out-of-range and missing coordinates", () => {
    const result = buildReportRequest(values({ latitude: "91", longitude: "" }), { clientRequestId: CLIENT_ID, media: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.latitude).toMatch(/between -90 and 90/);
    expect(result.fieldErrors.longitude).toMatch(/Enter a longitude/);
  });

  it("uses the contract's description rule", () => {
    const result = buildReportRequest(values({ description: "smoke" }), { clientRequestId: CLIENT_ID, media: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.description).toMatch(/at least 10/);
  });
});

describe("mapApiError", () => {
  it("never shows the server message and keeps contract field errors", () => {
    const mapped = mapApiError(400, {
      error: { code: "validation_failed", message: "raw zod text", fieldErrors: { description: ["Too short"], reporterId: ["x"] } },
    });
    expect(mapped.message).toBe("Some fields need attention.");
    expect(mapped.fieldErrors).toEqual({ description: "Too short" });
  });

  it("maps 401, 409, 429 and media_invalid", () => {
    expect(mapApiError(401, null).message).toMatch(/Sign in again/);
    const conflict = mapApiError(409, { error: { code: "conflict", message: "x" } });
    expect(conflict.retry).toBe("new_media");
    expect(mapApiError(429, { error: { code: "rate_limited", message: "x", retryAfterSeconds: 120 } }).message).toMatch(/2 minutes/);
    expect(mapApiError(400, { error: { code: "media_invalid", message: "x" } }).retry).toBe("new_media");
    expect(mapApiError(500, "<html>").message).toMatch(/try again/);
  });
});

describe("photo helpers", () => {
  it("caps the re-encoded size at REPORT_MEDIA_MAX_BYTES", () => {
    expect(checkEncodedSize(REPORT_MEDIA_MAX_BYTES).ok).toBe(true);
    expect(checkEncodedSize(REPORT_MEDIA_MAX_BYTES + 1).ok).toBe(false);
    expect(checkEncodedSize(0).ok).toBe(false);
  });

  it("accepts only jpeg, png and webp", () => {
    expect(checkPhotoSource({ type: "image/png", size: 10 }).ok).toBe(true);
    expect(checkPhotoSource({ type: "image/gif", size: 10 }).ok).toBe(false);
  });

  it("fits the longest side within 2048 px", () => {
    expect(fitWithin(4096, 3072)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("postcode lookup", () => {
  it("normalises full postcodes and districts", () => {
    expect(parsePostcode(" m13 9pl ")).toEqual({ kind: "full", value: "M139PL", display: "M13 9PL" });
    expect(parsePostcode("sw1a1aa")?.display).toBe("SW1A 1AA");
    expect(parsePostcode("M13")).toEqual({ kind: "outcode", value: "M13", display: "M13" });
    expect(parsePostcode("not a postcode")).toBeNull();
    expect(suggestedUncertaintyMeters("outcode")).toBe(5_000);
  });

  it("calls postcodes.io and returns the centre", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200, result: { latitude: 53.466926, longitude: -2.233578 } })));
    const result = await lookupPostcode("M13 9PL", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, latitude: 53.466926, longitude: -2.233578, display: "M13 9PL", kind: "full" });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("https://api.postcodes.io/postcodes/M139PL");
  });

  it("uses the outcode endpoint for a district", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200, result: { latitude: 53.46, longitude: -2.21 } })));
    await lookupPostcode("m13", fetchMock as unknown as typeof fetch);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("https://api.postcodes.io/outcodes/M13");
  });

  it("handles unknown postcodes, bad input and outages without calling out needlessly", async () => {
    const notFound = vi.fn(async () => new Response(JSON.stringify({ status: 404, error: "Postcode not found" }), { status: 404 }));
    expect(await lookupPostcode("ZZ1 1ZZ", notFound as unknown as typeof fetch)).toEqual({ ok: false, message: expect.stringMatching(/couldn't find ZZ1 1ZZ/) });
    const never = vi.fn();
    expect((await lookupPostcode("hello", never as unknown as typeof fetch)).ok).toBe(false);
    expect(never).not.toHaveBeenCalled();
    const down = vi.fn(async () => { throw new TypeError("network"); });
    expect(await lookupPostcode("M13 9PL", down as unknown as typeof fetch)).toEqual({ ok: false, message: expect.stringMatching(/isn't available/) });
  });
});

describe("ReportForm", () => {
  beforeEach(() => {
    push.mockReset();
    upload.mockReset();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CLIENT_ID);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function fill() {
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "53.48" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-2.24" } });
    fireEvent.change(screen.getByLabelText("What did you see?"), { target: { value: "Grey smoke over the trees to the north." } });
  }

  it("posts the report and navigates to the investigation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          reportId: CLIENT_ID,
          investigationId: INVESTIGATION_ID,
          investigationStatus: "unreviewed",
          mediaId: null,
          submittedAt: new Date().toISOString(),
          verification: "unverified",
          replayed: false,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm userId={USER_ID} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/embergap/investigations/${INVESTIGATION_ID}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/embergap/reports");
    const body = JSON.parse(String(init.body));
    expect(body.clientRequestId).toBe(CLIENT_ID);
    expect(body.location).toEqual({ latitude: 53.48, longitude: -2.24, uncertaintyMeters: 1_000 });
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows friendly copy on 429 and reuses the clientRequestId on retry", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "raw server text", retryAfterSeconds: 30 } }), {
        status: 429,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm userId={USER_ID} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/sent several reports/)).toBeTruthy();
    expect(screen.queryByText("raw server text")).toBeNull();

    vi.mocked(crypto.randomUUID).mockReturnValue("44444444-4444-4444-8444-444444444444");
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const ids = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).clientRequestId);
    expect(ids).toEqual([CLIENT_ID, CLIENT_ID]);
    expect(push).not.toHaveBeenCalled();
  });

  it("fills coordinates from a postcode and widens the radius for a district", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: 200, result: { latitude: 53.460476794, longitude: -2.215434566 } }))));
    render(<ReportForm userId={USER_ID} />);
    fireEvent.change(screen.getByLabelText("UK postcode or area"), { target: { value: "m13" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("53.46048"));
    expect((screen.getByLabelText("Longitude") as HTMLInputElement).value).toBe("-2.21543");
    expect((screen.getByLabelText("How sure are you of that point?") as HTMLSelectElement).value).toBe("5000");
    expect(screen.getByText(/centre of the M13 area/)).toBeTruthy();
  });

  it("does not send an invalid report", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm userId={USER_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/Enter a latitude/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
