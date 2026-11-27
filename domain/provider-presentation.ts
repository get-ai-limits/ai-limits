import type { QuotaMetric } from "./model";
import { providerKinds, type ProviderKind } from "./provider-kind";

export interface ProviderPresentation {
  readonly markPath: string;
  readonly darkMarkPath?: string;
  readonly apiKeySetupUrl?: string;
  readonly apiKeyGuide?: "elevenlabs" | "newapi";
  /** Provider usage page with a stable public URL. Absent when none is known. */
  readonly usagePageUrl?: string;
}

export const providerCatalog = {
  chatgpt: {
    displayName: "ChatGPT",
    presentation: {
      markPath: "/provider-marks/chatgpt.svg",
      usagePageUrl: "https://chatgpt.com/codex/settings/usage",
    },
  },
  claude: {
    displayName: "Claude",
    presentation: {
      markPath: "/provider-marks/claude.svg",
      usagePageUrl: "https://claude.ai/settings/usage",
    },
  },
  kimi: {
    displayName: "Kimi",
    presentation: {
      markPath: "/provider-marks/kimi.svg",
      darkMarkPath: "/provider-marks/kimi-dark.svg",
      usagePageUrl: "https://www.kimi.com/settings/subscription",
    },
  },
  cursor: {
    displayName: "Cursor",
    presentation: {
      markPath: "/provider-marks/cursor.svg",
      darkMarkPath: "/provider-marks/cursor-dark.svg",
      usagePageUrl: "https://cursor.com/dashboard/spending",
    },
  },
  grok: {
    displayName: "Grok",
    presentation: {
      markPath: "/provider-marks/grok.svg",
      darkMarkPath: "/provider-marks/grok-dark.svg",
    },
  },
  mistral: {
    displayName: "Mistral",
    presentation: {
      markPath: "/provider-marks/mistral.svg",
      usagePageUrl: "https://admin.mistral.ai/organization/usage",
    },
  },
  perplexity: {
    displayName: "Perplexity",
    presentation: {
      markPath: "/provider-marks/perplexity.svg",
      usagePageUrl: "https://www.perplexity.ai/#settings/usage",
    },
  },
  elevenlabs: {
    displayName: "ElevenLabs",
    presentation: {
      markPath: "/provider-marks/elevenlabs.svg",
      apiKeySetupUrl: "https://elevenlabs.io/app/developers/api-keys",
      apiKeyGuide: "elevenlabs",
    },
  },
  newapi: {
    displayName: "New API",
    presentation: {
      markPath: "/provider-marks/newapi.svg",
      apiKeyGuide: "newapi",
    },
  },
  litellm: {
    displayName: "LiteLLM",
    presentation: {
      markPath: "/provider-marks/litellm.svg",
    },
  },
  clawrouter: {
    displayName: "ClawRouter",
    presentation: {
      markPath: "/provider-marks/clawrouter.svg",
    },
  },
  sub2api: {
    displayName: "sub2api",
    presentation: {
      markPath: "/provider-marks/sub2api.svg",
    },
  },
  llmProxy: {
    displayName: "LLM Proxy",
    presentation: {
      markPath: "/provider-marks/llmproxy.svg",
    },
  },
  deepseek: {
    displayName: "DeepSeek",
    presentation: {
      markPath: "/provider-marks/deepseek.svg",
      apiKeySetupUrl: "https://platform.deepseek.com/api_keys",
    },
  },
  moonshot: {
    displayName: "Moonshot",
    presentation: {
      markPath: "/provider-marks/moonshot.svg",
      apiKeySetupUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  deepinfra: {
    displayName: "DeepInfra",
    presentation: {
      markPath: "/provider-marks/deepinfra.svg",
      apiKeySetupUrl: "https://deepinfra.com/dash/api_keys",
    },
  },
  fireworks: {
    displayName: "Fireworks",
    presentation: {
      markPath: "/provider-marks/fireworks.svg",
      apiKeySetupUrl: "https://app.fireworks.ai/settings/users/api-keys",
    },
  },
  openai: {
    displayName: "OpenAI",
    presentation: {
      markPath: "/provider-marks/openai.svg",
      apiKeySetupUrl: "https://platform.openai.com/api-keys",
      usagePageUrl: "https://platform.openai.com/usage",
    },
  },
  groqcloud: {
    displayName: "GroqCloud",
    presentation: {
      markPath: "/provider-marks/groqcloud.svg",
      apiKeySetupUrl: "https://console.groq.com/keys",
    },
  },
  openrouter: {
    displayName: "OpenRouter",
    presentation: {
      markPath: "/provider-marks/openrouter.svg",
      darkMarkPath: "/provider-marks/openrouter-dark.svg",
      apiKeySetupUrl: "https://openrouter.ai/settings/keys",
    },
  },
  factory: {
    displayName: "Droid",
    presentation: {
      markPath: "/provider-marks/factory.svg",
      apiKeySetupUrl: "https://app.factory.ai/settings/api-keys",
    },
  },
  zai: {
    displayName: "GLM",
    presentation: {
      markPath: "/provider-marks/zai.svg",
      apiKeySetupUrl: "https://z.ai/manage-apikey/apikey-list",
    },
  },
  warp: {
    displayName: "Warp",
    presentation: {
      markPath: "/provider-marks/warp.svg",
      apiKeySetupUrl: "https://oz.warp.dev/settings",
    },
  },
  gumloop: {
    displayName: "Gumloop",
    presentation: {
      markPath: "/provider-marks/gumloop.svg",
      usagePageUrl: "https://www.gumloop.com/settings/profile/usage-limits",
    },
  },
} as const;

export type ProviderBalanceCategory =
  | "balance-primary"
  | "pool-primary"
  | "none";

export const providerBalanceCategories = {
  chatgpt: "pool-primary",
  claude: "pool-primary",
  kimi: "none",
  cursor: "pool-primary",
  grok: "pool-primary",
  mistral: "balance-primary",
  perplexity: "pool-primary",
  elevenlabs: "pool-primary",
  newapi: "none",
  litellm: "none",
  clawrouter: "none",
  sub2api: "balance-primary",
  llmProxy: "none",
  deepseek: "balance-primary",
  moonshot: "balance-primary",
  deepinfra: "balance-primary",
  fireworks: "none",
  openai: "balance-primary",
  groqcloud: "none",
  openrouter: "balance-primary",
  factory: "pool-primary",
  zai: "none",
  warp: "pool-primary",
  gumloop: "pool-primary",
} as const satisfies Record<ProviderKind, ProviderBalanceCategory>;

/**
 * How one provider's plan splits into usage pools.
 *
 * A pool is a set of quota windows that gate the same usage, such as a 5-hour
 * and a weekly window on one message allowance. A pool is used up while any
 * of its windows is at its limit. A plan is used up only while every pool it
 * reports is used up and none of its overflow meters (extra credits, on-demand
 * spend) can still pay for more usage.
 */
export interface ProviderPoolSpec {
  /** Groups the snapshot's quota metrics into pools, by metric id. */
  pools(quotas: readonly QuotaMetric[]): string[][];
  /** Balances and spend counters that keep the plan usable past its pools. */
  overflowMetricIds: readonly string[];
}

const onePool = (quotas: readonly QuotaMetric[]): string[][] =>
  quotas.length === 0 ? [] : [quotas.map((quota) => quota.id)];

const eachOwnPool = (quotas: readonly QuotaMetric[]): string[][] =>
  quotas.map((quota) => [quota.id]);

const generalPool = (quotas: readonly QuotaMetric[]): string[][] =>
  onePool(quotas.filter((quota) => quota.scope === "general"));

function poolsByKey(
  quotas: readonly QuotaMetric[],
  key: (quota: QuotaMetric) => string,
): string[][] {
  const pools = new Map<string, string[]>();
  for (const quota of quotas) {
    const poolKey = key(quota);
    pools.set(poolKey, [...(pools.get(poolKey) ?? []), quota.id]);
  }
  return [...pools.values()];
}

// Grok chat rate limits are named `<window>-<mode>-<queries|tokens>`. Each
// chat mode is its own pool. When Grok reports its shared usage pool, that
// pool gates every mode and the adapter does not collect per-mode limits.
const GROK_MODE_WINDOW =
  /^(?:weekly|\d+(?:\.\d+)?-(?:day|hour))-(.+)-(?:queries|tokens)$/;
const GROK_SHARED_POOL = new Set(["weekly-pool", "monthly-pool"]);

function grokPools(quotas: readonly QuotaMetric[]): string[][] {
  const shared = quotas.filter((quota) => GROK_SHARED_POOL.has(quota.id));
  if (shared.length > 0) return onePool(shared);
  return poolsByKey(
    quotas,
    (quota) => GROK_MODE_WINDOW.exec(quota.id)?.[1] ?? `metric:${quota.id}`,
  );
}

/**
 * Providers set to `null` report balances or spend, not plan windows, so
 * they are never treated as used up.
 */
export const providerPoolSpecs = {
  chatgpt: { pools: onePool, overflowMetricIds: ["credits"] },
  // Model-scoped weekly windows narrow one model; the general windows gate
  // the whole plan.
  claude: { pools: generalPool, overflowMetricIds: ["extra-usage"] },
  // Kimi's monthly total covers Work and Code; the 5-hour and weekly windows
  // gate only Kimi Code, so they count only when no monthly total is reported.
  kimi: {
    pools: (quotas) =>
      quotas.some((quota) => quota.scope === "general")
        ? generalPool(quotas)
        : onePool(quotas),
    overflowMetricIds: [],
  },
  // Cursor's model lanes and Grok Bot are separate allowances.
  cursor: {
    pools: eachOwnPool,
    overflowMetricIds: ["on-demand", "extra-usage-credits"],
  },
  grok: { pools: grokPools, overflowMetricIds: ["extra-usage-credits"] },
  mistral: null,
  // Recurring, promotional, and purchased credits are spent one after another.
  perplexity: { pools: eachOwnPool, overflowMetricIds: [] },
  // Voice slots are capacity, not usage, so only monthly credits count.
  elevenlabs: {
    pools: (quotas) =>
      onePool(quotas.filter((quota) => quota.id === "monthly-credits")),
    overflowMetricIds: [],
  },
  newapi: null,
  litellm: null,
  clawrouter: null,
  sub2api: null,
  llmProxy: null,
  deepseek: null,
  moonshot: null,
  deepinfra: null,
  fireworks: null,
  openai: null,
  groqcloud: null,
  openrouter: null,
  // Standard, Core, and Premium are separate token pools.
  factory: {
    pools: (quotas) => poolsByKey(quotas, (quota) => quota.id.split("-")[0]!),
    overflowMetricIds: ["extra-usage"],
  },
  // MCP tool calls are a side allowance; the coding windows gate the plan.
  zai: { pools: generalPool, overflowMetricIds: [] },
  warp: { pools: onePool, overflowMetricIds: ["add-on"] },
  gumloop: { pools: onePool, overflowMetricIds: [] },
} as const satisfies Record<ProviderKind, ProviderPoolSpec | null>;

export const providerNames = Object.fromEntries(
  providerKinds.map((providerKind) => [
    providerKind,
    providerCatalog[providerKind].displayName,
  ]),
) as Record<ProviderKind, string>;

const knownPlanLabels: Partial<
  Record<ProviderKind, Record<string, string>>
> = {
  chatgpt: {
    plus: "Plus",
  },
  cursor: {
    ultra: "Ultra",
  },
  elevenlabs: {
    free: "Free",
  },
  factory: {
    pro: "Pro",
    plus: "Plus",
    max: "Max",
  },
  zai: {
    lite: "Lite",
    pro: "Pro",
    max: "Max",
  },
};

export function providerPlanLabel(
  providerKind: ProviderKind,
  rawPlanLabel: string | undefined,
): string | undefined {
  if (rawPlanLabel === undefined) {
    return undefined;
  }

  return (
    knownPlanLabels[providerKind]?.[rawPlanLabel.toLowerCase()] ?? rawPlanLabel
  );
}

export function providerPresentation(
  providerKind: ProviderKind,
): ProviderPresentation {
  return providerCatalog[providerKind].presentation;
}

export function shouldDisplayBalance(
  providerKind: ProviderKind,
  value: number,
): boolean {
  return value !== 0 || providerBalanceCategories[providerKind] === "balance-primary";
}
