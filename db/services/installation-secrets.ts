import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  betterAuthSecretSchema,
  env,
  secretEncryptionKeySchema,
} from "@shared/environment";
import {
  objectStoreConfigured,
  readObject,
  writeObject,
} from "@shared/storage/object-store";

const installationSecretsSchema = z.object({
  betterAuthSecret: betterAuthSecretSchema,
  secretEncryptionKey: secretEncryptionKeySchema,
  version: z.literal(1),
});

export type InstallationSecrets = z.infer<typeof installationSecretsSchema>;

const maximumInstallationSecretsBytes = 1024;
let installationSecretsPromise: Promise<InstallationSecrets> | undefined;

export function getInstallationSecrets() {
  installationSecretsPromise ??= resolveInstallationSecretsWithRetry();
  return installationSecretsPromise;
}

async function resolveInstallationSecretsWithRetry() {
  try {
    return await resolveInstallationSecrets();
  } catch (error) {
    installationSecretsPromise = undefined;
    throw error;
  }
}

async function resolveInstallationSecrets() {
  const configured = configuredInstallationSecrets();
  if (configured?.betterAuthSecret && configured.secretEncryptionKey) {
    return installationSecretsSchema.parse({ ...configured, version: 1 });
  }

  if (!objectStoreConfigured(env)) {
    throw new Error(
      "Installation secrets are unavailable. Configure S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY, or set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY."
    );
  }
  const pathname = installationSecretsPathname();
  const existing = await readInstallationSecrets(pathname);
  if (existing) {
    return installationSecretsSchema.parse({
      ...existing,
      ...configured,
      version: 1,
    });
  }
  if (configured) {
    throw new Error(
      "A partial installation-secret override requires an existing object-store secret record."
    );
  }

  const generated = installationSecretsSchema.parse({
    betterAuthSecret: randomBytes(32).toString("base64"),
    secretEncryptionKey: randomBytes(32).toString("base64"),
    version: 1,
  });
  try {
    await writeObject(
      env,
      pathname,
      Buffer.from(JSON.stringify(generated), "utf8"),
      {
        cacheControl: "private, max-age=31536000, immutable",
        contentType: "application/json",
        createOnly: true,
      }
    );
    return generated;
  } catch (error) {
    const winner = await readInstallationSecrets(pathname);
    if (winner) return winner;
    throw error;
  }
}

function configuredInstallationSecrets() {
  const betterAuthSecret = env.BETTER_AUTH_SECRET;
  const secretEncryptionKey = env.SECRET_ENCRYPTION_KEY;
  if (!betterAuthSecret && !secretEncryptionKey) return undefined;
  const configured: Partial<InstallationSecrets> = {};
  if (betterAuthSecret) configured.betterAuthSecret = betterAuthSecret;
  if (secretEncryptionKey) {
    configured.secretEncryptionKey = secretEncryptionKey;
  }
  return configured;
}

async function readInstallationSecrets(pathname: string) {
  const stored = await readObject(env, pathname);
  if (!stored) return undefined;
  if (stored.contentLength > maximumInstallationSecretsBytes) {
    throw new Error("The installation secrets object is unexpectedly large.");
  }
  const value: unknown = JSON.parse(Buffer.from(stored.body).toString("utf8"));
  return installationSecretsSchema.parse(value);
}

function installationSecretsPathname() {
  const scope = createHash("sha256")
    .update(env.BLUD_INSTALLATION_ID ?? process.env.HOSTNAME ?? "standalone")
    .digest("hex")
    .slice(0, 32);
  return "blud/system/" + scope + "/installation-secrets.v1.json";
}
