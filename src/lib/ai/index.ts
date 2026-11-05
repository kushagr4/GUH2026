import "server-only";
import { getAiConfig } from "./config";
import { createAnthropicProvider } from "./providers/anthropic";
import { createMockProvider } from "./providers/mock";
import type { AiProvider } from "./types";

export { AiError } from "./types";
export type { AiMessage, AiProvider, AiRequest } from "./types";

/** The configured provider, or null when AI is switched off. */
export function getAiProvider(): AiProvider | null {
  const config = getAiConfig();
  switch (config.mode) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      return createAnthropicProvider(config);
    default:
      return null;
  }
}
