// Pure Open-Meteo helpers: the response schema and the mapping to labelled,
// UTC readings. No network, so they are unit-tested directly and safe to load
// in the runtime's worker threads.
import { z } from "zod";
import { haversineKm } from "../../agents/runtime/geo";
import type { WeatherContext, WeatherQuery, WeatherReading, WeatherReadingKind } from "./types";

/** The six variables we ask for, current and hourly (cost: 1.2 calls). */
export const OPEN_METEO_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "precipitation",
] as const;
type Variable = (typeof OPEN_METEO_VARIABLES)[number];

const value = z.number().nullable().optional();
const series = z.array(z.number().nullable()).max(500).optional();
const variables = <T extends z.ZodType>(schema: T) =>
  Object.fromEntries(OPEN_METEO_VARIABLES.map((name) => [name, schema])) as Record<Variable, T>;

// With timeformat=unixtime every time is integer seconds since the epoch, UTC.
export const openMeteoResponseSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    elevation: z.number().optional(),
    current: z.object({ time: z.number().int(), interval: z.number().int().positive(), ...variables(value) }).optional(),
    hourly: z.object({ time: z.array(z.number().int()).max(500), ...variables(series) }),
  })
  .superRefine((response, ctx) => {
    for (const name of OPEN_METEO_VARIABLES) {
      const column = response.hourly[name];
      if (column && column.length !== response.hourly.time.length) {
        ctx.addIssue({ code: "custom", message: "hourly arrays must align with time", path: ["hourly", name] });
      }
    }
  });
export type OpenMeteoResponse = z.infer<typeof openMeteoResponseSchema>;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const HOUR_MS = 3_600_000;

/** Past hours are model estimates; the current hour onwards is forecast. */
export function classifyHour(validAtMs: number, retrievedAtMs: number): WeatherReadingKind {
  const currentHourStart = Math.floor(retrievedAtMs / HOUR_MS) * HOUR_MS;
  return validAtMs < currentHourStart ? "model_estimate" : "forecast";
}

function readingAt(
  source: Partial<Record<Variable, number | null | undefined>>,
  validAt: string,
  kind: WeatherReadingKind,
  aggregation: WeatherReading["aggregation"],
): WeatherReading {
  // Missing stays missing: null is "no data", never zero rain or calm air.
  const read = (name: Variable) => source[name] ?? null;
  return {
    validAt,
    kind,
    aggregation,
    temperatureC: read("temperature_2m"),
    relativeHumidityPct: read("relative_humidity_2m"),
    windSpeedKmh: read("wind_speed_10m"),
    windDirectionDeg: read("wind_direction_10m"),
    windGustsKmh: read("wind_gusts_10m"),
    precipitationMm: read("precipitation"),
  };
}

const hasData = (reading: WeatherReading) =>
  [
    reading.temperatureC,
    reading.relativeHumidityPct,
    reading.windSpeedKmh,
    reading.windDirectionDeg,
    reading.windGustsKmh,
    reading.precipitationMm,
  ].some((item) => item !== null);

/** Readings within this of the time of interest count as current context. */
export const STALE_AFTER_MINUTES = 120;

/** Maps a validated response to labelled readings. Provenance is the caller's. */
export function normalizeOpenMeteo(
  response: OpenMeteoResponse,
  options: { query: WeatherQuery; retrievedAt: string },
): Pick<WeatherContext, "sourceState" | "gridCell" | "current" | "readings" | "nearest"> {
  const retrievedAtMs = Date.parse(options.retrievedAt);
  const interestMs = Date.parse(options.query.timeOfInterest);

  const readings = response.hourly.time.map((seconds, index) => {
    const row = Object.fromEntries(OPEN_METEO_VARIABLES.map((name) => [name, response.hourly[name]?.[index]]));
    return readingAt(row, iso(seconds), classifyHour(seconds * 1000, retrievedAtMs), "hourly");
  });
  const current = response.current
    ? readingAt(response.current, iso(response.current.time), "model_nowcast", response.current.interval === 900 ? "15-minute" : "hourly")
    : null;

  let nearest: WeatherContext["nearest"] = null;
  for (const reading of readings) {
    if (!hasData(reading)) continue;
    const offsetMinutes = Math.round((Date.parse(reading.validAt) - interestMs) / 60_000);
    if (!nearest || Math.abs(offsetMinutes) < Math.abs(nearest.offsetMinutes)) {
      nearest = { validAt: reading.validAt, offsetMinutes, kind: reading.kind };
    }
  }

  const anyData = readings.some(hasData) || (current !== null && hasData(current));
  const sourceState: WeatherContext["sourceState"] = !anyData
    ? "not_observed"
    : !nearest || Math.abs(nearest.offsetMinutes) > STALE_AFTER_MINUTES
      ? "stale"
      : "available";

  return {
    sourceState,
    gridCell: {
      latitude: response.latitude,
      longitude: response.longitude,
      elevationM: response.elevation ?? null,
      distanceKm:
        Math.round(haversineKm(options.query.latitude, options.query.longitude, response.latitude, response.longitude) * 100) / 100,
    },
    current: current && hasData(current) ? current : null,
    readings,
    nearest,
  };
}
