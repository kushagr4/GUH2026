/**
 * Upload rules shared by the UI and tests. The same limits are enforced on the
 * server by each bucket's file_size_limit and allowed_mime_types (see the
 * migrations), so these checks are for fast feedback, not security.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
] as const;

export type UploadCheck = { ok: true } | { ok: false; message: string };

export function validateUpload(
  file: { size: number; type: string },
  limits: { maxBytes?: number; allowedTypes?: readonly string[] } = {},
): UploadCheck {
  const maxBytes = limits.maxBytes ?? MAX_UPLOAD_BYTES;
  const allowedTypes = limits.allowedTypes ?? ALLOWED_UPLOAD_TYPES;

  if (file.size === 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `Files must be ${maxBytes / (1024 * 1024)} MB or smaller.`,
    };
  }
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, message: "That file type is not allowed." };
  }
  return { ok: true };
}

/**
 * Storage RLS only allows a user to touch objects under a folder named after
 * their own id, so every object path has to start with it.
 */
export function ownerObjectPath(
  userId: string,
  fileName: string,
  unique: string = crypto.randomUUID(),
): string {
  const safeName =
    fileName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-100) || "file";
  return `${userId}/${unique}-${safeName}`;
}
