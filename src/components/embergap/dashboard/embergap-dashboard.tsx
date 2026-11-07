"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SYNTHETIC_NOW,
  SYNTHETIC_SCENARIOS,
  apiErrorResponseSchema,
  mapResponseSchema,
  type MapFeature,
  type MapResponse,
} from "@/lib/embergap/contracts";
import type { MapRegion } from "@/lib/embergap/read/regions";
import { MapLegend, ThermalMap, featureTitle } from "@/components/embergap/map/thermal-map";
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
import { DemoDataNotice } from "./notices";
import { ToneBadge } from "./tone-badge";

const MAP_LIMIT = 100;

function bboxParam(region: MapRegion): string {
  const { minLongitude, minLatitude, maxLongitude, maxLatitude } = region.bbox;
  return [minLongitude, minLatitude, maxLongitude, maxLatitude].join(",");
}

/** Synthetic runs are "as of" SYNTHETIC_NOW, so the demo reads the same at any time. */
function referenceTime(data: MapResponse): string {
  return data.mode === "synthetic" ? SYNTHETIC_NOW : data.generatedAt;
}

export function investigationLabel(feature: MapFeature): string {
  const scenario = SYNTHETIC_SCENARIOS.find((item) => item.id === feature.investigation?.syntheticScenarioId);
  if (scenario) return scenario.title;
  return feature.investigation ? `Investigation opened ${formatUtc(feature.investigation.openedAt)}` : featureTitle(feature);
}

function label(feature: MapFeature): string {
  return feature.kind === "investigation" ? investigationLabel(feature) : featureTitle(feature);
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
  const [regionId, setRegionId] = useState(initialRegionId);
  const [data, setData] = useState<MapResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialData.features.find((feature) => feature.kind === "investigation")?.id ?? null,
  );
  const requestRef = useRef<AbortController | null>(null);

  const region = regions.find((item) => item.id === regionId) ?? regions[0]!;
  const now = referenceTime(data);
  const selected = data.features.find((feature) => feature.id === selectedId) ?? null;
  const investigations = data.features.filter((feature) => feature.kind === "investigation");
  const anomalies = data.features.filter((feature) => feature.kind === "thermal_anomaly");
  const firms = data.sourceAvailability.find((item) => item.source === "firms") ?? null;
  const satelliteLive = anomalies.some((feature) => !feature.provenance.isSynthetic);

  async function selectRegion(next: MapRegion) {
    if (next.id === regionId && !error) return;
    setRegionId(next.id);
    setLoading(true);
    setError(null);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(
        `/api/embergap/map?bbox=${encodeURIComponent(bboxParam(next))}&limit=${MAP_LIMIT}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const body: unknown = await response.json().catch(() => null);
      const parsed = mapResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const apiError = apiErrorResponseSchema.safeParse(body);
        setError(
          response.status === 401
            ? "Your session has ended. Sign in again."
            : apiError.success
              ? apiError.data.error.message
              : "The map could not be loaded.",
        );
        return;
      }
      setData(parsed.data);
      setSelectedId(parsed.data.features.find((feature) => feature.kind === "investigation")?.id ?? null);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError("Could not reach the server.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Region">
          {regions.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === regionId ? "default" : "outline"}
              aria-pressed={item.id === regionId}
              onClick={() => selectRegion(item)}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span>Satellite:</span>
          {firms ? (
            <ToneBadge tone={SOURCE_STATE_TONE[firms.state]}>
              {satelliteLive ? "Live" : "Demo"} · {SOURCE_STATE_LABEL[firms.state]}
            </ToneBadge>
          ) : (
            <ToneBadge tone="neutral">Not checked</ToneBadge>
          )}
          {firms ? <span>checked {formatUtc(firms.checkedAt)}</span> : null}
          {loading ? <span>Loading…</span> : null}
        </div>
      </div>

      <DemoDataNotice mode={data.mode} />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
      {firms?.state === "unavailable" ? (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Satellite data is unavailable{firms.message ? `: ${firms.message}` : "."} Missing satellite data is unknown,
          not evidence that there is no fire.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2">
          <ThermalMap
            bbox={region.bbox}
            regionName={region.name}
            features={data.features}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <MapLegend />
          {data.truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {data.features.length} items. Zoom into a smaller area to see the rest.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <SelectedPanel feature={selected} now={now} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>Investigations ({investigations.length})</CardTitle>
              <CardDescription>Waiting for human review. Locations are approximate.</CardDescription>
            </CardHeader>
            <CardContent>
              {investigations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No investigations in this area.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {investigations.map((feature) => (
                    <FeatureRow
                      key={feature.id}
                      feature={feature}
                      now={now}
                      selected={feature.id === selectedId}
                      onSelect={setSelectedId}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Thermal anomalies ({anomalies.length})</CardTitle>
              <CardDescription>Satellite heat detections. Not confirmed fires.</CardDescription>
            </CardHeader>
            <CardContent>
              {anomalies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None found. That is unknown, not evidence of no fire: cloud, overpass timing and small fires
                  all cause gaps.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {anomalies.map((feature) => (
                    <FeatureRow
                      key={feature.id}
                      feature={feature}
                      now={now}
                      selected={feature.id === selectedId}
                      onSelect={setSelectedId}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function age(feature: MapFeature, now: string): string {
  return feature.observedAt ? `${formatDuration(minutesBetween(feature.observedAt, now))} ago` : "time unknown";
}

function FeatureRow({
  feature,
  now,
  selected,
  onSelect,
}: {
  feature: MapFeature;
  now: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(feature.id)}
        aria-pressed={selected}
        className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${selected ? "bg-muted" : ""}`}
      >
        <span className="font-medium">{label(feature)}</span>
        <span className="text-xs text-muted-foreground">
          {age(feature, now)}
          {feature.status ? ` · ${STATUS_LABEL[feature.status]}` : ""}
          {feature.firms ? ` · ${confidenceLabel(feature.firms.confidence)}` : ""}
        </span>
      </button>
    </li>
  );
}

function SelectedPanel({ feature, now }: { feature: MapFeature | null; now: string }) {
  if (!feature) {
    return (
      <Card size="sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a marker or a list item to see its details.</p>
        </CardContent>
      </Card>
    );
  }

  const precisionKm = Math.round(feature.location.precisionMeters / 100) / 10;

  if (feature.kind === "investigation") {
    const summary = feature.investigation;
    return (
      <Card size="sm" aria-live="polite">
        <CardHeader>
          <CardTitle>{investigationLabel(feature)}</CardTitle>
          <CardDescription>{feature.provenance.isSynthetic ? "Synthetic demo data" : feature.provenance.provider}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {feature.status ? <ToneBadge tone={STATUS_TONE[feature.status]}>{STATUS_LABEL[feature.status]}</ToneBadge> : null}
            <ToneBadge tone={priorityTone(feature.reviewPriority)}>{priorityLabel(feature.reviewPriority)}</ToneBadge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Latest evidence</dt>
            <dd>
              {formatUtc(feature.observedAt)} ({age(feature, now)})
            </dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>Approximate, within about {precisionKm} km</dd>
            {summary ? (
              <>
                <dt className="text-muted-foreground">Reports</dt>
                <dd>{summary.reportCount}</dd>
                <dt className="text-muted-foreground">Sources with data</dt>
                <dd>{summary.sources.join(", ") || "none yet"}</dd>
              </>
            ) : null}
          </dl>
          {feature.investigationId ? (
            <Button asChild size="sm">
              <Link href={`/app/embergap/investigations/${feature.investigationId}`}>Open investigation</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const firms = feature.firms;
  return (
    <Card size="sm" aria-live="polite">
      <CardHeader>
        <CardTitle>{featureTitle(feature)}</CardTitle>
        <CardDescription>
          {feature.provenance.isSynthetic ? "Synthetic FIRMS-style detection (demo)" : `NASA FIRMS ${feature.provenance.product ?? ""}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Observed</dt>
          <dd>
            {formatUtc(feature.observedAt)} ({age(feature, now)}, {SOURCE_STATE_LABEL[feature.freshness].toLowerCase()})
          </dd>
          <dt className="text-muted-foreground">Detection confidence</dt>
          <dd>{confidenceLabel(firms?.confidence ?? null)}. The sensor&apos;s own rating, not a probability of fire</dd>
          <dt className="text-muted-foreground">Fire radiative power</dt>
          <dd>{firms?.frpMegawatts == null ? "not reported" : `${firms.frpMegawatts} MW`}</dd>
          <dt className="text-muted-foreground">Pixel</dt>
          <dd>Within about {precisionKm} km</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          A thermal anomaly is a satellite observation of heat, not a confirmed fire. Industrial sites, sun glint and
          hot surfaces can also trigger detections.
        </p>
      </CardContent>
    </Card>
  );
}
