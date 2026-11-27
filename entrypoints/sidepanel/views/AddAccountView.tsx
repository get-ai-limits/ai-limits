import React, { useEffect, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import { localizeProviderName } from "../../../i18n/presentation";
import type {
  BrowserSessionProviderKind,
  ProviderInstanceId,
  ProviderInstanceView,
} from "../../../domain/public-protocol";
import { PageHeader } from "../components/PageHeader";
import { ProviderMark } from "../components/ProviderMark";

/** What starting Add account did, as the side panel saw it. */
export type AddAccountStart =
  /** The browser is signed out and the sign-in page is open. */
  | { kind: "waiting"; instanceId: ProviderInstanceId }
  /** The browser is signed out, but the sign-in page did not open. */
  | { kind: "tab_failed"; instanceId: ProviderInstanceId }
  /** The browser was already signed in to a new account; it was added. */
  | { kind: "added"; instanceId: ProviderInstanceId }
  /** The current sign-in could not be saved; nothing changed. */
  | { kind: "not_saved" }
  /** The browser is signed in to an account that is already added. */
  | { kind: "same_account" }
  /** The permission prompt was declined. */
  | { kind: "declined" }
  | { kind: "failed" };

type Phase =
  | { name: "ready" }
  | { name: "starting" }
  | { name: "waiting"; instanceId: ProviderInstanceId; tabFailed: boolean }
  | { name: "done"; instanceId: ProviderInstanceId }
  | { name: "same_account" }
  | { name: "not_saved" }
  | { name: "declined" }
  | { name: "failed" };

type StepStatus = "todo" | "active" | "done" | "error";

export interface AddAccountViewProps {
  providerKind: BrowserSessionProviderKind;
  instances: readonly ProviderInstanceView[];
  labelForInstance: (instanceId: ProviderInstanceId) => string;
  backLabel: string;
  onBack: () => void;
  onFinish: () => void;
  onStart: (providerKind: BrowserSessionProviderKind) => Promise<AddAccountStart>;
  onOpenSignIn: (providerKind: BrowserSessionProviderKind) => Promise<boolean>;
  onCancel: (instanceId: ProviderInstanceId) => void;
}

function phaseFromStart(start: AddAccountStart): Phase {
  switch (start.kind) {
    case "waiting":
      return { name: "waiting", instanceId: start.instanceId, tabFailed: false };
    case "tab_failed":
      return { name: "waiting", instanceId: start.instanceId, tabFailed: true };
    case "added":
      return { name: "done", instanceId: start.instanceId };
    case "not_saved":
      return { name: "not_saved" };
    case "same_account":
      return { name: "same_account" };
    case "declined":
      return { name: "declined" };
    case "failed":
      return { name: "failed" };
  }
}

function statuses(phase: Phase): [StepStatus, StepStatus, StepStatus, StepStatus] {
  switch (phase.name) {
    case "ready":
      return ["active", "todo", "todo", "todo"];
    case "starting":
      return ["done", "active", "todo", "todo"];
    case "declined":
      return ["error", "todo", "todo", "todo"];
    case "not_saved":
    case "failed":
      return ["done", "error", "todo", "todo"];
    case "waiting":
      return ["done", "done", "active", "todo"];
    case "same_account":
      return ["done", "done", "error", "todo"];
    case "done":
      return ["done", "done", "done", "done"];
  }
}

function StepMarker({ index, status }: { index: number; status: StepStatus }) {
  const symbol = status === "done" ? "✓" : status === "error" ? "!" : String(index);
  return (
    <span
      className={`api-key-guide__number add-account-guide__marker add-account-guide__marker--${status}`}
      aria-hidden="true"
    >
      {symbol}
    </span>
  );
}

/**
 * Walks through adding another Cursor or ChatGPT account: allow saving
 * sign-ins, save and sign out the current account, sign in to the other one,
 * done. Each step shows what happened, and the guide follows the sign-in on
 * its own.
 */
export function AddAccountView({
  providerKind,
  instances,
  labelForInstance,
  backLabel,
  onBack,
  onFinish,
  onStart,
  onOpenSignIn,
  onCancel,
}: AddAccountViewProps) {
  const [phase, setPhase] = useState<Phase>({ name: "ready" });
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const provider = localizeProviderName(providerKind);

  // The sign-in is read in the background; follow the waiting card.
  const waitingId = phase.name === "waiting" ? phase.instanceId : undefined;
  const waitingInstance = waitingId
    ? instances.find((instance) => instance.id === waitingId)
    : undefined;
  const waitingOutcome = waitingInstance?.lastAttempt?.outcome;
  const seenWaiting = useRef<ProviderInstanceId | undefined>(undefined);
  useEffect(() => {
    if (!waitingId) return;
    if (waitingInstance) seenWaiting.current = waitingId;
    if (!waitingInstance && seenWaiting.current === waitingId) {
      // The card is removed when the sign-in turns out to be an account that
      // is already added.
      setPhase({ name: "same_account" });
    } else if (waitingOutcome?.kind === "success") {
      setPhase({ name: "done", instanceId: waitingId });
    }
  }, [waitingId, waitingInstance, waitingOutcome?.kind]);

  const start = () => {
    setPhase({ name: "starting" });
    void onStart(providerKind)
      .then((result) => {
        if (mounted.current) setPhase(phaseFromStart(result));
      })
      .catch(() => {
        if (mounted.current) setPhase({ name: "failed" });
      });
  };

  const openSignIn = () => {
    setOpening(true);
    void onOpenSignIn(providerKind)
      .then((opened) => {
        if (mounted.current && phase.name === "waiting") {
          setPhase({ ...phase, tabFailed: !opened });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setOpening(false);
      });
  };

  const [step1, step2, step3, step4] = statuses(phase);
  const title = l10n.t("addAccount.title", { provider });
  const busy = phase.name === "starting";

  return (
    <section className="screen api-key-guide add-account-guide" aria-label={title}>
      <PageHeader
        title={title}
        subtitle={l10n.t("addAccount.subtitle")}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="screen-body api-key-guide__body">
        <div className="api-key-guide__identity">
          <ProviderMark providerId={providerKind} size="md" />
          <div>
            <h2>{provider}</h2>
          </div>
        </div>

        <ol className="api-key-guide__steps" aria-live="polite">
          <li data-status={step1}>
            <StepMarker index={1} status={step1} />
            <div>
              <h3>{l10n.t("addAccount.step1Title")}</h3>
              <p>{l10n.t("addAccount.step1Copy", { provider })}</p>
              {phase.name === "declined" ? (
                <p className="add-account-guide__problem" role="status">
                  {l10n.t("addAccount.declined")}
                </p>
              ) : null}
              {phase.name === "ready" || phase.name === "declined" ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={start}
                >
                  {phase.name === "ready"
                    ? l10n.t("addAccount.start")
                    : l10n.t("addAccount.tryAgain")}
                </button>
              ) : null}
            </div>
          </li>
          <li data-status={step2}>
            <StepMarker index={2} status={step2} />
            <div>
              <h3>{l10n.t("addAccount.step2Title")}</h3>
              <p>
                {step2 === "done"
                  ? l10n.t("addAccount.step2Done", { provider })
                  : l10n.t("addAccount.step2Copy", { provider })}
              </p>
              {busy ? (
                <p className="add-account-guide__progress" role="status">
                  {l10n.t("addAccount.starting")}
                </p>
              ) : null}
              {phase.name === "not_saved" || phase.name === "failed" ? (
                <>
                  <p className="add-account-guide__problem" role="status">
                    {phase.name === "not_saved"
                      ? l10n.t("addAccount.notSaved", { provider })
                      : l10n.t("addAccount.failed")}
                  </p>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={start}
                  >
                    {l10n.t("addAccount.tryAgain")}
                  </button>
                </>
              ) : null}
            </div>
          </li>
          <li data-status={step3}>
            <StepMarker index={3} status={step3} />
            <div>
              <h3>{l10n.t("addAccount.step3Title")}</h3>
              <p>{l10n.t("addAccount.step3Copy", { provider })}</p>
              {phase.name === "waiting" ? (
                <>
                  <p className="add-account-guide__progress" role="status">
                    {phase.tabFailed
                      ? l10n.t("addAccount.tabFailed")
                      : l10n.t("addAccount.step3Waiting")}
                  </p>
                  <div className="add-account-guide__actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={opening}
                    aria-busy={opening}
                    onClick={openSignIn}
                  >
                    {l10n.t("addAccount.openSignIn", { provider })}
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => {
                      onCancel(phase.instanceId);
                      onBack();
                    }}
                  >
                    {l10n.t("addAccount.cancel")}
                  </button>
                  </div>
                </>
              ) : null}
              {phase.name === "same_account" ? (
                <>
                  <p className="add-account-guide__problem" role="status">
                    {l10n.t("addAccount.sameAccount", { provider })}
                  </p>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={start}
                  >
                    {l10n.t("addAccount.tryAgain")}
                  </button>
                </>
              ) : null}
              {step3 === "active" || step3 === "error" ? (
                <small className="add-account-guide__note">
                  {l10n.t("addAccount.noLogout", { provider })}
                </small>
              ) : null}
            </div>
          </li>
          <li data-status={step4}>
            <StepMarker index={4} status={step4} />
            <div>
              <h3>{l10n.t("addAccount.step4Title")}</h3>
              <p>
                {phase.name === "done"
                  ? l10n.t("addAccount.added", {
                      label: labelForInstance(phase.instanceId),
                    })
                  : l10n.t("addAccount.step4Copy")}
              </p>
              {phase.name === "done" ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={onFinish}
                >
                  {l10n.t("addAccount.finish")}
                </button>
              ) : null}
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
