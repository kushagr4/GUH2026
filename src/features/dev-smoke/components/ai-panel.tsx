"use client";

import { useRef, useState, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { streamChat } from "@/lib/ai/client";

export function AiPanel() {
  const [prompt, setPrompt] = useState("Say hello in five words.");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    controller.current = new AbortController();
    setBusy(true);
    setError(null);
    setOutput("");
    try {
      await streamChat([{ role: "user", content: prompt }], {
        signal: controller.current.signal,
        onDelta: (text) => setOutput((current) => current + text),
      });
    } catch (caught) {
      if (!controller.current.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "The AI request failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ai-prompt">Prompt</Label>
        <Textarea
          id="ai-prompt"
          onChange={(event) => setPrompt(event.target.value)}
          required
          rows={3}
          value={prompt}
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} type="submit">
          {busy ? "Streaming…" : "Send"}
        </Button>
        {busy ? (
          <Button
            onClick={() => controller.current?.abort()}
            type="button"
            variant="outline"
          >
            Stop
          </Button>
        ) : null}
      </div>
      {error ? <FormMessage variant="error">{error}</FormMessage> : null}
      {output ? (
        <p className="rounded-xl border p-4 text-sm whitespace-pre-wrap" data-testid="ai-output">
          {output}
        </p>
      ) : null}
    </form>
  );
}
