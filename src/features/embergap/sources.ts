import "server-only";
import { SYNTHETIC_NOW, SYNTHETIC_SCENARIOS, type Bbox, type PublicLocation, type SourceAvailability } from "@/lib/embergap/contracts";
import { getEonet } from "@/lib/embergap/sources/eonet/eonet";
import { SYNTHETIC_EONET_EMPTY_RESPONSE, SYNTHETIC_EONET_RESPONSE, syntheticEonetContext, unavailableEonetContext } from "@/lib/embergap/sources/eonet/fixtures";
import { eonetWindow } from "@/lib/embergap/sources/eonet/normalize";
import { eonetProvenance, type EonetContext } from "@/lib/embergap/sources/eonet/types";
import { getThermalAnomalies, type FirmsResult } from "@/lib/embergap/sources/firms";
import { bboxContains } from "@/lib/embergap/sources/firms/bbox";
import { getFirmsMode } from "@/lib/embergap/sources/firms/client";
import { relocateLegacyDetections } from "@/lib/embergap/read/demo-detections";
import { getOpenMeteo } from "@/lib/embergap/sources/weather/open-meteo";
import { syntheticOpenMeteoResponse, syntheticWeatherContext, unavailableWeatherContext } from "@/lib/embergap/sources/weather/fixtures";
import { openMeteoProvenance, type WeatherContext, type WeatherQuery } from "@/lib/embergap/sources/weather/types";
import { FIRMS_RADIUS_KM, type FirmsTaskInput } from "./processors";

/**
 * Evidence gathering for one investigation run (Claude Mac's integration). The
 * runtime's processors are pure, so all I/O happens here, BEFORE tasks are
 * queued: FIRMS (Outrolife's adapter), Open-Meteo and EONET (Claude PC's) are
 * called concurrently, each with its own deadline. Nothing here throws: a
 * failed, slow or unconfigured source becomes an honest "unavailable" input,
 * never invented data and never a negative result.
 */

/** Each source gets this long; the run's own budget still applies on top. */
export const SOURCE_TIMEOUT_MS = 12_000;
const HOUR_MS = 3_600_000;

export type EvidenceSubject = {
  investigationId: string;
  /** The public, privacy-reduced point. Upstream services never see the exact one. */
  location: PublicLocation;
  observedAt: string;
};

export type SourceInputs = { firms: FirmsTaskInput; weather: WeatherContext; eonet: EonetContext };

export type SourceGatherer = (subject: EvidenceSubject, options: { signal: AbortSignal; now: Date }) => Promise<SourceInputs>;

/** Resolves with the fallback when the work is slower than `ms` or the signal aborts. */
async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, parent: AbortSignal, fallback: () => T): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(ms)]);
  if (signal.aborted) return fallback();
  let onAbort: () => void = () => {};
  const aborted = new Promise<T>((resolve) => {
    onAbort = () => resolve(fallback());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work(signal).catch(() => fallback()), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function bboxAround(center: { latitude: number; longitude: number }, radiusKm: number): Bbox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos((center.latitude * Math.PI) / 180)));
  const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
  return {
    minLatitude: clamp(center.latitude - dLat, 90),
    maxLatitude: clamp(center.latitude + dLat, 90),
    minLongitude: clamp(center.longitude - dLon, 180),
    maxLongitude: clamp(center.longitude + dLon, 180),
  };
}

function firmsUnavailable(checkedAt: string, message: string): SourceAvailability {
  return { source: "firms", state: "unavailable", checkedAt, latestObservedAt: null, maxAgeSeconds: 12 * 3_600, windowStart: null, windowEnd: null, message };
}

function toFirmsInput(subject: EvidenceSubject, result: FirmsResult): FirmsTaskInput {
  return {
    product: result.product,
    availability: result.availability,
    center: { latitude: subject.location.latitude, longitude: subject.location.longitude },
    radiusKm: FIRMS_RADIUS_KM,
    reportObservedAt: subject.observedAt,
    detections: result.detections.slice(0, 200).map((detection) => ({
      id: detection.id,
      latitude: detection.latitude,
      longitude: detection.longitude,
      observedAt: detection.observedAt,
      retrievedAt: detection.retrievedAt,
      evidence: detection.evidence,
      isSynthetic: detection.isSynthetic,
    })),
  };
}

/** Days back from now that cover the report time, as FIRMS's 1-5 day range. */
function firmsDayRange(observedAt: string, now: Date): number {
  return Math.min(5, Math.max(1, Math.ceil((now.getTime() - Date.parse(observedAt)) / (24 * HOUR_MS)) + 1));
}

const weatherQueryFor = (subject: EvidenceSubject): WeatherQuery => ({
  latitude: subject.location.latitude,
  longitude: subject.location.longitude,
  timeOfInterest: subject.observedAt,
  hoursBefore: 24,
  hoursAfter: 6,
});

const eonetQueryFor = (subject: EvidenceSubject) => ({
  latitude: subject.location.latitude,
  longitude: subject.location.longitude,
  radiusKm: 50,
  limit: 50,
  ...eonetWindow(subject.observedAt),
});

/** Live sources, for real reports. FIRMS needs live mode and a MAP_KEY; otherwise it is reported as unavailable. */
export const liveSourceGatherer: SourceGatherer = async (subject, { signal, now }) => {
  const checkedAt = now.toISOString();
  const firms = withDeadline<FirmsTaskInput>(
    async (deadline) => {
      // Demo fixtures only describe the synthetic scenarios: never use them for a real report.
      if (getFirmsMode() !== "live") {
        return toFirmsInput(subject, {
          product: "VIIRS_SNPP_NRT",
          dayRange: 1,
          detections: [],
          availability: firmsUnavailable(checkedAt, "Live NASA FIRMS data is not configured on this server."),
        });
      }
      const result = await getThermalAnomalies({
        bbox: bboxAround(subject.location, FIRMS_RADIUS_KM),
        dayRange: firmsDayRange(subject.observedAt, now),
        now,
        signal: deadline,
      });
      return toFirmsInput(subject, result);
    },
    SOURCE_TIMEOUT_MS,
    signal,
    () =>
      toFirmsInput(subject, {
        product: "VIIRS_SNPP_NRT",
        dayRange: 1,
        detections: [],
        availability: firmsUnavailable(checkedAt, "NASA FIRMS did not answer in time."),
      }),
  );
  const weatherFallback = (): WeatherContext => ({
    ...unavailableWeatherContext(weatherQueryFor(subject), { retrievedAt: checkedAt, kind: "timeout" }),
    provenance: openMeteoProvenance(false),
  });
  const weather = withDeadline(
    (deadline) =>
      getOpenMeteo().getWeatherContext(
        { latitude: subject.location.latitude, longitude: subject.location.longitude, timeOfInterest: subject.observedAt },
        { signal: deadline },
      ),
    SOURCE_TIMEOUT_MS,
    signal,
    weatherFallback,
  );
  const eonetFallback = (): EonetContext => ({
    ...unavailableEonetContext(eonetQueryFor(subject), { retrievedAt: checkedAt, kind: "timeout" }),
    provenance: eonetProvenance(false),
  });
  const eonet = withDeadline(
    (deadline) => getEonet().getWildfireContext(eonetQueryFor(subject), { signal: deadline }),
    SOURCE_TIMEOUT_MS,
    signal,
    eonetFallback,
  );
  const [firmsInput, weatherContext, eonetContext] = await Promise.all([firms, weather, eonet]);
  return { firms: firmsInput, weather: weatherContext, eonet: eonetContext };
};

/**
 * Deterministic, labelled synthetic sources for the six demo scenarios: no
 * network, so the demo never depends on NASA, Open-Meteo or Anthropic. The
 * weather-timeout scenario's weather is unavailable, as its name says.
 */
export const syntheticSourceGatherer: SourceGatherer = async (subject) => {
  const scenario = SYNTHETIC_SCENARIOS.find((entry) => entry.investigationId === subject.investigationId);
  const all = await getThermalAnomalies({ bbox: null, dayRange: 2, env: {} });
  const box = bboxAround(subject.location, FIRMS_RADIUS_KM);
  const firms = {
    ...all,
    detections: relocateLegacyDetections(all.detections).filter((detection) => bboxContains(box, detection.latitude, detection.longitude)),
  };
  const query = weatherQueryFor(subject);
  const weather =
    scenario?.id === "weather-timeout"
      ? unavailableWeatherContext(query, { retrievedAt: SYNTHETIC_NOW, kind: "timeout" })
      : syntheticWeatherContext(
          query,
          syntheticOpenMeteoResponse({
            startIso: new Date(Math.floor(Date.parse(subject.observedAt) / HOUR_MS) * HOUR_MS - 24 * HOUR_MS).toISOString(),
            hours: 31,
            profile: scenario?.id === "misleading-photo" ? "damp" : "fire-weather",
            currentIso: SYNTHETIC_NOW,
            gridCell: { latitude: query.latitude, longitude: query.longitude, elevation: 300 },
          }),
          { retrievedAt: SYNTHETIC_NOW },
        );
  const eonet = syntheticEonetContext(
    eonetQueryFor(subject),
    scenario?.id === "corroborated-smoke" ? SYNTHETIC_EONET_RESPONSE : SYNTHETIC_EONET_EMPTY_RESPONSE,
    { retrievedAt: SYNTHETIC_NOW },
  );
  return { firms: toFirmsInput(subject, firms), weather, eonet };
};
