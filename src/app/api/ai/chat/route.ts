import { NextResponse } from "next/server";
import { z } from "zod";
import { AiError, getAiProvider } from "@/lib/ai";
import { createRateLimiter } from "@/lib/ai/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(50),
});

// 20 requests a minute per user keeps a runaway client from spending your credit.
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

function errorResponse(status: number, error: string, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "Please sign in.");

  const provider = getAiProvider();
  if (!provider) {
    return errorResponse(
      503,
      "AI is not configured. Set ANTHROPIC_API_KEY, or AI_PROVIDER=mock for a demo.",
    );
  }

  const { allowed, retryAfterSeconds } = limiter.check(user.id);
  if (!allowed) {
    return errorResponse(429, "Too many AI requests. Please wait a moment.", {
      "Retry-After": String(retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "Invalid request: messages are missing or too long.");
  }

  const chunks = provider
    .streamText({ messages: parsed.data.messages, signal: request.signal })
    [Symbol.asyncIterator]();

  // Wait for the first chunk so that auth and rate-limit failures can still
  // return a proper status code, before the stream has started.
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (error) {
    if (error instanceof AiError) return errorResponse(error.status, error.message);
    return errorResponse(502, "The AI request failed.");
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return?.();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-AI-Provider": provider.id,
    },
  });
}
