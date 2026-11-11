import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../index";
import {
  integrationAuthorizationAttempts,
  integrationConnections,
  integrationCredentials,
} from "../../schema";
import {
  decryptCredential,
  encryptCredential,
  authorizationAttemptAad,
  integrationCredentialAad,
  type CredentialKeyring,
} from "../../../integrations/credential-encryption";

export type IntegrationCredentialType = "oauth_tokens" | "api_token";

export class IntegrationConnectionUnavailableError extends Error {
  constructor() {
    super("The integration connection is unavailable.");
    this.name = "IntegrationConnectionUnavailableError";
  }
}

export async function storeIntegrationCredential(input: {
  ownerUserId: string;
  connectionId: string;
  credentialType: IntegrationCredentialType;
  plaintext: string;
  expiresAt?: Date;
  keyring: CredentialKeyring;
}): Promise<void> {
  const aad = integrationCredentialAad(
    input.ownerUserId,
    input.connectionId,
    input.credentialType
  );
  const encrypted = encryptCredential(input.plaintext, input.keyring, aad);

  await db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.ownerUserId, input.ownerUserId),
          eq(integrationConnections.status, "active")
        )
      )
      .limit(1);

    if (!connection) {
      throw new IntegrationConnectionUnavailableError();
    }

    await tx
      .insert(integrationCredentials)
      .values({
        id: randomUUID(),
        connectionId: input.connectionId,
        ownerUserId: input.ownerUserId,
        credentialType: input.credentialType,
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: [
          integrationCredentials.connectionId,
          integrationCredentials.credentialType,
        ],
        set: {
          ownerUserId: input.ownerUserId,
          algorithm: encrypted.algorithm,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          expiresAt: input.expiresAt ?? null,
          updatedAt: new Date(),
        },
      });
  });
}

export async function readIntegrationCredential(input: {
  ownerUserId: string;
  connectionId: string;
  credentialType: IntegrationCredentialType;
  keyring: CredentialKeyring;
}): Promise<string | null> {
  const [record] = await db
    .select({
      algorithm: integrationCredentials.algorithm,
      ciphertext: integrationCredentials.ciphertext,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
      keyVersion: integrationCredentials.keyVersion,
    })
    .from(integrationCredentials)
    .innerJoin(
      integrationConnections,
      and(
        eq(integrationConnections.id, integrationCredentials.connectionId),
        eq(
          integrationConnections.ownerUserId,
          integrationCredentials.ownerUserId
        )
      )
    )
    .where(
      and(
        eq(integrationCredentials.connectionId, input.connectionId),
        eq(integrationCredentials.ownerUserId, input.ownerUserId),
        eq(integrationCredentials.credentialType, input.credentialType),
        eq(integrationConnections.status, "active")
      )
    )
    .limit(1);

  if (!record) return null;
  if (record.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported integration credential algorithm.");
  }

  return decryptCredential(
    {
      algorithm: "aes-256-gcm",
      ciphertext: record.ciphertext,
      iv: record.iv,
      authTag: record.authTag,
      keyVersion: record.keyVersion,
    },
    input.keyring,
    integrationCredentialAad(
      input.ownerUserId,
      input.connectionId,
      input.credentialType
    )
  );
}

export async function rewrapIntegrationCredentials(input: {
  ownerUserId: string;
  keyring: CredentialKeyring;
}): Promise<number> {
  return db.transaction(async (tx) => {
    const records = await tx
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.ownerUserId, input.ownerUserId))
      .for("update");
    let rewrapped = 0;

    /* oxlint-disable eslint/no-await-in-loop -- Each encrypted credential is authenticated and conditionally replaced in the same transaction. */
    for (const record of records) {
      if (record.keyVersion === input.keyring.activeKeyVersion) continue;
      if (record.algorithm !== "aes-256-gcm") {
        throw new Error("Unsupported integration credential algorithm.");
      }

      const aad = integrationCredentialAad(
        input.ownerUserId,
        record.connectionId,
        record.credentialType
      );
      const plaintext = decryptCredential(
        {
          algorithm: "aes-256-gcm",
          ciphertext: record.ciphertext,
          iv: record.iv,
          authTag: record.authTag,
          keyVersion: record.keyVersion,
        },
        input.keyring,
        aad
      );
      const replacement = encryptCredential(plaintext, input.keyring, aad);
      const updated = await tx
        .update(integrationCredentials)
        .set({
          algorithm: replacement.algorithm,
          ciphertext: replacement.ciphertext,
          iv: replacement.iv,
          authTag: replacement.authTag,
          keyVersion: replacement.keyVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationCredentials.id, record.id),
            eq(integrationCredentials.ownerUserId, input.ownerUserId),
            eq(integrationCredentials.keyVersion, record.keyVersion),
            eq(integrationCredentials.ciphertext, record.ciphertext)
          )
        )
        .returning({ id: integrationCredentials.id });
      if (updated.length > 0) rewrapped += 1;
    }
    const attempts = await tx
      .select()
      .from(integrationAuthorizationAttempts)
      .where(
        eq(integrationAuthorizationAttempts.ownerUserId, input.ownerUserId)
      )
      .for("update");

    for (const attempt of attempts) {
      if (attempt.keyVersion === input.keyring.activeKeyVersion) continue;
      const aad = authorizationAttemptAad(input.ownerUserId, attempt.id);
      const plaintext = decryptCredential(
        {
          algorithm: "aes-256-gcm",
          ciphertext: attempt.pkceVerifierCiphertext,
          iv: attempt.pkceVerifierIv,
          authTag: attempt.pkceVerifierAuthTag,
          keyVersion: attempt.keyVersion,
        },
        input.keyring,
        aad
      );
      const replacement = encryptCredential(plaintext, input.keyring, aad);
      const updated = await tx
        .update(integrationAuthorizationAttempts)
        .set({
          pkceVerifierCiphertext: replacement.ciphertext,
          pkceVerifierIv: replacement.iv,
          pkceVerifierAuthTag: replacement.authTag,
          keyVersion: replacement.keyVersion,
        })
        .where(
          and(
            eq(integrationAuthorizationAttempts.id, attempt.id),
            eq(integrationAuthorizationAttempts.ownerUserId, input.ownerUserId),
            eq(integrationAuthorizationAttempts.keyVersion, attempt.keyVersion),
            eq(
              integrationAuthorizationAttempts.pkceVerifierCiphertext,
              attempt.pkceVerifierCiphertext
            )
          )
        )
        .returning({ id: integrationAuthorizationAttempts.id });
      if (updated.length > 0) rewrapped += 1;
    }
    /* oxlint-enable eslint/no-await-in-loop */

    return rewrapped;
  });
}

export async function deleteIntegrationCredential(input: {
  ownerUserId: string;
  connectionId: string;
  credentialType: IntegrationCredentialType;
}): Promise<void> {
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.ownerUserId, input.ownerUserId),
        eq(integrationCredentials.connectionId, input.connectionId),
        eq(integrationCredentials.credentialType, input.credentialType)
      )
    );
}
