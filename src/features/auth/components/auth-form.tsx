"use client";

import Link from "next/link";
import { useActionState } from "react";
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

export function AuthForm({ mode, action, next }: AuthFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const isSignIn = mode === "sign-in";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignIn ? "current-password" : "new-password"}
          minLength={isSignIn ? undefined : 8}
          required
        />
      </div>

      {state.status === "error" ? (
        <FormMessage variant="error">{state.message}</FormMessage>
      ) : null}
      {state.status === "check-email" ? (
        <FormMessage variant="success">{state.message}</FormMessage>
      ) : null}

      <SubmitButton pendingLabel={isSignIn ? "Signing in…" : "Creating account…"}>
        {isSignIn ? "Sign in" : "Create account"}
      </SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        {isSignIn ? "No account yet? " : "Already have an account? "}
        <Link
          className="font-medium text-foreground underline underline-offset-4"
          href={isSignIn ? ROUTES.signup : ROUTES.login}
        >
          {isSignIn ? "Create one" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
