import { createHash } from "node:crypto";
import { link } from "@stripe/link-integrations-better-auth";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { account, db, session, user, verification } from "@db";
import { betterAuthBaseURL } from "@shared/environment/origin";
import { env, localPhoneAuthBypassEnabled } from "@shared/environment";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { sendSendblueMessage } from "@shared/chat/sendblue-client";
import { isE164PhoneNumber } from "@shared/identity/phone-number";

let authPromise: ReturnType<typeof initializeAuth> | undefined;

export function getAuth() {
  authPromise ??= initializeAuthWithRetry();
  return authPromise;
}

async function initializeAuthWithRetry() {
  try {
    return await initializeAuth();
  } catch (error) {
    authPromise = undefined;
    throw error;
  }
}

async function initializeAuth() {
  const { betterAuthSecret } = await getInstallationSecrets();
  const { LINK_CLIENT_ID, LINK_CLIENT_SECRET, STRIPE_PUBLISHABLE_KEY } = env;
  return betterAuth({
    appName: "BLUD",
    baseURL: betterAuthBaseURL(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { account, session, user, verification },
    }),
    disabledPaths: [
      "/change-email",
      "/request-password-reset",
      "/reset-password",
      "/reset-password/:token",
      "/send-verification-email",
      "/sign-in/email",
      "/sign-in/social",
      "/sign-up/email",
      "/verify-email",
      // Wallet disconnection must revoke the Link grant through its plugin.
      "/unlink-account",
    ],
    account: {
      encryptOAuthTokens: true,
      additionalFields: {
        issuer: {
          type: "string",
          required: true,
          input: false,
          defaultValue: "better-auth",
        },
      },
      accountLinking: {
        trustedProviders: ["link"],
        allowDifferentEmails: true,
        // Phone verification signs users in independently of OAuth accounts.
        allowUnlinkingAll: true,
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (value) => {
            if (value.providerId === "link") {
              const [existing] = await db
                .select({ id: account.id })
                .from(account)
                .where(
                  and(
                    eq(account.userId, value.userId),
                    eq(account.providerId, "link")
                  )
                )
                .limit(1);
              // Reauthorization updates the same account. Replacing it requires
              // disconnecting first so the previous grant is revoked.
              if (existing) return false;
            }
            return { data: { ...value, issuer: value.providerId } };
          },
        },
      },
    },
    plugins: [
      ...(LINK_CLIENT_ID && LINK_CLIENT_SECRET && STRIPE_PUBLISHABLE_KEY
        ? [
            link({
              clientId: LINK_CLIENT_ID,
              clientSecret: LINK_CLIENT_SECRET,
              publishableKey: STRIPE_PUBLISHABLE_KEY,
            }),
          ]
        : []),
      phoneNumber({
        allowedAttempts: 3,
        expiresIn: 300,
        phoneNumberValidator: isE164PhoneNumber,
        requireVerification: true,
        sendOTP: localPhoneAuthBypassEnabled
          ? () => undefined
          : ({ code, phoneNumber: to }) => sendPhoneCode({ code, to }),
        signUpOnVerification: {
          getTempEmail: (phoneNumberValue) =>
            `phone-${createHash("sha256")
              .update(phoneNumberValue)
              .digest("hex")}@local-vault.invalid`,
          getTempName: () => "Phone user",
        },
        verifyOTP: localPhoneAuthBypassEnabled
          ? ({ phoneNumber: value }) => isE164PhoneNumber(value)
          : undefined,
      }),
    ],
    secret: betterAuthSecret,
  });
}

export async function sendPhoneCode({
  code,
  to,
}: {
  readonly code: string;
  readonly to: string;
}) {
  const result = await sendSendblueMessage({
    text: `BLUD sign-in code: ${code}. Expires in 5 minutes.`,
    to,
  });
  if (result.ok) return;

  if (!result.retryable) {
    throw new APIError("BAD_REQUEST", {
      code: "SIGN_IN_CODE_UNDELIVERABLE",
      message:
        "Blud could not deliver a sign-in code to that number. Check the number and try again.",
    });
  }

  throw new APIError("BAD_GATEWAY", {
    code: "SIGN_IN_CODE_DELIVERY_FAILED",
    message: "Blud could not send a sign-in code right now. Try again shortly.",
  });
}
