import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  ownerObjectPath,
  validateUpload,
} from "@/lib/storage/uploads";

const USER = "11111111-1111-1111-1111-111111111111";

describe("validateUpload", () => {
  it("accepts an allowed file within the limit", () => {
    expect(validateUpload({ size: 1024, type: "image/png" })).toEqual({ ok: true });
    expect(validateUpload({ size: MAX_UPLOAD_BYTES, type: "application/pdf" })).toEqual({
      ok: true,
    });
  });

  it("rejects empty files", () => {
    expect(validateUpload({ size: 0, type: "image/png" }).ok).toBe(false);
  });

  it("rejects files over the limit", () => {
    expect(validateUpload({ size: MAX_UPLOAD_BYTES + 1, type: "image/png" }).ok).toBe(false);
  });

  it("rejects types that can run script in a browser", () => {
    expect(validateUpload({ size: 10, type: "text/html" }).ok).toBe(false);
    expect(validateUpload({ size: 10, type: "image/svg+xml" }).ok).toBe(false);
  });

  it("honours per-bucket limits", () => {
    const limits = { maxBytes: 100, allowedTypes: ["text/plain"] };
    expect(validateUpload({ size: 100, type: "text/plain" }, limits).ok).toBe(true);
    expect(validateUpload({ size: 101, type: "text/plain" }, limits).ok).toBe(false);
    expect(validateUpload({ size: 10, type: "image/png" }, limits).ok).toBe(false);
  });
});

describe("ownerObjectPath", () => {
  it("places the object in the owner's folder, as storage RLS requires", () => {
    expect(ownerObjectPath(USER, "photo.png", "abc")).toBe(`${USER}/abc-photo.png`);
  });

  it("is unique by default", () => {
    expect(ownerObjectPath(USER, "a.png")).not.toBe(ownerObjectPath(USER, "a.png"));
  });

  it.each([
    ["../../other-user/evil.png"],
    ["..\\..\\evil.png"],
    ["/etc/passwd"],
  ])("cannot escape the owner's folder with %s", (name) => {
    const path = ownerObjectPath(USER, name, "abc");
    expect(path.startsWith(`${USER}/abc-`)).toBe(true);
    expect(path.slice(USER.length + 1)).not.toContain("/");
    expect(path).not.toContain("..");
  });

  it("copes with a name that has no usable characters", () => {
    expect(ownerObjectPath(USER, "///", "abc")).toBe(`${USER}/abc-file`);
  });

  it("limits long file names, keeping the extension", () => {
    const path = ownerObjectPath(USER, `${"a".repeat(500)}.png`, "abc");
    expect(path.length).toBeLessThan(160);
    expect(path.endsWith(".png")).toBe(true);
  });
});
