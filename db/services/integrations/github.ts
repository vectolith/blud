import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@db";
import {
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
import type { GitHubUserAccessToken } from "../../../integrations/github/oauth";

const attemptLifetimeMs = 10 * 60 * 1000;

export interface GitHubAuthorizationAttempt {
  readonly id: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export function createGitHubPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
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
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .insert(integrationConnections)
      .values({
        id: connectionId,
        ownerUserId: input.ownerUserId,
        providerKey: "github",
        providerAccountId: String(input.account.id),
        displayName: input.account.name?.trim() || input.account.login,
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
          displayName: input.account.name?.trim() || input.account.login,
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
      integrationCredentialAad(
        input.ownerUserId,
        connection.id,
        "oauth_tokens"
      )
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
