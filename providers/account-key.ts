import type { ProviderKind } from "../domain/provider-kind";

/**
 * Turns a provider's stable login id into the opaque key AI Limits stores to
 * tell accounts apart. Only the hash is kept, never the id or an email.
 */
export async function accountKeyFor(
  providerKind: ProviderKind,
  loginId: string,
): Promise<string | undefined> {
  const trimmed = loginId.trim();
  if (!trimmed) return undefined;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`ai-limits-account:${providerKind}:${trimmed}`),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}
