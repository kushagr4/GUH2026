import type { AiMessage } from "./types";

/** Browser helper for POST /api/ai/chat. Calls onDelta for each chunk of text. */
export async function streamChat(
  messages: AiMessage[],
  options: { onDelta: (text: string) => void; signal?: AbortSignal },
): Promise<void> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `AI request failed (${response.status}).`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) options.onDelta(value);
  }
}
