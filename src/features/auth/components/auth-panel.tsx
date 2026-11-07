import Link from "next/link";
import type { ReactNode } from "react";
import { Info, Lock } from "lucide-react";
import { ROUTES } from "@/lib/routes";

type AuthPanelProps = {
  mode: "sign-in" | "sign-up";
  title: string;
  description: string;
  children: ReactNode;
};

/** The authentication card: a sign-in/sign-up switch, a heading and the form. */
export function AuthPanel({ mode, title, description, children }: AuthPanelProps) {
  return (
    <div className="auth-rise flex flex-col gap-5" style={{ animationDelay: "140ms" }}>
      <div className="auth-card-shadow relative overflow-hidden rounded-2xl border border-(--auth-line) bg-white">
        {/* Hairline ember accent along the top edge. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-orange-500/70 to-transparent"
        />

        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <nav aria-label="Account access">
            <ul className="grid grid-cols-2 rounded-xl border border-(--auth-line-soft) bg-(--auth-bg) p-1 text-sm">
              <ModeLink href={ROUTES.login} current={mode === "sign-in"}>
                Sign in
              </ModeLink>
              <ModeLink href={ROUTES.signup} current={mode === "sign-up"}>
                Create account
              </ModeLink>
            </ul>
          </nav>

          <div className="flex flex-col gap-2">
            <h2 className="text-[1.6rem] leading-tight font-semibold tracking-[-0.025em]">{title}</h2>
            <p className="text-sm leading-relaxed text-pretty text-(--auth-ink-2)">{description}</p>
          </div>

          <div className="flex flex-col gap-4">{children}</div>
        </div>

        <div className="flex gap-2.5 border-t border-(--auth-line-soft) bg-(--auth-panel) px-6 py-4 text-xs leading-relaxed text-(--auth-ink-2) sm:px-8">
          <Info className="mt-0.5 size-3.5 shrink-0 text-(--auth-ember-ink)" aria-hidden="true" />
          <p>
            <span className="font-medium text-(--auth-ink)">In danger now?</span> Call 112 (115 for the
            Vigili del Fuoco in Italy). EmberGap does not contact emergency services.
          </p>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-(--auth-ink-3)">
        <Lock className="size-3" aria-hidden="true" />
        Private by default, protected by row-level security.
      </p>
    </div>
  );
}

function ModeLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex">
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`flex-1 rounded-lg px-3 py-2 text-center font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-(--auth-ember)/40 ${
          current
            ? "bg-white text-(--auth-ink) shadow-[0_1px_2px_rgb(27_24_21/8%),0_0_0_1px_rgb(27_24_21/5%)]"
            : "text-(--auth-ink-3) hover:text-(--auth-ink)"
        }`}
      >
        {children}
      </Link>
    </li>
  );
}
