import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AppViewState,
  ProviderInstanceView,
} from "../../domain/public-protocol";
import { createEmptyFixtureState } from "../../providers/fixtures";
import { withInstanceHidden, withInstanceOrder } from "./arrangement";
import { Cockpit } from "./Cockpit";

const NOW = Date.UTC(2026, 7, 7, 16);

afterEach(cleanup);

function instance(
  id: string,
  overrides: Partial<ProviderInstanceView> = {},
): ProviderInstanceView {
  return {
    id,
    providerKind: id.slice(0, id.indexOf(":")) as ProviderInstanceView["providerKind"],
    access: "granted",
    createdAt: NOW,
    history: [],
    ...overrides,
  };
}

function arrangedState(
  instances: ProviderInstanceView[],
  hideExhausted = false,
): AppViewState {
  return {
    preferences: { displayMode: "used", autoRefresh: true, hideExhausted },
    providers: createEmptyFixtureState().providers,
    instances,
  };
}

function renderArranged(
  instances: ProviderInstanceView[],
  { hideExhausted = false }: { hideExhausted?: boolean } = {},
) {
  const onReorderInstances = vi.fn();
  const onSetInstanceHidden = vi.fn();
  const onHideExhaustedChange = vi.fn();
  const view = render(
    <Cockpit
      state={arrangedState(instances, hideExhausted)}
      now={NOW}
      onDisplayModeChange={vi.fn()}
      onRefresh={vi.fn()}
      onConnectProvider={vi.fn()}
      onReorderInstances={onReorderInstances}
      onSetInstanceHidden={onSetInstanceHidden}
      onHideExhaustedChange={onHideExhaustedChange}
    />,
  );
  return { ...view, onReorderInstances, onSetInstanceHidden, onHideExhaustedChange };
}

function usedUpClaude(resetsAt = NOW + 2 * 60 * 60 * 1_000): Partial<ProviderInstanceView> {
  return {
    snapshot: {
      providerKind: "claude",
      source: "web-session",
      fetchedAt: NOW,
      metrics: [
        {
          type: "quota",
          id: "five-hour",
          label: "5-hour messages",
          scope: "general",
          usedRatio: 1,
          cycle: { cadence: "rolling", resetsAt },
        },
      ],
    },
  };
}

function overviewCardNames() {
  return screen
    .getAllByRole("button", { name: /^Refresh (?!usage)/ })
    .map((button) => button.getAttribute("aria-label")?.replace("Refresh ", ""));
}

describe("provider arrangement", () => {
  it("keeps hidden providers off the Overview cards and offers to show them", () => {
    const { onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default", { hidden: true }),
      instance("kimi:default"),
    ]);

    expect(overviewCardNames()).toEqual(["ChatGPT", "Kimi"]);
    expect(screen.getByText("1 hidden")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Claude" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("claude:default", false);
  });

  it("explains an all-hidden Overview and shows every provider again", () => {
    const { onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default", { hidden: true }),
      instance("claude:default", { hidden: true }),
    ]);

    expect(
      screen.getByRole("heading", { name: "Every provider is hidden" }),
    ).toBeVisible();
    expect(screen.queryByText("2 hidden")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onSetInstanceHidden.mock.calls).toEqual([
      ["chatgpt:default", false],
      ["claude:default", false],
    ]);
  });

  it("keeps used-up plans on the Overview until the setting hides them", () => {
    renderArranged([
      instance("chatgpt:default"),
      instance("claude:default", usedUpClaude()),
    ]);
    expect(overviewCardNames()).toEqual(["ChatGPT", "Claude"]);
    expect(screen.queryByText(/hidden$/)).toBeNull();
  });

  it("moves used-up plans into the hidden list with when they come back", () => {
    const resetsAt = NOW + 2 * 60 * 60 * 1_000;
    renderArranged(
      [
        instance("chatgpt:default"),
        instance("claude:default", usedUpClaude(resetsAt)),
        instance("kimi:default", { hidden: true }),
      ],
      { hideExhausted: true },
    );

    expect(overviewCardNames()).toEqual(["ChatGPT"]);
    expect(screen.getByText("2 hidden")).toBeInTheDocument();
    expect(screen.getByText(/^Used up · Resets /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Kimi" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Claude" }));
    expect(
      screen.getByRole("heading", { level: 1, name: /Claude/ }),
    ).toBeVisible();
  });

  it("reopens the hidden list when returning from a used-up plan", () => {
    renderArranged(
      [instance("chatgpt:default"), instance("claude:default", usedUpClaude())],
      { hideExhausted: true },
    );
    fireEvent.click(screen.getByText("1 hidden"));
    fireEvent.click(screen.getByRole("button", { name: "View Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    const view = screen.getByRole("button", { name: "View Claude" });
    expect(view.closest("details")).toHaveProperty("open", true);
    expect(view).toHaveFocus();
  });

  it("keeps a used-up plan's card when its last refresh failed", () => {
    renderArranged(
      [
        instance("claude:default", {
          ...usedUpClaude(),
          lastAttempt: {
            trigger: "manual_provider",
            startedAt: NOW,
            finishedAt: NOW,
            outcome: { kind: "failure", category: "signed_out" },
          },
        }),
      ],
      { hideExhausted: true },
    );
    expect(overviewCardNames()).toEqual(["Claude"]);
  });

  it("moves focus to the hidden list when a focused card becomes used up", () => {
    const view = renderArranged(
      [instance("chatgpt:default"), instance("claude:default")],
      { hideExhausted: true },
    );
    screen.getByRole("button", { name: "Refresh Claude" }).focus();
    view.rerender(
      <Cockpit
        state={arrangedState(
          [instance("chatgpt:default"), instance("claude:default", usedUpClaude())],
          true,
        )}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
      />,
    );
    expect(screen.getByText("1 hidden")).toHaveFocus();
  });

  it("brings a used-up plan back once its window resets", () => {
    renderArranged(
      [instance("claude:default", usedUpClaude(NOW - 1))],
      { hideExhausted: true },
    );
    expect(overviewCardNames()).toEqual(["Claude"]);
  });

  it("explains an Overview where every plan is used up", () => {
    renderArranged(
      [instance("claude:default", usedUpClaude())],
      { hideExhausted: true },
    );
    expect(
      screen.getByRole("heading", { name: "Every plan is used up for now" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.getByText("1 hidden")).toBeInTheDocument();
  });

  it("turns hiding used-up plans on from Settings", () => {
    const { onHideExhaustedChange } = renderArranged([instance("chatgpt:default")]);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const toggle = screen.getByRole("switch", { name: "Hide used-up plans" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onHideExhaustedChange).toHaveBeenCalledWith(true);
  });

  it("arranges connected providers by keyboard without moving ones awaiting reconnection", () => {
    const { onReorderInstances, onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("grok:default", { access: "required" }),
      instance("claude:default", { hidden: true }),
      instance("kimi:default"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveFocus();

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "ChatGPT",
      "Claude",
      "Kimi",
    ]);
    expect(
      screen.getByRole("switch", { name: "Show Claude on Overview" }),
    ).not.toBeChecked();

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Kimi" }), {
      key: "ArrowUp",
    });
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "chatgpt:default",
      "grok:default",
      "kimi:default",
      "claude:default",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kimi moved to position 2 of 3.",
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Kimi" }), {
      key: "Home",
    });
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "kimi:default",
      "grok:default",
      "chatgpt:default",
      "claude:default",
    ]);

    fireEvent.click(screen.getByRole("switch", { name: "Show ChatGPT on Overview" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("chatgpt:default", true);

    fireEvent.click(done);
    expect(screen.getByRole("button", { name: "Arrange providers" })).toHaveFocus();
  });

  it("drags a provider by its handle to the slot under the pointer", () => {
    const { onReorderInstances } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
      instance("kimi:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    rows.forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: index * 50,
        height: 50,
        bottom: index * 50 + 50,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: index * 50,
        toJSON: () => ({}),
      });
    });

    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 25 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 130 });
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Claude", "Kimi", "ChatGPT"]);
    expect(onReorderInstances).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 130 });
    expect(onReorderInstances).toHaveBeenCalledWith([
      "claude:default",
      "kimi:default",
      "chatgpt:default",
    ]);
  });

  it("keeps a drag in step with providers that disconnect meanwhile", () => {
    const { onReorderInstances, rerender } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
      instance("kimi:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move Kimi" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });

    rerender(
      <Cockpit
        state={arrangedState([instance("chatgpt:default"), instance("kimi:default")])}
        now={NOW}
        onDisplayModeChange={vi.fn()}
        onRefresh={vi.fn()}
        onConnectProvider={vi.fn()}
        onReorderInstances={onReorderInstances}
      />,
    );
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["ChatGPT", "Kimi"]);

    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -10 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: -10 });
    expect(onReorderInstances).toHaveBeenCalledWith([
      "kimi:default",
      "chatgpt:default",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kimi moved to position 1 of 2.",
    );
  });

  it("drops a cancelled drag without saving", () => {
    const { onReorderInstances } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onReorderInstances).not.toHaveBeenCalled();
  });

  it("moves and hides providers from Settings", () => {
    const { onReorderInstances, onSetInstanceHidden } = renderArranged([
      instance("chatgpt:default"),
      instance("claude:default", { hidden: true }),
      instance("grok:default", { access: "required" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Move ChatGPT up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Grok down" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Show on Overview: Grok" }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Show on Overview: Claude" }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Move Claude up" }));
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "claude:default",
      "chatgpt:default",
      "grok:default",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Move Claude down" }));
    expect(onReorderInstances).toHaveBeenLastCalledWith([
      "chatgpt:default",
      "grok:default",
      "claude:default",
    ]);

    fireEvent.click(screen.getByRole("switch", { name: "Show on Overview: Claude" }));
    expect(onSetInstanceHidden).toHaveBeenCalledWith("claude:default", false);
  });

  it("keeps keyboard focus on the handle as the row moves", () => {
    function Stateful() {
      const [state, setState] = useState(() =>
        arrangedState([
          instance("chatgpt:default"),
          instance("claude:default"),
          instance("kimi:default"),
        ]),
      );
      return (
        <Cockpit
          state={state}
          now={NOW}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={vi.fn()}
          onReorderInstances={(ids) =>
            setState((current) => withInstanceOrder(current, ids))
          }
        />
      );
    }
    render(<Stateful />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange providers" }));
    const handle = screen.getByRole("button", { name: "Move ChatGPT" });
    handle.focus();

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });

    expect(screen.getByRole("button", { name: "Move ChatGPT" })).toHaveFocus();
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Claude", "Kimi", "ChatGPT"]);
  });

  it("moves focus to a provider's card after showing it", () => {
    function Stateful() {
      const [state, setState] = useState(() =>
        arrangedState([
          instance("chatgpt:default"),
          instance("claude:default", { hidden: true }),
        ]),
      );
      return (
        <Cockpit
          state={state}
          now={NOW}
          onDisplayModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onConnectProvider={vi.fn()}
          onSetInstanceHidden={(id, hidden) =>
            setState((current) => withInstanceHidden(current, id, hidden))
          }
        />
      );
    }
    render(<Stateful />);
    fireEvent.click(screen.getByRole("button", { name: "Show Claude" }));
    expect(document.activeElement).toHaveAttribute(
      "data-focus-key",
      "overview-provider-claude:default",
    );
  });
});
