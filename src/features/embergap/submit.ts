import "server-only";
import type { DbError } from "@/lib/db/result";
import type { ReportSubmissionRequest } from "@/lib/embergap/contracts";
import { verifyUploadedMedia } from "./media";
import { createReport, insertReportMedia, type CreatedReport, type EmbergapClient } from "./repository";

export type SubmitResult =
  | { ok: true; data: CreatedReport }
  | { ok: false; reason: "media_invalid"; message: string }
  | { ok: false; reason: "db"; error: DbError };

/**
 * Creates a report for the signed-in user with their own client, so RLS and
 * the column grants apply. A photo must already be in the private bucket at
 * reportMediaObjectPath(userId, mediaId, mimeType); it is checked first.
 */
export async function submitReport(
  client: EmbergapClient,
  userId: string,
  input: ReportSubmissionRequest,
): Promise<SubmitResult> {
  if (input.media) {
    const check = await verifyUploadedMedia(client, userId, input.media);
    if (!check.ok) return { ok: false, reason: "media_invalid", message: check.message };
    const media = await insertReportMedia(client, { id: input.media.mediaId, ...check.data });
    if (!media.ok) return { ok: false, reason: "db", error: media.error };
  }
  const created = await createReport(client, userId, input);
  return created.ok ? created : { ok: false, reason: "db", error: created.error };
}
