import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  SYNTHETIC_NOW,
  SYNTHETIC_SCENARIOS,
  type InvestigationDetailResponse,
  type Observation,
  type SourceKind,
} from "@/lib/embergap/contracts";
import {
  ACTOR_LABEL,
  ASSESSMENT_LABEL,
  ASSESSMENT_TONE,
  NETWORK_EVENTS,
  SOURCE_LABEL,
  SOURCE_STATE_LABEL,
  SOURCE_STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  STRENGTH_LABEL,
  confidenceLabel,
  formatDuration,
  formatUtc,
  humanizeCode,
  minutesBetween,
  priorityLabel,
  priorityTone,
} from "./labels";
import { SafetyNotice } from "./notices";
import { ToneBadge } from "./tone-badge";

/** One plain-language line about what a source returned. */
function observationSummary(source: SourceKind, observations: Observation[]): string | null {
  const withData = observations.filter((o) => o.source === source && o.evidence !== null);
  if (withData.length === 0) return null;
  const first = withData[0]!;
  switch (first.source) {
    case "firms": {
      const nearest = Math.min(
        ...withData.map((o) => (o.source === "firms" ? (o.evidence?.distanceKm ?? Infinity) : Infinity)),
      );
      const confidence = first.evidence ? confidenceLabel(first.evidence.confidence) : "not reported";
      return `${withData.length} detection${withData.length === 1 ? "" : "s"}${Number.isFinite(nearest) ? `, nearest ${nearest} km away` : ""}. Newest: ${confidence}.`;
    }
    case "weather": {
      const e = first.evidence;
      if (!e) return null;
      const parts = [
        e.temperatureC !== null ? `${e.temperatureC} °C` : null,
        e.relativeHumidityPercent !== null ? `humidity ${e.relativeHumidityPercent}%` : null,
        e.windSpeedKmh !== null ? `wind ${e.windSpeedKmh} km/h${e.windDirectionDegrees !== null ? ` from ${e.windDirectionDegrees}°` : ""}` : null,
        e.precipitationMm !== null ? `${e.precipitationMm} mm rain in 24 h` : null,
      ].filter(Boolean);
      return `${e.kind[0]!.toUpperCase()}${e.kind.slice(1)}: ${parts.join(", ")}.`;
    }
    case "vision":
      return first.evidence ? `Described as: ${first.evidence.labels.join(", ") || "no labels"}.` : null;
    case "human":
      return `${withData.length} report${withData.length === 1 ? "" : "s"}.`;
    case "eonet":
      return first.evidence ? `${first.evidence.title}.` : null;
  }
}

export function InvestigationView({ detail }: { detail: InvestigationDetailResponse }) {
  const { investigation, findings, observations } = detail;
  const now = investigation.isSynthetic ? SYNTHETIC_NOW : detail.generatedAt;
  const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === investigation.syntheticScenarioId);
  const title = scenario?.title ?? `Investigation opened ${formatUtc(investigation.openedAt)}`;

  const byNewest = [...findings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const fusion = byNewest.find((finding) => finding.agentId === "fusion" && finding.recommendation);
  const recommendation = fusion?.recommendation ?? null;
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const contradictions = (recommendation?.contradictingFindingIds ?? [])
    .map((id) => findingById.get(id))
    .filter((finding) => finding !== undefined);
  const agentFindings = [...findings]
    .filter((finding) => finding.agentId !== "fusion")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const timeline = [...detail.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const precisionKm = Math.round(investigation.location.precisionMeters / 100) / 10;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/embergap" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Back to the map
      </Link>

      <PageHeader
        title={title}
        description={`Opened ${formatDuration(minutesBetween(investigation.openedAt, now))} ago · updated ${formatDuration(minutesBetween(investigation.updatedAt, now))} ago${investigation.isSynthetic ? ` (as of ${formatUtc(now)})` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ToneBadge tone={STATUS_TONE[investigation.status]}>{STATUS_LABEL[investigation.status]}</ToneBadge>
            {investigation.isSynthetic ? <ToneBadge tone="neutral">Synthetic demo data</ToneBadge> : null}
          </div>
        }
      />

      <SafetyNotice />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Review recommendation
            <ToneBadge tone={priorityTone(recommendation?.reviewPriority ?? investigation.reviewPriority)}>
              {priorityLabel(recommendation?.reviewPriority ?? investigation.reviewPriority)}
            </ToneBadge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fusion && recommendation ? (
            <>
              <p className="text-pretty">{fusion.explanation}</p>
              <p className="text-sm text-muted-foreground">
                Suggested: {STATUS_LABEL[recommendation.recommendedStatus]} · Independent sources:{" "}
                {recommendation.independentSourceCount}
                {recommendation.possibleDuplicateReportIds.length
                  ? ` · Duplicates counted once: ${recommendation.possibleDuplicateReportIds.length}`
                  : ""}
              </p>
              {contradictions.length ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-medium">Contradicting evidence</p>
                  <ul className="mt-1 list-disc pl-5">
                    {contradictions.map((finding) => (
                      <li key={finding.id}>
                        {ACTOR_LABEL[finding.agentId]}: {finding.explanation}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {recommendation.evidenceGaps.length ? (
                <div className="text-sm">
                  <p className="font-medium">Gaps</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {recommendation.evidenceGaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No recommendation yet.</p>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="text-lg font-semibold">
          Evidence by source
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {detail.sourceAvailability.map((item) => {
            const summary = observationSummary(item.source, observations);
            return (
              <Card key={item.source} size="sm">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    {SOURCE_LABEL[item.source]}
                    <ToneBadge tone={SOURCE_STATE_TONE[item.state]}>{SOURCE_STATE_LABEL[item.state]}</ToneBadge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  {summary ? <p>{summary}</p> : null}
                  {item.message ? <p className="text-muted-foreground">{item.message}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {item.latestObservedAt ? `Latest ${formatUtc(item.latestObservedAt)}` : `Checked ${formatUtc(item.checkedAt)}`}
                    {item.windowStart && item.windowEnd
                      ? ` · window ${formatUtc(item.windowStart)} – ${formatUtc(item.windowEnd)}`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex flex-col gap-3" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-lg font-semibold">
            Agent findings
          </h2>
          <ol className="flex flex-col gap-3">
            {agentFindings.map((finding) => (
              <li key={finding.id}>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {ACTOR_LABEL[finding.agentId]}
                      <ToneBadge tone={ASSESSMENT_TONE[finding.assessment]}>
                        {ASSESSMENT_LABEL[finding.assessment]}
                        {finding.strength ? ` · ${STRENGTH_LABEL[finding.strength]}` : ""}
                      </ToneBadge>
                    </CardTitle>
                    <CardDescription>{formatUtc(finding.createdAt)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p>{finding.explanation}</p>
                    <p className="text-xs text-muted-foreground">
                      Reasons: {finding.reasonCodes.map(humanizeCode).join(", ")}
                    </p>
                    {finding.limitations.length || finding.limitationNotes.length ? (
                      <p className="text-xs text-muted-foreground">
                        Limits: {[...finding.limitations.map(humanizeCode), ...finding.limitationNotes].join("; ")}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <aside className="flex flex-col gap-6">
          <section className="flex flex-col gap-3" aria-labelledby="report-heading">
            <h2 id="report-heading" className="text-lg font-semibold">
              {detail.reports.length === 1 ? "Report" : `Reports (${detail.reports.length})`}
            </h2>
            {detail.reports.map((report) => (
              <Card key={report.id} size="sm">
                <CardContent className="flex flex-col gap-2 text-sm">
                  <p className="text-pretty">&ldquo;{report.description}&rdquo;</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Observed</dt>
                    <dd>{formatUtc(report.observedAt)}</dd>
                    <dt className="text-muted-foreground">Photo</dt>
                    <dd>{report.mediaIds.length ? "Attached, stored privately" : "None"}</dd>
                    <dt className="text-muted-foreground">Location</dt>
                    <dd>
                      ~{investigation.location.latitude.toFixed(2)}, {investigation.location.longitude.toFixed(2)} (±
                      {precisionKm} km)
                    </dd>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{report.verification === "unverified" ? "Unverified" : "Reviewed"}</dd>
                  </dl>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="text-lg font-semibold">
              Agent activity
            </h2>
            <ol className="flex flex-col gap-2 border-l pl-4">
              {timeline.map((event) => {
                const network = NETWORK_EVENTS.has(event.type);
                return (
                  <li key={event.id} className="relative text-sm">
                    <span
                      aria-hidden
                      className={`absolute top-1.5 -left-[1.3rem] size-2 rounded-full ${network ? "bg-sky-500" : "bg-foreground/40"}`}
                    />
                    <p className={network ? "font-medium text-sky-800 dark:text-sky-300" : undefined}>{event.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {ACTOR_LABEL[event.actor]} · {formatUtc(event.occurredAt)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

    </div>
  );
}
