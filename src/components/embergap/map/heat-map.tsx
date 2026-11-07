"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "cn";
import type { Bbox, MapFeature } from "@/lib/embergap/contracts";
import type { MapRegion } from "@/lib/embergap/read/regions";
import {
  fitCamera,
  metresPerPixel,
  panBy,
  tilesFor,
  toScreen,
  viewBbox,
  zoomAround,
  type Camera,
  type Point,
  type Size,
} from "./projection";

/**
 * OpenStreetMap tiles: keyless, presentation only, with attribution. Tiles are
 * only ever scaled down (see tilesFor), which keeps them sharp. Offline, the
 * heat layer still draws.
 */
const TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const HIT_RADIUS = 28;
/** Zoom levels per wheel delta unit: a mouse notch (~100) is about 0.6 levels. */
const WHEEL_ZOOM_PER_UNIT = 1 / 160;
/** Trackpad pinch deltas are small, so they get a much larger factor. */
const PINCH_ZOOM_PER_UNIT = 1 / 40;
/** Touch pinch: zoom faster than the finger ratio alone. */
const TOUCH_PINCH_GAIN = 1.6;
const CONTROL = "size-8 text-base leading-none hover:bg-muted";
const SETTLE_MS = 500;

type Layers = { investigations: boolean; anomalies: boolean };

type Gesture =
  | { kind: "pan"; start: Point; camera: Camera; moved: boolean }
  | { kind: "pinch"; startDistance: number; mid: Point; camera: Camera };

/** How strongly a feature heats the map. Labels, not probabilities. */
function weightOf(feature: MapFeature): number {
  if (feature.kind === "investigation") {
    return { high: 1, medium: 0.75, low: 0.5 }[feature.reviewPriority ?? "low"] ?? 0.4;
  }
  const confidence = feature.firms?.confidence ?? null;
  const base =
    typeof confidence === "number"
      ? Math.min(1, Math.max(0.4, confidence / 100))
      : { high: 0.9, nominal: 0.7, low: 0.45 }[confidence ?? "low"];
  return feature.freshness === "available" ? base : base * 0.5;
}

/** Heat radius in screen px: wide enough that nearby evidence blends, never smaller than readable. */
function radiusOf(feature: MapFeature, metresPerPx: number): number {
  const metres = feature.kind === "investigation" ? feature.location.precisionMeters * 2.5 : 2_000;
  const min = feature.kind === "investigation" ? 44 : 28;
  return Math.min(320, Math.max(min, metres / metresPerPx));
}

/** A stable 32-bit hash, so each feature's heat shape is the same on every render. */
function hashOf(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16_777_619);
  return hash >>> 0;
}

type Kernel = { x: number; y: number; r: number; weight: number };

/**
 * A soft centre plus a few offset lobes, so heat spreads unevenly instead of
 * as a perfect disc. Lobes stay within the feature's own heat radius.
 */
function kernelsFor(feature: MapFeature, x: number, y: number, r: number): Kernel[] {
  const weight = weightOf(feature);
  const seed = hashOf(feature.id);
  const lobes = feature.kind === "investigation" ? 4 : 3;
  const kernels: Kernel[] = [{ x, y, r, weight: weight * 0.7 }];
  for (let i = 0; i < lobes; i += 1) {
    const angle = (seed % 628) / 100 + (i / lobes) * Math.PI * 2 + (((seed >>> (i * 4)) & 7) - 3.5) * 0.15;
    const distance = r * (0.18 + (((seed >>> (i * 5 + 3)) & 15) / 15) * 0.22);
    kernels.push({
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      r: r * (0.55 + (((seed >>> (i * 3 + 7)) & 7) / 7) * 0.2),
      weight: weight * 0.35,
    });
  }
  return kernels;
}

let palette: Uint8ClampedArray | null = null;

/** Blue, cyan, green, yellow, red: 256 RGBA entries. */
function heatPalette(): Uint8ClampedArray {
  if (palette) return palette;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0.15, "#2563eb");
  gradient.addColorStop(0.4, "#06b6d4");
  gradient.addColorStop(0.6, "#84cc16");
  gradient.addColorStop(0.8, "#facc15");
  gradient.addColorStop(1, "#dc2626");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  palette = ctx.getImageData(0, 0, 256, 1).data;
  return palette;
}

/** Opacity per intensity: rises gently from 0, so edges fade out instead of ending in a ring. */
const OPACITY = Array.from({ length: 256 }, (_, i) => Math.round(Math.min(200, 255 * (i / 255) ** 0.85)));

function drawHeat(canvas: HTMLCanvasElement, kernels: Kernel[]) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (kernels.length === 0) return;
  for (const kernel of kernels) {
    const { x, y, r, weight } = kernel;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    // Gaussian-like falloff: a dense core that thins out smoothly.
    gradient.addColorStop(0, `rgba(0,0,0,${weight})`);
    gradient.addColorStop(0.25, `rgba(0,0,0,${weight * 0.78})`);
    gradient.addColorStop(0.5, `rgba(0,0,0,${weight * 0.4})`);
    gradient.addColorStop(0.75, `rgba(0,0,0,${weight * 0.12})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const colours = heatPalette();
  for (let i = 0; i < data.length; i += 4) {
    const intensity = data[i + 3]!;
    if (intensity === 0) continue;
    const offset = intensity * 4;
    data[i] = colours[offset]!;
    data[i + 1] = colours[offset + 1]!;
    data[i + 2] = colours[offset + 2]!;
    data[i + 3] = OPACITY[intensity]!;
  }
  ctx.putImageData(image, 0, 0);
}

export function HeatMap({
  features,
  regions,
  initialRegionId,
  selectedId,
  onSelect,
  onViewSettled,
  labelFor,
  className,
}: {
  features: MapFeature[];
  regions: readonly MapRegion[];
  initialRegionId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called after panning or zooming stops, with the visible area. */
  onViewSettled?: (bbox: Bbox) => void;
  labelFor: (feature: MapFeature) => string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [userCamera, setCamera] = useState<Camera | null>(null);
  const [regionId, setRegionId] = useState(initialRegionId);
  const [layers, setLayers] = useState<Layers>({ investigations: true, anomalies: true });
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null);
  const [failedTiles, setFailedTiles] = useState<Set<string>>(() => new Set());

  const region = regions.find((item) => item.id === regionId) ?? regions[0]!;
  // Until the user moves the map, it fits the chosen region.
  const camera = userCamera ?? (size ? fitCamera(region.bbox, size) : null);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const latest = useRef({ camera, size, onViewSettled });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = { camera, size, onViewSettled };
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function settle() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const { camera: current, size: currentSize, onViewSettled: callback } = latest.current;
      if (current && currentSize && callback) callback(viewBbox(current, currentSize));
    }, SETTLE_MS);
  }

  // Wheel zoom needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { camera: current, size: currentSize } = latest.current;
      if (!current || !currentSize) return;
      const rect = element.getBoundingClientRect();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      // Trackpad pinches arrive as ctrl+wheel with small deltas; a mouse notch is about 100.
      const step = Math.max(-1, Math.min(1, -delta * (event.ctrlKey ? PINCH_ZOOM_PER_UNIT : WHEEL_ZOOM_PER_UNIT)));
      const next = zoomAround(current, currentSize, current.zoom + step, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      // Trackpads fire wheel events faster than React re-renders: record the
      // new camera now so the next event builds on it instead of overwriting it.
      latest.current = { ...latest.current, camera: next };
      setCamera(next);
      setHover(null);
      settle();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const visible = useMemo(
    () => features.filter((feature) => (feature.kind === "investigation" ? layers.investigations : layers.anomalies)),
    [features, layers],
  );

  const screen = useMemo(() => {
    if (!camera || !size) return [];
    const metresPerPx = metresPerPixel(camera.latitude, camera.zoom);
    return visible.map((feature) => ({
      feature,
      ...toScreen(camera, size, feature.location.latitude, feature.location.longitude),
      r: radiusOf(feature, metresPerPx),
    }));
  }, [camera, size, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(size.width * dpr);
    const height = Math.round(size.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    drawHeat(
      canvas,
      screen
        .filter((p) => p.x > -p.r && p.y > -p.r && p.x < size.width + p.r && p.y < size.height + p.r)
        .flatMap((p) => kernelsFor(p.feature, p.x * dpr, p.y * dpr, p.r * dpr)),
    );
  }, [screen, size]);

  function local(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearest(point: Point) {
    let best: (typeof screen)[number] | null = null;
    let bestDistance = HIT_RADIUS;
    for (const candidate of screen) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!camera || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    const points = [...pointers.current.values()];
    if (points.length === 1) {
      gesture.current = { kind: "pan", start: points[0]!, camera, moved: false };
    } else if (points.length === 2) {
      const [a, b] = points as [Point, Point];
      gesture.current = {
        kind: "pinch",
        startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        camera,
      };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const point = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    const current = gesture.current;
    if (current?.kind === "pan") {
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) < 4) return;
      current.moved = true;
      setCamera(panBy(current.camera, dx, dy));
      setHover(null);
      return;
    }
    if (current?.kind === "pinch" && size && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      setCamera(
        zoomAround(
          current.camera,
          size,
          current.camera.zoom + TOUCH_PINCH_GAIN * Math.log2(distance / current.startDistance),
          current.mid,
        ),
      );
      return;
    }
    if (event.pointerType === "mouse") {
      const hit = nearest(point);
      setHover(hit ? { label: labelFor(hit.feature), x: hit.x, y: hit.y } : null);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (current?.kind === "pan" && !current.moved) onSelect(nearest(local(event))?.feature.id ?? null);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (current && (current.kind === "pinch" || current.moved)) settle();
    } else if (current?.kind === "pinch" && camera) {
      const [remaining] = [...pointers.current.values()];
      gesture.current = remaining ? { kind: "pan", start: remaining, camera, moved: true } : null;
    }
  }

  function zoomBy(step: number, anchor?: Point) {
    if (!camera || !size) return;
    setCamera(zoomAround(camera, size, camera.zoom + step, anchor ?? { x: size.width / 2, y: size.height / 2 }));
    settle();
  }

  function showRegion(next: MapRegion) {
    setRegionId(next.id);
    setCamera(null);
    if (size && onViewSettled) onViewSettled(viewBbox(fitCamera(next.bbox, size), size));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!camera) return;
    const step = 80;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key]!;
      setCamera(panBy(camera, dx, dy));
      settle();
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(1);
    } else if (event.key === "-") {
      zoomBy(-1);
    }
  }

  const selected = screen.find((point) => point.feature.id === selectedId) ?? null;
  const tiles = camera && size ? tilesFor(camera, size, TILE_TEMPLATE) : [];

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={`Evidence heatmap of ${region.name}. Drag to move, scroll to zoom, arrow keys to pan.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        zoomBy(1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      className={cn(
        "relative touch-none overflow-hidden rounded-xl border bg-muted select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        hover ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        className,
      )}
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
            className="pointer-events-none absolute max-w-none dark:opacity-80 dark:invert dark:hue-rotate-180"
            style={{ left: tile.x, top: tile.y, width: tile.size, height: tile.size }}
            onError={() => setFailedTiles((previous) => new Set(previous).add(tile.key))}
          />
        ))}

      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

      {selected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
          style={{ left: selected.x, top: selected.y }}
        />
      ) : null}

      {hover ? (
        <span
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md bg-background/95 px-2 py-1 text-xs whitespace-nowrap shadow"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.label}
        </span>
      ) : null}

      <div
        className="absolute top-3 left-3 flex gap-1 rounded-lg bg-background/90 p-1 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {regions.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === regionId && userCamera === null}
            onClick={() => showRegion(item)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              item.id === regionId && userCamera === null ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div
        className="absolute top-3 right-3 flex flex-col overflow-hidden rounded-lg bg-background/90 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1)} className={CONTROL}>
          +
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-1)} className={CONTROL}>
          −
        </button>
        <button
          type="button"
          aria-label="Reset view"
          title="Reset view"
          onClick={() => showRegion(region)}
          className={CONTROL}
        >
          ⟲
        </button>
      </div>

      <div
        className="absolute bottom-3 left-3 flex flex-col gap-2 rounded-lg bg-background/90 px-3 py-2 text-xs shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Low</span>
          <span
            aria-hidden
            className="h-2 w-28 rounded-full"
            style={{ background: "linear-gradient(to right, #2563eb, #06b6d4, #84cc16, #facc15, #dc2626)" }}
          />
          <span className="text-muted-foreground">High</span>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ["investigations", "Investigations"],
              ["anomalies", "Thermal anomalies"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              aria-pressed={layers[key]}
              onClick={() => setLayers((previous) => ({ ...previous, [key]: !previous[key] }))}
              className={cn(
                "rounded-full border px-2 py-0.5",
                layers[key] ? "border-foreground/30 bg-foreground/5" : "text-muted-foreground line-through opacity-60",
              )}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute right-2 bottom-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
          onPointerDown={(event) => event.stopPropagation()}
        >
          OpenStreetMap
        </a>
      </div>
    </div>
  );
}
