# Sponsor strategy

How to pick a sponsor technology quickly once prize categories are announced, and three project concepts ready to adapt to the theme. The facts behind the scores are in [sponsor-comparison.md](sponsor-comparison.md), checked 7 November 2026.

**Timing:** prizes are usually announced at the opening ceremony (11:00 to 12:00). Use the checklist below during the ceremony, score the matrix, and **decide by 12:15**. Choose one primary sponsor and at most one secondary. Spreading across three sponsor tracks in 6 hours usually means none is done well.

## 1. Judging criteria checklist

Fill this in while prizes are announced. Ask the sponsor's mentors anything that isn't clear.

- [ ] **Prize and sponsor:** what each prize is, and how many teams can win.
- [ ] **Eligibility:** must the sponsor's technology be a core feature or just present? Is there a minimum, such as "uses the API", "built with Lovable" or a published URL? Does the team need to sign up or register with the sponsor? Can one project enter several tracks?
- [ ] **Criteria and weighting:** innovation, technical depth, *use of the sponsor technology*, design, impact, presentation. Note the order each sponsor mentions them in.
- [ ] **Submission:** where (form or Devpost), what is required (video, public repo, deployed URL, "built with" tags), and the deadline (18:00, with **no late submissions**).
- [ ] **Free credits or codes** given out at the event. Redeem them before 12:00, because sign-ups and verification take time.
- [ ] **Constraints:** venue Wi-Fi (many teams share one IP, which matters for unauthenticated APIs), accounts judges will need, and whether a live demo is required.
- [ ] **What impresses this sponsor:** ask their mentor directly, for example "what would you love to see built with this?".
- [ ] **Our rules:** the starter is disclosed in the submission (see [hackathon-day.md](hackathon-day.md)). No paid plans, so check whether any idea depends on a paid tier.

## 2. Decision matrix

Score each option from 1 (poor) to 5 (excellent). Everything except **prize fit** is scored in advance from the research. Prize fit is filled in at the event: **0** if no prize or the criteria rule us out, **5** for a clear prize whose criteria we can meet.

| Criterion | Weight | Firecrawl | GitHub | Lovable (separate app) | No sponsor |
| --- | ---: | :---: | :---: | :---: | :---: |
| **Prize fit** (fill in at the event) | ×4 | ? | ? | ? | 0 |
| Time to a working demo | ×3 | 4 | 5 | 4 | 5 |
| Demo impact | ×2 | 4 | 3 | 3 | 2 |
| Reliability on the day | ×2 | 3 | 4 | 3 | 5 |
| Safety for the shared database and our rules | ×2 | 5 | 5 | 3 | 5 |
| Reuse of this foundation | ×1 | 5 | 5 | 2 | 5 |
| Cost and free-tier headroom | ×1 | 4 | 5 | 2 | 5 |
| **Total before prize fit** (max 55) | | **45** | **49** | **34** | **49** |

**Total = pre-scored total + 4 × prize fit.** With prize fit, the maximum is 75. A sponsor with a real, winnable prize (prize fit 4 or 5 adds 16 to 20) should beat "no sponsor".

Why the scores are what they are:

- **Firecrawl:** the client is ready, and structured extraction from live websites demos well. Reliability takes a hit because the free plan allows 10 requests a minute and 1,000 credits, and every call goes over the network. Caching in Supabase mitigates that.
- **GitHub:** REST works now with no key, and Supabase supports GitHub login. Impact depends on the idea, and works best for developer-focused projects. Use a token on venue Wi-Fi.
- **Lovable:** fast for a separate app, but it can't edit our Next.js repo. Its Supabase integration must **not** touch the shared project, which is why it scores 3 for safety. Free credits are tight: 5 a day.
- **Combinations that work:** Firecrawl or GitHub as the primary sponsor, plus a small Lovable landing or companion app as the secondary. Firecrawl with GitHub rarely fits one idea naturally.

## 3. Project concepts

Each one reuses auth, RLS, storage, Realtime, AI and the integration clients, and each adapts to most themes. None of them is built yet, deliberately.

### Concept A: Pulse, a live tracker for public web information

**Primary sponsor:** Firecrawl. **Optional:** a Lovable landing page.

Users add public URLs, such as events, products, course pages, job adverts or council services. Firecrawl extracts a typed record from each one. The board updates live, and AI explains what changed or what's best for the user.

- **Theme fit:** sustainability (compare products' environmental claims), education (compare courses), health (local services and opening times), or money (price tracking).
- **Sponsor depth:** structured JSON extraction with a zod schema is Firecrawl's headline feature. Add `search()` to discover pages, not only paste them.
- **New work:**
  - A migration for `tracked_pages (owner_id, url, data jsonb, status, fetched_at)` with RLS, added to Realtime.
  - `src/features/pulse/`, with a Server Action that checks the table before calling `getFirecrawl().extract()`.
  - A board page using `useTableChanges`.
  - `generateObject` for a comparison summary.
- **Credit budget:** 5 credits per extraction, so about 30 during development and 20 for demo preparation is about 250 credits.

| Time | Milestone |
| --- | --- |
| 12:00 | Schema agreed, migration PR merged and pushed by the owner, Firecrawl key working on `/dev/integrations` |
| 13:30 | Add a URL, extract it, store it, show it |
| 15:00 | Live board and AI comparison |
| 16:00 | **Demo ready.** Pre-load the demo URLs |
| 17:00 | Polish, error states, Lovable landing page if there's time |
| 17:30 | Submission written, video recorded |

**Demo:** paste one new URL live (around 5 seconds), and show the rest from the cache. **Fallback:** cached rows, plus `AI_PROVIDER=mock`.

### Concept B: RepoReady, an onboarding coach for open-source projects

**Primary sponsor:** GitHub. **Optional:** Actions, or a Lovable landing page.

A student signs in with GitHub and picks a public repository. The app reads its activity, languages, good-first-issue labels and contributing guide. AI then writes a personal first-contribution plan, which is saved for later.

- **Theme fit:** education and community, inclusion (first-time contributors), or productivity.
- **Sponsor depth:** goes well beyond hosting. It uses GitHub login, the REST API, and optionally a webhook feed of new issues or an Actions bot that posts the plan as an issue comment.
- **New work:**
  - Enable GitHub login (an OAuth App, about 20 minutes, done by the owner).
  - A migration for `plans (owner_id, repo, plan jsonb)` with RLS.
  - `src/features/repo-ready/`, using `getGitHub().request()` for issues and contents, and `generateObject` for the plan.
- **Rate budget:** 3 to 6 REST calls per repo. Set `GITHUB_API_TOKEN` for 5,000 an hour, because 60 an hour per venue IP won't survive a demo.

| Time | Milestone |
| --- | --- |
| 12:00 | OAuth App and token set, `/dev/integrations` lookup works |
| 13:30 | Sign in with GitHub, pick a repo, show its stats |
| 15:00 | AI plan generated and saved |
| 16:00 | **Demo ready** |
| 17:00 | Webhook live feed or Actions bot, if there's time |
| 17:30 | Submission |

**Demo:** sign in with GitHub, choose a well-known repo, and get a plan in seconds. **Fallback:** pre-generated plans for the demo repos.

### Concept C: Brief, research to a cited briefing

**Primary sponsor:** Firecrawl. **Secondary:** Lovable.

Someone asks a question, for example "Which student hardship funds can I apply for?". The app searches the web with Firecrawl, scrapes the best results and writes a short briefing with AI, citing each source. Briefings are saved and shareable. A Lovable-built public front page explains the product and links into it.

- **Theme fit:** almost any theme with an information problem, such as wellbeing, housing, accessibility or civic life.
- **Sponsor depth:**
  - **Firecrawl:** `search()` plus page scraping.
  - **Lovable:** a published `lovable.app` micro-app (option A in the comparison). It is built separately and never connected to our Supabase project.
- **New work:**
  - A migration for `briefs (owner_id, question, sources jsonb, brief text)`.
  - `src/features/brief/`, using `search()` with 5 results, then `scrape()` on the top 3, then `generateText`.
  - The Lovable page, with one teammate on it for an hour or so.
- **Credit budget:** about 5 credits per briefing (2 for search, 3 for scrapes), so roughly 150 credits for the day.

| Time | Milestone |
| --- | --- |
| 12:00 | Firecrawl key working. Lovable account ready |
| 13:30 | Question in, sources listed |
| 15:00 | Cited briefing saved and viewable |
| 16:00 | **Demo ready.** Lovable page published and linking to the app |
| 17:00 | Sharing, polish |
| 17:30 | Submission, naming both sponsors and where each is used |

**Demo:** ask one question live, and show saved briefings for the rest. **Fallback:** saved briefings, plus `AI_PROVIDER=mock`.

## 4. Turning a sponsor on (5 minutes each)

| Sponsor | Steps |
| --- | --- |
| Firecrawl | Sign up, or redeem the event or student code. Put `FIRECRAWL_API_KEY` in `.env.local`, restart, open `/dev/integrations` and press **Scrape** |
| GitHub | Works now for public data. Create a fine-grained, read-only token and set `GITHUB_API_TOKEN`. For login, the owner creates an OAuth App and enables the provider in Supabase |
| Lovable | One teammate signs up and builds in a **new** Lovable project. Don't connect Supabase. Publish to `lovable.app` and link it from our app |

**Sharing keys:** each person puts keys in their own `.env.local`, and the deployed app gets them as environment variables. Share keys through a password manager or in person, never in Git, chat or AI sessions. When the event ends, revoke any key that was shared.
