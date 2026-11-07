import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
const runtimeMocks = vi.hoisted(() => ({ reports: [] as unknown[], store: null as unknown }));
vi.mock("@/features/embergap/runtime", async (original) => ({
  ...(await original<typeof import("@/features/embergap/runtime")>()),
  loadAgentReports: vi.fn(async () => runtimeMocks.reports),
  createSupabaseRuntimeStore: vi.fn(() => runtimeMocks.store),
  loadMediaRef: vi.fn(async () => null),
}));

const { runtimeRunner, runInvestigation, runIdFor, canRunAgents, scheduleInvestigation } = await import("@/features/embergap/orchestrator");
const { after } = await import("next/server");
const { createMemoryRuntimeStore } = await import("@/lib/embergap/agents/runtime");
const { VISION_FIXTURES } = await import("@/lib/embergap/agents/validators/vision/mock");
import {
  SYNTHETIC_SCENARIOS,
  stableId,
  type AgentReport,
  type EmberGapRuntimeStore,
  type SyntheticScenarioId,
} from "@/lib/embergap/contracts";
import type { SourceGatherer } from "@/features/embergap/sources";
import type { InvestigationRun } from "@/features/embergap/orchestrator";

function reportsFor(id: SyntheticScenarioId, options: { isSynthetic?: boolean; media?: boolean } = {}): AgentReport[] {
  const scenario = SYNTHETIC_SCENARIOS.find((entry) => entry.id === id)!;
  return scenario.reportIds.map((reportId, index) => ({
    id: reportId,
    investigationId: scenario.investigationId,
    observedAt: new Date(Date.parse(scenario.report.observedAt) + index * 8 * 60_000).toISOString(),
    submittedAt: new Date(Date.parse(scenario.report.observedAt) + (5 + index * 6) * 60_000).toISOString(),
    description: index === 0 ? "Grey smoke rising over the moor, visible from the road." : "Same smoke as before, drifting east from the moor.",
    location: { latitude: scenario.report.latitude, longitude: scenario.report.longitude, uncertaintyMeters: scenario.report.uncertaintyMeters },
    // One person per scenario: repeated-witness is the same reporter twice.
    reporterKey: "11111111-1111-4111-8111-111111111111",
    media: options.media ? { mediaId: stableId(`media:${reportId}`), mimeType: "image/jpeg", sha256: "a".repeat(64) } : null,
    isSynthetic: options.isSynthetic ?? true,
  }));
}

function runFor(reports: AgentReport[], store: EmberGapRuntimeStore, extra: Partial<InvestigationRun> = {}): InvestigationRun {
  const investigationId = reports[0].investigationId;
  return {
    investigationId,
    reports,
    store,
    now: () => "2026-11-07T12:00:00.000Z",
    newId: (name) => stableId(`${investigationId}:${name}`),
    signal: new AbortController().signal,
    ...extra,
  };
}

/** Every source down or unconfigured: a live run must still end in an explainable state. */
const downGatherer: SourceGatherer = async (subject, { now }) => {
  const checkedAt = now.toISOString();
  const { unavailableWeatherContext } = await import("@/lib/embergap/sources/weather/fixtures");
  const { unavailableEonetContext } = await import("@/lib/embergap/sources/eonet/fixtures");
  const { openMeteoProvenance } = await import("@/lib/embergap/sources/weather/types");
  const { eonetProvenance } = await import("@/lib/embergap/sources/eonet/types");
  return {
    firms: {
      product: "VIIRS_SNPP_NRT",
      availability: { source: "firms", state: "unavailable", checkedAt, latestObservedAt: null, maxAgeSeconds: 43_200, windowStart: null, windowEnd: null, message: "Live NASA FIRMS data is not configured on this server." },
      center: { latitude: subject.location.latitude, longitude: subject.location.longitude },
      radiusKm: 10,
      reportObservedAt: subject.observedAt,
      detections: [],
    },
    weather: {
      ...unavailableWeatherContext({ latitude: subject.location.latitude, longitude: subject.location.longitude, timeOfInterest: subject.observedAt, hoursBefore: 24, hoursAfter: 6 }, { retrievedAt: checkedAt }),
      provenance: openMeteoProvenance(false),
    },
    eonet: {
      ...unavailableEonetContext({ latitude: subject.location.latitude, longitude: subject.location.longitude, radiusKm: 50, limit: 50, start: "2026-09-08", end: "2026-11-08" }, { retrievedAt: checkedAt }),
      provenance: eonetProvenance(false),
    },
  };
};

const byAgent = <T extends { agentId: string }>(findings: T[]) => Object.groupBy(findings, (finding) => finding.agentId);

describe("runtimeRunner on the synthetic scenarios (offline, deterministic)", () => {
  it.each(SYNTHETIC_SCENARIOS.map((scenario) => scenario.id))("%s: every agent reports, fusion recommends, the status updates", async (id) => {
    const store = createMemoryRuntimeStore();
    const summary = await runtimeRunner(runFor(reportsFor(id), store));
    const contents = store.contents();
    const agents = byAgent(contents.findings);

    expect(Object.keys(agents).sort()).toEqual(["fusion", "satellite", "vision", "weather", "witness"]);
    expect(Object.values(summary.tasks).every((state) => state === "done")).toBe(true);
    // Every record is labelled synthetic.
    expect(contents.findings.every((finding) => finding.isSynthetic)).toBe(true);
    expect(contents.observations.every((observation) => observation.provenance.isSynthetic)).toBe(true);
    // One recommendation, never a verdict.
    const fusion = agents.fusion!;
    expect(fusion).toHaveLength(1);
    expect(fusion[0].assessment).toBe("context");
    expect(["investigating", "needs_human_review", "insufficient_evidence"]).toContain(fusion[0].recommendation?.recommendedStatus);
    expect(contents.statuses.at(-1)?.status).toBe(summary.status);
    // A timeline that explains the run.
    const types = contents.events.map((event) => event.type);
    expect(types.filter((type) => type === "task_queued")).toHaveLength(6);
    expect(types.filter((type) => type === "finding_recorded").length).toBeGreaterThanOrEqual(5);
    expect(contents.events.at(-1)?.summary).toMatch(/Automated assessment finished/);
    // Weather is context only, satellite never contradicts.
    expect(agents.weather!.every((finding) => finding.assessment === "context" || finding.assessment === "inconclusive")).toBe(true);
    expect(agents.satellite!.every((finding) => finding.assessment !== "contradicts")).toBe(true);
  });

  it("corroborating evidence: the satellite supports and fusion counts it", async () => {
    const store = createMemoryRuntimeStore();
    await runtimeRunner(runFor(reportsFor("corroborated-smoke"), store));
    const { findings, observations } = store.contents();
    const satellite = findings.find((finding) => finding.agentId === "satellite")!;
    expect(satellite.assessment).toBe("supports");
    expect(observations.filter((observation) => observation.source === "firms" && observation.sourceState === "available").length).toBeGreaterThan(0);
    const fusion = findings.find((finding) => finding.agentId === "fusion")!;
    expect(fusion.recommendation?.supportingFindingIds).toContain(satellite.id);
  });

  it("missing satellite evidence is unknown, never negative", async () => {
    const store = createMemoryRuntimeStore();
    await runtimeRunner(runFor(reportsFor("missing-satellite-pass"), store));
    const { findings, observations } = store.contents();
    const satellite = findings.find((finding) => finding.agentId === "satellite")!;
    expect(satellite.assessment).toBe("inconclusive");
    expect(satellite.limitations).toContain("no_detection_is_not_absence");
    expect(observations.find((observation) => observation.source === "firms")?.sourceState).toBe("not_observed");
    const fusion = findings.find((finding) => finding.agentId === "fusion")!;
    expect(fusion.recommendation?.contradictingFindingIds).not.toContain(satellite.id);
  });

  it("an unavailable external service is recorded as a gap and the run still finishes", async () => {
    const store = createMemoryRuntimeStore();
    const summary = await runtimeRunner(runFor(reportsFor("weather-timeout"), store));
    const weather = store.contents().findings.find((finding) => finding.agentId === "weather" && finding.reasonCodes.includes("source_unavailable"));
    expect(weather?.assessment).toBe("inconclusive");
    expect(summary.fusionFindingId).not.toBeNull();
  });

  it("repeated reports from one person are not counted as independent", async () => {
    const store = createMemoryRuntimeStore();
    await runtimeRunner(runFor(reportsFor("repeated-witness"), store));
    const witness = store.contents().findings.find((finding) => finding.agentId === "witness")!;
    expect(witness.assessment).not.toBe("supports");
  });

  it("is idempotent: a retried run writes nothing new", async () => {
    const store = createMemoryRuntimeStore();
    const reports = reportsFor("corroborated-smoke");
    const first = await runtimeRunner(runFor(reports, store));
    const before = store.contents();
    const second = await runtimeRunner(runFor(reports, store));
    const afterRetry = store.contents();
    expect(second.runId).toBe(first.runId);
    expect(afterRetry.findings).toHaveLength(before.findings.length);
    expect(afterRetry.observations).toHaveLength(before.observations.length);
    expect(afterRetry.events).toHaveLength(before.events.length);
    expect(afterRetry.duplicatesIgnored).toBeGreaterThan(0);
  });

  it("keeps working through a network partition and reconciles before fusing", async () => {
    const store = createMemoryRuntimeStore();
    const summary = await runtimeRunner(
      runFor(reportsFor("partition-recovery"), store, {
        networkActions: [
          { at: 0, kind: "partition", groups: [["fusion", "satellite", "weather"], ["vision", "witness"]] },
          { at: 5_000, kind: "heal" },
        ],
      }),
    );
    const { events, findings } = store.contents();
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["partition_started", "partition_healed", "reconciled"]));
    // Fusion waited for the isolated side's evidence instead of guessing.
    const fusion = findings.find((finding) => finding.agentId === "fusion")!;
    const witness = findings.find((finding) => finding.agentId === "witness")!;
    expect(fusion.evidenceIds.length + (fusion.recommendation?.evidenceGaps.length ?? 0)).toBeGreaterThan(0);
    expect(summary.tasks[`${summary.runId}:fusion`]).toBe("done");
    expect(witness).toBeDefined();
  });
});

describe("runtimeRunner on a live report", () => {
  it("records every unavailable source honestly and ends in an explainable state", async () => {
    const store = createMemoryRuntimeStore();
    const summary = await runtimeRunner(runFor(reportsFor("corroborated-smoke", { isSynthetic: false, media: true }), store, { gather: downGatherer }));
    const { findings, observations, statuses } = store.contents();

    expect(summary.mode).toBe("live");
    expect(findings.every((finding) => !finding.isSynthetic)).toBe(true);
    expect(observations.every((observation) => !observation.provenance.isSynthetic)).toBe(true);
    const satellite = findings.find((finding) => finding.agentId === "satellite")!;
    expect(satellite).toMatchObject({ assessment: "inconclusive", reasonCodes: ["source_unavailable"] });
    expect(satellite.explanation).toMatch(/not configured/);
    // A real photo with no live model: a gap, never a fixture result.
    const vision = findings.find((finding) => finding.agentId === "vision")!;
    expect(vision).toMatchObject({ assessment: "inconclusive", reasonCodes: ["source_unavailable"] });
    expect(vision.explanation).toMatch(/No live vision model/);
    // The status is the fusion agent's recommendation, and the last event explains it.
    expect(statuses.at(-1)?.status).toBe(summary.status);
    const fusion = findings.find((finding) => finding.agentId === "fusion")!;
    expect(summary.status).toBe(fusion.recommendation?.recommendedStatus);
    expect(store.contents().events.at(-1)?.summary).toMatch(/Automated assessment finished/);
  });

  it("uses a live vision analyzer's output through Danil's guardrails", async () => {
    const store = createMemoryRuntimeStore();
    const output = structuredClone(VISION_FIXTURES["fixture:vision/clear-smoke-column"].output);
    const analyze = vi.fn(async () => output);
    await runtimeRunner(
      runFor(reportsFor("corroborated-smoke", { isSynthetic: false, media: true }), store, {
        gather: downGatherer,
        visionAnalyzer: { id: "test:vision", analyze },
        loadMediaRef: async () => ({ imageRef: "user/photo.jpg", mimeType: "image/jpeg" }),
      }),
    );
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ imageRef: "user/photo.jpg", mimeType: "image/jpeg" }), expect.any(AbortSignal));
    const vision = store.contents().findings.find((finding) => finding.agentId === "vision")!;
    expect(vision.assessment).toBe("supports");
    expect(vision.isSynthetic).toBe(false);
    expect(vision.limitations).toEqual(expect.arrayContaining(["image_authenticity_unverifiable", "image_location_unverifiable", "image_time_unverifiable"]));
  });

  it("a failing vision model becomes a gap, not a stuck run", async () => {
    const store = createMemoryRuntimeStore();
    const summary = await runtimeRunner(
      runFor(reportsFor("corroborated-smoke", { isSynthetic: false, media: true }), store, {
        gather: downGatherer,
        visionAnalyzer: { id: "test:vision", analyze: async () => Promise.reject(new Error("rate limited")) },
        loadMediaRef: async () => ({ imageRef: "user/photo.jpg", mimeType: "image/jpeg" }),
      }),
    );
    const vision = store.contents().findings.find((finding) => finding.agentId === "vision")!;
    expect(vision.explanation).toMatch(/did not answer/);
    expect(summary.fusionFindingId).not.toBeNull();
  });
});

describe("runInvestigation failure handling", () => {
  beforeEach(() => {
    runtimeMocks.reports = reportsFor("corroborated-smoke", { isSynthetic: false });
  });

  it("records a visible, retryable failure when the store refuses writes", async () => {
    const memory = createMemoryRuntimeStore();
    const failing: EmberGapRuntimeStore = { ...memory, saveFinding: async () => Promise.reject(new Error("db down")) };
    runtimeMocks.store = failing;
    await expect(runInvestigation(runtimeMocks.reports[0] ? (runtimeMocks.reports[0] as AgentReport).investigationId : "", (run) => runtimeRunner({ ...run, gather: downGatherer }))).rejects.toThrow(/store_write_failed/);
    const failure = memory.contents().events.find((event) => event.details?.outcome === "failed");
    expect(failure?.summary).toMatch(/can be retried/);
    expect(failure?.details).toMatchObject({ code: "store_write_failed", retryable: true });
    expect(memory.contents().statuses.at(-1)).toMatchObject({ status: "needs_human_review" });
  });

  it("records a failure when a source gatherer crashes", async () => {
    const memory = createMemoryRuntimeStore();
    runtimeMocks.store = memory;
    const reports = runtimeMocks.reports as AgentReport[];
    await expect(
      runInvestigation(reports[0].investigationId, (run) => runtimeRunner({ ...run, gather: async () => Promise.reject(new Error("boom")) })),
    ).rejects.toThrow("boom");
    expect(memory.contents().events.find((event) => event.details?.outcome === "failed")?.details).toMatchObject({ code: "run_failed" });
  });

  it("derives one stable run id per report set", () => {
    const reports = reportsFor("repeated-witness");
    expect(runIdFor(reports[0].investigationId, reports)).toBe(runIdFor(reports[0].investigationId, [...reports].reverse()));
    expect(runIdFor(reports[0].investigationId, reports.slice(0, 1))).not.toBe(runIdFor(reports[0].investigationId, reports));
  });
});

describe("scheduleInvestigation", () => {
  const id = SYNTHETIC_SCENARIOS[0].investigationId;

  it("does nothing without the server-only secret key", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(canRunAgents()).toBe(false);
    expect(scheduleInvestigation(id)).toBe(false);
    expect(after).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("runs after the response when the key is configured", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
    expect(scheduleInvestigation(id)).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
