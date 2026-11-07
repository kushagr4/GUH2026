# EmberGap shared contracts: integration handoff

Contract version **2026-11-07.1**. Source of truth: [`src/lib/embergap/contracts.ts`](../src/lib/embergap/contracts.ts), tested in [`tests/unit/embergap-contracts.test.ts`](../tests/unit/embergap-contracts.test.ts). Import from `@/lib/embergap/contracts` and never copy a type. To change one, ask Claude Mac.

The module is safe to import in the browser and on the server: it is Zod and plain functions, with no Node or server-only imports.

## Conventions

- **Timestamps:** UTC ISO with `Z`, from `new Date().toISOString()`. Normalise database values with `toTimestamp()`.
- **IDs:** UUIDs. Real records without one (a FIRMS row) use `stableId(name)`. Fixtures use `syntheticId("<owner>/<scenario>/<thing>")`.
- **Coordinates:** `latitude` then `longitude`, WGS 84.
- **Missing data is explicit:**
  - `"unavailable"` means the source failed.
  - `"not_observed"` means the source looked and found nothing, and it must say what time window it checked.
  - Never use zeros, empty "negative" results or low scores to mean "no data".
- **Untrusted text:** report text, explanations and model output are data, never instructions. Render them as text.

## By workstream

| You | Use these | Notes |
| --- | --- | --- |
| **d3vmakes** (report form) | `reportSubmissionRequestSchema`, `ReportSubmissionInput`, `reportSubmissionResponseSchema`, `apiErrorResponseSchema`, `REPORT_MEDIA_*`, `reportMediaObjectPath`, `reportMediaUploadSchema`, `LOCATION_UNCERTAINTY_METERS` | The rules are per field, so `.pick()` and `.partial()` work for form steps, and the messages are fit to show. The photo flow and retry rules are below |
| **Outrolife** (FIRMS, GET map and detail, UI) | `mapQuerySchema`, `mapResponseSchema`, `mapFeatureSchema`, `mapModeFor`, `investigationDetailResponseSchema`, `investigationSummarySchema`, `toPublicLocation`, `humanPublicLocationSchema`, `firmsEvidenceSchema`, `FIRMS_PROVENANCE`, `stableId`, `sourceAvailabilitySchema`, `InvestigationReadRepository`, `SourceAdapter` | Investigation markers must use `toPublicLocation()`, and the schema rejects anything else. The FIRMS raw-code mapping is in `firmsEvidenceSchema`. Never put a request URL in provenance, because FIRMS puts its key in the path |
| **Claude PC** (Open-Meteo, EONET, runtime) | `attributedAgentMessageSchema`, `agentEventSchema`, `partitionEventDetailsSchema`, `reconciledEventDetailsSchema`, `observationSchema`, `weatherEvidenceSchema`, `eonetEvidenceSchema`, `classifyFreshness` (pass `referenceAt`), `SOURCE_MAX_AGE_SECONDS`, `SourceAdapter`, `EmberGapRuntimeStore` | `task_assigned.payload.subject` gives a coarse location, a time and a scenario to query. The event keys and who writes which type are documented above `partitionEventDetailsSchema` |
| **Danil** (vision, witness, fusion) | `agentFindingSchema`, `fusionRecommendationSchema`, `agentReportSchema` (server-side only), `REASON_CODES`, `LIMITATION_CODES`, `VISION_REQUIRED_LIMITATIONS`, `ASSESSMENTS`, `EVIDENCE_STRENGTHS` | Reports arrive in `task_assigned.payload.reports`, each with a `reporterKey`: the same key means the same person. Set `finding.reportId`. Fusion findings are `assessment: "context"`, and the advice goes in `recommendation` |
| **Everyone** | `SYNTHETIC_SCENARIOS`, `SYNTHETIC_NOW`, `SYNTHETIC_DATA_LABEL`, `syntheticId`, `isSyntheticId` | Each scenario has a fixed `investigationId`, `reportIds`, place and time, which match the rows the migration seeds. Use `SYNTHETIC_NOW` as "now" in synthetic runs |

## Rules the schemas enforce

- **Satellite:** the satellite agent never `contradicts`. Missing, stale or absent data never contradicts. A non-detection carries `no_detection_is_not_absence`.
- **Weather:** weather findings are `context` or `inconclusive` and carry `weather_is_context_only`. Weather or EONET reason codes alone can't support or contradict.
- **Vision:** vision findings carry the three `image_*_unverifiable` limitations.
- **Fusion:** only fusion recommends, and only `needs_human_review` or `insufficient_evidence`. Software never sets `reviewed`.
- **Findings:** `supports` and `contradicts` need a strength and at least one evidence ID. Reason codes that claim a verdict (`fire_confirmed`, `image_authentic`) are rejected, and there is no numeric confidence anywhere.
- **Attribution:** with `attributedAgentMessageSchema`, an agent may publish only its own findings, for the message's investigation.
- **Read models:**
  - No reporter IDs.
  - Investigation locations are always on the public grid, at least 1 km wide.
  - A `synthetic` view can't contain real reports.
  - A reporter sees photos only for reports they can see.
  - Map `mode` must match the features.

## POST /api/embergap/reports

The request body is `reportSubmissionRequestSchema`, a strict object:

```json
{
  "clientRequestId": "c8c0a7e2-6f0e-4b8e-9d5a-2f1e0c3b4a59",
  "observedAt": "2026-11-07T13:30:00.000Z",
  "location": { "latitude": 53.4668, "longitude": -2.2339, "uncertaintyMeters": 500 },
  "description": "Grey smoke rising above the trees to the north.",
  "media": { "mediaId": "5b0c2a8e-3d4f-4a1b-8c9d-0e1f2a3b4c5d", "mimeType": "image/jpeg" }
}
```

It responds with **201** for a new report, or **200** with `replayed: true` for the same `clientRequestId`:

```json
{
  "reportId": "…",
  "investigationId": "…",
  "investigationStatus": "unreviewed",
  "mediaId": "5b0c2a8e-…",
  "submittedAt": "2026-11-07T13:31:02.512Z",
  "verification": "unverified",
  "replayed": false
}
```

Errors use `{ "error": { "code", "message", "fieldErrors"?, "retryAfterSeconds"? } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `validation_failed` | Invalid input. `fieldErrors` is keyed by top-level field |
| 400 | `media_invalid` | Missing photo, wrong type, or EXIF/XMP present |
| 401 | `unauthorized` | Not signed in |
| 409 | `conflict` | That photo is already on another report |
| 413 | `payload_too_large` | The body is too large |
| 429 | `rate_limited` | Too many reports. Wait `retryAfterSeconds` |
| 503 | `unavailable` | The database is unavailable |

**Retries:** keep `clientRequestId` and `mediaId` for every retry of one submission. Make new ones only after a 2xx response or for a new report.

**Photo flow:**

1. Re-encode the photo through a canvas (createImageBitmap, then canvas.toBlob as `image/jpeg` at 0.85, longest side at most 2048 px). This drops EXIF metadata, including GPS.
2. Generate `mediaId = crypto.randomUUID()`.
3. Upload with the browser Supabase client to `reportMediaObjectPath(userId, mediaId, "image/jpeg")` in bucket `REPORT_MEDIA_BUCKET`, with `upsert: false`. Get `userId` from `requireUser()` in the page and pass it to the form as a prop. Don't use `ownerObjectPath`. On a retry, an "already exists" error means the photo is already uploaded.
4. POST the report with `media: { mediaId, mimeType: "image/jpeg" }`.

## Status of the backend

The database schema, the POST route, photo verification and the read repository are in the stacked PR on `feat/embergap-core`. Until it merges, mock against the shapes above and the scenarios in `SYNTHETIC_SCENARIOS`.
