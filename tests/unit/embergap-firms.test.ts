import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "@/lib/integrations/errors";
import { parseBbox } from "@/lib/embergap/sources/firms/bbox";
import { createFirmsClient, fetchFirmsCsv, getFirmsMode } from "@/lib/embergap/sources/firms/client";
import { clearFirmsCache, getThermalAnomalies } from "@/lib/embergap/sources/firms";
import { FirmsFormatError, parseFirmsCsv, toConfidence, toObservedAt } from "@/lib/embergap/sources/firms/parse";

const NOW = new Date("2026-11-07T14:00:00Z");
const BBOX = { minLon: -2.15, minLat: 53.25, maxLon: -1.55, maxLat: 53.6 };
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
  it("parses VIIRS rows by header name, deduplicates and skips bad rows", () => {
    const detections = parseFirmsCsv(VIIRS_CSV, { product: "VIIRS_SNPP_NRT", retrievedAt: NOW.toISOString() });
    expect(detections).toHaveLength(2);
    expect(detections[0]).toMatchObject({
      latitude: 53.4561,
      longitude: -1.8724,
      observedAt: "2026-11-07T13:12:00.000Z",
      confidence: "high",
      confidenceRaw: "h",
      frpMw: 6.4,
      brightnessK: 338.2,
      dayNight: "day",
      synthetic: false,
    });
  });

  it("parses MODIS numeric confidence and short acq_time values", () => {
    const [detection] = parseFirmsCsv(MODIS_CSV, { product: "MODIS_NRT", retrievedAt: NOW.toISOString() });
    expect(detection?.observedAt).toBe("2026-11-07T00:54:00.000Z");
    expect(detection?.confidence).toBe("nominal");
    expect(detection?.brightnessK).toBe(322.5);
    expect(detection?.dayNight).toBe("night");
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

  it("maps confidence classes without inventing probabilities", () => {
    expect(toConfidence("l")).toBe("low");
    expect(toConfidence("29")).toBe("low");
    expect(toConfidence("30")).toBe("nominal");
    expect(toConfidence("80")).toBe("high");
    expect(toConfidence("101")).toBeNull();
    expect(toConfidence("")).toBeNull();
    expect(toObservedAt("2026-11-07", "7")).toBe("2026-11-07T00:07:00.000Z");
    expect(toObservedAt("07/11/2026", "1200")).toBeNull();
  });
});

describe("parseBbox", () => {
  it("accepts minLon,minLat,maxLon,maxLat", () => {
    expect(parseBbox("-2.15,53.25,-1.55,53.6")).toEqual({ ok: true, bbox: BBOX });
  });

  it.each([
    ["missing", null],
    ["three numbers", "1,2,3"],
    ["text", "a,b,c,d"],
    ["inverted", "-1.55,53.25,-2.15,53.6"],
    ["off the globe", "-190,10,-170,20"],
    ["too large", "-60,10,0,20"],
    ["exponent notation", "1e1,2,3,4"],
  ])("refuses %s", (_label, raw) => {
    expect(parseBbox(raw).ok).toBe(false);
  });
});

describe("getThermalAnomalies", () => {
  beforeEach(() => clearFirmsCache());
  afterEach(() => vi.restoreAllMocks());

  it("is demo mode by default, with labelled synthetic detections inside the box", async () => {
    const fetchCsv = vi.fn();
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: {} }, { fetchCsv });
    expect(getFirmsMode({})).toBe("demo");
    expect(fetchCsv).not.toHaveBeenCalled();
    expect(result.mode).toBe("demo");
    expect(result.sourceState).toBe("available");
    expect(result.detections.length).toBeGreaterThan(0);
    expect(result.detections.every((d) => d.synthetic)).toBe(true);
    expect(result.limitations.join(" ")).toMatch(/synthetic/i);
    // The 5-hour-old night detection is inside a 1-day range; Sierra ones are outside the box.
    expect(result.detections.every((d) => d.longitude > -3 && d.longitude < -1)).toBe(true);
  });

  it("reports an empty area as not_observed, never as a negative result", async () => {
    const empty = { minLon: 10, minLat: 10, maxLon: 11, maxLat: 11 };
    const result = await getThermalAnomalies({ bbox: empty, now: NOW, env: {} });
    expect(result.sourceState).toBe("not_observed");
    expect(result.limitations.join(" ")).toMatch(/does not mean no fire/);
  });

  it("is unavailable, not fixtures, when live mode has no key", async () => {
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: { EMBERGAP_FIRMS_MODE: "live" } });
    expect(result).toMatchObject({ mode: "live", sourceState: "unavailable", detections: [] });
    expect(result.error).toMatch(/not set up/);
  });

  it("parses a live response and caches it", async () => {
    const fetchCsv = vi.fn().mockResolvedValue(VIIRS_CSV);
    const first = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    const second = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(first.mode).toBe("live");
    expect(first.sourceState).toBe("available");
    expect(first.detections).toHaveLength(2);
    expect(second).toBe(first);
    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(fetchCsv.mock.calls[0]?.[0]).toMatchObject({ product: "VIIRS_SNPP_NRT", dayRange: 1, bbox: BBOX });
  });

  it("turns a live failure into an honest unavailable state", async () => {
    const fetchCsv = vi.fn().mockRejectedValue(new IntegrationError("NASA FIRMS", "timeout", "NASA FIRMS: timed out"));
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(result).toMatchObject({ sourceState: "unavailable", detections: [] });
    expect(result.error).toBe("NASA FIRMS took too long to respond.");
  });

  it("treats a non-CSV live body (for example a bad key) as unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchCsv = vi.fn().mockResolvedValue("Invalid MAP_KEY.");
    const result = await getThermalAnomalies({ bbox: BBOX, now: NOW, env: LIVE_ENV }, { fetchCsv });
    expect(result.sourceState).toBe("unavailable");
    expect(result.error).toMatch(/unexpected/);
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

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/-2.15,53.25,-1.55,53.6/1`,
    );
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as IntegrationError).message).not.toContain(KEY);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain(KEY);
  });
});
