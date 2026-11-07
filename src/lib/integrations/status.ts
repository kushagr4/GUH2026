import "server-only";
import { elevenLabsStatus } from "./elevenlabs";
import type { EnvSource, IntegrationStatus } from "./env";
import { firecrawlStatus } from "./firecrawl";
import { githubStatus } from "./github";
import { n8nStatus } from "./n8n";

/**
 * Every optional integration, for /dev/integrations and the diagnostics page.
 * Reads environment variables only: no network, no cost. Add new ones here.
 */
export function getIntegrationStatuses(env: EnvSource = process.env): IntegrationStatus[] {
  return [elevenLabsStatus(env), n8nStatus(env), firecrawlStatus(env), githubStatus(env)];
}
