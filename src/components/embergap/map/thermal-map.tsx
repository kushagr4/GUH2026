"use client";

import { Fragment, useMemo, useState } from "react";
import { cn } from "cn";
import type { Bbox, MapFeature } from "@/lib/embergap/contracts";
import { fitBbox, project, tilesFor } from "./projection";

/** The map's own coordinate space. The rendered map scales to its container. */
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 520;

/**
 * Base map tiles from OpenStreetMap: presentation only, with attribution, and
 * fetched by the browser directly. Without network the markers still render
 * on a plain background, so the offline demo keeps working.
 */
const TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function priorityColour(priority: MapFeature["reviewPriority"]): string {
  if (priority === "high") return "bg-red-600";
  if (priority === "medium") return "bg-yellow-400";
  if (priority === "low") return "bg-sky-500";
  return "bg-slate-500";
}

function anomalyClass(feature: MapFeature): string {
  return feature.freshness === "available" ? "bg-orange-500" : "bg-stone-400";
}

function anomalySize(feature: MapFeature): number {
  const confidence = feature.firms?.confidence ?? null;
  if (confidence === "high" || (typeof confidence === "number" && confidence >= 80)) return 14;
  if (confidence === "nominal" || (typeof confidence === "number" && confidence >= 30)) return 12;
  return 10;
}

/**
 * A CSS percentage rounded to 2 decimals. Browsers store long decimals at
 * reduced precision, which would make server and client markup differ.
 */
function pct(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

/** Metres per world pixel at this latitude and zoom (Web Mercator). */
function metresPerPixel(latitude: number, zoom: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

export function featureTitle(feature: MapFeature): string {
  if (feature.kind === "investigation") {
    return feature.investigation?.isSynthetic ? "Synthetic investigation" : "Investigation";
  }
  return `Thermal anomaly (${feature.firms?.instrument ?? feature.provenance.product ?? "FIRMS"})`;
}

export function ThermalMap({
  bbox,
  regionName,
  features,
  selectedId,
  onSelect,
}: {
  bbox: Bbox;
  regionName: string;
  features: MapFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const view = useMemo(() => fitBbox(bbox, VIEW_WIDTH, VIEW_HEIGHT), [bbox]);
  const tiles = useMemo(() => tilesFor(view, TILE_TEMPLATE), [view]);
  const [failedTiles, setFailedTiles] = useState<Set<string>>(() => new Set());

  // Investigations on top of anomalies, the selected feature on top of all.
  const ordered = [...features].sort((a, b) => {
    if (a.id === selectedId) return 1;
    if (b.id === selectedId) return -1;
    return a.kind === b.kind ? 0 : a.kind === "investigation" ? 1 : -1;
  });

  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={`Map of ${regionName}`}
        className="relative w-full overflow-hidden rounded-lg border bg-muted"
        style={{
          aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}`,
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "10% 15.4%",
        }}
      >
        {tiles
          .filter((tile) => !failedTiles.has(tile.key))
          .map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element -- third-party map tiles, no optimisation needed
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              aria-hidden
              draggable={false}
              referrerPolicy="strict-origin-when-cross-origin"
              className="pointer-events-none absolute max-w-none select-none opacity-90 dark:opacity-60 dark:invert dark:hue-rotate-180"
              style={{
                left: pct(tile.left),
                top: pct(tile.top),
                width: pct(tile.width),
                height: pct(tile.height),
              }}
              onError={() => setFailedTiles((previous) => new Set(previous).add(tile.key))}
            />
          ))}

        {ordered.map((feature) => {
          const { latitude, longitude, precisionMeters } = feature.location;
          const position = project(view, latitude, longitude);
          if (position.left < -2 || position.left > 102 || position.top < -2 || position.top > 102) {
            return null;
          }
          const selected = feature.id === selectedId;
          const isInvestigation = feature.kind === "investigation";
          // Diameter in view pixels of a circle whose radius is the location precision.
          const haloPx = isInvestigation ? (2 * precisionMeters) / metresPerPixel(latitude, view.zoom) : 0;
          const size = isInvestigation ? 20 : anomalySize(feature);
          const title = featureTitle(feature);

          return (
            <Fragment key={feature.id}>
              {isInvestigation ? (
                // Never smaller than the marker plus a margin, so the "approximate"
                // cue stays visible on small screens. That can only overstate the
                // uncertainty, never understate it.
                <span
                  aria-hidden
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-foreground/50 bg-foreground/10"
                  style={{
                    left: pct(position.left),
                    top: pct(position.top),
                    width: `max(${pct((haloPx / VIEW_WIDTH) * 100)}, ${size + 18}px)`,
                    aspectRatio: "1",
                  }}
                />
              ) : null}
              <div className="absolute" style={{ left: pct(position.left), top: pct(position.top) }}>
                <button
                  type="button"
                  aria-label={title}
                  aria-pressed={selected}
                  title={title}
                  onClick={() => onSelect(feature.id)}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none dark:border-neutral-900",
                    isInvestigation ? priorityColour(feature.reviewPriority) : anomalyClass(feature),
                    selected && "scale-125 ring-4 ring-foreground/70",
                  )}
                  style={{ width: size, height: size }}
                />
              </div>
            </Fragment>
          );
        })}

        <div className="absolute right-1 bottom-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Map ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>
        </div>
      </div>
      {failedTiles.size > 0 && failedTiles.size >= tiles.length ? (
        <p className="text-xs text-muted-foreground">
          The base map could not load (offline?). Markers are still in the right places.
        </p>
      ) : null}
    </div>
  );
}

export function MapLegend() {
  const item = (swatch: string, label: string) => (
    <li className="flex items-center gap-2">
      <span aria-hidden className={cn("inline-block size-3 rounded-full border border-white shadow", swatch)} />
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Map legend">
      {item("bg-red-600", "Investigation: high review priority")}
      {item("bg-yellow-400", "Medium")}
      {item("bg-sky-500", "Low")}
      {item("bg-slate-500", "Not set")}
      {item("bg-orange-500", "Thermal anomaly, within 12 h")}
      {item("bg-stone-400", "Older (stale)")}
      <li className="flex items-center gap-2">
        <span aria-hidden className="inline-block size-3 rounded-full border-2 border-dashed border-foreground/40" />
        Approximate investigation area
      </li>
    </ul>
  );
}
