# Vision validator (shell)

This is a deterministic wrapper around one swappable `VisionAnalyzer`. It turns untrusted model output into an `AgentFinding` (`agentId: "vision"`) for **human review only**. It describes what an image shows. It never authenticates a photo, or its time or location.

## Pieces

| File | Purpose |
| --- | --- |
| `analyzer.ts` | `VisionAnalyzer { id; analyze(input: VisionInput, signal?) => Promise<unknown> }` and `visionInputSchema` |
| `schema.ts` | `visionModelOutputSchema` (what to ask the model for) and `VISION_SYSTEM_PROMPT` |
| `guardrails.ts` | `toVisionFinding(raw, ctx, deps)`: parses, strips claims, sanitises and maps to reason codes |
| `validate.ts` | `validateVision(ctx, analyzer, deps, { timeoutMs, signal })`: timeout, errors and abort become `vision.model_unavailable` |
| `mock.ts` | `createMockVisionAnalyzer()` and the labelled synthetic `VISION_FIXTURES` (offline demo and tests) |

## Implementing the live analyzer

1. Create a **server-only** module (`import "server-only"`) that implements `VisionAnalyzer`. Use the repo AI facilities in `src/lib/ai` for the key, config, rate limits and errors. Never read `ANTHROPIC_API_KEY` yourself, and never put a secret, signed URL, reporter identity or exact coordinate in the prompt.
2. Load the image bytes server-side from private Storage using `input.imageRef`. Don't make the image public.
3. Use `VISION_SYSTEM_PROMPT` unchanged as the system prompt, and never interpolate untrusted text into it. Put `input.reportDescription` in the user turn, quoted and labelled "untrusted reporter text".
4. Ask for structured output matching `visionModelOutputSchema` (`indicators.{smoke,flame,glow,burnScar}` as `absent|possible|clear`, `ambiguityFactors[]`, `imageQuality`, `description`). Do not request the `claimed*` fields. They exist only so the guardrails can strip them.
5. Return the parsed object **as is**, typed `unknown`. Don't map it to a finding, and don't fill in defaults.
6. Throw on any failure (network, refusal, rate limit, missing config) and honour `signal`. `validateVision` records that as a data gap, never as negative evidence.

Note: `src/lib/ai`'s `AiMessage.content` is currently `string` only, so sending an image needs an image content block added there. The `src/lib/ai` owner has to make that change; it is outside this folder.

## Mapping summary

Invalid output gives `inconclusive` + `vision.output_invalid`. Poor or unusable quality gives `vision.low_quality`. Clear smoke or flame with no ambiguity factor gives `supports` (`vision.smoke_visible` / `vision.flame_visible`). Any indicator alongside an ambiguity factor, tentative indicators, or a burn scar alone gives `vision.ambiguous`. A good-quality image with nothing fire-like in it gives a weak `contradicts` + `vision.no_fire_indicators`. Location, time or authenticity claims are removed and add `vision.unverifiable_claim_stripped`. Instruction-like or operational sentences are withheld from the explanation. Free text never changes the assessment.
