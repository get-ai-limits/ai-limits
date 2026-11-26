import React from "react";
import { createRoot } from "react-dom/client";

import "./setup";

import { Cockpit } from "../../../entrypoints/sidepanel/Cockpit";
import "../../../entrypoints/sidepanel/styles.css";
import type { AppViewState } from "../../../domain/public-protocol";
import { createFixtureState } from "../../../providers/fixtures";

/**
 * Two ChatGPT logins and two Cursor logins: one of each signed in, the other
 * Cursor login holding its last reading under "a different account" status.
 */
const NOW = Date.UTC(2026, 10, 26, 16);
const HOUR = 60 * 60 * 1_000;
const base = createFixtureState(NOW);
const chatgpt = base.instances.find(({ providerKind }) => providerKind === "chatgpt")!;
const cursor = base.instances.find(({ providerKind }) => providerKind === "cursor")!;

const state: AppViewState = {
  ...base,
  instances: [
    { ...chatgpt, userLabel: "Personal" },
    {
      ...chatgpt,
      id: "chatgpt:550e8400-e29b-41d4-a716-446655440001",
      userLabel: "Work",
      snapshot: chatgpt.snapshot && { ...chatgpt.snapshot, planLabel: "Pro" },
    },
    { ...cursor, userLabel: "Company" },
    {
      ...cursor,
      id: "cursor:550e8400-e29b-41d4-a716-446655440002",
      userLabel: "Side projects",
      snapshot: cursor.snapshot && { ...cursor.snapshot, fetchedAt: NOW - 3 * HOUR },
      lastAttempt: {
        trigger: "scheduled",
        startedAt: NOW - 5 * 60 * 1_000,
        finishedAt: NOW - 5 * 60 * 1_000,
        outcome: { kind: "failure", category: "other_account" },
      },
    },
  ],
};

createRoot(document.getElementById("root")!).render(
  <main style={{ width: 400 }}>
    <Cockpit
      state={state}
      now={NOW}
      onDisplayModeChange={() => undefined}
      onRefresh={() => undefined}
      onConnectProvider={() => undefined}
    />
  </main>,
);
requestAnimationFrame(() => document.body.setAttribute("data-ready", "1"));
