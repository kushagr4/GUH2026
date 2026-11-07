import "server-only";
import type { EnvSource, IntegrationStatus } from "./env";
import { firecrawlStatus } from "./firecrawl";
import { githubStatus } from "./github";

/**
 * Every optional integration, for /dev/integrations and the diagnostics page.
 * Reads environment variables only: no network, no cost. Add new ones here.
 */
export function getIntegrationStatuses(env: EnvSource = process.env): IntegrationStatus[] {
  return [firecrawlStatus(env), githubStatus(env)];
}
