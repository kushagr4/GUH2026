"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MapRegion } from "@/lib/embergap/read/regions";
import type { MapFeature, MapResponse } from "@/lib/embergap/read/types";
import { MapLegend, ThermalMap } from "@/components/embergap/map/thermal-map";
import {
  FRESHNESS_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SOURCE_STATE_LABEL,
  SOURCE_STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatAge,
  formatUtc,
} from "./labels";
import { DemoDataNotice } from "./notices";
import { ToneBadge } from "./tone-badge";

const MAP_LIMIT = 100;

function bboxParam(region: MapRegion): string {
  const { minLon, minLat, maxLon, maxLat } = region.bbox;
  return [minLon, minLat, maxLon, maxLat].join(",");
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
  const selected = data.features.find((feature) => feature.id === selectedId) ?? null;
  const investigations = data.features.filter((feature) => feature.kind === "investigation");
  const anomalies = data.features.filter((feature) => feature.kind === "thermal_anomaly");

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
      const body = (await response.json().catch(() => null)) as MapResponse | { error?: string } | null;
      if (!response.ok || !body || !("features" in body)) {
        const message = body && "error" in body && body.error ? body.error : "The map could not be loaded.";
        setError(response.status === 401 ? "Your session has ended. Sign in again." : message);
        return;
      }
      setData(body);
      setSelectedId(body.features.find((feature) => feature.kind === "investigation")?.id ?? null);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError("Could not reach the server.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }

  const { firms } = data.sources;

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
              disabled={loading && item.id === regionId}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span>Satellite:</span>
          <ToneBadge tone={SOURCE_STATE_TONE[firms.state]} title={firms.note}>
            {firms.mode === "demo" ? "Demo" : "Live"} · {SOURCE_STATE_LABEL[firms.state]}
          </ToneBadge>
          {firms.retrievedAt ? <span>checked {formatUtc(firms.retrievedAt)}</span> : null}
          {loading ? <span>Loading…</span> : null}
        </div>
      </div>

      <DemoDataNotice satelliteLive={firms.mode === "live"} />

      {error ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {firms.error ? (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Satellite data is unavailable: {firms.error} Missing satellite data is unknown, not evidence that
          there is no fire.
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
              Showing {data.features.length} of {data.total} items. Zoom into a smaller area to see the rest.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <SelectedPanel feature={selected} />

          <Card size="sm">
            <CardHeader>
              <CardTitle>Investigations ({investigations.length})</CardTitle>
              <CardDescription>Synthetic reports waiting for human review.</CardDescription>
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
              <CardDescription>
                Satellite heat detections in the last {firms.dayRange * 24} hours. Not confirmed fires.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {anomalies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None detected. That is unknown, not evidence of no fire: cloud, overpass timing and
                  small fires all cause gaps.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {anomalies.map((feature) => (
                    <FeatureRow
                      key={feature.id}
                      feature={feature}
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

function FeatureRow({
  feature,
  selected,
  onSelect,
}: {
  feature: MapFeature;
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
        <span className="font-medium">{feature.title}</span>
        <span className="text-xs text-muted-foreground">
          {formatAge(feature.ageMinutes)}
          {feature.reviewStatus ? ` · ${STATUS_LABEL[feature.reviewStatus]}` : ""}
          {feature.confidence ? ` · ${feature.confidence} class` : ""}
        </span>
      </button>
    </li>
  );
}

function SelectedPanel({ feature }: { feature: MapFeature | null }) {
  if (!feature) {
    return (
      <Card size="sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a marker or a list item to see its details.</p>
        </CardContent>
      </Card>
    );
  }

  if (feature.kind === "investigation") {
    return (
      <Card size="sm" aria-live="polite">
        <CardHeader>
          <CardTitle>{feature.title}</CardTitle>
          <CardDescription>{feature.provenance.label}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {feature.reviewStatus ? (
              <ToneBadge tone={STATUS_TONE[feature.reviewStatus]}>{STATUS_LABEL[feature.reviewStatus]}</ToneBadge>
            ) : null}
            {feature.priority ? (
              <ToneBadge tone={PRIORITY_TONE[feature.priority]}>{PRIORITY_LABEL[feature.priority]}</ToneBadge>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Observed</dt>
            <dd>
              {formatUtc(feature.observedAt)} ({formatAge(feature.ageMinutes)})
            </dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>Approximate, to about {feature.locationPrecisionKm} km</dd>
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

  return (
    <Card size="sm" aria-live="polite">
      <CardHeader>
        <CardTitle>{feature.title}</CardTitle>
        <CardDescription>{feature.provenance.label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Observed</dt>
          <dd>
            {formatUtc(feature.observedAt)} ({formatAge(feature.ageMinutes)}, {FRESHNESS_LABEL[feature.freshness].toLowerCase()})
          </dd>
          <dt className="text-muted-foreground">Detection class</dt>
          <dd>{feature.confidence ?? "not reported"} (the sensor&apos;s own class, not a probability)</dd>
          <dt className="text-muted-foreground">Fire radiative power</dt>
          <dd>{feature.frpMw === null ? "not reported" : `${feature.frpMw} MW`}</dd>
          <dt className="text-muted-foreground">Pixel</dt>
          <dd>About {feature.locationPrecisionKm} km across</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          A thermal anomaly is a satellite observation of heat, not a confirmed fire. Industrial sites,
          sun glint and hot surfaces can also trigger detections.
        </p>
      </CardContent>
    </Card>
  );
}
