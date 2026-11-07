# Hackathon day: GreatUniHack 2026

## Schedule

From [greatunihack.com](https://greatunihack.com), checked 5 November 2026. The site says times may change, so check again on the day.

| Saturday 7 November | |
| --- | --- |
| 09:00 | Check-in opens |
| **10:30** | **Check-in closes** |
| 11:00 to 12:00 | Opening ceremony |
| **12:00** | **Hacking begins** |
| 16:00 | Submissions open |
| **18:00** | **Submissions close. No late submissions** |
| 18:30 to 20:00 | Judging |

**That is 6 hours of building.** Plan to have a demo by 16:00, and use the last 2 hours for polish and the write-up. Some third-party listings describe a 30+ hour event, but the official schedule above is what counts.

**Rules:** the team's confirmation from the organisers is that prewritten boilerplate is allowed. The public site still says teams "build a project from scratch", so keep that confirmation to hand, and mention in your submission that you started from this foundation.

## The day before

Migration owner:

```bash
npm run db:status
```

This compares the migration files with the hosted project's history, so it also shows the project is reachable. (`npm run health` checks whichever project `.env.local` points at, which is now usually your local one.)

- Sign in to the Supabase dashboard, and confirm the project is active. Free projects pause after a week without activity.
- Create one demo account per teammate through `/signup`, and record them somewhere private.
- Add teammates' GitHub accounts to the repo. They don't need any Supabase values: each runs local Supabase. The hosted URL and publishable key go only into Vercel.

Everyone:

```bash
git pull
```

```bash
npm ci
```

```bash
npm run local:up
```

```bash
npm run local:status
```

`local:up` downloads about 1.3 GB of Docker images the first time, so do it at home, not on venue Wi-Fi. Also run `npx playwright install chromium` while you're on good Wi-Fi if you'll run E2E tests.

## 10:30 to 12:00: at the venue

Everyone, on the venue network:

```bash
npm run doctor
```

- During the opening ceremony, fill in the judging checklist in [sponsor-strategy.md](sponsor-strategy.md) and score the decision matrix. Decide on a sponsor by 12:15.
- Redeem any sponsor credits or codes before 12:00, then turn the sponsor on at `/dev/integrations`. ElevenLabs and n8n are confirmed prizes, but a team may enter **only one** sponsor challenge. Run the chosen one's live check in [live-verification.md](live-verification.md) before 13:00.
- **ElevenLabs:** only one teammate creates a Free account. Free accounts sharing the venue's IP can be blocked for good, so test from one machine, ideally on a phone hotspot.
- Agree the idea, who owns which feature, and who is presenting.
- Confirm who the migration owner is.

## 12:00: start building

1. **Rename the product** in `src/config/site.ts`. That's the name, description and navigation.
2. **Agree the data model** together, quickly. One person writes the first migration:

```bash
npm run db:new -- core_tables
```

3. **Apply it.** Open a PR. Once the relevant migration PR has passed necessary checks and the human owner has merged it, the owner runs:

```bash
npm run db:plan
```

```bash
npm run db:push
```

```bash
npm run db:types
```

   Then the owner opens a quick PR with the regenerated types, as in [team-workflow.md](team-workflow.md#changing-the-schema).

4. **Build features in parallel:**
   - Pages go in `src/app/app/<feature>/`, which is protected automatically.
   - Code goes in `src/features/<feature>/`. Copy `src/features/account/` as the pattern.
   - Add navigation in `src/config/site.ts`.

Ask Claude Code to do this directly. `CLAUDE.md` tells it the conventions and security rules, and it follows `/feature-dev`: implement on an owned branch, run focused tests, open a normal PR and continue. No mandatory Claude or teammate review.

## Building blocks

| You need | Use |
| --- | --- |
| Current user | `requireUser()` in `@/lib/supabase/auth` |
| Database access | `createClient()` in `@/lib/supabase/server`, with a repository function |
| Pagination | `toPageRange` in `@/lib/db/pagination` |
| Live updates | `useTableChanges` in `@/lib/realtime/use-table-changes` |
| File upload | `validateUpload` and `ownerObjectPath` in `@/lib/storage/uploads`, with the `user-uploads` bucket. See `storage-panel.tsx` for the pattern |
| AI (streaming) | `streamChat` in `@/lib/ai/client`, which calls `/api/ai/chat` |
| AI (on the server) | `getAiProvider()` in `@/lib/ai`, with `generateText` or `generateObject` |
| More UI | `npx shadcn@4.23.0 add <component>` |

### Setting up AI

Add this to `.env.local`, and restart. The key stays on the server:

```dotenv
ANTHROPIC_API_KEY=your-key-here
```

Use `AI_PROVIDER=mock` for UI work with no network and no cost. Set a spending limit in the Anthropic Console before sharing a key across the team.

## During hacking

Commands you'll use most:

| Situation | Command |
| --- | --- |
| Is it the backend or my code? | Open `/dev`, or run `npm run local:status` |
| Before a final integration or demo handoff | `npm run preflight` (or report CI and any unavailable steps) |
| New table or column | `npm run db:new -- <name>` |
| Migration status (owner) | `npm run db:status` |
| Security check (owner) | `npm run db:audit` |

Working practices:

- Small PRs, merged often. `main` stays demoable. No mandatory Claude self-review or teammate approval. The human repo owner merges when relevant CI and functional checks are satisfactory. See [development-workflow.md](development-workflow.md).
- Schema changes are additive, and go through the owner. See [team-workflow.md](team-workflow.md).
- If something's broken for everyone, check `/dev` first, then the Supabase dashboard.
- Avoid late, risky changes. Freeze features at about 17:00.

## 16:00: demo ready

- Merge what works.
- Deploy if you want a public URL. See [deployment.md](deployment.md). Otherwise, demo from a laptop.
- Start the submission write-up.

## 17:00: freeze

Run on the machine you'll present from:

```bash
npm run validate
```

```bash
npm run build
```

```bash
npm run start
```

- Sign in with the demo account, and walk through the demo twice. Stay signed in.
- Have a backup: record a short video of the demo working, and keep a phone hotspot available.
- If the demo uses AI, have `AI_PROVIDER=mock` ready as a fallback.

## 18:00: submit

**Submit early.** There are no late submissions. Mention that you started from this foundation, and make sure no credentials are in the repo if you make it public:

```bash
npm run secrets:scan
```

## If something goes wrong

| Problem | Fix |
| --- | --- |
| Supabase unreachable | Check [status.supabase.com](https://status.supabase.com), the project's dashboard, and your network. Try a phone hotspot |
| Sign-ups fail | See the free-plan guide: confirm "Confirm email" is off, and use a demo account if rate limited |
| Venue Wi-Fi fails | Use a phone hotspot. Everything else needs only a connection to Supabase |
| `npm install` fails | Use a teammate's hotspot, or copy `node_modules` from a teammate's machine with the same OS |
| AI failing during the demo | Set `AI_PROVIDER=mock`, restart, and say it's the offline mode |
| Migration failed | Don't improvise on the shared database. Read the error, fix it in a new file, and run it through `db:plan` |
| Bad migration applied | Write a forward fix. There's no reset |
