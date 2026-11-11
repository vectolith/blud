import { describe, expect, it } from "vitest";
import {
  getIntegrationAction,
  getIntegrationProvider,
  integrationActions,
  integrationProviders,
  isIntegrationActionAvailable,
  listIntegrationActions,
  listIntegrationProviders,
} from "./registry";

describe("integration registry", () => {
  it("contains only explicitly declared providers", () => {
    expect(listIntegrationProviders()).toEqual([
      integrationProviders.github,
      integrationProviders.google_workspace,
    ]);
    expect(getIntegrationProvider("unknown")).toBeUndefined();

    for (const [key, provider] of Object.entries(integrationProviders)) {
      expect(provider.key).toBe(key);
    }
  });

  it("defines action identifiers that resolve to their owning provider", () => {
    for (const [key, action] of Object.entries(integrationActions)) {
      expect(action.key).toBe(key);
      expect(getIntegrationProvider(action.provider)).toBeDefined();
      expect(action.requiredProviderPermissions.length).toBeGreaterThan(0);
    }

    expect(getIntegrationAction("github.issue.create")?.provider).toBe(
      "github"
    );
    expect(getIntegrationAction("unknown.action")).toBeUndefined();
  });

  it("keeps reads separate from writes and requires approval for writes", () => {
    const actions = Object.values(integrationActions);
    const writeActions = actions.filter((action) => action.risk === "write");
    const readActions = actions.filter((action) => action.risk === "read");

    expect(writeActions.every((action) => action.approval === "required")).toBe(
      true
    );
    expect(
      readActions.every((action) => action.approval === "not_required")
    ).toBe(true);
  });

  it("filters actions by provider", () => {
    expect(
      listIntegrationActions("github").map((action) => action.key)
    ).toEqual(["github.repository.read", "github.issue.create"]);
    expect(listIntegrationActions("google_workspace")).toHaveLength(4);
  });

  it("does not advertise planned providers as executable", () => {
    expect(
      listIntegrationProviders().map((provider) => provider.status)
    ).toEqual(["planned", "planned"]);

    for (const action of Object.values(integrationActions)) {
      expect(isIntegrationActionAvailable(action.key)).toBe(false);
    }
  });
});
