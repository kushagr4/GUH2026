import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import type { InvestigationDetail } from "@/lib/embergap/read/types";
import {
  AGENT_LABEL,
  ASSESSMENT_LABEL,
  ASSESSMENT_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SOURCE_STATE_LABEL,
  SOURCE_STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatAge,
  formatUtc,
  humanizeCode,
  minutesBetween,
} from "./labels";
import { SafetyNotice } from "./notices";
import { ToneBadge } from "./tone-badge";

const PARTITION_KINDS = new Set(["link_partitioned", "link_restored", "duplicate_ignored"]);

export function InvestigationView({
  investigation,
  now,
}: {
  investigation: InvestigationDetail;
  now: Date;
}) {
  const { report, recommendation } = investigation;
  const activity = [...investigation.activity].sort((a, b) => a.at.localeCompare(b.at));
  const findings = [...investigation.findings].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/embergap" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Back to the map
      </Link>

      <PageHeader
        title={investigation.title}
        description={`Opened ${formatAge(minutesBetween(investigation.createdAt, now))} · updated ${formatAge(minutesBetween(investigation.updatedAt, now))}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <ToneBadge tone={STATUS_TONE[investigation.status]}>{STATUS_LABEL[investigation.status]}</ToneBadge>
            {investigation.mode === "demo" ? <ToneBadge tone="neutral">Synthetic demo</ToneBadge> : null}
          </div>
        }
      />

      <SafetyNotice />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Review recommendation
            <ToneBadge tone={PRIORITY_TONE[recommendation.priority]}>
              {PRIORITY_LABEL[recommendation.priority]}
            </ToneBadge>
          </CardTitle>
          <CardDescription>
            From the fusion agent, for a human to review. It is not a fire confirmation, and the
            priority is a rule-based label, not a probability.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-pretty">{recommendation.summary}</p>
          {recommendation.reasonCodes.length ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Reasons">
              {recommendation.reasonCodes.map((code) => (
                <ToneBadge key={code} tone="neutral">
                  {humanizeCode(code)}
                </ToneBadge>
              ))}
            </div>
          ) : null}
          {recommendation.contradictions.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Contradictions (kept, not resolved automatically)</p>
              <ul className="mt-1 list-disc pl-5">
                {recommendation.contradictions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {recommendation.gaps.length ? (
            <div className="text-sm">
              <p className="font-medium">Unknowns and gaps</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {recommendation.gaps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-lg font-semibold">
          Evidence by source
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {investigation.evidence.map((item) => (
            <Card key={item.source} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  {item.label}
                  <ToneBadge tone={SOURCE_STATE_TONE[item.state]}>{SOURCE_STATE_LABEL[item.state]}</ToneBadge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p>{item.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {item.observedAt ? `Observed ${formatUtc(item.observedAt)}` : "No observation time"}
                  {item.retrievedAt ? ` · checked ${formatAge(minutesBetween(item.retrievedAt, now))}` : ""}
                </p>
                {item.limitations.length ? (
                  <ul className="list-disc pl-4 text-xs text-muted-foreground">
                    {item.limitations.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex flex-col gap-3" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-lg font-semibold">
            Agent findings
          </h2>
          <p className="text-sm text-muted-foreground">
            Each agent works independently on its own evidence and records its own finding.
          </p>
          <ol className="flex flex-col gap-3">
            {findings.map((finding) => (
              <li key={finding.id}>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {AGENT_LABEL[finding.agentId]}
                      <ToneBadge tone={ASSESSMENT_TONE[finding.assessment]}>
                        {ASSESSMENT_LABEL[finding.assessment]}
                      </ToneBadge>
                      {finding.deliveredAfterPartition ? (
                        <ToneBadge tone="info">Delivered after reconnection</ToneBadge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {formatUtc(finding.createdAt)} ({formatAge(minutesBetween(finding.createdAt, now))})
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p>{finding.explanation}</p>
                    {finding.reasonCodes.length ? (
                      <p className="text-xs text-muted-foreground">
                        Reasons: {finding.reasonCodes.map(humanizeCode).join(", ")}
                      </p>
                    ) : null}
                    {finding.limitations.length ? (
                      <p className="text-xs text-muted-foreground">Limits: {finding.limitations.join(" ")}</p>
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
              Report
            </h2>
            <Card size="sm">
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-pretty">&ldquo;{report.summary}&rdquo;</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Observed</dt>
                  <dd>{formatUtc(report.observedAt)}</dd>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>
                    About {report.latitude.toFixed(2)}, {report.longitude.toFixed(2)} (to ~{report.locationPrecisionKm} km)
                  </dd>
                  <dt className="text-muted-foreground">Photo</dt>
                  <dd>{report.hasPhoto ? "Attached, stored privately" : "None"}</dd>
                  <dt className="text-muted-foreground">Related reports</dt>
                  <dd>{report.relatedReportCount}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  An unverified claim. The exact position and the reporter&apos;s identity are not shown.
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="text-lg font-semibold">
              Agent activity
            </h2>
            <ol className="flex flex-col gap-2 border-l pl-4">
              {activity.map((event) => (
                <li key={event.id} className="relative text-sm">
                  <span
                    aria-hidden
                    className={`absolute top-1.5 -left-[1.3rem] size-2 rounded-full ${PARTITION_KINDS.has(event.kind) ? "bg-sky-500" : "bg-foreground/40"}`}
                  />
                  <p className={PARTITION_KINDS.has(event.kind) ? "font-medium text-sky-800 dark:text-sky-300" : undefined}>
                    {event.detail}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {AGENT_LABEL[event.actor]} · {formatUtc(event.at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <p className="text-xs text-muted-foreground">
        Review decisions are made and recorded by an authorised person, separately from these
        findings. Nothing here is an official fire confirmation.
      </p>
    </div>
  );
}
