import { describe, expect, test, vi } from "vitest";

import type { CollectionContext } from "../types";
import { openRouterAdapter } from "./adapter";

// Fixtures are observed in an upstream test suite, not a live same-origin
// capture.
const NOW = Date.parse("2030-04-15T12:00:00.000Z");
const TEST_CREDENTIAL = "synthetic-test-credential";
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function context(
  fetch: typeof globalThis.fetch,
  overrides: Partial<CollectionContext> = {},
): CollectionContext {
  return {
    fetch,
    now: NOW,
    signal: new AbortController().signal,
    credential: { kind: "api-key", value: TEST_CREDENTIAL },
    ...overrides,
  };
}

function creditsFixture(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      total_credits: 100,
      total_usage: 40,
      ...overrides,
    },
  };
}

function openRouterFetch(
  credits: Response,
  key: Response,
): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url === CREDITS_URL) return credits;
    if (url === KEY_URL) return key;
    throw new Error(`unexpected url ${url}`);
  });
}

describe("OpenRouter adapter", () => {
  test("requests credits and a key budget and normalizes remaining balance", async () => {
    const controller = new AbortController();
    const fetch = openRouterFetch(
      response(creditsFixture()),
      response({ data: { limit: 20, usage: 5 } }),
    );

    const result = await openRouterAdapter.collect(
      context(fetch, { signal: controller.signal }),
    );

    expect(fetch).toHaveBeenNthCalledWith(1, CREDITS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_CREDENTIAL}`,
        "X-Title": "AI Limits",
      },
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, KEY_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TEST_CREDENTIAL}`,
      },
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        providerKind: "openrouter",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "balance",
            label: "Balance",
            scope: "general",
            value: 60,
            unit: "USD",
            initialLimit: 100,
          },
          {
            type: "quota",
            id: "key-budget",
            label: "API key budget",
            scope: "product",
            usedRatio: 0.25,
            used: 5,
            limit: 20,
            unit: "USD",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(TEST_CREDENTIAL);
  });

  test("keeps credits when key enrichment is unavailable", async () => {
    const fetch = openRouterFetch(response(creditsFixture()), response({}, 500));

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: true,
      snapshot: {
        providerKind: "openrouter",
        source: "api-key",
        fetchedAt: NOW,
        metrics: [
          {
            type: "balance",
            id: "balance",
            label: "Balance",
            scope: "general",
            value: 60,
            unit: "USD",
            initialLimit: 100,
          },
        ],
      },
    });
  });

  test("uses server remaining for the key quota when present", async () => {
    const fetch = openRouterFetch(
      response(creditsFixture()),
      response({
        data: {
          limit: 500,
          limit_remaining: 454.542594979,
          limit_reset: "monthly",
          usage: 433.286754736,
          usage_daily: 3.404645509,
          usage_weekly: 3.404645509,
          usage_monthly: 45.457405021,
        },
      }),
    );

    const result = await openRouterAdapter.collect(context(fetch));
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "balance", value: 60 },
          {
            id: "key-budget",
            used: 500 - 454.542594979,
            limit: 500,
          },
        ],
      },
    });
    if (result.ok) {
      const quota = result.snapshot.metrics.find((metric) => metric.id === "key-budget");
      expect(quota?.type === "quota" ? quota.usedRatio : undefined).toBeCloseTo(
        0.090914810042,
        9,
      );
    }
  });

  test("falls back to the reset-window usage when remaining is absent", async () => {
    const fetch = openRouterFetch(
      response(creditsFixture()),
      response({
        data: {
          limit: 500,
          limit_reset: "monthly",
          usage: 433.286754736,
          usage_monthly: 45.457405021,
        },
      }),
    );

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: {
        metrics: [
          { id: "balance" },
          { id: "key-budget", used: 45.457405021, limit: 500 },
        ],
      },
    });
  });

  test("omits the key quota when no limit is configured", async () => {
    const fetch = openRouterFetch(response(creditsFixture()), response({ data: {} }));

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ id: "balance", value: 60 }] },
    });
  });

  test("preserves a valid zero credit balance", async () => {
    const fetch = openRouterFetch(
      response(creditsFixture({ total_credits: 10, total_usage: 10 })),
      response({ data: {} }),
    );

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toMatchObject({
      ok: true,
      snapshot: { metrics: [{ type: "balance", value: 0, unit: "USD" }] },
    });
  });

  test("maps a string-typed credits total to provider changed", async () => {
    const fetch = openRouterFetch(
      response({ data: { total_credits: "many", total_usage: 40 } }),
      response({ data: {} }),
    );

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([401, 403])("maps HTTP %i on credits to credential invalid", async (status) => {
    const fetch = openRouterFetch(response({}, status), response({ data: {} }));

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "credential_invalid" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("preserves Retry-After metadata on a rate limit response", async () => {
    const fetch = openRouterFetch(
      response({}, 429, { "Retry-After": "20" }),
      response({ data: {} }),
    );

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", retryAt: NOW + 20_000 },
    });
  });

  test.each([500, 503])("maps HTTP %i on credits to a temporary error", async (status) => {
    const fetch = openRouterFetch(response({}, status), response({ data: {} }));

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  test("maps malformed credits JSON to provider changed", async () => {
    const fetch = openRouterFetch(
      new Response("{broken", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      response({ data: {} }),
    );

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "provider_changed" },
    });
  });

  test.each([
    ["missing", undefined],
    ["wrong kind", { kind: "browser-session", value: TEST_CREDENTIAL }],
    ["blank", { kind: "api-key", value: "   " }],
  ])("refuses a %s credential without making a request", async (_name, credential) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      openRouterAdapter.collect(
        context(fetch, {
          credential: credential as CollectionContext["credential"],
        }),
      ),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("maps a thrown network error to a temporary error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("synthetic network failure"));

    await expect(openRouterAdapter.collect(context(fetch))).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error" },
    });
  });

  describe("promotional credits from the signed-in Credits page", () => {
    const PAGE_URL = "https://openrouter.ai/settings/credits";
    const OWNER = "user_syntheticOwner01";

    function rscPage(userId: string, pools: unknown[]) {
      return new Response(
        `1:["$","$L2",null,{"userId":"${userId}"}]\n3:["$","$L4",null,${JSON.stringify({
          purchasedBalance: 0,
          creditPools: pools,
        })}]\n`,
        { status: 200, headers: { "content-type": "text/x-component" } },
      );
    }

    const grant = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Promo: SYNTHETIC",
      credit_amount: 25,
      disabled: false,
      expires_at: "2031-04-15T12:00:00.000Z",
      restrictions: null,
      usedAmount: 5,
    };

    function promoFetch(
      page: Response | Error,
      keyData: Record<string, unknown> = { creator_user_id: OWNER, organization_id: null },
    ) {
      return vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url === CREDITS_URL) return response(creditsFixture({ total_credits: 0, total_usage: 0 }));
        if (url === KEY_URL) return response({ data: keyData });
        if (url === PAGE_URL) {
          if (page instanceof Error) throw page;
          return page;
        }
        throw new Error(`unexpected url ${url}`);
      });
    }

    test("adds the grant as a quota when the session matches the key's account", async () => {
      const controller = new AbortController();
      const fetch = promoFetch(rscPage(OWNER, [grant]));

      const result = await openRouterAdapter.collect(
        context(fetch, { signal: controller.signal }),
      );

      expect(fetch).toHaveBeenNthCalledWith(3, PAGE_URL, {
        method: "GET",
        credentials: "include",
        redirect: "error",
        headers: { RSC: "1" },
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        ok: true,
        snapshot: {
          metrics: [
            { id: "balance", value: 0 },
            {
              type: "quota",
              id: "promo-credits",
              used: 5,
              limit: 25,
              usedRatio: 0.2,
              unit: "USD",
              cycle: { resetsAt: Date.parse("2031-04-15T12:00:00.000Z") },
            },
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain(OWNER);
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC");
    });

    test.each([
      ["a different signed-in account", () => rscPage("user_someoneElse02", [grant])],
      ["no active grants", () => rscPage(OWNER, [])],
      ["a signed-out page", () => new Response("", { status: 401 })],
      [
        "an HTML sign-in page",
        () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ],
      ["a network failure", () => new TypeError("synthetic network failure")],
    ])("hides promotional credits for %s", async (_name, page) => {
      const fetch = promoFetch(page());

      const result = await openRouterAdapter.collect(context(fetch));

      expect(result).toMatchObject({ ok: true, snapshot: { metrics: [{ id: "balance" }] } });
      if (result.ok) expect(result.snapshot.metrics).toHaveLength(1);
    });

    test.each([
      ["an organization key", { creator_user_id: OWNER, organization_id: "org_synthetic" }],
      ["a key without a creator", {}],
    ])("does not request the Credits page for %s", async (_name, keyData) => {
      const fetch = promoFetch(rscPage(OWNER, [grant]), keyData);

      await openRouterAdapter.collect(context(fetch));

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
