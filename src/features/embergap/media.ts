import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REPORT_MEDIA_BUCKET,
  REPORT_MEDIA_MAX_BYTES,
  reportMediaObjectPath,
  type ReportMediaMimeType,
  type ReportMediaUpload,
} from "@/lib/embergap/contracts";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Checks a photo the browser uploaded straight to the private bucket. The
 * server never receives the upload itself; it reads the stored object back
 * with the reporter's own session, so another user's photo is unreadable.
 */

/** Up to `length` bytes as text; shorter if the buffer ends first. */
function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));
}

/** The real image type from the file's first bytes, ignoring what the client claimed. */
export function sniffImageType(bytes: Uint8Array): ReportMediaMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/**
 * True if the image carries EXIF or XMP metadata, which can include the GPS
 * position where the photo was taken. Re-encoding through a canvas removes it.
 */
export function hasEmbeddedMetadata(bytes: Uint8Array, type: ReportMediaMimeType): boolean {
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) return false; // start of scan, or end of image
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return false;
      if (marker === 0xe1) {
        const header = ascii(bytes, i + 4, 29);
        if (header.startsWith("Exif\0\0") || header.startsWith("http://ns.adobe.com/xap/1.0/")) return true;
      }
      i += 2 + length;
    }
    return false;
  }
  if (type === "image/png") {
    let i = 8;
    while (i + 8 <= bytes.length) {
      const length = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
      const chunk = ascii(bytes, i + 4, 4);
      if (chunk === "eXIf") return true;
      if (chunk === "iTXt" && ascii(bytes, i + 8, 17) === "XML:com.adobe.xmp") return true;
      if (chunk === "IEND") return false;
      i += 12 + length;
    }
    return false;
  }
  let i = 12;
  while (i + 8 <= bytes.length) {
    const chunk = ascii(bytes, i, 4);
    if (chunk === "EXIF" || chunk === "XMP ") return true;
    const size = bytes[i + 4] + (bytes[i + 5] << 8) + (bytes[i + 6] << 16) + ((bytes[i + 7] << 24) >>> 0);
    i += 8 + size + (size % 2);
  }
  return false;
}

export type MediaCheck =
  | { ok: true; data: { objectPath: string; mimeType: ReportMediaMimeType; sizeBytes: number; sha256: string } }
  | { ok: false; message: string };

export async function verifyUploadedMedia(
  client: SupabaseClient<Database>,
  userId: string,
  upload: ReportMediaUpload,
): Promise<MediaCheck> {
  const objectPath = reportMediaObjectPath(userId, upload.mediaId, upload.mimeType);
  const { data, error } = await client.storage.from(REPORT_MEDIA_BUCKET).download(objectPath);
  if (error || !data) {
    return { ok: false, message: "The photo wasn't found. Upload it again, then resubmit." };
  }
  if (data.size === 0 || data.size > REPORT_MEDIA_MAX_BYTES) {
    return { ok: false, message: "The photo must be smaller than 5 MB." };
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (sniffImageType(bytes) !== upload.mimeType) {
    return { ok: false, message: "The photo's contents don't match its type. Use a JPEG, PNG or WebP image." };
  }
  if (hasEmbeddedMetadata(bytes, upload.mimeType)) {
    return {
      ok: false,
      message: "The photo still contains hidden metadata, which can include its GPS location. Re-encode it, then upload again.",
    };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ok: true, data: { objectPath, mimeType: upload.mimeType, sizeBytes: data.size, sha256 } };
}
