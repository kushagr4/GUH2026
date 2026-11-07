import type { Bbox } from "@/lib/embergap/read/types";

/** Web Mercator, as used by OpenStreetMap tiles. */
export const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;

export function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

export function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * TILE_SIZE * 2 ** zoom;
}

export type MapView = {
  zoom: number;
  /** World-pixel position of the view's top-left corner. */
  originX: number;
  originY: number;
  width: number;
  height: number;
};

/** The largest whole zoom at which `bbox` fits in width x height, centred. */
export function fitBbox(bbox: Bbox, width: number, height: number, maxZoom = 14): MapView {
  let zoom = 0;
  for (let z = maxZoom; z >= 0; z -= 1) {
    const w = lonToWorldX(bbox.maxLon, z) - lonToWorldX(bbox.minLon, z);
    const h = latToWorldY(bbox.minLat, z) - latToWorldY(bbox.maxLat, z);
    if (w <= width && h <= height) {
      zoom = z;
      break;
    }
  }
  const centreX = (lonToWorldX(bbox.minLon, zoom) + lonToWorldX(bbox.maxLon, zoom)) / 2;
  const centreY = (latToWorldY(bbox.minLat, zoom) + latToWorldY(bbox.maxLat, zoom)) / 2;
  return { zoom, originX: centreX - width / 2, originY: centreY - height / 2, width, height };
}

/** Position inside the view as percentages, so the map scales with its container. */
export function project(view: MapView, latitude: number, longitude: number): { left: number; top: number } {
  return {
    left: ((lonToWorldX(longitude, view.zoom) - view.originX) / view.width) * 100,
    top: ((latToWorldY(latitude, view.zoom) - view.originY) / view.height) * 100,
  };
}

export type Tile = {
  key: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** The tiles covering the view, positioned and sized as percentages. */
export function tilesFor(view: MapView, template: string): Tile[] {
  const count = 2 ** view.zoom;
  const firstX = Math.floor(view.originX / TILE_SIZE);
  const lastX = Math.floor((view.originX + view.width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(view.originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((view.originY + view.height) / TILE_SIZE));
  const tiles: Tile[] = [];
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const wrappedX = ((x % count) + count) % count;
      tiles.push({
        key: `${view.zoom}/${x}/${y}`,
        url: template
          .replace("{z}", String(view.zoom))
          .replace("{x}", String(wrappedX))
          .replace("{y}", String(y)),
        left: ((x * TILE_SIZE - view.originX) / view.width) * 100,
        top: ((y * TILE_SIZE - view.originY) / view.height) * 100,
        width: (TILE_SIZE / view.width) * 100,
        height: (TILE_SIZE / view.height) * 100,
      });
    }
  }
  return tiles;
}
