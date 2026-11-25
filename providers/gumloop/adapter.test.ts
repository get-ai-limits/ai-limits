import { describe, expect, it, vi } from "vitest";

import {
  fetchGumloopReplies,
  gumloopOrganizationId,
  gumloopOutcomeFromReplies,
  type GumloopReplies,
} from "./adapter";

const NOW = Date.UTC(2026, 10, 25, 18, 0, 0);
const PERIOD_START = Date.UTC(2026, 10, 12, 0, 0, 0) / 1_000;
const PERIOD_END = Date.UTC(2026, 11, 12, 0, 0, 0) / 1_000;

function replies(overrides: Partial<GumloopReplies> = {}): GumloopReplies {
  return {
    project: {
      status: 200,
      body: [{ project_id: "team-1", organization_id: "org_synthetic1" }],
    },
    remaining: { status: 200, body: { remaining: 19_513 } },
    subscription: {
      status: 200,
      body: {
        allotment: 20_000,
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        next_reset: { allotment: 20_000, at: PERIOD_END },
        tier: "pro",
        trial: null,
      },
    },
    ...overrides,
  };
}

describe("gumloopOutcomeFromReplies", () => {
  it("reports monthly credits used against the allotment with the billing period", () => {
    expect(gumloopOutcomeFromReplies(replies(), NOW)).toEqual({
      kind: "snapshot",
      snapshot: {
        providerKind: "gumloop",
        planLabel: "Pro",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            id: "monthly-credits",
            label: "Monthly credits",
            scope: "general",
            type: "quota",
            usedRatio: 487 / 20_000,
            used: 487,
            limit: 20_000,
            unit: "credits",
            cycle: {
              cadence: "calendar",
              startedAt: PERIOD_START * 1_000,
              resetsAt: PERIOD_END * 1_000,
              durationMs: (PERIOD_END - PERIOD_START) * 1_000,
            },
          },
        ],
      },
    });
  });

  it("keeps the quota within bounds for extra credits and overage", () => {
    const extra = gumloopOutcomeFromReplies(
      replies({ remaining: { status: 200, body: { remaining: 25_000 } } }),
      NOW,
    );
    const overage = gumloopOutcomeFromReplies(
      replies({ remaining: { status: 200, body: { remaining: -300 } } }),
      NOW,
    );
    expect(extra.kind === "snapshot" && extra.snapshot.metrics[0]).toMatchObject({
      type: "quota",
      used: 0,
      usedRatio: 0,
    });
    expect(overage.kind === "snapshot" && overage.snapshot.metrics[0]).toMatchObject({
      type: "quota",
      used: 20_000,
      usedRatio: 1,
    });
  });

  it("reports a balance without inventing a denominator when there is no allotment", () => {
    const outcome = gumloopOutcomeFromReplies(
      replies({
        subscription: { status: 200, body: { allotment: 0, tier: null } },
      }),
      NOW,
    );
    expect(outcome).toEqual({
      kind: "snapshot",
      snapshot: {
        providerKind: "gumloop",
        source: "web-session",
        fetchedAt: NOW,
        metrics: [
          {
            id: "monthly-credits",
            label: "Monthly credits",
            scope: "general",
            type: "balance",
            value: 19_513,
            unit: "credits",
          },
        ],
      },
    });
  });

  it("drops a reset time that has already passed and a start after now", () => {
    const passed = gumloopOutcomeFromReplies(
      replies({
        subscription: {
          status: 200,
          body: { allotment: 100, current_period_end: NOW / 1_000 - 10 },
        },
      }),
      NOW,
    );
    expect(passed.kind === "snapshot" && passed.snapshot.metrics[0]?.cycle).toBe(
      undefined,
    );
    const futureStart = gumloopOutcomeFromReplies(
      replies({
        subscription: {
          status: 200,
          body: {
            allotment: 100,
            current_period_start: NOW / 1_000 + 10,
            current_period_end: PERIOD_END,
          },
        },
      }),
      NOW,
    );
    expect(
      futureStart.kind === "snapshot" && futureStart.snapshot.metrics[0]?.cycle,
    ).toEqual({ cadence: "calendar", resetsAt: PERIOD_END * 1_000 });
  });

  it("omits the billing start when credits reset before the billing period ends", () => {
    const monthlyReset = Date.UTC(2026, 11, 1) / 1_000;
    const outcome = gumloopOutcomeFromReplies(
      replies({
        subscription: {
          status: 200,
          body: {
            allotment: 100,
            current_period_start: PERIOD_START,
            current_period_end: Date.UTC(2027, 10, 12) / 1_000,
            next_reset: { allotment: 100, at: monthlyReset },
          },
        },
      }),
      NOW,
    );
    expect(outcome.kind === "snapshot" && outcome.snapshot.metrics[0]?.cycle).toEqual({
      cadence: "calendar",
      resetsAt: monthlyReset * 1_000,
    });
  });

  it("maps HTTP failures to renewal, page fallback, retry, or a changed provider", () => {
    expect(
      gumloopOutcomeFromReplies({ project: { status: 401 } }, NOW),
    ).toEqual({ kind: "auth_rejected" });
    expect(
      gumloopOutcomeFromReplies({ project: { status: 403 } }, NOW),
    ).toEqual({ kind: "unreachable" });
    expect(
      gumloopOutcomeFromReplies({ project: { status: 0 } }, NOW),
    ).toEqual({ kind: "unreachable" });
    expect(
      gumloopOutcomeFromReplies(
        { project: { status: 503, retryAfter: "120" } },
        NOW,
      ),
    ).toEqual({
      kind: "failed",
      health: { kind: "temporary_error", retryAt: NOW + 120_000 },
    });
    expect(
      gumloopOutcomeFromReplies(
        replies({ subscription: { status: 404 } }),
        NOW,
      ),
    ).toEqual({ kind: "failed", health: { kind: "provider_changed" } });
    expect(
      gumloopOutcomeFromReplies(replies({ remaining: { status: 401 } }), NOW),
    ).toEqual({ kind: "auth_rejected" });
  });

  it("rejects malformed or missing usage instead of guessing", () => {
    expect(
      gumloopOutcomeFromReplies({ project: { status: 200, body: [] } }, NOW),
    ).toEqual({ kind: "failed", health: { kind: "provider_changed" } });
    expect(
      gumloopOutcomeFromReplies(
        replies({ remaining: { status: 200, body: { remaining: "lots" } } }),
        NOW,
      ),
    ).toEqual({ kind: "failed", health: { kind: "provider_changed" } });
    expect(
      gumloopOutcomeFromReplies(
        replies({ subscription: { status: 200, body: "nope" } }),
        NOW,
      ),
    ).toEqual({ kind: "failed", health: { kind: "provider_changed" } });
  });
});

describe("gumloopOrganizationId", () => {
  it("takes the first path-safe organization id", () => {
    expect(
      gumloopOrganizationId({
        status: 200,
        body: [
          { organization_id: null },
          { organization_id: "../admin" },
          { organization_id: "org_ok-1" },
        ],
      }),
    ).toBe("org_ok-1");
    expect(gumloopOrganizationId({ status: 500, body: [] })).toBeUndefined();
    expect(gumloopOrganizationId({ status: 200, body: {} })).toBeUndefined();
  });
});

describe("fetchGumloopReplies", () => {
  const credentials = { accessToken: "id-token", userId: "user-1" };

  it("makes the three reads with the bearer token and user id, without cookies", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/project")) {
        return Response.json([{ organization_id: "org_synthetic1" }]);
      }
      if (url.endsWith("/credits")) return Response.json({ remaining: 5 });
      return Response.json({ allotment: 10 });
    });
    const signal = new AbortController().signal;

    await expect(
      fetchGumloopReplies({ fetch, credentials, signal }),
    ).resolves.toEqual({
      project: { status: 200, body: [{ organization_id: "org_synthetic1" }] },
      remaining: { status: 200, body: { remaining: 5 } },
      subscription: { status: 200, body: { allotment: 10 } },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.gumloop.com/project",
      "https://api.gumloop.com/organization/org_synthetic1/credits",
      "https://api.gumloop.com/organization/org_synthetic1/subscription",
    ]);
    for (const [, init] of fetch.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer id-token",
          "x-auth-key": "user-1",
        },
      });
    }
  });

  it("stops after the project read when it gives no organization", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(
      fetchGumloopReplies({
        fetch,
        credentials,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ project: { status: 401 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a network failure as no replies", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      fetchGumloopReplies({
        fetch,
        credentials,
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });
});
