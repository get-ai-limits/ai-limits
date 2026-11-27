import { describe, expect, it } from "vitest";

import type {
  ProviderKind,
  QuotaMetric,
  UsageMetric,
  UsageSnapshot,
} from "./model";
import { planExhaustion } from "./usage-pools";

const NOW = Date.UTC(2026, 10, 27, 12);
const HOUR = 60 * 60 * 1_000;

function quota(
  id: string,
  usedRatio: number,
  overrides: Partial<QuotaMetric> = {},
): QuotaMetric {
  return {
    type: "quota",
    id,
    label: id,
    scope: "general",
    usedRatio,
    cycle: { resetsAt: NOW + HOUR },
    ...overrides,
  };
}

function snapshot(
  providerKind: ProviderKind,
  metrics: UsageMetric[],
): UsageSnapshot {
  return { providerKind, source: "web-session", fetchedAt: NOW, metrics };
}

describe("plan exhaustion", () => {
  it("treats a pool as used up when any one of its windows is at its limit", () => {
    expect(
      planExhaustion(
        snapshot("claude", [quota("five-hour", 0.4), quota("weekly", 1)]),
        NOW,
      ),
    ).toEqual({ exhausted: true, reopensAt: NOW + HOUR });
    expect(
      planExhaustion(
        snapshot("claude", [quota("five-hour", 0.4), quota("weekly", 0.99)]),
        NOW,
      ),
    ).toEqual({ exhausted: false });
  });

  it("waits for every window holding a pool shut before it reopens", () => {
    expect(
      planExhaustion(
        snapshot("chatgpt", [
          quota("five-hour", 1, { cycle: { resetsAt: NOW + HOUR } }),
          quota("weekly", 1, { cycle: { resetsAt: NOW + 48 * HOUR } }),
        ]),
        NOW,
      ),
    ).toEqual({ exhausted: true, reopensAt: NOW + 48 * HOUR });
  });

  it("leaves the reopening time out when a blocking window has no reset", () => {
    expect(
      planExhaustion(
        snapshot("gumloop", [quota("monthly-credits", 1, { cycle: undefined })]),
        NOW,
      ),
    ).toEqual({ exhausted: true });
  });

  it("counts a window as open again once its reset time passes", () => {
    expect(
      planExhaustion(
        snapshot("claude", [
          quota("weekly", 1, { cycle: { resetsAt: NOW - 1 } }),
        ]),
        NOW,
      ),
    ).toEqual({ exhausted: false });
  });

  it("ignores a used-up model window while the plan's general windows are open", () => {
    expect(
      planExhaustion(
        snapshot("claude", [
          quota("five-hour", 0.2),
          quota("weekly", 0.5),
          quota("weekly-scoped-opus", 1, { scope: "model" }),
        ]),
        NOW,
      ),
    ).toEqual({ exhausted: false });
  });

  it("keeps a plan with several pools visible until every pool is used up", () => {
    const cursorModels = quota("cursor-models-monthly", 1, { scope: "model" });
    const otherModels = quota("other-models-monthly", 1, { scope: "model" });
    const grokBot = quota("grok-bot-weekly", 0.3, {
      scope: "feature",
      cycle: { resetsAt: NOW + 2 * HOUR },
    });

    expect(
      planExhaustion(snapshot("cursor", [cursorModels, otherModels, grokBot]), NOW),
    ).toEqual({ exhausted: false });
    expect(
      planExhaustion(
        snapshot("cursor", [
          cursorModels,
          otherModels,
          { ...grokBot, usedRatio: 1 },
        ]),
        NOW,
      ),
      // The earliest pool to reopen brings the plan back.
    ).toEqual({ exhausted: true, reopensAt: NOW + HOUR });
  });

  it("keeps a used-up plan visible while extra credits or spend can still pay", () => {
    const usedUp = [
      quota("cursor-models-monthly", 1, { scope: "model" }),
      quota("other-models-monthly", 1, { scope: "model" }),
    ];
    const credits = (value: number): UsageMetric => ({
      type: "balance",
      id: "extra-usage-credits",
      label: "Extra usage credits",
      scope: "product",
      unit: "USD",
      value,
    });
    const onDemand = (value: number, limit?: number): UsageMetric => ({
      type: "counter",
      id: "on-demand",
      label: "On-demand spend",
      scope: "product",
      semantic: "spent",
      unit: "USD",
      value,
      ...(limit === undefined ? {} : { limit }),
    });

    expect(planExhaustion(snapshot("cursor", [...usedUp, credits(4)]), NOW))
      .toEqual({ exhausted: false });
    expect(planExhaustion(snapshot("cursor", [...usedUp, credits(0)]), NOW))
      .toMatchObject({ exhausted: true });
    expect(planExhaustion(snapshot("cursor", [...usedUp, onDemand(5)]), NOW))
      .toEqual({ exhausted: false });
    expect(planExhaustion(snapshot("cursor", [...usedUp, onDemand(5, 20)]), NOW))
      .toEqual({ exhausted: false });
    expect(planExhaustion(snapshot("cursor", [...usedUp, onDemand(20, 20)]), NOW))
      .toMatchObject({ exhausted: true });
  });

  it("treats each Grok chat mode as its own pool unless the shared pool is reported", () => {
    const modes = [
      quota("2-hour-default-queries", 1),
      quota("2-hour-default-tokens", 0.2),
      quota("2-hour-think-queries", 0.5),
    ];
    expect(planExhaustion(snapshot("grok", modes), NOW)).toEqual({
      exhausted: false,
    });
    expect(
      planExhaustion(
        snapshot("grok", [
          ...modes,
          quota("2-hour-think-tokens", 1),
        ]),
        NOW,
      ),
    ).toMatchObject({ exhausted: true });
    expect(
      planExhaustion(
        snapshot("grok", [...modes, quota("weekly-pool", 1)]),
        NOW,
      ),
    ).toMatchObject({ exhausted: true });
  });

  it("splits Factory into its Standard and Core pools", () => {
    expect(
      planExhaustion(
        snapshot("factory", [
          quota("standard-five-hour", 1),
          quota("standard-weekly", 0.5),
          quota("core-five-hour", 0.1, { scope: "product" }),
        ]),
        NOW,
      ),
    ).toEqual({ exhausted: false });
  });

  it("keeps Kimi visible while only Kimi Code's windows are full", () => {
    const monthly = quota("monthly-total", 0.4);
    const coding = [
      quota("five-hour-coding", 1, { scope: "feature" }),
      quota("weekly-coding", 0.5, { scope: "feature" }),
    ];
    expect(planExhaustion(snapshot("kimi", [monthly, ...coding]), NOW)).toEqual({
      exhausted: false,
    });
    expect(
      planExhaustion(snapshot("kimi", [{ ...monthly, usedRatio: 1 }, ...coding]), NOW),
    ).toMatchObject({ exhausted: true });
    // The legacy endpoint reports only the coding windows.
    expect(planExhaustion(snapshot("kimi", coding), NOW)).toMatchObject({
      exhausted: true,
    });
  });

  it("gives no reopening time when any pool's reset is unknown", () => {
    expect(
      planExhaustion(
        snapshot("perplexity", [
          quota("recurring-credits", 1, { scope: "product" }),
          quota("purchased-credits", 1, { scope: "product", cycle: undefined }),
        ]),
        NOW,
      ),
    ).toEqual({ exhausted: true });
  });

  it("never hides balance providers or a plan without readings", () => {
    expect(
      planExhaustion(snapshot("openrouter", [quota("key-limit", 1)]), NOW),
    ).toEqual({ exhausted: false });
    expect(planExhaustion(undefined, NOW)).toEqual({ exhausted: false });
    expect(planExhaustion(snapshot("claude", []), NOW)).toEqual({
      exhausted: false,
    });
  });
});
