# Live verification: ElevenLabs and n8n

How to prove each integration works for real, from the machine and network you'll demo from, without exposing credentials or spending unexpectedly. It takes about 10 minutes. It assumes the team already has an account with the sponsor; nothing here creates accounts or changes plans.

The automated tests never call these services: unit tests use a fake `fetch`, and the E2E servers blank every integration variable. These checks are the only live calls.

## Ground rules

- **Keys live only in `.env.local`**, or in the hosting platform's environment settings. Never in Git, chat, AI sessions, terminal arguments or screenshots. `/dev/integrations` shows variable names, never values.
- **Don't add a card** to the ElevenLabs or n8n account. Without a payment method, a Free plan or trial has nothing to charge.
- **Run the checks in the demo environment.** `/dev/integrations` says where its checks run from, for example "This machine, development server". Network, IP and reachability all differ between a laptop on venue Wi-Fi, a phone hotspot and a hosted deployment.
- **Know the cost of each button:**

| Button | Cost |
| --- | --- |
| **Speak** | About 25 characters of ElevenLabs credit |
| **Check credits** | Free |
| **Send test event** | One n8n execution |

  All the checks share a limit of 5 presses a minute per user, and ElevenLabs is capped at 5,000 characters a day per server.

## 0. Choose the demo environment first

| Where the demo runs | ElevenLabs | n8n |
| --- | --- | --- |
| **Laptop**, `npm run dev`, ideally on a phone hotspot | Works | Works with a local `npx n8n` or n8n Cloud |
| **Hosted deployment**, such as Vercel | Works, and calls come from the host's IP | **Cloud only.** A hosted server can't reach `npx n8n` on a laptop |

**No hosted deployment exists yet.** If you choose one, follow [deployment.md](deployment.md) first, which needs the team's own Vercel account. Then do section 3.

## 1. ElevenLabs text-to-speech

**Before you start:**
- The key is restricted to the endpoints you use (text-to-speech, plus voices and user read if wanted) and **has a credit limit**, for example 1,000.
- **Don't set an IP allowlist** unless you know the demo IP, because other IPs get a 403.

1. Add `ELEVENLABS_API_KEY=` and the key to `.env.local`, then restart `npm run dev`.
2. Sign in, and open `/dev/integrations`. The **ElevenLabs** row should say **Ready**, with the model `eleven_flash_v2_5` and the daily allowance.
3. Press **Check credits**, and note the number left. If the message says the credentials were rejected, the key isn't allowed to read the user. That's fine: skip steps 3 and 5.
4. Press **Speak**, keeping the default "Hello from GreatUniHack." (24 characters). **Pass:** audio plays, and the result reads "24 characters, … KB of audio/mpeg".
5. Press **Check credits** again. **Pass:** the balance dropped by about 24 or less, and nothing more.

The whole check uses under 50 of the plan's 10,000 monthly credits.

| Message | Cause | What to do |
| --- | --- | --- |
| "ElevenLabs is not set up on this server." | The key isn't loaded | Check the variable name, then restart the server |
| "ElevenLabs rejected this server's credentials." | Wrong key, a missing endpoint permission, or an IP not on the key's allowlist | Fix the key's restrictions on the dashboard |
| **"ElevenLabs has paused free-tier use for this account or network."** | **ElevenLabs' shared-IP abuse block** | **Stop.** Don't create more accounts. The help page says a flagged Free account can't be unblocked, so ask the ElevenLabs sponsor for help or a code |
| "ElevenLabs has run out of free usage for now." | Out of credits, or the key's limit was reached | Raise the key's limit, within the free credits |
| "ElevenLabs is busy. Try again…" | More than 2 requests at once | Wait a few seconds |
| "Today's speech allowance on this server is used up." | Our own daily cap | Raise `ELEVENLABS_MAX_CHARACTERS_PER_DAY` |

## 2. n8n webhook execution

**Build a test-safe workflow first.** The test event then costs one execution and triggers nothing else.

1. Add a **Webhook** node with these settings:
   - HTTP Method **POST** and a path such as `guh2026`.
   - Authentication **Header Auth**, with a credential whose **Name** is `X-N8N-Secret` and whose **Value** is a long random string.
   - Respond **Using 'Respond to Webhook' Node**.

   To make the string, run this in your own terminal, and paste the result only into the n8n credential and `.env.local`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. Add an **If** node that checks whether `{{ $json.body.event }}` equals `guh2026.test`.
   - **True:** a **Respond to Webhook** node returning JSON `{ "ok": true, "test": true }`.
   - **False:** the real steps, ending in their own Respond to Webhook node.
3. **Publish** the workflow. n8n registers the production URL only when it's published. Copy the **Production URL**, which contains `/webhook/`, not `/webhook-test/`.

**The check:**

1. Add `N8N_WEBHOOK_URL` (the production URL) and `N8N_WEBHOOK_SECRET` (the same string) to `.env.local`, then restart.
2. On `/dev/integrations`, the **n8n** row should say **Ready**, without a test-URL warning. For a local n8n, it also says "on this machine only".
3. Press **Send test event**. **Pass:** "Workflow accepted the event", with `Reply: {"ok":true,"test":true}`.
4. In n8n, open the workflow's **Executions** tab. **Pass:** one successful run that took the test branch.
5. **Optional, to prove the webhook is locked:**
   - Change `N8N_WEBHOOK_SECRET` to a wrong value, restart, and press **Send test event**.
   - **Pass:** it fails with "n8n rejected this server's credentials."
   - Restore the real value, and restart again.

| Message | Cause | What to do |
| --- | --- | --- |
| "n8n could not find that." | The workflow isn't published, the URL is wrong, or it's a test URL with nobody listening | Publish the workflow, and use the production URL |
| "n8n rejected this server's credentials." | The header name or value doesn't match | The header must be named `X-N8N-Secret` and match `N8N_WEBHOOK_SECRET` exactly |
| "Could not reach n8n." | n8n isn't running, or the host is wrong | Start `npx n8n`, or check the Cloud URL |
| "n8n took too long to respond." | The workflow took over 30 seconds before replying | Respond earlier, or pass a longer `timeoutMs` |
| A **Problem** badge saying it "points at localhost" | A hosted deployment with a local n8n URL | Use an n8n Cloud production URL |

## 3. From a hosted deployment (only if you'll demo from one)

`/dev` is hidden in production, so turn it on briefly:

1. In the host's environment settings, set:
   - the two public Supabase values
   - `ELEVENLABS_API_KEY`
   - `N8N_WEBHOOK_URL` (**an n8n Cloud production URL**: a `localhost` URL is refused on hosting platforms)
   - `N8N_WEBHOOK_SECRET`
   - `ENABLE_DEV_TOOLS=true`
2. Deploy, sign in, and open `/dev/integrations`. It should say "Checks run from: Hosted on Vercel (production, …)".
3. Run sections 1 and 2 there. The pass criteria are the same.
4. **Remove `ENABLE_DEV_TOOLS`, and redeploy, before judging.**

**Limitations:**
- **A local `npx n8n` is not reachable from any hosted deployment.** n8n's built-in tunnel needs Docker, which we don't use, and we never expose a laptop to the internet. If n8n must be local, demo from that laptop.
- Hosted ElevenLabs calls come from the host's IP rather than the venue's. That avoids the venue Wi-Fi, but hosting IPs are shared too, and whether ElevenLabs treats them as "unusual activity" is only known once you test.

## Go/no-go

Only one sponsor challenge can be entered, so only the chosen one has to be **go**. The other is optional.

**ElevenLabs is go when all of these are true:**
- [ ] There's one team account, with no card on it.
- [ ] The key is restricted to the endpoints you use, and has a credit limit. It has no IP allowlist, unless the demo IP is on it.
- [ ] `/dev/integrations` says **Ready**, checked from the demo environment.
- [ ] **Speak** plays audio, and credits dropped by about the characters spoken.
- [ ] No "paused free-tier use" message has appeared.
- [ ] Fallback audio for the demo has been generated and saved, in case the account is blocked mid-demo.

**n8n is go when all of these are true:**
- [ ] n8n runs where the demo app can reach it: n8n Cloud for a hosted demo, or on the same laptop for a local demo.
- [ ] The workflow is **published**, and its production URL is configured, with no test-URL warning and no localhost **Problem**.
- [ ] The Webhook node uses Header Auth, and a wrong secret is rejected.
- [ ] **Send test event** returns `{"ok":true,"test":true}`, and the Executions tab shows it.
- [ ] The test branch has no side effects.
- [ ] There's a fallback: a screenshot or recording of a successful execution.

**No-go** on any box means fix it, fall back, or use the other sponsor.

## Afterwards

- Turn `ENABLE_DEV_TOOLS` off on any deployment.
- Note the credits left.
- Revoke any key that was shared, once the event ends.
