import "server-only";
import type { VisionAnalyzer } from "@/lib/embergap/agents/validators/vision";

/**
 * The live Claude Vision analyzer used by investigation runs, or null.
 *
 * INTEGRATION POINT (Danil): no live analyzer exists yet, so every real photo
 * is recorded as "not analysed" (vision.unavailable, a data gap), never as a
 * synthetic model result. To connect yours:
 *
 * 1. Implement `VisionAnalyzer` (agents/validators/vision/analyzer.ts) in a
 *    server-only module, reading ANTHROPIC_API_KEY through src/lib/ai.
 * 2. `analyze(input, signal)` receives `imageRef`, the private Storage object
 *    path (`<user id>/<uuid>.<ext>`) in bucket REPORT_MEDIA_BUCKET. Download it
 *    with the service-role client (`createAdminClient().storage`), never a
 *    public or signed URL. `reportDescription` is untrusted reporter text.
 * 3. Return the model's raw parsed JSON (or raw text) unchanged. Throw on any
 *    failure; honour `signal` (the run allows 20 s).
 * 4. Return it from this function when it is configured, for example
 *    `return process.env.ANTHROPIC_API_KEY ? createClaudeVisionAnalyzer() : null;`
 *
 * The run then queues "vision.assess" with that output, and
 * danilVisionProcessor's guardrails turn it into the canonical finding.
 */
export function getLiveVisionAnalyzer(): VisionAnalyzer | null {
  return null;
}
