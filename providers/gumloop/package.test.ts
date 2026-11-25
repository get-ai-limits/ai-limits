import { describe, expect, it, vi } from "vitest";

import type { ProviderInstanceRecord } from "../../domain/model";
import type { ProviderRuntimeServices } from "../types";
import type { GumloopReplies } from "./adapter";
import {
  createGumloopPackage,
  type GumloopPackageDependencies,
} from "./package";
import type {
  GumloopCredentialLookup,
  GumloopSessionHolder,
} from "./session";

const NOW = 1_800_000_000_000;

const instance: ProviderInstanceRecord = {
  id: "gumloop:default",
  providerKind: "gumloop",
  config: { kind: "fixed" },
  access: "granted",
  createdAt: NOW,
  history: [],
};

const okReplies: GumloopReplies = {
  project: { status: 200, body: [{ organization_id: "org_synthetic1" }] },
  remaining: { status: 200, body: { remaining: 750 } },
  subscription: { status: 200, body: { allotment: 1_000, tier: "pro" } },
};

const pageSession = {
  accessToken: "id-page",
  accessExpiresAt: NOW + 30 * 60_000,
  refreshToken: "refresh-page",
  apiKey: "public-web-key",
  userId: "user-1",
};

function services(
  interaction: ProviderRuntimeServices["interaction"],
): ProviderRuntimeServices {
  return {
    fetch: vi.fn(),
    now: NOW,
    signal: new AbortController().signal,
    interaction,
  };
}

function held(accessToken: string): GumloopCredentialLookup {
  return { kind: "credentials", credentials: { accessToken, userId: "user-1" } };
}

function holder(
  overrides: Partial<GumloopSessionHolder> = {},
): GumloopSessionHolder {
  return {
    credentialsFor: vi.fn(async () => ({ kind: "none" as const })),
    beginPageRead: vi.fn(() => 0),
    rememberPageSession: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<GumloopPackageDependencies> = {},
): GumloopPackageDependencies {
  return {
    holder: holder(),
    openTabIds: vi.fn(async () => []),
    readPageSession: vi.fn(async () => undefined),
    fetchInPage: vi.fn(async () => undefined),
    fetchReplies: vi.fn(async () => okReplies),
    now: () => NOW,
    delay: async () => undefined,
    ...overrides,
  };
}

describe("gumloop package", () => {
  it("reads the open page's session and collects in the background", async () => {
    const deps = dependencies({
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        providerKind: "gumloop",
        planLabel: "Pro",
        metrics: [{ type: "quota", used: 250, limit: 1_000 }],
      },
    });
    expect(deps.holder.rememberPageSession).toHaveBeenCalledWith(
      pageSession,
      0,
    );
    expect(deps.fetchReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessToken: "id-page", userId: "user-1" },
      }),
    );
    expect(deps.fetchInPage).not.toHaveBeenCalled();
  });

  it("uses the held session on scheduled refresh when no Gumloop tab is open", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => held("id-held")),
      }),
      openOwnedTab: vi.fn(),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result.ok).toBe(true);
    expect(deps.openOwnedTab).not.toHaveBeenCalled();
    expect(deps.fetchReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessToken: "id-held", userId: "user-1" },
      }),
    );
  });

  it("defers scheduled refresh when there is no tab and no held session", async () => {
    const deps = dependencies({ openOwnedTab: vi.fn() });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({
      ok: false,
      deferred: { reason: "session_required" },
    });
    expect(deps.openOwnedTab).not.toHaveBeenCalled();
    expect(deps.fetchReplies).not.toHaveBeenCalled();
  });

  it("opens and releases one inactive tab on an interactive refresh with no session", async () => {
    const release = vi.fn();
    const deps = dependencies({
      openOwnedTab: vi.fn(async () => ({
        tabId: 9,
        deadline: NOW + 15_000,
        release,
      })),
      readPageSession: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(pageSession),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("allowed"),
    );
    expect(result.ok).toBe(true);
    expect(deps.readPageSession).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("asks to retry when an interactive refresh finds no session", async () => {
    const release = vi.fn();
    let clock = NOW;
    const deps = dependencies({
      now: () => (clock += 1_000),
      openOwnedTab: vi.fn(async () => ({
        tabId: 9,
        deadline: NOW + 5_000,
        release,
      })),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("allowed")),
    ).resolves.toEqual({
      ok: false,
      health: { kind: "temporary_error", guidance: "retry_session" },
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reports signed out when the open page has no signed-in user", async () => {
    const deps = dependencies({
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => ({ signedOut: true })),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(deps.holder.rememberPageSession).toHaveBeenCalledWith(
      { signedOut: true },
      0,
    );
  });

  it("renews once after Gumloop rejects the token, then retries", async () => {
    const credentialsFor = vi.fn(async () => held("id-renewed"));
    const fetchReplies = vi
      .fn()
      .mockResolvedValueOnce({ project: { status: 401 } })
      .mockResolvedValueOnce(okReplies);
    const deps = dependencies({
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
      holder: holder({ credentialsFor }),
      fetchReplies,
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result.ok).toBe(true);
    expect(credentialsFor).toHaveBeenCalledWith("id-page", expect.anything());
    expect(fetchReplies).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credentials: { accessToken: "id-renewed", userId: "user-1" },
      }),
    );
  });

  it("reports a temporary error, not signed out, when renewal after a 401 cannot finish", async () => {
    const credentialsFor = vi
      .fn()
      .mockResolvedValueOnce(held("id-held"))
      .mockResolvedValueOnce({ kind: "unavailable" });
    const deps = dependencies({
      holder: holder({ credentialsFor }),
      fetchReplies: vi.fn(async () => ({ project: { status: 401 } })),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });
  });

  it("still reads from the open page when renewal after a 401 cannot finish", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => ({ kind: "unavailable" as const })),
      }),
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
      fetchReplies: vi.fn(async () => ({ project: { status: 401 } })),
      fetchInPage: vi.fn(async () => okReplies),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result.ok).toBe(true);
    expect(deps.fetchInPage).toHaveBeenCalledWith(4, {
      accessToken: "id-page",
      userId: "user-1",
    });
  });

  it("reports a temporary error when the page also gets a 401 and renewal could not finish", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => ({ kind: "unavailable" as const })),
      }),
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
      fetchReplies: vi.fn(async () => ({ project: { status: 401 } })),
      fetchInPage: vi.fn(async () => ({ project: { status: 401 } })),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });
  });

  it("falls back to reading from the open page when Gumloop refuses the background request", async () => {
    const deps = dependencies({
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
      fetchReplies: vi.fn(async () => ({ project: { status: 403 } })),
      fetchInPage: vi.fn(async () => okReplies),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result.ok).toBe(true);
    expect(deps.fetchInPage).toHaveBeenCalledWith(4, {
      accessToken: "id-page",
      userId: "user-1",
    });
  });

  it("reports a temporary error when the background is unreachable and no page is open", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => held("id-held")),
      }),
      fetchReplies: vi.fn(async () => undefined),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });
    expect(deps.fetchInPage).not.toHaveBeenCalled();
  });

  it("treats malformed page output as unusable", async () => {
    const deps = dependencies({
      openTabIds: vi.fn(async () => [4]),
      readPageSession: vi.fn(async () => pageSession),
      fetchReplies: vi.fn(async () => undefined),
      fetchInPage: vi.fn(async () => ({ project: "nope" })),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });
  });

  it("rejects another provider's instance and forgets its session on disconnect", async () => {
    const deps = dependencies();
    const pkg = createGumloopPackage(deps);
    await expect(
      pkg.collect({ ...instance, providerKind: "kimi" }, services("allowed")),
    ).resolves.toEqual({ ok: false, health: { kind: "provider_changed" } });
    await pkg.forgetSession?.();
    expect(deps.holder.forget).toHaveBeenCalledTimes(1);
  });

  it("uses a held session on an interactive refresh instead of opening a tab", async () => {
    const deps = dependencies({
      holder: holder({ credentialsFor: vi.fn(async () => held("id-held")) }),
      openOwnedTab: vi.fn(),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("allowed"),
    );
    expect(result.ok).toBe(true);
    expect(deps.openOwnedTab).not.toHaveBeenCalled();
  });

  it("does not let a signed-out tab override a signed-in one", async () => {
    const rememberPageSession = vi.fn(async () => undefined);
    const deps = dependencies({
      holder: holder({ rememberPageSession }),
      openTabIds: vi.fn(async () => [3, 4]),
      readPageSession: vi.fn(async (tabId: number) =>
        tabId === 3 ? { signedOut: true } : pageSession,
      ),
    });
    const result = await createGumloopPackage(deps).collect(
      instance,
      services("forbidden"),
    );
    expect(result.ok).toBe(true);
    expect(rememberPageSession).toHaveBeenCalledTimes(1);
    expect(rememberPageSession).toHaveBeenCalledWith(pageSession, 0);
  });

  it("reports a temporary error when the held session cannot be renewed now", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => ({ kind: "unavailable" as const })),
      }),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("forbidden")),
    ).resolves.toEqual({ ok: false, health: { kind: "temporary_error" } });
  });

  it("reports signed out when the held refresh token is rejected", async () => {
    const deps = dependencies({
      holder: holder({
        credentialsFor: vi.fn(async () => ({ kind: "rejected" as const })),
      }),
      openOwnedTab: vi.fn(),
    });
    await expect(
      createGumloopPackage(deps).collect(instance, services("allowed")),
    ).resolves.toEqual({ ok: false, health: { kind: "signed_out" } });
    expect(deps.openOwnedTab).not.toHaveBeenCalled();
  });

  it("bounds a hanging page read and still releases the owned tab", async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      let clock = NOW;
      const deps = dependencies({
        now: () => clock,
        delay: async (ms) => {
          clock += ms;
        },
        openOwnedTab: vi.fn(async () => ({
          tabId: 9,
          deadline: NOW + 4_000,
          release,
        })),
        readPageSession: vi.fn(() => new Promise<unknown>(() => undefined)),
      });
      const pending = createGumloopPackage(deps).collect(
        instance,
        services("allowed"),
      );
      for (let i = 0; i < 10; i += 1) {
        clock += 3_000;
        await vi.advanceTimersByTimeAsync(3_000);
      }
      await expect(pending).resolves.toEqual({
        ok: false,
        health: { kind: "temporary_error", guidance: "retry_session" },
      });
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hanging in-page fetch", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies({
        openTabIds: vi.fn(async () => [4]),
        readPageSession: vi.fn(async () => pageSession),
        fetchReplies: vi.fn(async () => undefined),
        fetchInPage: vi.fn(() => new Promise<unknown>(() => undefined)),
      });
      const pending = createGumloopPackage(deps).collect(
        instance,
        services("forbidden"),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toEqual({
        ok: false,
        health: { kind: "temporary_error" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests the exact Gumloop origins and scripting", () => {
    const pkg = createGumloopPackage(dependencies());
    expect(pkg.requiredPermissions({ kind: "fixed" })).toEqual({
      origins: ["https://www.gumloop.com/*", "https://api.gumloop.com/*"],
      permissions: ["scripting"],
    });
    expect(
      pkg.requiredPermissions({
        kind: "dynamic-origin",
        baseUrl: "https://example.com",
      }),
    ).toBeUndefined();
  });
});
