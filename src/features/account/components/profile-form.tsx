"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type ProfileFormState } from "../actions";

const INITIAL_STATE: ProfileFormState = { status: "idle" };

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action] = useActionState(updateProfile, INITIAL_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          autoComplete="name"
        />
      </div>
      {state.status === "error" ? (
        <FormMessage variant="error">{state.message}</FormMessage>
      ) : null}
      {state.status === "saved" ? (
        <FormMessage variant="success">Saved.</FormMessage>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}
