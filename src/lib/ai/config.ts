import "server-only";

export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export type AiConfig = {
  mode: "anthropic" | "mock" | "disabled";
  model: string;
  effort: AiEffort;
  maxTokens: number;
};

function parseEffort(value: string | undefined): AiEffort {
  return AI_EFFORTS.find((effort) => effort === value) ?? "medium";
}

function parseMaxTokens(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16000;
}

/**
 * AI_PROVIDER=mock always wins, which gives you a demo that needs no network and
 * spends nothing. Otherwise the real provider runs when a key is present.
 */
export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const mode =
    env.AI_PROVIDER === "mock"
      ? "mock"
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : "disabled";

  return {
    mode,
    model: env.AI_MODEL || "claude-opus-5-5",
    effort: parseEffort(env.AI_EFFORT),
    maxTokens: parseMaxTokens(env.AI_MAX_TOKENS),
  };
}
