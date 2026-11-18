// Opens the cockpit when the toolbar button is clicked.
//
// Chromium (Chrome, Edge) has `sidePanel`, which opens the panel natively on
// action click. Firefox has no `sidePanel`; WXT maps the same entrypoint to
// `sidebar_action`, and the sidebar is toggled from the action click instead.
// `sidebarAction.toggle()` must run synchronously inside the click handler,
// which is why the listener calls it directly.

interface SidePanelApi {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
}

interface SidebarActionApi {
  toggle(): Promise<void>;
}

interface ActionClickApi {
  onClicked: { addListener(listener: () => void): void };
}

export interface ToolbarPanelApis {
  sidePanel?: SidePanelApi;
  sidebarAction?: SidebarActionApi;
  action?: ActionClickApi;
}

export function registerToolbarPanel(
  apis: ToolbarPanelApis = browser as unknown as ToolbarPanelApis,
): void {
  if (apis.sidePanel?.setPanelBehavior) {
    void apis.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => {
        console.error("Unable to enable toolbar side-panel behavior.", error);
      });
    return;
  }

  const sidebarAction = apis.sidebarAction;
  if (sidebarAction?.toggle && apis.action?.onClicked) {
    apis.action.onClicked.addListener(() => {
      void sidebarAction.toggle().catch((error) => {
        console.error("Unable to toggle the sidebar.", error);
      });
    });
  }
}
