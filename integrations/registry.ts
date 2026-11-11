export type IntegrationProviderStatus = "planned" | "enabled";

export type IntegrationRisk = "read" | "write";

export type IntegrationApprovalPolicy = "not_required" | "required";

export interface IntegrationProviderDefinition {
  readonly key: string;
  readonly name: string;
  readonly authorizationModel: "github_app_user" | "google_oauth";
  readonly status: IntegrationProviderStatus;
}

export interface IntegrationActionDefinition {
  readonly key: string;
  readonly provider: string;
  readonly description: string;
  readonly risk: IntegrationRisk;
  readonly requiredProviderPermissions: readonly string[];
  readonly approval: IntegrationApprovalPolicy;
}

export const integrationProviders = {
  github: {
    key: "github",
    name: "GitHub",
    authorizationModel: "github_app_user",
    status: "planned",
  },
  google_workspace: {
    key: "google_workspace",
    name: "Google Workspace",
    authorizationModel: "google_oauth",
    status: "planned",
  },
} as const satisfies Record<string, IntegrationProviderDefinition>;

export const integrationActions = {
  "github.repository.read": {
    key: "github.repository.read",
    provider: "github",
    description: "Read repository metadata and content permitted by the grant.",
    risk: "read",
    requiredProviderPermissions: ["contents:read", "metadata:read"],
    approval: "not_required",
  },
  "github.issue.create": {
    key: "github.issue.create",
    provider: "github",
    description: "Create an issue in a repository.",
    risk: "write",
    requiredProviderPermissions: ["issues:write"],
    approval: "required",
  },
  "google.calendar.event.read": {
    key: "google.calendar.event.read",
    provider: "google_workspace",
    description: "Read calendar events permitted by the OAuth grant.",
    risk: "read",
    requiredProviderPermissions: [
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    approval: "not_required",
  },
  "google.calendar.event.write": {
    key: "google.calendar.event.write",
    provider: "google_workspace",
    description: "Create or modify calendar events.",
    risk: "write",
    requiredProviderPermissions: [
      "https://www.googleapis.com/auth/calendar.events",
    ],
    approval: "required",
  },
  "google.gmail.message.read": {
    key: "google.gmail.message.read",
    provider: "google_workspace",
    description: "Read Gmail messages permitted by the OAuth grant.",
    risk: "read",
    requiredProviderPermissions: [
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    approval: "not_required",
  },
  "google.gmail.message.send": {
    key: "google.gmail.message.send",
    provider: "google_workspace",
    description: "Send an email message.",
    risk: "write",
    requiredProviderPermissions: [
      "https://www.googleapis.com/auth/gmail.send",
    ],
    approval: "required",
  },
} as const satisfies Record<string, IntegrationActionDefinition>;

export type IntegrationProviderKey = keyof typeof integrationProviders;
export type IntegrationActionKey = keyof typeof integrationActions;

export function getIntegrationProvider(key: string) {
  return Object.hasOwn(integrationProviders, key)
    ? integrationProviders[key as IntegrationProviderKey]
    : undefined;
}

export function getIntegrationAction(key: string) {
  return Object.hasOwn(integrationActions, key)
    ? integrationActions[key as IntegrationActionKey]
    : undefined;
}

export function listIntegrationProviders() {
  return Object.values(integrationProviders);
}

export function listIntegrationActions(provider?: IntegrationProviderKey) {
  return Object.values(integrationActions).filter(
    (action) => provider === undefined || action.provider === provider
  );
}

export function isIntegrationActionAvailable(key: IntegrationActionKey) {
  const action = integrationActions[key];
  const provider = getIntegrationProvider(action.provider);
  return provider?.status === "enabled";
}
