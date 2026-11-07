import type { Bbox } from "@/lib/embergap/contracts";

/** Web Mercator, as used by OpenStreetMap tiles. */
export const TILE_SIZE = 256;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 18;
const MAX_LAT = 85.05112878;

export type Camera = { latitude: number; longitude: number; zoom: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * worldSize(zoom);
}

export function latToWorldY(lat: number, zoom: number): number {
  const rad = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldSize(zoom);
}

export function worldXToLon(x: number, zoom: number): number {
  return (x / worldSize(zoom)) * 360 - 180;
}

export function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * y) / worldSize(zoom));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Metres per screen pixel at this latitude and zoom. */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

function normalise(camera: Camera): Camera {
  return {
    latitude: clamp(camera.latitude, -MAX_LAT, MAX_LAT),
    longitude: ((((camera.longitude + 180) % 360) + 360) % 360) - 180,
    zoom: clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

/** The camera that fits `bbox` in the view with some padding (fractional zoom). */
export function fitCamera(bbox: Bbox, size: Size, padding = 32): Camera {
  const width = Math.max(1, size.width - padding * 2);
  const height = Math.max(1, size.height - padding * 2);
  const dx = lonToWorldX(bbox.maxLongitude, 0) - lonToWorldX(bbox.minLongitude, 0);
  const dy = latToWorldY(bbox.minLatitude, 0) - latToWorldY(bbox.maxLatitude, 0);
  const zoom = Math.log2(Math.min(width / dx, height / dy));
  const centreX = (lonToWorldX(bbox.minLongitude, 0) + lonToWorldX(bbox.maxLongitude, 0)) / 2;
  const centreY = (latToWorldY(bbox.minLatitude, 0) + latToWorldY(bbox.maxLatitude, 0)) / 2;
  return normalise({ latitude: worldYToLat(centreY, 0), longitude: worldXToLon(centreX, 0), zoom });
}

/** Screen position (px from the view's top-left) of a point. */
export function toScreen(camera: Camera, size: Size, latitude: number, longitude: number): Point {
  return {
    x: lonToWorldX(longitude, camera.zoom) - lonToWorldX(camera.longitude, camera.zoom) + size.width / 2,
    y: latToWorldY(latitude, camera.zoom) - latToWorldY(camera.latitude, camera.zoom) + size.height / 2,
  };
}

export function toLatLon(camera: Camera, size: Size, point: Point): { latitude: number; longitude: number } {
  const x = lonToWorldX(camera.longitude, camera.zoom) + point.x - size.width / 2;
  const y = latToWorldY(camera.latitude, camera.zoom) + point.y - size.height / 2;
  return { latitude: worldYToLat(y, camera.zoom), longitude: worldXToLon(x, camera.zoom) };
}

/** Moves the camera by a screen-pixel drag. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  const x = lonToWorldX(camera.longitude, camera.zoom) - dx;
  const y = latToWorldY(camera.latitude, camera.zoom) - dy;
  return normalise({ ...camera, longitude: worldXToLon(x, camera.zoom), latitude: worldYToLat(y, camera.zoom) });
}

/** Zooms so the map point under `anchor` stays under it. */
export function zoomAround(camera: Camera, size: Size, zoom: number, anchor: Point): Camera {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const target = toLatLon(camera, size, anchor);
  const zoomed = { ...camera, zoom: next };
  const moved = toScreen(zoomed, size, target.latitude, target.longitude);
  return panBy(zoomed, anchor.x - moved.x, anchor.y - moved.y);
}

/** The visible area. */
export function viewBbox(camera: Camera, size: Size): Bbox {
  const topLeft = toLatLon(camera, size, { x: 0, y: 0 });
  const bottomRight = toLatLon(camera, size, { x: size.width, y: size.height });
  return {
    minLongitude: clamp(topLeft.longitude, -180, 180),
    minLatitude: clamp(bottomRight.latitude, -90, 90),
    maxLongitude: clamp(bottomRight.longitude, -180, 180),
    maxLatitude: clamp(topLeft.latitude, -90, 90),
  };
}

export type Tile = { key: string; url: string; x: number; y: number; size: number };

const SUBDOMAINS = "abcd";

/**
 * Tiles covering the view, in screen pixels. Uses the next whole zoom up, so
 * tiles are only ever scaled down (sharp), never up (blurry). `{s}` in the
 * template is replaced with a/b/c/d to spread requests across hosts.
 * Keys include the tile zoom, so tiles of different levels never collide.
 */
export function tilesFor(camera: Camera, size: Size, template: string, levelsBelow = 0): Tile[] {
  // levelsBelow > 0 gives coarser, already-cached tiles to show while sharper ones load.
  const tileZoom = Math.max(0, Math.min(20, Math.ceil(camera.zoom - 1e-9)) - levelsBelow);
  const scale = 2 ** (camera.zoom - tileZoom);
  const tilePx = TILE_SIZE * scale;
  const count = 2 ** tileZoom;
  const originX = lonToWorldX(camera.longitude, tileZoom) * scale - size.width / 2;
  const originY = latToWorldY(camera.latitude, tileZoom) * scale - size.height / 2;
  const firstX = Math.floor(originX / tilePx);
  const lastX = Math.floor((originX + size.width) / tilePx);
  const firstY = Math.max(0, Math.floor(originY / tilePx));
  const lastY = Math.min(count - 1, Math.floor((originY + size.height) / tilePx));
  const tiles: Tile[] = [];
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const wrappedX = ((x % count) + count) % count;
      tiles.push({
        key: `${tileZoom}/${x}/${y}`,
        url: template
          .replace("{s}", SUBDOMAINS[(wrappedX + y) % SUBDOMAINS.length]!)
          .replace("{z}", String(tileZoom))
          .replace("{x}", String(wrappedX))
          .replace("{y}", String(y)),
        x: Math.round(x * tilePx - originX),
        y: Math.round(y * tilePx - originY),
        size: Math.ceil(tilePx) + 1,
      });
    }
  }
  return tiles;
}

export type ViewTransform = { scale: number; x: number; y: number };

/**
 * The affine map from screen pixels under `from` to screen pixels under `to`
 * (screen = scale * screenFrom + offset). Web Mercator scales linearly with
 * 2^zoom, so a layer drawn for `from` can be moved with a CSS transform
 * instead of being redrawn on every frame of a gesture.
 */
export function viewTransform(from: Camera, to: Camera, size: Size): ViewTransform {
  const scale = 2 ** (to.zoom - from.zoom);
  const fromX = lonToWorldX(from.longitude, from.zoom);
  const fromY = latToWorldY(from.latitude, from.zoom);
  const toX = lonToWorldX(to.longitude, to.zoom);
  const toY = latToWorldY(to.latitude, to.zoom);
  return {
    scale,
    x: scale * (fromX - size.width / 2) - toX + size.width / 2,
    y: scale * (fromY - size.height / 2) - toY + size.height / 2,
  };
}
