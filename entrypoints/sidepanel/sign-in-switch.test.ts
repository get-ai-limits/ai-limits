import { describe, expect, test } from "vitest";

import type {
  ProviderAvailabilityView,
  ProviderInstanceView,
} from "../../domain/public-protocol";
import { needsSignInSwitch } from "./sign-in-switch";

const providers: ProviderAvailabilityView[] = [
  {
    providerKind: "cursor",
    cardinality: "multiple",
    credentialKind: "none",
    configKind: "fixed",
    savedSignIns: true,
  },
  { providerKind: "grok", cardinality: "single", credentialKind: "none", configKind: "fixed" },
];

function card(
  id: string,
  category?: "other_account" | "signed_out" | "temporary_error",
  overrides: Partial<ProviderInstanceView> = {},
): ProviderInstanceView {
  return {
    id,
    providerKind: id.slice(0, id.indexOf(":")),
    access: "granted",
    ...(category
      ? {
          lastAttempt: {
            trigger: "scheduled",
            startedAt: 1,
            finishedAt: 2,
            outcome: { kind: "failure", category },
          },
        }
      : {}),
    ...overrides,
  } as ProviderInstanceView;
}

describe("needsSignInSwitch", () => {
  test("is true for a card on another account, or signed out beside another card", () => {
    const other = card("cursor:a", "other_account");
    const signedOut = card("cursor:b", "signed_out");
    expect(needsSignInSwitch(other, [other], providers)).toBe(true);
    expect(needsSignInSwitch(signedOut, [signedOut, other], providers)).toBe(true);
  });

  test("is false for a lone signed-out card, other failures, missing access, or no saved sign-ins", () => {
    const lone = card("cursor:b", "signed_out");
    expect(needsSignInSwitch(lone, [lone], providers)).toBe(false);
    const failed = card("cursor:a", "temporary_error");
    expect(needsSignInSwitch(failed, [failed, lone], providers)).toBe(false);
    const required = card("cursor:a", "other_account", { access: "required" });
    expect(needsSignInSwitch(required, [required], providers)).toBe(false);
    const grok = card("grok:default", "other_account");
    expect(needsSignInSwitch(grok, [grok], providers)).toBe(false);
  });
});
