import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import {
  consumeGitHubAuthorizationAttempt,
  createGitHubAuthorizationAttempt,
  failGitHubAuthorizationAttempt,
  getFreshGitHubAccessToken,
  saveGitHubConnection,
} from "@db/services/integrations/github";
import {
  createCredentialKeyring,
  generateCredentialKey,
} from "../../integrations/credential-encryption";

const client = new PGlite();
const database = drizzle(client, { schema });
const keyring = createCredentialKeyring(
  "test-v1",
  new Map([["test-v1", generateCredentialKey()]])
);
const token = {
  access_token: "ghu_private-access-token",
  refresh_token: "ghr_private-refresh-token",
  expires_in: 28_800,
  refresh_token_expires_in: 15_897_600,
  scope: "",
  token_type: "bearer",
} as const;

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite exercises the real Drizzle schema and transaction behavior.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Swap only the PostgreSQL driver for an isolated compatible test database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 90_000);

beforeEach(async () => {
  await database.delete(schema.user);
  await database.insert(schema.user).values([
    {
      id: "alice",
      name: "Alice",
      email: "alice@example.test",
      emailVerified: true,
    },
    {
      id: "bob",
      name: "Bob",
      email: "bob@example.test",
      emailVerified: true,
    },
  ]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("GitHub OAuth persistence", () => {
  it("binds state and encrypted PKCE material to the initiating user and consumes it once", async () => {
    const attempt = await createGitHubAuthorizationAttempt({
      ownerUserId: "alice",
      redirectUri: "https://blud.example/api/integrations/github/callback",
      keyring,
    });

    const [stored] = await database
      .select()
      .from(schema.integrationAuthorizationAttempts);
    expect(stored?.stateHash).toBe(
      createHash("sha256").update(attempt.state).digest("hex")
    );
    expect(stored?.pkceVerifierCiphertext).not.toContain(attempt.state);
    expect(stored?.pkceVerifierCiphertext).not.toContain("code_verifier");

    await expect(
      consumeGitHubAuthorizationAttempt({
        ownerUserId: "bob",
        state: attempt.state,
        keyring,
      })
    ).resolves.toBeNull();

    const consumed = await consumeGitHubAuthorizationAttempt({
      ownerUserId: "alice",
      state: attempt.state,
      keyring,
    });
    expect(consumed).toMatchObject({
      redirectUri: "https://blud.example/api/integrations/github/callback",
    });
    expect(consumed?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(
      consumeGitHubAuthorizationAttempt({
        ownerUserId: "alice",
        state: attempt.state,
        keyring,
      })
    ).resolves.toBeNull();
  });

  it("stores GitHub tokens encrypted and keeps connections isolated by owner", async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat", name: "The Octocat" },
      token,
      keyring,
    });

    const [connection] = await database
      .select()
      .from(schema.integrationConnections);
    const [credential] = await database
      .select()
      .from(schema.integrationCredentials);

    expect(connection).toMatchObject({
      id: connectionId,
      ownerUserId: "alice",
      providerKey: "github",
      providerAccountId: "1234",
      displayName: "The Octocat",
      status: "active",
    });
    expect(credential?.ciphertext).not.toContain(token.access_token);
    expect(credential?.ciphertext).not.toContain(token.refresh_token);
    expect(credential?.ownerUserId).toBe("alice");
    expect(
      await database.select().from(schema.integrationConnectionScopes)
    ).toEqual([]);

    await expect(
      saveGitHubConnection({
        ownerUserId: "bob",
        account: { id: 1234, login: "octocat" },
        token,
        keyring,
      })
    ).resolves.not.toBe(connectionId);

    const connections = await database
      .select()
      .from(schema.integrationConnections);
    expect(connections).toHaveLength(2);
    expect(connections.map((item) => item.ownerUserId).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("marks a consumed failed authorization attempt as failed for its owner only", async () => {
    const attempt = await createGitHubAuthorizationAttempt({
      ownerUserId: "alice",
      redirectUri: "https://blud.example/api/integrations/github/callback",
      keyring,
    });
    const consumed = await consumeGitHubAuthorizationAttempt({
      ownerUserId: "alice",
      state: attempt.state,
      keyring,
    });
    if (!consumed) throw new Error("Expected the authorization attempt.");
    await failGitHubAuthorizationAttempt({
      ownerUserId: "bob",
      attemptId: consumed.id,
    });
    const [stillCompleted] = await database
      .select()
      .from(schema.integrationAuthorizationAttempts);
    expect(stillCompleted?.status).toBe("completed");

    await failGitHubAuthorizationAttempt({
      ownerUserId: "alice",
      attemptId: consumed.id,
    });
    const [failed] = await database
      .select()
      .from(schema.integrationAuthorizationAttempts);
    expect(failed?.status).toBe("failed");
  });
});
