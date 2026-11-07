import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  Camera,
  Eye,
  GitMerge,
  Globe,
  Lock,
  MapPin,
  Satellite,
  ScrollText,
  ShieldCheck,
  Unplug,
  Users,
  Wind,
} from "lucide-react";
import { siteConfig } from "@/config/site";
import { ROUTES } from "@/lib/routes";
import { EmberMark } from "./ember-mark";
import { FeatureCarousel, type FeatureSlide } from "./feature-carousel";

/*
 * Product showcase for the sign-in and sign-up pages. Everything here is static,
 * illustrative and synthetic: no live data, no investigation records.
 */

function rise(delayMs: number): CSSProperties {
  return { animationDelay: `${delayMs}ms` };
}

function Eyebrow({ index, children }: { index: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium tracking-[0.14em] text-(--auth-ink-3) uppercase">
      <span className="text-(--auth-ember-ink)">[ {index} ]</span>
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------------- */
/* Intro: brand row, hero headline, supporting copy                          */
/* ------------------------------------------------------------------------- */

export function AuthShowcaseIntro() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={ROUTES.home}
          className="group inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--auth-ember)"
        >
          <EmberMark size={34} />
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-[-0.01em]">{siteConfig.name}</span>
            <span className="mt-1 font-mono text-[10px] tracking-[0.12em] text-(--auth-ink-3) uppercase">
              Wildfire evidence review
            </span>
          </span>
        </Link>

        <span className="hidden items-center gap-2 rounded-full border border-(--auth-line) bg-white/70 px-3 py-1 text-xs text-(--auth-ink-2) backdrop-blur-sm sm:inline-flex">
          <span className="relative flex size-1.5">
            <span className="auth-ping absolute inset-0 rounded-full bg-(--auth-ember)" />
            <span className="relative size-1.5 rounded-full bg-(--auth-ember)" />
          </span>
          Research prototype · synthetic demo data
        </span>
      </div>

      <div className="mt-8 flex flex-col gap-5 sm:mt-16 lg:mt-20 xl:mt-24">
        <div className="auth-rise" style={rise(40)}>
          <Eyebrow index="01">Multi-agent decision support</Eyebrow>
        </div>

        <h1
          className="auth-rise text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-[3.5rem] xl:text-[4.15rem]"
          style={rise(110)}
        >
          Every signal matters.{" "}
          <span className="auth-serif block pt-1 text-[1.08em] tracking-[-0.02em] text-(--auth-ember-ink) italic">
            Every second counts.
          </span>
        </h1>

        <p
          className="auth-rise max-w-[56ch] text-[1.0625rem] leading-relaxed text-pretty text-(--auth-ink-2) sm:text-lg"
          style={rise(180)}
        >
          EmberGap combines satellite thermal observations, weather conditions, eyewitness reports and
          independent AI agents into one auditable investigation, so trained reviewers can weigh a
          possible wildfire with every source in view.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Details: signal strip, feature carousel, product cards, footer            */
/* ------------------------------------------------------------------------- */

const SIGNALS = [
  { icon: Satellite, label: "Satellite", source: "NASA FIRMS", note: "Thermal anomalies" },
  { icon: Wind, label: "Weather", source: "Open-Meteo", note: "Wind and humidity" },
  { icon: Camera, label: "Eyewitness", source: "Reporter photos", note: "Passive, safe reports" },
  { icon: Globe, label: "Context", source: "NASA EONET", note: "Known nearby events" },
] as const;

export function AuthShowcaseDetails() {
  return (
    <div className="flex flex-col gap-16 lg:gap-20">
      <ul
        aria-label="Evidence sources"
        className="auth-rise grid grid-cols-2 overflow-hidden rounded-2xl border border-(--auth-line) bg-white/70 backdrop-blur-sm sm:grid-cols-4"
        style={rise(250)}
      >
        {SIGNALS.map(({ icon: Icon, label, source, note }, index) => (
          <li
            key={label}
            className={`flex flex-col gap-3 p-4 sm:p-5 ${index % 2 === 1 ? "border-l" : ""} ${index >= 2 ? "border-t sm:border-t-0" : ""} ${index === 2 ? "sm:border-l" : ""} border-(--auth-line)`}
          >
            <span className="flex size-8 items-center justify-center rounded-lg border border-(--auth-line) bg-(--auth-bg) text-(--auth-ink)">
              <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{label}</span>
              <span className="font-mono text-[11px] text-(--auth-ember-ink)">{source}</span>
              <span className="text-xs text-(--auth-ink-3)">{note}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Eyebrow index="02">How an investigation unfolds</Eyebrow>
          <h2 className="max-w-[30ch] text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
            From a single observation to a recommendation a person can check.
          </h2>
        </div>
        <FeatureCarousel slides={SLIDES} />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Eyebrow index="03">Built for careful judgement</Eyebrow>
          <h2 className="max-w-[30ch] text-2xl font-semibold tracking-[-0.025em] text-balance sm:text-[1.75rem]">
            Honest about uncertainty. Careful with people&rsquo;s data.
          </h2>
        </div>
        <ProductCards />
      </div>

      <footer className="flex flex-col gap-3 border-t border-(--auth-line) pt-6 text-xs leading-relaxed text-(--auth-ink-3) sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <p className="max-w-[62ch] text-pretty">
          EmberGap is a research decision-support prototype for human review. It is not an emergency
          alert, dispatch or confirmed-detection service, and its demonstration incidents are synthetic.
        </p>
        <p className="shrink-0 font-mono tracking-wide">GreatUniHack 2026</p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Carousel slides and their illustrative visuals                            */
/* ------------------------------------------------------------------------- */

function VisualFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="auth-tile-shadow flex h-full flex-col overflow-hidden rounded-xl border border-(--auth-line) bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-(--auth-line-soft) bg-(--auth-panel) px-3.5 py-2.5">
        <span className="truncate font-mono text-[11px] text-(--auth-ink-2)">{label}</span>
        <span className="shrink-0 rounded-full border border-(--auth-line) px-2 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-(--auth-ink-3) uppercase">
          Synthetic
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-(--auth-ink-3)">{label}</span>
      <span className="text-right font-medium text-(--auth-ink)">{value}</span>
    </div>
  );
}

type Tone = "ember" | "neutral" | "muted" | "ok";

function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    ember: "border-orange-200 bg-(--auth-ember-wash) text-(--auth-ember-ink)",
    neutral: "border-(--auth-line) bg-(--auth-bg) text-(--auth-ink-2)",
    muted: "border-dashed border-(--auth-line) bg-transparent text-(--auth-ink-3)",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function ReportVisual() {
  return (
    <VisualFrame label="observation / OBS-0417">
      <div className="relative h-28 overflow-hidden rounded-lg border border-(--auth-line-soft) bg-[#f3efe6]">
        <div className="auth-grid absolute inset-0 [mask-image:none]" />
        <svg aria-hidden="true" viewBox="0 0 320 112" className="absolute inset-0 size-full" preserveAspectRatio="none">
          <path d="M0 78 C60 62 90 90 150 70 S260 40 320 56" stroke="#d9cfbf" strokeWidth="1.5" fill="none" />
          <path d="M0 30 C70 44 120 18 190 34 S280 22 320 30" stroke="#e2d9ca" strokeWidth="1" fill="none" />
        </svg>
        <div className="absolute top-1/2 left-[58%] size-20 -translate-1/2 rounded-full border border-dashed border-orange-400/70 bg-orange-400/10" />
        <div className="absolute top-1/2 left-[58%] size-2 -translate-1/2 rounded-full bg-(--auth-ember) ring-4 ring-orange-400/25" />
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 font-mono text-[10px] text-(--auth-ink-2)">
          <MapPin className="size-3" aria-hidden="true" /> approx. area, not exact
        </span>
      </div>
      <Row label="Photo" value={<Chip><Lock className="size-3" aria-hidden="true" /> Private storage</Chip>} />
      <Row label="Reporter" value="Passive, from a safe place" />
      <Row label="Status" value={<Chip tone="ember">Possible · awaiting review</Chip>} />
    </VisualFrame>
  );
}

function AgentsVisual() {
  const agents = [
    { icon: Eye, name: "Vision", state: "Complete", tone: "ok" as Tone, fill: "w-full" },
    { icon: Satellite, name: "Satellite", state: "Running", tone: "ember" as Tone, fill: "w-2/3", live: true },
    { icon: Wind, name: "Weather", state: "Complete", tone: "ok" as Tone, fill: "w-full" },
    { icon: Users, name: "Witness", state: "Queued", tone: "muted" as Tone, fill: "w-0" },
  ];
  return (
    <VisualFrame label="INV-0417 / agents">
      <ul className="flex flex-col gap-2.5">
        {agents.map(({ icon: Icon, name, state, tone, fill, live }) => (
          <li key={name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[12.5px] font-medium">
                <Icon className="size-3.5 text-(--auth-ink-2)" aria-hidden="true" />
                {name}
              </span>
              <Chip tone={tone}>
                {live ? (
                  <span className="relative flex size-1.5">
                    <span className="auth-ping absolute inset-0 rounded-full bg-(--auth-ember)" />
                    <span className="relative size-1.5 rounded-full bg-(--auth-ember)" />
                  </span>
                ) : null}
                {state}
              </Chip>
            </div>
            <div className="relative h-1 overflow-hidden rounded-full bg-(--auth-line-soft)">
              <div className={`h-full rounded-full ${tone === "ember" ? "bg-(--auth-ember)" : "bg-[#b8afa2]"} ${fill}`} />
              {live ? (
                <div className="auth-scan absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-white/70 to-transparent" />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-auto font-mono text-[10.5px] text-(--auth-ink-3)">
        Each agent keeps its own state, inbox and findings.
      </p>
    </VisualFrame>
  );
}

function PartitionVisual() {
  return (
    <VisualFrame label="runtime / link status">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-col items-center gap-1 rounded-lg border border-(--auth-line) bg-(--auth-panel) px-2 py-2.5 text-center">
          <span className="text-[12px] font-semibold">Field agents</span>
          <span className="font-mono text-[10px] text-(--auth-ink-3)">local queue</span>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="h-px w-full border-t border-dashed border-orange-400" />
          <span className="inline-flex items-center gap-1 rounded-full bg-(--auth-ember-wash) px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-(--auth-ember-ink)">
            <Unplug className="size-3" aria-hidden="true" /> Link down
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 rounded-lg border border-(--auth-line) bg-(--auth-panel) px-2 py-2.5 text-center">
          <span className="text-[12px] font-semibold">Fusion</span>
          <span className="font-mono text-[10px] text-(--auth-ink-3)">waiting</span>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["3", "processed locally"],
          ["1", "still pending"],
          ["0", "duplicates applied"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-lg border border-(--auth-line-soft) px-1 py-2">
            <dt className="sr-only">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            <dd className="text-[10.5px] leading-tight text-(--auth-ink-3)">{label}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto inline-flex items-start gap-1.5 text-[11.5px] text-(--auth-ink-2)">
        <GitMerge className="mt-0.5 size-3.5 shrink-0 text-(--auth-ember-ink)" aria-hidden="true" />
        On reconnect, findings merge once and contradictions stay visible.
      </p>
    </VisualFrame>
  );
}

function FusionVisual() {
  const rows: { source: string; detail: string; stance: string; tone: Tone }[] = [
    { source: "Satellite", detail: "Thermal anomaly, 2.1 km away", stance: "Supports", tone: "ember" },
    { source: "Weather", detail: "Dry, wind NE 24 km/h", stance: "Context only", tone: "neutral" },
    { source: "Witness ×2", detail: "Possibly the same origin", stance: "Counted once", tone: "neutral" },
    { source: "Vision", detail: "Describes smoke", stance: "Not authenticated", tone: "muted" },
  ];
  return (
    <VisualFrame label="fusion / recommendation">
      <div className="rounded-lg border border-orange-200 bg-(--auth-ember-wash) px-3 py-2.5">
        <p className="font-mono text-[10px] tracking-[0.1em] text-(--auth-ember-ink) uppercase">Recommendation</p>
        <p className="mt-0.5 text-[13.5px] font-semibold">Prioritise for human review</p>
      </div>
      <ul className="flex flex-col divide-y divide-(--auth-line-soft)">
        {rows.map((row) => (
          <li key={row.source} className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 flex-col">
              <span className="text-[12px] font-medium">{row.source}</span>
              <span className="truncate text-[11px] text-(--auth-ink-3)">{row.detail}</span>
            </span>
            <Chip tone={row.tone}>{row.stance}</Chip>
          </li>
        ))}
      </ul>
    </VisualFrame>
  );
}

const SLIDES: FeatureSlide[] = [
  {
    id: "report",
    label: "Report",
    title: "A possible fire, reported safely",
    body: "A reporter shares what they can see from where they are, with an optional photo. Photos stay in private storage and the public view only shows an approximate area.",
    points: ["Never asks anyone to move closer", "Approximate public location", "Private photo storage"],
    visual: <ReportVisual />,
  },
  {
    id: "agents",
    label: "Agents",
    title: "Independent agents, one source each",
    body: "Separate agents look at the photo, satellite thermal anomalies, weather and other witness reports. Each records structured, source-attributed findings rather than one opaque score.",
    points: ["Vision describes, it does not authenticate", "No satellite detection means unknown", "Weather is context, not proof"],
    visual: <AgentsVisual />,
  },
  {
    id: "partition",
    label: "Partition",
    title: "Keeps working when the link drops",
    body: "If communication is cut, agents keep processing the tasks they already hold. When the link returns, results are reconciled without data loss or a finding being applied twice.",
    points: ["Replay-safe, uniquely identified messages", "No invented observations offline", "Deterministic reconciliation"],
    visual: <PartitionVisual />,
  },
  {
    id: "fusion",
    label: "Fusion",
    title: "A recommendation, not a verdict",
    body: "A fusion step combines the findings with transparent, reversible rules and explains its reasoning. A trained person makes the call: nothing becomes a verified incident on its own.",
    points: ["Every finding is traceable", "Related reports are not double counted", "No automatic declarations"],
    visual: <FusionVisual />,
  },
];

/* ------------------------------------------------------------------------- */
/* Product cards                                                             */
/* ------------------------------------------------------------------------- */

function ProductCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <article className="auth-tile-shadow flex flex-col gap-5 rounded-2xl border border-(--auth-line) bg-white p-5 sm:p-6 md:col-span-2 md:flex-row md:items-center md:gap-8">
        <div className="flex flex-col gap-2 md:w-[44%]">
          <CardIcon><Satellite className="size-4" strokeWidth={1.75} aria-hidden="true" /></CardIcon>
          <h3 className="text-base font-semibold tracking-[-0.01em]">Unknown is not absent</h3>
          <p className="text-sm leading-relaxed text-(--auth-ink-2)">
            When no satellite pass covers a location, the gap is recorded as unknown, never as
            evidence that nothing is burning.
          </p>
        </div>
        <PassTimeline />
      </article>

      <article className="auth-tile-shadow flex flex-col gap-4 rounded-2xl border border-(--auth-line) bg-white p-5 sm:p-6">
        <CardIcon><ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden="true" /></CardIcon>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold tracking-[-0.01em]">Private by design</h3>
          <p className="text-sm leading-relaxed text-(--auth-ink-2)">
            Reports can reveal where someone is. EmberGap shows investigators only what they need.
          </p>
        </div>
        <ul className="mt-auto flex flex-col gap-2 text-[13px]">
          {[
            "Reporter-owned records, row-level security",
            "Photos in private storage",
            "Approximate locations in shared views",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-(--auth-ember-ink)" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="auth-tile-shadow flex flex-col gap-4 rounded-2xl border border-(--auth-line) bg-white p-5 sm:p-6">
        <CardIcon><ScrollText className="size-4" strokeWidth={1.75} aria-hidden="true" /></CardIcon>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold tracking-[-0.01em]">Auditable end to end</h3>
          <p className="text-sm leading-relaxed text-(--auth-ink-2)">
            Every finding carries its source, time and agent, so a reviewer can trace how a
            recommendation was reached.
          </p>
        </div>
        <ol
          aria-label="Example audit trail (synthetic)"
          className="mt-auto flex flex-col gap-1.5 rounded-xl bg-(--auth-ink) p-3.5 font-mono text-[11px] leading-snug text-white/70"
        >
          <li className="flex gap-3"><span className="text-white/40">14:31:52</span><span><span className="text-orange-300">satellite</span> finding.recorded</span></li>
          <li className="flex gap-3"><span className="text-white/40">14:32:08</span><span><span className="text-orange-300">runtime</span> 3 findings merged</span></li>
          <li className="flex gap-3"><span className="text-white/40">14:32:09</span><span><span className="text-orange-300">fusion</span> recommendation.updated</span></li>
        </ol>
      </article>
    </div>
  );
}

function CardIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg border border-orange-200 bg-(--auth-ember-wash) text-(--auth-ember-ink)">
      {children}
    </span>
  );
}

/** Illustrative satellite-pass timeline with an explicit coverage gap. */
function PassTimeline() {
  const passes = [
    { at: "02:10", state: "clear" },
    { at: "06:40", state: "clear" },
    { at: "11:25", state: "gap" },
    { at: "13:05", state: "detection" },
  ] as const;
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl border border-(--auth-line-soft) bg-(--auth-panel) p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-(--auth-ink-3) uppercase">Satellite passes · synthetic</span>
      </div>
      <ol className="relative grid grid-cols-4 gap-1.5">
        {passes.map((pass) => (
          <li key={pass.at} className="flex flex-col gap-1.5">
            <span
              className={`h-9 rounded-md border ${
                pass.state === "gap"
                  ? "border-dashed border-(--auth-ink-3)/50 bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(27_24_21/6%)_5px_6px)]"
                  : pass.state === "detection"
                    ? "border-orange-300 bg-orange-100"
                    : "border-(--auth-line) bg-white"
              }`}
            />
            <span className="font-mono text-[10px] text-(--auth-ink-3)">{pass.at}</span>
            <span
              className={`text-[11px] font-medium ${
                pass.state === "gap"
                  ? "text-(--auth-ink-2)"
                  : pass.state === "detection"
                    ? "text-(--auth-ember-ink)"
                    : "text-(--auth-ink-3)"
              }`}
            >
              {pass.state === "gap" ? "No coverage: unknown" : pass.state === "detection" ? "Anomaly" : "No anomaly"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
