import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  runDiagnostics,
  type CheckStatus,
} from "@/features/dev-smoke/diagnostics";

const BADGE: Record<
  CheckStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  pass: { label: "OK", variant: "secondary" },
  warn: { label: "Note", variant: "outline" },
  fail: { label: "Problem", variant: "destructive" },
};

export default async function DiagnosticsPage() {
  const checks = await runDiagnostics();

  return (
    <>
      <PageHeader
        title="Service status"
        description="Runs once each time this page loads. No credentials are shown."
      />
      <ul className="flex flex-col divide-y rounded-xl border" data-testid="diagnostics">
        {checks.map((check) => (
          <li
            key={check.name}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
            data-check={check.name}
            data-status={check.status}
          >
            <span className="w-24 font-medium">{check.name}</span>
            <Badge variant={BADGE[check.status].variant}>
              {BADGE[check.status].label}
            </Badge>
            <span className="min-w-48 flex-1 text-sm text-pretty text-muted-foreground">
              {check.detail}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
