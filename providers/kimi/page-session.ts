export const KIMI_ORIGIN = "https://www.kimi.com";

interface StorageReader {
  getItem(key: string): string | null;
}

export interface KimiPageSession {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Runs inside a Kimi page. Reads only the exact `access_token` and
 * `refresh_token` entries, and only once Kimi's own client app has mounted.
 */
export function readKimiPageSessionAtExpectedOrigin(
  expectedOrigin: string,
  storage: StorageReader = globalThis.localStorage,
  currentOrigin: string = globalThis.location.origin,
  appMounted?: boolean,
): KimiPageSession | undefined {
  if (currentOrigin !== expectedOrigin) {
    return undefined;
  }

  // The homepage SSR shell already contains the chat UI. Kimi sets this flag
  // only after the client router is ready and app.mount("#app") runs, which is
  // the earliest point its own session refresh can replace access_token.
  const mounted =
    appMounted ??
    ((globalThis as { __kimiAppMounted?: unknown }).__kimiAppMounted === true);
  if (!mounted) return undefined;

  return {
    accessToken: storage.getItem("access_token") ?? undefined,
    refreshToken: storage.getItem("refresh_token") ?? undefined,
  };
}

function tokenOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return token ? token : undefined;
}

/** Validates the injected result; page script output is untrusted. */
export function parseKimiPageSession(value: unknown): KimiPageSession {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const accessToken = tokenOrUndefined(record.accessToken);
  const refreshToken = tokenOrUndefined(record.refreshToken);
  return {
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(refreshToken === undefined ? {} : { refreshToken }),
  };
}
