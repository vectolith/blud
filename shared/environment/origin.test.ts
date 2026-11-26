import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BETTER_AUTH_URL", "");
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@example.com/database");
  vi.stubEnv("KERNEL_API_KEY", "test-kernel-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("application origin", () => {
  it("uses the configured public URL", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://assistant.example/path");

    const { applicationOrigin, betterAuthBaseURL } =
      await import("@shared/environment/origin");

    expect(applicationOrigin()).toBe("https://assistant.example");
    expect(betterAuthBaseURL()).toBe("https://assistant.example");
  });

  it("fails clearly when no public URL is configured", async () => {
    const { applicationOrigin } = await import("@shared/environment/origin");

    expect(() => applicationOrigin()).toThrow("Set BETTER_AUTH_URL");
  });
});
