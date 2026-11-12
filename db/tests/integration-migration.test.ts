import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("personal integration migration", () => {
  it("preserves Better Auth rows and enforces connection ownership", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(legacyAuthSchema);
    await database.exec(`
      INSERT INTO "user" (id, name, email, "createdAt", "updatedAt")
      VALUES
        ('owner-a', 'Owner A', 'owner-a@example.com', now(), now()),
        ('owner-b', 'Owner B', 'owner-b@example.com', now(), now());
      INSERT INTO "account" (
        id, issuer, "accountId", "providerId", "userId", "createdAt", "updatedAt"
      ) VALUES (
        'account-a', 'credential', 'owner-a', 'credential', 'owner-a', now(), now()
      );
      INSERT INTO "session" (
        id, "expiresAt", token, "createdAt", "updatedAt", "userId"
      ) VALUES (
        'session-a', now() + interval '1 day', 'session-token-a', now(), now(), 'owner-a'
      );
    `);
    await applyMigration(database);

    await database.exec(`
      INSERT INTO integration_connections (
        id, owner_user_id, provider_key, provider_account_id, display_name
      ) VALUES ('connection-a', 'owner-a', 'github', 'github-account-1', 'Personal GitHub');
      INSERT INTO integration_credentials (
        id, connection_id, owner_user_id, credential_type, ciphertext, iv, auth_tag, key_version
      ) VALUES (
        'credential-a', 'connection-a', 'owner-a', 'oauth_tokens',
        'ciphertext-only', 'iv', 'tag', 'v1'
      );
      INSERT INTO integration_connection_scopes (connection_id, owner_user_id, scope)
      VALUES ('connection-a', 'owner-a', 'repo:read');
      INSERT INTO integration_action_grants (
        connection_id, owner_user_id, action_key, granted_by_user_id
      ) VALUES ('connection-a', 'owner-a', 'github.repository.read', 'owner-a');
      INSERT INTO integration_authorization_attempts (
        id, owner_user_id, provider_key, state_hash,
        pkce_verifier_ciphertext, pkce_verifier_iv, pkce_verifier_auth_tag,
        key_version, redirect_uri, expires_at
      ) VALUES (
        'attempt-a', 'owner-a', 'github', 'state-hash-a',
        'pkce-ciphertext', 'pkce-iv', 'pkce-tag', 'v1',
        'https://blud.example/api/integrations/github/callback', now() + interval '5 minutes'
      );
    `);

    const authRows = await database.query(`
      SELECT
        (SELECT count(*)::int FROM "user") AS users,
        (SELECT count(*)::int FROM "account") AS accounts,
        (SELECT count(*)::int FROM "session") AS sessions,
        (SELECT id FROM "user" WHERE id = 'owner-a') AS owner_id,
        (SELECT id FROM "session" WHERE id = 'session-a') AS session_id
    `);
    expect(authRows.rows[0]).toMatchObject({
      users: 2,
      accounts: 1,
      sessions: 1,
      owner_id: "owner-a",
      session_id: "session-a",
    });

    await database.exec(`
      INSERT INTO integration_connections (
        id, owner_user_id, provider_key, provider_account_id
      ) VALUES ('connection-b', 'owner-a', 'github', 'github-account-2')
    `);

    await expect(
      database.exec(`
        INSERT INTO integration_credentials (
          id, connection_id, owner_user_id, credential_type,
          ciphertext, iv, auth_tag, key_version
        ) VALUES (
          'credential-cross-owner', 'connection-b', 'owner-b', 'oauth_tokens',
          'ciphertext', 'iv', 'tag', 'v1'
        )
      `)
    ).rejects.toThrow(/foreign key constraint/);

    await expect(
      database.exec(`
        INSERT INTO integration_action_grants (
          connection_id, owner_user_id, action_key, granted_by_user_id
        ) VALUES ('connection-a', 'owner-a', 'github.issue.create', 'owner-b')
      `)
    ).rejects.toThrow(/check constraint/);

    await expect(
      database.exec(`
        INSERT INTO integration_connections (
          id, owner_user_id, provider_key, provider_account_id
        ) VALUES ('connection-orphan', 'missing-user', 'github', 'orphan')
      `)
    ).rejects.toThrow(/foreign key constraint/);

    await database.exec(`DELETE FROM "user" WHERE id = 'owner-a'`);
    const remaining = await database.query(`
      SELECT
        (SELECT count(*)::int FROM integration_connections) AS connections,
        (SELECT count(*)::int FROM integration_credentials) AS credentials,
        (SELECT count(*)::int FROM integration_connection_scopes) AS scopes,
        (SELECT count(*)::int FROM integration_action_grants) AS grants,
        (SELECT count(*)::int FROM integration_authorization_attempts) AS attempts
    `);
    expect(remaining.rows[0]).toEqual({
      connections: 0,
      credentials: 0,
      scopes: 0,
      grants: 0,
      attempts: 0,
    });
  });
});

async function applyMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0015_personal_integrations.sql", import.meta.url),
    "utf8"
  );
  /* oxlint-disable eslint/no-await-in-loop -- migration statements must remain ordered. */
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  /* oxlint-enable eslint/no-await-in-loop */
}

const legacyAuthSchema = `
  CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN DEFAULT false NOT NULL,
    image TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updatedAt" TIMESTAMPTZ DEFAULT now() NOT NULL
  );
  CREATE TABLE "account" (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    scope TEXT,
    password TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE "session" (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
  );
  CREATE TABLE "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updatedAt" TIMESTAMPTZ DEFAULT now() NOT NULL
  );
`;
