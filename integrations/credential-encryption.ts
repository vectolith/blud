import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedCredential {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly keyVersion: string;
}

export interface CredentialKeyring {
  readonly activeKeyVersion: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

export class CredentialEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialEncryptionError";
  }
}

export function integrationCredentialAad(
  ownerUserId: string,
  connectionId: string,
  credentialType: string
): string {
  if (!ownerUserId.trim() || !connectionId.trim() || !credentialType.trim()) {
    throw new CredentialEncryptionError("Credential ownership context is incomplete.");
  }
  return ["blud", "integration-credential", ownerUserId, connectionId, credentialType].join(":");
}

export function authorizationAttemptAad(
  ownerUserId: string,
  attemptId: string
): string {
  if (!ownerUserId.trim() || !attemptId.trim()) {
    throw new CredentialEncryptionError("Authorization attempt context is incomplete.");
  }
  return ["blud", "integration-authorization-attempt", ownerUserId, attemptId].join(":");
}

export function createCredentialKeyring(
  activeKeyVersion: string,
  keys: ReadonlyMap<string, Buffer>
): CredentialKeyring {
  if (!activeKeyVersion.trim()) {
    throw new CredentialEncryptionError("An active credential key version is required.");
  }
  for (const [version, key] of keys) {
    if (!version.trim() || key.length !== KEY_BYTES) {
      throw new CredentialEncryptionError(
        "Credential keyring entries require a version and a 32-byte key."
      );
    }
  }
  if (!keys.has(activeKeyVersion)) {
    throw new CredentialEncryptionError(
      "The active credential key version is not present in the keyring."
    );
  }
  return { activeKeyVersion, keys };
}

export function encryptCredential(
  plaintext: string,
  keyring: CredentialKeyring,
  associatedData: string
): EncryptedCredential {
  const key = keyring.keys.get(keyring.activeKeyVersion);
  if (!key) {
    throw new CredentialEncryptionError("The active credential key is unavailable.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: keyring.activeKeyVersion,
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  keyring: CredentialKeyring,
  associatedData: string
): string {
  if (encrypted.algorithm !== ALGORITHM) {
    throw new CredentialEncryptionError("Unsupported credential encryption algorithm.");
  }

  const key = keyring.keys.get(encrypted.keyVersion);
  if (!key) {
    throw new CredentialEncryptionError(
      `Credential key version "${encrypted.keyVersion}" is unavailable.`
    );
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new CredentialEncryptionError(
      "Credential authentication failed; ciphertext or ownership context may have changed.",
      { cause: error }
    );
  }
}

export function generateCredentialKey(): Buffer {
  return randomBytes(KEY_BYTES);
}
