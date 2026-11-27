import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderInstanceView } from "../../../domain/public-protocol";
import { AddAccountView, type AddAccountStart } from "./AddAccountView";

afterEach(cleanup);

const WAITING = "cursor:8d0fec33-3f1f-4637-93a5-4e9f976dc204" as const;

function waitingCard(outcome: "signed_out" | "success"): ProviderInstanceView {
  return {
    id: WAITING,
    providerKind: "cursor",
    access: "granted",
    hidden: false,
    history: [],
    lastAttempt: {
      trigger: "connect",
      startedAt: 1,
      finishedAt: 2,
      outcome:
        outcome === "success"
          ? { kind: "success" }
          : { kind: "failure", category: "signed_out" },
    },
  } as unknown as ProviderInstanceView;
}

function renderView(
  start: AddAccountStart,
  instances: ProviderInstanceView[] = [],
  overrides: Partial<React.ComponentProps<typeof AddAccountView>> = {},
) {
  const props: React.ComponentProps<typeof AddAccountView> = {
    providerKind: "cursor",
    instances,
    labelForInstance: () => "Cursor · work",
    backLabel: "Back",
    onBack: vi.fn(),
    onFinish: vi.fn(),
    onStart: vi.fn(async () => start),
    onOpenSignIn: vi.fn(async () => true),
    onCancel: vi.fn(),
    ...overrides,
  };
  const view = render(<AddAccountView {...props} />);
  return { props, view };
}

describe("AddAccountView", () => {
  it("explains every step before asking for anything", () => {
    renderView({ kind: "failed" });
    expect(screen.getByText("Allow AI Limits to save sign-ins")).toBeInTheDocument();
    expect(
      screen.getByText("Save your current account and sign this browser out"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in to the other account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow and continue" })).toBeInTheDocument();
  });

  it("waits for the sign-in, then finishes on its own once the new card reads", async () => {
    const { props, view } = renderView({ kind: "waiting", instanceId: WAITING });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));

    await screen.findByText("Waiting for you to sign in…");
    view.rerender(
      <AddAccountView {...props} instances={[waitingCard("signed_out")]} />,
    );
    expect(screen.getByText("Waiting for you to sign in…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Cursor sign-in" }));
    await waitFor(() => expect(props.onOpenSignIn).toHaveBeenCalledWith("cursor"));

    view.rerender(<AddAccountView {...props} instances={[waitingCard("success")]} />);
    await screen.findByText("Added Cursor · work.");
    fireEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    expect(props.onFinish).toHaveBeenCalled();
  });

  it("says so when the same account signs in again, and offers to try again", async () => {
    const { props, view } = renderView({ kind: "waiting", instanceId: WAITING });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText("Waiting for you to sign in…");
    view.rerender(
      <AddAccountView {...props} instances={[waitingCard("signed_out")]} />,
    );
    // The background removes a card that turned out to be a known account.
    view.rerender(<AddAccountView {...props} instances={[]} />);

    await screen.findByText(/^That's an account you already added\. Sign in with a different Cursor account/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(props.onStart).toHaveBeenCalledTimes(2));
  });

  it("tells the user nothing changed when the current sign-in could not be saved", async () => {
    renderView({ kind: "not_saved" });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText(/couldn't save the Cursor sign-in/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says so when a tab of the site is still signed in", async () => {
    renderView({ kind: "still_signed_in" });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText(/a Cursor tab in this browser is still signed in/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers the permission again after it was declined", async () => {
    renderView({ kind: "declined" });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText(/Adding an account needs this permission/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps following the steps under StrictMode", async () => {
    const props: React.ComponentProps<typeof AddAccountView> = {
      providerKind: "cursor",
      instances: [],
      labelForInstance: () => "Cursor · work",
      backLabel: "Back",
      onBack: vi.fn(),
      onFinish: vi.fn(),
      onStart: vi.fn(async () => ({ kind: "waiting", instanceId: WAITING }) as const),
      onOpenSignIn: vi.fn(async () => true),
      onCancel: vi.fn(),
    };
    render(
      <React.StrictMode>
        <AddAccountView {...props} />
      </React.StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText("Waiting for you to sign in…");
  });

  it("cancels a waiting card", async () => {
    const { props } = renderView({ kind: "tab_failed", instanceId: WAITING });
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByText("The sign-in page didn't open. Open it here.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledWith(WAITING);
    expect(props.onBack).toHaveBeenCalled();
  });
});
