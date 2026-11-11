import { and, ne } from "drizzle-orm";
import {
  db,
  encryptedSecrets,
  integrationAuthorizationAttempts,
  integrationConnections,
  integrationCredentials,
  workspaceMemberships,
} from "@db";
import { env } from "@shared/environment";
import { getIntegrationCredentialKeyring } from "../integrations/credential-keyring";
import { vaultSecretKeyVersion } from "../integrations/vault-encryption";
import { rewrapIntegrationCredentials } from "../db/services/integrations/credentials";
import { rewrapVaultSecrets } from "../db/services/vault";

async function main() {
  const keyring = await getIntegrationCredentialKeyring();
  if (keyring.activeKeyVersion === "installation-v1") {
    throw new Error(
      "Set a new SECRET_ENCRYPTION_KEY_VERSION before running key rewrapping."
    );
  }

  const ownerRows = await db
    .select({ ownerUserId: integrationConnections.ownerUserId })
    .from(integrationConnections);
  const attemptOwnerRows = await db
    .select({ ownerUserId: integrationAuthorizationAttempts.ownerUserId })
    .from(integrationAuthorizationAttempts);
  const owners = new Set([
    ...ownerRows.map((row) => row.ownerUserId),
    ...attemptOwnerRows.map((row) => row.ownerUserId),
  ]);

  let integrationRecordsRewrapped = 0;
  for (const ownerUserId of owners) {
    integrationRecordsRewrapped += await rewrapIntegrationCredentials({
      ownerUserId,
      keyring,
    });
  }

  const memberships = await db
    .select({
      userId: workspaceMemberships.userId,
      workspaceId: workspaceMemberships.workspaceId,
    })
    .from(workspaceMemberships);
  const workspaces = new Map(
    memberships.map((membership) => [
      membership.workspaceId,
      membership,
    ])
  );
  let vaultRecordsRewrapped = 0;
  for (const scope of workspaces.values()) {
    vaultRecordsRewrapped += await rewrapVaultSecrets(scope);
  }

  const oldCredentials = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(ne(integrationCredentials.keyVersion, keyring.activeKeyVersion));
  const oldAttempts = await db
    .select({ id: integrationAuthorizationAttempts.id })
    .from(integrationAuthorizationAttempts)
    .where(
      ne(
        integrationAuthorizationAttempts.keyVersion,
        keyring.activeKeyVersion
      )
    );
  const vaultRows = await db
    .select({ encryptedValue: encryptedSecrets.encryptedValue })
    .from(encryptedSecrets)
    .where(and(ne(encryptedSecrets.namespace, "vault")));
  const oldVaultRecords = vaultRows.filter(
    (row) =>
      vaultSecretKeyVersion(row.encryptedValue) !== keyring.activeKeyVersion
  );

  const remaining = {
    integrationCredentials: oldCredentials.length,
    authorizationAttempts: oldAttempts.length,
    vaultSecrets: oldVaultRecords.length,
  };
  console.info(
    JSON.stringify({
      activeKeyVersion: env.SECRET_ENCRYPTION_KEY_VERSION,
      integrationRecordsRewrapped,
      vaultRecordsRewrapped,
      remainingOldKeyRecords: remaining,
    })
  );

  if (Object.values(remaining).some((count) => count > 0)) {
    throw new Error(
      "Key rewrapping is incomplete. Retain all historical keys and resolve the remaining records before removing old keys."
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown key rewrapping failure.";
  console.error(message);
  process.exitCode = 1;
});
