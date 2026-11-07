import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { IntegrationsPanel } from "@/features/dev-smoke/components/integrations-panel";
import { describeRuntime, type IntegrationStatus } from "@/lib/integrations/env";
import { getIntegrationStatuses } from "@/lib/integrations/status";
import { requireUser } from "@/lib/supabase/auth";

const BADGE: Record<
  IntegrationStatus["state"],
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  ready: { label: "Ready", variant: "secondary" },
  off: { label: "Off", variant: "outline" },
  invalid: { label: "Problem", variant: "destructive" },
};

export default async function DevIntegrationsPage() {
  await requireUser();
  const statuses = getIntegrationStatuses();
  const ready = (id: string) => statuses.some((status) => status.id === id && status.state === "ready");
  const restart = "in .env.local and restart the server to try this.";
  const disabledReasons = {
    elevenlabs: ready("elevenlabs") ? undefined : `Set ELEVENLABS_API_KEY ${restart}`,
    n8n: ready("n8n") ? undefined : `Set N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET ${restart}`,
    firecrawl: ready("firecrawl") ? undefined : `Set FIRECRAWL_API_KEY ${restart}`,
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Optional external APIs. Configuration is read from server environment variables, and no values are shown."
      />
      <p className="text-sm text-muted-foreground" data-testid="runtime">
        Checks run from: <span className="font-medium text-foreground">{describeRuntime()}</span>. Run
        them from the environment you will demo from, because network, IP and reachability differ.
      </p>
      <ul className="flex flex-col divide-y rounded-xl border" data-testid="integrations">
        {statuses.map((status) => (
          <li
            key={status.id}
            className="flex flex-col gap-1 px-4 py-3"
            data-integration={status.id}
            data-state={status.state}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{status.name}</span>
              <Badge variant={BADGE[status.state].variant}>{BADGE[status.state].label}</Badge>
              <a
                className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline"
                href={status.docs}
                target="_blank"
                rel="noreferrer"
              >
                Docs
              </a>
            </div>
            <p className="text-sm text-pretty text-muted-foreground">{status.detail}</p>
            <p className="font-mono text-xs text-muted-foreground">{status.variables.join(", ")}</p>
          </li>
        ))}
      </ul>
      <IntegrationsPanel disabledReasons={disabledReasons} />
    </>
  );
}
