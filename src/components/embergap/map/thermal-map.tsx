"use client";

import { Fragment, useMemo, useState } from "react";
import { cn } from "cn";
import type { Bbox, MapFeature, ReviewPriority } from "@/lib/embergap/read/types";
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

const PRIORITY_COLOUR: Record<ReviewPriority, string> = {
  high: "bg-red-600",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  undetermined: "bg-slate-500",
};

function anomalyClass(feature: MapFeature): string {
  if (feature.freshness === "stale") return "bg-stone-400";
  if (feature.freshness === "recent") return "bg-orange-300";
  return "bg-orange-500";
}

function anomalySize(feature: MapFeature): number {
  if (feature.confidence === "high") return 14;
  if (feature.confidence === "nominal") return 12;
  return 10;
}

/** Metres per world pixel at this latitude and zoom (Web Mercator). */
function metresPerPixel(latitude: number, zoom: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
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
                left: `${tile.left}%`,
                top: `${tile.top}%`,
                width: `${tile.width}%`,
                height: `${tile.height}%`,
              }}
              onError={() => setFailedTiles((previous) => new Set(previous).add(tile.key))}
            />
          ))}

        {ordered.map((feature) => {
          const position = project(view, feature.latitude, feature.longitude);
          if (position.left < -2 || position.left > 102 || position.top < -2 || position.top > 102) {
            return null;
          }
          const selected = feature.id === selectedId;
          const isInvestigation = feature.kind === "investigation";
          // Diameter in view pixels of a circle whose radius is the location precision.
          const haloPx = isInvestigation
            ? (2 * feature.locationPrecisionKm * 1000) / metresPerPixel(feature.latitude, view.zoom)
            : 0;
          const size = isInvestigation ? 20 : anomalySize(feature);

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
                    left: `${position.left}%`,
                    top: `${position.top}%`,
                    width: `max(${(haloPx / VIEW_WIDTH) * 100}%, ${size + 18}px)`,
                    aspectRatio: "1",
                  }}
                />
              ) : null}
              <div
                className="absolute"
                style={{ left: `${position.left}%`, top: `${position.top}%` }}
              >
              <button
                type="button"
                aria-label={`${feature.title}${isInvestigation ? "" : `, ${feature.freshness}`}`}
                aria-pressed={selected}
                title={feature.title}
                onClick={() => onSelect(feature.id)}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-none dark:border-neutral-900",
                  isInvestigation
                    ? PRIORITY_COLOUR[feature.priority ?? "undetermined"]
                    : anomalyClass(feature),
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
  const item = (swatch: string, label: string, extra?: string) => (
    <li className="flex items-center gap-2">
      <span aria-hidden className={cn("inline-block size-3 rounded-full border border-white shadow", swatch, extra)} />
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Map legend">
      {item("bg-red-600", "Investigation: high review priority")}
      {item("bg-amber-500", "Medium")}
      {item("bg-sky-500", "Low")}
      {item("bg-slate-500", "Undetermined")}
      {item("bg-orange-500", "Thermal anomaly, under 3 h old")}
      {item("bg-orange-300", "3 to 12 h")}
      {item("bg-stone-400", "Older")}
      <li className="flex items-center gap-2">
        <span aria-hidden className="inline-block size-3 rounded-full border-2 border-dashed border-foreground/40" />
        Approximate report area
      </li>
    </ul>
  );
}
