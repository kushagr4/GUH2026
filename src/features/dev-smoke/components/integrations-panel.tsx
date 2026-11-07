"use client";

import { useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkFirecrawl,
  checkGitHub,
  type IntegrationCheckResult,
} from "../integration-actions";

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
      {disabledReason ? (
        <p className="text-sm text-muted-foreground">{disabledReason}</p>
      ) : null}
      {result?.ok === false ? <FormMessage variant="error">{result.message}</FormMessage> : null}
      {result?.ok ? (
        <ul className="flex flex-col gap-1 text-sm break-words" data-testid={`${id}-result`}>
          {result.lines.map((line, index) => (
            <li key={index} className={index === 0 ? "font-medium" : "text-muted-foreground"}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/**
 * Messages that name environment variables come from the server page, so no
 * server-only variable name ends up in browser JavaScript (npm run check:bundle).
 */
export function IntegrationsPanel({ firecrawlDisabledReason }: { firecrawlDisabledReason?: string }) {
  return (
    <div className="flex flex-col gap-8">
      <CheckForm
        id="github"
        label="GitHub: look up a public repository (free, no token needed)"
        placeholder="owner/repo"
        defaultValue="vercel/next.js"
        button="Look up"
        run={checkGitHub}
      />
      <CheckForm
        id="firecrawl"
        label="Firecrawl: scrape one page as markdown (costs 1 credit)"
        placeholder="https://example.com"
        defaultValue="https://example.com"
        button="Scrape"
        disabledReason={firecrawlDisabledReason}
        run={checkFirecrawl}
      />
    </div>
  );
}
