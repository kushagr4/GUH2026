import { z } from "zod";

/**
 * UK postcode lookup through postcodes.io: free, keyless, open data (ONS/OS),
 * CORS-enabled, so it is called from the browser and needs no env variable.
 * Only coordinates go to EmberGap; the postcode itself is not sent or stored.
 */
export const POSTCODES_IO_BASE = "https://api.postcodes.io";
const LOOKUP_TIMEOUT_MS = 8_000;

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

export type ParsedPostcode = { kind: "full"; value: string; display: string } | { kind: "outcode"; value: string; display: string };

/** Accepts "m13 9pl", "M139PL" or a district such as "M13". */
export function parsePostcode(input: string): ParsedPostcode | null {
  const compact = input.toUpperCase().replace(/\s+/g, "");
  if (FULL_POSTCODE.test(compact)) {
    return { kind: "full", value: compact, display: `${compact.slice(0, -3)} ${compact.slice(-3)}` };
  }
  if (OUTCODE.test(compact)) return { kind: "outcode", value: compact, display: compact };
  return null;
}

/** A district covers several km; a full postcode's centre is within ~1 km of most of it. */
export function suggestedUncertaintyMeters(kind: ParsedPostcode["kind"]): number {
  return kind === "outcode" ? 5_000 : 1_000;
}

const resultSchema = z.object({
  status: z.literal(200),
  result: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
});

export type PostcodeLookup =
  | { ok: true; latitude: number; longitude: number; display: string; kind: ParsedPostcode["kind"] }
  | { ok: false; message: string };

export async function lookupPostcode(input: string, fetchImpl: typeof fetch = fetch): Promise<PostcodeLookup> {
  const parsed = parsePostcode(input);
  if (!parsed) return { ok: false, message: "Enter a UK postcode such as M13 9PL, or just the first part, such as M13." };

  const path = parsed.kind === "full" ? "postcodes" : "outcodes";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${POSTCODES_IO_BASE}/${path}/${encodeURIComponent(parsed.value)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) {
      return { ok: false, message: `We couldn't find ${parsed.display}. Check it, or enter the coordinates instead.` };
    }
    const body = resultSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !body.success) {
      return { ok: false, message: "The postcode lookup isn't available right now. Enter the coordinates instead." };
    }
    return { ok: true, latitude: body.data.result.latitude, longitude: body.data.result.longitude, display: parsed.display, kind: parsed.kind };
  } catch {
    return { ok: false, message: "The postcode lookup isn't available right now. Enter the coordinates instead." };
  } finally {
    clearTimeout(timer);
  }
}
