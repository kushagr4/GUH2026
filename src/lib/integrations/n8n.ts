import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  isHostedRuntime,
  isLocalUrl,
  readIntegrationEnv,
  type EnvSource,
  type IntegrationEnv,
  type IntegrationStatus,
} from "./env";
import { IntegrationError } from "./errors";
import { createApiClient, type ApiClient, type ApiClientOptions } from "./http";

/**
 * n8n workflows, started through a Webhook node that uses Header Auth.
 * OPTIONAL: off until N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET are set.
 *
 * Preferred pattern: set the Webhook node to respond with a "Respond to Webhook"
 * node, so the result comes back in the same request and the app saves it as the
 * signed-in user, under RLS. Never give n8n the Supabase secret key.
 * https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
 */
const NAME = "n8n";

/** The header the Webhook node's Header Auth credential checks. */
export const N8N_SECRET_HEADER = "X-N8N-Secret";

export const N8N_ENV = {
  // https, or http://localhost:5678 for a local `npx n8n`.
  webhookUrl: { name: "N8N_WEBHOOK_URL", url: true },
  webhookSecret: {
    name: "N8N_WEBHOOK_SECRET",
    pattern: /^\S{16,}$/,
    hint: "be at least 16 characters with no spaces",
  },
  callbackSecret: {
    name: "N8N_CALLBACK_SECRET",
    required: false,
    pattern: /^\S{16,}$/,
    hint: "be at least 16 characters with no spaces",
  },
} as const;

/**
 * The env check, plus one rule it can't know: a hosted deployment can't reach
 * an n8n running on someone's laptop.
 */
function readN8nConfig(env: EnvSource): IntegrationEnv<typeof N8N_ENV> {
  const config = readIntegrationEnv(N8N_ENV, env);
  if (config.state === "ready" && isLocalUrl(config.values.webhookUrl) && isHostedRuntime(env)) {
    return {
      state: "invalid",
      reason:
        "N8N_WEBHOOK_URL points at localhost, which a hosted deployment can't reach. Use an n8n Cloud production URL here, or demo from the laptop that runs n8n.",
    };
  }
  return config;
}

export type TriggerOptions<Schema extends z.ZodType> = {
  /** Validates what a "Respond to Webhook" node sends back. */
  schema?: Schema;
  /** Defaults to 30 seconds. The n8n Cloud trial stops executions at 180 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type N8nClient = {
  /**
   * Starts the workflow with `{ event, sentAt, payload }`. Not retried, because
   * a retry could run the workflow twice.
   */
  trigger<Schema extends z.ZodType = z.ZodUnknown>(
    event: string,
    payload: Record<string, unknown>,
    options?: TriggerOptions<Schema>,
  ): Promise<z.infer<Schema>>;
};

export function createN8nClient(
  config: { webhookUrl: string; secret: string } & Pick<ApiClientOptions, "fetch" | "sleep">,
): N8nClient {
  const url = new URL(config.webhookUrl);
  const api: ApiClient = createApiClient({
    integration: NAME,
    baseUrl: url.origin,
    headers: { [N8N_SECRET_HEADER]: config.secret },
    secrets: [config.secret],
    timeoutMs: 30_000,
    rateLimits: [{ limit: 30, windowMs: 60_000 }],
    maxConcurrent: 5,
    fetch: config.fetch,
    sleep: config.sleep,
  });

  return {
    async trigger<Schema extends z.ZodType = z.ZodUnknown>(
      event: string,
      payload: Record<string, unknown>,
      options: TriggerOptions<Schema> = {},
    ): Promise<z.infer<Schema>> {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(event)) {
        throw new IntegrationError(NAME, "bad_request", "n8n: event names are letters, digits, . _ or -");
      }
      const result = await api.request({
        method: "POST",
        path: `${url.pathname}${url.search}`,
        body: { event, sentAt: new Date().toISOString(), payload },
        schema: options.schema ?? z.unknown(),
        // "Respond Immediately" replies "Workflow got started", which may not be JSON.
        acceptText: true,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      return result as z.infer<Schema>;
    },
  };
}

let cached: { key: string; client: N8nClient } | undefined;

/** The shared client. Throws a not_configured IntegrationError until both variables are set. */
export function getN8n(env: EnvSource = process.env): N8nClient {
  const config = readN8nConfig(env);
  if (config.state !== "ready") {
    throw new IntegrationError(NAME, "not_configured", `n8n is ${config.state}: ${config.reason}`);
  }
  const { webhookUrl, webhookSecret } = config.values;
  const key = [webhookUrl, webhookSecret].join("|");
  if (cached?.key !== key) {
    cached = { key, client: createN8nClient({ webhookUrl, secret: webhookSecret }) };
  }
  return cached.client;
}

/**
 * For a route that n8n calls back (an HTTP Request node sending
 * `Authorization: Bearer <N8N_CALLBACK_SECRET>`). Constant-time comparison.
 * Returns false when no callback secret is configured.
 */
export function isAuthorizedN8nCallback(request: Request, env: EnvSource = process.env): boolean {
  const config = readN8nConfig(env);
  const expected = config.state === "ready" ? config.values.callbackSecret : undefined;
  const header = request.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(expected));
}

function describeWebhook(webhookUrl: string, callbackSecret: string | undefined): string {
  const url = new URL(webhookUrl);
  const where = isLocalUrl(webhookUrl)
    ? `Webhook on ${url.host}, on this machine only: a hosted deployment can't reach it.`
    : `Webhook on ${url.host}.`;
  const testUrl = url.pathname.includes("/webhook-test/")
    ? " This is a test URL, which only works while the n8n editor is listening. Use the production URL for the demo."
    : "";
  const callbacks = callbackSecret ? " Callbacks are accepted." : " No callback secret, so callbacks are refused.";
  return `${where}${testUrl}${callbacks}`;
}

export function n8nStatus(env: EnvSource = process.env): IntegrationStatus {
  const config = readN8nConfig(env);
  return {
    id: "n8n",
    name: NAME,
    state: config.state,
    detail:
      config.state === "ready"
        ? describeWebhook(config.values.webhookUrl, config.values.callbackSecret)
        : config.state === "off"
          ? "Off (optional). Set N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET to turn it on."
          : config.reason,
    variables: Object.values(N8N_ENV).map((spec) => spec.name),
    docs: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/",
  };
}
