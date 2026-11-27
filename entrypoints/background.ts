import {
  createChromeRuntimeMessageListener,
  createRuntimeCommandHandler,
} from "../background/messages";
import {
  createSerializedStateReconciler,
  updateAutoRefreshTransaction,
} from "../background/auto-refresh";
import {
  createProviderService,
  type ProviderService,
} from "../background/provider-service";
import {
  projectAppViewState,
  projectRefreshReport,
} from "../background/view-state";
import type {
  InstanceAppState,
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/model";
import { createSignInWatcher } from "../background/saved-session-sign-in";
import { savedSessionSpecs } from "../providers/saved-session-specs";
import { providerRegistry } from "../providers/registry";
import type { ProviderPackage } from "../providers/types";
import { initializeCredentialVault } from "../storage/credentials";
import { migrateLegacyStorageInPlace } from "../storage/migration";
import { PERMISSION_INTENT_SWEEP_ALARM } from "../background/permission-intents";
import { registerToolbarPanel } from "../background/toolbar-panel";

const REFRESH_ALARM = "refresh-connected";
const REFRESH_PERIOD_MINUTES = 15;

async function ensureRefreshAlarm(): Promise<void> {
  const current = await browser.alarms.get(REFRESH_ALARM);
  if (current?.periodInMinutes === REFRESH_PERIOD_MINUTES) return;
  await browser.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
}

async function syncRefreshAlarm(state: InstanceAppState): Promise<void> {
  const shouldRefresh =
    state.preferences.autoRefresh &&
    state.instances.some((instance) => instance.access === "granted");
  if (!shouldRefresh) {
    await browser.alarms.clear(REFRESH_ALARM);
    return;
  }
  await ensureRefreshAlarm();
}

type StartupPackage = Pick<ProviderPackage, "startup">;

export interface BackgroundInitializationOptions {
  initializeVault(): Promise<void>;
  grantedPermissions(): Promise<Browser.permissions.Permissions>;
  migrate(
    now: number,
    granted: Browser.permissions.Permissions,
  ): Promise<unknown>;
  packages: readonly StartupPackage[];
  createService(): ProviderService;
  now(): number;
}

const productionOptions: BackgroundInitializationOptions = {
  initializeVault: initializeCredentialVault,
  grantedPermissions: () => browser.permissions.getAll(),
  migrate: migrateLegacyStorageInPlace,
  packages: Object.values(providerRegistry),
  createService: createProviderService,
  now: Date.now,
};

async function settlePackageStartup(
  packages: readonly StartupPackage[],
): Promise<void> {
  await Promise.all(
    packages.map(async (providerPackage) => {
      try {
        await providerPackage.startup?.();
      } catch {
        // A package hook must settle before activation but cannot expose its
        // cleanup error through an unhandled service-worker rejection.
      }
    }),
  );
}

interface ActivatedBackground {
  handleCommand(value: unknown): unknown;
  reconcilePermissions(
    change?: Browser.permissions.Permissions,
  ): Promise<void>;
  runScheduledRefresh(): Promise<void>;
  sweepPermissionIntents(): Promise<void>;
  listInstances(): Promise<ProviderInstanceRecord[]>;
  refreshAfterSignIn(instanceId: ProviderInstanceId): Promise<void>;
}

async function activateBackground(
  options: BackgroundInitializationOptions,
): Promise<ActivatedBackground> {
  await options.initializeVault();
  const granted = await options.grantedPermissions();
  await options.migrate(options.now(), granted);
  await settlePackageStartup(options.packages);

  const service = options.createService();
  const reconcileAlarm = createSerializedStateReconciler(
    () => service.getState(),
    syncRefreshAlarm,
  );
  await service.sweepPermissionIntents();
  await service.reconcilePermissions();
  await reconcileAlarm();

  const currentView = async () => projectAppViewState(await service.getState());
  const stateAfterAlarmReconciliation = async () => {
    await reconcileAlarm();
    return service.getState();
  };
  const commandHandler = createRuntimeCommandHandler({
    async refreshAll() {
      const report = await service.refreshAll("manual_all");
      const state = await stateAfterAlarmReconciliation();
      return {
        state: projectAppViewState(state),
        report: projectRefreshReport(report),
      };
    },
    async prepareProviderPermission(command) {
      const { type: _type, ...request } = command;
      const intent = await service.prepareProviderPermission(request);
      return { state: await currentView(), ...intent };
    },
    async resolveProviderPermission(permissionIntentId, granted) {
      await service.resolveProviderPermission(permissionIntentId, granted);
      return currentView();
    },
    async abandonProviderPermission(permissionIntentId) {
      await service.abandonProviderPermission(permissionIntentId);
      return currentView();
    },
    async connectBrowserProvider(providerKind, permissionIntentId) {
      const { report, signIn } = await service.connectBrowserProviderWithSignIn(
        providerKind,
        permissionIntentId,
      );
      const state = await stateAfterAlarmReconciliation();
      return {
        state: projectAppViewState(state),
        report: projectRefreshReport(report),
        ...(signIn === undefined ? {} : { signIn }),
      };
    },
    async openSignIn(providerKind) {
      return { opened: await service.openSignIn(providerKind) };
    },
    async connectApiKeyProvider(command) {
      const { type: _type, ...request } = command;
      const result = await service.connectApiKeyProvider(request);
      const state = await stateAfterAlarmReconciliation();
      return {
        ...result,
        report: projectRefreshReport(result.report),
        state: projectAppViewState(state),
      };
    },
    async refreshInstance(instanceId) {
      const report = await service.refreshInstance(
        instanceId,
        "manual_provider",
      );
      const state = await stateAfterAlarmReconciliation();
      return {
        state: projectAppViewState(state),
        report: projectRefreshReport(report),
      };
    },
    async renameInstance(instanceId, userLabel) {
      await service.renameInstance(instanceId, userLabel);
      return currentView();
    },
    async setInstanceHidden(instanceId, hidden) {
      await service.setInstanceHidden(instanceId, hidden);
      return currentView();
    },
    async reorderInstances(instanceIds) {
      await service.reorderInstances(instanceIds);
      return currentView();
    },
    async disconnectInstance(instanceId) {
      const result = await service.disconnectInstance(instanceId);
      const state = await stateAfterAlarmReconciliation();
      return { state: projectAppViewState(state), result };
    },
    getState: currentView,
    async setDisplayMode(mode) {
      await service.setDisplayMode(mode);
      return currentView();
    },
    async setHideExhausted(enabled) {
      await service.setHideExhausted(enabled);
      return currentView();
    },
    async setAutoRefresh(enabled) {
      await updateAutoRefreshTransaction(enabled, {
        readState: () => service.getState(),
        writePreference: (value) => service.setAutoRefresh(value),
        syncAlarm: () => reconcileAlarm(),
      });
      return currentView();
    },
    async deleteLocalData() {
      const result = await service.deleteAllLocalData();
      const state = await stateAfterAlarmReconciliation();
      return { state: projectAppViewState(state), ...result };
    },
  });

  return {
    handleCommand: commandHandler,
    async reconcilePermissions(change) {
      await service.reconcilePermissions(change);
      await reconcileAlarm();
    },
    async runScheduledRefresh() {
      try {
        await service.refreshAll("scheduled");
      } catch {
        // Scheduled work is best effort, but alarm authority is still restored.
      }
      await reconcileAlarm();
    },
    async sweepPermissionIntents() {
      await service.sweepPermissionIntents();
      await reconcileAlarm();
    },
    async listInstances() {
      return (await service.getState()).instances;
    },
    async refreshAfterSignIn(instanceId) {
      await service.refreshInstance(instanceId, "manual_provider");
      await reconcileAlarm();
    },
  };
}

export async function initializeBackground(
  options: BackgroundInitializationOptions = productionOptions,
): Promise<void> {
  await activateBackground(options);
}

export interface BackgroundEventRegistration {
  activation: Promise<void>;
}

export function registerBackgroundEventCapture(
  options: BackgroundInitializationOptions = productionOptions,
): BackgroundEventRegistration {
  registerToolbarPanel();

  let wakeEventQueue: Promise<void> = Promise.resolve();
  const activation = Promise.resolve().then(() => activateBackground(options));
  const enqueueWakeEvent = (
    run: (background: ActivatedBackground) => Promise<void>,
  ) => {
    const event = wakeEventQueue.then(() => activation).then(run);
    wakeEventQueue = event.catch(() => undefined);
  };

  browser.runtime.onMessage.addListener(
    createChromeRuntimeMessageListener((message) =>
      activation.then((background) => background.handleCommand(message)),
    ),
  );
  // Reads a connection that waits for a sign-in as soon as it lands. The
  // cookies API exists only while its optional permission is granted.
  const signInWatcher = createSignInWatcher({
    specs: savedSessionSpecs,
    listInstances: () => activation.then((background) => background.listInstances()),
    refreshInstance: (instance) =>
      activation.then((background) => background.refreshAfterSignIn(instance.id)),
  });
  let watchingSignIns = false;
  const watchSignIns = () => {
    if (watchingSignIns) return;
    try {
      const cookies = (browser as { cookies?: typeof browser.cookies }).cookies;
      if (!cookies?.onChanged) return;
      cookies.onChanged.addListener(signInWatcher);
      watchingSignIns = true;
    } catch {
      // Without the cookies API, connections refresh on the usual schedule.
    }
  };
  watchSignIns();
  browser.permissions.onAdded.addListener(() => {
    watchSignIns();
    enqueueWakeEvent((background) => background.reconcilePermissions());
  });
  browser.permissions.onRemoved.addListener((removed) => {
    enqueueWakeEvent((background) =>
      background.reconcilePermissions(removed),
    );
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      enqueueWakeEvent((background) => background.runScheduledRefresh());
    } else if (alarm.name === PERMISSION_INTENT_SWEEP_ALARM) {
      enqueueWakeEvent((background) => background.sweepPermissionIntents());
    }
  });

  return { activation: activation.then(() => undefined) };
}

export default defineBackground(() => {
  const registration = registerBackgroundEventCapture();
  void registration.activation.catch(() => undefined);
});
