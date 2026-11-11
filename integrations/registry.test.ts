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
    for (const action of Object.values(integrationActions)) {
      if (action.risk === "write") {
        expect(action.approval).toBe("required");
      } else {
        expect(action.approval).toBe("not_required");
      }
    }
  });

  it("filters actions by provider without mixing channel identities into access", () => {
    expect(
      listIntegrationActions("github").map((action) => action.key)
    ).toEqual(["github.repository.read", "github.issue.create"]);
    expect(listIntegrationActions("google_workspace")).toHaveLength(4);
  });

  it("does not advertise planned providers as executable", () => {
    expect(
      Object.values(integrationProviders).every(
        (provider) => provider.status === "planned"
      )
    ).toBe(true);

    for (const key of Object.keys(integrationActions) as Array<
      keyof typeof integrationActions
    >) {
      expect(isIntegrationActionAvailable(key)).toBe(false);
    }
  });
});
