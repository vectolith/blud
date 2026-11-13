import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCredentialKeyring } from "./credential-encryption";
import {
  decryptVaultSecret,
  encryptVaultSecret,
  vaultSecretKeyVersion,
} from "./vault-encryption";

const scope = {
  userId: "better-auth:user-1",
  workspaceId: "personal:workspace-1",
};

describe("versioned vault encryption", () => {
  it("encrypts new secrets with the active key version", () => {
    const keyring = rotatingKeyring();
    const encrypted = encryptVaultSecret(
      scope,
      "vault-item-1",
      "private vault value",
      keyring
    );

    expect(vaultSecretKeyVersion(encrypted)).toBe("v2");
    expect(decryptVaultSecret(scope, "vault-item-1", encrypted, keyring)).toBe(
      "private vault value"
    );
  });

  it("continues to decrypt legacy v1 vault ciphertext during rotation", () => {
    const oldKey = Buffer.alloc(32, 1);
    const keyring = rotatingKeyring(oldKey);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", oldKey, iv);
    cipher.setAAD(
      Buffer.from(`${scope.workspaceId}\u0000vault\u0000vault-item-legacy`)
    );
    const ciphertext = Buffer.concat([
      cipher.update("legacy private value", "utf8"),
      cipher.final(),
    ]);
    const legacy = [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");

    expect(vaultSecretKeyVersion(legacy)).toBe("installation-v1");
    expect(
      decryptVaultSecret(scope, "vault-item-legacy", legacy, keyring)
    ).toBe("legacy private value");
  });

  it("binds ciphertext to its workspace and item and rejects tampering", () => {
    const keyring = rotatingKeyring();
    const encrypted = encryptVaultSecret(
      scope,
      "vault-item-1",
      "private vault value",
      keyring
    );

    expect(() =>
      decryptVaultSecret(
        { ...scope, workspaceId: "personal:another-workspace" },
        "vault-item-1",
        encrypted,
        keyring
      )
    ).toThrow(/authentication failed/u);
    const parts = encrypted.split(".");
    const encodedCiphertext = parts[4];
    if (!encodedCiphertext) {
      throw new Error("Expected a versioned vault ciphertext.");
    }
    parts[4] = `${encodedCiphertext.startsWith("A") ? "B" : "A"}${encodedCiphertext.slice(1)}`;
    expect(() =>
      decryptVaultSecret(scope, "vault-item-1", parts.join("."), keyring)
    ).toThrow(/authentication failed/u);
  });

  it("rejects ciphertext when its historical key is unavailable", () => {
    const oldKeyring = createCredentialKeyring(
      "installation-v1",
      new Map([["installation-v1", Buffer.alloc(32, 1)]])
    );
    const encrypted = encryptVaultSecret(
      scope,
      "vault-item-1",
      "private vault value",
      oldKeyring
    );
    const newOnlyKeyring = createCredentialKeyring(
      "v2",
      new Map([["v2", Buffer.alloc(32, 2)]])
    );

    expect(() =>
      decryptVaultSecret(scope, "vault-item-1", encrypted, newOnlyKeyring)
    ).toThrow(/key version "installation-v1" is unavailable/u);
  });
});

function rotatingKeyring(oldKey = Buffer.alloc(32, 1)) {
  return createCredentialKeyring(
    "v2",
    new Map([
      ["installation-v1", oldKey],
      ["v2", Buffer.alloc(32, 2)],
    ])
  );
}
