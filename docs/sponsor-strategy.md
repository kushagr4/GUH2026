# Sponsor strategy

How to pick sponsor technology quickly, and three project concepts ready to adapt to the theme. The facts behind every score are in [sponsor-comparison.md](sponsor-comparison.md), checked 7 November 2026.

## 1. What is confirmed, and what isn't

| Status | What | Source |
| --- | --- | --- |
| **Confirmed prize** | **Best Use of ElevenLabs** | GreatUniHack's Devpost page, as reported by the team. Devpost blocks automated reads, so this repo couldn't open it. ElevenLabs is on the official sponsor list |
| **Confirmed prize** | **Best Use of n8n** | As above. n8n is on the official sponsor list |
| **Confirmed prize** | Overall: £3,500 for the top three teams (£1,750, £1,050, £700) | [greatunihack.com](https://greatunihack.com/) |
| Sponsor, prize unknown | Firecrawl, Lovable, GitHub, Anthropic, and others | Official sponsor list. The site says challenge tracks are revealed at the opening ceremony |
| **Speculative** | Any Firecrawl, Lovable, GitHub or Anthropic prize | Not announced. Plan for them only as a bonus |

**So the plan is:** build around ElevenLabs and n8n, which are both confirmed, and make sure the project can still win overall. Add a speculative sponsor only if the opening ceremony announces a prize for it. Anthropic is already our AI provider (`src/lib/ai`), so a Claude track would cost nothing extra.

**Decide by 12:15.** Use the checklist during the ceremony, then the matrix.

## 2. Judging criteria checklist

- [ ] **Each prize's rules:** what "best use" means to that sponsor. Is the technology a core feature or just present? Is there a minimum, such as an API call, a published workflow or a video showing it? Does the team need to register with the sponsor? Can one project enter several tracks?
- [ ] **Criteria and weighting:** innovation, technical depth, use of the sponsor technology, design, impact, presentation. Note the order each sponsor mentions them in.
- [ ] **Submission:** the Devpost fields, video, public repo, deployed URL, "built with" tags, and the deadline (18:00, with **no late submissions**).
- [ ] **Free credits or codes:** ElevenLabs and n8n sponsors often hand them out. Redeem them before 12:00. Check that a code needs no card before using it, because we use no paid services.
- [ ] **Constraints:** venue Wi-Fi (see the ElevenLabs IP warning below), accounts judges will need, and whether a live demo is required.
- [ ] **What impresses each sponsor:** ask their mentor directly, for example "what would you love to see built with this?".
- [ ] **Our rules:** the starter is disclosed in the submission (see [hackathon-day.md](hackathon-day.md)). Nothing may depend on a paid tier.

## 3. Decision matrix

Scores run from 1 (poor) to 5 (excellent). **Prize fit** is 5 for a confirmed prize whose criteria we can meet, and 0 when there is no prize or we can't meet its criteria. Fill in the `?` cells at the opening ceremony.

| Criterion | Weight | ElevenLabs | n8n | Firecrawl | GitHub | Lovable (separate app) | No sponsor |
| --- | ---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Prize fit** | ×4 | **5** (confirmed) | **5** (confirmed) | ? | ? | ? | 0 |
| Time to a working demo | ×3 | 4 | 3 | 4 | 5 | 4 | 5 |
| Demo impact | ×2 | 5 | 4 | 4 | 3 | 3 | 2 |
| Reliability on the day | ×2 | 2 | 3 | 3 | 4 | 3 | 5 |
| Safety for the shared database and our rules | ×2 | 5 | 4 | 5 | 5 | 3 | 5 |
| Reuse of this foundation | ×1 | 5 | 4 | 5 | 5 | 2 | 5 |
| Cost and free-tier headroom | ×1 | 3 | 4 | 4 | 5 | 2 | 5 |
| **Total before prize fit** (max 55) | | **44** | **39** | **45** | **49** | **34** | **49** |
| **Total with prize fit** (max 75) | | **64** | **59** | 45 + ? | 49 + ? | 34 + ? | 49 |

**Total = pre-scored total + 4 × prize fit.** To overtake ElevenLabs's 64:
- GitHub needs a prize fit of 4, which gives 65.
- Firecrawl needs a 5, which also gives 65.
- Lovable can't overtake it, because its maximum is 54.

Why the scores are what they are:

- **ElevenLabs:**
  - The client is ready, and voice is memorable in a demo.
  - **Reliability scores 2** because ElevenLabs can switch off Free-tier use when several Free accounts share one IP, which is exactly a hackathon venue, and its help page says that can't be reversed. Mitigations are in section 5.
  - 10,000 credits a month is enough for a demo, not for a crowd.
- **n8n:**
  - Our webhook client is ready, and the workflow canvas shows well to judges.
  - The extra setup is that n8n has no free cloud plan: either a trial with no card, or `npx n8n` running locally (no Docker).
  - It must never hold our Supabase secret key.
- **Firecrawl, GitHub, Lovable:** unchanged from the earlier research. They are only worth adding if a prize is announced.

**Best combination:** ElevenLabs and n8n together, as in Concept A. Each one is used where it's strongest, and both confirmed prizes are in play.

## 4. Project concepts

Each concept reuses auth, RLS, storage, Realtime, AI and the integration clients, and each adapts to most themes. None is built yet, deliberately.

### Concept A: Echo, voice notes that turn into actions

**Sponsors:** ElevenLabs and n8n, both confirmed. **Optional:** Anthropic.

Someone records a voice note in the browser. ElevenLabs Scribe transcribes it, and Claude pulls out the tasks, dates and people. An n8n workflow then acts on them: it posts to Discord, emails a summary or files a reminder. The app reads back a short spoken confirmation with ElevenLabs text-to-speech, and the list updates live.

- **Theme fit:** accessibility (hands-free capture), wellbeing (voice journaling), education (lecture notes into revision tasks), community (voice reports routed to the right people).
- **Sponsor depth:**
  - **ElevenLabs:** both directions, speech-to-text and text-to-speech.
  - **n8n:** real orchestration, using a webhook trigger, branching and two or more app nodes, then "Respond to Webhook" returning what it did.
- **New work:**
  - A migration for `notes (owner_id, audio_path, transcript, actions jsonb, status)` with RLS, added to Realtime.
  - The recording UI, using `MediaRecorder` and an upload to the user's own Storage folder.
  - A Server Action that calls `getElevenLabs().transcribe()`, then `generateObject` for the actions, then `getN8n().trigger("note.actions", …)` and saves the reply.
  - One n8n workflow.
- **Budget:**
  - Scribe is billed per audio hour.
  - About 20 spoken confirmations of 100 characters each use under 2,000 credits.
  - One n8n execution per note. The Cloud trial includes 1,000 executions.

| Time | Milestone |
| --- | --- |
| 12:00 | ElevenLabs key and n8n webhook working on `/dev/integrations`, migration PR merged and pushed by the owner |
| 13:30 | Record, upload and transcribe a note, then store it |
| 14:30 | Claude extracts actions, and n8n receives them and replies |
| 15:30 | Spoken confirmation, live list |
| 16:00 | **Demo ready.** Pre-record two demo notes as a fallback |
| 17:00 | Polish, a second n8n branch |
| 17:30 | Submission: a screenshot of the workflow, and where each sponsor is used |

**Demo:** speak one note live, then show it transcribed, the actions extracted, the Discord message arriving and the confirmation spoken back. **Fallbacks:**
- Pre-recorded notes.
- Cached transcripts.
- `AI_PROVIDER=mock`.
- If n8n is down, show its last execution.

### Concept B: Brief, research read aloud

**Sponsors:** ElevenLabs (confirmed). **Bonus:** Firecrawl and n8n, if announced or wanted.

Someone asks a question, for example "Which student hardship funds can I apply for?". The app gathers sources, writes a short cited briefing with Claude, and **narrates it** with ElevenLabs, so people can listen on the move. An optional n8n schedule sends a weekly audio digest.

- **Theme fit:** almost any theme with an information problem, such as wellbeing, housing, accessibility or civic life.
- **Sponsor depth:**
  - **ElevenLabs:** narration, with a voice choice from `listVoices()`.
  - **Firecrawl, if used:** `search({ withContent: true })`.
  - **n8n, if used:** a Schedule trigger that calls our API.
- **Without Firecrawl:** the user pastes links or text, and the narration remains the sponsor feature.
- **New work:**
  - A migration for `briefs (owner_id, question, sources jsonb, brief text, audio_path)`.
  - `src/features/brief/`.
  - A route handler that returns the audio, cached in Storage so each briefing is narrated once.
- **Budget:** a 1,500-character briefing is about 1,500 characters of text-to-speech, half that with Flash. Cache every narration.

**Demo:** ask one question live and play the narration. Show saved briefings for the rest.

### Concept C: Pulse, a live tracker with automated follow-up

**Sponsors:** n8n (confirmed). **Bonus:** Firecrawl or GitHub, if announced.

Users track public things that change, such as events, opening times, prices or repositories. An n8n Schedule workflow asks our API to re-check them, the app stores what changed, and the board updates live through Realtime. n8n then notifies people, and ElevenLabs can add a spoken "what changed today".

- **Sponsor depth:**
  - **n8n:** scheduling, branching and notifications.
  - **Firecrawl, if used:** `extract()` with a zod schema.
  - **GitHub, if used:** `getGitHub().request()` for repository activity.
- **New work:**
  - A migration for `tracked_items (owner_id, url, data jsonb, checked_at)`.
  - A route for n8n to call, checked with `isAuthorizedN8nCallback`, that queues re-checks.
  - The board page.
- **Note:** a callback from n8n has no user session, so writing to the database needs the admin client and careful authorisation (see [integrations.md](integrations.md)). Concept A avoids this, because n8n replies within the same request.

**Demo:** trigger the schedule by hand in n8n, and watch the board change live.

## 5. Turning a sponsor on (5 minutes each)

| Sponsor | Steps |
| --- | --- |
| **ElevenLabs** | **One** teammate creates the account. On the dashboard, create a key restricted to text-to-speech and speech-to-text, with a credit limit. Set `ELEVENLABS_API_KEY` in `.env.local`, restart, and press **Speak** on `/dev/integrations` |
| **n8n** | Start the Cloud trial (no card) or run `npx n8n` (Node 20.19 to 24, no Docker). Add a Webhook node with Header Auth: name `X-N8N-Secret`, value = `N8N_WEBHOOK_SECRET`. Copy its **production** URL into `N8N_WEBHOOK_URL`, activate the workflow, and press **Send test event** |
| Firecrawl | Only if a prize is announced. Set `FIRECRAWL_API_KEY`, then press **Scrape** |
| GitHub | Works now for public data. Set `GITHUB_API_TOKEN` for the demo |
| Lovable | Only if a prize is announced. Build in a **new** Lovable project, never connected to our Supabase |

**ElevenLabs on venue Wi-Fi:** to avoid the shared-IP block on Free accounts:
- Only one teammate should create a Free account.
- Do the ElevenLabs testing from one machine, ideally on a phone hotspot.
- Ask the ElevenLabs sponsor for a code that upgrades the account without a card. Their help page says paid accounts aren't flagged.
- If the account is flagged anyway, `/dev/integrations` shows "ElevenLabs has paused free-tier use".

**A local n8n and a deployed app:** `npx n8n` is only reachable from the same machine. Demo from the laptop that runs both, or use the Cloud trial. n8n's built-in tunnel needs Docker, so don't use it, and never expose the laptop to the internet.

**Sharing keys:** each person puts keys in their own `.env.local`, and the deployed app gets them as environment variables. Share keys through a password manager or in person, never in Git, chat or AI sessions. When the event ends, revoke any key that was shared.
