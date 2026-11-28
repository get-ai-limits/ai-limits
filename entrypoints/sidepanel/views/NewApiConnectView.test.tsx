import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewApiConnectView } from "./NewApiConnectView";

afterEach(cleanup);

function renderView(
  overrides: Partial<React.ComponentProps<typeof NewApiConnectView>> = {},
) {
  const props: React.ComponentProps<typeof NewApiConnectView> = {
    providerKind: "newapi",
    guideKind: "newapi",
    mode: "connect",
    backLabel: "Add provider",
    onBack: vi.fn(),
    onSubmit: vi.fn(async () => "temporary_error" as const),
    ...overrides,
  };
  render(<NewApiConnectView {...props} />);
  return props;
}

describe("NewApiConnectView", () => {
  it("renders configurable-key onboarding for the selected provider identity", () => {
    renderView({ providerKind: "litellm", guideKind: undefined });

    expect(
      screen.getByRole("heading", { level: 1, name: "Connect LiteLLM" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "LiteLLM" })).toBeVisible();
    expect(screen.getByLabelText("LiteLLM instance URL")).toBeVisible();
    expect(screen.getByLabelText("LiteLLM API key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByText("Base URL of your LiteLLM instance. HTTPS required."))
      .toBeVisible();
    expect(screen.queryByText(/New API relay key setup/)).not.toBeInTheDocument();
  });

  it("submits an optional trimmed instance label and clears a blank label", async () => {
    const onSubmit = vi.fn(async () => "invalid_key" as const);
    renderView({ onSubmit });

    fireEvent.change(screen.getByLabelText("Instance label (optional)"), {
      target: { value: "  Personal relay  " },
    });
    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://relay.example" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "candidate" },
    });
    fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "https://relay.example",
        "candidate",
        "Personal relay",
      ),
    );
  });

  it("keeps the relay-key warning short and moves the background to the help page", () => {
    renderView();

    expect(screen.getByRole("heading", { level: 1, name: "Connect New API" })).toBeVisible();
    expect(screen.getByText("Independent instance · Independent relay key")).toBeVisible();
    expect(screen.getByText(/the key can still call models, so limit it in New API/i)).toBeVisible();
    expect(screen.queryByText(/does not read account wallet/i)).not.toBeInTheDocument();
  });

  it("explains tolerant normalization while submitting the raw URL to package authority", async () => {
    const onSubmit = vi.fn(async () => "invalid_key" as const);
    renderView({ onSubmit });

    expect(screen.getByText("Homepage, dashboard or API URL. HTTPS required.")).toBeVisible();

    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://API.example.com/new-api/v1/messages" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: " sk-test " },
    });
    fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "https://API.example.com/new-api/v1/messages",
        " sk-test ",
      ),
    );
    expect(screen.getByLabelText("New API site URL")).toHaveValue(
      "https://API.example.com/new-api/v1/messages",
    );
    expect(screen.getByLabelText("New API relay key")).toHaveValue("");
  });

  it("forwards any nonblank raw URL to package validation", async () => {
    const onSubmit = vi.fn(async () => "invalid_site" as const);
    renderView({ onSubmit });
    const site = screen.getByLabelText("New API site URL");
    const key = screen.getByLabelText("New API relay key");
    const submit = screen.getByRole("button", { name: "Validate & connect" });

    fireEvent.change(site, { target: { value: "api.example.com/v1" } });
    fireEvent.change(key, { target: { value: "sk-test" } });
    expect(submit).toBeEnabled();
    fireEvent.submit(submit);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("api.example.com/v1", "sk-test"),
    );
  });

  it.each([
    ["invalid_site", "This site did not return compatible New API status and usage data."],
    ["invalid_key", "Enter a valid relay key for this New API instance."],
    ["insufficient_scope", "This relay key could not read its usage."],
    ["temporary_error", "New API could not be validated right now."],
    ["permission_declined", "New API access was not changed."],
  ] as const)("shows actionable %s feedback without echoing the key", async (result, copy) => {
    renderView({ onSubmit: vi.fn(async () => result) });
    fireEvent.change(screen.getByLabelText("New API site URL"), {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(screen.getByLabelText("New API relay key"), {
      target: { value: "secret-relay-key" },
    });
    fireEvent.submit(within(screen.getByRole("form")).getByRole("button"));

    expect(await screen.findByText(copy, { exact: false })).toBeVisible();
    expect(document.body).not.toHaveTextContent("secret-relay-key");
  });
});
