import { describe, expect, it } from "vitest";
import { verifySendblueWebhook } from "@agent/lib/sendblue/webhook-auth";

describe("verifySendblueWebhook", () => {
  it("accepts a matching secret", () => {
    expect(
      verifySendblueWebhook({
        configuredSecret: "s".repeat(32),
        providedSecret: "s".repeat(32),
        isProduction: true,
      })
    ).toEqual({ ok: true });
  });

  it("rejects a wrong secret", () => {
    const decision = verifySendblueWebhook({
      configuredSecret: "a".repeat(32),
      providedSecret: "b".repeat(32),
      isProduction: true,
    });
    expect(decision).toEqual({
      ok: false,
      status: 401,
      error: "Invalid webhook secret.",
    });
  });

  it("rejects a missing secret when one is configured", () => {
    const decision = verifySendblueWebhook({
      configuredSecret: "a".repeat(32),
      providedSecret: null,
      isProduction: false,
    });
    expect(decision.ok).toBe(false);
  });

  it("refuses production deployments without a configured secret", () => {
    const decision = verifySendblueWebhook({
      configuredSecret: undefined,
      providedSecret: "anything",
      isProduction: true,
    });
    expect(decision).toEqual({
      ok: false,
      status: 503,
      error: "SENDBLUE_WEBHOOK_SECRET is not configured.",
    });
  });

  it("allows local development without a secret", () => {
    expect(
      verifySendblueWebhook({
        configuredSecret: undefined,
        providedSecret: null,
        isProduction: false,
      })
    ).toEqual({ ok: true });
  });
});
