// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/features/auth/components/auth-form";
import type { AuthFormState } from "@/features/auth/schemas";

afterEach(cleanup);

function submitWith(result: AuthFormState) {
  const action = vi.fn(async () => result);
  render(<AuthForm mode="sign-in" action={action} next="/app/items" />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "a@b.co" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  return action;
}

describe("AuthForm", () => {
  it("sends the fields, including the redirect target, to the action", async () => {
    const action = submitWith({ status: "idle" });
    await waitFor(() => expect(action).toHaveBeenCalled());
    const formData = (action.mock.calls[0] as unknown[])[1] as FormData;
    expect(formData.get("email")).toBe("a@b.co");
    expect(formData.get("next")).toBe("/app/items");
  });

  it("shows the action's error", async () => {
    submitWith({ status: "error", message: "Incorrect email or password." });
    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
  });

  it("shows the check-your-email message", async () => {
    submitWith({ status: "check-email", message: "Check your email." });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
  });

  it("links sign-up and sign-in to each other", () => {
    render(<AuthForm mode="sign-up" action={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/login",
    );
  });
});
