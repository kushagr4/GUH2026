import {
  FIRMS_PROVENANCE,
  SOURCE_MAX_AGE_SECONDS,
  SYNTHETIC_NOW,
  SYNTHETIC_SCENARIOS,
  classifyFreshness,
  syntheticId,
  toPublicLocation,
  type AgentEvent,
  type AgentEventType,
  type AgentFinding,
  type AgentId,
  type Assessment,
  type EventActor,
  type EvidenceStrength,
  type FusionRecommendation,
  type InvestigationDetailResponse,
  type InvestigationReadRepository,
  type InvestigationStatus,
  type LimitationCode,
  type MapFeature,
  type MapQuery,
  type MediaView,
  type Observation,
  type Provenance,
  type ReportView,
  type ReviewPriority,
  type SourceAvailability,
  type SourceKind,
  type SyntheticScenarioId,
} from "@/lib/embergap/contracts";
import { bboxContains } from "@/lib/embergap/sources/firms/bbox";
import { demoFirmsDetections } from "@/lib/embergap/sources/firms/fixtures";

/**
 * SYNTHETIC DEMO DATA, served through Mac's InvestigationReadRepository port.
 *
 * Until Mac's Supabase-backed repository lands (it reads the same six
 * scenarios from seeded rows, under the caller's RLS), the GET routes use this
 * in-memory one. Every investigation, report, finding and event here is
 * invented and flagged isSynthetic. Times are fixed before SYNTHETIC_NOW.
 */

type Scenario = (typeof SYNTHETIC_SCENARIOS)[number];

const minutes = (iso: string, delta: number) => new Date(Date.parse(iso) + delta * 60_000).toISOString();
const id = (scenario: string, name: string) => syntheticId(`outrolife/${scenario}/${name}`);

const REPORTER_PROVENANCE: Provenance = {
  provider: "EmberGap reporter",
  product: null,
  url: null,
  license: null,
  isSynthetic: true,
};
const WEATHER_PROVENANCE: Provenance = {
  provider: "Open-Meteo",
  product: "forecast",
  url: "https://open-meteo.com/",
  license: "CC BY 4.0",
  isSynthetic: true,
};
const EONET_PROVENANCE: Provenance = {
  provider: "NASA EONET",
  product: "events v3",
  url: "https://eonet.gsfc.nasa.gov/",
  license: null,
  isSynthetic: true,
};
const VISION_PROVENANCE: Provenance = {
  provider: "EmberGap vision agent",
  product: "mock",
  url: null,
  license: null,
  isSynthetic: true,
};

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 100) / 100;
}

type WeatherSpec =
  | { state: "available"; temperatureC: number; humidity: number; windKmh: number; windFrom: number; precipMm: number }
  | { state: "unavailable"; message: string };

type FindingSpec = {
  agent: AgentId;
  name: string;
  at: number;
  assessment: Assessment;
  strength?: EvidenceStrength;
  reasons: string[];
  explanation: string;
  limitations?: LimitationCode[];
  notes?: string[];
  evidence?: string[];
  reportIndex?: number;
  recommendation?: FusionRecommendation;
};

type EventSpec = {
  type: AgentEventType;
  actor: EventActor;
  at: number;
  summary: string;
  details?: Record<string, unknown>;
};

type ScenarioSpec = {
  status: Extract<InvestigationStatus, "investigating" | "needs_human_review" | "insufficient_evidence">;
  reviewPriority: ReviewPriority;
  /** One per report in the scenario. */
  reports: Array<{ description: string; hasMedia: boolean; minutesAfterFirst?: number; photoSha256?: string; labels?: string[] }>;
  /** FIRMS coverage end when nothing was detected: the last overpass. */
  firmsLastPass?: string;
  weather: WeatherSpec;
  findings: (ref: Refs) => FindingSpec[];
  events: (ref: Refs) => EventSpec[];
};

type Refs = {
  reportIds: string[];
  humanObs: string[];
  visionObs: string[];
  firmsObs: string[];
  weatherObs: string;
  finding: (name: string) => string;
};

const VISION_LIMITS: LimitationCode[] = [
  "image_authenticity_unverifiable",
  "image_location_unverifiable",
  "image_time_unverifiable",
  "model_output_uncalibrated",
];

const SAME_PHOTO = "3f1c5a0e9b7d4c2a8e6f1b3d5c7a9e0f2b4d6c8a1e3f5b7d9c0a2e4f6b8d1c3a";

const SPECS: Record<SyntheticScenarioId, ScenarioSpec> = {
  "corroborated-smoke": {
    status: "needs_human_review",
    reviewPriority: "high",
    reports: [
      {
        description: "Grey-brown smoke rising from the moor, drifting east. Smell of burning heather.",
        hasMedia: true,
        labels: ["smoke-like plume", "darker base", "hillside"],
      },
    ],
    weather: { state: "available", temperatureC: 14, humidity: 41, windKmh: 22, windFrom: 250, precipMm: 0 },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 4,
        assessment: "context",
        reasons: ["dry_or_windy_conditions"],
        explanation: "Dry air and a westerly breeze would carry smoke east, as described. Context only.",
        limitations: ["weather_is_context_only"],
        evidence: [ref.weatherObs],
      },
      {
        agent: "vision",
        name: "vision",
        at: 6,
        assessment: "supports",
        strength: "moderate",
        reasons: ["smoke_like_features_visible"],
        explanation: "The photo shows a plume with a darker base and a brown tint, consistent with vegetation smoke.",
        limitations: VISION_LIMITS,
        notes: ["Dust, cloud and steam can look similar."],
        evidence: ref.visionObs,
        reportIndex: 0,
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 9,
        assessment: "supports",
        strength: "moderate",
        reasons: ["thermal_anomaly_nearby"],
        explanation: "Two adjacent VIIRS detections about 0.5 km from the reported area, 13 minutes before the report.",
        limitations: [],
        notes: ["A thermal anomaly is an observation, not a fire confirmation."],
        evidence: ref.firmsObs,
      },
      {
        agent: "witness",
        name: "witness",
        at: 10,
        assessment: "inconclusive",
        reasons: ["witness.single_report"],
        explanation: "One report so far, so there is nothing to corroborate it with.",
        limitations: ["human_report_unverified"],
        evidence: ref.humanObs,
        reportIndex: 0,
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 12,
        assessment: "context",
        reasons: ["fusion.rule.S2-two-independent"],
        explanation: "Recommend high-priority human review: the photo description and the satellite detections are independent and agree.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("vision"), ref.finding("satellite"), ref.finding("weather"), ref.finding("witness")],
        recommendation: {
          recommendedStatus: "needs_human_review",
          reviewPriority: "high",
          independentSourceCount: 2,
          supportingFindingIds: [ref.finding("vision"), ref.finding("satellite")],
          contradictingFindingIds: [],
          evidenceGaps: ["No ground confirmation.", "The photo's time and place cannot be checked."],
          possibleDuplicateReportIds: [],
        },
      },
    ],
    events: () => [
      { type: "finding_recorded", actor: "weather", at: 4, summary: "Weather context recorded." },
      { type: "finding_recorded", actor: "vision", at: 6, summary: "Photo described." },
      { type: "finding_recorded", actor: "satellite", at: 9, summary: "2 FIRMS detections matched." },
      { type: "finding_recorded", actor: "witness", at: 10, summary: "Single report: nothing to corroborate yet." },
      { type: "finding_recorded", actor: "fusion", at: 12, summary: "Recommendation: high-priority human review." },
      { type: "status_changed", actor: "system", at: 12, summary: "Status set to needs human review." },
    ],
  },

  "misleading-photo": {
    status: "needs_human_review",
    reviewPriority: "low",
    reports: [
      {
        description: "White smoke filling the valley. I think I can smell burning.",
        hasMedia: true,
        labels: ["low cloud", "valley fog", "no visible source"],
      },
    ],
    firmsLastPass: "2026-11-07T10:10:00.000Z",
    weather: { state: "available", temperatureC: 8, humidity: 97, windKmh: 4, windFrom: 180, precipMm: 3.2 },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 4,
        assessment: "context",
        reasons: ["recent_precipitation"],
        explanation: "Near-saturated, still air after rain makes fog likely. It does not rule a fire in or out.",
        limitations: ["weather_is_context_only"],
        evidence: [ref.weatherObs],
      },
      {
        agent: "vision",
        name: "vision",
        at: 6,
        assessment: "contradicts",
        strength: "moderate",
        reasons: ["no_smoke_like_features_visible"],
        explanation: "An even white-grey layer along the valley floor with no visible source or rising column, more typical of low cloud.",
        limitations: VISION_LIMITS,
        notes: ["Smoke and fog can look alike."],
        evidence: ref.visionObs,
        reportIndex: 0,
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 35,
        assessment: "inconclusive",
        reasons: ["no_thermal_detection_in_window"],
        explanation: "A pass 30 minutes after the report detected nothing within 5 km, but cloud may have blocked the view.",
        limitations: ["no_detection_is_not_absence"],
        notes: ["Cloud can hide fires from satellites."],
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 37,
        assessment: "context",
        reasons: ["conflicting_evidence"],
        explanation: "Low priority, with the contradiction kept for a human: the photo looks like cloud, but the reporter mentions a smell of smoke.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("vision"), ref.finding("weather"), ref.finding("satellite")],
        recommendation: {
          recommendedStatus: "needs_human_review",
          reviewPriority: "low",
          independentSourceCount: 0,
          supportingFindingIds: [],
          contradictingFindingIds: [ref.finding("vision")],
          evidenceGaps: ["The reported smell of smoke cannot be checked from the photo.", "Only one report."],
          possibleDuplicateReportIds: [],
        },
      },
    ],
    events: () => [
      { type: "finding_recorded", actor: "weather", at: 4, summary: "Weather context recorded." },
      { type: "finding_recorded", actor: "vision", at: 6, summary: "Photo described: looks like low cloud." },
      { type: "finding_recorded", actor: "satellite", at: 35, summary: "Post-report pass: no detection (unknown, not negative)." },
      { type: "finding_recorded", actor: "fusion", at: 37, summary: "Recommendation: low priority, contradiction kept." },
      { type: "status_changed", actor: "system", at: 37, summary: "Status set to needs human review." },
    ],
  },

  "missing-satellite-pass": {
    status: "investigating",
    reviewPriority: "medium",
    reports: [{ description: "Brownish haze along the valley. I can't see flames.", hasMedia: false }],
    firmsLastPass: "2026-11-07T08:52:00.000Z",
    weather: { state: "available", temperatureC: 12, humidity: 55, windKmh: 30, windFrom: 230, precipMm: 0 },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 4,
        assessment: "context",
        reasons: ["dry_or_windy_conditions"],
        explanation: "Breezy conditions. Context only.",
        limitations: ["weather_is_context_only"],
        evidence: [ref.weatherObs],
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 5,
        assessment: "inconclusive",
        reasons: ["satellite_pass_gap"],
        explanation: "No satellite has passed over since the report: the last pass was at 08:52 UTC. Checking again after the next one.",
        limitations: ["no_detection_is_not_absence"],
      },
      {
        agent: "witness",
        name: "witness",
        at: 6,
        assessment: "inconclusive",
        reasons: ["witness.single_report"],
        explanation: "One report, no photo.",
        limitations: ["human_report_unverified"],
        evidence: ref.humanObs,
        reportIndex: 0,
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 8,
        assessment: "context",
        reasons: ["fusion.rule.awaiting_satellite_pass"],
        explanation: "Keep investigating. The missing satellite pass is a gap, not evidence that there is no fire.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("satellite"), ref.finding("weather"), ref.finding("witness")],
        recommendation: {
          recommendedStatus: "investigating",
          reviewPriority: "medium",
          independentSourceCount: 0,
          supportingFindingIds: [],
          contradictingFindingIds: [],
          evidenceGaps: ["No FIRMS pass since 08:52 UTC, before the report.", "No photo.", "Only one report."],
          possibleDuplicateReportIds: [],
        },
      },
    ],
    events: () => [
      { type: "finding_recorded", actor: "weather", at: 4, summary: "Weather context recorded." },
      { type: "finding_recorded", actor: "satellite", at: 5, summary: "No pass since the report. Recheck scheduled." },
      { type: "finding_recorded", actor: "witness", at: 6, summary: "Single report." },
      { type: "finding_recorded", actor: "fusion", at: 8, summary: "Recommendation: keep investigating." },
      { type: "status_changed", actor: "system", at: 8, summary: "Status set to investigating." },
    ],
  },

  "weather-timeout": {
    status: "needs_human_review",
    reviewPriority: "medium",
    reports: [
      {
        description: "A line of smoke on the hillside above the reservoir.",
        hasMedia: true,
        labels: ["smoke-like haze", "hillside"],
      },
    ],
    weather: { state: "unavailable", message: "The weather source did not respond in time." },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 4,
        assessment: "inconclusive",
        reasons: ["source_unavailable"],
        explanation: "The weather source timed out, so there is no weather context for this report.",
        limitations: ["weather_is_context_only", "source_unavailable"],
      },
      {
        agent: "vision",
        name: "vision",
        at: 6,
        assessment: "supports",
        strength: "weak",
        reasons: ["smoke_like_features_visible"],
        explanation: "A faint smoke-like haze along the slope. It is hard to separate from mist at this distance.",
        limitations: VISION_LIMITS,
        evidence: ref.visionObs,
        reportIndex: 0,
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 7,
        assessment: "supports",
        strength: "moderate",
        reasons: ["thermal_anomaly_nearby"],
        explanation: "A MODIS detection within 1 km, 19 minutes before the report.",
        limitations: ["low_spatial_precision"],
        notes: ["MODIS pixels are about 1 km across."],
        evidence: ref.firmsObs,
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 9,
        assessment: "context",
        reasons: ["fusion.rule.S2-two-independent"],
        explanation: "Medium priority: two sources point the same way, but one is weak and the weather context is missing.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("vision"), ref.finding("satellite"), ref.finding("weather")],
        recommendation: {
          recommendedStatus: "needs_human_review",
          reviewPriority: "medium",
          independentSourceCount: 2,
          supportingFindingIds: [ref.finding("vision"), ref.finding("satellite")],
          contradictingFindingIds: [],
          evidenceGaps: ["No weather context: the weather source timed out."],
          possibleDuplicateReportIds: [],
        },
      },
    ],
    events: () => [
      { type: "message_dropped", actor: "weather", at: 3, summary: "Weather request timed out." },
      { type: "finding_recorded", actor: "weather", at: 4, summary: "Weather marked unavailable." },
      { type: "finding_recorded", actor: "vision", at: 6, summary: "Photo described." },
      { type: "finding_recorded", actor: "satellite", at: 7, summary: "1 FIRMS detection matched." },
      { type: "finding_recorded", actor: "fusion", at: 9, summary: "Recommendation: medium priority." },
      { type: "status_changed", actor: "system", at: 9, summary: "Status set to needs human review." },
    ],
  },

  "repeated-witness": {
    status: "needs_human_review",
    reviewPriority: "medium",
    reports: [
      {
        description: "Smoke column behind the farm, getting bigger.",
        hasMedia: true,
        photoSha256: SAME_PHOTO,
        labels: ["smoke-like column", "farm buildings"],
      },
      {
        description: "Same smoke as before, now darker.",
        hasMedia: true,
        minutesAfterFirst: 14,
        photoSha256: SAME_PHOTO,
        labels: ["smoke-like column", "farm buildings"],
      },
    ],
    weather: { state: "available", temperatureC: 11, humidity: 48, windKmh: 18, windFrom: 270, precipMm: 0 },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 4,
        assessment: "context",
        reasons: ["dry_or_windy_conditions"],
        explanation: "Dry with a moderate westerly. Context only.",
        limitations: ["weather_is_context_only"],
        evidence: [ref.weatherObs],
      },
      {
        agent: "vision",
        name: "vision",
        at: 6,
        assessment: "supports",
        strength: "weak",
        reasons: ["smoke_like_features_visible"],
        explanation: "A rising smoke-like column behind buildings. The second report carries the identical photo.",
        limitations: VISION_LIMITS,
        evidence: ref.visionObs,
        reportIndex: 0,
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 8,
        assessment: "supports",
        strength: "weak",
        reasons: ["thermal_anomaly_nearby"],
        explanation: "One nominal-class VIIRS detection within 1 km, 18 minutes before the first report.",
        limitations: [],
        evidence: ref.firmsObs,
      },
      {
        agent: "witness",
        name: "witness",
        at: 18,
        assessment: "inconclusive",
        reasons: ["possible_duplicate_report"],
        explanation: "The second report is from the same reporter, 14 minutes later, with the identical photo. It counts once.",
        limitations: ["possible_shared_origin", "human_report_unverified"],
        evidence: [...ref.humanObs],
        reportIndex: 1,
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 20,
        assessment: "context",
        reasons: ["fusion.rule.duplicates_counted_once"],
        explanation: "Medium priority. The repeated report is not counted as a second witness.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("vision"), ref.finding("satellite"), ref.finding("witness")],
        recommendation: {
          recommendedStatus: "needs_human_review",
          reviewPriority: "medium",
          independentSourceCount: 2,
          supportingFindingIds: [ref.finding("vision"), ref.finding("satellite")],
          contradictingFindingIds: [],
          evidenceGaps: ["Only one independent witness."],
          possibleDuplicateReportIds: [ref.reportIds[1]!],
        },
      },
    ],
    events: () => [
      { type: "finding_recorded", actor: "weather", at: 4, summary: "Weather context recorded." },
      { type: "finding_recorded", actor: "vision", at: 6, summary: "Photo described." },
      { type: "finding_recorded", actor: "satellite", at: 8, summary: "1 FIRMS detection matched." },
      { type: "report_submitted", actor: "reporter", at: 14, summary: "Second report received from the same reporter." },
      { type: "finding_recorded", actor: "witness", at: 18, summary: "Second report flagged as a possible duplicate." },
      { type: "finding_recorded", actor: "fusion", at: 20, summary: "Recommendation: medium priority, duplicate counted once." },
      { type: "status_changed", actor: "system", at: 20, summary: "Status set to needs human review." },
    ],
  },

  "partition-recovery": {
    status: "needs_human_review",
    reviewPriority: "high",
    reports: [
      {
        description: "Flames at the edge of the plantation, smoke blowing north-east.",
        hasMedia: true,
        labels: ["visible flame", "dark smoke", "tree line"],
      },
    ],
    weather: { state: "available", temperatureC: 13, humidity: 38, windKmh: 26, windFrom: 225, precipMm: 0 },
    findings: (ref) => [
      {
        agent: "weather",
        name: "weather",
        at: 3,
        assessment: "context",
        reasons: ["dry_or_windy_conditions"],
        explanation: "Dry and breezy from the south-west, matching the described smoke direction. Context only.",
        limitations: ["weather_is_context_only"],
        evidence: [ref.weatherObs],
      },
      {
        agent: "vision",
        name: "vision",
        at: 4,
        assessment: "supports",
        strength: "moderate",
        reasons: ["smoke_like_features_visible"],
        explanation: "Visible flame and dark smoke along a tree line.",
        limitations: VISION_LIMITS,
        evidence: ref.visionObs,
        reportIndex: 0,
      },
      {
        agent: "satellite",
        name: "satellite",
        at: 6,
        assessment: "supports",
        strength: "moderate",
        reasons: ["thermal_anomaly_nearby"],
        explanation: "A high-class VIIRS detection within 1 km, 7 minutes before the report. Recorded while cut off from the fusion agent, delivered after reconnection.",
        limitations: [],
        evidence: ref.firmsObs,
      },
      {
        agent: "fusion",
        name: "fusion",
        at: 11,
        assessment: "context",
        reasons: ["fusion.rule.S2-two-independent"],
        explanation: "Raised to high priority once the satellite finding arrived after the partition healed.",
        limitations: ["heuristic_thresholds_uncalibrated"],
        evidence: [ref.finding("vision"), ref.finding("satellite"), ref.finding("weather")],
        recommendation: {
          recommendedStatus: "needs_human_review",
          reviewPriority: "high",
          independentSourceCount: 2,
          supportingFindingIds: [ref.finding("vision"), ref.finding("satellite")],
          contradictingFindingIds: [],
          evidenceGaps: ["No ground confirmation."],
          possibleDuplicateReportIds: [],
        },
      },
    ],
    events: (ref) => {
      const partition = { partitionId: ref.finding("partition"), isolated: ["satellite"] };
      return [
        { type: "finding_recorded", actor: "weather", at: 3, summary: "Weather context recorded." },
        { type: "finding_recorded", actor: "vision", at: 4, summary: "Photo described." },
        { type: "partition_started", actor: "system", at: 5, summary: "Satellite agent cut off from the others.", details: partition },
        { type: "finding_recorded", actor: "satellite", at: 6, summary: "FIRMS detection matched locally while cut off." },
        { type: "partition_healed", actor: "system", at: 9, summary: "Link restored.", details: partition },
        { type: "message_delivered", actor: "satellite", at: 9, summary: "Queued satellite finding delivered." },
        { type: "duplicate_ignored", actor: "fusion", at: 10, summary: "A retried copy of the same message was ignored." },
        {
          type: "reconciled",
          actor: "system",
          at: 10,
          summary: "Reconciled: 1 redelivered, 1 duplicate ignored, 1 task completed while isolated.",
          details: { ...partition, redelivered: 1, duplicatesIgnored: 1, completedWhileIsolated: 1 },
        },
        { type: "finding_recorded", actor: "fusion", at: 11, summary: "Recommendation: high-priority human review." },
        { type: "status_changed", actor: "system", at: 11, summary: "Status set to needs human review." },
      ];
    },
  },
};

function buildDetail(scenario: Scenario): InvestigationDetailResponse {
  const spec = SPECS[scenario.id];
  const s = scenario.id;
  const investigationId = scenario.investigationId;
  const first = scenario.report.observedAt;
  const opened = minutes(first, 3);
  const publicLocation = toPublicLocation(scenario.report);
  const reportIds: string[] = [...scenario.reportIds];

  const reports: ReportView[] = spec.reports.map((report, index) => {
    const observedAt = minutes(first, report.minutesAfterFirst ?? 0);
    return {
      id: reportIds[index]!,
      investigationId,
      observedAt,
      submittedAt: minutes(observedAt, 3),
      description: report.description,
      location: {
        latitude: scenario.report.latitude,
        longitude: scenario.report.longitude,
        uncertaintyMeters: scenario.report.uncertaintyMeters,
      },
      mediaIds: report.hasMedia ? [id(s, `media-${index + 1}`)] : [],
      verification: "unverified",
      isSynthetic: true,
    };
  });

  const media: MediaView[] = reports.flatMap((report) =>
    report.mediaIds.map((mediaId) => ({
      id: mediaId,
      reportId: report.id,
      mimeType: "image/jpeg" as const,
      sizeBytes: 248_000,
      url: null,
      urlExpiresAt: null,
      isSynthetic: true,
    })),
  );

  const humanObs: Observation[] = reports.map((report, index) => ({
    id: id(s, `obs-human-${index + 1}`),
    investigationId,
    source: "human",
    sourceRecordId: report.id,
    observedAt: report.observedAt,
    retrievedAt: report.submittedAt,
    location: null,
    coverage: null,
    sourceState: "available",
    provenance: REPORTER_PROVENANCE,
    evidence: { reportId: report.id, hasMedia: report.mediaIds.length > 0 },
  }));

  const visionObs: Observation[] = spec.reports.flatMap((report, index) =>
    report.hasMedia
      ? [
          {
            id: id(s, `obs-vision-${index + 1}`),
            investigationId,
            source: "vision" as const,
            sourceRecordId: null,
            observedAt: reports[index]!.observedAt,
            retrievedAt: minutes(reports[index]!.submittedAt, 2),
            location: null,
            coverage: null,
            sourceState: "available" as const,
            provenance: VISION_PROVENANCE,
            evidence: {
              mediaId: reports[index]!.mediaIds[0]!,
              model: "mock-vision",
              labels: report.labels ?? [],
              contentSha256: report.photoSha256 ?? null,
            },
          },
        ]
      : [],
  );

  const detections = demoFirmsDetections()
    .filter((detection) => distanceKm(publicLocation, detection) <= 5)
    .filter((detection) => Date.parse(detection.observedAt) <= Date.parse(SYNTHETIC_NOW));
  const firmsChecked = minutes(opened, 2);
  const firmsWindowStart = minutes(first, -24 * 60);
  const firmsObs: Observation[] = detections.length
    ? detections.map((detection) => ({
        id: detection.id,
        investigationId,
        source: "firms" as const,
        sourceRecordId: detection.id,
        observedAt: detection.observedAt,
        retrievedAt: firmsChecked,
        location: { latitude: detection.latitude, longitude: detection.longitude },
        coverage: { windowStart: firmsWindowStart, windowEnd: detection.observedAt, radiusKm: 5 },
        sourceState: classifyFreshness({
          latestObservedAt: detection.observedAt,
          checkedAt: firmsChecked,
          maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.firms,
          referenceAt: first,
        }),
        provenance: { ...FIRMS_PROVENANCE, product: detection.product, isSynthetic: true },
        evidence: { ...detection.evidence, distanceKm: distanceKm(publicLocation, detection) },
      }))
    : [
        {
          id: id(s, "obs-firms"),
          investigationId,
          source: "firms" as const,
          sourceRecordId: null,
          observedAt: null,
          retrievedAt: firmsChecked,
          location: null,
          coverage: { windowStart: firmsWindowStart, windowEnd: spec.firmsLastPass ?? firmsChecked, radiusKm: 5 },
          sourceState: "not_observed" as const,
          provenance: { ...FIRMS_PROVENANCE, product: "VIIRS_SNPP_NRT", isSynthetic: true },
          evidence: null,
        },
      ];

  const weatherObsId = id(s, "obs-weather");
  const weatherChecked = minutes(opened, 1);
  const weatherObs: Observation =
    spec.weather.state === "available"
      ? {
          id: weatherObsId,
          investigationId,
          source: "weather",
          sourceRecordId: null,
          observedAt: first,
          retrievedAt: weatherChecked,
          location: { latitude: publicLocation.latitude, longitude: publicLocation.longitude },
          coverage: null,
          sourceState: "available",
          provenance: WEATHER_PROVENANCE,
          evidence: {
            kind: "modelled",
            validAt: first,
            temperatureC: spec.weather.temperatureC,
            relativeHumidityPercent: spec.weather.humidity,
            windSpeedKmh: spec.weather.windKmh,
            windDirectionDegrees: spec.weather.windFrom,
            precipitationMm: spec.weather.precipMm,
          },
        }
      : {
          id: weatherObsId,
          investigationId,
          source: "weather",
          sourceRecordId: null,
          observedAt: null,
          retrievedAt: weatherChecked,
          location: null,
          coverage: null,
          sourceState: "unavailable",
          provenance: WEATHER_PROVENANCE,
          evidence: null,
        };

  const eonetObs: Observation = {
    id: id(s, "obs-eonet"),
    investigationId,
    source: "eonet",
    sourceRecordId: null,
    observedAt: null,
    retrievedAt: weatherChecked,
    location: null,
    coverage: { windowStart: minutes(first, -7 * 24 * 60), windowEnd: weatherChecked, radiusKm: 50 },
    sourceState: "not_observed",
    provenance: EONET_PROVENANCE,
    evidence: null,
  };

  const observations = [...humanObs, ...visionObs, ...firmsObs, weatherObs, eonetObs];

  const refs: Refs = {
    reportIds,
    humanObs: humanObs.map((o) => o.id),
    visionObs: visionObs.map((o) => o.id),
    firmsObs: detections.map((d) => d.id),
    weatherObs: weatherObsId,
    finding: (name) => id(s, `finding-${name}`),
  };

  const findings: AgentFinding[] = spec.findings(refs).map((f) => ({
    id: refs.finding(f.name),
    investigationId,
    reportId: f.reportIndex === undefined ? null : reportIds[f.reportIndex]!,
    agentId: f.agent,
    createdAt: minutes(opened, f.at),
    evidenceIds: f.evidence ?? [],
    assessment: f.assessment,
    strength: f.strength ?? null,
    reasonCodes: f.reasons,
    explanation: f.explanation,
    limitations: f.limitations ?? [],
    limitationNotes: f.notes ?? [],
    recommendation: f.recommendation ?? null,
    isSynthetic: true,
  }));

  const eventSpecs: EventSpec[] = [
    { type: "report_submitted", actor: "reporter", at: 0, summary: "Report received; investigation opened." },
    { type: "task_queued", actor: "system", at: 1, summary: "Tasks queued for the agents." },
    ...spec.events(refs),
  ];
  const events: AgentEvent[] = eventSpecs
    .map((event, index) => {
      const occurredAt = minutes(opened, event.at);
      const eventId = id(s, `event-${index + 1}`);
      return {
        id: eventId,
        investigationId,
        type: event.type,
        actor: event.actor,
        occurredAt,
        recordedAt: occurredAt,
        idempotencyKey: `${event.type}:${eventId}`,
        messageId: null,
        summary: event.summary,
        details: event.details ?? null,
        isSynthetic: true,
      };
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const latestEvidenceAt = observations
    .map((o) => o.observedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const updatedAt = [...findings.map((f) => f.createdAt), ...events.map((e) => e.occurredAt)].sort().at(-1) ?? opened;
  const sourcesWithData = [
    ...new Set(
      observations
        .filter((o) => o.sourceState === "available" || o.sourceState === "stale")
        .map((o) => o.source),
    ),
  ] as SourceKind[];

  const availability = (source: SourceKind): SourceAvailability | null => {
    const list = observations.filter((o) => o.source === source);
    if (list.length === 0) return null;
    const latest = list.map((o) => o.observedAt).filter((v): v is string => v !== null).sort().at(-1) ?? null;
    const unavailableObs = list.find((o) => o.sourceState === "unavailable");
    const notObserved = list.find((o) => o.sourceState === "not_observed");
    const checkedAt = list.map((o) => o.retrievedAt).sort().at(-1)!;
    return {
      source,
      state: unavailableObs ? "unavailable" : notObserved ? "not_observed" : list.some((o) => o.sourceState === "available") ? "available" : "stale",
      checkedAt,
      latestObservedAt: unavailableObs || notObserved ? null : latest,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS[source],
      windowStart: notObserved?.coverage?.windowStart ?? null,
      windowEnd: notObserved?.coverage?.windowEnd ?? null,
      message:
        spec.weather.state === "unavailable" && source === "weather"
          ? spec.weather.message
          : notObserved
            ? "None in window. Unknown, not evidence of no fire."
            : null,
    };
  };

  return {
    investigation: {
      id: investigationId,
      status: spec.status,
      reviewOutcome: null,
      reviewPriority: spec.reviewPriority,
      location: publicLocation,
      openedAt: opened,
      updatedAt,
      latestEvidenceAt,
      reportCount: reports.length,
      sources: sourcesWithData,
      isSynthetic: true,
      syntheticScenarioId: scenario.id,
      reviewedAt: null,
      reviewNote: null,
    },
    viewerAccess: "synthetic",
    reports,
    media,
    observations,
    findings,
    events,
    sourceAvailability: (["human", "vision", "firms", "weather", "eonet"] as const)
      .map(availability)
      .filter((value): value is SourceAvailability => value !== null),
    generatedAt: SYNTHETIC_NOW,
  };
}

let details: Map<string, InvestigationDetailResponse> | null = null;

/** All six synthetic investigations, keyed by investigation ID. */
export function fixtureDetails(): Map<string, InvestigationDetailResponse> {
  details ??= new Map(SYNTHETIC_SCENARIOS.map((scenario) => [scenario.investigationId, buildDetail(scenario)]));
  return details;
}

function toMapFeature(detail: InvestigationDetailResponse): MapFeature {
  const { investigation } = detail;
  const summary = {
    id: investigation.id,
    status: investigation.status,
    reviewOutcome: investigation.reviewOutcome,
    reviewPriority: investigation.reviewPriority,
    location: investigation.location,
    openedAt: investigation.openedAt,
    updatedAt: investigation.updatedAt,
    latestEvidenceAt: investigation.latestEvidenceAt,
    reportCount: investigation.reportCount,
    sources: investigation.sources,
    isSynthetic: investigation.isSynthetic,
    syntheticScenarioId: investigation.syntheticScenarioId,
  };
  return {
    id: investigation.id,
    kind: "investigation",
    location: investigation.location,
    investigationId: investigation.id,
    status: investigation.status,
    reviewOutcome: investigation.reviewOutcome,
    reviewPriority: investigation.reviewPriority,
    observedAt: investigation.latestEvidenceAt,
    freshness: classifyFreshness({
      latestObservedAt: investigation.latestEvidenceAt,
      checkedAt: SYNTHETIC_NOW,
      maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.human,
    }),
    sources: investigation.sources,
    provenance: REPORTER_PROVENANCE,
    firms: null,
    investigation: summary,
  };
}

/** The in-memory synthetic implementation of Mac's read port. */
export const fixtureReadRepository: InvestigationReadRepository = {
  async listMapInvestigations(query: MapQuery) {
    const matching = [...fixtureDetails().values()]
      .filter((detail) =>
        bboxContains(query.bbox, detail.investigation.location.latitude, detail.investigation.location.longitude),
      )
      .sort((a, b) => b.investigation.updatedAt.localeCompare(a.investigation.updatedAt));
    return {
      ok: true,
      data: { features: matching.slice(0, query.limit).map(toMapFeature), truncated: matching.length > query.limit },
    };
  },
  async getInvestigationDetail(investigationId: string) {
    const detail = fixtureDetails().get(investigationId);
    return detail
      ? { ok: true, data: detail }
      : { ok: false, error: { kind: "not_found", message: "Investigation not found." } };
  },
};
