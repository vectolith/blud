type IntegrationProviderStatus = "planned" | "enabled";

type IntegrationRisk = "read" | "write";

type IntegrationApprovalPolicy = "not_required" | "required";

export interface IntegrationProviderDefinition {
  readonly key: string;
  readonly name: string;
  readonly authorizationModel: "github_app_user" | "google_oauth";
  readonly status: IntegrationProviderStatus;
}

export interface IntegrationActionDefinition {
  readonly key: string;
  readonly provider: IntegrationProviderKey;
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

export type IntegrationProviderKey = keyof typeof integrationProviders;

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
    requiredProviderPermissions: ["https://www.googleapis.com/auth/gmail.send"],
    approval: "required",
  },
} as const satisfies Record<string, IntegrationActionDefinition>;

export type IntegrationActionKey = keyof typeof integrationActions;

export function getIntegrationProvider(key: string) {
  return Object.values(integrationProviders).find(
    (provider) => provider.key === key
  );
}

export function getIntegrationAction(key: string) {
  return Object.values(integrationActions).find((action) => action.key === key);
}

export function listIntegrationProviders() {
  return Object.values(integrationProviders);
}

export function listIntegrationActions(provider?: IntegrationProviderKey) {
  return Object.values(integrationActions).filter(
    (action) => provider === undefined || action.provider === provider
  );
}

function isProviderEnabled(
  provider: IntegrationProviderDefinition | undefined
): boolean {
  return provider?.status === "enabled";
}

export function isIntegrationActionAvailable(key: IntegrationActionKey) {
  const action = integrationActions[key];
  return isProviderEnabled(getIntegrationProvider(action.provider));
}
