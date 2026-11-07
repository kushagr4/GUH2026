import { describe, expect, it, vi } from "vitest";
import {
  FIRMS_PROVENANCE,
  SYNTHETIC_SCENARIOS,
  agentEventSchema,
  agentFindingSchema,
  observationSchema,
  stableId,
  syntheticId,
  type AgentFinding,
  type AgentReport,
  type Observation,
  type SourceAvailability,
} from "@/lib/embergap/contracts";
import type { InvestigationRunner } from "@/features/embergap/orchestrator";
import {
  DEFAULT_SIMULATED_PARTITION,
  createMemoryRuntimeStore,
  createRuntimeInvestigationRunner,
  firmsObservationsFor,
  runInvestigationAgents,
  type InvestigationAgentsInput,
} from "@/lib/embergap/agents/runtime";
import { demoFirmsDetections } from "@/lib/embergap/sources/firms/fixtures";

// Prepared, canonical inputs, as Mac's orchestrator would hand them over after
// fetching: no test here makes a network request.
const INV = "6a7d0b52-1c38-4f0e-9a51-6d4a8f3c2b10";
const REPORT = "1f2e3d4c-5b6a-4789-8abc-def012345678";
const NOW = "2026-11-07T15:00:00.000Z";
const OBSERVED = "2026-11-07T14:40:00.000Z";
const live = { url: null, license: null, isSynthetic: false } as const;

const weatherObservation: Observation = {
  id: stableId("test/weather"),
  investigationId: INV,
  source: "weather",
  sourceRecordId: "open-meteo:53.46,-1.85:2026-11-07T15:00:00.000Z",
  observedAt: "2026-11-07T15:00:00.000Z",
  retrievedAt: NOW,
  location: { latitude: 53.463, longitude: -1.857 },
  coverage: { windowStart: "2026-11-06T14:00:00.000Z", windowEnd: "2026-11-07T20:00:00.000Z", radiusKm: 1 },
  sourceState: "available",
  provenance: { provider: "Open-Meteo", product: "forecast", ...live },
  evidence: { kind: "forecast", validAt: "2026-11-07T15:00:00.000Z", temperatureC: 21, relativeHumidityPercent: 18, windSpeedKmh: 31, windDirectionDegrees: 230, precipitationMm: 0 },
};
const eonetNone: SourceAvailability = {
  source: "eonet",
  state: "not_observed",
  checkedAt: NOW,
  latestObservedAt: null,
  maxAgeSeconds: 604_800,
  windowStart: "2026-09-08T00:00:00.000Z",
  windowEnd: "2026-11-08T23:59:59.999Z",
  message: "No EONET record matched. That is not evidence that there is no fire.",
};
const firmsDetection: Observation = {
  id: stableId("test/firms"),
  investigationId: INV,
  source: "firms",
  sourceRecordId: "firms:VIIRS_SNPP_NRT:1",
  observedAt: "2026-11-07T14:20:00.000Z",
  retrievedAt: NOW,
  location: { latitude: 53.466, longitude: -1.846 },
  coverage: { windowStart: "2026-11-06T15:00:00.000Z", windowEnd: NOW, radiusKm: 10 },
  sourceState: "available",
  provenance: { ...FIRMS_PROVENANCE, product: "VIIRS_SNPP_NRT" },
  evidence: { instrument: "VIIRS", satellite: "N", confidence: "nominal", frpMegawatts: 12, brightnessKelvin: 335, dayNight: "day", distanceKm: 0.7, version: "2.0NRT", scanKm: 0.4, trackKm: 0.4 },
};
const witnessFinding: AgentFinding = agentFindingSchema.parse({
  id: stableId("test/witness"),
  investigationId: INV,
  reportId: REPORT,
  agentId: "witness",
  createdAt: NOW,
  evidenceIds: [REPORT],
  assessment: "inconclusive",
  strength: null,
  reasonCodes: ["witness.single_report"],
  explanation: "One report so far; nothing independent to compare it with.",
  limitations: ["human_report_unverified"],
  recommendation: null,
  isSynthetic: false,
});

function input(overrides: Partial<InvestigationAgentsInput> = {}): InvestigationAgentsInput {
  return {
    investigationId: INV,
    runId: "3c9d1e2f-4a5b-4c6d-8e7f-901234567890",
    mode: "live",
    startedAt: NOW,
    reports: [{ id: REPORT, observedAt: OBSERVED, hasMedia: false }],
    observations: [weatherObservation, firmsDetection],
    sourceAvailability: [eonetNone],
    witnessFindings: [witnessFinding],
    store: createMemoryRuntimeStore(),
    ...overrides,
  };
}

describe("an investigation run from prepared, canonical inputs", () => {
  it("dispatches each input to its own agent, and every finding passes the contract", async () => {
    const store = createMemoryRuntimeStore();
    const status = vi.spyOn(store, "setAutomatedStatus");
    const result = await runInvestigationAgents(input({ store }));
    expect(result).toMatchObject({ settled: true, converged: true, stopReason: "settled", rejectedInputs: 0, host: "in-process", clock: "simulated" });
    expect(result.tasks.filter((task) => !task.kind.startsWith("fusion")).map((task) => [task.agentId, task.kind, task.status])).toEqual([
      ["satellite", "satellite.observations", "done"],
      ["weather", "eonet.observations", "done"],
      ["weather", "weather.observations", "done"],
      ["witness", "witness.findings", "done"],
    ]);
    const byAgent = (agentId: string) => result.findings.filter((finding) => finding.agentId === agentId);
    for (const finding of result.findings) agentFindingSchema.parse(finding);
    expect(byAgent("satellite")[0]).toMatchObject({ assessment: "supports", strength: "moderate", reasonCodes: ["thermal_anomaly_nearby"] });
    expect(byAgent("weather").map((finding) => [finding.assessment, finding.reasonCodes])).toEqual([
      ["inconclusive", ["eonet.no_matching_record"]],
      ["context", ["dry_or_windy_conditions"]],
    ]);
    expect(byAgent("witness")[0]).toMatchObject({ reportId: REPORT, evidenceIds: [REPORT], reasonCodes: ["witness.single_report"] });
    // Fusion re-ran as evidence reached it, and its latest recommendation set the status.
    expect(result.recommendation?.agentId).toBe("fusion");
    expect(result.recommendation?.recommendation).toMatchObject({ recommendedStatus: expect.any(String) });
    expect(status).toHaveBeenCalledWith(INV, result.recommendation!.recommendation!.recommendedStatus, result.recommendation!.recommendation!.reviewPriority);
    expect(result.tasks.filter((task) => task.agentId === "fusion").every((task) => task.status === "done" && task.runs === 1)).toBe(true);
  });

  it("stores observations, findings, task, sharing and finding events in the contract's shapes", async () => {
    const store = createMemoryRuntimeStore();
    await runInvestigationAgents(input({ store }));
    const contents = store.contents();
    for (const observation of contents.observations) observationSchema.parse(observation);
    for (const event of contents.events) agentEventSchema.parse(event);
    const types = new Set(contents.events.map((event) => event.type));
    expect(types).toEqual(new Set(["task_queued", "finding_recorded", "message_delivered"]));
    expect(contents.events.find((event) => event.type === "message_delivered" && event.actor === "fusion")?.summary).toMatch(/received \d+ record\(s\) shared by/);
    expect(JSON.stringify(contents)).not.toMatch(/14:40:00|description/);
  });

  it("is idempotent: a retried run with the same runId writes nothing new", async () => {
    const store = createMemoryRuntimeStore();
    await runInvestigationAgents(input({ store }));
    const before = store.contents();
    await runInvestigationAgents(input({ store }));
    const after = store.contents();
    expect(after.findings).toHaveLength(before.findings.length);
    expect(after.events).toHaveLength(before.events.length);
  });

  it("records unavailable sources as unknown, never as evidence against a fire", async () => {
    const down = (source: SourceAvailability["source"]): SourceAvailability => ({
      source,
      state: "unavailable",
      checkedAt: NOW,
      latestObservedAt: null,
      maxAgeSeconds: 3_600,
      windowStart: null,
      windowEnd: null,
      message: "The source could not be reached.",
    });
    const result = await runInvestigationAgents(input({ observations: [], sourceAvailability: [down("weather"), down("eonet"), down("firms")], witnessFindings: [] }));
    expect(result.settled).toBe(true);
    const sources = result.findings.filter((finding) => finding.agentId !== "fusion");
    expect(sources).toHaveLength(3);
    for (const finding of sources) {
      expect(finding).toMatchObject({ assessment: "inconclusive", reasonCodes: ["source_unavailable"] });
      expect(finding.limitations).toContain("source_unavailable");
    }
    expect(result.findings.some((finding) => finding.assessment === "contradicts")).toBe(false);
    expect(result.recommendation?.recommendation?.recommendedStatus).not.toBe("needs_human_review");
  });

  it("keeps a contradicting finding with its provenance and limitations, and fusion lists it", async () => {
    const result = await runInvestigationAgents(
      input({
        mode: "synthetic",
        observations: [{ ...weatherObservation, provenance: { ...weatherObservation.provenance, isSynthetic: true } }],
        witnessFindings: [{ ...witnessFinding, isSynthetic: true }],
        vision: { mediaId: syntheticId("test/media"), reportObservedAt: OBSERVED, labels: ["clear sky"], smokeLike: false, modelOutput: "fixture:vision/no-indicators" },
      }),
    );
    const vision = result.findings.find((finding) => finding.agentId === "vision")!;
    expect(vision).toMatchObject({ assessment: "contradicts", strength: "weak" });
    expect(vision.limitations).toEqual(expect.arrayContaining(["image_authenticity_unverifiable", "image_location_unverifiable", "image_time_unverifiable"]));
    expect(vision.evidenceIds).toHaveLength(1);
    expect(result.recommendation?.recommendation?.contradictingFindingIds).toContain(vision.id);
  });

  it("keeps live and synthetic evidence apart: a live run drops synthetic inputs", async () => {
    const result = await runInvestigationAgents(
      input({ observations: [weatherObservation, { ...firmsDetection, provenance: { ...firmsDetection.provenance, isSynthetic: true } }] }),
    );
    expect(result.rejectedInputs).toBe(1);
    expect(result.findings.some((finding) => finding.agentId === "satellite")).toBe(false);
    expect(result.findings.every((finding) => !finding.isSynthetic)).toBe(true);
  });

  it("stops when cancelled or out of budget, and says why", async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await runInvestigationAgents(input({ signal: controller.signal }))).stopReason).toBe("cancelled");
    expect((await runInvestigationAgents(input({ budgetMs: -1 }))).stopReason).toBe("budget");
  });

  it("through a simulated partition, fusion first holds partial evidence, then converges after the heal", async () => {
    const result = await runInvestigationAgents(input({ partition: DEFAULT_SIMULATED_PARTITION }));
    expect(result).toMatchObject({ settled: true, converged: true });
    expect(new Set(Object.values(result.historyHashes)).size).toBe(1);
    expect(result.reconciliation).toMatchObject({ isolated: ["fusion", "witness"] });
    expect(result.reconciliation!.redelivered).toBeGreaterThan(0);
    // Fusion could only fuse what reached it: its first run saw fewer findings than its last.
    const fusion = result.findings.filter((finding) => finding.agentId === "fusion");
    expect(fusion.length).toBeGreaterThan(1);
    expect(fusion[0].evidenceIds.length).toBeLessThan(fusion.at(-1)!.evidenceIds.length);
  });
});

describe("Outrolife's FIRMS result as satellite input", () => {
  const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === "corroborated-smoke")!;
  const location = { latitude: Math.round(scenario.report.latitude * 100) / 100, longitude: Math.round(scenario.report.longitude * 100) / 100, precisionMeters: 1_000 };

  it("maps nearby detections to canonical observations with their distance, and none nearby to not_observed", () => {
    const detections = demoFirmsDetections();
    const result = {
      product: "VIIRS_SNPP_NRT" as const,
      dayRange: 2,
      detections,
      availability: {
        source: "firms" as const,
        state: "available" as const,
        checkedAt: "2026-11-07T12:00:00.000Z",
        latestObservedAt: detections[0]?.observedAt ?? null,
        maxAgeSeconds: 43_200,
        windowStart: "2026-11-05T12:00:00.000Z",
        windowEnd: "2026-11-07T12:00:00.000Z",
        message: null,
      },
    };
    const near = firmsObservationsFor(result, { investigationId: scenario.investigationId, location, observedAt: scenario.report.observedAt });
    for (const observation of near.observations) {
      expect(observationSchema.parse(observation)).toMatchObject({ source: "firms", provenance: { isSynthetic: true } });
      expect(observation.source === "firms" && observation.evidence?.distanceKm).toBeLessThanOrEqual(10);
    }
    const far = firmsObservationsFor(result, { investigationId: scenario.investigationId, location: { latitude: 0, longitude: 0, precisionMeters: 1_000 }, observedAt: scenario.report.observedAt });
    expect(far.observations).toEqual([]);
    expect(far.availability.state).toBe("not_observed");
  });
});

describe("the InvestigationRunner adapter", () => {
  const report: AgentReport = {
    id: REPORT,
    investigationId: INV,
    observedAt: OBSERVED,
    submittedAt: NOW,
    description: "Smoke over the ridge, seen from the road.",
    location: { latitude: 53.4612, longitude: -1.8534, uncertaintyMeters: 500 },
    reporterKey: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
    media: null,
    isSynthetic: false,
  };

  it("has Mac's InvestigationRunner shape and runs the agents on gathered inputs", async () => {
    const store = createMemoryRuntimeStore();
    const gather = vi.fn(async () => ({ observations: [weatherObservation, firmsDetection], sourceAvailability: [eonetNone] }));
    const runner: InvestigationRunner = createRuntimeInvestigationRunner({ gather, witnessFindings: async () => [witnessFinding] });
    await runner({
      investigationId: INV,
      reports: [report],
      store,
      now: () => NOW,
      newId: (name) => stableId(`${INV}:${name}`),
      signal: AbortSignal.timeout(45_000),
    });
    expect(gather).toHaveBeenCalledWith(expect.objectContaining({ investigationId: INV }), {
      location: { latitude: 53.46, longitude: -1.85, precisionMeters: 1_000 },
      observedAt: OBSERVED,
      syntheticScenarioId: null,
    });
    const contents = store.contents();
    expect(new Set(contents.findings.map((finding) => finding.agentId))).toEqual(new Set(["satellite", "weather", "witness", "fusion"]));
    expect(contents.statuses).toHaveLength(1);
    // The report's text and exact point never reach stored records.
    expect(JSON.stringify(contents)).not.toContain("Smoke over the ridge");
    expect(JSON.stringify(contents)).not.toContain("53.4612");
  });
});
