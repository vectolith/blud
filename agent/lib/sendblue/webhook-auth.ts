import { timingSafeEqual } from "node:crypto";

/**
 * Authenticate an inbound Sendblue webhook.
 *
 * Fail-closed: when a shared secret is configured the request must present it, and a
 * deployment without a secret is refused in production rather than accepted. The
 * comparison is length-guarded so a wrong length cannot short-circuit.
 */
export function verifySendblueWebhook(input: {
  configuredSecret: string | undefined;
  providedSecret: string | null;
  isProduction: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  const { configuredSecret, providedSecret, isProduction } = input;

  if (!configuredSecret) {
    if (isProduction) {
      return {
        ok: false,
        status: 503,
        error: "SENDBLUE_WEBHOOK_SECRET is not configured.",
      };
    }
    return { ok: true };
  }

  if (!providedSecret) {
    return { ok: false, status: 401, error: "Missing webhook secret." };
  }

  const expected = Buffer.from(configuredSecret, "utf8");
  const actual = Buffer.from(providedSecret, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, status: 401, error: "Invalid webhook secret." };
  }
  return { ok: true };
}
