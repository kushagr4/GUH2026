"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/routes";
import type { AuthFormState } from "../schemas";

const INITIAL_STATE: AuthFormState = { status: "idle" };

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
};

const FIELD =
  "h-11 rounded-xl border-(--auth-line) bg-white px-3.5 text-[15px] shadow-[inset_0_1px_1px_rgb(27_24_21/3%)] transition-[border-color,box-shadow] placeholder:text-(--auth-ink-3)/70 hover:border-[#d6cfc3] focus-visible:border-(--auth-ember) focus-visible:ring-4 focus-visible:ring-orange-500/15 md:text-[15px]";

export function AuthForm({ mode, action, next }: AuthFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);
  const isSignIn = mode === "sign-in";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email" className="text-[13px] text-(--auth-ink)">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className={FIELD}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password" className="text-[13px] text-(--auth-ink)">
            Password
          </Label>
          {isSignIn ? null : (
            <span id="password-hint" className="text-xs text-(--auth-ink-3)">
              At least 8 characters
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={isSignIn ? "current-password" : "new-password"}
            minLength={isSignIn ? undefined : 8}
            aria-describedby={isSignIn ? undefined : "password-hint"}
            className={`${FIELD} pr-16`}
            required
          />
          <button
            type="button"
            aria-controls="password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-1.5 right-1.5 rounded-lg px-2.5 text-xs font-medium text-(--auth-ink-2) transition-colors outline-none hover:bg-(--auth-bg) hover:text-(--auth-ink) focus-visible:ring-3 focus-visible:ring-orange-500/30"
          >
            {showPassword ? "Hide" : "Show"}
            <span className="sr-only"> password</span>
          </button>
        </div>
      </div>

      {state.status === "error" ? (
        <FormMessage variant="error">{state.message}</FormMessage>
      ) : null}
      {state.status === "check-email" ? (
        <FormMessage variant="success">{state.message}</FormMessage>
      ) : null}

      <SubmitButton
        className="group/submit mt-1 h-11 w-full gap-2 rounded-xl bg-(--auth-ink) text-[15px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/10%),0_8px_18px_-10px_rgb(27_24_21/60%)] hover:bg-[#2a2622] focus-visible:ring-4 focus-visible:ring-orange-500/30"
        pendingLabel={
          <>
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {isSignIn ? "Signing in…" : "Creating account…"}
          </>
        }
      >
        {isSignIn ? "Sign in" : "Create account"}
        <ArrowRight
          className="size-4 transition-transform group-hover/submit:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </SubmitButton>

      <p className="text-center text-sm text-(--auth-ink-2)">
        {isSignIn ? "No account yet? " : "Already have an account? "}
        <Link
          className="rounded-sm font-medium text-(--auth-ink) underline decoration-(--auth-line) decoration-2 underline-offset-4 transition-colors outline-none hover:decoration-(--auth-ember) focus-visible:ring-3 focus-visible:ring-orange-500/30"
          href={isSignIn ? ROUTES.signup : ROUTES.login}
        >
          {isSignIn ? "Create one" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
