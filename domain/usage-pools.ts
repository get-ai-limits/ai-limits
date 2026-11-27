import type { QuotaMetric, UsageMetric, UsageSnapshot } from "./model";
import {
  providerPoolSpecs,
  type ProviderPoolSpec,
} from "./provider-presentation";

export type PlanExhaustion =
  | { exhausted: false }
  | {
      exhausted: true;
      /** When the first pool opens again, given only when every pool's reset is known. */
      reopensAt?: number;
    };

// Cards show percentages to two decimals, so a window that reads "100% used"
// counts as at its limit even when fractional usage leaves a sliver unused.
const USED_UP_RATIO = 0.99995;

function windowBlocks(quota: QuotaMetric, now: number): boolean {
  const resetsAt = quota.cycle?.resetsAt;
  // A window whose reset time has passed has reopened, even before the next
  // refresh reports it.
  if (resetsAt !== undefined && Number.isFinite(resetsAt) && resetsAt <= now) {
    return false;
  }
  return quota.usedRatio >= USED_UP_RATIO;
}

function overflowAvailable(metric: UsageMetric): boolean {
  if (metric.type === "balance") return metric.value > 0;
  if (metric.type === "counter") {
    if (metric.semantic !== "spent") return false;
    return metric.limit === undefined || metric.value < metric.limit;
  }
  return false;
}

export function planExhaustion(
  snapshot: UsageSnapshot | undefined,
  now: number,
): PlanExhaustion {
  if (snapshot === undefined) return { exhausted: false };
  const spec: ProviderPoolSpec | null = providerPoolSpecs[snapshot.providerKind];
  if (spec === null) return { exhausted: false };

  const quotas = snapshot.metrics.filter(
    (metric): metric is QuotaMetric => metric.type === "quota",
  );
  const quotaById = new Map(quotas.map((quota) => [quota.id, quota]));
  const pools = spec
    .pools(quotas)
    .map((ids) =>
      ids.flatMap((id) => {
        const quota = quotaById.get(id);
        return quota === undefined ? [] : [quota];
      }),
    )
    .filter((pool) => pool.length > 0);
  if (pools.length === 0) return { exhausted: false };

  const overflow = new Set(spec.overflowMetricIds);
  if (
    snapshot.metrics.some(
      (metric) => overflow.has(metric.id) && overflowAvailable(metric),
    )
  ) {
    return { exhausted: false };
  }

  // The plan comes back when its first pool reopens. A pool with no known
  // reset could reopen at any time, so then no reopening time is given.
  let reopensAt: number | undefined;
  let reopeningKnown = true;
  for (const pool of pools) {
    const blocking = pool.filter((quota) => windowBlocks(quota, now));
    if (blocking.length === 0) return { exhausted: false };
    // A pool opens once every window holding it shut has reset.
    const resets = blocking.map((quota) => quota.cycle?.resetsAt);
    if (resets.every((value): value is number => Number.isFinite(value))) {
      const poolOpensAt = Math.max(...resets);
      reopensAt =
        reopensAt === undefined ? poolOpensAt : Math.min(reopensAt, poolOpensAt);
    } else {
      reopeningKnown = false;
    }
  }
  return reopeningKnown && reopensAt !== undefined
    ? { exhausted: true, reopensAt }
    : { exhausted: true };
}
