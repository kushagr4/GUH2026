import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_SCENARIOS } from "@/lib/embergap/contracts";
import {
  syntheticOpenMeteoResponse,
  syntheticWeatherContext,
  unavailableWeatherContext,
} from "@/lib/embergap/sources/weather/fixtures";
import { precipitationLast24h, weatherObservations } from "@/lib/embergap/sources/weather/observations";
import { classifyHour, normalizeOpenMeteo, openMeteoResponseSchema } from "@/lib/embergap/sources/weather/normalize";
import { createOpenMeteoClient, normalizeWeatherQuery } from "@/lib/embergap/sources/weather/open-meteo";
import { weatherContextSchema } from "@/lib/embergap/sources/weather/types";
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const hangUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));

const NOW = new Date("2026-11-07T12:00:00Z");
const QUERY = { latitude: 38.9512, longitude: -120.3487, timeOfInterest: "2026-11-07T11:40:00Z" };
const GRID = { latitude: 38.945057, longitude: -120.35684, elevation: 1789 };
const sleep = vi.fn(async () => {});

const fireWeather = () =>
  syntheticOpenMeteoResponse({
    startIso: "2026-11-07T05:00:00Z",
    hours: 13,
    profile: "fire-weather",
    currentIso: "2026-11-07T12:00:00Z",
    gridCell: GRID,
  });

function client(fetch: typeof globalThis.fetch, extra: Parameters<typeof createOpenMeteoClient>[0] = {}) {
  let clock = NOW.getTime();
  return {
    weather: createOpenMeteoClient({ fetch, sleep, now: () => new Date(clock), ...extra }),
    advance: (ms: number) => (clock += ms),
  };
}

beforeEach(() => {
  sleep.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Open-Meteo query rules", () => {
  it("rounds the point to about 1 km and fills in a window around the time of interest", () => {
    expect(normalizeWeatherQuery(QUERY, NOW)).toEqual({
      latitude: 38.95,
      longitude: -120.35,
      timeOfInterest: "2026-11-07T11:40:00.000Z",
      hoursBefore: 24,
      hoursAfter: 6,
    });
  });

  it("refuses bad coordinates, times and windows before any request", () => {
    expect(() => normalizeWeatherQuery({ ...QUERY, latitude: -91 }, NOW)).toThrow(IntegrationError);
    expect(() => normalizeWeatherQuery({ ...QUERY, timeOfInterest: "soon" }, NOW)).toThrow(/ISO 8601/);
    expect(() => normalizeWeatherQuery({ ...QUERY, timeOfInterest: "2026-01-01T00:00:00Z" }, NOW)).toThrow(/within/);
    expect(() => normalizeWeatherQuery({ ...QUERY, hoursBefore: 500 }, NOW)).toThrow(IntegrationError);
  });
});

describe("Open-Meteo readings", () => {
  it("labels past hours as model estimates and the current hour onwards as forecast, never as observed", () => {
    const retrieved = Date.parse("2026-11-07T12:20:00Z");
    expect(classifyHour(Date.parse("2026-11-07T11:00:00Z"), retrieved)).toBe("model_estimate");
    expect(classifyHour(Date.parse("2026-11-07T12:00:00Z"), retrieved)).toBe("forecast");
    expect(classifyHour(Date.parse("2026-11-07T13:00:00Z"), retrieved)).toBe("forecast");

    const query = normalizeWeatherQuery(QUERY, NOW);
    const context = normalizeOpenMeteo(fireWeather(), { query, retrievedAt: NOW.toISOString() });
    const kinds = new Set(context.readings.map((reading) => reading.kind));
    expect(kinds).toEqual(new Set(["model_estimate", "forecast"]));
    expect(context.current?.kind).toBe("model_nowcast");
    expect(context.current?.aggregation).toBe("15-minute");
    expect(JSON.stringify(context)).not.toMatch(/observed/);
  });

  it("converts unix seconds to UTC and keeps the requested point apart from the grid cell", () => {
    const query = normalizeWeatherQuery(QUERY, NOW);
    const context = normalizeOpenMeteo(fireWeather(), { query, retrievedAt: NOW.toISOString() });
    expect(context.readings[0].validAt).toBe("2026-11-07T05:00:00.000Z");
    expect(context.nearest).toEqual({ validAt: "2026-11-07T12:00:00.000Z", offsetMinutes: 20, kind: "forecast" });
    expect(context.gridCell).toMatchObject({ latitude: GRID.latitude, longitude: GRID.longitude, elevationM: 1789 });
    expect(context.gridCell?.distanceKm).toBeGreaterThan(0.5);
    expect(context.sourceState).toBe("available");
  });

  it("keeps nulls as missing data and reports an all-null answer as not observed", () => {
    const query = normalizeWeatherQuery(QUERY, NOW);
    const missing = syntheticOpenMeteoResponse({
      startIso: "2026-11-07T05:00:00Z",
      hours: 13,
      profile: "missing",
      currentIso: "2026-11-07T12:00:00Z",
      gridCell: GRID,
    });
    const context = normalizeOpenMeteo(missing, { query, retrievedAt: NOW.toISOString() });
    expect(context.sourceState).toBe("not_observed");
    expect(context.readings.every((reading) => reading.precipitationMm === null)).toBe(true);
    expect(context.current).toBeNull();
    expect(context.nearest).toBeNull();
  });

  it("marks readings far from the time of interest as stale", () => {
    const query = normalizeWeatherQuery({ ...QUERY, timeOfInterest: "2026-11-06T20:00:00Z" }, NOW);
    const context = normalizeOpenMeteo(fireWeather(), { query, retrievedAt: NOW.toISOString() });
    expect(context.sourceState).toBe("stale");
  });

  it("rejects hourly arrays that don't line up with the time axis", () => {
    const response = fireWeather();
    const broken = { ...response, hourly: { ...response.hourly, precipitation: [0] } };
    expect(openMeteoResponseSchema.safeParse(broken).success).toBe(false);
  });
});

describe("Open-Meteo client", () => {
  it("asks for a GMT window in unix time with explicit units, and returns labelled context", async () => {
    const { fetch, calls } = fakeFetch(json(fireWeather()));
    const context = await client(fetch).weather.getWeatherContext(QUERY);

    const url = calls[0];
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "38.95",
      longitude: "-120.35",
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
      hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
      start_hour: "2026-11-06T11:00",
      end_hour: "2026-11-07T17:00",
      timezone: "GMT",
      timeformat: "unixtime",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      precipitation_unit: "mm",
    });
    // Never the commercial key parameter, which redirects to the paid host.
    expect(url.searchParams.has("apikey")).toBe(false);

    expect(weatherContextSchema.parse(context)).toMatchObject({
      sourceState: "available",
      fromCache: false,
      provenance: { provider: "Open-Meteo", isSynthetic: false, license: expect.stringContaining("CC BY 4.0") },
    });
    expect(context.limitations.join(" ")).toMatch(/cannot confirm or rule out a fire/);
  });

  it("caches per rounded point and window, and expires", async () => {
    const { fetch, calls } = fakeFetch(json(fireWeather()), json(fireWeather()));
    const { weather, advance } = client(fetch);
    await weather.getWeatherContext(QUERY);
    await weather.getWeatherContext({ ...QUERY, latitude: 38.9549 });
    expect(calls).toHaveLength(1);
    expect((await weather.getWeatherContext(QUERY)).fromCache).toBe(true);
    advance(15 * 60_000 + 1);
    await weather.getWeatherContext(QUERY);
    expect(calls).toHaveLength(2);
  });

  it("maps Open-Meteo's 400 error body to a safe unavailable result without echoing the reason", async () => {
    const { fetch } = fakeFetch(json({ error: true, reason: "Cannot initialize WeatherVariable from invalid String value" }, 400));
    const context = await client(fetch).weather.getWeatherContext(QUERY);
    expect(context).toMatchObject({ sourceState: "unavailable", readings: [], error: { kind: "bad_request" } });
    expect(context.error?.message).not.toMatch(/initialize/);
  });

  it("retries a 503 with backoff, then degrades instead of throwing", async () => {
    const { fetch, calls } = fakeFetch(json({}, 503), json({}, 503), json({}, 503));
    const context = await client(fetch).weather.getWeatherContext(QUERY);
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "upstream" } });
  });

  it("fails fast on a long Retry-After instead of waiting", async () => {
    const { fetch, calls } = fakeFetch(json({ error: true, reason: "Minutely API request limit exceeded" }, 429, { "retry-after": "60" }));
    const context = await client(fetch).weather.getWeatherContext(QUERY);
    expect(calls).toHaveLength(1);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "rate_limited" } });
  });

  it("times out instead of hanging", async () => {
    const { fetch } = fakeFetch(hangUntilAborted, hangUntilAborted, hangUntilAborted);
    const context = await client(fetch, { timeoutMs: 20 }).weather.getWeatherContext(QUERY);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "timeout" } });
  });

  it("treats truncated JSON as an upstream failure", async () => {
    const truncated = new Response('{"latitude":38.9,"hourly":{"time":[1,2', { status: 200 });
    const { fetch } = fakeFetch(truncated);
    const context = await client(fetch).weather.getWeatherContext(QUERY);
    expect(context).toMatchObject({ sourceState: "unavailable", error: { kind: "invalid_response" } });
  });

  it("throws for invalid input, which is a bug in the caller", async () => {
    const { fetch, calls } = fakeFetch();
    await expect(client(fetch).weather.getWeatherContext({ ...QUERY, longitude: 200 })).rejects.toThrow(IntegrationError);
    expect(calls).toHaveLength(0);
  });
});

describe("Open-Meteo synthetic fixtures", () => {
  it("are labelled synthetic and match the live context shape", () => {
    const query = normalizeWeatherQuery(QUERY, NOW);
    const context = syntheticWeatherContext(query, fireWeather(), { retrievedAt: NOW.toISOString() });
    expect(weatherContextSchema.parse(context).provenance).toMatchObject({ isSynthetic: true });
  });
});

describe("Open-Meteo as canonical observations", () => {
  const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === "partition-recovery")!;
  const query = normalizeWeatherQuery(
    { latitude: scenario.report.latitude, longitude: scenario.report.longitude, timeOfInterest: scenario.report.observedAt },
    NOW,
  );
  const dayOfReadings = (profile: "fire-weather" | "damp") =>
    syntheticWeatherContext(
      query,
      syntheticOpenMeteoResponse({
        startIso: "2026-11-06T11:00:00Z",
        hours: 31,
        profile,
        currentIso: "2026-11-07T12:00:00Z",
        gridCell: { latitude: 53.46, longitude: -1.85, elevation: 400 },
      }),
      { retrievedAt: NOW.toISOString() },
    );

  it("emits the reading nearest the report as one modelled observation, never observed", () => {
    const { observations, availability } = weatherObservations(dayOfReadings("fire-weather"), { investigationId: scenario.investigationId });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      source: "weather",
      sourceState: "available",
      observedAt: "2026-11-07T12:00:00.000Z",
      evidence: { kind: "forecast", validAt: "2026-11-07T12:00:00.000Z", precipitationMm: 0 },
      provenance: { isSynthetic: true },
    });
    expect(availability).toMatchObject({ source: "weather", state: "available", maxAgeSeconds: 3 * 3600 });
  });

  it("sums precipitation over the 24 hours ending at the reading, or reports null when hours are missing", () => {
    const context = dayOfReadings("damp");
    expect(precipitationLast24h(context.readings, "2026-11-07T10:00:00.000Z")).toBeGreaterThan(24);
    expect(precipitationLast24h(context.readings, "2026-11-06T20:00:00.000Z")).toBeNull();
  });

  it("maps a failure to an unavailable observation with no evidence", () => {
    const { observations, availability } = weatherObservations(unavailableWeatherContext(query, { retrievedAt: NOW.toISOString() }), {
      investigationId: scenario.investigationId,
    });
    expect(observations).toEqual([expect.objectContaining({ sourceState: "unavailable", evidence: null, observedAt: null })]);
    expect(availability).toMatchObject({ state: "unavailable", message: "Open-Meteo took too long to respond." });
  });
});
