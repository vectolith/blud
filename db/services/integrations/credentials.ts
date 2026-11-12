import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../index";
import { integrationConnections, integrationCredentials } from "../../schema";
import {
  decryptCredential,
  encryptCredential,
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
