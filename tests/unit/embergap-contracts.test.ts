import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentEventSchema,
  agentFindingSchema,
  agentMessageSchema,
  apiErrorResponseSchema,
  classifyFreshness,
  investigationDetailResponseSchema,
  investigationSchema,
  isSyntheticId,
  mapQuerySchema,
  mapResponseSchema,
  observationSchema,
  parseBbox,
  reportMediaObjectPath,
  reportSubmissionRequestSchema,
  reportSubmissionResponseSchema,
  SYNTHETIC_SCENARIOS,
  syntheticId,
  syntheticScenarioIdSchema,
  toPublicLocation,
  VISION_REQUIRED_LIMITATIONS,
  type AgentFinding,
  type FusionRecommendation,
  type Observation,
} from "@/lib/embergap/contracts";

const NOW = "2026-11-07T14:00:00.000Z";
const USER = "6f1c2b8e-4d3a-4f5e-9a7b-1c2d3e4f5a6b";
const ID = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

function report(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: ID(1),
    observedAt: "2026-11-07T13:30:00.000Z",
    location: { latitude: 53.4668, longitude: -2.2339, uncertaintyMeters: 500 },
    description: "  Grey smoke rising above the trees to the north.  ",
    ...overrides,
  };
}

function finding(overrides: Partial<AgentFinding> = {}): Record<string, unknown> {
  return {
    id: ID(10),
    investigationId: ID(2),
    agentId: "witness",
    createdAt: NOW,
    evidenceIds: [ID(3)],
    assessment: "supports",
    strength: "moderate",
    reasonCodes: ["independent_reports_nearby"],
    explanation: "Two reports from different accounts describe smoke within 1 km.",
    limitations: ["possible_shared_origin"],
    recommendation: null,
    isSynthetic: true,
    ...overrides,
  };
}

const provenance = { provider: "NASA FIRMS", product: "VIIRS_SNPP_NRT", url: null, license: null, isSynthetic: true };

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID(20),
    investigationId: ID(2),
    source: "firms",
    sourceRecordId: "VIIRS-123",
    observedAt: "2026-11-07T12:10:00.000Z",
    retrievedAt: NOW,
    location: { latitude: 53.47, longitude: -2.24 },
    coverage: null,
    sourceState: "available",
    provenance,
    evidence: {
      instrument: "VIIRS",
      satellite: "N20",
      confidence: "nominal",
      frpMegawatts: 4.2,
      brightnessKelvin: 330.5,
      dayNight: "day",
      distanceKm: 0.8,
    },
    ...overrides,
  };
}

describe("report submission request", () => {
  it("accepts a valid report, trims the description and defaults media to null", () => {
    const parsed = reportSubmissionRequestSchema.parse(report());
    expect(parsed.description).toBe("Grey smoke rising above the trees to the north.");
    expect(parsed.media).toBeNull();
  });

  it("accepts an uploaded photo reference", () => {
    const parsed = reportSubmissionRequestSchema.parse(report({ media: { mediaId: ID(5), mimeType: "image/jpeg" } }));
    expect(parsed.media).toEqual({ mediaId: ID(5), mimeType: "image/jpeg" });
  });

  it.each([
    ["a timestamp with an offset", { observedAt: "2026-11-07T13:30:00+01:00" }],
    ["a timestamp without a zone", { observedAt: "2026-11-07T13:30:00" }],
    ["a time in the future", { observedAt: "2026-11-07T14:30:00.000Z" }],
    ["a time older than 72 hours", { observedAt: "2026-11-04T13:00:00.000Z" }],
    ["a latitude out of range", { location: { latitude: 91, longitude: 0, uncertaintyMeters: 500 } }],
    ["a longitude out of range", { location: { latitude: 0, longitude: -181, uncertaintyMeters: 500 } }],
    ["false precision", { location: { latitude: 0, longitude: 0, uncertaintyMeters: 5 } }],
    ["a fractional radius", { location: { latitude: 0, longitude: 0, uncertaintyMeters: 250.5 } }],
    ["swapped coordinate names", { location: { lat: 53, lng: -2, uncertaintyMeters: 500 } }],
    ["a too-short description", { description: "smoke" }],
    ["a too-long description", { description: "x".repeat(2_001) }],
    ["control characters", { description: "Smoke over the hill\u0000 near the farm" }],
    ["a disallowed photo type", { media: { mediaId: ID(5), mimeType: "image/gif" } }],
    ["a photo without an id", { media: { mimeType: "image/png" } }],
    ["a non-UUID request id", { clientRequestId: "abc" }],
  ])("rejects %s", (_label, overrides) => {
    expect(reportSubmissionRequestSchema.safeParse(report(overrides)).success).toBe(false);
  });

  it.each([["reporterId"], ["status"], ["isSynthetic"]])("rejects the server-owned field %s", (field) => {
    expect(reportSubmissionRequestSchema.safeParse(report({ [field]: "x" })).success).toBe(false);
  });

  it("accepts a time a few minutes ahead, for clock skew", () => {
    expect(reportSubmissionRequestSchema.safeParse(report({ observedAt: "2026-11-07T14:04:00.000Z" })).success).toBe(true);
  });
});

describe("report submission response and errors", () => {
  it("always says the report is unverified", () => {
    const response = {
      reportId: ID(1),
      investigationId: ID(2),
      investigationStatus: "unreviewed",
      mediaId: null,
      submittedAt: NOW,
      verification: "unverified",
      replayed: false,
    };
    expect(reportSubmissionResponseSchema.safeParse(response).success).toBe(true);
    expect(reportSubmissionResponseSchema.safeParse({ ...response, verification: "verified" }).success).toBe(false);
  });

  it("validates the shared error shape", () => {
    expect(
      apiErrorResponseSchema.safeParse({
        error: { code: "rate_limited", message: "Please wait a moment.", retryAfterSeconds: 30 },
      }).success,
    ).toBe(true);
    expect(apiErrorResponseSchema.safeParse({ error: "Please sign in." }).success).toBe(false);
  });
});

describe("report photo paths", () => {
  it("puts the photo under the owner's folder with a fixed extension", () => {
    expect(reportMediaObjectPath(USER, ID(5), "image/webp")).toBe(`${USER}/${ID(5)}.webp`);
  });

  it.each([["../etc", ID(5)], [USER, "photo.jpg"]])("refuses non-UUID parts (%s, %s)", (user, media) => {
    expect(() => reportMediaObjectPath(user, media, "image/jpeg")).toThrow();
  });
});

describe("locations and map queries", () => {
  it("coarsens a human-reported location to the public grid", () => {
    expect(toPublicLocation({ latitude: 53.46684, longitude: -2.23391, uncertaintyMeters: 500 })).toEqual({
      latitude: 53.47,
      longitude: -2.23,
      precisionMeters: 1_000,
    });
  });

  it("keeps a wider uncertainty and never returns -0", () => {
    const location = toPublicLocation({ latitude: -0.001, longitude: 0.004, uncertaintyMeters: 5_000 });
    expect(location).toEqual({ latitude: 0, longitude: 0, precisionMeters: 5_000 });
    expect(Object.is(location.latitude, -0)).toBe(false);
  });

  it("parses a bbox and rejects bad ones", () => {
    expect(parseBbox("-3,53,-2,54")).toEqual({ minLongitude: -3, minLatitude: 53, maxLongitude: -2, maxLatitude: 54 });
    for (const bad of ["", "1,2,3", "-2,53,-3,54", "-3,54,-2,53", "a,b,c,d", "-3,53,-2,91", "-3,,-2,54"]) {
      expect(parseBbox(bad), bad).toBeNull();
    }
  });

  it("parses map query strings with a bounded limit", () => {
    expect(mapQuerySchema.parse({})).toEqual({ bbox: null, limit: 50 });
    expect(mapQuerySchema.parse({ bbox: "-3,53,-2,54", limit: "10" }).limit).toBe(10);
    expect(mapQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(mapQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(mapQuerySchema.safeParse({ bbox: "nonsense" }).success).toBe(false);
  });
});

describe("source freshness", () => {
  it("treats no data as not observed, never as a negative", () => {
    expect(classifyFreshness({ latestObservedAt: null, checkedAt: NOW, maxAgeSeconds: 3_600 })).toBe("not_observed");
  });

  it("separates fresh and stale data", () => {
    const fresh = { latestObservedAt: "2026-11-07T13:30:00.000Z", checkedAt: NOW, maxAgeSeconds: 3_600 };
    expect(classifyFreshness(fresh)).toBe("available");
    expect(classifyFreshness({ ...fresh, maxAgeSeconds: 600 })).toBe("stale");
  });
});

describe("observations", () => {
  it("accepts a FIRMS detection with provenance", () => {
    expect(observationSchema.safeParse(observation()).success).toBe(true);
  });

  it("requires coverage for a non-detection, so it can't read as 'no fire'", () => {
    const missing = observation({ sourceState: "not_observed", observedAt: null, evidence: null, location: null });
    expect(observationSchema.safeParse(missing).success).toBe(false);
    const covered = {
      ...missing,
      coverage: { windowStart: "2026-11-07T00:00:00.000Z", windowEnd: NOW, radiusKm: 10 },
    };
    expect(observationSchema.safeParse(covered).success).toBe(true);
  });

  it("allows an unavailable source with no data", () => {
    const failed = observation({ source: "weather", sourceState: "unavailable", observedAt: null, evidence: null });
    expect(observationSchema.safeParse(failed).success).toBe(true);
  });

  it("requires data and a time when the source is available", () => {
    expect(observationSchema.safeParse(observation({ evidence: null })).success).toBe(false);
    expect(observationSchema.safeParse(observation({ observedAt: null })).success).toBe(false);
  });

  it("checks evidence against the source", () => {
    const weatherWithFirmsEvidence = observation({ source: "weather" });
    expect(observationSchema.safeParse(weatherWithFirmsEvidence).success).toBe(false);
  });

  it("drops extra fields from human evidence, so report text can't leak through it", () => {
    const human = observationSchema.parse(
      observation({ source: "human", evidence: { reportId: ID(1), hasMedia: false, description: "private" } }),
    ) as Extract<Observation, { source: "human" }>;
    expect(human.evidence).toEqual({ reportId: ID(1), hasMedia: false });
  });

  it("rejects a provenance URL that isn't http(s)", () => {
    const bad = observation({ provenance: { ...provenance, url: "javascript:alert(1)" } });
    expect(observationSchema.safeParse(bad).success).toBe(false);
  });
});

describe("agent findings encode the scientific limits", () => {
  it("accepts a well-formed witness finding", () => {
    expect(agentFindingSchema.safeParse(finding()).success).toBe(true);
  });

  it("never lets the satellite agent contradict a report", () => {
    const result = agentFindingSchema.safeParse(
      finding({ agentId: "satellite", assessment: "contradicts", reasonCodes: ["no_thermal_detection_in_window"] }),
    );
    expect(result.success).toBe(false);
  });

  it("keeps weather as context", () => {
    expect(agentFindingSchema.safeParse(finding({ agentId: "weather", assessment: "supports" })).success).toBe(false);
    expect(
      agentFindingSchema.safeParse(finding({ agentId: "weather", assessment: "context", strength: null })).success,
    ).toBe(true);
  });

  it("requires every vision finding to admit what images can't prove", () => {
    expect(agentFindingSchema.safeParse(finding({ agentId: "vision", limitations: [] })).success).toBe(false);
    expect(
      agentFindingSchema.safeParse(finding({ agentId: "vision", limitations: [...VISION_REQUIRED_LIMITATIONS] })).success,
    ).toBe(true);
  });

  it("lets only fusion recommend, and never 'reviewed'", () => {
    const recommendation: FusionRecommendation = {
      recommendedStatus: "needs_human_review",
      reviewPriority: "high",
      supportingFindingIds: [ID(10)],
      contradictingFindingIds: [],
      evidenceGaps: ["No FIRMS pass since 09:00 UTC"],
      possibleDuplicateReportIds: [],
    };
    expect(agentFindingSchema.safeParse(finding({ agentId: "fusion", recommendation })).success).toBe(true);
    expect(agentFindingSchema.safeParse(finding({ agentId: "fusion" })).success).toBe(false);
    expect(agentFindingSchema.safeParse(finding({ recommendation })).success).toBe(false);
    const confirmed = { ...recommendation, recommendedStatus: "reviewed" };
    expect(
      agentFindingSchema.safeParse(finding({ agentId: "fusion", recommendation: confirmed as never })).success,
    ).toBe(false);
  });

  it("has no numeric confidence, and strength only for directional findings", () => {
    expect(agentFindingSchema.safeParse(finding({ assessment: "inconclusive" })).success).toBe(false);
    expect(agentFindingSchema.safeParse({ ...finding(), confidence: 0.93 }).data).not.toHaveProperty("confidence");
  });

  it("requires snake_case reason codes", () => {
    expect(agentFindingSchema.safeParse(finding({ reasonCodes: ["Fire Confirmed!"] })).success).toBe(false);
    expect(agentFindingSchema.safeParse(finding({ reasonCodes: [] })).success).toBe(false);
  });
});

describe("agent messages", () => {
  const base = {
    schemaVersion: 1,
    id: ID(30),
    investigationId: ID(2),
    from: "system",
    to: "satellite",
    createdAt: NOW,
    correlationId: ID(31),
    causationId: null,
    sequence: 0,
    isSynthetic: true,
  };

  it("validates each message kind's payload", () => {
    const messages = [
      { ...base, kind: "task_assigned", payload: { taskId: ID(32), task: "collect_observations", reportId: ID(1) } },
      { ...base, kind: "observations_shared", payload: { observations: [observation()] } },
      { ...base, kind: "finding_published", payload: { finding: finding() } },
      { ...base, kind: "evidence_requested", payload: { sources: ["firms"], reason: "Need a newer pass." } },
      { ...base, kind: "ack", payload: { messageId: ID(29) } },
    ];
    for (const message of messages) {
      expect(agentMessageSchema.safeParse(message).success, message.kind).toBe(true);
    }
  });

  it.each([
    ["an unknown kind", { kind: "do_anything", payload: {} }],
    ["a payload for another kind", { kind: "ack", payload: { taskId: ID(32) } }],
    ["a future schema version", { schemaVersion: 2, kind: "ack", payload: { messageId: ID(29) } }],
    ["an unknown sender", { from: "orchestrator", kind: "ack", payload: { messageId: ID(29) } }],
    ["a negative sequence", { sequence: -1, kind: "ack", payload: { messageId: ID(29) } }],
    ["an invalid nested finding", { kind: "finding_published", payload: { finding: finding({ agentId: "satellite", assessment: "contradicts" }) } }],
  ])("rejects %s", (_label, overrides) => {
    expect(agentMessageSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
  });
});

describe("investigation events", () => {
  const event = {
    id: ID(40),
    investigationId: ID(2),
    type: "report_submitted",
    actor: "reporter",
    occurredAt: NOW,
    recordedAt: NOW,
    idempotencyKey: `report_submitted:${ID(1)}`,
    messageId: null,
    summary: "A report was submitted.",
    details: null,
    isSynthetic: false,
  };

  it("accepts a timeline event", () => {
    expect(agentEventSchema.safeParse(event).success).toBe(true);
  });

  it("bounds details and requires an idempotency key", () => {
    expect(agentEventSchema.safeParse({ ...event, details: { blob: "x".repeat(9_000) } }).success).toBe(false);
    expect(agentEventSchema.safeParse({ ...event, idempotencyKey: "  " }).success).toBe(false);
  });
});

describe("read models", () => {
  const investigation = {
    id: ID(2),
    status: "needs_human_review",
    reviewPriority: "medium",
    location: { latitude: 53.47, longitude: -2.23, precisionMeters: 1_000 },
    openedAt: NOW,
    updatedAt: NOW,
    latestEvidenceAt: null,
    reportCount: 1,
    sources: ["human"],
    isSynthetic: true,
    syntheticScenarioId: "corroborated-smoke",
    reviewOutcome: null,
    reviewedAt: null,
    reviewNote: null,
  };

  it("ties 'reviewed' to a human review outcome and time", () => {
    expect(investigationSchema.safeParse(investigation).success).toBe(true);
    expect(investigationSchema.safeParse({ ...investigation, status: "reviewed" }).success).toBe(false);
    expect(
      investigationSchema.safeParse({ ...investigation, status: "reviewed", reviewOutcome: "supported", reviewedAt: NOW })
        .success,
    ).toBe(true);
    expect(investigationSchema.safeParse({ ...investigation, reviewOutcome: "supported", reviewedAt: NOW }).success).toBe(
      false,
    );
  });

  it("strips anything outside the contract from detail responses, such as a reporter id", () => {
    const detail = investigationDetailResponseSchema.parse({
      investigation: { ...investigation, reporterId: USER },
      viewerAccess: "synthetic",
      reports: [],
      media: [],
      observations: [],
      findings: [],
      events: [],
      sourceAvailability: [],
      generatedAt: NOW,
    });
    expect(detail.investigation).not.toHaveProperty("reporterId");
  });

  it("validates a bounded map response", () => {
    const feature = {
      id: ID(2),
      kind: "investigation",
      location: investigation.location,
      investigationId: ID(2),
      status: "unreviewed",
      reviewPriority: null,
      observedAt: null,
      freshness: "not_observed",
      sources: ["human"],
      provenance: { ...provenance, provider: "EmberGap synthetic fixtures", product: null },
    };
    const response = {
      mode: "synthetic",
      generatedAt: NOW,
      bbox: null,
      limit: 50,
      truncated: false,
      features: [feature],
      sourceAvailability: [],
    };
    expect(mapResponseSchema.safeParse(response).success).toBe(true);
    expect(mapResponseSchema.safeParse({ ...response, features: Array(201).fill(feature) }).success).toBe(false);
  });
});

describe("synthetic data", () => {
  it("derives stable, valid, recognisable UUIDs from names", () => {
    const id = syntheticId("firms/corroborated-smoke/detection-1");
    expect(id).toBe(syntheticId("firms/corroborated-smoke/detection-1"));
    expect(id).not.toBe(syntheticId("firms/corroborated-smoke/detection-2"));
    expect(isSyntheticId(id)).toBe(true);
    expect(isSyntheticId(USER)).toBe(false);
    expect(() => syntheticId(" ")).toThrow();
  });

  it("produces no collisions across many names", () => {
    const ids = new Set(Array.from({ length: 5_000 }, (_, i) => syntheticId(`scenario/thing-${i}`)));
    expect(ids.size).toBe(5_000);
  });

  it("lists the shared scenarios with unique ids", () => {
    const ids = SYNTHETIC_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(syntheticScenarioIdSchema.safeParse("corroborated-smoke").success).toBe(true);
    expect(syntheticScenarioIdSchema.safeParse("made-up").success).toBe(false);
  });
});
