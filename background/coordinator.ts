import { appendUsageObservation } from "../domain/history";
import type {
  ProviderInstanceId,
  ProviderInstanceRecord,
} from "../domain/model";
import {
  sanitizedFailureGuidance,
  sanitizedFailureMessage,
  type ProviderAttempt,
  type ProviderRefreshOutcome,
  type RefreshTrigger,
} from "../domain/model";
import { normalizeUsageSnapshot } from "../storage/state-codec";
import type {
  CollectionResult,
  ProviderCredential,
  ProviderPackage,
  ProviderRuntimeServices,
} from "../providers/types";
import { usageRepository } from "../storage/repository";

const DEFAULT_SCHEDULED_BACKOFF_MS = 15 * 60 * 1_000;

function normalizeResult(
  providerPackage: ProviderPackage,
  result: CollectionResult,
  finishedAt: number,
): CollectionResult {
  if (!result.ok) return result;
  const snapshot = normalizeUsageSnapshot(
    {
      ...result.snapshot,
      providerKind: providerPackage.kind,
      fetchedAt: finishedAt,
    },
    providerPackage.kind,
  );
  return snapshot
    ? { ok: true, snapshot }
    : { ok: false, health: { kind: "provider_changed" } };
}

function refreshOutcome(result: CollectionResult): ProviderRefreshOutcome {
  if (result.ok) return { kind: "success", snapshot: result.snapshot };
  if ("deferred" in result) {
    return {
      kind: "deferred",
      reason: result.deferred.reason,
      ...(result.deferred.retryAt === undefined
        ? {}
        : { retryAt: result.deferred.retryAt }),
    };
  }
  if (result.health.kind === "permission_required") {
    return { kind: "skipped", reason: "permission_required" };
  }
  if (result.health.kind === "connecting" || result.health.kind === "connected") {
    return { kind: "failure", category: "temporary_error" };
  }
  const retryAt =
    result.health.kind === "temporary_error" ? result.health.retryAt : undefined;
  const guidance = sanitizedFailureGuidance(result.health.guidance);
  return {
    kind: "failure",
    category: result.health.kind,
    ...(result.health.message === undefined
      ? {}
      : {
          message: sanitizedFailureMessage(
            result.health.kind,
            result.health.message,
          ),
        }),
    ...(guidance === undefined ? {} : { guidance }),
    ...(retryAt === undefined ? {} : { retryAt }),
  };
}

function withScheduledBackoff(
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  finishedAt: number,
): ProviderRefreshOutcome {
  if (
    trigger !== "scheduled" ||
    outcome.kind !== "failure" ||
    outcome.category !== "temporary_error" ||
    outcome.retryAt !== undefined
  ) {
    return outcome;
  }
  return { ...outcome, retryAt: finishedAt + DEFAULT_SCHEDULED_BACKOFF_MS };
}

function attemptFor(
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
  outcome: ProviderRefreshOutcome,
): ProviderAttempt | undefined {
  if (outcome.kind === "skipped") return undefined;
  if (outcome.kind === "success") {
    return {
      trigger,
      startedAt,
      finishedAt,
      outcome: { kind: "success" },
    };
  }
  if (outcome.kind === "deferred") {
    return {
      trigger,
      startedAt,
      finishedAt,
      outcome: {
        kind: "deferred",
        reason: outcome.reason,
        ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
      },
    };
  }
  return {
    trigger,
    startedAt,
    finishedAt,
    outcome: {
      kind: "failure",
      category: outcome.category,
      ...(outcome.message === undefined ? {} : { message: outcome.message }),
      ...(outcome.guidance === undefined ? {} : { guidance: outcome.guidance }),
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt }),
    },
  };
}

/**
 * Keeps each connection on the login it was first read from. A reading from
 * another signed-in account, or from an account a sibling connection already
 * owns, becomes a failure so it never lands in this connection's history.
 */
export function gateAccountOutcome(
  instance: ProviderInstanceRecord,
  outcome: ProviderRefreshOutcome,
  siblings: readonly ProviderInstanceRecord[],
): { outcome: ProviderRefreshOutcome; accountKey?: string } {
  const bound = instance.accountKey;
  const keep = bound === undefined ? {} : { accountKey: bound };
  if (outcome.kind !== "success") return { outcome, ...keep };
  const observed = outcome.snapshot.accountKey;
  if (observed === undefined) {
    // With other accounts of this provider connected, an unverified reading
    // could belong to any of them, so it is not stored. A lone connection
    // keeps working if the provider stops reporting the login.
    return bound === undefined || siblings.length === 0
      ? { outcome, ...keep }
      : { outcome: { kind: "failure", category: "temporary_error" }, ...keep };
  }
  if (bound !== undefined) {
    return bound === observed
      ? { outcome, ...keep }
      : { outcome: { kind: "failure", category: "other_account" }, ...keep };
  }
  return siblings.some((sibling) => sibling.accountKey === observed)
    ? { outcome: { kind: "failure", category: "duplicate_account" } }
    : { outcome, accountKey: observed };
}

/** Applies an outcome after the account gate, keeping the binding in step. */
function applyGatedOutcome(
  instance: ProviderInstanceRecord,
  siblings: readonly ProviderInstanceRecord[],
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
): { instance: ProviderInstanceRecord; outcome: ProviderRefreshOutcome } {
  const gated = gateAccountOutcome(instance, outcome, siblings);
  const { accountKey: _previous, ...applied } = applyOutcome(
    instance,
    gated.outcome,
    trigger,
    startedAt,
    finishedAt,
  );
  return {
    instance:
      gated.accountKey === undefined
        ? applied
        : { ...applied, accountKey: gated.accountKey },
    outcome: gated.outcome,
  };
}

function applyOutcome(
  instance: ProviderInstanceRecord,
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
): ProviderInstanceRecord {
  const lastAttempt = attemptFor(trigger, startedAt, finishedAt, outcome);
  if (!lastAttempt) return instance;
  return {
    ...instance,
    ...(outcome.kind === "success"
      ? {
          access: "granted" as const,
          snapshot: outcome.snapshot,
          history: appendUsageObservation(instance.history, outcome.snapshot),
        }
      : {}),
    lastAttempt,
  };
}

export interface CollectedProviderOutcome {
  outcome: ProviderRefreshOutcome;
  finishedAt: number;
}

export async function collectProviderOutcome(
  providerPackage: ProviderPackage,
  instance: ProviderInstanceRecord,
  services: ProviderRuntimeServices,
  trigger: RefreshTrigger,
  credentialOverride?: ProviderCredential,
  clock: () => number = Date.now,
): Promise<CollectedProviderOutcome> {
  let result: CollectionResult;
  try {
    result = await providerPackage.collect(instance, services, credentialOverride);
  } catch {
    result = { ok: false, health: { kind: "temporary_error" } };
  }
  const finishedAt = Math.max(services.now, clock());
  return {
    outcome: withScheduledBackoff(
      refreshOutcome(normalizeResult(providerPackage, result, finishedAt)),
      trigger,
      finishedAt,
    ),
    finishedAt,
  };
}

export async function commitProviderOutcome(
  instanceId: ProviderInstanceId,
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
  shouldCommit: () => boolean,
): Promise<ProviderRefreshOutcome> {
  if (!shouldCommit()) return { kind: "skipped", reason: "superseded" };
  let committedOutcome = outcome;
  const committed = await usageRepository.commit(instanceId, (instance, siblings) => {
    if (!shouldCommit()) return instance;
    const applied = applyGatedOutcome(
      instance,
      siblings,
      outcome,
      trigger,
      startedAt,
      finishedAt,
    );
    committedOutcome = applied.outcome;
    return applied.instance;
  });
  return committed && shouldCommit()
    ? committedOutcome
    : { kind: "skipped", reason: "superseded" };
}

export async function refreshProviderInstance(
  providerPackage: ProviderPackage,
  instance: ProviderInstanceRecord,
  services: ProviderRuntimeServices,
  trigger: RefreshTrigger,
  shouldCommit: () => boolean,
  credentialOverride?: ProviderCredential,
  clock: () => number = Date.now,
): Promise<ProviderRefreshOutcome> {
  const collected = await collectProviderOutcome(
    providerPackage,
    instance,
    services,
    trigger,
    credentialOverride,
    clock,
  );
  return commitProviderOutcome(
    instance.id,
    collected.outcome,
    trigger,
    services.now,
    collected.finishedAt,
    shouldCommit,
  );
}

export function applyCollectedOutcome(
  instance: ProviderInstanceRecord,
  outcome: ProviderRefreshOutcome,
  trigger: RefreshTrigger,
  startedAt: number,
  finishedAt: number,
): ProviderInstanceRecord {
  return applyOutcome(instance, outcome, trigger, startedAt, finishedAt);
}
