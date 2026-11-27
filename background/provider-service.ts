import type {
  InstanceAppState,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/model";
import type {
  DisplayMode,
  ProviderRefreshOutcome,
  RefreshReport,
  RefreshTrigger,
} from "../domain/model";
import type {
  AddAccountSignIn,
  ApiKeyConnectionStatus,
  ConnectApiKeyProviderResult,
  DisconnectInstanceResult,
} from "../domain/public-protocol";
import type {
  ApiKeyProviderKind,
  BrowserSessionProviderKind,
  ProviderKind,
} from "../providers/catalog";
import { providerRegistry } from "../providers/registry";
import type { ProviderPackage } from "../providers/types";
import {
  deleteAllCredentials,
  deleteCredential,
  markCredentialRejectedIfRevision,
  readCredentialWithRevision,
  restoreCredentialIfRevision,
  saveApiKeyIfCurrent,
} from "../storage/credentials";
import {
  connectionRepository,
  deleteAllInstanceData,
  loadInstanceAppState,
  preferencesRepository,
  usageRepository,
} from "../storage/repository";
import {
  applyCollectedOutcome,
  refreshProviderInstance,
} from "./coordinator";
import {
  createApiKeyConnectionLifecycle,
} from "./api-key-connection";
import {
  createRefreshOrchestrator,
  type RefreshPolicy,
} from "./orchestrator";
import {
  hasInstancePermission,
  permissionChangeAffectsInstance,
  requiredPermissionsForInstance,
  removeAllInstancePermissions,
  removeUnusedInstancePermissions,
} from "./permissions";
import { isProviderRefreshEligible } from "./provider-access";
import {
  browserSavedSessionEnvironment,
  parkLiveSession,
  removeSavedSessionRule,
  SAVED_SESSION_PERMISSION,
  type SavedSessionEnvironment,
} from "../providers/saved-session";
import {
  deleteAllSavedSessions,
  deleteSavedSession,
} from "../storage/saved-sessions";
import { markAwaitingSignIn } from "./saved-session-sign-in";
import { createProviderOperationLane } from "./provider-operation-lane";
import { createKeyedSerialExecutor } from "./keyed-serial";
import {
  createPermissionIntentStore,
  type PermissionIntentCandidate,
  type StoredPermissionIntent,
} from "./permission-intents";

export type ProviderPackageRegistry = {
  [Kind in ProviderKind]: ProviderPackage;
};

export interface ConnectApiKeyProviderRequest {
  providerKind: ApiKeyProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
  apiKey: string;
  permissionIntentId: string;
}

export interface PrepareProviderPermissionRequest {
  providerKind: ProviderKind;
  instanceId?: ProviderInstanceId;
  userLabel?: string;
  config: ProviderInstanceConfig;
}

export interface PrepareProviderPermissionResult {
  permissionIntentId: string;
  instanceId: ProviderInstanceId;
  normalizedConfig: ProviderInstanceConfig;
  permissions: Browser.permissions.Permissions;
}

export type {
  ConnectApiKeyProviderResult,
  DisconnectInstanceResult,
} from "../domain/public-protocol";

export interface ProviderService {
  prepareProviderPermission(
    request: PrepareProviderPermissionRequest,
  ): Promise<PrepareProviderPermissionResult>;
  resolveProviderPermission(
    permissionIntentId: string,
    granted: boolean,
  ): Promise<void>;
  abandonProviderPermission(permissionIntentId: string): Promise<void>;
  sweepPermissionIntents(): Promise<void>;
  connectBrowserProvider(
    providerKind: BrowserSessionProviderKind,
    permissionIntentId: string,
  ): Promise<RefreshReport>;
  /** Connects, and says how Add account's sign-in for the next account went. */
  connectBrowserProviderWithSignIn(
    providerKind: BrowserSessionProviderKind,
    permissionIntentId: string,
  ): Promise<{ report: RefreshReport; signIn?: AddAccountSignIn }>;
  /** Opens the provider's sign-in page again and watches for the sign-in. */
  openSignIn(providerKind: ProviderKind): Promise<boolean>;
  connectApiKeyProvider(
    request: ConnectApiKeyProviderRequest,
  ): Promise<ConnectApiKeyProviderResult>;
  refreshInstance(
    instanceId: ProviderInstanceId,
    trigger: "connect" | "manual_provider",
  ): Promise<RefreshReport>;
  refreshAll(trigger: "manual_all" | "scheduled"): Promise<RefreshReport>;
  renameInstance(instanceId: ProviderInstanceId, userLabel?: string): Promise<void>;
  setInstanceHidden(instanceId: ProviderInstanceId, hidden: boolean): Promise<void>;
  reorderInstances(instanceIds: readonly ProviderInstanceId[]): Promise<void>;
  disconnectInstance(instanceId: ProviderInstanceId): Promise<DisconnectInstanceResult>;
  reconcilePermissions(change?: Browser.permissions.Permissions): Promise<void>;
  deleteAllLocalData(): Promise<{
    result: "deleted" | "deleted_with_permission_errors";
  }>;
  getState(): Promise<InstanceAppState>;
  setDisplayMode(mode: DisplayMode): Promise<void>;
  setAutoRefresh(enabled: boolean): Promise<void>;
  setHideExhausted(enabled: boolean): Promise<void>;
}

export interface ProviderServiceOptions {
  packages?: ProviderPackageRegistry;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
  randomUUID?: () => string;
  permissionIntentTtlMs?: number;
  savedSessionEnvironment?: SavedSessionEnvironment;
  /** Opens the provider's sign-in page for another account. */
  openSignInTab?: (url: string) => Promise<void>;
  /** Drops the optional cookies permission once nothing uses it. */
  removeSavedSessionPermission?: () => Promise<void>;
}

async function openSignInTabInBrowser(url: string): Promise<void> {
  await browser.tabs.create({ url, active: true });
}

async function removeCookiesPermission(): Promise<void> {
  await browser.permissions.remove({ permissions: [SAVED_SESSION_PERMISSION] });
}

function normalizedLabel(value: string | undefined): string | undefined {
  const label = value?.trim();
  return label ? label : undefined;
}

function backoffRetryAt(instance: ProviderInstanceRecord): number | undefined {
  const outcome = instance.lastAttempt?.outcome;
  if (
    outcome?.kind === "failure" &&
    outcome.category === "temporary_error"
  ) {
    return outcome.retryAt;
  }
  if (outcome?.kind === "deferred" && outcome.reason === "backoff") {
    return outcome.retryAt;
  }
  return undefined;
}

function connectReport(
  instanceId: ProviderInstanceId,
  startedAt: number,
  finishedAt: number,
  outcome: ProviderRefreshOutcome,
): RefreshReport {
  return {
    trigger: "connect",
    startedAt,
    finishedAt,
    results: [{ instanceId, outcome }],
  };
}

export function createProviderService(
  options: ProviderServiceOptions = {},
): ProviderService {
  const packages = options.packages ?? providerRegistry;

  async function forgetPackageSession(kind: ProviderKind): Promise<void> {
    try {
      await packages[kind].forgetSession?.();
    } catch {
      // Held sessions live only in memory-backed storage; failing to drop one
      // early must not block removing the instance's saved data.
    }
  }
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const clock = options.clock ?? Date.now;
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const savedSessionEnvironment =
    options.savedSessionEnvironment ?? browserSavedSessionEnvironment;
  const openSignInTab = options.openSignInTab ?? openSignInTabInBrowser;
  const removeSavedSessionPermission =
    options.removeSavedSessionPermission ?? removeCookiesPermission;

  /**
   * Saved sign-ins need the cookies permission only while a connection that
   * can keep one exists. Once none does, the permission and every saved
   * sign-in go.
   */
  async function releaseUnusedSavedSessions(
    removedKinds: readonly ProviderKind[],
  ): Promise<void> {
    if (!removedKinds.some((kind) => packages[kind].savedSession)) return;
    try {
      const instances = await connectionRepository.list();
      if (instances.some(({ providerKind }) => packages[providerKind].savedSession)) {
        return;
      }
      await deleteAllSavedSessions();
      await dropSavedSessionRules();
      if (await savedSessionEnvironment.cookies()) {
        await removeSavedSessionPermission();
      }
    } catch {
      // Best effort: a saved sign-in is also dropped with its connection.
    }
  }

  /** Drops any replay rule a stopped service worker left behind. */
  async function dropSavedSessionRules(): Promise<void> {
    for (const kind of Object.keys(packages) as ProviderKind[]) {
      const spec = packages[kind].savedSession;
      if (!spec) continue;
      await removeSavedSessionRule(spec, savedSessionEnvironment.rules).catch(
        () => undefined,
      );
    }
  }

  /**
   * A connection that never read anything and turns out to be a login another
   * connection already tracks is removed, so retrying Add account never piles
   * up copies of one account.
   */
  const connectingInstanceIds = new Set<string>();

  /** A connection that never read an account: nothing on it would be lost. */
  function isEmptyConnection(instance: ProviderInstanceRecord): boolean {
    return (
      instance.accountKey === undefined &&
      instance.snapshot === undefined &&
      instance.history.length === 0
    );
  }

  async function removeEmptyDuplicates(
    report: RefreshReport,
  ): Promise<RefreshReport> {
    for (const { instanceId, outcome } of report.results) {
      if (outcome.kind !== "failure" || outcome.category !== "duplicate_account") {
        continue;
      }
      // The connect flow decides about a connection it is still adding.
      if (connectingInstanceIds.has(instanceId)) continue;
      try {
        // Checked under the connection's locks, so a read that bound it in
        // the meantime keeps it.
        await disconnectInstanceIf(
          instanceId,
          (instance) =>
            instance.accountKey === undefined &&
            instance.snapshot === undefined &&
            instance.history.length === 0 &&
            // A later read (such as Add account's own, after signing the
            // browser out) supersedes this report.
            instance.lastAttempt?.outcome.kind === "failure" &&
            instance.lastAttempt.outcome.category === "duplicate_account",
        );
      } catch {
        // Left for the next refresh; it never shows another account's data.
      }
    }
    return report;
  }

  /** Opens the sign-in page and watches for the sign-in that follows. */
  async function startSignIn(providerKind: ProviderKind): Promise<boolean> {
    const spec = packages[providerKind].savedSession;
    if (!spec) return false;
    try {
      await markAwaitingSignIn(providerKind, clock());
      await openSignInTab(spec.signInUrl);
      return true;
    } catch {
      return false;
    }
  }
  const lanes = createProviderOperationLane();
  const apiKeyConnections = createApiKeyConnectionLifecycle();
  const withInstanceConnectionLock =
    createKeyedSerialExecutor<ProviderInstanceId>();
  const withPermissionOwnershipLock = createKeyedSerialExecutor<"permissions">();
  const permissionIntents = createPermissionIntentStore({
    clock,
    randomUUID,
    ttlMs: options.permissionIntentTtlMs,
  });
  let reconciliationGeneration = 0;
  let lifecycleGeneration = 0;
  let deleteAllDepth = 0;

  const beginConnectionGeneration = (): number => {
    if (deleteAllDepth > 0) throw new Error("Provider connection is unavailable.");
    return lifecycleGeneration;
  };
  const isConnectionGenerationCurrent = (generation: number): boolean =>
    deleteAllDepth === 0 && lifecycleGeneration === generation;

  const ownerFromStoredCandidate = (
    candidate: PermissionIntentCandidate,
  ): ProviderInstanceRecord => ({
    ...candidate,
    access: "required",
    history: [],
  });

  const allPermissionOwners = async (): Promise<ProviderInstanceRecord[]> => [
    ...(await connectionRepository.list()),
    ...(await permissionIntents.listActiveCandidates()),
  ];

  const cleanupPermissionOwner = async (
    removed: ProviderInstanceRecord,
  ): Promise<boolean> =>
    removeUnusedInstancePermissions(
      removed,
      await allPermissionOwners(),
      packages,
    );

  const completePermissionCleanup = async (
    evidence: StoredPermissionIntent,
  ): Promise<boolean> => {
    const removed = await cleanupPermissionOwner(
      ownerFromStoredCandidate(evidence.candidate),
    );
    if (removed) await permissionIntents.completeCleanup(evidence.id);
    return removed;
  };

  async function buildPermissionCandidate(
    request: PrepareProviderPermissionRequest,
  ): Promise<ProviderInstanceRecord> {
    const providerPackage = packages[request.providerKind];
    const config = providerPackage.normalizeConfig(request.config);
    if (!config) throw new Error("Provider configuration is invalid.");
    const instances = await connectionRepository.list();
    const requested = request.instanceId
      ? instances.find(({ id }) => id === request.instanceId)
      : undefined;
    if (
      request.instanceId &&
      (!requested || requested.providerKind !== request.providerKind)
    ) {
      throw new Error("Provider permission intent failed.");
    }
    const existing =
      requested ??
      (providerPackage.cardinality === "single"
        ? instances.find(
            ({ providerKind }) => providerKind === request.providerKind,
          )
        : undefined);
    const instanceId =
      existing?.id ??
      (providerPackage.cardinality === "single"
        ? `${request.providerKind}:default`
        : `${request.providerKind}:${randomUUID()}`);
    const userLabel = normalizedLabel(request.userLabel);
    return existing
      ? {
          ...existing,
          config,
          access: "required",
          ...(Object.hasOwn(request, "userLabel")
            ? userLabel
              ? { userLabel }
              : { userLabel: undefined }
            : {}),
        }
      : {
          id: instanceId,
          providerKind: request.providerKind,
          ...(userLabel ? { userLabel } : {}),
          config,
          access: "required",
          createdAt: clock(),
          history: [],
        };
  }

  async function prepareProviderPermission(
    request: PrepareProviderPermissionRequest,
  ): Promise<PrepareProviderPermissionResult> {
    return withPermissionOwnershipLock("permissions", async () => {
      const candidate = await buildPermissionCandidate(request);
      const permissions = requiredPermissionsForInstance(candidate, packages);
      const intent = await permissionIntents.create(candidate);
      return {
        permissionIntentId: intent.id,
        instanceId: candidate.id,
        normalizedConfig: candidate.config,
        permissions: permissions ?? {},
      };
    });
  }

  async function resolveProviderPermission(
    permissionIntentId: string,
    granted: boolean,
  ): Promise<void> {
    await withPermissionOwnershipLock("permissions", async () => {
      const resolved = await permissionIntents.resolveRequest(
        permissionIntentId,
        granted,
      );
      if (!resolved) throw new Error("Provider permission intent failed.");
      const candidate = ownerFromStoredCandidate(resolved.candidate);
      if (granted && (await hasInstancePermission(candidate, packages))) return;
      const cleanup = granted
        ? await permissionIntents.abandon(permissionIntentId)
        : resolved;
      if (cleanup) await completePermissionCleanup(cleanup);
      if (granted) throw new Error("Provider permission is required.");
    });
  }

  async function abandonProviderPermission(
    permissionIntentId: string,
  ): Promise<void> {
    await withPermissionOwnershipLock("permissions", async () => {
      const cleanup = await permissionIntents.abandon(permissionIntentId);
      if (cleanup) await completePermissionCleanup(cleanup);
    });
  }

  async function sweepPermissionIntents(): Promise<void> {
    await withPermissionOwnershipLock("permissions", async () => {
      const cleanup = await permissionIntents.sweepExpired();
      for (const evidence of cleanup) {
        await completePermissionCleanup(evidence);
      }
    });
  }

  const orchestrator = createRefreshOrchestrator({
    listInstanceIds: async () =>
      (await connectionRepository.list()).map(({ id }) => id),
    isAutoRefreshEnabled: async () =>
      (await loadInstanceAppState()).preferences.autoRefresh,
    isInstanceRefreshEligible: async (instanceId) => {
      if (!lanes.canRefresh(instanceId)) return false;
      const instance = await connectionRepository.get(instanceId);
      return Boolean(
        instance &&
          instance.access === "granted" &&
          (await isProviderRefreshEligible(instance, packages)),
      );
    },
    getBackoffRetryAt: async (instanceId) => {
      const instance = await connectionRepository.get(instanceId);
      return instance ? backoffRetryAt(instance) : undefined;
    },
    runProvider: async (instanceId, policy, control) => {
      const operation = lanes.beginRefresh(instanceId);
      if (!operation) return { kind: "skipped", reason: "superseded" };
      try {
        const instance = await connectionRepository.get(instanceId);
        if (!instance || !lanes.isCurrent(operation)) {
          return { kind: "skipped", reason: "superseded" };
        }
        const providerPackage = packages[instance.providerKind];
        const storedCredential =
          providerPackage.credentialKind === "api-key"
            ? await readCredentialWithRevision(instanceId)
            : undefined;
        const boundCredential =
          storedCredential?.revision === instance.connectionRevision
            ? storedCredential
            : undefined;
        if (!lanes.isCurrent(operation) || !control.isCurrentGeneration()) {
          return { kind: "skipped", reason: "superseded" };
        }
        const outcome = await refreshProviderInstance(
          providerPackage,
          instance,
          {
            fetch,
            now: clock(),
            signal: control.signal,
            interaction: policy.interaction,
          },
          policy.trigger,
          () => lanes.isCurrent(operation) && control.isCurrentGeneration(),
          boundCredential?.status === "active"
            ? { kind: "api-key", value: boundCredential.value }
            : undefined,
          clock,
        );
        if (boundCredential) {
          await markCredentialRejectedIfRevisionForOutcome(
            instanceId,
            boundCredential.revision,
            outcome,
          );
        }
        return outcome;
      } finally {
        lanes.finish(operation);
      }
    },
    clock,
  });

  async function markCredentialRejectedIfRevisionForOutcome(
    instanceId: ProviderInstanceId,
    revision: string,
    outcome: ProviderRefreshOutcome,
  ): Promise<void> {
    if (
      outcome.kind === "failure" &&
      outcome.category === "credential_invalid"
    ) {
      await markCredentialRejectedIfRevision(instanceId, revision);
    }
  }

  async function disconnectInstance(
    instanceId: ProviderInstanceId,
  ): Promise<DisconnectInstanceResult> {
    const result = await disconnectInstanceIf(instanceId, () => true);
    return result === "kept" ? { ok: true, localDataDeleted: true } : result;
  }

  /** Disconnects unless `shouldRemove`, checked under the locks, says no. */
  async function disconnectInstanceIf(
    instanceId: ProviderInstanceId,
    shouldRemove: (instance: ProviderInstanceRecord) => boolean,
  ): Promise<DisconnectInstanceResult | "kept"> {
    return withPermissionOwnershipLock("permissions", async () =>
      withInstanceConnectionLock(instanceId, async () => {
        const instance = await connectionRepository.get(instanceId);
        if (!instance) return { ok: true, localDataDeleted: true } as const;
        if (!shouldRemove(instance)) return "kept" as const;
        const cleanup = lanes.beginCleanup(instanceId);
        orchestrator.invalidateInstance(instanceId);
        apiKeyConnections.invalidateInstance(instanceId);
        try {
          const permissionCleanup = await permissionIntents.queueCleanup(
            instance,
          );
          await deleteCredential(instanceId);
          await deleteSavedSession(instanceId);
          if (packages[instance.providerKind].savedSession) {
            await dropSavedSessionRules();
          }
          await forgetPackageSession(instance.providerKind);
          await usageRepository.clear(instanceId);
          await connectionRepository.delete(instanceId);
          const removed = await completePermissionCleanup(permissionCleanup);
          await releaseUnusedSavedSessions([instance.providerKind]);
          return removed
            ? ({ ok: true, localDataDeleted: true } as const)
            : ({
                ok: false,
                error: "permission_removal_failed",
                localDataDeleted: true,
              } as const);
        } finally {
          lanes.endCleanup(cleanup);
        }
      }),
    );
  }

  async function connectBrowserProvider(
    providerKind: BrowserSessionProviderKind,
    permissionIntentId: string,
  ): Promise<RefreshReport> {
    return (await connectBrowserProviderWithSignIn(providerKind, permissionIntentId))
      .report;
  }

  async function connectBrowserProviderWithSignIn(
    providerKind: BrowserSessionProviderKind,
    permissionIntentId: string,
  ): Promise<{ report: RefreshReport; signIn?: AddAccountSignIn }> {
    const startedAt = clock();
    const providerPackage = packages[providerKind];
    if (providerPackage.credentialKind !== "none") {
      throw new Error("Provider connection failed.");
    }
    const intent = await withPermissionOwnershipLock("permissions", () =>
      permissionIntents.claim(permissionIntentId),
    );
    if (!intent || intent.candidate.providerKind !== providerKind) {
      throw new Error("Provider connection failed.");
    }
    const normalizedConfig = providerPackage.normalizeConfig(intent.candidate.config);
    let existing: ProviderInstanceRecord | undefined;
    try {
      existing = await connectionRepository.get(intent.candidate.id);
    } catch (error) {
      await abandonProviderPermission(permissionIntentId);
      throw error;
    }
    if (
      !normalizedConfig ||
      (existing && existing.providerKind !== providerKind)
    ) {
      await abandonProviderPermission(permissionIntentId);
      throw new Error("Provider connection failed.");
    }
    const candidate: ProviderInstanceRecord = {
      ...(existing ?? ownerFromStoredCandidate(intent.candidate)),
      config: normalizedConfig,
      access: "granted",
    };
    let permissionGranted = false;
    try {
      permissionGranted = await hasInstancePermission(candidate, packages);
    } catch (error) {
      await abandonProviderPermission(permissionIntentId);
      throw error;
    }
    if (!permissionGranted) {
      await abandonProviderPermission(permissionIntentId);
      throw new Error("Provider permission is required.");
    }
    let admission: {
      lifecycle: number;
      operation: NonNullable<ReturnType<typeof lanes.beginConnect>>;
    };
    try {
      admission = await withInstanceConnectionLock(candidate.id, () => {
        const lifecycle = beginConnectionGeneration();
        const operation = lanes.beginConnect(candidate.id);
        if (!operation) throw new Error("Provider connection is unavailable.");
        return { lifecycle, operation };
      });
    } catch (error) {
      await abandonProviderPermission(permissionIntentId);
      throw error;
    }
    const { lifecycle, operation } = admission;
    const isCurrent = () =>
      lanes.isCurrent(operation) && isConnectionGenerationCurrent(lifecycle);
    orchestrator.invalidateInstance(candidate.id);
    // Until this connect finishes, no other refresh may remove the new
    // connection as an empty duplicate: it is about to be signed out and
    // read again.
    connectingInstanceIds.add(candidate.id);
    try {
      let committed = false;
      let operationWasCurrent = false;
      try {
        await withPermissionOwnershipLock("permissions", async () => {
          if (!(await hasInstancePermission(candidate, packages))) return;
          await withInstanceConnectionLock(candidate.id, async () => {
            if (existing) {
              committed = await connectionRepository.replace(
                existing.id,
                (current) =>
                  isCurrent() ? { ...current, access: "granted" } : current,
              );
            } else {
              committed = await connectionRepository.createIfCurrent(
                candidate,
                isCurrent,
              );
            }
            operationWasCurrent =
              isCurrent() && (await hasInstancePermission(candidate, packages));
            if (committed && !operationWasCurrent) {
              await connectionRepository.setAccess(candidate.id, "required");
            }
          });
        });
      } finally {
        try {
          await withPermissionOwnershipLock("permissions", async () => {
            if (committed) {
              await permissionIntents.finish(permissionIntentId);
            } else {
              const cleanup = await permissionIntents.abandon(permissionIntentId);
              if (cleanup) await completePermissionCleanup(cleanup);
            }
          });
        } finally {
          lanes.finish(operation);
        }
      }
      if (!committed || !operationWasCurrent) {
        return {
          report: connectReport(candidate.id, startedAt, clock(), {
            kind: "skipped",
            reason: "superseded",
          }),
        };
      }
      if (!existing && providerPackage.cardinality === "multiple") {
        // Connections made before accounts were tracked learn their login on
        // their next read. Read them first, so a new connection can't claim the
        // login an older card's History belongs to.
        const unbound = (await connectionRepository.list()).filter(
          (instance) =>
            instance.id !== candidate.id &&
            instance.providerKind === providerKind &&
            instance.access === "granted" &&
            instance.accountKey === undefined,
        );
        for (const instance of unbound) {
          await orchestrator.refreshInstance(instance.id, "manual_provider");
        }
      }
      // With saved sign-ins, adding an account saves the browser's current
      // sign-in for the connection it belongs to and signs the browser out of
      // the site, so the new connection waits for a fresh sign-in instead of
      // being refused as a duplicate.
      const spec = providerPackage.savedSession;
      let parked: Awaited<ReturnType<typeof parkLiveSession>> = "unavailable";
      let addsAccount = false;
      if (spec && !existing && providerPackage.cardinality === "multiple") {
        const siblings = (await connectionRepository.list()).filter(
          (instance) =>
            instance.id !== candidate.id && instance.providerKind === providerKind,
        );
        if (siblings.length > 0) {
          addsAccount = true;
          // A card from an earlier Add account that never got an account
          // (the guide was left, or its read failed) would claim the next
          // sign-in before this one; this card takes its place.
          for (const sibling of siblings) {
            if (connectingInstanceIds.has(sibling.id) || !isEmptyConnection(sibling)) {
              continue;
            }
            await disconnectInstanceIf(sibling.id, isEmptyConnection).catch(
              () => "kept" as const,
            );
          }
          parked = await parkLiveSession(
            spec,
            siblings,
            { fetch, signal: new AbortController().signal, now: clock() },
            savedSessionEnvironment,
            async (owner) => (await connectionRepository.get(owner.id)) !== undefined,
          ).catch(() => "unavailable" as const);
        }
      }
      let report = await orchestrator.refreshInstance(candidate.id, "connect");
      const candidateOutcome = () =>
        report.results.find(({ instanceId }) => instanceId === candidate.id)
          ?.outcome;
      if (spec && existing) {
        // Reconnecting a connection whose account the browser is not signed in
        // to: save the browser's sign-in for its own connection, then sign in.
        const outcome = candidateOutcome();
        if (
          outcome?.kind === "failure" &&
          (outcome.category === "other_account" ||
            outcome.category === "signed_out")
        ) {
          const siblings = (await connectionRepository.list()).filter(
            (instance) =>
              instance.id !== candidate.id &&
              instance.providerKind === providerKind,
          );
          parked = await parkLiveSession(
            spec,
            siblings,
            { fetch, signal: new AbortController().signal, now: clock() },
            savedSessionEnvironment,
            async (owner) => (await connectionRepository.get(owner.id)) !== undefined,
          ).catch(() => "unavailable" as const);
          if (parked === "parked") {
            report = await orchestrator.refreshInstance(candidate.id, "connect");
          }
        }
      }
      let signIn: AddAccountSignIn | undefined;
      const finalOutcome = candidateOutcome();
      if (addsAccount) {
        // Only a browser that really is signed out waits for a sign-in. A
        // duplicate (the site signed back in) or a failed read is reported
        // as it is.
        if (parked === "unavailable") {
          signIn = "not_saved";
        } else if (
          finalOutcome?.kind === "failure" &&
          (finalOutcome.category === "signed_out" ||
            // Signed out here, but the read failed: the sign-in still
            // completes this card.
            (parked === "parked" &&
              finalOutcome.category !== "duplicate_account"))
        ) {
          signIn = (await startSignIn(providerKind)) ? "waiting" : "tab_failed";
        }
      } else if (
        spec &&
        (parked === "parked" || parked === "signed_out") &&
        finalOutcome?.kind === "failure"
      ) {
        signIn = (await startSignIn(providerKind)) ? "waiting" : "tab_failed";
      }
      // A new connection that turned out to be a login another connection
      // already tracks is removed again, so the same account never shows twice.
      if (
        !existing &&
        report.results.some(
          ({ instanceId, outcome }) =>
            instanceId === candidate.id &&
            outcome.kind === "failure" &&
            outcome.category === "duplicate_account",
        )
      ) {
        await disconnectInstance(candidate.id);
      }
      return signIn === undefined ? { report } : { report, signIn };
    } finally {
      connectingInstanceIds.delete(candidate.id);
    }
  }

  async function connectApiKeyProvider(
    request: ConnectApiKeyProviderRequest,
  ): Promise<ConnectApiKeyProviderResult> {
    const providerPackage = packages[request.providerKind];
    if (providerPackage.credentialKind !== "api-key") {
      throw new Error("API key connection failed.");
    }
    const config = providerPackage.normalizeConfig(request.config);
    if (!config) throw new Error("API key connection failed.");
    const intent = await withPermissionOwnershipLock("permissions", () =>
      permissionIntents.claim(request.permissionIntentId),
    );
    if (
      !intent ||
      intent.candidate.providerKind !== request.providerKind ||
      (request.instanceId !== undefined &&
        request.instanceId !== intent.candidate.id) ||
      JSON.stringify(config) !== JSON.stringify(intent.candidate.config) ||
      normalizedLabel(request.userLabel) !== intent.candidate.userLabel
    ) {
      if (intent) await abandonProviderPermission(request.permissionIntentId);
      throw new Error("API key connection failed.");
    }
    const instanceId = intent.candidate.id;
    let existing: ProviderInstanceRecord | undefined;
    try {
      existing = await connectionRepository.get(instanceId);
    } catch (error) {
      await abandonProviderPermission(request.permissionIntentId);
      throw error;
    }
    if (existing && existing.providerKind !== request.providerKind) {
      await abandonProviderPermission(request.permissionIntentId);
      throw new Error("API key connection failed.");
    }
    const candidate: ProviderInstanceRecord = existing
      ? {
          ...existing,
          config,
          access: "granted",
          ...(intent.candidate.userLabel
            ? { userLabel: intent.candidate.userLabel }
            : { userLabel: undefined }),
        }
      : {
          ...ownerFromStoredCandidate(intent.candidate),
          access: "granted",
        };
    let admission: {
      lifecycle: number;
      operation: NonNullable<ReturnType<typeof lanes.beginConnect>>;
    };
    try {
      admission = await withInstanceConnectionLock(instanceId, () => {
        const lifecycle = beginConnectionGeneration();
        const operation = lanes.beginConnect(instanceId);
        if (!operation) throw new Error("API key connection is unavailable.");
        return { lifecycle, operation };
      });
    } catch (error) {
      await abandonProviderPermission(request.permissionIntentId);
      throw error;
    }
    const { lifecycle, operation } = admission;
    const isCurrent = () =>
      lanes.isCurrent(operation) && isConnectionGenerationCurrent(lifecycle);
    orchestrator.invalidateInstance(instanceId);
    const startedAt = clock();
    let connectionCommitted = false;
    let replacementCleanup: StoredPermissionIntent | undefined;
    try {
      if (!(await hasInstancePermission(candidate, packages)) || !isCurrent()) {
        throw new Error("Provider permission is required.");
      }
      const validation = await apiKeyConnections.connect(
        candidate,
        providerPackage,
        request.apiKey.trim(),
        { fetch, now: startedAt, interaction: "allowed" },
        clock,
        isCurrent,
      );
      let outcome = validation.outcome;
      if (outcome.kind !== "success" || !isCurrent()) {
        return {
          report: connectReport(
            instanceId,
            startedAt,
            validation.finishedAt,
            outcome,
          ),
          result: validation.result,
        };
      }
      await withPermissionOwnershipLock("permissions", async () => {
        if (!(await hasInstancePermission(candidate, packages))) {
          throw new Error("Provider permission is required.");
        }
        await withInstanceConnectionLock(instanceId, async () => {
          if (!isCurrent()) {
            outcome = { kind: "skipped", reason: "superseded" };
            return;
          }
          const authoritativePrior = await connectionRepository.get(instanceId);
          if (
            authoritativePrior &&
            authoritativePrior.providerKind !== request.providerKind
          ) {
            throw new Error("API key connection failed.");
          }
          const authoritativeCandidate: ProviderInstanceRecord =
            authoritativePrior
              ? {
                  ...authoritativePrior,
                  config,
                  access: "granted",
                  ...(intent.candidate.userLabel
                    ? { userLabel: intent.candidate.userLabel }
                    : { userLabel: undefined }),
                }
              : {
                  ...ownerFromStoredCandidate(intent.candidate),
                  access: "granted",
                };
          if (authoritativePrior) {
            replacementCleanup = await permissionIntents.queueCleanup(
              authoritativePrior,
            );
          }
          const saved = await saveApiKeyIfCurrent(
            instanceId,
            request.apiKey,
            isCurrent,
          );
          if (!saved.saved) {
            outcome = { kind: "skipped", reason: "superseded" };
          } else {
            try {
              const next = applyCollectedOutcome(
                {
                  ...authoritativeCandidate,
                  connectionRevision: saved.revision,
                },
                outcome,
                "connect",
                startedAt,
                validation.finishedAt,
              );
              const committed = authoritativePrior
                ? await connectionRepository.replace(instanceId, (current) =>
                    isCurrent() ? next : current,
                  )
                : await connectionRepository.createIfCurrent(next, isCurrent);
              if (!committed || !isCurrent()) {
                await restoreCredentialIfRevision(
                  instanceId,
                  saved.revision,
                  saved.previous,
                );
                outcome = { kind: "skipped", reason: "superseded" };
              } else if (!(await hasInstancePermission(candidate, packages))) {
                connectionCommitted = true;
                await connectionRepository.setAccess(instanceId, "required");
                outcome = { kind: "failure", category: "temporary_error" };
              } else {
                connectionCommitted = true;
              }
            } catch (error) {
              await restoreCredentialIfRevision(
                instanceId,
                saved.revision,
                saved.previous,
              );
              throw error;
            }
          }
        });
      });
      if (replacementCleanup) {
        await withPermissionOwnershipLock("permissions", () =>
          completePermissionCleanup(replacementCleanup!),
        );
      }
      return {
        report: connectReport(
          instanceId,
          startedAt,
          validation.finishedAt,
          outcome,
        ),
        result: outcome.kind === "success" ? "connected" : "temporary_error",
      };
    } finally {
      try {
        await withPermissionOwnershipLock("permissions", async () => {
          if (connectionCommitted) {
            await permissionIntents.finish(request.permissionIntentId);
          } else {
            const cleanup = await permissionIntents.abandon(
              request.permissionIntentId,
            );
            if (cleanup) await completePermissionCleanup(cleanup);
          }
        });
      } finally {
        lanes.finish(operation);
      }
    }
  }

  async function reconcilePermissions(
    change?: Browser.permissions.Permissions,
  ): Promise<void> {
    // Taking back the cookies permission also takes back saved sign-ins.
    if (
      !change ||
      change.permissions?.includes(SAVED_SESSION_PERMISSION)
    ) {
      try {
        if (!(await savedSessionEnvironment.cookies())) {
          await deleteAllSavedSessions();
          await dropSavedSessionRules();
        }
      } catch {
        // Kept until the next reconciliation; they are unusable without it.
      }
    }
    await withPermissionOwnershipLock("permissions", async () => {
      const generation = ++reconciliationGeneration;
      const instances = await connectionRepository.list();
      const externallyAffected = change
        ? instances.filter((instance) =>
            permissionChangeAffectsInstance(instance, change, packages),
          )
        : [];
      const earlyCleanups = externallyAffected.map((instance) => {
        const cleanup = lanes.beginCleanup(instance.id);
        orchestrator.invalidateInstance(instance.id);
        apiKeyConnections.invalidateInstance(instance.id);
        return cleanup;
      });
      const earlyIds = new Set(externallyAffected.map(({ id }) => id));
      try {
        const authority = await Promise.all(
          (change ? externallyAffected : instances).map(async (instance) => ({
            instance,
            granted: await hasInstancePermission(instance, packages),
          })),
        );
        if (generation !== reconciliationGeneration) return;
        for (const { instance, granted } of authority) {
          if (generation !== reconciliationGeneration) return;
          const access = granted ? "granted" : "required";
          if (instance.access === access) continue;
          if (granted) {
            await connectionRepository.setAccess(instance.id, "granted");
            if (!(await hasInstancePermission(instance, packages))) {
              await connectionRepository.setAccess(instance.id, "required");
            }
            continue;
          }
          const cleanup = earlyIds.has(instance.id)
            ? undefined
            : lanes.beginCleanup(instance.id);
          orchestrator.invalidateInstance(instance.id);
          apiKeyConnections.invalidateInstance(instance.id);
          try {
            await connectionRepository.setAccess(instance.id, "required");
            await forgetPackageSession(instance.providerKind);
          } finally {
            if (cleanup) lanes.endCleanup(cleanup);
          }
        }
      } finally {
        earlyCleanups.forEach((cleanup) => lanes.endCleanup(cleanup));
      }
    });
  }

  return {
    prepareProviderPermission,
    resolveProviderPermission,
    abandonProviderPermission,
    sweepPermissionIntents,
    connectBrowserProvider,
    connectBrowserProviderWithSignIn,
    openSignIn: startSignIn,
    connectApiKeyProvider,
    refreshInstance: async (instanceId, trigger) =>
      removeEmptyDuplicates(
        await orchestrator.refreshInstance(instanceId, trigger),
      ),
    refreshAll: async (trigger) =>
      removeEmptyDuplicates(await orchestrator.refreshAll(trigger)),
    async renameInstance(instanceId, userLabel) {
      if (!(await connectionRepository.get(instanceId))) {
        throw new Error("Provider instance is unavailable.");
      }
      await connectionRepository.rename(instanceId, userLabel);
    },
    async setInstanceHidden(instanceId, hidden) {
      await connectionRepository.setHidden(instanceId, hidden);
    },
    reorderInstances: (instanceIds) => connectionRepository.reorder(instanceIds),
    disconnectInstance,
    reconcilePermissions,
    async deleteAllLocalData() {
      return withPermissionOwnershipLock("permissions", async () => {
        lifecycleGeneration += 1;
        deleteAllDepth += 1;
        let cleanups: ReturnType<typeof lanes.beginCleanup>[] = [];
        try {
          const instances = await connectionRepository.list();
          const intentCandidates = await permissionIntents.clearAll();
          cleanups = instances.map(({ id }) => lanes.beginCleanup(id));
          orchestrator.invalidateAll();
          apiKeyConnections.invalidateAll();
          await deleteAllCredentials();
          await deleteAllSavedSessions();
          await Promise.all(
            (Object.keys(packages) as ProviderKind[]).map(forgetPackageSession),
          );
          await deleteAllInstanceData();
          const removed = await removeAllInstancePermissions(
            [...instances, ...intentCandidates],
            packages,
          );
          await releaseUnusedSavedSessions(
            [...instances, ...intentCandidates].map(
              ({ providerKind }) => providerKind,
            ),
          );
          return {
            result: removed ? "deleted" : "deleted_with_permission_errors",
          };
        } finally {
          cleanups.forEach((cleanup) => lanes.endCleanup(cleanup));
          deleteAllDepth = Math.max(0, deleteAllDepth - 1);
        }
      });
    },
    getState: loadInstanceAppState,
    setDisplayMode: (mode) => preferencesRepository.setDisplayMode(mode),
    setAutoRefresh: (enabled) => preferencesRepository.setAutoRefresh(enabled),
    setHideExhausted: (enabled) =>
      preferencesRepository.setHideExhausted(enabled),
  };
}
