import { stableId } from "@/lib/embergap/contracts";
import type { FirmsDetection, FirmsEvidence, FirmsSource } from "./types";

/** The body did not look like a FIRMS CSV, for example "Invalid MAP_KEY." */
export class FirmsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirmsFormatError";
  }
}

/** Bounds memory if a large area or day range is ever requested. */
export const MAX_FIRMS_ROWS = 2000;

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value: string | undefined): number | null {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
}

/** acq_date is YYYY-MM-DD and acq_time is HHMM in UTC, sometimes without leading zeros. */
export function toObservedAt(acqDate: string | undefined, acqTime: string | undefined): string | null {
  if (!acqDate || !/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) return null;
  const time = (acqTime ?? "").trim();
  if (!/^\d{1,4}$/.test(time)) return null;
  const padded = time.padStart(4, "0");
  if (Number(padded.slice(0, 2)) > 23 || Number(padded.slice(2)) > 59) return null;
  const date = new Date(`${acqDate}T${padded.slice(0, 2)}:${padded.slice(2)}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The contract's FIRMS confidence: VIIRS l/n/h become low/nominal/high, MODIS
 * keeps its 0-100 number. Neither is a probability of fire.
 */
export function toConfidence(raw: string | undefined): FirmsEvidence["confidence"] {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value === "l" || value === "low") return "low";
  if (value === "n" || value === "nominal") return "nominal";
  if (value === "h" || value === "high") return "high";
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function toDayNight(raw: string | undefined): FirmsEvidence["dayNight"] {
  const value = raw?.trim().toUpperCase();
  if (value === "D") return "day";
  if (value === "N") return "night";
  return null;
}

/**
 * Parses the FIRMS area API CSV by header name, so column order and the
 * VIIRS/MODIS differences (bright_ti4 vs brightness) don't matter. Rows with
 * unusable coordinates or times are skipped rather than guessed. Throws
 * FirmsFormatError when the body has no FIRMS header at all.
 */
export function parseFirmsCsv(
  csv: string,
  options: { product: FirmsSource; retrievedAt: string; maxRows?: number },
): FirmsDetection[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0]?.split(",").map((name) => name.trim().toLowerCase()) ?? [];
  const column = (name: string) => header.indexOf(name);

  if (["latitude", "longitude", "acq_date", "acq_time"].some((name) => column(name) === -1)) {
    throw new FirmsFormatError("FIRMS response is not the expected CSV");
  }

  const maxRows = options.maxRows ?? MAX_FIRMS_ROWS;
  const seen = new Set<string>();
  const detections: FirmsDetection[] = [];

  for (const line of lines.slice(1)) {
    if (detections.length >= maxRows) break;
    const cells = line.split(",");
    const cell = (name: string) => {
      const index = column(name);
      return index === -1 ? undefined : cells[index]?.trim() || undefined;
    };

    const latitude = toNumber(cell("latitude"));
    const longitude = toNumber(cell("longitude"));
    if (latitude === null || longitude === null) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;

    const observedAt = toObservedAt(cell("acq_date"), cell("acq_time"));
    if (!observedAt) continue;

    const satellite = cell("satellite") ?? null;
    const key = `firms:${options.product}:${satellite ?? ""}:${observedAt}:${latitude}:${longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const frp = toNumber(cell("frp"));
    detections.push({
      id: stableId(key),
      product: options.product,
      latitude,
      longitude,
      observedAt,
      retrievedAt: options.retrievedAt,
      evidence: {
        instrument: cell("instrument")?.slice(0, 50) ?? null,
        satellite: satellite?.slice(0, 50) ?? null,
        confidence: toConfidence(cell("confidence")),
        frpMegawatts: frp !== null && frp >= 0 ? frp : null,
        brightnessKelvin: positive(cell("bright_ti4")) ?? positive(cell("brightness")),
        dayNight: toDayNight(cell("daynight")),
        distanceKm: null,
        version: cell("version")?.slice(0, 20) ?? null,
        scanKm: positive(cell("scan")),
        trackKm: positive(cell("track")),
      },
      isSynthetic: false,
    });
  }

  return detections;
}
