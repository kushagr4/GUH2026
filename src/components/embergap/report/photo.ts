import { REPORT_MEDIA_MAX_BYTES, REPORT_MEDIA_MIME_TYPES } from "@/lib/embergap/contracts";

/** Longest side after re-encoding, per the contract's browser flow. */
export const PHOTO_MAX_SIDE = 2048;
export const PHOTO_JPEG_QUALITY = 0.85;
/** Refuse absurd source files before decoding them. */
export const PHOTO_MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type PhotoCheck = { ok: true } | { ok: false; message: string };

export function checkPhotoSource(file: { type: string; size: number }): PhotoCheck {
  if (!(REPORT_MEDIA_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "Choose a JPEG, PNG or WebP photo." };
  }
  if (file.size > PHOTO_MAX_SOURCE_BYTES) return { ok: false, message: "That photo is too large. Choose one under 25 MB." };
  return { ok: true };
}

export function checkEncodedSize(size: number): PhotoCheck {
  if (size <= 0) return { ok: false, message: "We couldn't process that photo. Try another one." };
  if (size > REPORT_MEDIA_MAX_BYTES) {
    return { ok: false, message: `The photo is still over ${REPORT_MEDIA_MAX_BYTES / (1024 * 1024)} MB after compressing. Try a smaller one.` };
  }
  return { ok: true };
}

/** Scales width × height so the longest side is at most maxSide, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxSide: number = PHOTO_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type ReencodeResult = { ok: true; blob: Blob } | { ok: false; message: string };

/**
 * Browser only. Drawing to a canvas and exporting JPEG drops EXIF/XMP metadata,
 * including GPS, which the API requires.
 */
export async function reencodePhoto(file: File): Promise<ReencodeResult> {
  const source = checkPhotoSource(file);
  if (!source.ok) return source;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, message: "Your browser couldn't process that photo." };
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY));
    if (!blob) return { ok: false, message: "Your browser couldn't process that photo." };
    const size = checkEncodedSize(blob.size);
    return size.ok ? { ok: true, blob } : size;
  } catch {
    return { ok: false, message: "We couldn't read that photo. Try another one." };
  }
}
