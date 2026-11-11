import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import {
  consumeGitHubAuthorizationAttempt,
  createGitHubAuthorizationAttempt,
  failGitHubAuthorizationAttempt,
  getFreshGitHubAccessToken,
  revokeGitHubConnection,
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite.
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
  it("binds and consumes PKCE state for its owner only", async () => {
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

  it("encrypts GitHub tokens and isolates connections by owner", async () => {
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
    expect(connections.map((item) => item.ownerUserId).toSorted()).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("fails only the owner’s consumed authorization attempt", async () => {
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

  it("rotates and stores replacement tokens encrypted", async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat" },
      token: { ...token, expires_in: 1 },
      keyring,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "ghu_rotated-access",
        refresh_token: "ghr_rotated-refresh",
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
        scope: "",
        token_type: "bearer",
      })
    );
    vi.stubGlobal("fetch", fetcher);

    try {
      await expect(
        getFreshGitHubAccessToken({
          ownerUserId: "alice",
          connectionId,
          clientId: "client",
          clientSecret: "secret",
          keyring,
        })
      ).resolves.toBe("ghu_rotated-access");

      await expect(
        getFreshGitHubAccessToken({
          ownerUserId: "alice",
          connectionId,
          clientId: "client",
          clientSecret: "secret",
          keyring,
        })
      ).resolves.toBe("ghu_rotated-access");

      expect(fetcher).toHaveBeenCalledTimes(1);
      const refreshCall = fetcher.mock.calls.at(0);
      if (!refreshCall) throw new Error("Expected a GitHub token refresh.");
      const [, init] = refreshCall;
      const body = init?.body;
      if (!(body instanceof URLSearchParams)) {
        throw new Error("Expected a URL-encoded refresh request.");
      }
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe(token.refresh_token);

      const [credential] = await database
        .select()
        .from(schema.integrationCredentials);
      expect(credential?.ciphertext).not.toContain("ghu_rotated-access");
      expect(credential?.ciphertext).not.toContain("ghr_rotated-refresh");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not return a GitHub token to a different user", async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat" },
      token,
      keyring,
    });

    await expect(
      getFreshGitHubAccessToken({
        ownerUserId: "bob",
        connectionId,
        clientId: "client",
        clientSecret: "secret",
        keyring,
      })
    ).resolves.toBeNull();
  });

  it("revokes the provider grant and removes local credentials", async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat" },
      token,
      keyring,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);

    try {
      await expect(
        revokeGitHubConnection({
          ownerUserId: "alice",
          connectionId,
          keyring,
          clientId: "client",
          clientSecret: "secret",
        })
      ).resolves.toEqual({ found: true, remoteRevoked: true });

      const [connection] = await database
        .select()
        .from(schema.integrationConnections);
      expect(connection?.status).toBe("revoked");
      expect(connection?.revokedAt).toBeInstanceOf(Date);
      expect(
        await database.select().from(schema.integrationCredentials)
      ).toEqual([]);
      const [revokeCall] = fetcher.mock.calls;
      expect(revokeCall?.[1]?.method).toBe("DELETE");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("disconnects locally if GitHub revocation fails", async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat" },
      token,
      keyring,
    });
    await database.insert(schema.integrationConnectionScopes).values({
      connectionId,
      ownerUserId: "alice",
      scope: "read:user",
    });
    await database.insert(schema.integrationActionGrants).values({
      connectionId,
      ownerUserId: "alice",
      actionKey: "github.issue.create",
      decision: "allow",
      grantedByUserId: "alice",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("provider unavailable", { status: 503 })
        )
    );

    try {
      await expect(
        revokeGitHubConnection({
          ownerUserId: "alice",
          connectionId,
          keyring,
          clientId: "client",
          clientSecret: "secret",
        })
      ).resolves.toEqual({ found: true, remoteRevoked: false });

      const [connection] = await database
        .select()
        .from(schema.integrationConnections);
      expect(connection?.status).toBe("revoked");
      expect(
        await database.select().from(schema.integrationCredentials)
      ).toEqual([]);
      expect(
        await database.select().from(schema.integrationConnectionScopes)
      ).toEqual([]);
      expect(
        await database.select().from(schema.integrationActionGrants)
      ).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it(\n    "clears prior Blud action consent when the GitHub account is reauthorized",\n    async () => {
    const connectionId = await saveGitHubConnection({
      ownerUserId: "alice",
      account: { id: 1234, login: "octocat" },
      token,
      keyring,
    });
    await database.insert(schema.integrationActionGrants).values({
      connectionId,
      ownerUserId: "alice",
      actionKey: "github.issue.create",
      decision: "allow",
      grantedByUserId: "alice",
    });

    await expect(
      saveGitHubConnection({
        ownerUserId: "alice",
        account: { id: 1234, login: "octocat" },
        token: { ...token, access_token: "ghu_reauthorized" },
        keyring,
      })
    ).resolves.toBe(connectionId);
    await expect(
      database.select().from(schema.integrationActionGrants)
    ).resolves.toEqual([]);
  });
});
