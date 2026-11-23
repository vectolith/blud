import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { databaseUrlSchema } from "@shared/environment/database-url";

export const betterAuthSecretSchema = z
  .string()
  .refine(
    (value) => value.trim().length >= 32,
    "BETTER_AUTH_SECRET must contain at least 32 characters."
  );

export const secretEncryptionKeySchema = z
  .string()
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
  );

const encryptionKeyVersionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);

const secretEncryptionKeyringSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "SECRET_ENCRYPTION_KEYRING must be valid JSON.",
      });
      return z.NEVER;
    }
    const result = z
      .record(encryptionKeyVersionSchema, secretEncryptionKeySchema)
      .refine((keys) => Object.keys(keys).length <= 8)
      .safeParse(parsed);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message:
          "SECRET_ENCRYPTION_KEYRING must map at most eight key versions to base64-encoded 32-byte keys.",
      });
      return z.NEVER;
    }
    return result.data;
  });

const localDevelopment =
  process.env.NODE_ENV === "development" &&
  process.env.VERCEL_ENV === undefined;
const explicitBetterAuthSecret = hasValue(process.env.BETTER_AUTH_SECRET);
const explicitSecretEncryptionKey = hasValue(process.env.SECRET_ENCRYPTION_KEY);

if (
  localDevelopment &&
  explicitBetterAuthSecret !== explicitSecretEncryptionKey
) {
  throw new Error(
    "Set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY, or leave both unset for local defaults."
  );
}

const useLocalInstallationDefaults =
  localDevelopment && !explicitBetterAuthSecret && !explicitSecretEncryptionKey;

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const betterAuthUrlSchema = requiredValue.refine(
  (value) => URL.canParse(value),
  "BETTER_AUTH_URL must be an absolute URL"
);

function optionalValueWithLocalDefault<T extends z.ZodType<string, string>>(
  schema: T,
  localDefault: z.util.NoUndefined<z.output<T>>
) {
  return localDevelopment ? schema.default(localDefault) : schema.optional();
}

function installationSecretWithLocalDefault<
  T extends z.ZodType<string, string>,
>(schema: T, localDefault: z.util.NoUndefined<z.output<T>>) {
  return useLocalInstallationDefaults
    ? schema.default(localDefault)
    : schema.optional();
}

export const env = createEnv({
  // Build workers do not receive production secrets. Skip schema validation
  // only when explicitly requested by the build environment; runtime
  // deployments must leave this unset so required configuration is enforced.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    // Required
    DATABASE_URL: databaseUrlSchema,
    KERNEL_API_KEY: requiredValue,
    BLUD_INTERNAL_KEY: z.string().min(32).optional(),

    // Optional overrides with local defaults. Vercel deployments provision
    // installation secrets in their connected private Blob store.
    BETTER_AUTH_SECRET: installationSecretWithLocalDefault(
      betterAuthSecretSchema,
      "blud-local-auth-development-secret"
    ),
    BETTER_AUTH_URL: optionalValueWithLocalDefault(
      betterAuthUrlSchema,
      "http://localhost:3000"
    ),
    SECRET_ENCRYPTION_KEY: installationSecretWithLocalDefault(
      secretEncryptionKeySchema,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    ),
    SECRET_ENCRYPTION_KEY_VERSION:
      encryptionKeyVersionSchema.default("installation-v1"),
    SECRET_ENCRYPTION_KEYRING: secretEncryptionKeyringSchema,

    // Optional
    BLOB_READ_WRITE_TOKEN: requiredValue.optional(),
    BLOB_STORE_ID: requiredValue.optional(),
    GOOGLE_CONNECTOR_UID: requiredValue.default("google/blud"),
    BLUD_ALLOW_LOCAL_PHONE_AUTH_BYPASS: z.enum(["true", "false"]).optional(),
    GITHUB_APP_CLIENT_ID: requiredValue.optional(),
    GITHUB_APP_CLIENT_SECRET: requiredValue.optional(),
    LINK_CLIENT_ID: requiredValue.optional(),
    LINK_CLIENT_SECRET: requiredValue.optional(),
    STRIPE_PUBLISHABLE_KEY: requiredValue.optional(),
    SENDBLUE_API_KEY: requiredValue.optional(),
    SENDBLUE_API_SECRET: requiredValue.optional(),
    SENDBLUE_FROM_NUMBER: requiredValue.optional(),
    SENDBLUE_WEBHOOK_SECRET: requiredValue.optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    VERCEL_BRANCH_URL: requiredValue.optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_PROJECT_ID: requiredValue.optional(),
    VERCEL_PROJECT_PRODUCTION_URL: requiredValue.optional(),
    VERCEL_URL: requiredValue.optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

const authHostname = env.BETTER_AUTH_URL
  ? new URL(env.BETTER_AUTH_URL).hostname
  : undefined;

/**
 * The local phone-auth bypass skips OTP delivery and accepts any well-formed
 * number, so it must never be reachable from a deployment.
 *
 * Outside a deployment it stays opt-in twice over: BLUD_ALLOW_LOCAL_PHONE_AUTH_BYPASS
 * must be "true" *and* the runtime must be a local development server. Test runs are
 * the one exception, and they are explicit: NODE_ENV is "test" only under the test
 * runner, never in a build or a deployment, so the integration suite can sign a phone
 * user in deterministically instead of standing up an SMS provider.
 */
const testEnvironment = process.env.NODE_ENV === "test";

export const localPhoneAuthBypassEnabled =
  env.BLUD_ALLOW_LOCAL_PHONE_AUTH_BYPASS === "true" &&
  (testEnvironment ||
    (localDevelopment &&
      (authHostname === "localhost" ||
        authHostname?.endsWith(".localhost") === true ||
        authHostname === "127.0.0.1" ||
        authHostname === "[::1]")));

function hasValue(value: string | undefined) {
  return value !== undefined && value.trim().length > 0;
}
