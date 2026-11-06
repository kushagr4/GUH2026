// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SubscribeCallback = (state: string) => void;

const fake = vi.hoisted(() => {
  const state = {
    resolveAuth: () => {},
    rejectAuth: (() => {}) as (error: unknown) => void,
    subscribeCallback: undefined as ((state: string) => void) | undefined,
  };
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn((callback: (state: string) => void) => {
      state.subscribeCallback = callback;
      return channel;
    }),
  };
  const client = {
    realtime: {
      setAuth: vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            state.resolveAuth = resolve;
            state.rejectAuth = reject;
          }),
      ),
    },
    channel: vi.fn<(name: string, options?: unknown) => typeof channel>(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };
  return { state, channel, client };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => fake.client }));

const { useTableChanges } = await import("@/lib/realtime/use-table-changes");

function renderSubscription(enabled = true) {
  return renderHook(() =>
    useTableChanges({
      table: "things",
      filter: "owner_id=eq.user-1",
      enabled,
      onChange: () => {},
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.subscribeCallback = undefined;
});
afterEach(cleanup);

describe("useTableChanges", () => {
  it("loads the session token before joining, so RLS sees the signed-in user", async () => {
    const { result } = renderSubscription();
    expect(result.current).toBe("connecting");
    expect(fake.client.realtime.setAuth).toHaveBeenCalledOnce();
    // Joining now would send only the publishable key and be treated as anon.
    expect(fake.client.channel).not.toHaveBeenCalled();

    await act(async () => fake.state.resolveAuth());

    expect(fake.client.channel).toHaveBeenCalledOnce();
    expect(fake.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "things", filter: "owner_id=eq.user-1" },
      expect.any(Function),
    );
  });

  it("waits for the server to confirm the subscription before reporting live", async () => {
    const { result } = renderSubscription();
    await act(async () => fake.state.resolveAuth());

    const [, options] = fake.client.channel.mock.calls[0];
    expect(options).toEqual({ config: { postgres_changes_options: { wait: true } } });
    expect(result.current).toBe("connecting");

    act(() => (fake.state.subscribeCallback as SubscribeCallback)("SUBSCRIBED"));
    expect(result.current).toBe("live");
  });

  it("reports an error, not live, when the server refuses the subscription", async () => {
    const { result } = renderSubscription();
    await act(async () => fake.state.resolveAuth());
    act(() => (fake.state.subscribeCallback as SubscribeCallback)("CHANNEL_ERROR"));
    expect(result.current).toBe("error");
  });

  it("reports an error if the session token cannot be loaded", async () => {
    const { result } = renderSubscription();
    await act(async () => fake.state.rejectAuth(new Error("offline")));
    expect(result.current).toBe("error");
    expect(fake.client.channel).not.toHaveBeenCalled();
  });

  it("removes its channel on unmount", async () => {
    const { unmount } = renderSubscription();
    await act(async () => fake.state.resolveAuth());
    unmount();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(fake.channel);
  });

  it("never opens a channel if it unmounts before the token loads", async () => {
    const { unmount } = renderSubscription();
    unmount();
    await act(async () => fake.state.resolveAuth());
    expect(fake.client.channel).not.toHaveBeenCalled();
    expect(fake.client.removeChannel).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { result } = renderSubscription(false);
    expect(result.current).toBe("idle");
    expect(fake.client.realtime.setAuth).not.toHaveBeenCalled();
  });
});
