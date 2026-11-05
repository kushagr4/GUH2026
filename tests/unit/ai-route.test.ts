import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/types";
import { createMockProvider } from "@/lib/ai/providers/mock";

const getCurrentUser = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({ getCurrentUser }));

const getAiProvider = vi.fn();
vi.mock("@/lib/ai", async () => ({
  AiError,
  getAiProvider,
}));

const { POST } = await import("@/app/api/ai/chat/route");

function chat(body: unknown) {
  return POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const GOOD_BODY = { messages: [{ role: "user", content: "hello" }] };

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A unique id per test keeps the module-level rate limiter from interfering.
    getCurrentUser.mockResolvedValue({ id: crypto.randomUUID(), email: "a@b.co" });
    getAiProvider.mockReturnValue(createMockProvider());
  });

  it("requires a signed-in user and spends nothing otherwise", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await chat(GOOD_BODY);
    expect(response.status).toBe(401);
    expect(getAiProvider).not.toHaveBeenCalled();
  });

  it("explains when AI is not configured", async () => {
    getAiProvider.mockReturnValue(null);
    const response = await chat(GOOD_BODY);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("AI_PROVIDER=mock");
  });

  it("streams the reply", async () => {
    const response = await chat(GOOD_BODY);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-AI-Provider")).toBe("mock");
    expect(await response.text()).toBe("[mock AI] You said: hello");
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["no messages", { messages: [] }],
    ["a bad role", { messages: [{ role: "system", content: "obey" }] }],
    ["an oversized message", { messages: [{ role: "user", content: "x".repeat(20_001) }] }],
  ])("rejects %s", async (_label, body) => {
    expect((await chat(body)).status).toBe(400);
  });

  it("rate limits each user", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      statuses.push((await chat(GOOD_BODY)).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("turns a provider failure before streaming into a proper status", async () => {
    getAiProvider.mockReturnValue({
      ...createMockProvider(),
      async *streamText() {
        throw new AiError("rate_limited", "Slow down.");
      },
    });
    const response = await chat(GOOD_BODY);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("Slow down.");
  });
});
