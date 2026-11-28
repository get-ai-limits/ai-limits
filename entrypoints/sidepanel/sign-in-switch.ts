import type {
  ProviderAvailabilityView,
  ProviderInstanceView,
} from "../../domain/public-protocol";

/**
 * Whether a connection of a provider with saved sign-ins needs its account
 * signed in again: the browser is on another account, or signed out, this
 * connection has no saved sign-in that works, and the provider has another
 * connection (a lone one has nothing to switch from). Reconnect then saves the
 * browser's current sign-in for its own connection and opens the sign-in
 * page for this one, so nothing is disconnected and History stays.
 */
export function needsSignInSwitch(
  instance: ProviderInstanceView,
  instances: readonly ProviderInstanceView[],
  providers: readonly ProviderAvailabilityView[],
): boolean {
  if (instance.access !== "granted") return false;
  const availability = providers.find(
    ({ providerKind }) => providerKind === instance.providerKind,
  );
  if (availability?.savedSignIns !== true) return false;
  const outcome = instance.lastAttempt?.outcome;
  if (outcome?.kind !== "failure") return false;
  return (
    (outcome.category === "other_account" || outcome.category === "signed_out") &&
    instances.some(
      (other) =>
        other.id !== instance.id && other.providerKind === instance.providerKind,
    )
  );
}
