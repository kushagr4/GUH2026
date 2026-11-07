import type { FirmsConfidence, FirmsDetection, FirmsSource } from "./types";

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

/** acq_date is YYYY-MM-DD and acq_time is HHMM in UTC, sometimes without leading zeros. */
export function toObservedAt(acqDate: string | undefined, acqTime: string | undefined): string | null {
  if (!acqDate || !/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) return null;
  const time = (acqTime ?? "").trim();
  if (!/^\d{1,4}$/.test(time)) return null;
  const padded = time.padStart(4, "0");
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2));
  if (hours > 23 || minutes > 59) return null;
  const date = new Date(`${acqDate}T${padded.slice(0, 2)}:${padded.slice(2)}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * VIIRS reports l/n/h. MODIS reports 0-100, which FIRMS groups as low (<30),
 * nominal (30-79) and high (80+). Neither is a calibrated fire probability.
 */
export function toConfidence(raw: string | undefined): FirmsConfidence | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value === "l" || value === "low") return "low";
  if (value === "n" || value === "nominal") return "nominal";
  if (value === "h" || value === "high") return "high";
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (percent < 30) return "low";
  if (percent < 80) return "nominal";
  return "high";
}

function toDayNight(raw: string | undefined): FirmsDetection["dayNight"] {
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

  const required = ["latitude", "longitude", "acq_date", "acq_time"];
  if (required.some((name) => column(name) === -1)) {
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
      return index === -1 ? undefined : cells[index]?.trim();
    };

    const latitude = toNumber(cell("latitude"));
    const longitude = toNumber(cell("longitude"));
    if (latitude === null || longitude === null) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;

    const observedAt = toObservedAt(cell("acq_date"), cell("acq_time"));
    if (!observedAt) continue;

    const id = `firms:${options.product}:${latitude.toFixed(4)}:${longitude.toFixed(4)}:${observedAt}`;
    if (seen.has(id)) continue;
    seen.add(id);

    detections.push({
      id,
      source: "firms",
      product: options.product,
      satellite: cell("satellite") || null,
      instrument: cell("instrument") || null,
      latitude,
      longitude,
      observedAt,
      retrievedAt: options.retrievedAt,
      confidence: toConfidence(cell("confidence")),
      confidenceRaw: cell("confidence") || null,
      frpMw: toNumber(cell("frp")),
      brightnessK: toNumber(cell("bright_ti4")) ?? toNumber(cell("brightness")),
      dayNight: toDayNight(cell("daynight")),
      synthetic: false,
    });
  }

  return detections;
}
