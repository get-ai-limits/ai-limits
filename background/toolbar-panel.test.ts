import { describe, expect, test, vi } from "vitest";

import { registerToolbarPanel } from "./toolbar-panel";

describe("toolbar panel", () => {
  test("uses the native side panel when the browser has one", () => {
    const setPanelBehavior = vi.fn(async () => {});
    const toggle = vi.fn(async () => {});
    const addListener = vi.fn();

    registerToolbarPanel({
      sidePanel: { setPanelBehavior },
      sidebarAction: { toggle },
      action: { onClicked: { addListener } },
    });

    expect(setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    expect(addListener).not.toHaveBeenCalled();
  });

  test("toggles the sidebar on toolbar click when there is no side panel", () => {
    const toggle = vi.fn(async () => {});
    let onClick: (() => void) | undefined;

    registerToolbarPanel({
      sidebarAction: { toggle },
      action: {
        onClicked: {
          addListener: (listener) => {
            onClick = listener;
          },
        },
      },
    });

    expect(toggle).not.toHaveBeenCalled();
    onClick?.();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  test("does nothing when neither panel API exists", () => {
    expect(() => registerToolbarPanel({})).not.toThrow();
  });
});
