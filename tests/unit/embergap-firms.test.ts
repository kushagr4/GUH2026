import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_NOW, firmsEvidenceSchema, idSchema, sourceAvailabilitySchema } from "@/lib/embergap/contracts";
import { IntegrationError } from "@/lib/integrations/errors";
import { bboxContains, formatBbox, isWithinFirmsSpan } from "@/lib/embergap/sources/firms/bbox";
import { createFirmsClient, fetchFirmsCsv, getFirmsMode } from "@/lib/embergap/sources/firms/client";
import { demoFirmsDetections } from "@/lib/embergap/sources/firms/fixtures";
import { clearFirmsCache, getThermalAnomalies } from "@/lib/embergap/sources/firms";
import { FirmsFormatError, parseFirmsCsv, toConfidence, toObservedAt } from "@/lib/embergap/sources/firms/parse";

const NOW = new Date("2026-11-07T14:00:00Z");
const BBOX = { minLongitude: -2.15, minLatitude: 53.25, maxLongitude: -1.55, maxLatitude: 53.6 };
const KEY = "abcdef0123456789abcdef0123456789";
const LIVE_ENV = { EMBERGAP_FIRMS_MODE: "live", NASA_FIRMS_MAP_KEY: KEY };

const VIIRS_CSV = [
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
  "53.4561,-1.8724,338.2,0.39,0.36,2026-11-07,1312,N,VIIRS,h,2.0NRT,290.1,6.4,D",
  "53.4549,-1.8767,329.7,0.39,0.36,2026-11-07,1312,N,VIIRS,n,2.0NRT,289.5,3.1,D",
  // Duplicate of the first row: ignored.
  "53.4561,-1.8724,338.2,0.39,0.36,2026-11-07,1312,N,VIIRS,h,2.0NRT,290.1,6.4,D",
  // Unusable rows: skipped rather than guessed.
  "not-a-number,-1.8,300,0.4,0.4,2026-11-07,1312,N,VIIRS,n,2.0NRT,290,1,D",
  "53.4,-1.8,300,0.4,0.4,2026-11-07,2599,N,VIIRS,n,2.0NRT,290,1,D",
].join("\n");

const MODIS_CSV = [
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
  "38.7471,-121.0552,322.5,1.0,1.0,2026-11-07,54,Aqua,MODIS,62,6.1NRT,300.2,14.8,N",
].join("\r\n");

describe("parseFirmsCsv", () => {
  it("parses VIIRS rows into contract FIRMS evidence, deduplicating and skipping bad rows", () => {
    const detections = parseFirmsCsv(VIIRS_CSV, { product: "VIIRS_SNPP_NRT", retrievedAt: NOW.toISOString() });
    expect(detections).toHaveLength(2);
    const [first] = detections;
    expect(first).toMatchObject({
      latitude: 53.4561,
      longitude: -1.8724,
      observedAt: "2026-11-07T13:12:00.000Z",
      isSynthetic: false,
    });
    expect(first?.evidence).toMatchObject({
      confidence: "high",
      frpMegawatts: 6.4,
      brightnessKelvin: 338.2,
      dayNight: "day",
      version: "2.0NRT",
      scanKm: 0.39,
      trackKm: 0.36,
    });
    for (const detection of detections) {
      expect(firmsEvidenceSchema.safeParse(detection.evidence).success).toBe(true);
      expect(idSchema.safeParse(detection.id).success).toBe(true);
    }
  });

  it("gives the same row the same stable id on every fetch", () => {
    const a = parseFirmsCsv(VIIRS_CSV, { product: "VIIRS_SNPP_NRT", retrievedAt: NOW.toISOString() });
    const b = parseFirmsCsv(VIIRS_CSV, { product: "VIIRS_SNPP_NRT", retrievedAt: "2026-11-07T15:00:00.000Z" });
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
    expect(a[0]?.id.startsWith("00000000-")).toBe(false);
  });

  it("keeps MODIS confidence as its 0-100 number and handles short acq_time values", () => {
    const [detection] = parseFirmsCsv(MODIS_CSV, { product: "MODIS_NRT", retrievedAt: NOW.toISOString() });
    expect(detection?.observedAt).toBe("2026-11-07T00:54:00.000Z");
    expect(detection?.evidence.confidence).toBe(62);
    expect(detection?.evidence.brightnessKelvin).toBe(322.5);
    expect(detection?.evidence.dayNight).toBe("night");
  });

  it("treats a header-only CSV as no detections", () => {
    const header = VIIRS_CSV.split("\n")[0]!;
    expect(parseFirmsCsv(header, { product: "VIIRS_SNPP_NRT", retrievedAt: NOW.toISOString() })).toEqual([]);
  });

  it("refuses a body that is not a FIRMS CSV, such as an invalid-key message", () => {
    expect(() =>
      parseFirmsCsv("Invalid MAP_KEY.", { product: "VIIRS_SNPP_NRT", retrievedAt: NOW.toISOString() }),
    ).toThrow(FirmsFormatError);
  });

  it("maps confidence without inventing probabilities", () => {
    expect(toConfidence("l")).toBe("low");
    expect(toConfidence("n")).toBe("nominal");
    expect(toConfidence("80")).toBe(80);
    expect(toConfidence("101")).toBeNull();
    expect(toConfidence("")).toBeNull();
    expect(toObservedAt("2026-11-07", "7")).toBe("2026-11-07T00:07:00.000Z");
    expect(toObservedAt("07/11/2026", "1200")).toBeNull();
  });
});

describe("bbox helpers", () => {
  it("formats west,south,east,north and checks containment and span", () => {
    expect(formatBbox(BBOX)).toBe("-2.15,53.25,-1.55,53.6");
    expect(bboxContains(BBOX, 53.4, -1.9)).toBe(true);
    expect(bboxContains(BBOX, 54, -1.9)).toBe(false);
    expect(bboxContains(null, 0, 0)).toBe(true);
    expect(isWithinFirmsSpan(BBOX)).toBe(true);
    expect(isWithinFirmsSpan({ minLongitude: -60, minLatitude: 0, maxLongitude: 0, maxLatitude: 10 })).toBe(true);
    expect(isWithinFirmsSpan({ minLongitude: -120, minLatitude: 0, maxLongitude: 0, maxLatitude: 10 })).toBe(false);
  });
});

describe("getThermalAnomalies", () => {
  beforeEach(() => clearFirmsCache());
  afterEach(() => vi.restoreAllMocks());

  it("is demo mode by default: synthetic fixtures checked as of SYNTHETIC_NOW", async () => {
    const fetchCsv = vi.fn();
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: {} }, { fetchCsv });
    expect(getFirmsMode({})).toBe("demo");
    // A configured key switches to live NASA data, unless demo is asked for explicitly.
    expect(getFirmsMode({ NASA_FIRMS_MAP_KEY: "abcdef0123456789abcd" })).toBe("live");
    expect(getFirmsMode({ NASA_FIRMS_MAP_KEY: "abcdef0123456789abcd", EMBERGAP_FIRMS_MODE: "demo" })).toBe("demo");
    expect(fetchCsv).not.toHaveBeenCalled();
    expect(result.detections.length).toBeGreaterThan(0);
    expect(result.detections.every((d) => d.isSynthetic && d.id.startsWith("00000000-"))).toBe(true);
    expect(sourceAvailabilitySchema.parse(result.availability)).toMatchObject({
      source: "firms",
      state: "available",
      checkedAt: SYNTHETIC_NOW,
    });
  });

  it("every fixture is valid FIRMS evidence observed before SYNTHETIC_NOW", () => {
    for (const detection of demoFirmsDetections()) {
      expect(firmsEvidenceSchema.safeParse(detection.evidence).success).toBe(true);
      expect(Date.parse(detection.observedAt)).toBeLessThan(Date.parse(SYNTHETIC_NOW));
    }
  });

  it("reports an empty area as not_observed with the window checked, never as negative", async () => {
    const empty = { minLongitude: 10, minLatitude: 10, maxLongitude: 11, maxLatitude: 11 };
    const result = await getThermalAnomalies({ bbox: empty, env: {} });
    const availability = sourceAvailabilitySchema.parse(result.availability);
    expect(availability.state).toBe("not_observed");
    expect(availability.windowStart).not.toBeNull();
    expect(availability.windowEnd).toBe(SYNTHETIC_NOW);
    expect(availability.message).toMatch(/not evidence of no fire/);
  });

  it("is unavailable, not fixtures, when live mode has no key", async () => {
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: { EMBERGAP_FIRMS_MODE: "live" } });
    expect(result.detections).toEqual([]);
    expect(sourceAvailabilitySchema.parse(result.availability)).toMatchObject({ state: "unavailable" });
    expect(result.availability.message).toMatch(/not set up/);
  });

  it("parses a live response, caches it, and reports availability", async () => {
    const fetchCsv = vi.fn().mockResolvedValue(VIIRS_CSV);
    const first = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    const second = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(first.detections).toHaveLength(2);
    expect(first.detections.every((d) => !d.isSynthetic)).toBe(true);
    expect(sourceAvailabilitySchema.parse(first.availability).state).toBe("available");
    expect(second).toBe(first);
    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(fetchCsv.mock.calls[0]?.[0]).toMatchObject({ product: "VIIRS_SNPP_NRT", dayRange: 1, bbox: BBOX });
  });

  it("turns a live failure into an honest unavailable state", async () => {
    const fetchCsv = vi.fn().mockRejectedValue(new IntegrationError("NASA FIRMS", "timeout", "NASA FIRMS: timed out"));
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(result.detections).toEqual([]);
    expect(result.availability).toMatchObject({ state: "unavailable", message: "NASA FIRMS took too long to respond." });
  });

  it("treats a non-CSV live body (for example a bad key) as unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchCsv = vi.fn().mockResolvedValue("Invalid MAP_KEY.");
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(result.availability.state).toBe("unavailable");
    expect(result.availability.message).toMatch(/unexpected/);
  });
});

describe("FIRMS client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the key in the path but never in logs or error messages", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response(`bad key ${KEY}`, { status: 400 }));
    const client = createFirmsClient(KEY, fetchImpl as unknown as typeof fetch);

    const error = await fetchFirmsCsv({ mapKey: KEY, product: "VIIRS_SNPP_NRT", bbox: BBOX, dayRange: 1, client }).catch(
      (caught: unknown) => caught,
    );

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/-2.15,53.25,-1.55,53.6/1`,
    );
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).message).not.toContain(KEY);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain(KEY);
  });
});
