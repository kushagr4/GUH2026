import { Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import {
  AuthShowcaseDetails,
  AuthShowcaseIntro,
} from "@/features/auth/components/auth-showcase";
import "./auth.css";

export const dynamic = "force-dynamic";

// Editorial accent face for the hero line only. Self-hosted by next/font at build time.
const editorialSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-auth-serif",
  display: "swap",
});

/**
 * Sign-in and sign-up share one landing layout: the product showcase on the left
 * and the authentication card on the right. On narrow screens the order becomes
 * intro, card, then the rest of the showcase, so the form stays near the top.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`auth-root ${editorialSerif.variable} relative isolate flex flex-1 flex-col overflow-x-clip`}
    >
      {/* Showcase backdrop: a faint drafting grid and one soft ember glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px] lg:right-[42%]"
      >
        <div className="auth-grid absolute inset-0" />
        <div className="auth-glow absolute -top-56 left-[4%] h-[560px] w-[680px] max-w-full" />
      </div>

      <div className="grid flex-1 grid-cols-1 [grid-template-areas:'intro'_'auth'_'details'] lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'intro_auth'_'details_auth']">
        <header className="px-5 pt-5 sm:px-8 sm:pt-7 lg:px-12 lg:pt-8 xl:px-16 [grid-area:intro]">
          <AuthShowcaseIntro />
        </header>

        <main className="px-5 pt-8 sm:px-8 lg:border-l lg:border-(--auth-line) lg:bg-(--auth-panel)/80 lg:p-0 [grid-area:auth]">
          <div className="lg:sticky lg:top-0 lg:flex lg:min-h-dvh lg:items-center lg:justify-center lg:px-10 lg:py-12 xl:px-14">
            <div className="mx-auto w-full max-w-[440px]">{children}</div>
          </div>
        </main>

        <section
          aria-label="About EmberGap"
          className="px-5 pt-14 pb-10 sm:px-8 lg:px-12 lg:pt-6 lg:pb-14 xl:px-16 [grid-area:details]"
        >
          <AuthShowcaseDetails />
        </section>
      </div>
    </div>
  );
}
