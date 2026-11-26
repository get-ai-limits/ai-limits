import React, { useState } from "react";

import { formatList } from "../../../i18n/format";
import { l10n } from "../../../i18n/index";
import {
  localizeCapability,
  localizeProviderName,
  providerCapabilityIds,
} from "../../../i18n/presentation";
import type { ApiKeyProviderKind } from "../../../domain/public-protocol";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

export type ApiKeyConnectAttemptResult =
  | "connected"
  | "invalid_key"
  | "insufficient_scope"
  | "invalid_site"
  | "temporary_error"
  | "permission_declined";

export interface ApiKeyConnectViewProps {
  providerKind: ApiKeyProviderKind;
  guideKind?: "elevenlabs";
  mode: "connect" | "replace";
  backLabel: string;
  onBack: () => void;
  onOpenSetup: () => void;
  /**
   * Set when this provider already has an account connected: the form then
   * asks for a name, prefilled with this suggestion, so the new card can be
   * told apart from the existing one.
   */
  suggestedUserLabel?: string;
  onSubmit: (
    apiKey: string,
    userLabel?: string,
  ) => Promise<ApiKeyConnectAttemptResult>;
}

function feedbackFor(
  result: ApiKeyConnectAttemptResult,
  providerKind: ApiKeyProviderKind,
  guideKind?: "elevenlabs",
): string {
  if (guideKind === "elevenlabs") {
    switch (result) {
      case "connected":
        return "";
      case "invalid_key":
        return l10n.t("apiKey.invalidKey");
      case "insufficient_scope":
        return l10n.t("apiKey.insufficientScope");
      case "invalid_site":
        return l10n.t("apiKey.invalidSite");
      case "temporary_error":
        return l10n.t("apiKey.temporary");
      case "permission_declined":
        return l10n.t("apiKey.permissionDeclined");
    }
  }

  const provider = localizeProviderName(providerKind);
  switch (result) {
    case "connected":
      return "";
    case "invalid_key":
      return l10n.t("apiKey.genericInvalidKey", { provider });
    case "insufficient_scope":
      return l10n.t("apiKey.genericInsufficientScope", { provider });
    case "invalid_site":
      return l10n.t("apiKey.invalidSite");
    case "temporary_error":
      return l10n.t("apiKey.genericTemporary", { provider });
    case "permission_declined":
      return l10n.t("apiKey.genericPermissionDeclined", { provider });
  }
}

export function ApiKeyConnectView({
  providerKind,
  guideKind,
  mode,
  backLabel,
  onBack,
  onOpenSetup,
  suggestedUserLabel,
  onSubmit,
}: ApiKeyConnectViewProps) {
  const [apiKey, setApiKey] = useState("");
  const showNameField = mode === "connect" && suggestedUserLabel !== undefined;
  const [userLabel, setUserLabel] = useState(suggestedUserLabel ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const replace = mode === "replace";
  const provider = localizeProviderName(providerKind);
  const capabilities = formatList(
    providerCapabilityIds(providerKind).map((id) =>
      localizeCapability(providerKind, id),
    ),
  );
  const isElevenLabs = guideKind === "elevenlabs";
  const submitLabel = replace
    ? l10n.t("apiKey.submitReplace")
    : l10n.t("apiKey.submitConnect");
  const title = replace
    ? isElevenLabs
      ? l10n.t("apiKey.replaceTitle")
      : l10n.t("apiKey.replaceProviderTitle", { provider })
    : isElevenLabs
      ? l10n.t("apiKey.connectTitle")
      : l10n.t("apiKey.connectProviderTitle", { provider });
  const inputId = `${providerKind}-api-key`;
  const invalidLength = apiKey.trim().length === 0 || apiKey.length > 4_096;

  return (
    <section className="screen api-key-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle={
          isElevenLabs
            ? l10n.t("apiKey.subtitle")
            : l10n.t("apiKey.genericSubtitle", { capabilities })
        }
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId={providerKind} size="md" />
          <div>
            <h2>{provider}</h2>
            <p>{isElevenLabs ? l10n.t("apiKey.capabilities") : capabilities}</p>
          </div>
        </div>

        <ol className="api-key-guide__steps">
          <li>
            <span className="api-key-guide__number" aria-hidden="true">1</span>
            <div>
              <h3>
                {isElevenLabs
                  ? l10n.t("apiKey.step1Title")
                  : l10n.t("apiKey.genericStep1Title", { provider })}
              </h3>
              <p>
                {isElevenLabs
                  ? l10n.t("apiKey.step1Copy")
                  : l10n.t("apiKey.genericStep1Copy", { provider })}
              </p>
              <button
                className="button button--secondary"
                type="button"
                onClick={onOpenSetup}
              >
                {l10n.t("apiKey.openKeysPage")}
              </button>
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">2</span>
            <div>
              <h3>
                {isElevenLabs
                  ? l10n.t("apiKey.step2Title")
                  : l10n.t("apiKey.genericStep2Title")}
              </h3>
              {isElevenLabs ? (
                <p>
                  {l10n.t("apiKey.step2Prefix")}{" "}
                  <strong>User → Read</strong>
                  {l10n.t("apiKey.step2Suffix")}
                </p>
              ) : (
                <p>{l10n.t("apiKey.genericStep2Copy", { provider })}</p>
              )}
            </div>
          </li>
          <li>
            <span className="api-key-guide__number" aria-hidden="true">3</span>
            <div>
              <h3>
                {isElevenLabs
                  ? l10n.t("apiKey.step3Title")
                  : l10n.t("apiKey.genericStep3Title")}
              </h3>
              <form
                className="api-key-guide__form"
                aria-label={
                  isElevenLabs
                    ? l10n.t("apiKey.formName")
                    : l10n.t("apiKey.genericFormName", { provider })
                }
                onSubmit={(event) => {
                  event.preventDefault();
                  if (invalidLength || submitting) return;
                  setSubmitting(true);
                  setFeedback("");
                  const trimmedLabel = userLabel.trim();
                  void (showNameField && trimmedLabel
                    ? onSubmit(apiKey, trimmedLabel)
                    : onSubmit(apiKey))
                    .then((result) =>
                      setFeedback(feedbackFor(result, providerKind, guideKind)),
                    )
                    .catch(() =>
                      setFeedback(
                        feedbackFor(
                          "temporary_error",
                          providerKind,
                          guideKind,
                        ),
                      ),
                    )
                    .finally(() => {
                      setApiKey("");
                      setSubmitting(false);
                    });
                }}
              >
                {showNameField ? (
                  <>
                    <label htmlFor={`${inputId}-user-label`}>
                      {l10n.t("apiKey.nameField")}
                    </label>
                    <input
                      id={`${inputId}-user-label`}
                      type="text"
                      autoComplete="off"
                      maxLength={128}
                      value={userLabel}
                      disabled={submitting}
                      aria-describedby={`${inputId}-user-label-help`}
                      onChange={(event) => setUserLabel(event.currentTarget.value)}
                    />
                    <small id={`${inputId}-user-label-help`}>
                      {l10n.t("apiKey.nameHelp", { provider })}
                    </small>
                  </>
                ) : null}
                <label htmlFor={inputId}>
                  {isElevenLabs
                    ? l10n.t("apiKey.fieldLabel")
                    : l10n.t("apiKey.genericFieldLabel", { provider })}
                </label>
                <input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  disabled={submitting}
                  aria-describedby={`${inputId}-help`}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                />
                <small id={`${inputId}-help`}>
                  {l10n.t("apiKey.fieldHelp")}
                </small>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={invalidLength || submitting}
                  aria-busy={submitting}
                >
                  {submitting ? l10n.t("apiKey.validating") : submitLabel}
                </button>
              </form>
            </div>
          </li>
        </ol>

        {feedback ? <p className="health-message">{feedback}</p> : null}
      </div>
    </section>
  );
}
