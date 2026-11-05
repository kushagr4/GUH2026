import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAiConfig } from "@/lib/ai/config";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createMockProvider } from "@/lib/ai/providers/mock";
import { createRateLimiter } from "@/lib/ai/rate-limit";
import { AiError } from "@/lib/ai/types";
import Anthropic from "@anthropic-ai/sdk";

async function collect(chunks: AsyncIterable<string>) {
  let text = "";
  for await (const chunk of chunks) text += chunk;
  return text;
}

const USER_MESSAGE = [{ role: "user" as const, content: "hello" }];

describe("getAiConfig", () => {
  const config = (env: Record<string, string>) =>
    getAiConfig(env as unknown as NodeJS.ProcessEnv);

  it("is off without a key", () => {
    expect(config({}).mode).toBe("disabled");
  });

  it("uses the real provider when a key is set", () => {
    expect(config({ ANTHROPIC_API_KEY: "k" }).mode).toBe("anthropic");
  });

  it("lets mock mode win, so a demo can't spend credit by accident", () => {
    expect(config({ AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "k" }).mode).toBe("mock");
  });

  it("has sensible defaults and ignores invalid overrides", () => {
    expect(config({})).toMatchObject({
      model: "claude-opus-5-5",
      effort: "medium",
      maxTokens: 16000,
    });
    expect(config({ AI_EFFORT: "extreme", AI_MAX_TOKENS: "-3" })).toMatchObject({
      effort: "medium",
      maxTokens: 16000,
    });
  });
});

describe("mock provider", () => {
  const provider = createMockProvider();

  it("streams a predictable reply", async () => {
    const text = await collect(provider.streamText({ messages: USER_MESSAGE }));
    expect(text).toBe("[mock AI] You said: hello");
  });

  it("generates the same text without streaming", async () => {
    await expect(provider.generateText({ messages: USER_MESSAGE })).resolves.toBe(
      "[mock AI] You said: hello",
    );
  });

  it("refuses to invent structured data", async () => {
    await expect(
      provider.generateObject({ messages: USER_MESSAGE }, z.object({ a: z.string() })),
    ).rejects.toBeInstanceOf(AiError);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(provider.streamText({ messages: USER_MESSAGE, signal: controller.signal })),
    ).rejects.toThrow();
  });
});

function sse(events: Array<Record<string, unknown>>) {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function streamEvents(stopReason: string, text = "Hi there") {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 3 },
    },
    { type: "message_stop" },
  ];
}

/** Runs the real SDK against a fake network, so no key or credit is needed. */
function fakeClient(respond: (url: string, body: unknown, headers: Headers) => Response) {
  const calls: Array<{ body: Record<string, unknown>; headers: Headers; url: string }> = [];
  const client = new Anthropic({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      calls.push({ body, headers, url });
      return respond(url, body, headers);
    },
  });
  return { client, calls };
}

const CONFIG = {
  mode: "anthropic" as const,
  model: "claude-opus-5-5",
  effort: "medium" as const,
  maxTokens: 16000,
};

function sseResponse(stopReason = "end_turn", text?: string) {
  return new Response(sse(streamEvents(stopReason, text)), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("anthropic provider (fake network)", () => {
  it("streams text and sends the expected request", async () => {
    const { client, calls } = fakeClient(() => sseResponse());
    const provider = createAnthropicProvider(CONFIG, client);

    const text = await collect(
      provider.streamText({ messages: USER_MESSAGE, system: "Be brief." }),
    );

    expect(text).toBe("Hi there");
    expect(calls[0].body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      stream: true,
      system: "Be brief.",
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    expect(calls[0].headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
  });

  it("surfaces a refusal as a typed error", async () => {
    const { client } = fakeClient(() => sseResponse("refusal"));
    const provider = createAnthropicProvider(CONFIG, client);

    await expect(
      collect(provider.streamText({ messages: USER_MESSAGE })),
    ).rejects.toMatchObject({ kind: "refused", status: 422 });
  });

  it("returns complete text from generateText", async () => {
    const { client } = fakeClient(() => sseResponse("end_turn", "Whole answer"));
    const provider = createAnthropicProvider(CONFIG, client);
    await expect(provider.generateText({ messages: USER_MESSAGE })).resolves.toBe(
      "Whole answer",
    );
  });

  it("parses and validates structured output", async () => {
    const { client, calls } = fakeClient(() =>
      Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"title":"Ok"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const provider = createAnthropicProvider(CONFIG, client);

    await expect(
      provider.generateObject(
        { messages: USER_MESSAGE },
        z.object({ title: z.string() }),
      ),
    ).resolves.toEqual({ title: "Ok" });
    expect(calls[0].body).toHaveProperty("output_config.format");
  });

  it.each([
    [401, "auth", 503],
    [429, "rate_limited", 429],
    [500, "unavailable", 503],
    [400, "bad_request", 400],
  ])("maps HTTP %i to a %s error", async (httpStatus, kind, status) => {
    const { client } = fakeClient(() =>
      Response.json(
        { type: "error", error: { type: "x", message: "secret detail" } },
        { status: httpStatus },
      ),
    );
    const provider = createAnthropicProvider(CONFIG, client);

    const error = await collect(provider.streamText({ messages: USER_MESSAGE })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ kind, status });
    expect((error as Error).message).not.toContain("secret detail");
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit, then refuses with a retry time", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.check("u", 0).allowed).toBe(true);
    expect(limiter.check("u", 100).allowed).toBe(true);
    const third = limiter.check("u", 200);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
  });

  it("frees capacity as the window moves on", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("u", 0);
    expect(limiter.check("u", 500).allowed).toBe(false);
    expect(limiter.check("u", 1001).allowed).toBe(true);
  });

  it("tracks users separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a", 0);
    expect(limiter.check("b", 0).allowed).toBe(true);
  });

  it("does not grow without bound", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    limiter.check("a", 0);
    limiter.check("b", 0);
    limiter.check("c", 0);
    // "a" was evicted to make room, so it starts fresh.
    expect(limiter.check("a", 1).allowed).toBe(true);
  });
});
