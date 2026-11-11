import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  loginAccountHint,
  parsePaymentCardSecret,
  parseLoginVaultPayload,
  paymentCardBrand,
  vaultItemKindSchema,
  type VaultCreateItem,
} from "@shared/vault/schema";
import type { AccessScope } from "@shared/identity/access-scope";
import type { CredentialKeyring } from "../../integrations/credential-encryption";
import { db, encryptedSecrets, vaultItems } from "@db";
import {
  deleteEncryptedSecret,
  readEncryptedSecret,
  writeEncryptedSecret,
} from "@db/services/secrets";
import { ensureScope } from "@db/services/scope";
import { getIntegrationCredentialKeyring } from "../../integrations/credential-keyring";
import {
  decryptVaultSecret,
  encryptVaultSecret,
  vaultSecretKeyVersion,
} from "../../integrations/vault-encryption";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

type VaultRecord = z.infer<typeof vaultRecordSchema>;

const selection = {
  account: vaultItems.account,
  createdAt: vaultItems.createdAt,
  id: vaultItems.id,
  kind: vaultItems.kind,
  label: vaultItems.label,
  updatedAt: vaultItems.updatedAt,
};

async function createVaultRecord(scope: AccessScope, record: VaultRecord) {
  await db.insert(vaultItems).values({
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    workspaceId: scope.workspaceId,
  });
}

export async function listVaultItems(scope: AccessScope) {
  return vaultRecordSchema
    .array()
    .parse(
      (
        await db
          .select(selection)
          .from(vaultItems)
          .where(eq(vaultItems.workspaceId, scope.workspaceId))
          .orderBy(desc(vaultItems.updatedAt))
      ).map(serializeVaultRecord)
    );
}

export async function readVaultItems(scope: AccessScope) {
  await ensureScope(scope);
  const records = await listVaultItems(scope);
  return Promise.all(
    records.map(async (record) =>
      Object.assign({}, record, {
        hasSecret: await hasVaultSecret(scope, record.id),
      })
    )
  );
}

export async function readVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .select(selection)
    .from(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .limit(1);
  return vaultRecordSchema
    .optional()
    .parse(rows[0] ? serializeVaultRecord(rows[0]) : undefined);
}

export async function deleteVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .delete(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .returning({ id: vaultItems.id });
  if (rows.length === 0) return false;
  await deleteEncryptedSecret(scope, id);
  return true;
}

export async function saveVaultItem(
  scope: AccessScope,
  input: VaultCreateItem
) {
  await ensureScope(scope);
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeVaultSecret(scope, id, input.secret);

  try {
    await createVaultRecord(scope, {
      account: vaultAccountHint(input),
      createdAt: now,
      id,
      kind: input.kind,
      label: input.label,
      updatedAt: now,
    });
  } catch (error) {
    await deleteEncryptedSecret(scope, id);
    throw error;
  }
}

export async function readVaultSecret(
  scope: AccessScope,
  id: string,
  keyringOverride?: CredentialKeyring
) {
  const encrypted = await readEncryptedSecret(scope, id);
  if (!encrypted) return undefined;
  const keyring = keyringOverride ?? (await getIntegrationCredentialKeyring());
  return decryptVaultSecret(scope, id, encrypted, keyring);
}

export async function hasVaultSecret(scope: AccessScope, id: string) {
  return (await readEncryptedSecret(scope, id)) !== undefined;
}

export async function rewrapVaultSecrets(
  scope: AccessScope,
  keyringOverride?: CredentialKeyring
): Promise<number> {
  await ensureScope(scope);
  const keyring = keyringOverride ?? (await getIntegrationCredentialKeyring());
  if (keyring.keys.size === 1) return 0;

  return db.transaction(async (tx) => {
    const records = await tx
      .select({
        id: encryptedSecrets.id,
        encryptedValue: encryptedSecrets.encryptedValue,
      })
      .from(encryptedSecrets)
      .where(
        and(
          eq(encryptedSecrets.workspaceId, scope.workspaceId),
          eq(encryptedSecrets.namespace, "vault")
        )
      );
    let rewrapped = 0;

    /* oxlint-disable eslint/no-await-in-loop -- Each ciphertext is authenticated and conditionally replaced before the next record. */
    for (const record of records) {
      if (
        vaultSecretKeyVersion(record.encryptedValue) ===
        keyring.activeKeyVersion
      ) {
        continue;
      }
      const plaintext = decryptVaultSecret(
        scope,
        record.id,
        record.encryptedValue,
        keyring
      );
      const replacement = encryptVaultSecret(
        scope,
        record.id,
        plaintext,
        keyring
      );
      const updated = await tx
        .update(encryptedSecrets)
        .set({ encryptedValue: replacement, updatedAt: new Date() })
        .where(
          and(
            eq(encryptedSecrets.workspaceId, scope.workspaceId),
            eq(encryptedSecrets.namespace, "vault"),
            eq(encryptedSecrets.id, record.id),
            eq(encryptedSecrets.encryptedValue, record.encryptedValue)
          )
        )
        .returning({ id: encryptedSecrets.id });
      if (updated.length > 0) rewrapped += 1;
    }
    /* oxlint-enable eslint/no-await-in-loop */

    return rewrapped;
  });
}

async function writeVaultSecret(scope: AccessScope, id: string, value: string) {
  const keyring = await getIntegrationCredentialKeyring();
  await writeEncryptedSecret(
    scope,
    id,
    encryptVaultSecret(scope, id, value, keyring)
  );
}

function vaultAccountHint(input: VaultCreateItem) {
  switch (input.kind) {
    case "login": {
      const payload = parseLoginVaultPayload(input.secret);
      if (!payload)
        throw new Error("The saved login is incomplete or invalid.");
      return loginAccountHint(
        payload.identifier,
        "origin" in payload ? payload.origin : undefined
      );
    }
    case "payment": {
      const card = parsePaymentCardSecret(input.secret);
      return `${paymentCardBrand(card.number)} · •••• ${card.number.slice(-4)}`;
    }
    case "address":
    case "contact":
      return "";
  }
  throw new Error("Unsupported vault item kind.");
}

function serializeVaultRecord<T extends { createdAt: Date; updatedAt: Date }>(
  record: T
) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
