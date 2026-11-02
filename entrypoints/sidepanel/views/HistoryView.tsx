import React, { useState } from "react";

import { l10n, type MessageKey } from "../../../i18n/index";
import {
  localizeDisplayMode,
  localizeMetricLabel,
  localizeProviderName,
} from "../../../i18n/presentation";
import {
  meterPolicy,
  type DisplayMode,
  type ProviderInstanceId,
  type ProviderInstanceView,
} from "../../../domain/public-protocol";
import { instanceLabels } from "../instance-label";
import { historyMetrics } from "../metrics";
import { BalanceHistoryChart } from "../components/BalanceHistoryChart";
import { HistoryChart } from "../components/HistoryChart";
import { PageHeader } from "../components/PageHeader";
import { WindowSelect } from "../components/WindowSelect";
import type { QuotaView } from "../components/ProviderCard";
import { QuotaBars } from "../components/QuotaBars";

export interface HistoryViewProps {
  instances: ProviderInstanceView[];
  instanceId: ProviderInstanceId;
  metricId?: string;
  currentQuota?: QuotaView;
  mode: DisplayMode;
  now: number;
  backLabel: string;
  onBack: () => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onSelectionChange: (metricId: string) => void;
}

const RANGE_OPTIONS = [
  { hours: 48, shortKey: "history.range48hShort", labelKey: "history.range48h" },
  { hours: 7 * 24, shortKey: "history.range7dShort", labelKey: "history.range7d" },
  { hours: 30 * 24, shortKey: "history.range30dShort", labelKey: "history.range30d" },
] as const;

// Picked ranges, per provider kind. The earlier single global key also
// stored the default on every open, so one short-window meter left every
// provider on 7 days; it is dropped on the next pick.
const RANGE_STORAGE_KEY = "ai-limits.historyRangeHoursByProvider";
const LEGACY_RANGE_STORAGE_KEY = "ai-limits.historyRangeHours";

function readStoredRanges(): Record<string, number> {
  try {
    if (typeof localStorage === "undefined") return {};
    const parsed: unknown = JSON.parse(localStorage.getItem(RANGE_STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, hours]) =>
        RANGE_OPTIONS.some((option) => option.hours === hours),
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function readStoredRange(providerKind: string | undefined): number | undefined {
  if (!providerKind) return undefined;
  return readStoredRanges()[providerKind];
}

function storeRange(providerKind: string | undefined, hours: number): void {
  if (!providerKind) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      RANGE_STORAGE_KEY,
      JSON.stringify({ ...readStoredRanges(), [providerKind]: hours }),
    );
    localStorage.removeItem(LEGACY_RANGE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; the pick still holds for this view.
  }
}

function readingsInRange(
  history: { observedAt: number; metrics: { type: string; metricId: string }[] }[],
  metricId: string,
  now: number,
  hours: number,
): number {
  const start = now - hours * 60 * 60 * 1_000;
  return history.filter((observation) =>
    observation.observedAt >= start &&
    observation.observedAt <= now &&
    observation.metrics.some((sample) => sample.type === "quota" && sample.metricId === metricId),
  ).length;
}

function defaultRangeHours(
  providerKind: ProviderInstanceView["providerKind"] | undefined,
  metricId: string,
  durationMs: number | undefined,
): number {
  const windowMs = meterPolicy(providerKind, metricId)?.windowMs ?? durationMs ?? 0;
  const dayMs = 24 * 60 * 60 * 1_000;
  const shortWindow = windowMs > 0 && !(windowMs > dayMs);
  return shortWindow ? 7 * 24 : 30 * 24;
}

export function HistoryView({
  instances,
  instanceId,
  metricId,
  currentQuota,
  mode,
  now,
  backLabel,
  onBack,
  onDisplayModeChange,
  onSelectionChange,
}: HistoryViewProps) {
  const eligibleInstances = instances.filter(
    (instance) =>
      instance.access === "granted" &&
      instance.snapshot !== undefined &&
      historyMetrics(instance.snapshot, instance.providerKind).length > 0,
  );
  const labelsByInstance = instanceLabels(instances);
  const instance = eligibleInstances.find(
    (candidate) => candidate.id === instanceId,
  );
  const metrics = instance?.snapshot
    ? historyMetrics(instance.snapshot, instance.providerKind)
    : [];
  const selectedMetric =
    metrics.find((metric) => metric.id === metricId) ?? metrics[0];
  const providerKind = instance?.providerKind;
  const openingMetric = metrics.find((item) => item.id === metricId) ?? metrics[0];
  // A range the user picks for a provider survives meter changes and a panel
  // reload for that provider. Before any pick, the meter's window decides:
  // a window of a day or less opens on 7 days, a longer one on 30 days.
  const initialRange = (): number =>
    readStoredRange(providerKind) ??
      defaultRangeHours(providerKind, openingMetric?.id ?? "", openingMetric?.cycle?.durationMs);
  const [range, setRange] = useState(() => ({ providerKind, hours: initialRange() }));
  let rangeHours = range.hours;
  if (range.providerKind !== providerKind) {
    // Another provider: its own pick, or its own default.
    rangeHours = initialRange();
    setRange({ providerKind, hours: rangeHours });
  }
  const setRangeHours = (hours: number): void => {
    setRange({ providerKind, hours });
    storeRange(providerKind, hours);
  };

  if (!instance || !selectedMetric) {
    return (
      <section className="screen" aria-label={l10n.t("history.unavailableScreen")}>
        <PageHeader
          title={l10n.t("history.unavailableTitle")}
          subtitle={l10n.t("history.unavailableSubtitle")}
          backLabel={backLabel}
          onBack={onBack}
        />
      </section>
    );
  }

  const providerName = localizeProviderName(instance.providerKind);
  const label = labelsByInstance.get(instance.id)!;
  const localizedMetrics = metrics.map((metric) => ({
    ...metric,
    label: localizeMetricLabel(instance.providerKind, metric),
  }));
  const localizedQuotas = localizedMetrics.flatMap((metric) =>
    metric.type === "quota" ? [metric] : [],
  );
  const selectedBalance = localizedMetrics.find(
    (metric) => metric.id === selectedMetric.id && metric.type === "balance",
  );

  return (
    <section className="screen" aria-label={l10n.t("history.titleNamed", { label })}>
      <PageHeader
        title={l10n.t("history.titleNamed", { label })}
        subtitle={l10n.t(selectedBalance ? "history.balance.subtitle" : "history.subtitle", {
          provider: providerName,
        })}
        backLabel={backLabel}
        onBack={onBack}
      />

      <div className="history-screen screen-body">
        <WindowSelect
          options={localizedMetrics.map((metric) => ({
            id: metric.id,
            label: metric.label,
          }))}
          selectedId={selectedMetric.id}
          onSelectionChange={onSelectionChange}
        />

        <div className="history-controls">
          {/* Used and Left have no meaning for a balance. */}
          {selectedBalance ? null : (
          <div
            className="compact-choice"
            role="radiogroup"
            aria-label={l10n.t("navigation.showUsedOrLeft")}
          >
            {(["used", "left"] as const).map((option) => (
              <button
                key={option}
                role="radio"
                type="button"
                aria-checked={mode === option}
                onClick={() => onDisplayModeChange(option)}
              >
                <span>{localizeDisplayMode(option)}</span>
              </button>
            ))}
          </div>
          )}
          <div
            className="compact-choice"
            role="radiogroup"
            aria-label={l10n.t("history.range")}
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.hours}
                role="radio"
                type="button"
                aria-label={l10n.t(option.labelKey as MessageKey)}
                aria-checked={rangeHours === option.hours}
                onClick={() => setRangeHours(option.hours)}
              >
                <span>{l10n.t(option.shortKey as MessageKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="history-surface" aria-label={l10n.t("history.chart")}>
          {selectedBalance?.type === "balance" ? (
            <BalanceHistoryChart
              providerName={label}
              metric={selectedBalance}
              history={instance.history}
              now={now}
              rangeHours={rangeHours}
            />
          ) : (
            <HistoryChart
              providerName={label}
              providerKind={instance.providerKind}
              mode={mode}
              metrics={localizedQuotas}
              metricId={selectedMetric.id}
              history={instance.history}
              now={now}
              rangeHours={rangeHours}
            />
          )}
        </section>

        {currentQuota?.id === selectedMetric.id ? (
          <section
            className="current-cycle-surface"
            aria-label={l10n.t("history.currentCycle")}
          >
            <h2>{l10n.t("history.currentCycle")}</h2>
            <QuotaBars {...currentQuota} mode={mode} />
          </section>
        ) : null}

        <p className="illustrative-note">
          {l10n.t(selectedBalance ? "history.balance.note" : "history.note")}
        </p>
      </div>
    </section>
  );
}
