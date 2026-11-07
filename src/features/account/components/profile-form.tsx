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
        <Label htmlFor="displayName" className="text-[#71513d] dark:text-[#edd6c1]">
          Display name
        </Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          autoComplete="name"
          className="h-11 rounded-xl border-[#f0deca] bg-white px-3 text-base focus-visible:border-[#e8a466] focus-visible:ring-[#f7c99a]/50 dark:border-[#674632] dark:bg-[#211711]"
        />
      </div>
      {state.status === "error" ? (
        <FormMessage variant="error">{state.message}</FormMessage>
      ) : null}
      {state.status === "saved" ? (
        <FormMessage variant="success">Saved.</FormMessage>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Saving…"
          className="h-10 rounded-xl bg-[#b83d00] px-5 text-white shadow-sm hover:bg-[#913000]"
        >
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
