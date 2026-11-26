import { chatGptLiveAccountKey } from "./chatgpt/adapter";
import { cursorAccountKey } from "./cursor/adapter";
import { cloudflareCookie, type SavedSessionSpec } from "./saved-session";

export const cursorSavedSession: SavedSessionSpec = {
  kind: "cursor",
  siteUrl: "https://cursor.com/",
  cookieDomain: "cursor.com",
  signInUrl: "https://cursor.com/dashboard",
  ruleId: 2,
  isAuthCookie: (name) => name === "WorkosCursorSessionToken",
  isDeviceCookie: cloudflareCookie,
  liveAccountKey: cursorAccountKey,
};

const CHATGPT_SESSION_COOKIE = "__Secure-next-auth.session-token";

export const chatGptSavedSession: SavedSessionSpec = {
  kind: "chatgpt",
  siteUrl: "https://chatgpt.com/",
  cookieDomain: "chatgpt.com",
  signInUrl: "https://chatgpt.com/auth/login",
  ruleId: 3,
  // Large sessions are split into numbered chunks (`.0`, `.1`, ...).
  isAuthCookie: (name) =>
    name === CHATGPT_SESSION_COOKIE ||
    /^__Secure-next-auth\.session-token\.\d+$/.test(name),
  isDeviceCookie: (name) => cloudflareCookie(name) || name === "oai-did",
  liveAccountKey: chatGptLiveAccountKey,
};

export const savedSessionSpecs = [cursorSavedSession, chatGptSavedSession] as const;
