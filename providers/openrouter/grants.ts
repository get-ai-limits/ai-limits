import { z } from "zod";

import type { QuotaMetric } from "../../domain/model";

// Promotional credit grants are not exposed by OpenRouter's public API:
// `/api/v1/credits` reports purchased credits only. The signed-in Credits page
// is server-rendered and its React Server Components payload carries the
// grants as a `creditPools` prop. AI Limits reads that payload with the
// user's existing openrouter.ai browser session as optional enrichment; any
// failure simply hides the metric.
export const CREDITS_PAGE_URL = "https://openrouter.ai/settings/credits";

const creditPoolSchema = z.object({
  credit_amount: z.number().finite(),
  usedAmount: z.number().finite(),
  disabled: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
});

const creditPoolsSchema = z.array(creditPoolSchema).max(100);

export type OpenRouterCreditPool = z.infer<typeof creditPoolSchema>;

const MAX_PAYLOAD_LENGTH = 2_000_000;

/** Returns the JSON array that follows `"creditPools":`, or undefined. */
function extractJsonArray(payload: string, key: string): unknown {
  const marker = `"${key}":`;
  const start = payload.indexOf(marker);
  if (start < 0) return undefined;
  let index = start + marker.length;
  if (payload[index] !== "[") return undefined;
  const begin = index;
  let depth = 0;
  let inString = false;
  for (; index < payload.length; index += 1) {
    const char = payload[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(payload.slice(begin, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * The signed-in account's user ID as it appears in the payload. Returns
 * undefined unless exactly one distinct ID is present, so a page that
 * mentions another account never matches.
 */
function sessionUserId(payload: string): string | undefined {
  const ids = new Set(
    Array.from(
      payload.matchAll(/"userId":"(user_[A-Za-z0-9]+)"/g),
      (match) => match[1],
    ),
  );
  return ids.size === 1 ? [...ids][0] : undefined;
}

export interface CreditsPageGrants {
  userId: string;
  pools: OpenRouterCreditPool[];
}

export function parseCreditsPage(payload: string): CreditsPageGrants | undefined {
  if (payload.length > MAX_PAYLOAD_LENGTH) return undefined;
  const userId = sessionUserId(payload);
  if (userId === undefined) return undefined;
  const pools = creditPoolsSchema.safeParse(extractJsonArray(payload, "creditPools"));
  return pools.success ? { userId, pools: pools.data } : undefined;
}

function expiryMs(pool: OpenRouterCreditPool): number | undefined {
  if (pool.expires_at === null || pool.expires_at === undefined) return undefined;
  const parsed = Date.parse(pool.expires_at);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * One quota across active grants, or undefined when no grant has credit
 * left. Disabled, expired, and fully used grants are left out, so the metric
 * disappears when promotional credit is not available.
 */
export function promoCreditMetric(
  pools: readonly OpenRouterCreditPool[],
  now: number,
): QuotaMetric | undefined {
  let limit = 0;
  let used = 0;
  let earliestExpiry: number | undefined;
  for (const pool of pools) {
    if (pool.disabled) continue;
    const expiry = expiryMs(pool);
    if (Number.isNaN(expiry) || (expiry !== undefined && expiry <= now)) continue;
    if (pool.credit_amount <= 0) continue;
    const poolUsed = Math.min(pool.credit_amount, Math.max(0, pool.usedAmount));
    if (poolUsed >= pool.credit_amount) continue;
    limit += pool.credit_amount;
    used += poolUsed;
    if (expiry !== undefined) {
      earliestExpiry =
        earliestExpiry === undefined ? expiry : Math.min(earliestExpiry, expiry);
    }
  }
  if (limit <= 0) return undefined;
  return {
    type: "quota",
    id: "promo-credits",
    label: "Promotional credits",
    scope: "product",
    usedRatio: Math.min(1, used / limit),
    used,
    limit,
    unit: "USD",
    ...(earliestExpiry === undefined ? {} : { cycle: { resetsAt: earliestExpiry } }),
  };
}
