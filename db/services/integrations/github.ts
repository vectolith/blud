import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import {
  integrationActionGrants,
  integrationAuthorizationAttempts,
  integrationConnectionScopes,
  integrationConnections,
  integrationCredentials,
} from "@db/schema";
import {
  authorizationAttemptAad,
  decryptCredential,
  encryptCredential,
  integrationCredentialAad,
  type CredentialKeyring,
} from "../../../integrations/credential-encryption";
import {
  GitHubOAuthError,
  refreshGitHubUserAccessToken,
  revokeGitHubGrant,
  type GitHubUserAccessToken,
} from "../../../integrations/github/oauth";

const attemptLifetimeMs = 10 * 60 * 1000;

export interface GitHubAuthorizationAttempt {
  readonly id: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export function createGitHubPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function createGitHubAuthorizationAttempt(input: {
  ownerUserId: string;
  redirectUri: string;
  keyring: CredentialKeyring;
}) {
  const id = randomUUID();
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = createGitHubPkcePair();
  const encryptedVerifier = encryptCredential(
    verifier,
    input.keyring,
    authorizationAttemptAad(input.ownerUserId, id)
  );

  await db.insert(integrationAuthorizationAttempts).values({
    id,
    ownerUserId: input.ownerUserId,
    providerKey: "github",
    stateHash: createHash("sha256").update(state).digest("hex"),
    pkceVerifierCiphertext: encryptedVerifier.ciphertext,
    pkceVerifierIv: encryptedVerifier.iv,
    pkceVerifierAuthTag: encryptedVerifier.authTag,
    keyVersion: encryptedVerifier.keyVersion,
    redirectUri: input.redirectUri,
    status: "pending",
    expiresAt: new Date(Date.now() + attemptLifetimeMs),
  });

  return { state, codeChallenge: challenge };
}

export async function consumeGitHubAuthorizationAttempt(input: {
  ownerUserId: string;
  state: string;
  keyring: CredentialKeyring;
}): Promise<GitHubAuthorizationAttempt | null> {
  if (input.state.length < 32 || input.state.length > 128) return null;

  const stateHash = createHash("sha256").update(input.state).digest("hex");
  const now = new Date();
  const [attempt] = await db
    .update(integrationAuthorizationAttempts)
    .set({ status: "completed", consumedAt: now })
    .where(
      and(
        eq(integrationAuthorizationAttempts.ownerUserId, input.ownerUserId),
        eq(integrationAuthorizationAttempts.providerKey, "github"),
        eq(integrationAuthorizationAttempts.stateHash, stateHash),
        eq(integrationAuthorizationAttempts.status, "pending"),
        gt(integrationAuthorizationAttempts.expiresAt, now)
      )
    )
    .returning({
      id: integrationAuthorizationAttempts.id,
      redirectUri: integrationAuthorizationAttempts.redirectUri,
      ciphertext: integrationAuthorizationAttempts.pkceVerifierCiphertext,
      iv: integrationAuthorizationAttempts.pkceVerifierIv,
      authTag: integrationAuthorizationAttempts.pkceVerifierAuthTag,
      keyVersion: integrationAuthorizationAttempts.keyVersion,
    });

  if (!attempt) return null;

  const codeVerifier = decryptCredential(
    {
      algorithm: "aes-256-gcm",
      ciphertext: attempt.ciphertext,
      iv: attempt.iv,
      authTag: attempt.authTag,
      keyVersion: attempt.keyVersion,
    },
    input.keyring,
    authorizationAttemptAad(input.ownerUserId, attempt.id)
  );

  return {
    id: attempt.id,
    redirectUri: attempt.redirectUri,
    codeVerifier,
  };
}

export async function failGitHubAuthorizationAttempt(input: {
  ownerUserId: string;
  attemptId: string;
}) {
  await db
    .update(integrationAuthorizationAttempts)
    .set({ status: "failed" })
    .where(
      and(
        eq(integrationAuthorizationAttempts.id, input.attemptId),
        eq(integrationAuthorizationAttempts.ownerUserId, input.ownerUserId),
        eq(integrationAuthorizationAttempts.providerKey, "github"),
        eq(integrationAuthorizationAttempts.status, "completed")
      )
    );
}

export async function saveGitHubConnection(input: {
  ownerUserId: string;
  account: { id: number; login: string; name?: string | null };
  token: GitHubUserAccessToken;
  keyring: CredentialKeyring;
}) {
  const now = new Date();
  const accessTokenExpiresAt = input.token.expires_in
    ? new Date(now.getTime() + input.token.expires_in * 1000)
    : null;
  const refreshTokenExpiresAt = input.token.refresh_token_expires_in
    ? new Date(now.getTime() + input.token.refresh_token_expires_in * 1000)
    : null;
  const tokenBundle = JSON.stringify({
    accessToken: input.token.access_token,
    accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() ?? null,
    refreshToken: input.token.refresh_token ?? null,
    refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() ?? null,
    tokenType: input.token.token_type,
  });
  const connectionId = randomUUID();
  const displayName =
    input.account.name?.trim().replace(/^$/u, input.account.login) ??
    input.account.login;
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .insert(integrationConnections)
      .values({
        id: connectionId,
        ownerUserId: input.ownerUserId,
        providerKey: "github",
        providerAccountId: String(input.account.id),
        displayName,
        status: "active",
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.ownerUserId,
          integrationConnections.providerKey,
          integrationConnections.providerAccountId,
        ],
        set: {
          displayName,
          status: "active",
          revokedAt: null,
          updatedAt: now,
          lastUsedAt: now,
        },
      })
      .returning({ id: integrationConnections.id });

    if (!connection) throw new Error("GitHub connection could not be saved.");

    const storedCredential = encryptCredential(
      tokenBundle,
      input.keyring,
      integrationCredentialAad(input.ownerUserId, connection.id, "oauth_tokens")
    );

    await tx
      .insert(integrationCredentials)
      .values({
        id: randomUUID(),
        connectionId: connection.id,
        ownerUserId: input.ownerUserId,
        credentialType: "oauth_tokens",
        algorithm: storedCredential.algorithm,
        ciphertext: storedCredential.ciphertext,
        iv: storedCredential.iv,
        authTag: storedCredential.authTag,
        keyVersion: storedCredential.keyVersion,
        expiresAt: accessTokenExpiresAt,
      })
      .onConflictDoUpdate({
        target: [
          integrationCredentials.connectionId,
          integrationCredentials.credentialType,
        ],
        set: {
          ownerUserId: input.ownerUserId,
          algorithm: storedCredential.algorithm,
          ciphertext: storedCredential.ciphertext,
          iv: storedCredential.iv,
          authTag: storedCredential.authTag,
          keyVersion: storedCredential.keyVersion,
          expiresAt: accessTokenExpiresAt,
          updatedAt: now,
        },
      });

    // Reauthorization must not silently restore prior Blud action consent.
    await tx
      .delete(integrationActionGrants)
      .where(
        and(
          eq(integrationActionGrants.connectionId, connection.id),
          eq(integrationActionGrants.ownerUserId, input.ownerUserId)
        )
      );

    await tx
      .delete(integrationConnectionScopes)
      .where(
        and(
          eq(integrationConnectionScopes.connectionId, connection.id),
          eq(integrationConnectionScopes.ownerUserId, input.ownerUserId)
        )
      );

    const grantedScopes = input.token.scope
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (grantedScopes.length > 0) {
      await tx.insert(integrationConnectionScopes).values(
        grantedScopes.map((scope) => ({
          connectionId: connection.id,
          ownerUserId: input.ownerUserId,
          scope,
        }))
      );
    }

    return connection.id;
  });
}

const storedGitHubTokenBundleSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime().nullable(),
  refreshToken: z.string().min(1).nullable(),
  refreshTokenExpiresAt: z.iso.datetime().nullable(),
  tokenType: z.literal("bearer"),
});

export async function getFreshGitHubAccessToken(input: {
  ownerUserId: string;
  connectionId: string;
  clientId: string;
  clientSecret: string;
  keyring: CredentialKeyring;
}): Promise<string | null> {
  // Lock while rotating: GitHub invalidates refresh tokens after use.
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        connectionId: integrationConnections.id,
        credential: {
          algorithm: integrationCredentials.algorithm,
          ciphertext: integrationCredentials.ciphertext,
          iv: integrationCredentials.iv,
          authTag: integrationCredentials.authTag,
          keyVersion: integrationCredentials.keyVersion,
        },
      })
      .from(integrationConnections)
      .innerJoin(
        integrationCredentials,
        and(
          eq(integrationCredentials.connectionId, integrationConnections.id),
          eq(
            integrationCredentials.ownerUserId,
            integrationConnections.ownerUserId
          ),
          eq(integrationCredentials.credentialType, "oauth_tokens")
        )
      )
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.ownerUserId, input.ownerUserId),
          eq(integrationConnections.providerKey, "github"),
          eq(integrationConnections.status, "active")
        )
      )
      .for("update")
      .limit(1);

    if (!record) return null;
    if (record.credential.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported GitHub credential algorithm.");
    }

    const plaintext = decryptCredential(
      {
        algorithm: "aes-256-gcm",
        ciphertext: record.credential.ciphertext,
        iv: record.credential.iv,
        authTag: record.credential.authTag,
        keyVersion: record.credential.keyVersion,
      },
      input.keyring,
      integrationCredentialAad(
        input.ownerUserId,
        record.connectionId,
        "oauth_tokens"
      )
    );
    const payload: unknown = JSON.parse(plaintext);
    const parsed = storedGitHubTokenBundleSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Stored GitHub token bundle is invalid.");
    }

    const bundle = parsed.data;
    const now = Date.now();
    const accessExpiry = bundle.accessTokenExpiresAt
      ? Date.parse(bundle.accessTokenExpiresAt)
      : Number.POSITIVE_INFINITY;
    if (accessExpiry > now + 60_000) return bundle.accessToken;

    const refreshExpiry = bundle.refreshTokenExpiresAt
      ? Date.parse(bundle.refreshTokenExpiresAt)
      : 0;
    if (!bundle.refreshToken || refreshExpiry <= now) {
      await tx
        .update(integrationConnections)
        .set({ status: "reauthorization_required", updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, record.connectionId),
            eq(integrationConnections.ownerUserId, input.ownerUserId)
          )
        );
      return null;
    }

    let rotated: GitHubUserAccessToken;
    try {
      rotated = await refreshGitHubUserAccessToken({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: bundle.refreshToken,
      });
    } catch (error) {
      if (error instanceof GitHubOAuthError && error.reauthorizationRequired) {
        await tx
          .update(integrationConnections)
          .set({ status: "reauthorization_required", updatedAt: new Date() })
          .where(
            and(
              eq(integrationConnections.id, record.connectionId),
              eq(integrationConnections.ownerUserId, input.ownerUserId)
            )
          );
        return null;
      }
      throw error;
    }

    if (
      !rotated.refresh_token ||
      !rotated.expires_in ||
      !rotated.refresh_token_expires_in
    ) {
      await tx
        .update(integrationConnections)
        .set({ status: "reauthorization_required", updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, record.connectionId),
            eq(integrationConnections.ownerUserId, input.ownerUserId)
          )
        );
      return null;
    }

    const rotatedAt = new Date();
    const accessTokenExpiresAt = new Date(
      rotatedAt.getTime() + rotated.expires_in * 1000
    );
    const refreshTokenExpiresAt = new Date(
      rotatedAt.getTime() + rotated.refresh_token_expires_in * 1000
    );
    const nextBundle = JSON.stringify({
      accessToken: rotated.access_token,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken: rotated.refresh_token,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      tokenType: rotated.token_type,
    });
    const encrypted = encryptCredential(
      nextBundle,
      input.keyring,
      integrationCredentialAad(
        input.ownerUserId,
        record.connectionId,
        "oauth_tokens"
      )
    );

    await tx
      .update(integrationCredentials)
      .set({
        algorithm: encrypted.algorithm,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        expiresAt: accessTokenExpiresAt,
        updatedAt: rotatedAt,
      })
      .where(
        and(
          eq(integrationCredentials.connectionId, record.connectionId),
          eq(integrationCredentials.ownerUserId, input.ownerUserId),
          eq(integrationCredentials.credentialType, "oauth_tokens")
        )
      );

    return rotated.access_token;
  });
}

export async function revokeGitHubConnection(input: {
  ownerUserId: string;
  connectionId: string;
  keyring: CredentialKeyring;
  clientId?: string;
  clientSecret?: string;
}): Promise<{ found: boolean; remoteRevoked: boolean }> {
  const [connection] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, input.connectionId),
        eq(integrationConnections.ownerUserId, input.ownerUserId),
        eq(integrationConnections.providerKey, "github")
      )
    )
    .limit(1);

  if (!connection) return { found: false, remoteRevoked: false };

  let remoteRevoked = false;
  if (input.clientId && input.clientSecret) {
    try {
      const accessToken = await getFreshGitHubAccessToken({
        ownerUserId: input.ownerUserId,
        connectionId: input.connectionId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        keyring: input.keyring,
      });
      if (accessToken) {
        await revokeGitHubGrant({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          accessToken,
        });
        remoteRevoked = true;
      }
    } catch {
      // Local disconnection must still remove Blud's ability to use the grant.
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(integrationConnections)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.ownerUserId, input.ownerUserId),
          eq(integrationConnections.providerKey, "github")
        )
      );
    await tx
      .delete(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.connectionId, input.connectionId),
          eq(integrationCredentials.ownerUserId, input.ownerUserId)
        )
      );
    await tx
      .delete(integrationConnectionScopes)
      .where(
        and(
          eq(integrationConnectionScopes.connectionId, input.connectionId),
          eq(integrationConnectionScopes.ownerUserId, input.ownerUserId)
        )
      );
    await tx
      .delete(integrationActionGrants)
      .where(
        and(
          eq(integrationActionGrants.connectionId, input.connectionId),
          eq(integrationActionGrants.ownerUserId, input.ownerUserId)
        )
      );
  });

  return { found: true, remoteRevoked };
}
