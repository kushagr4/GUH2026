import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { readSupabaseEnv } from "@/lib/env";

/** Renders nothing when Supabase is configured. */
export function NotConfiguredNotice() {
  const env = readSupabaseEnv();
  if (env.state === "ok") return null;

  return (
    <Alert data-testid="not-configured">
      <AlertTitle>Supabase is not connected yet</AlertTitle>
      <AlertDescription>
        {env.reason} Copy <code>.env.example</code> to <code>.env.local</code>,
        fill in the shared values, then restart <code>npm run dev</code>.
      </AlertDescription>
    </Alert>
  );
}
