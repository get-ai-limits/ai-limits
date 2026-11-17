import { describe, expect, test } from "vitest";

import { parseCreditsPage, promoCreditMetric } from "./grants";

// Synthetic payload shaped like a Next.js RSC flight response. The IDs, names,
// and amounts are invented.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const USER = "user_syntheticAccount01";

function pool(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Promo: SYNTHETIC",
    description: "synthetic grant with \"quotes\" and ] brackets",
    credit_amount: 50,
    disabled: false,
    expires_at: "2031-01-01T00:00:00.000Z",
    restrictions: null,
    usedAmount: 10,
    ...overrides,
  };
}

function payload(pools: unknown[], userIds: string[] = [USER]): string {
  const users = userIds
    .map((id, index) => `${index}a:["$","$L1",null,{"userId":"${id}"}]`)
    .join("\n");
  const props = JSON.stringify({ purchasedBalance: 0, creditPools: pools, freeTier: 0.2 });
  return `0:{"b":"x"}\n${users}\nc9:["$","div",null,{"children":[["$","$Ld0",null,${props}]]}]\n`;
}

describe("parseCreditsPage", () => {
  test("reads credit pools and the single signed-in user ID", () => {
    expect(parseCreditsPage(payload([pool()]))).toEqual({
      userId: USER,
      pools: [expect.objectContaining({ credit_amount: 50, usedAmount: 10 })],
    });
  });

  test("reads an empty pool list", () => {
    expect(parseCreditsPage(payload([]))?.pools).toEqual([]);
  });

  test.each([
    ["no user ID", payload([pool()], [])],
    ["two different user IDs", payload([pool()], [USER, "user_someoneElse02"])],
    ["no creditPools prop", `0:{"userId":"${USER}"}\n`],
    ["a malformed pool", payload([{ credit_amount: "lots", usedAmount: 0 }])],
    ["a truncated array", `{"userId":"${USER}"}{"creditPools":[{"credit_amount":5`],
    ["a non-array value", `{"userId":"${USER}","creditPools":"$5"}`],
  ])("returns undefined for %s", (_name, text) => {
    expect(parseCreditsPage(text)).toBeUndefined();
  });
});

describe("promoCreditMetric", () => {
  test("sums the remaining credit of active grants as a balance", () => {
    expect(
      promoCreditMetric(
        [pool(), pool({ credit_amount: 100, usedAmount: 0, expires_at: null })],
        NOW,
      ),
    ).toEqual({
      type: "balance",
      id: "promo-credits",
      label: "Promotional credits",
      scope: "product",
      value: 140,
      unit: "USD",
      initialLimit: 150,
    });
  });

  test.each([
    ["no grants", []],
    ["a disabled grant", [pool({ disabled: true })]],
    ["an expired grant", [pool({ expires_at: "2030-04-15T11:59:59.000Z" })]],
    ["an unparseable expiry", [pool({ expires_at: "soon" })]],
    ["a fully used grant", [pool({ usedAmount: 50 })]],
    ["a zero grant", [pool({ credit_amount: 0, usedAmount: 0 })]],
  ])("is hidden with %s", (_name, pools) => {
    expect(promoCreditMetric(pools as never, NOW)).toBeUndefined();
  });

  test("ignores unavailable grants next to an active one", () => {
    expect(
      promoCreditMetric([pool({ disabled: true }), pool({ usedAmount: -5 })], NOW),
    ).toMatchObject({ value: 50, initialLimit: 50 });
  });
});
