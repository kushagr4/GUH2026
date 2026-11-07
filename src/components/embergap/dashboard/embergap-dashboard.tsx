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
import type { MapRegion } from "@/lib/embergap/read/regions";
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
    if (scenario) return scenario.title;
    return feature.investigation ? `Investigation, ${formatUtc(feature.investigation.openedAt)}` : "Investigation";
  }
  return `${feature.firms?.instrument ?? feature.provenance.product ?? "FIRMS"} thermal anomaly`;
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        {data.mode !== "live" ? <ToneBadge tone="neutral">Synthetic data</ToneBadge> : null}
        {firms ? (
          <ToneBadge tone={SOURCE_STATE_TONE[firms.state]}>
            FIRMS {satelliteLive ? "live" : "demo"} · {SOURCE_STATE_LABEL[firms.state]}
          </ToneBadge>
        ) : null}
        {firms ? <span>{formatUtc(firms.checkedAt)}</span> : null}
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

      <div className={side ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]" : "flex flex-col gap-3"}>
        <HeatMap
          features={data.features}
          regions={regions}
          initialRegionId={initialRegionId}
          selectedId={selectedId}
          onSelect={select}
          onViewSettled={load}
          labelFor={featureLabel}
          className="h-[65vh] min-h-[420px] w-full lg:h-[calc(100vh-13rem)]"
        />

        <div
          className={
            side
              ? "flex flex-col gap-3 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto"
              : "grid items-start gap-3 md:grid-cols-2"
          }
        >
          <Section
            title="Investigations"
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
        </div>
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
  count,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  tone: keyof typeof SECTION_TONE;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <details open={open} className={cn("rounded-xl border border-t-4 bg-card", SECTION_TONE[tone].edge)}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden"
      >
        <span className="flex items-center gap-2">
          {title}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", SECTION_TONE[tone].pill)}>
            {count}
          </span>
        </span>
        <Chevron open={open} />
      </summary>
      {count === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">None in view.</p>
      ) : (
        <ul className="flex flex-col gap-1 px-2 pb-2">{children}</ul>
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
          className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-sm [&::-webkit-details-marker]:hidden"
        >
          <span
            aria-hidden
            className={cn(
              "h-4 w-1 shrink-0 rounded-full",
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
          <span className="min-w-0 flex-1 truncate">{featureLabel(feature)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{age(feature, now)}</span>
          <Chevron open={open} />
        </summary>
        <div className="flex flex-col gap-2 px-2 pt-1 pb-2.5 text-xs">
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
                <dt className="text-muted-foreground">Sources</dt>
                <dd>{feature.sources.join(", ") || "—"}</dd>
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
              <dd>{feature.provenance.isSynthetic ? "Synthetic" : `NASA FIRMS ${feature.provenance.product ?? ""}`}</dd>
            </dl>
          )}
        </div>
      </details>
    </li>
  );
}
