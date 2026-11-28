import type { Ref } from "react";
import React, { useEffect, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";
import type {
  ApiKeyProviderKind,
  ProviderInstanceId,
  ProviderKind,
  ProviderOperation,
} from "../../../domain/public-protocol";
import { ArrangeList } from "../components/ArrangeList";
import { Icon } from "../components/Icon";
import { OpenSourceFooter } from "../components/OpenSourceFooter";
import {
  ProviderCard,
  type ProviderCardProps,
} from "../components/ProviderCard";
import { ProviderMark } from "../components/ProviderMark";

export interface OverviewProvider {
  instanceId: ProviderInstanceId;
  providerKind: ProviderKind;
  card: Omit<ProviderCardProps, "operation" | "action">;
  hidden?: boolean;
  /** Set while Settings hides used-up plans and every pool of this one is used up. */
  exhausted?: { reopensLabel?: string };
  needsApiKeyReplacement?: boolean;
  /** The browser is on another account; Reconnect signs this card in again. */
  needsSignIn?: boolean;
}

export interface OverviewViewProps {
  providers: OverviewProvider[];
  providerOperations: Partial<Record<ProviderInstanceId, ProviderOperation>>;
  addProviderButtonRef: Ref<HTMLButtonElement>;
  onAddProvider: (invoker: HTMLButtonElement) => void;
  onRefreshInstance: (instanceId: ProviderInstanceId) => void;
  onOpenProvider: (instanceId: ProviderInstanceId) => void;
  onOpenHistory: (instanceId: ProviderInstanceId, metricId: string) => void;
  onReplaceApiKey: (
    providerKind: ApiKeyProviderKind,
    instanceId: ProviderInstanceId,
  ) => void;
  onReorderProviders?: (instanceIds: ProviderInstanceId[]) => void;
  onSetProviderHidden?: (instanceId: ProviderInstanceId, hidden: boolean) => void;
  onReconnectInstance?: (
    providerKind: ProviderKind,
    instanceId: ProviderInstanceId,
  ) => void;
}

export function OverviewView({
  providers,
  providerOperations,
  addProviderButtonRef,
  onAddProvider,
  onRefreshInstance,
  onOpenProvider,
  onOpenHistory,
  onReplaceApiKey,
  onReorderProviders = () => undefined,
  onSetProviderHidden = () => undefined,
  onReconnectInstance,
}: OverviewViewProps) {
  const [arranging, setArranging] = useState(false);
  const arrangeButtonRef = useRef<HTMLButtonElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const focusOnModeChange = useRef(false);
  const overviewRef = useRef<HTMLElement>(null);
  const focusShownProvider = useRef<ProviderInstanceId | undefined>(undefined);
  const visibleProviders = providers.filter(
    ({ hidden, exhausted }) => !hidden && !exhausted,
  );
  const hiddenProviders = providers.filter(({ hidden }) => hidden);
  const exhaustedProviders = providers.filter(
    ({ hidden, exhausted }) => !hidden && exhausted,
  );
  const tuckedAwayCount = hiddenProviders.length + exhaustedProviders.length;
  const hiddenSummaryRef = useRef<HTMLElement>(null);
  const exhaustedIds = useRef<Set<ProviderInstanceId> | undefined>(undefined);

  useEffect(() => {
    if (!focusOnModeChange.current) return;
    focusOnModeChange.current = false;
    (arranging ? doneButtonRef : arrangeButtonRef).current?.focus();
  }, [arranging]);

  // Showing a provider removes the button that was pressed, so focus moves
  // to that provider's card once it is back on the Overview. Showing applies
  // at once, so a card missing from that next update means it failed, and
  // focus must not jump there if the provider appears much later.
  useEffect(() => {
    const instanceId = focusShownProvider.current;
    if (!instanceId) return;
    focusShownProvider.current = undefined;
    overviewRef.current
      ?.querySelector<HTMLElement>(
        `[data-focus-key="overview-provider-${instanceId}"]`,
      )
      ?.focus();
  }, [providers]);

  // A card that becomes used up while it holds focus leaves the Overview, so
  // focus moves to the hidden list that now counts it.
  useEffect(() => {
    const previous = exhaustedIds.current;
    exhaustedIds.current = new Set(
      exhaustedProviders.map(({ instanceId }) => instanceId),
    );
    if (!previous) return;
    const newlyUsedUp = exhaustedProviders.some(
      ({ instanceId }) => !previous.has(instanceId),
    );
    const focusLost =
      document.activeElement === null || document.activeElement === document.body;
    if (newlyUsedUp && focusLost) hiddenSummaryRef.current?.focus();
  }, [providers]);

  const showProvider = (instanceId: ProviderInstanceId) => {
    focusShownProvider.current = instanceId;
    onSetProviderHidden(instanceId, false);
  };

  const setArrangingWithFocus = (next: boolean) => {
    focusOnModeChange.current = true;
    setArranging(next);
  };

  if (arranging) {
    return (
      <section aria-labelledby="overview-arrange-title">
        <h2 className="visually-hidden" id="overview-title">
          {l10n.t("overview.screen")}
        </h2>
        <div className="arrange-heading">
          <h3 id="overview-arrange-title">{l10n.t("overview.arrangeTitle")}</h3>
          <button
            ref={doneButtonRef}
            className="button button--secondary arrange-heading__done"
            type="button"
            onClick={() => setArrangingWithFocus(false)}
          >
            {l10n.t("overview.done")}
          </button>
        </div>
        <ArrangeList
          items={providers.map(({ instanceId, providerKind, card, hidden }) => ({
            instanceId,
            providerKind,
            label: card.instanceLabel,
            hidden: Boolean(hidden),
          }))}
          onReorder={onReorderProviders}
          onSetHidden={onSetProviderHidden}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="overview-title" ref={overviewRef}>
      <h2 className="visually-hidden" id="overview-title">
        {l10n.t("overview.screen")}
      </h2>
      {visibleProviders.length === 0 && hiddenProviders.length === 0 ? (
        <div className="overview-all-hidden">
          <h3>{l10n.t("overview.allExhaustedTitle")}</h3>
          <p>{l10n.t("overview.allExhaustedCopy")}</p>
        </div>
      ) : visibleProviders.length === 0 ? (
        <div className="overview-all-hidden">
          <h3>{l10n.t("overview.allHiddenTitle")}</h3>
          <p>{l10n.t("overview.allHiddenCopy")}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() =>
              hiddenProviders.forEach(({ instanceId }, index) =>
                index === 0
                  ? showProvider(instanceId)
                  : onSetProviderHidden(instanceId, false),
              )
            }
          >
            {l10n.t("overview.showAll")}
          </button>
        </div>
      ) : null}
      <div className="provider-list">
        {visibleProviders.map(({ instanceId, providerKind, card, needsApiKeyReplacement, needsSignIn }) => {
          const operation = providerOperations[instanceId];
          return (
            <ProviderCard
              key={instanceId}
              {...card}
              operation={operation}
              openDetailsFocusKey={`overview-provider-${instanceId}`}
              onOpenDetails={() => onOpenProvider(instanceId)}
              onOpenHistory={
                card.hasSnapshot
                  ? (metricId) => onOpenHistory(instanceId, metricId)
                  : undefined
              }
              action={
                operation
                  ? undefined
                  : needsApiKeyReplacement
                    ? {
                        label: l10n.t("overview.replaceKey"),
                        accessibleLabel: l10n.t("overview.replaceKeyNamed", {
                          label: card.instanceLabel,
                        }),
                        title: l10n.t("overview.replaceKeyNamed", {
                          label: card.instanceLabel,
                        }),
                        icon: "key",
                        focusKey: `overview-replace-api-key-${instanceId}`,
                        onClick: () =>
                          onReplaceApiKey(
                            providerKind as ApiKeyProviderKind,
                            instanceId,
                          ),
                      }
                  : needsSignIn && onReconnectInstance
                    ? {
                        label: l10n.t("common.reconnect"),
                        accessibleLabel: l10n.t("overview.reconnectNamed", {
                          label: card.instanceLabel,
                        }),
                        title: l10n.t("overview.reconnectNamed", {
                          label: card.instanceLabel,
                        }),
                        focusKey: `overview-reconnect-${instanceId}`,
                        onClick: () => onReconnectInstance(providerKind, instanceId),
                      }
                  : {
                      label: l10n.t("common.refresh"),
                      accessibleLabel: l10n.t("overview.refreshNamed", {
                        label: card.instanceLabel,
                      }),
                      focusKey: `overview-refresh-${instanceId}`,
                      onClick: () => onRefreshInstance(instanceId),
                    }
              }
            />
          );
        })}
      </div>
      {exhaustedProviders.length > 0 ||
      (hiddenProviders.length > 0 && visibleProviders.length > 0) ? (
        <details className="overview-hidden">
          <summary ref={hiddenSummaryRef}>
            {l10n.count("overview.hiddenCount", tuckedAwayCount)}
          </summary>
          <ul>
            {exhaustedProviders.map(({ instanceId, providerKind, card, exhausted }) => (
              <li key={instanceId}>
                <ProviderMark providerId={providerKind} size="sm" />
                <span>
                  {card.instanceLabel}
                  <small className="overview-hidden__note">
                    {exhausted?.reopensLabel === undefined
                      ? l10n.t("overview.usedUp")
                      : l10n.t("overview.usedUpUntil", {
                          reset: exhausted.reopensLabel,
                        })}
                  </small>
                </span>
                <button
                  type="button"
                  data-focus-key={`overview-provider-${instanceId}`}
                  aria-label={l10n.t("overview.viewNamed", {
                    label: card.instanceLabel,
                  })}
                  onClick={() => onOpenProvider(instanceId)}
                >
                  <span aria-hidden="true">{l10n.t("overview.view")}</span>
                </button>
              </li>
            ))}
            {hiddenProviders.map(({ instanceId, providerKind, card }) => (
              <li key={instanceId}>
                <ProviderMark providerId={providerKind} size="sm" />
                <span>{card.instanceLabel}</span>
                <button
                  type="button"
                  aria-label={l10n.t("overview.showNamed", {
                    label: card.instanceLabel,
                  })}
                  onClick={() => showProvider(instanceId)}
                >
                  <span aria-hidden="true">{l10n.t("overview.show")}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="overview-actions">
        <button
          ref={addProviderButtonRef}
          className="add-provider-action"
          type="button"
          onClick={(event) => onAddProvider(event.currentTarget)}
        >
          <span aria-hidden="true">+</span>
          {l10n.t("overview.addProvider")}
        </button>
        <button
          ref={arrangeButtonRef}
          className="arrange-action"
          type="button"
          aria-label={l10n.t("overview.arrangeTitle")}
          onClick={() => setArrangingWithFocus(true)}
        >
          <Icon name="grip" />
          <span aria-hidden="true">{l10n.t("overview.arrange")}</span>
        </button>
      </div>
      <OpenSourceFooter />
    </section>
  );
}
