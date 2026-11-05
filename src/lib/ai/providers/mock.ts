import { AiError, type AiProvider, type AiRequest } from "../types";

function reply(request: AiRequest): string {
  const last = request.messages.at(-1)?.content ?? "";
  return `[mock AI] You said: ${last}`;
}

/** Deterministic and offline. For tests, UI work, and as a demo safety net. */
export function createMockProvider(): AiProvider {
  return {
    id: "mock",
    model: "mock",

    async *streamText(request) {
      for (const word of reply(request).split(/(?<=\s)/)) {
        request.signal?.throwIfAborted();
        yield word;
      }
    },

    async generateText(request) {
      return reply(request);
    },

    async generateObject(): Promise<never> {
      // There is no model to fill the schema, so make the gap obvious rather
      // than returning invented data.
      throw new AiError(
        "bad_request",
        "generateObject is not available in mock mode. Stub it in your test.",
      );
    },
  };
}
