import { z } from "zod";

/** Image types the vision validator will hand to an analyzer. */
export const VISION_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type VisionMimeType = (typeof VISION_MIME_TYPES)[number];

export const VISION_REPORT_DESCRIPTION_MAX = 2000;

/**
 * What the vision validator passes to an analyzer. Everything here is untrusted
 * reporter-supplied data: `reportDescription` in particular may contain prompt
 * injection and must be sent to a model as quoted data, never as instructions.
 */
export const visionInputSchema = z.object({
  /** Private Storage object path (`<user id>/...`) or a synthetic fixture id. Never a public URL. */
  imageRef: z.string().min(1).max(512),
  mimeType: z.enum(VISION_MIME_TYPES),
  reportDescription: z.string().max(VISION_REPORT_DESCRIPTION_MAX).optional(),
  /** Already privacy-reduced coordinates. Context only: the model must not "confirm" them. */
  approxLatitude: z.number().min(-90).max(90).optional(),
  approxLongitude: z.number().min(-180).max(180).optional(),
  /** Reporter-claimed UTC ISO time. Context only: the model must not "confirm" it. */
  observedAt: z.iso.datetime().optional(),
});

export type VisionInput = z.infer<typeof visionInputSchema>;

/**
 * The single seam between the deterministic vision validator and a real
 * vision model.
 *
 * HANDOFF NOTE for the teammate implementing the live (Claude Vision) analyzer:
 *
 * - Implement this in a `server-only` module using the repo AI facilities in
 *   `src/lib/ai` (the API key is read there; never pass it in or log it).
 * - Load the image bytes server-side from private Storage using `imageRef`.
 *   Do not create a public or long-lived signed URL. Strip EXIF before sending
 *   if practical; never forward EXIF GPS/time to the model as "truth".
 * - Send `VISION_SYSTEM_PROMPT` (see `schema.ts`) as the system prompt and ask
 *   for structured output matching `visionModelOutputSchema`. Put
 *   `reportDescription` in the user turn inside clearly delimited quotes,
 *   labelled as untrusted reporter text.
 * - Return the model's parsed JSON object AS IS, typed `unknown`. Do not clean
 *   it up, fill defaults or map it to a finding yourself: `toVisionFinding`
 *   validates, strips location/time/authenticity claims and maps it. If the
 *   model returns non-JSON text, return the raw string; it becomes
 *   `vision.output_invalid`.
 * - Throw (any error) on network failure, refusal, rate limit or missing
 *   configuration. `validateVision` turns throws and timeouts into an
 *   inconclusive `vision.model_unavailable` finding (a data gap).
 * - Honour `signal`: abort the request when it fires.
 * - The input must never contain secrets, tokens, signed URLs, reporter
 *   identity or exact coordinates. Nothing secret goes into the prompt.
 */
export interface VisionAnalyzer {
  /** Stable identifier for audit trails, e.g. "mock" or "anthropic:claude-...". */
  readonly id: string;
  analyze(input: VisionInput, signal?: AbortSignal): Promise<unknown>;
}
