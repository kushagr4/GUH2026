import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEonetClient, normalizeEonetQuery } from "@/lib/embergap/sources/eonet/eonet";
import { SYNTHETIC_SCENARIOS, isSyntheticId } from "@/lib/embergap/contracts";
import {
  SYNTHETIC_EONET_EMPTY_RESPONSE,
  SYNTHETIC_EONET_RESPONSE,
  syntheticEonetContext,
  unavailableEonetContext,
} from "@/lib/embergap/sources/eonet/fixtures";
import { eonetObservations } from "@/lib/embergap/sources/eonet/observations";
import {
  eonetBbox,
  eonetWindow,
  isValidDay,
  matchEvents,
  toEventRecords,
} from "@/lib/embergap/sources/eonet/normalize";
import { eonetContextSchema } from "@/lib/embergap/sources/eonet/types";
import { haversineKm } from "@/lib/embergap/agents/runtime/geo";
import { IntegrationError } from "@/lib/integrations/errors";

// No test here touches the network: every request goes to a fake fetch.
type Reply = Response | Error | ((init: RequestInit) => Promise<Response>);

function fakeFetch(...replies: Reply[]) {
  const calls: URL[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push(new URL(String(input)));
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected extra fetch");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(init) : reply;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const hangUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));

const NOW = new Date("2026-11-07T12:00:00Z");
const QUERY = { latitude: 53.46, longitude: -1.85, radiusKm: 50, start: "2026-10-24", end: "2026-11-08" };
const sleep = vi.fn(async () => {});

function client(fetch: typeof globalThis.fetch, extra: Parameters<typeof createEonetClient>[0] = {}) {
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  const advance = (ms: number) => (clock += ms);
  return { eonet: createEonetClient({ fetch, sleep, now, ...extra }), advance };
}

beforeEach(() => {
  sleep.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("EONET query rules", () => {
  it("checks coordinates, real dates and the window before any request", () => {
    expect(() => normalizeEonetQuery({ ...QUERY, latitude: 91 })).toThrow(IntegrationError);
    expect(() => normalizeEonetQuery({ ...QUERY, longitude: -181 })).toThrow(IntegrationError);
    expect(() => normalizeEonetQuery({ ...QUERY, start: "2026-02-30" })).toThrow(/real dates/);
    expect(() => normalizeEonetQuery({ ...QUERY, start: "2026-11-09", end: "2026-11-01" })).toThrow(/window/);
    expect(() => normalizeEonetQuery({ ...QUERY, start: "2024-01-01" })).toThrow(/window/);
    expect(() => normalizeEonetQuery({ ...QUERY, radiusKm: 0 })).toThrow(IntegrationError);
  });

  it("rounds the point to about 1 km, for privacy and so nearby reports share a cache entry", () => {
    expect(normalizeEonetQuery({ ...QUERY, latitude: 53.46049, longitude: -1.84951 })).toMatchObject({
      latitude: 53.46,
      longitude: -1.85,
      limit: 50,
    });
  });

  it("validates calendar days strictly", () => {
    expect(isValidDay("2026-11-07")).toBe(true);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("7 Nov 2026")).toBe(false);
  });

  it("builds a window around an observation time", () => {
    // EONET only matches records dated inside the window, so it looks 60 days back.
    expect(eonetWindow("2026-11-07T11:40:00Z")).toEqual({ start: "2026-09-08", end: "2026-11-08" });
    expect(eonetWindow("2026-11-07T11:40:00Z", { daysBefore: 14 })).toEqual({ start: "2026-10-24", end: "2026-11-08" });
    expect(() => eonetWindow("yesterday")).toThrow(RangeError);
  });
});

describe("EONET bbox", () => {
  it("uses EONET's order: min_lon, max_lat, max_lon, min_lat", () => {
    const [minLon, maxLat, maxLon, minLat] = eonetBbox(QUERY).split(",").map(Number);
    expect(minLon).toBeLessThan(QUERY.longitude);
    expect(maxLon).toBeGreaterThan(QUERY.longitude);
    expect(maxLat).toBeGreaterThan(QUERY.latitude);
    expect(minLat).toBeLessThan(QUERY.latitude);
    // Padded to the radius in both directions.
    expect(haversineKm(QUERY.latitude, QUERY.longitude, maxLat, QUERY.longitude)).toBeCloseTo(50, 0);
    expect(haversineKm(QUERY.latitude, QUERY.longitude, QUERY.latitude, maxLon)).toBeGreaterThan(49);
  });

  it("clamps at the poles and the antimeridian instead of producing invalid numbers", () => {
    const [minLon, maxLat, maxLon, minLat] = eonetBbox({ latitude: 89.9, longitude: 179.9, radiusKm: 100 })
      .split(",")
      .map(Number);
    expect(maxLat).toBeLessThanOrEqual(90);
    expect(minLat).toBeGreaterThan(80);
    expect(maxLon).toBeLessThanOrEqual(180);
    expect(minLon).toBeGreaterThanOrEqual(-180);
  });
});

describe("EONET records", () => {
  it("reads [lon, lat] points the right way round", () => {
    const [ridge] = toEventRecords(SYNTHETIC_EONET_RESPONSE);
    expect(ridge).toMatchObject({ id: "EONET_990001", closedAt: null, prescribedBurnLikely: false });
    expect(ridge.geometry[0]).toMatchObject({ shape: "point", latitude: 53.47, longitude: -1.84 });
    expect(ridge.geometry[0].magnitude).toEqual({ value: 780, unit: "acres" });
  });

  it("uses the centre of a polygon's outer ring and skips unusable geometry and other categories", () => {
    const records = toEventRecords({
      events: [
        {
          id: "EONET_1",
          title: "Polygon fire",
          link: "x",
          categories: [{ id: "wildfires" }],
          sources: [],
          geometry: [
            { date: "2026-11-06T00:00:00Z", type: "Polygon", coordinates: [[[-1, 1], [1, 1], [1, -1], [-1, -1]]] },
            { date: "not a date", type: "Point", coordinates: [0, 0] },
            { date: "2026-11-06T00:00:00Z", type: "LineString", coordinates: [[0, 0], [1, 1]] },
          ],
        },
        { id: "EONET_2", title: "Storm", link: "x", categories: [{ id: "severeStorms" }], sources: [], geometry: [] },
        { id: "EONET_3", title: "No geometry", link: "x", categories: [{ id: "wildfires" }], sources: [], geometry: [] },
      ],
    });
    expect(records.map((record) => record.id)).toEqual(["EONET_1"]);
    expect(records[0].geometry).toEqual([
      { date: "2026-11-06T00:00:00Z", shape: "polygon", latitude: 0, longitude: 0, magnitude: null },
    ]);
  });

  it("matches by radius and date, nearest first, and returns nothing rather than a negative", () => {
    const query = normalizeEonetQuery(QUERY);
    const records = toEventRecords(SYNTHETIC_EONET_RESPONSE);
    const matches = matchEvents(records, query);
    expect(matches.map((match) => match.event.id)).toEqual(["EONET_990001"]);
    expect(matches[0].distanceKm).toBeGreaterThan(0);
    expect(matches[0].distanceKm).toBeLessThan(10);
    expect(matchEvents(records, { ...query, start: "2026-11-07", end: "2026-11-08" })).toEqual([]);
  });
});

describe("EONET client", () => {
  it("sends a validated wildfire query and returns matching context", async () => {
    const { fetch, calls } = fakeFetch(json(SYNTHETIC_EONET_RESPONSE));
    const context = await client(fetch).eonet.getWildfireContext(QUERY);

    const url = calls[0];
    expect(url.origin + url.pathname).toBe("https://eonet.gsfc.nasa.gov/api/v3/events");
    expect(url.searchParams.get("category")).toBe("wildfires");
    expect(url.searchParams.get("status")).toBe("all");
    expect(url.searchParams.get("start")).toBe("2026-10-24");
    expect(url.searchParams.get("end")).toBe("2026-11-08");
    expect(url.searchParams.get("bbox")).toBe(eonetBbox(normalizeEonetQuery(QUERY)));
    expect(url.searchParams.get("limit")).toBe("50");

    expect(eonetContextSchema.parse(context)).toMatchObject({
      sourceState: "available",
      fromCache: false,
      recordsInBox: 2,
      possiblyTruncated: false,
      retrievedAt: NOW.toISOString(),
      provenance: { provider: "NASA EONET", isSynthetic: false },
    });
    expect(context.matches).toHaveLength(1);
    expect(context.limitations.join(" ")).toMatch(/does not mean there is no fire/);
  });

  it("reports no record as not observed, never as evidence of no fire", async () => {
    const { fetch } = fakeFetch(json(SYNTHETIC_EONET_EMPTY_RESPONSE));
    const context = await client(fetch).eonet.getWildfireContext(QUERY);
    expect(context.sourceState).toBe("not_observed");
    expect(context.matches).toEqual([]);
    expect(context.error).toBeUndefined();
  });

  it("caches answers as copies, and expires the cache", async () => {
    const { fetch, calls } = fakeFetch(json(SYNTHETIC_EONET_RESPONSE), json(SYNTHETIC_EONET_RESPONSE));
    const { eonet, advance } = client(fetch);
    const first = await eonet.getWildfireContext(QUERY);
    first.matches.length = 0;
    const second = await eonet.getWildfireContext(QUERY);
    expect(calls).toHaveLength(1);
    expect(second.fromCache).toBe(true);
    expect(second.matches).toHaveLength(1);
    advance(10 * 60_000 + 1);
    expect((await eonet.getWildfireContext(QUERY)).fromCache).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("retries a 5xx once, then degrades to unavailable with a safe message", async () => {
    const { fetch, calls } = fakeFetch(json({ error: "boom" }, 503), json({ error: "boom" }, 503));
    const context = await client(fetch).eonet.getWildfireContext(QUERY);
    expect(calls).toHaveLength(2);
    expect(context).toMatchObject({ sourceState: "unavailable", matches: [], error: { kind: "upstream" } });
    expect(context.error?.message).not.toMatch(/boom/);
  });

  it("does not cache a failure", async () => {
    const { fetch, calls } = fakeFetch(json({}, 500), json({}, 500), json(SYNTHETIC_EONET_RESPONSE));
    const { eonet } = client(fetch);
    expect((await eonet.getWildfireContext(QUERY)).sourceState).toBe("unavailable");
    expect((await eonet.getWildfireContext(QUERY)).sourceState).toBe("available");
    expect(calls).toHaveLength(3);
  });

  it("times out instead of hanging", async () => {
    const { fetch } = fakeFetch(hangUntilAborted, hangUntilAborted);
    const context = await client(fetch, { timeoutMs: 20 }).eonet.getWildfireContext(QUERY);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "timeout" } });
  });

  it("treats a response without an events array as invalid, not as empty", async () => {
    const { fetch } = fakeFetch(json({ title: "EONET Events" }));
    const context = await client(fetch).eonet.getWildfireContext(QUERY);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "invalid_response" } });
  });

  it("holds requests back with its own rate limit before EONET's", async () => {
    const replies = Array.from({ length: 30 }, () => json(SYNTHETIC_EONET_EMPTY_RESPONSE));
    const { fetch, calls } = fakeFetch(...replies);
    const { eonet } = client(fetch);
    for (let index = 0; index < 30; index += 1) {
      await eonet.getWildfireContext({ ...QUERY, latitude: 30 + index * 0.01 });
    }
    const limited = await eonet.getWildfireContext({ ...QUERY, latitude: 10 });
    expect(calls).toHaveLength(30);
    expect(limited).toMatchObject({ sourceState: "unavailable", error: { kind: "rate_limited" } });
  });

  it("throws for invalid input, which is a bug in the caller", async () => {
    const { fetch, calls } = fakeFetch();
    await expect(client(fetch).eonet.getWildfireContext({ ...QUERY, latitude: Number.NaN })).rejects.toThrow(IntegrationError);
    expect(calls).toHaveLength(0);
  });
});

describe("EONET synthetic fixtures", () => {
  it("are labelled synthetic everywhere and match the live context shape", () => {
    const context = syntheticEonetContext(normalizeEonetQuery(QUERY), SYNTHETIC_EONET_RESPONSE, { retrievedAt: NOW.toISOString() });
    expect(eonetContextSchema.parse(context).provenance).toMatchObject({ isSynthetic: true });
    for (const event of SYNTHETIC_EONET_RESPONSE.events) expect(event.title).toContain("SYNTHETIC");
  });

  it("flags titles that look like prescribed burns", () => {
    const [record] = toEventRecords({
      events: [
        {
          id: "EONET_7",
          title: "BFR Unit 9 RX Wildfire, Demo, Texas",
          link: "x",
          categories: [{ id: "wildfires" }],
          sources: [],
          geometry: [{ date: "2026-11-06T00:00:00Z", type: "Point", coordinates: [0, 0] }],
        },
      ],
    });
    expect(record.prescribedBurnLikely).toBe(true);
  });
});

describe("EONET as canonical observations", () => {
  const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === "partition-recovery")!;
  const input = { investigationId: scenario.investigationId, timeOfInterest: scenario.report.observedAt };
  const query = normalizeEonetQuery(QUERY);

  it("maps a matching record to one validated observation with a synthetic id", () => {
    const context = syntheticEonetContext(query, SYNTHETIC_EONET_RESPONSE, { retrievedAt: NOW.toISOString() });
    const { observations, availability } = eonetObservations(context, input);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      source: "eonet",
      sourceState: "available",
      sourceRecordId: "EONET_990001",
      evidence: { eventId: "EONET_990001", categories: ["wildfires"], closedAt: null },
      provenance: { isSynthetic: true },
    });
    expect(isSyntheticId(observations[0].id)).toBe(true);
    expect(availability).toMatchObject({ source: "eonet", state: "available", message: null });
  });

  it("maps no match to not_observed with the window that was checked, never a negative", () => {
    const context = syntheticEonetContext(query, SYNTHETIC_EONET_EMPTY_RESPONSE, { retrievedAt: NOW.toISOString() });
    const { observations, availability } = eonetObservations(context, input);
    expect(observations).toEqual([
      expect.objectContaining({
        sourceState: "not_observed",
        evidence: null,
        observedAt: null,
        coverage: expect.objectContaining({ radiusKm: 50 }),
      }),
    ]);
    expect(availability.state).toBe("not_observed");
    expect(availability.message).toMatch(/not evidence that there is no fire/);
  });

  it("maps a failure to unavailable with no evidence and a safe message", () => {
    const context = unavailableEonetContext(query, { retrievedAt: NOW.toISOString() });
    const { observations, availability } = eonetObservations(context, input);
    expect(observations).toEqual([expect.objectContaining({ sourceState: "unavailable", evidence: null, observedAt: null })]);
    expect(availability).toMatchObject({ state: "unavailable", message: "NASA EONET took too long to respond." });
  });

  it("gives the same record the same id on every call", () => {
    const context = syntheticEonetContext(query, SYNTHETIC_EONET_RESPONSE, { retrievedAt: NOW.toISOString() });
    expect(eonetObservations(context, input).observations[0].id).toBe(eonetObservations(context, input).observations[0].id);
  });
});
