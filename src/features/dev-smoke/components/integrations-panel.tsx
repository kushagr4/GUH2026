"use client";

import { useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkElevenLabs,
  checkElevenLabsUsage,
  checkFirecrawl,
  checkGitHub,
  checkN8n,
  type IntegrationCheckResult,
} from "../integration-actions";

function Result({ id, result }: { id: string; result: IntegrationCheckResult | null }) {
  if (!result) return null;
  if (!result.ok) return <FormMessage variant="error">{result.message}</FormMessage>;
  return (
    <div className="flex flex-col gap-2" data-testid={`${id}-result`}>
      <ul className="flex flex-col gap-1 text-sm break-words">
        {result.lines.map((line, index) => (
          <li key={index} className={index === 0 ? "font-medium" : "text-muted-foreground"}>
            {line}
          </li>
        ))}
      </ul>
      {result.audioUrl ? <audio controls autoPlay src={result.audioUrl} className="w-full" /> : null}
    </div>
  );
}

function CheckForm({
  id,
  label,
  placeholder,
  defaultValue,
  button,
  disabledReason,
  run,
}: {
  id: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  button: string;
  disabledReason?: string;
  run: (value: string) => Promise<IntegrationCheckResult>;
}) {
  const [value, setValue] = useState(defaultValue);
  const [result, setResult] = useState<IntegrationCheckResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => setResult(await run(value)));
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit} data-testid={`${id}-check`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="min-w-0 flex-1"
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          disabled={!!disabledReason}
        />
        <Button type="submit" disabled={pending || !!disabledReason}>
          {pending ? "Checking…" : button}
        </Button>
      </div>
      {disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
      <Result id={id} result={result} />
    </form>
  );
}

function CheckButton({
  id,
  label,
  button,
  disabledReason,
  run,
}: {
  id: string;
  label: string;
  button: string;
  disabledReason?: string;
  run: () => Promise<IntegrationCheckResult>;
}) {
  const [result, setResult] = useState<IntegrationCheckResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2" data-testid={`${id}-check`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          variant="outline"
          disabled={pending || !!disabledReason}
          onClick={() => startTransition(async () => setResult(await run()))}
        >
          {pending ? "Checking…" : button}
        </Button>
      </div>
      {disabledReason ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
      <Result id={id} result={result} />
    </div>
  );
}

/**
 * Messages that name environment variables come from the server page, so no
 * server-only variable name ends up in browser JavaScript (npm run check:bundle).
 */
export function IntegrationsPanel({
  disabledReasons,
}: {
  disabledReasons: { elevenlabs?: string; n8n?: string; firecrawl?: string };
}) {
  return (
    <div className="flex flex-col gap-8">
      <CheckForm
        id="elevenlabs"
        label="ElevenLabs: speak a short line (costs credits per character)"
        placeholder="Text to speak"
        defaultValue="Hello from GreatUniHack."
        button="Speak"
        disabledReason={disabledReasons.elevenlabs}
        run={checkElevenLabs}
      />
      <CheckButton
        id="elevenlabs-usage"
        label="ElevenLabs: credits left this month (free)"
        button="Check credits"
        disabledReason={disabledReasons.elevenlabs}
        run={checkElevenLabsUsage}
      />
      <CheckButton
        id="n8n"
        label="n8n: send one test event to the workflow"
        button="Send test event"
        disabledReason={disabledReasons.n8n}
        run={checkN8n}
      />
      <CheckForm
        id="firecrawl"
        label="Firecrawl: scrape one page as markdown (costs 1 credit)"
        placeholder="https://example.com"
        defaultValue="https://example.com"
        button="Scrape"
        disabledReason={disabledReasons.firecrawl}
        run={checkFirecrawl}
      />
      <CheckForm
        id="github"
        label="GitHub: look up a public repository (free, no token needed)"
        placeholder="owner/repo"
        defaultValue="vercel/next.js"
        button="Look up"
        run={checkGitHub}
      />
    </div>
  );
}
