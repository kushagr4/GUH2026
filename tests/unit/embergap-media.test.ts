import { describe, expect, it } from "vitest";
import { hasEmbeddedMetadata, sniffImageType, verifyUploadedMedia } from "@/features/embergap/media";

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** SOI, an APP0 JFIF segment, then EOI. */
export const PLAIN_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xd9,
]);

/** SOI, an APP1 Exif segment (where GPS tags live), then EOI. */
export const EXIF_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0e, ...ascii("Exif"), 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0xff, 0xd9,
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngChunk = (type: string, data: number[] = []) => [0, 0, 0, data.length, ...ascii(type), ...data, 0, 0, 0, 0];
const PLAIN_PNG = new Uint8Array([...PNG_SIGNATURE, ...pngChunk("IHDR", Array(13).fill(0)), ...pngChunk("IEND")]);
const EXIF_PNG = new Uint8Array([...PNG_SIGNATURE, ...pngChunk("eXIf", [0x4d, 0x4d]), ...pngChunk("IEND")]);

const webp = (chunks: number[]) => new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...chunks]);
const PLAIN_WEBP = webp([...ascii("VP8 "), 2, 0, 0, 0, 0, 0]);
const EXIF_WEBP = webp([...ascii("VP8 "), 2, 0, 0, 0, 0, 0, ...ascii("EXIF"), 2, 0, 0, 0, 0, 0]);

describe("sniffImageType", () => {
  it.each([
    [PLAIN_JPEG, "image/jpeg"],
    [PLAIN_PNG, "image/png"],
    [PLAIN_WEBP, "image/webp"],
    [new Uint8Array(ascii("GIF89a")), null],
    [new Uint8Array(ascii("<html><script>")), null],
    [new Uint8Array([]), null],
  ])("identifies %#", (bytes, type) => {
    expect(sniffImageType(bytes)).toBe(type);
  });
});

describe("hasEmbeddedMetadata", () => {
  it("finds EXIF in each allowed format", () => {
    expect(hasEmbeddedMetadata(EXIF_JPEG, "image/jpeg")).toBe(true);
    expect(hasEmbeddedMetadata(EXIF_PNG, "image/png")).toBe(true);
    expect(hasEmbeddedMetadata(EXIF_WEBP, "image/webp")).toBe(true);
  });

  it("passes re-encoded images", () => {
    expect(hasEmbeddedMetadata(PLAIN_JPEG, "image/jpeg")).toBe(false);
    expect(hasEmbeddedMetadata(PLAIN_PNG, "image/png")).toBe(false);
    expect(hasEmbeddedMetadata(PLAIN_WEBP, "image/webp")).toBe(false);
  });

  it("terminates on truncated or hostile input", () => {
    expect(hasEmbeddedMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]), "image/jpeg")).toBe(false);
    expect(hasEmbeddedMetadata(new Uint8Array([...PNG_SIGNATURE, 0xff, 0xff, 0xff, 0xff]), "image/png")).toBe(false);
    expect(hasEmbeddedMetadata(webp([...ascii("VP8 "), 0xff, 0xff, 0xff, 0xff]), "image/webp")).toBe(false);
  });
});

describe("verifyUploadedMedia", () => {
  const USER = "6f1c2b8e-4d3a-4f5e-9a7b-1c2d3e4f5a6b";
  const MEDIA = "00000000-0000-4000-8000-000000000005";

  function clientReturning(result: { data: Blob | null; error: unknown }) {
    const download = async (path: string) => {
      downloads.push(path);
      return result;
    };
    const downloads: string[] = [];
    return { client: { storage: { from: () => ({ download }) } } as never, downloads };
  }

  it("reads the photo from the reporter's own folder and accepts a clean image", async () => {
    const { client, downloads } = clientReturning({ data: new Blob([PLAIN_JPEG]), error: null });
    const result = await verifyUploadedMedia(client, USER, { mediaId: MEDIA, mimeType: "image/jpeg" });
    expect(downloads).toEqual([`${USER}/${MEDIA}.jpg`]);
    expect(result).toEqual({
      ok: true,
      data: { objectPath: `${USER}/${MEDIA}.jpg`, mimeType: "image/jpeg", sizeBytes: PLAIN_JPEG.length },
    });
  });

  it.each([
    ["a missing upload", { data: null, error: new Error("not found") }, "wasn't found"],
    ["a mismatched type", { data: new Blob([PLAIN_PNG]), error: null }, "don't match"],
    ["EXIF metadata", { data: new Blob([EXIF_JPEG]), error: null }, "metadata"],
    ["an empty file", { data: new Blob([]), error: null }, "smaller than 5 MB"],
  ])("rejects %s", async (_label, result, message) => {
    const { client } = clientReturning(result);
    const check = await verifyUploadedMedia(client, USER, { mediaId: MEDIA, mimeType: "image/jpeg" });
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toContain(message);
  });
});
