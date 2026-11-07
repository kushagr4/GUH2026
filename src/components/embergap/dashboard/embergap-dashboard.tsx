"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  SYNTHETIC_NOW,
  SYNTHETIC_SCENARIOS,
  apiErrorResponseSchema,
  mapResponseSchema,
  type Bbox,
  type MapFeature,
  type MapResponse,
} from "@/lib/embergap/contracts";
import { isWithinFirmsSpan } from "@/lib/embergap/sources/firms/bbox";
import { SCENARIO_PLACE, type MapRegion } from "@/lib/embergap/read/regions";
import { HeatMap } from "@/components/embergap/map/heat-map";
import {
  SOURCE_STATE_LABEL,
  SOURCE_STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  confidenceLabel,
  formatDuration,
  formatUtc,
  minutesBetween,
  priorityLabel,
  priorityTone,
} from "./labels";
import { SOURCE_FEED, SourceChip, satelliteLabel } from "./data-sources";
import { ToneBadge } from "./tone-badge";

const MAP_LIMIT = 200;

type Layout = "wide" | "side";
const LAYOUTS: ReadonlyArray<readonly [Layout, string]> = [
  ["wide", "Full-width map"],
  ["side", "Side panel"],
];

/** Synthetic runs are "as of" SYNTHETIC_NOW, so the demo reads the same at any time. */
function referenceTime(data: MapResponse): string {
  return data.mode === "synthetic" ? SYNTHETIC_NOW : data.generatedAt;
}

export function featureLabel(feature: MapFeature): string {
  if (feature.kind === "investigation") {
    const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === feature.investigation?.syntheticScenarioId);
    if (scenario) return `${scenario.title} · ${SCENARIO_PLACE[scenario.id] ?? "Italy"}`;
    return feature.investigation ? `Investigation, ${formatUtc(feature.investigation.openedAt)}` : "Investigation";
  }
  return `Thermal anomaly · ${satelliteLabel(feature.provenance.product)}`;
}

function scenarioOf(feature: MapFeature) {
  return SYNTHETIC_SCENARIOS.find((item) => item.id === feature.investigation?.syntheticScenarioId) ?? null;
}

/** "High confidence · 6.4 MW", never a percentage. */
function detectionSummary(feature: MapFeature): string {
  const confidence = feature.firms?.confidence ?? null;
  const parts = [
    confidence === null
      ? null
      : typeof confidence === "number"
        ? `Confidence ${confidence}/100`
        : `${confidence[0]!.toUpperCase()}${confidence.slice(1)} confidence`,
    feature.firms?.frpMegawatts == null ? null : `${feature.firms.frpMegawatts} MW`,
    feature.firms?.dayNight ? (feature.firms.dayNight === "day" ? "Day pass" : "Night pass") : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function age(feature: MapFeature, now: string): string {
  return feature.observedAt ? `${formatDuration(minutesBetween(feature.observedAt, now))} ago` : "—";
}

export function EmberGapDashboard({
  regions,
  initialRegionId,
  initialData,
}: {
  regions: readonly MapRegion[];
  initialRegionId: string;
  initialData: MapResponse;
}) {
  const [data, setData] = useState<MapResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anomaliesOpen, setAnomaliesOpen] = useState(false);
  const [investigationsOpen, setInvestigationsOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>("wide");
  const requestRef = useRef<AbortController | null>(null);
  const side = layout === "side";

  const now = referenceTime(data);
  const investigations = data.features.filter((feature) => feature.kind === "investigation");
  const anomalies = data.features.filter((feature) => feature.kind === "thermal_anomaly");
  const firms = data.sourceAvailability.find((item) => item.source === "firms") ?? null;
  const satelliteLive = anomalies.some((feature) => !feature.provenance.isSynthetic);

  useEffect(() => {
    if (selectedId) document.getElementById(`feature-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function select(id: string | null) {
    setSelectedId((current) => (current === id ? null : id));
    const feature = data.features.find((item) => item.id === id);
    if (feature?.kind === "thermal_anomaly") setAnomaliesOpen(true);
    if (feature?.kind === "investigation") setInvestigationsOpen(true);
  }

  async function load(bbox: Bbox) {
    if (!isWithinFirmsSpan(bbox)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const box = [bbox.minLongitude, bbox.minLatitude, bbox.maxLongitude, bbox.maxLatitude]
        .map((value) => value.toFixed(4))
        .join(",");
      const response = await fetch(`/api/embergap/map?bbox=${encodeURIComponent(box)}&limit=${MAP_LIMIT}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = mapResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const apiError = apiErrorResponseSchema.safeParse(body);
        setError(
          response.status === 401
            ? "Session ended. Sign in again."
            : apiError.success
              ? apiError.data.error.message
              : "Couldn't load the map.",
        );
        return;
      }
      setError(null);
      setData(parsed.data);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError("Couldn't reach the server.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {data.mode === "synthetic" ? <ToneBadge tone="neutral">Demo · simulated evidence</ToneBadge> : null}
        {data.mode === "mixed" ? <ToneBadge tone="neutral">Mixed: live and simulated evidence</ToneBadge> : null}
        {firms ? (
          <ToneBadge tone={SOURCE_STATE_TONE[firms.state]}>
            FIRMS {satelliteLive ? "live" : "demo"} · {SOURCE_STATE_LABEL[firms.state]}
          </ToneBadge>
        ) : null}
        {firms ? <span>Checked {formatUtc(firms.checkedAt)}</span> : null}
        {loading ? <span>Loading…</span> : null}
        {error ? (
          <span role="alert" className="text-red-700 dark:text-red-300">
            {error}
          </span>
        ) : null}
        {firms?.state === "unavailable" && firms.message ? (
          <span className="text-amber-800 dark:text-amber-300">{firms.message}</span>
        ) : null}
        <div className="ml-auto flex gap-1 rounded-lg border bg-background p-0.5" role="group" aria-label="Layout">
          {LAYOUTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={layout === id}
              onClick={() => setLayout(id)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium",
                layout === id ? "bg-orange-600 text-white" : "text-foreground hover:bg-orange-50 dark:hover:bg-orange-950",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={side ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : "flex flex-col gap-4"}>
        <HeatMap
          features={data.features}
          regions={regions}
          initialRegionId={initialRegionId}
          selectedId={selectedId}
          onSelect={select}
          onViewSettled={load}
          labelFor={featureLabel}
          className="h-[56vh] min-h-[360px] w-full shadow-sm sm:min-h-[440px] lg:h-[min(68vh,700px)]"
        />

        <aside
          aria-label="Evidence in this map view"
          className={
            side
              ? "flex flex-col gap-3 lg:max-h-[min(68vh,700px)] lg:overflow-y-auto"
              : "grid items-start gap-3 md:grid-cols-2"
          }
        >
          <div className={side ? "px-1 pb-1" : "px-1 pb-1 md:col-span-2"}>
            <h2 className="text-lg font-semibold tracking-tight">Evidence in view</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Select an item to see its details on the map.</p>
          </div>
          <Section
            title="Investigations"
            subtitle="Eyewitness reports, each assessed by five independent agents"
            tone="rose"
            count={investigations.length}
            open={investigationsOpen}
            onToggle={() => setInvestigationsOpen((open) => !open)}
          >
            {investigations.map((feature) => (
              <Item
                key={feature.id}
                feature={feature}
                now={now}
                open={feature.id === selectedId}
                onToggle={() => select(feature.id)}
              />
            ))}
          </Section>
          <Section
            title="Thermal anomalies"
            subtitle={
              anomalies.length === 0
                ? "NASA FIRMS satellite detections in view"
                : satelliteLive
                ? "Live from NASA FIRMS satellites (VIIRS, MODIS)"
                : "Simulated demo detections. Add a NASA FIRMS key on the server for live satellite data."
            }
            tone="amber"
            count={anomalies.length}
            open={anomaliesOpen}
            onToggle={() => setAnomaliesOpen((open) => !open)}
          >
            {anomalies.map((feature) => (
              <Item
                key={feature.id}
                feature={feature}
                now={now}
                open={feature.id === selectedId}
                onToggle={() => select(feature.id)}
              />
            ))}
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

const SECTION_TONE = {
  rose: {
    edge: "border-t-rose-500",
    pill: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  },
  amber: {
    edge: "border-t-amber-500",
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
} as const;

function Section({
  title,
  subtitle,
  count,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  tone: keyof typeof SECTION_TONE;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <details open={open} className={cn("overflow-hidden rounded-xl border border-t-4 bg-card shadow-sm", SECTION_TONE[tone].edge)}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-4 text-sm font-semibold hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] [&::-webkit-details-marker]:hidden"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            {title}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", SECTION_TONE[tone].pill)}>
              {count}
            </span>
          </span>
          {subtitle ? <span className="text-xs font-normal text-muted-foreground">{subtitle}</span> : null}
        </span>
        <Chevron open={open} />
      </summary>
      {count === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">None in view.</p>
      ) : (
        <ul className="flex flex-col gap-1 border-t px-2 py-2">{children}</ul>
      )}
    </details>
  );
}

function Item({
  feature,
  now,
  open,
  onToggle,
}: {
  feature: MapFeature;
  now: string;
  open: boolean;
  onToggle: () => void;
}) {
  const precisionKm = Math.round(feature.location.precisionMeters / 100) / 10;
  return (
    <li id={`feature-${feature.id}`}>
      <details
        open={open}
        className={cn(
          "rounded-lg",
          open ? "bg-orange-50 ring-1 ring-orange-200 dark:bg-orange-950/40 dark:ring-orange-900" : "hover:bg-muted/60",
        )}
      >
        <summary
          onClick={(event) => {
            event.preventDefault();
            onToggle();
          }}
          className="flex min-h-12 cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-3px] [&::-webkit-details-marker]:hidden"
        >
          <span
            aria-hidden
            className={cn(
              "w-1 self-stretch shrink-0 rounded-full",
              feature.kind === "investigation"
                ? feature.reviewPriority === "high"
                  ? "bg-red-600"
                  : feature.reviewPriority === "medium"
                    ? "bg-yellow-400"
                    : "bg-sky-500"
                : feature.freshness === "available"
                  ? "bg-orange-500"
                  : "bg-stone-400",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 font-medium leading-snug">
                {feature.kind === "investigation"
                  ? (scenarioOf(feature)?.title ?? (feature.investigation && feature.investigation.reportCount > 1 ? `${feature.investigation.reportCount} eyewitness reports` : "Eyewitness report"))
                  : "Thermal anomaly"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{age(feature, now)}</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {feature.kind === "investigation" ? (
                <>
                  <SourceChip icon={SOURCE_FEED.human.icon} label={SOURCE_FEED.human.label} synthetic={feature.provenance.isSynthetic} />
                  {feature.status ? <span>{STATUS_LABEL[feature.status]}</span> : null}
                  {scenarioOf(feature) ? <span>· {SCENARIO_PLACE[scenarioOf(feature)!.id] ?? "Italy"}</span> : null}
                </>
              ) : (
                <>
                  <SourceChip icon={SOURCE_FEED.firms.icon} label={satelliteLabel(feature.provenance.product)} synthetic={feature.provenance.isSynthetic} />
                  <span className="truncate">{detectionSummary(feature)}</span>
                </>
              )}
            </span>
          </span>
          <Chevron open={open} />
        </summary>
        <div className="flex flex-col gap-3 px-3 pt-1 pb-4 text-sm leading-5">
          {feature.kind === "investigation" ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {feature.status ? (
                  <ToneBadge tone={STATUS_TONE[feature.status]}>{STATUS_LABEL[feature.status]}</ToneBadge>
                ) : null}
                <ToneBadge tone={priorityTone(feature.reviewPriority)}>{priorityLabel(feature.reviewPriority)}</ToneBadge>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Latest</dt>
                <dd>{formatUtc(feature.observedAt)}</dd>
                <dt className="text-muted-foreground">Area</dt>
                <dd>±{precisionKm} km</dd>
                <dt className="text-muted-foreground">Reports</dt>
                <dd>{feature.investigation?.reportCount ?? "—"}</dd>
                <dt className="text-muted-foreground">Evidence</dt>
                <dd>{feature.sources.map((source) => SOURCE_FEED[source].label).join(", ") || "—"}</dd>
              </dl>
              {feature.investigationId ? (
                <Link
                  href={`/app/embergap/investigations/${feature.investigationId}`}
                  className="self-start rounded-md bg-orange-600 px-2.5 py-1 font-medium text-white hover:bg-orange-700"
                >
                  Open investigation
                </Link>
              ) : null}
            </>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted-foreground">Observed</dt>
              <dd>
                {formatUtc(feature.observedAt)} · {SOURCE_STATE_LABEL[feature.freshness].toLowerCase()}
              </dd>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd>{confidenceLabel(feature.firms?.confidence ?? null)}</dd>
              <dt className="text-muted-foreground">FRP</dt>
              <dd>{feature.firms?.frpMegawatts == null ? "—" : `${feature.firms.frpMegawatts} MW`}</dd>
              <dt className="text-muted-foreground">Pixel</dt>
              <dd>±{precisionKm} km</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                {feature.provenance.isSynthetic
                  ? "Simulated demo detection (not real NASA data)"
                  : `NASA FIRMS, ${satelliteLabel(feature.provenance.product)}`}
              </dd>
            </dl>
          )}
        </div>
      </details>
    </li>
  );
}
