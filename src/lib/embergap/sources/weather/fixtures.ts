// SYNTHETIC Open-Meteo fixtures: invented values in the shape of the live
// Forecast API response (checked 7 Nov 2026, timeformat=unixtime), for tests
// and the offline demo. They describe no real place or time, and their
// provenance has isSynthetic: true, so they can never pass for model data.
import { OPEN_METEO_VARIABLES, normalizeOpenMeteo, type OpenMeteoResponse } from "./normalize";
import { WEATHER_LIMITATIONS, openMeteoProvenance, type WeatherContext, type WeatherQuery } from "./types";

/**
 * - `fire-weather`: warm, very dry and windy, the conditions that help a fire spread
 * - `damp`: cool, humid, calm and raining. Still never evidence of "no fire"
 * - `missing`: every value null, as Open-Meteo returns past a dataset's horizon
 */
export type SyntheticWeatherProfile = "fire-weather" | "damp" | "missing";

const PROFILES: Record<Exclude<SyntheticWeatherProfile, "missing">, (hour: number) => Record<string, number>> = {
  "fire-weather": (hour) => ({
    temperature_2m: 24 + (hour % 6) * 0.5,
    relative_humidity_2m: 12 + (hour % 3),
    wind_speed_10m: 30 + (hour % 4) * 2,
    wind_direction_10m: 225 + (hour % 3) * 5,
    wind_gusts_10m: 52 + (hour % 4) * 3,
    precipitation: 0,
  }),
  damp: (hour) => ({
    temperature_2m: 9 + (hour % 4) * 0.25,
    relative_humidity_2m: 92 + (hour % 3),
    wind_speed_10m: 4 + (hour % 2),
    wind_direction_10m: 90 + (hour % 4) * 10,
    wind_gusts_10m: 9 + (hour % 3),
    precipitation: 1.2 + (hour % 2) * 0.4,
  }),
};

export function syntheticOpenMeteoResponse(options: {
  /** First hour, UTC ISO 8601, on the hour. */
  startIso: string;
  hours: number;
  profile: SyntheticWeatherProfile;
  /** Current-slot time, UTC ISO 8601. */
  currentIso: string;
  gridCell: { latitude: number; longitude: number; elevation: number };
}): OpenMeteoResponse {
  const start = Date.parse(options.startIso) / 1000;
  const time = Array.from({ length: options.hours }, (_, index) => start + index * 3600);
  const valuesAt = (index: number) =>
    options.profile === "missing" ? null : PROFILES[options.profile](index);
  const hourly: OpenMeteoResponse["hourly"] = { time };
  for (const name of OPEN_METEO_VARIABLES) {
    hourly[name] = time.map((_, index) => valuesAt(index)?.[name] ?? null);
  }
  const currentValues = valuesAt(Math.floor(options.hours / 2));
  return {
    latitude: options.gridCell.latitude,
    longitude: options.gridCell.longitude,
    elevation: options.gridCell.elevation,
    current: {
      time: Date.parse(options.currentIso) / 1000,
      interval: 900,
      ...Object.fromEntries(OPEN_METEO_VARIABLES.map((name) => [name, currentValues?.[name] ?? null])),
    },
    hourly,
  };
}

/** Builds the context the live adapter would return, from a synthetic response. */
export function syntheticWeatherContext(
  query: WeatherQuery,
  response: OpenMeteoResponse,
  options: { retrievedAt: string },
): WeatherContext {
  return {
    source: "weather",
    query,
    retrievedAt: options.retrievedAt,
    fromCache: false,
    limitations: [...WEATHER_LIMITATIONS],
    provenance: openMeteoProvenance(true),
    ...normalizeOpenMeteo(response, { query, retrievedAt: options.retrievedAt }),
  };
}

/** Open-Meteo could not be reached: honest unavailability, no invented values. */
export function unavailableWeatherContext(
  query: WeatherQuery,
  options: { retrievedAt: string; kind?: string },
): WeatherContext {
  return {
    source: "weather",
    query,
    sourceState: "unavailable",
    retrievedAt: options.retrievedAt,
    fromCache: false,
    gridCell: null,
    current: null,
    readings: [],
    nearest: null,
    limitations: [...WEATHER_LIMITATIONS],
    provenance: openMeteoProvenance(true),
    error: { kind: options.kind ?? "timeout", message: "Open-Meteo took too long to respond." },
  };
}
