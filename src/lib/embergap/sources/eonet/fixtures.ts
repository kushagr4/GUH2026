// SYNTHETIC EONET fixtures: invented records in the shape of the live v3
// response (checked 7 Nov 2026), for tests and the offline demo. None of these
// events exist. Every title says SYNTHETIC, the source id is SYNTHETIC, and the
// provenance has isSynthetic: true, so nothing here can pass for NASA data.
// The near record sits beside the shared "partition-recovery" scenario point
// in @/lib/embergap/contracts (53.462, -1.853).
import { matchEvents, toEventRecords, type EonetResponse } from "./normalize";
import { EONET_LIMITATIONS, eonetProvenance, type EonetContext, type EonetQuery } from "./types";

const syntheticSource = [{ id: "SYNTHETIC", url: "https://example.org/embergap/synthetic-fixture" }];

/** A raw /api/v3/events body: one record near the demo point, one far away. */
export const SYNTHETIC_EONET_RESPONSE: EonetResponse & { title: string; description: string; link: string } = {
  title: "EONET Events",
  description: "Natural events from EONET.",
  link: "https://eonet.gsfc.nasa.gov/api/v3/events",
  events: [
    {
      id: "EONET_990001",
      title: "SYNTHETIC NEBRODI Wildfire, Demo Province (SYNTHETIC)",
      description: "Synthetic fixture for the EmberGap demo",
      link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_990001",
      closed: null,
      categories: [{ id: "wildfires" }],
      sources: syntheticSource,
      geometry: [
        { magnitudeValue: 780, magnitudeUnit: "acres", date: "2026-11-06T22:10:00Z", type: "Point", coordinates: [14.96, 37.76] },
      ],
    },
    {
      id: "EONET_990002",
      title: "SYNTHETIC FAR Wildfire, Elsewhere Province (SYNTHETIC)",
      description: null,
      link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_990002",
      closed: "2026-11-03T00:00:00Z",
      categories: [{ id: "wildfires" }],
      sources: syntheticSource,
      geometry: [
        { magnitudeValue: 2100, magnitudeUnit: "acres", date: "2026-11-01T09:00:00Z", type: "Point", coordinates: [12.5, 45.4] },
      ],
    },
  ],
};

/** An empty answer: EONET responded and holds no matching record. */
export const SYNTHETIC_EONET_EMPTY_RESPONSE: EonetResponse = { events: [] };

/** Builds the context the live adapter would return, from a synthetic body. */
export function syntheticEonetContext(
  query: EonetQuery,
  response: EonetResponse,
  options: { retrievedAt: string },
): EonetContext {
  // Same filter as the live path: wildfire records, then radius and dates.
  const records = toEventRecords(response);
  const matches = matchEvents(records, query);
  return {
    source: "eonet",
    query,
    sourceState: matches.length ? "available" : "not_observed",
    retrievedAt: options.retrievedAt,
    fromCache: false,
    recordsInBox: records.length,
    matches,
    possiblyTruncated: false,
    limitations: [...EONET_LIMITATIONS],
    provenance: eonetProvenance(true),
  };
}

/** EONET could not be reached: honest unavailability, no invented records. */
export function unavailableEonetContext(query: EonetQuery, options: { retrievedAt: string; kind?: string }): EonetContext {
  return {
    source: "eonet",
    query,
    sourceState: "unavailable",
    retrievedAt: options.retrievedAt,
    fromCache: false,
    recordsInBox: 0,
    matches: [],
    possiblyTruncated: false,
    limitations: [...EONET_LIMITATIONS],
    provenance: eonetProvenance(true),
    error: { kind: options.kind ?? "timeout", message: "NASA EONET took too long to respond." },
  };
}
