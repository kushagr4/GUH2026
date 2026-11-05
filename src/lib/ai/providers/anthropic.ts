import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { AiConfig } from "../config";
import { AiError, type AiProvider, type AiRequest } from "../types";

// On a safety decline the API re-runs the request on Anthropic's recommended
// fallback model inside the same call, instead of returning a dead end.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError("auth", "The AI API key was rejected.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("auth", "The AI API key cannot use this model.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("rate_limited", "The AI service is rate limited. Try again shortly.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError("bad_request", "The AI service rejected this request.");
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiError("unavailable", "The AI service is unavailable. Try again shortly.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError("unknown", "The AI service returned an error.");
  }
  return new AiError("unknown", "The AI request failed.");
}

function assertNotRefused(stopReason: string | null | undefined): void {
  if (stopReason === "refusal") {
    throw new AiError("refused", "The AI declined this request.");
  }
}

export function createAnthropicProvider(
  config: AiConfig,
  client: Anthropic = new Anthropic({ maxRetries: 2 }),
): AiProvider {
  const baseParams = (request: AiRequest) => ({
    model: config.model,
    max_tokens: config.maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
    thinking: { type: "adaptive" as const },
    messages: request.messages,
    ...(request.system ? { system: request.system } : {}),
  });

  return {
    id: "anthropic",
    model: config.model,

    async *streamText(request) {
      try {
        const stream = client.beta.messages.stream(
          { ...baseParams(request), output_config: { effort: config.effort } },
          { signal: request.signal },
        );
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield event.delta.text;
          }
        }
        const finalMessage = await stream.finalMessage();
        assertNotRefused(finalMessage.stop_reason);
      } catch (error) {
        throw toAiError(error);
      }
    },

    async generateText(request) {
      try {
        const message = await client.beta.messages
          .stream(
            { ...baseParams(request), output_config: { effort: config.effort } },
            { signal: request.signal },
          )
          .finalMessage();
        assertNotRefused(message.stop_reason);
        return message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
      } catch (error) {
        throw toAiError(error);
      }
    },

    async generateObject<Schema extends z.ZodType>(
      request: AiRequest,
      schema: Schema,
    ): Promise<z.infer<Schema>> {
      try {
        const message = await client.beta.messages.parse(
          {
            ...baseParams(request),
            output_config: {
              effort: config.effort,
              format: betaZodOutputFormat(schema),
            },
          },
          { signal: request.signal },
        );
        assertNotRefused(message.stop_reason);
        if (message.parsed_output === null || message.parsed_output === undefined) {
          throw new AiError("invalid_output", "The AI returned an unexpected format.");
        }
        return message.parsed_output as z.infer<Schema>;
      } catch (error) {
        throw toAiError(error);
      }
    },
  };
}
