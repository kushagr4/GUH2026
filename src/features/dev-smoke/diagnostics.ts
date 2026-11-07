import "server-only";
import { getAiConfig } from "@/lib/ai/config";
import { readSupabaseEnv } from "@/lib/env";
import { getIntegrationStatuses } from "@/lib/integrations/status";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type CheckStatus = "pass" | "warn" | "fail";

export type DiagnosticCheck = {
  name: string;
  status: CheckStatus;
  /** Must never include a key, token or password. */
  detail: string;
};

const TIMEOUT_MS = 5000;

async function timed<T>(run: () => PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await run();
  return { value, ms: Date.now() - started };
}

/**
 * Runs once per page view and never polls, so it stays cheap on the free plan.
 * Everything here uses the publishable key plus the visitor's own session.
 */
export async function runDiagnostics(): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const env = readSupabaseEnv();

  if (env.state !== "ok") {
    return [{ name: "Environment", status: "fail", detail: env.reason }];
  }

  checks.push({
    name: "Environment",
    status: "pass",
    detail: `Project host: ${new URL(env.url).host}. Publishable key is set.`,
  });

  checks.push(
    process.env.SUPABASE_SECRET_KEY
      ? {
          name: "Secret key",
          status: "warn",
          detail:
            "SUPABASE_SECRET_KEY is set on this server. That is fine for the migration owner but not needed for normal development.",
        }
      : {
          name: "Secret key",
          status: "pass",
          detail: "Not set, as expected for normal development.",
        },
  );

  try {
    const { value: response, ms } = await timed(() =>
      fetch(`${env.url}/auth/v1/health`, {
        headers: { apikey: env.publishableKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }),
    );
    checks.push({
      name: "Auth",
      status: response.ok ? "pass" : "fail",
      detail: response.ok
        ? `Healthy (${ms} ms).`
        : `Returned HTTP ${response.status}. The project may be paused.`,
    });
  } catch {
    checks.push({
      name: "Auth",
      status: "fail",
      detail: "Could not reach Supabase. Check your network, or whether the project is paused.",
    });
    return checks;
  }

  const user = await getCurrentUser();
  checks.push({
    name: "Session",
    status: user ? "pass" : "warn",
    detail: user ? `Signed in, user ${user.id.slice(0, 8)}…` : "Not signed in.",
  });

  const supabase = await createClient();

  const database = await timed(() =>
    supabase.from("dev_smoke_records").select("id", { count: "exact", head: true }),
  );
  const { error: dbError, count, status: dbStatus } = database.value;
  if (!dbError) {
    checks.push({
      name: "Database",
      status: "pass",
      detail: `Connected (${database.ms} ms). You own ${count ?? 0} smoke record(s).`,
    });
  } else if (!user && (dbStatus === 401 || dbError.code === "42501")) {
    checks.push({
      name: "Database",
      status: "pass",
      detail: `Connected (${database.ms} ms). Anonymous access was refused, as it should be.`,
    });
  } else if (dbError.code === "PGRST205") {
    checks.push({
      name: "Database",
      status: "fail",
      detail: "Connected, but the smoke table is missing. The migration owner needs to run npm run db:push.",
    });
  } else {
    checks.push({
      name: "Database",
      status: "fail",
      detail: `Query failed (HTTP ${dbStatus}${dbError.code ? `, ${dbError.code}` : ""}).`,
    });
  }

  const storage = await timed(() =>
    supabase.storage.from("dev-smoke-private").list(user?.id ?? "", { limit: 1 }),
  );
  checks.push(
    storage.value.error
      ? {
          name: "Storage",
          status: "fail",
          detail: "The smoke bucket could not be read. Have migrations been applied?",
        }
      : {
          name: "Storage",
          status: "pass",
          detail: `Reachable (${storage.ms} ms).`,
        },
  );

  checks.push({
    name: "Realtime",
    status: "warn",
    detail: "Checked in the browser. Open the Realtime tab to test it.",
  });

  const ai = getAiConfig();
  checks.push(
    ai.mode === "disabled"
      ? {
          name: "AI",
          status: "warn",
          detail: "Off. Set ANTHROPIC_API_KEY, or AI_PROVIDER=mock for a demo.",
        }
      : {
          name: "AI",
          status: "pass",
          detail: ai.mode === "mock" ? "Mock provider (no network, no cost)." : `Key is set. Model: ${ai.model}.`,
        },
  );

  // Environment variables only, so this costs nothing.
  const integrations = getIntegrationStatuses();
  const broken = integrations.filter((integration) => integration.state === "invalid");
  checks.push({
    name: "Integrations",
    status: broken.length ? "warn" : "pass",
    detail: broken.length
      ? `Needs attention: ${broken.map((integration) => integration.name).join(", ")}. Open the Integrations tab.`
      : integrations
          .map((integration) => `${integration.name}: ${integration.state === "ready" ? "ready" : "off"}`)
          .join(". ") + ".",
  });

  return checks;
}
