import { describe, expect, test, vi } from "vitest";

import type { ProviderInstanceRecord } from "../../domain/model";
import type { CollectionContext, CollectionResult } from "../types";
import { createKimiPackage } from "./package";

const instance: ProviderInstanceRecord = {
  id: "kimi:default",
  providerKind: "kimi",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: 1,
  history: [],
};

function services(interaction: "allowed" | "forbidden") {
  return {
    fetch: globalThis.fetch,
    now: 10,
    signal: new AbortController().signal,
    interaction,
  };
}

function adapterResult(collect: (context: CollectionContext) => Promise<CollectionResult>) {
  return { id: "kimi" as const, collect };
}

function successfulCollection(): CollectionResult {
  return {
    ok: true,
    snapshot: {
      providerKind: "kimi",
      source: "web-session",
      fetchedAt: 10,
      metrics: [],
    },
  };
}

describe("Kimi provider package", () => {
  const sessionRequired: CollectionResult = {
    ok: false,
    deferred: { reason: "session_required" },
  };

  test("scheduled collection without a tab uses the held refresh session", async () => {
    const collect = vi.fn().mockResolvedValue(successfulCollection());
    const recoverAccessToken = vi.fn();
    const storedSessionToken = vi.fn().mockResolvedValue("held-access");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      storedSessionToken,
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual(successfulCollection());
    expect(storedSessionToken).toHaveBeenCalledWith(
      undefined,
      expect.any(AbortSignal),
    );
    expect(collect.mock.calls[0]?.[0].accessToken).toBe("held-access");
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test("scheduled collection renews from the held session after Kimi rejects a token", async () => {
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValueOnce(sessionRequired)
      .mockResolvedValueOnce(successfulCollection());
    const storedSessionToken = vi
      .fn()
      .mockResolvedValueOnce("cached-access")
      .mockResolvedValueOnce("renewed-access");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      storedSessionToken,
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual(successfulCollection());
    expect(storedSessionToken).toHaveBeenLastCalledWith(
      "cached-access",
      expect.any(AbortSignal),
    );
    expect(collect.mock.calls.map(([context]) => context.accessToken)).toEqual(
      ["cached-access", "renewed-access"],
    );
  });

  test("prefers an open Kimi page over the held session", async () => {
    const collect = vi.fn().mockResolvedValue(successfulCollection());
    const storedSessionToken = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue("page-access"),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      storedSessionToken,
    });

    await providerPackage.collect(instance, services("forbidden"));
    expect(storedSessionToken).not.toHaveBeenCalled();
    expect(collect.mock.calls[0]?.[0].accessToken).toBe("page-access");
  });

  test("falls back to tab recovery when the held session cannot renew", async () => {
    const collect = vi.fn().mockResolvedValue(successfulCollection());
    const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      storedSessionToken: vi.fn().mockRejectedValue(new Error("held-secret")),
    });

    const result = await providerPackage.collect(instance, services("allowed"));
    expect(result).toEqual(successfulCollection());
    expect(recoverAccessToken).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("held-secret");
  });

  test("a cookie-backed success holds an open page's session for later", async () => {
    const captureOpenPageSession = vi.fn().mockResolvedValue(undefined);
    const findPageAccessToken = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn().mockResolvedValue(successfulCollection())),
      getCookieToken: vi.fn().mockResolvedValue("cookie-access"),
      findPageAccessToken,
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      captureOpenPageSession,
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual(successfulCollection());
    expect(captureOpenPageSession).toHaveBeenCalledOnce();
    expect(findPageAccessToken).not.toHaveBeenCalled();
  });

  test("an aborted collection never captures a page session", async () => {
    const controller = new AbortController();
    const captureOpenPageSession = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(async () => {
        controller.abort();
        return successfulCollection();
      }),
      getCookieToken: vi.fn().mockResolvedValue("cookie-access"),
      findPageAccessToken: vi.fn(),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      captureOpenPageSession,
    });

    await providerPackage.collect(instance, {
      ...services("forbidden"),
      signal: controller.signal,
    });
    expect(captureOpenPageSession).not.toHaveBeenCalled();
  });

  test("a failed page capture never affects a cookie-backed success", async () => {
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn().mockResolvedValue(successfulCollection())),
      getCookieToken: vi.fn().mockResolvedValue("cookie-access"),
      findPageAccessToken: vi.fn(),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      captureOpenPageSession: vi.fn().mockRejectedValue(new Error("gone")),
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual(successfulCollection());
  });

  test("forgets the held session on request", async () => {
    const forgetSession = vi.fn().mockResolvedValue(undefined);
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn(),
      findPageAccessToken: vi.fn(),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      forgetSession,
    });

    await providerPackage.forgetSession?.();
    expect(forgetSession).toHaveBeenCalledOnce();
  });

  test("scheduled collection without a token never starts interactive recovery", async () => {
    const recoverAccessToken = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test.each(["cookie", "page"] as const)(
    "scheduled collection isolates a rejected %s token resolver without recovery",
    async (rejectedResolver) => {
      const rawError = `${rejectedResolver}-resolver-secret`;
      const recoverAccessToken = vi.fn();
      const announceRecovery = vi.fn();
      const providerPackage = createKimiPackage({
        adapter: adapterResult(vi.fn()),
        getCookieToken:
          rejectedResolver === "cookie"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        findPageAccessToken:
          rejectedResolver === "page"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery,
      });

      const result = await providerPackage.collect(
        instance,
        services("forbidden"),
      );

      expect(result).toEqual({
        ok: false,
        deferred: { reason: "session_required" },
      });
      expect(recoverAccessToken).not.toHaveBeenCalled();
      expect(announceRecovery).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

  test.each(["cookie", "page"] as const)(
    "interactive collection isolates a rejected %s token resolver and performs one bounded recovery",
    async (rejectedResolver) => {
      const rawError = `${rejectedResolver}-resolver-secret`;
      const collect = vi.fn().mockResolvedValue(successfulCollection());
      const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
      const announceRecovery = vi.fn();
      const providerPackage = createKimiPackage({
        adapter: adapterResult(collect),
        getCookieToken:
          rejectedResolver === "cookie"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        findPageAccessToken:
          rejectedResolver === "page"
            ? vi.fn().mockRejectedValue(new Error(rawError))
            : vi.fn().mockResolvedValue(undefined),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery,
      });

      const result = await providerPackage.collect(
        instance,
        services("allowed"),
      );

      expect(result).toMatchObject({ ok: true });
      expect(recoverAccessToken).toHaveBeenCalledTimes(1);
      expect(announceRecovery).toHaveBeenCalledWith(instance.id);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(collect.mock.calls[0]?.[0].accessToken).toBe("fresh-token");
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

  test.each([
    { interaction: "forbidden" as const, recoveryCalls: 0 },
    { interaction: "allowed" as const, recoveryCalls: 1 },
  ])(
    "$interaction collection isolates a rejected page reread after unauthorized usage",
    async ({ interaction, recoveryCalls }) => {
      const rawError = "page-reread-secret";
      const collect = vi
        .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
        .mockResolvedValueOnce({
          ok: false,
          deferred: { reason: "session_required" },
        })
        .mockResolvedValueOnce(successfulCollection());
      const recoverAccessToken = vi.fn().mockResolvedValue("fresh-token");
      const providerPackage = createKimiPackage({
        adapter: adapterResult(collect),
        getCookieToken: vi.fn().mockResolvedValue("stale-token"),
        findPageAccessToken: vi
          .fn()
          .mockRejectedValue(new Error(rawError)),
        recoverAccessToken,
        cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
        announceRecovery: vi.fn(),
      });

      const result = await providerPackage.collect(
        instance,
        services(interaction),
      );

      expect(recoverAccessToken).toHaveBeenCalledTimes(recoveryCalls);
      expect(result).toEqual(
        interaction === "forbidden"
          ? {
              ok: false,
              deferred: { reason: "session_required" },
            }
          : successfulCollection(),
      );
      expect(JSON.stringify(result)).not.toContain(rawError);
    },
  );

  test("interactive collection waits for startup cleanup before one recovery", async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const order: string[] = [];
    const collect = vi.fn(async ({ accessToken }: CollectionContext) => {
      order.push(`collect:${accessToken}`);
      return { ok: true as const, snapshot: {
        providerKind: "kimi" as const,
        source: "web-session" as const,
        fetchedAt: 10,
        metrics: [],
      } };
    });
    const recoverAccessToken = vi.fn(async () => {
      order.push("recover");
      return "fresh-token";
    });
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn(() => cleanup),
      announceRecovery: vi.fn(() => order.push("announce")),
    });

    const startup = providerPackage.startup?.();
    const pending = providerPackage.collect(instance, services("allowed"));
    await Promise.resolve();
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    finishCleanup?.();

    await expect(pending).resolves.toMatchObject({ ok: true });
    await startup;
    expect(order).toEqual(["announce", "recover", "collect:fresh-token"]);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });

  test("aborting while startup cleanup is pending does not announce or begin recovery", async () => {
    const cleanup = new Promise<void>(() => undefined);
    const controller = new AbortController();
    const recoverAccessToken = vi.fn();
    const announceRecovery = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn(() => cleanup),
      announceRecovery,
    });

    void providerPackage.startup?.();
    const pending = providerPackage.collect(instance, {
      ...services("allowed"),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(announceRecovery).not.toHaveBeenCalled();
    expect(recoverAccessToken).not.toHaveBeenCalled();
  });

  test("public startup contains cleanup failure while collection remains gated", async () => {
    const rawError = "startup-cleanup-secret";
    const recoverAccessToken = vi.fn();
    const announceRecovery = vi.fn();
    const providerPackage = createKimiPackage({
      adapter: adapterResult(vi.fn()),
      getCookieToken: vi.fn().mockResolvedValue(undefined),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi
        .fn()
        .mockRejectedValue(new Error(rawError)),
      announceRecovery,
    });

    await expect(providerPackage.startup?.()).resolves.toBeUndefined();

    const result = await providerPackage.collect(
      instance,
      services("allowed"),
    );

    expect(result).toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(announceRecovery).not.toHaveBeenCalled();
    expect(recoverAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(rawError);
  });

  test("retries once only when an unauthorized attempt observes a changed token", async () => {
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      })
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      });
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("stale-token"),
      findPageAccessToken: vi.fn().mockResolvedValue("fresh-token"),
      recoverAccessToken: vi.fn(),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(collect).toHaveBeenCalledTimes(2);
    expect(collect.mock.calls.map(([context]) => context.accessToken)).toEqual([
      "stale-token",
      "fresh-token",
    ]);
  });

  test("interactive collection does not recover twice when no passive page token exists", async () => {
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValue({
        ok: false,
        deferred: { reason: "session_required" },
      });
    const recoverAccessToken = vi.fn().mockResolvedValue("recovered-token");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("stale-token"),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });
    const runtimeServices = services("allowed");

    await expect(
      providerPackage.collect(instance, runtimeServices),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", guidance: "retry_session" },
    });
    expect(collect.mock.calls.map(([context]) => context.accessToken)).toEqual([
      "stale-token",
      "recovered-token",
    ]);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
    expect(recoverAccessToken).toHaveBeenCalledWith(
      "stale-token",
      runtimeServices.signal,
    );
  });

  test("interactive collection recovers when a changed page token is also unauthorized", async () => {
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      })
      .mockResolvedValueOnce({
        ok: false,
        deferred: { reason: "session_required" },
      })
      .mockResolvedValueOnce(successfulCollection());
    const recoverAccessToken = vi.fn().mockResolvedValue("recovered-token");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("stale-token"),
      findPageAccessToken: vi.fn().mockResolvedValue("page-token"),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });
    const runtimeServices = services("allowed");

    const result = await providerPackage.collect(instance, runtimeServices);

    expect(result).toEqual(successfulCollection());
    expect(collect.mock.calls.map(([context]) => context.accessToken)).toEqual([
      "stale-token",
      "page-token",
      "recovered-token",
    ]);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
    expect(recoverAccessToken).toHaveBeenCalledWith(
      "page-token",
      runtimeServices.signal,
    );
  });

  test("interactive recovery preserves endpoint selection from the page-token retry", async () => {
    const firstResult: CollectionResult = {
      ok: false,
      deferred: { reason: "session_required" },
    };
    const pageRetryResult: CollectionResult = {
      ok: false,
      deferred: { reason: "session_required" },
    };
    const collect = vi
      .fn<(_context: CollectionContext) => Promise<CollectionResult>>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce({
        ok: false,
        health: { kind: "provider_changed" },
      });
    const retryAfterChangedToken = vi
      .fn<
        (
          result: CollectionResult,
          context: CollectionContext,
        ) => Promise<CollectionResult>
      >()
      .mockResolvedValueOnce(pageRetryResult)
      .mockResolvedValueOnce(successfulCollection());
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("stale-token"),
      findPageAccessToken: vi.fn().mockResolvedValue("page-token"),
      recoverAccessToken: vi.fn().mockResolvedValue("recovered-token"),
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
      retryAfterChangedToken,
    });

    const result = await providerPackage.collect(
      instance,
      services("allowed"),
    );

    expect(result).toEqual(successfulCollection());
    expect(collect).toHaveBeenCalledTimes(1);
    expect(retryAfterChangedToken).toHaveBeenNthCalledWith(
      1,
      firstResult,
      expect.objectContaining({ accessToken: "page-token" }),
    );
    expect(retryAfterChangedToken).toHaveBeenNthCalledWith(
      2,
      pageRetryResult,
      expect.objectContaining({ accessToken: "recovered-token" }),
    );
  });

  test("does not retry when recovery repeats the rejected token", async () => {
    const collect = vi.fn(async () => ({
      ok: false as const,
      deferred: { reason: "session_required" as const },
    }));
    const recoverAccessToken = vi.fn().mockResolvedValue("same-token");
    const providerPackage = createKimiPackage({
      adapter: adapterResult(collect),
      getCookieToken: vi.fn().mockResolvedValue("same-token"),
      findPageAccessToken: vi.fn().mockResolvedValue(undefined),
      recoverAccessToken,
      cleanupAbandonedRecovery: vi.fn().mockResolvedValue(undefined),
      announceRecovery: vi.fn(),
    });

    await expect(
      providerPackage.collect(instance, services("allowed")),
    ).resolves.toMatchObject({
      ok: false,
      health: { kind: "temporary_error" },
    });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(recoverAccessToken).toHaveBeenCalledTimes(1);
  });
});
