// Open-Meteo weather context: normalised, source-specific types.
//
// Open-Meteo serves NUMERICAL WEATHER MODEL OUTPUT. None of it is a station
// measurement: observations only enter through model data assimilation. So
// every reading is labelled for what it is, and nothing is ever "observed":
// - `model_nowcast`:  the Forecast API's `current` block, model data for the
//                     current 15-minute slot
// - `model_estimate`: an hour before now, stitched from the first hours of
//                     earlier model runs (not a measurement, not reanalysis)
// - `forecast`:       the current hour onwards
// Values can change between calls as new model runs arrive. Weather is context
// for an investigation, never evidence that a fire exists or doesn't.
// Checked 7 Nov 2026: https://open-meteo.com/en/docs and /en/docs/historical-forecast-api
// The canonical shapes other workstreams consume are Observation and
// SourceAvailability from @/lib/embergap/contracts (see ./observations.ts).
// These types are the adapter's own richer view, kept for tests and the runtime.
import { z } from "zod";
import { provenanceSchema, type Provenance } from "@/lib/embergap/contracts";

/** CC BY 4.0 requires this credit, with a link to https://open-meteo.com/, wherever the data is shown. */
export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0), https://open-meteo.com/";

export function openMeteoProvenance(isSynthetic: boolean): Provenance {
  return {
    provider: "Open-Meteo",
    product: isSynthetic ? "forecast (synthetic fixture)" : "forecast",
    url: "https://open-meteo.com/en/docs",
    license: "CC BY 4.0: Weather data by Open-Meteo.com",
    isSynthetic,
  };
}

export const WEATHER_LIMITATIONS = [
  "Open-Meteo values are weather model output, not station measurements.",
  "Values are for the model grid cell, which can differ from the reported point.",
  "Weather is context only: it cannot confirm or rule out a fire.",
] as const;

export const WEATHER_READING_KINDS = ["model_nowcast", "model_estimate", "forecast"] as const;
export type WeatherReadingKind = (typeof WEATHER_READING_KINDS)[number];

const nullableNumber = z.number().nullable();

export const weatherReadingSchema = z.object({
  /** UTC ISO 8601. Instantaneous values are valid at this time. */
  validAt: z.string().max(40),
  kind: z.enum(WEATHER_READING_KINDS),
  /**
   * `hourly`: precipitation is the sum, and gusts the maximum, over the hour
   * ending at validAt. `15-minute`: the same over the 15 minutes before it.
   */
  aggregation: z.enum(["hourly", "15-minute"]),
  temperatureC: nullableNumber,
  relativeHumidityPct: nullableNumber,
  windSpeedKmh: nullableNumber,
  /** Where the wind blows FROM, in degrees (meteorological convention). */
  windDirectionDeg: nullableNumber,
  windGustsKmh: nullableNumber,
  precipitationMm: nullableNumber,
});
export type WeatherReading = z.infer<typeof weatherReadingSchema>;

export const weatherQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** The report's observation time, UTC ISO 8601. */
  timeOfInterest: z.string().max(40),
  /** Whole hours of readings before the time of interest. 24 or more gives a 24-hour rain total. */
  hoursBefore: z.number().int().min(0).max(72),
  /** Whole hours of readings after it (forecast when that is in the future). */
  hoursAfter: z.number().int().min(0).max(48),
});
export type WeatherQuery = z.infer<typeof weatherQuerySchema>;

/**
 * What the weather adapter returns. It never throws for an upstream failure:
 * - `available`: readings exist close to the time of interest
 * - `stale`: readings exist, but none within two hours of the time of interest
 * - `not_observed`: the API answered with no usable values (all null)
 * - `unavailable`: the API could not be read; `error` says why, safely
 */
export const weatherContextSchema = z.object({
  source: z.literal("weather"),
  query: weatherQuerySchema,
  sourceState: z.enum(["available", "stale", "not_observed", "unavailable"]),
  retrievedAt: z.string().max(40),
  fromCache: z.boolean(),
  /** The model grid cell Open-Meteo used, which is not the requested point. */
  gridCell: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      elevationM: z.number().nullable(),
      distanceKm: z.number().nonnegative(),
    })
    .nullable(),
  current: weatherReadingSchema.nullable(),
  /** Hourly readings, oldest first, index-aligned with the API's time axis. */
  readings: z.array(weatherReadingSchema).max(200),
  /** The hourly reading closest to the time of interest. */
  nearest: z
    .object({ validAt: z.string().max(40), offsetMinutes: z.number(), kind: z.enum(WEATHER_READING_KINDS) })
    .nullable(),
  limitations: z.array(z.string().max(300)).max(10),
  provenance: provenanceSchema,
  error: z.object({ kind: z.string().max(40), message: z.string().max(300) }).optional(),
});
export type WeatherContext = z.infer<typeof weatherContextSchema>;
