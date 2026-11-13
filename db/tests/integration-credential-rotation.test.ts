import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "../schema";
import {
  authorizationAttemptAad,
  createCredentialKeyring,
  decryptCredential,
  encryptCredential,
  integrationCredentialAad,
} from "../../integrations/credential-encryption";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("integration credential key rotation", () => {
  it("rewraps credentials atomically and preserves plaintext access", async () => {
    const client = new PGlite();
    databases.push(client);
    await createLegacyUserTable(client);
    await applyIntegrationMigration(client);

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services despite using a different Drizzle driver.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared Drizzle schema and query-builder contract.
    const database = pgliteDatabase as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(database);

    await pgliteDatabase.insert(schema.user).values({
      id: "owner-a",
      name: "Owner A",
      email: "owner-a@example.com",
    });
    await pgliteDatabase.insert(schema.integrationConnections).values({
      id: "connection-a",
      ownerUserId: "owner-a",
      providerKey: "github",
      providerAccountId: "github-account-a",
      status: "active",
    });

    const oldKey = Buffer.alloc(32, 1);
    const activeKey = Buffer.alloc(32, 2);
    const oldKeyring = createCredentialKeyring(
      "installation-v1",
      new Map([["installation-v1", oldKey]])
    );
    const rotatingKeyring = createCredentialKeyring(
      "v2",
      new Map([
        ["installation-v1", oldKey],
        ["v2", activeKey],
      ])
    );
    const aad = integrationCredentialAad(
      "owner-a",
      "connection-a",
      "api_token"
    );
    const encrypted = encryptCredential("provider-secret", oldKeyring, aad);
    await pgliteDatabase.insert(schema.integrationCredentials).values({
      id: "credential-a",
      connectionId: "connection-a",
      ownerUserId: "owner-a",
      credentialType: "api_token",
      algorithm: encrypted.algorithm,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
    });
    const verifierAad = authorizationAttemptAad("owner-a", "attempt-a");
    const encryptedVerifier = encryptCredential(
      "pkce-verifier-secret",
      oldKeyring,
      verifierAad
    );
    await pgliteDatabase
      .insert(schema.integrationAuthorizationAttempts)
      .values({
        id: "attempt-a",
        ownerUserId: "owner-a",
        providerKey: "github",
        stateHash: "state-hash-a",
        pkceVerifierCiphertext: encryptedVerifier.ciphertext,
        pkceVerifierIv: encryptedVerifier.iv,
        pkceVerifierAuthTag: encryptedVerifier.authTag,
        keyVersion: encryptedVerifier.keyVersion,
        redirectUri: "https://blud.example/api/integrations/github/callback",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      });

    const credentials = await import("@db/services/integrations/credentials");
    await expect(
      credentials.rewrapIntegrationCredentials({
        ownerUserId: "owner-a",
        keyring: rotatingKeyring,
      })
    ).resolves.toBe(2);
    await expect(
      credentials.readIntegrationCredential({
        ownerUserId: "owner-a",
        connectionId: "connection-a",
        credentialType: "api_token",
        keyring: rotatingKeyring,
      })
    ).resolves.toBe("provider-secret");

    const [rewrapped] = await pgliteDatabase
      .select()
      .from(schema.integrationCredentials);
    expect(rewrapped?.keyVersion).toBe("v2");

    const [rewrappedAttempt] = await pgliteDatabase
      .select()
      .from(schema.integrationAuthorizationAttempts);
    expect(rewrappedAttempt?.keyVersion).toBe("v2");
    expect(
      decryptCredential(
        {
          algorithm: "aes-256-gcm",
          ciphertext: rewrappedAttempt?.pkceVerifierCiphertext ?? "",
          iv: rewrappedAttempt?.pkceVerifierIv ?? "",
          authTag: rewrappedAttempt?.pkceVerifierAuthTag ?? "",
          keyVersion: rewrappedAttempt?.keyVersion ?? "",
        },
        rotatingKeyring,
        verifierAad
      )
    ).toBe("pkce-verifier-secret");
  });

  it("rolls back the rotation when a historical key is missing", async () => {
    const client = new PGlite();
    databases.push(client);
    await createLegacyUserTable(client);
    await applyIntegrationMigration(client);

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services despite using a different Drizzle driver.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared Drizzle schema and query-builder contract.
    const database = pgliteDatabase as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(database);

    await pgliteDatabase.insert(schema.user).values({
      id: "owner-a",
      name: "Owner A",
      email: "owner-a@example.com",
    });
    await pgliteDatabase.insert(schema.integrationConnections).values({
      id: "connection-a",
      ownerUserId: "owner-a",
      providerKey: "github",
      providerAccountId: "github-account-a",
      status: "active",
    });

    const unavailableKey = Buffer.alloc(32, 7);
    const unavailableKeyring = createCredentialKeyring(
      "v0",
      new Map([["v0", unavailableKey]])
    );
    const aad = integrationCredentialAad(
      "owner-a",
      "connection-a",
      "api_token"
    );
    const encrypted = encryptCredential(
      "provider-secret",
      unavailableKeyring,
      aad
    );
    await pgliteDatabase.insert(schema.integrationCredentials).values({
      id: "credential-a",
      connectionId: "connection-a",
      ownerUserId: "owner-a",
      credentialType: "api_token",
      algorithm: encrypted.algorithm,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
    });

    const rotatingKeyring = createCredentialKeyring(
      "v2",
      new Map([["v2", Buffer.alloc(32, 2)]])
    );
    const credentials = await import("@db/services/integrations/credentials");
    await expect(
      credentials.rewrapIntegrationCredentials({
        ownerUserId: "owner-a",
        keyring: rotatingKeyring,
      })
    ).rejects.toBeInstanceOf(Error);

    const [unchanged] = await pgliteDatabase
      .select()
      .from(schema.integrationCredentials);
    expect(unchanged?.keyVersion).toBe("v0");
    expect(unchanged?.ciphertext).toBe(encrypted.ciphertext);
  });
});

async function createLegacyUserTable(database: PGlite) {
  await database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN DEFAULT false NOT NULL,
      image TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
      "updatedAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
      "phoneNumber" TEXT,
      "phoneNumberVerified" BOOLEAN
    );
  `);
}

async function applyIntegrationMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0015_personal_integrations.sql", import.meta.url),
    "utf8"
  );
  /* oxlint-disable eslint/no-await-in-loop -- SQL migration statements must execute in file order. */
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
