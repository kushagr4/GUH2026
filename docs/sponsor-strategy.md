# Sponsor strategy

How to pick sponsor technology quickly, and three project concepts ready to adapt to the theme. The facts behind every score are in [sponsor-comparison.md](sponsor-comparison.md), checked 7 November 2026.

## 1. What is confirmed, and what isn't

| Status | What | Source |
| --- | --- | --- |
| **Confirmed prize** | **Best Use of ElevenLabs** | The official GreatUniHack 2026 Devpost page, confirmed by the team. Devpost blocks automated reads, so this repo couldn't open it |
| **Confirmed prize** | **Best Use of n8n** | As above |
| **Confirmed rule** | **Each team may enter at most ONE sponsor challenge** | As above |
| **Confirmed prize** | Overall: £3,500 for the top three teams (£1,750, £1,050, £700) | [greatunihack.com](https://greatunihack.com/) |
| Sponsor, prize unknown | Firecrawl, Lovable, GitHub, Anthropic, and others | Official sponsor list. The site says challenge tracks are revealed at the opening ceremony |
| **Speculative** | Any Firecrawl, Lovable, GitHub or Anthropic prize | Not announced. If one is announced, it competes for the same single entry |

**So the plan is:**
- **Enter exactly one sponsor challenge. ElevenLabs is the recommendation** (section 3).
- Every team competes for the overall prizes anyway, so the project must stand on its own.
- Use a second sponsor's technology only if it clearly makes the product better. It earns no second prize, and every extra service is one more thing that can fail during the demo.
- Anthropic is already our AI provider (`src/lib/ai`), so using Claude costs nothing extra in either case.

**Decide by 12:15.** Use the checklist during the ceremony, then the matrix. Write down which challenge you're entering, and enter only that one on Devpost.

## 2. Judging criteria checklist

- [ ] **Each prize's rules:** what "best use" means to that sponsor. Is the technology a core feature or just present? Is there a minimum, such as an API call, a published workflow or a video showing it? Does the team need to register with the sponsor? Remember: **one sponsor challenge per team.**
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

### Choosing the one challenge

Prize fit counts only for the challenge you enter, so compare the options one at a time.

**Enter ElevenLabs (64) by default.** It scores higher on time to demo, demo impact and reuse.

**Switch to n8n (59) if any of these is true:**
- The ElevenLabs live check is **no-go**, for example because the account was blocked on the shared IP (see [live-verification.md](live-verification.md)).
- n8n's announced criteria fit the idea clearly better.
- A teammate already knows n8n well, which makes its time-to-demo score a 4 or 5.

**Switch to an announced speculative prize** only if its total beats 64 (see above).

Whichever you choose, its live check in [live-verification.md](live-verification.md) must be **go** before 13:00. Leave the other sponsor's integration switched off, unless it genuinely improves the product.

## 4. Project concepts

Each concept reuses auth, RLS, storage, Realtime, AI and the integration clients, and each adapts to most themes. None is built yet, deliberately.

Two concepts enter ElevenLabs, the recommendation, and one enters n8n, the fallback. Each uses only its own sponsor at its core.

### Concept A: Echo, voice notes that turn into actions

**Challenge entered:** ElevenLabs. **Also uses:** Claude (`src/lib/ai`), at no extra cost.

Someone records a voice note in the browser, and ElevenLabs Scribe transcribes it. Claude pulls out the tasks, dates and people, and saves them to a list that updates live. ElevenLabs then reads back a short spoken confirmation, and can read the day's list aloud on request.

- **Theme fit:** accessibility (hands-free capture), wellbeing (voice journaling), education (lecture notes into revision tasks), community (voice reports).
- **Sponsor depth:** both directions, speech-to-text and text-to-speech, plus a voice choice from `listVoices()`. That's what a "best use" judge looks for.
- **New work:**
  - A migration for `notes (owner_id, audio_path, transcript, actions jsonb, status)` with RLS, added to Realtime.
  - The recording UI, using `MediaRecorder` and an upload to the user's own Storage folder.
  - A Server Action that calls `getElevenLabs().transcribe()`, then `generateObject`, and saves the result as the user.
  - An audio route that calls `speak()`, cached in Storage.
- **Budget:**
  - Scribe is billed per audio hour.
  - About 20 spoken confirmations of 100 characters each use under 2,000 of the 10,000 credits.

| Time | Milestone |
| --- | --- |
| 12:00 | ElevenLabs live check **go**, migration PR merged and pushed by the owner |
| 13:30 | Record, upload and transcribe a note, then store it |
| 14:30 | Claude extracts actions into a live list |
| 15:30 | Spoken confirmation and "read my list" |
| 16:00 | **Demo ready.** Save fallback audio and two pre-recorded notes |
| 17:00 | Polish |
| 17:30 | Submission, naming ElevenLabs as the challenge entered and where it's used |

**Demo:** speak one note live, then show it transcribed, the actions appearing and the confirmation spoken back. **Fallbacks:** pre-recorded notes, cached transcripts and saved audio, plus `AI_PROVIDER=mock`.

### Concept B: Brief, research read aloud

**Challenge entered:** ElevenLabs.

Someone asks a question, for example "Which student hardship funds can I apply for?". The app gathers sources and writes a short cited briefing with Claude, then **narrates it** with ElevenLabs, so people can listen on the move.

- **Theme fit:** almost any theme with an information problem, such as wellbeing, housing, accessibility or civic life.
- **Sponsor depth:** narration with a choice of voice, plus spoken follow-up questions transcribed with Scribe.
- **Sources:** the user pastes links or text. Firecrawl's `search({ withContent: true })` would automate this, but it's a sponsor technology that earns no prize unless the plan changes.
- **New work:**
  - A migration for `briefs (owner_id, question, sources jsonb, brief text, audio_path)`.
  - `src/features/brief/`.
  - A route handler that returns the audio, cached in Storage so each briefing is narrated once.
- **Budget:** a 1,500-character briefing is about 1,500 characters of text-to-speech, half that with Flash. Cache every narration.

**Demo:** ask one question live and play the narration. Show saved briefings for the rest.

### Concept C: Relay, requests routed to the right place automatically

**Challenge entered:** n8n. This is the fallback if ElevenLabs is no-go.

People submit something in the app, such as an accessibility issue, a society event request or a wellbeing check-in. The app sends it to an n8n workflow. n8n classifies it with its own Anthropic node, branches, and routes it, for example to a Discord channel, a confirmation email or a spreadsheet row. It then replies, in the same request, with what it did. The app saves that outcome as the user, and the status updates live.

- **Theme fit:** community, accessibility, campus life, or anything with requests that need triage.
- **Sponsor depth:** a real workflow, with a webhook trigger, an AI node, branching, two or more app nodes and Respond to Webhook. Judges see both the app and the workflow canvas.
- **Why it works under our rules:** n8n answers within the same request, so the app writes as the signed-in user, under RLS. There's no callback route and no admin key, and **n8n never holds the Supabase secret key**.
- **New work:**
  - A migration for `requests (owner_id, body, category, routed_to, status)` with RLS, added to Realtime.
  - A form, and a Server Action that calls `getN8n().trigger("request.created", …, { schema })` and saves the reply.
  - The n8n workflow, which needs the test branch from [live-verification.md](live-verification.md).
- **Avoid in 6 hours:** a scheduled n8n workflow that calls back into the app. A callback has no user session, so it needs the admin client and careful authorisation.

**Demo:** submit a request, show the Discord message arriving, show the execution on the n8n canvas, and show the status updating live in the app.

**Hosting:** a local `npx n8n` works only if the demo runs on the same laptop. A deployed app needs n8n Cloud (see [live-verification.md](live-verification.md)).

## 5. Turning a sponsor on (5 minutes each)

Turn on only the challenge you entered, then run its live check in [live-verification.md](live-verification.md) from the demo environment.

| Sponsor | Steps |
| --- | --- |
| **ElevenLabs** | **One** teammate creates the account. On the dashboard, create a key restricted to text-to-speech and speech-to-text, with a credit limit. Set `ELEVENLABS_API_KEY` in `.env.local`, restart, and press **Speak** on `/dev/integrations` |
| **n8n** | Start the Cloud trial (no card) or run `npx n8n` (Node 20.19 to 24, no Docker). Add a Webhook node with Header Auth: name `X-N8N-Secret`, value = `N8N_WEBHOOK_SECRET`. Copy its **production** URL into `N8N_WEBHOOK_URL`, **publish** the workflow, and press **Send test event** |
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
