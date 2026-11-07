import type { AgentDeps, AgentFinding } from "../types";
import { visionInputSchema, type VisionAnalyzer, type VisionInput } from "./analyzer";
import { toVisionFinding, visionUnavailableFinding, type VisionFindingContext } from "./guardrails";

export const DEFAULT_VISION_TIMEOUT_MS = 20_000;
const MAX_VISION_TIMEOUT_MS = 120_000;

export type VisionValidationContext = VisionFindingContext & { input: VisionInput };

export type ValidateVisionOptions = {
  timeoutMs?: number;
  /** Optional caller cancellation (e.g. the runtime shutting a worker down). */
  signal?: AbortSignal;
};

class VisionTimeoutError extends Error {
  constructor() {
    super("Vision analysis timed out.");
    this.name = "VisionTimeoutError";
  }
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_VISION_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, MAX_VISION_TIMEOUT_MS);
}

/**
 * Run one vision analysis and turn the result into a finding. Never throws:
 * invalid input, analyzer errors, cancellation and timeouts all become an
 * inconclusive `vision.model_unavailable` finding (a data gap, never negative
 * evidence). The analyzer's raw output always goes through `toVisionFinding`.
 */
export async function validateVision(
  ctx: VisionValidationContext,
  analyzer: VisionAnalyzer,
  deps: AgentDeps,
  options: ValidateVisionOptions = {},
): Promise<AgentFinding> {
  const findingCtx: VisionFindingContext = {
    investigationId: ctx.investigationId,
    evidenceIds: ctx.evidenceIds,
  };

  const input = visionInputSchema.safeParse(ctx.input);
  if (!input.success) {
    return visionUnavailableFinding(
      findingCtx,
      deps,
      "The image reference or metadata was not valid for analysis, so no vision analysis ran.",
    );
  }

  const timeoutMs = clampTimeout(options.timeoutMs);
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  // The timer aborts with a VisionTimeoutError reason; caller aborts keep theirs.
  const timer = setTimeout(() => controller.abort(new VisionTimeoutError()), timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(controller.signal.reason ?? new Error("aborted"));
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });
  // Avoid unhandled-rejection noise when the analyzer wins the race.
  aborted.catch(() => undefined);

  try {
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error("aborted");
    // Wrap so a synchronous throw is caught and a late rejection is not unhandled.
    const analysis = Promise.resolve().then(() => analyzer.analyze(input.data, controller.signal));
    analysis.catch(() => undefined);
    const raw = await Promise.race([analysis, aborted]);
    return toVisionFinding(raw, findingCtx, deps);
  } catch (error) {
    const detail =
      error instanceof VisionTimeoutError
        ? `The vision analyzer did not respond within ${timeoutMs} ms.`
        : "The vision analyzer was unavailable or failed.";
    return visionUnavailableFinding(findingCtx, deps, detail);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
