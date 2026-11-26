import type { ProviderKind } from "../domain/provider-kind";

export interface ProviderDefinition {
  readonly cardinality: "single" | "multiple";
  readonly credentialKind: "none" | "api-key";
  readonly configKind: "fixed" | "dynamic-origin";
  readonly optionalOrigins: readonly string[];
  readonly optionalPermissions: readonly Browser.runtime.ManifestPermission[];
}

export const providerDefinitions = {
  chatgpt: {
    cardinality: "multiple",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://chatgpt.com/*"],
    optionalPermissions: [],
  },
  claude: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://claude.ai/*"],
    optionalPermissions: [],
  },
  kimi: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://www.kimi.com/*"],
    optionalPermissions: ["scripting"],
  },
  cursor: {
    cardinality: "multiple",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://cursor.com/*"],
    optionalPermissions: ["scripting"],
  },
  grok: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://grok.com/*"],
    optionalPermissions: ["scripting"],
  },
  mistral: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: [
      "https://admin.mistral.ai/*",
      "https://console.mistral.ai/*",
    ],
    optionalPermissions: [],
  },
  perplexity: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://www.perplexity.ai/*"],
    optionalPermissions: [],
  },
  elevenlabs: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.elevenlabs.io/*"],
    optionalPermissions: [],
  },
  newapi: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
  },
  litellm: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
  },
  clawrouter: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
  },
  sub2api: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
  },
  llmProxy: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "dynamic-origin",
    optionalOrigins: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    optionalPermissions: [],
  },
  deepseek: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.deepseek.com/*"],
    optionalPermissions: [],
  },
  moonshot: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.moonshot.ai/*"],
    optionalPermissions: [],
  },
  deepinfra: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.deepinfra.com/*"],
    optionalPermissions: [],
  },
  fireworks: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.fireworks.ai/*"],
    optionalPermissions: [],
  },
  openai: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.openai.com/*"],
    optionalPermissions: [],
  },
  groqcloud: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.groq.com/*"],
    optionalPermissions: [],
  },
  openrouter: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://openrouter.ai/*"],
    optionalPermissions: [],
  },
  factory: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.factory.ai/*"],
    optionalPermissions: [],
  },
  zai: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://api.z.ai/*"],
    optionalPermissions: [],
  },
  warp: {
    cardinality: "multiple",
    credentialKind: "api-key",
    configKind: "fixed",
    optionalOrigins: ["https://app.warp.dev/*"],
    optionalPermissions: [],
  },
  gumloop: {
    cardinality: "single",
    credentialKind: "none",
    configKind: "fixed",
    optionalOrigins: ["https://www.gumloop.com/*", "https://api.gumloop.com/*"],
    optionalPermissions: ["scripting"],
  },
} as const satisfies { [Kind in ProviderKind]: ProviderDefinition };
