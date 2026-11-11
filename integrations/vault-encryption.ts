import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { AccessScope } from "@shared/identity/access-scope";
import type { CredentialKeyring } from "./credential-encryption";

const LEGACY_FORMAT = "v1";
const CURRENT_FORMAT = "v2";
const IV_BYTES = 12;

export function vaultSecretKeyVersion(value: string): string | undefined {
  const parts = value.split(".");
  if (parts[0] === LEGACY_FORMAT && parts.length === 4) {
    return "installation-v1";
  }
  if (parts[0] === CURRENT_FORMAT && parts.length === 5 && parts[1]) {
    return parts[1];
  }
  return undefined;
}

export function encryptVaultSecret(
  scope: AccessScope,
  id: string,
  plaintext: string,
  keyring: CredentialKeyring
): string {
  const key = keyring.keys.get(keyring.activeKeyVersion);
  if (!key) throw new Error("The active vault encryption key is unavailable.");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(vaultSecretAad(scope, id));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    CURRENT_FORMAT,
    keyring.activeKeyVersion,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptVaultSecret(
  scope: AccessScope,
  id: string,
  value: string,
  keyring: CredentialKeyring
): string {
  const parts = value.split(".");
  const keyVersion = vaultSecretKeyVersion(value);
  if (!keyVersion) {
    throw new Error("The stored vault secret uses an unsupported format.");
  }

  const key = keyring.keys.get(keyVersion);
  if (!key) {
    throw new Error(
      `Vault encryption key version "${keyVersion}" is unavailable.`
    );
  }

  const [, , encodedIv, encodedTag, encodedCiphertext] =
    parts[0] === CURRENT_FORMAT
      ? parts
      : [parts[0], keyVersion, parts[1], parts[2], parts[3]];
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored vault secret is incomplete.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAAD(vaultSecretAad(scope, id));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new Error(
      "Vault secret authentication failed; ciphertext or ownership context may have changed.",
      { cause: error }
    );
  }
}

function vaultSecretAad(scope: AccessScope, id: string) {
  return Buffer.from(`${scope.workspaceId}\u0000vault\u0000${id}`);
}
