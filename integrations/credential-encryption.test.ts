import { describe, expect, it } from "vitest";
import {
  createCredentialKeyring,
  decryptCredential,
  encryptCredential,
  generateCredentialKey,
  integrationCredentialAad,
  authorizationAttemptAad,
} from "./credential-encryption";

describe("integration credential encryption", () => {
  it("creates distinct authenticated contexts for credentials and OAuth attempts", () => {
    expect(integrationCredentialAad("user-a", "connection-a", "oauth_tokens")).not.toBe(
      integrationCredentialAad("user-b", "connection-a", "oauth_tokens")
    );
    expect(authorizationAttemptAad("user-a", "attempt-a")).not.toBe(
      authorizationAttemptAad("user-b", "attempt-a")
    );
  });

  it("encrypts with AES-256-GCM and decrypts with the recorded key version", () => {
    const key = generateCredentialKey();
    const keyring = createCredentialKeyring("v1", new Map([["v1", key]]));
    const encrypted = encryptCredential(
      "refresh-token-secret",
      keyring,
      integrationCredentialAad("user-1", "connection-1", "oauth_tokens")
    );

    expect(encrypted.algorithm).toBe("aes-256-gcm");
    expect(encrypted.keyVersion).toBe("v1");
    expect(encrypted.ciphertext).not.toContain("refresh-token-secret");
    expect(decryptCredential(encrypted, keyring, integrationCredentialAad("user-1", "connection-1", "oauth_tokens"))).toBe(
      "refresh-token-secret"
    );
  });

  it("supports decrypting old versions while encrypting with the active version", () => {
    const oldKey = generateCredentialKey();
    const newKey = generateCredentialKey();
    const oldKeyring = createCredentialKeyring("v1", new Map([["v1", oldKey]]));
    const oldCiphertext = encryptCredential("access-token", oldKeyring, "u:c");
    const rotatingKeyring = createCredentialKeyring(
      "v2",
      new Map([
        ["v1", oldKey],
        ["v2", newKey],
      ])
    );

    expect(decryptCredential(oldCiphertext, rotatingKeyring, "u:c")).toBe(
      "access-token"
    );
    expect(
      encryptCredential("new-token", rotatingKeyring, "u:c").keyVersion
    ).toBe("v2");
  });

  it("binds ciphertext to its connection owner and rejects tampering", () => {
    const keyring = createCredentialKeyring(
      "v1",
      new Map([["v1", generateCredentialKey()]])
    );
    const encrypted = encryptCredential(
      "secret",
      keyring,
      integrationCredentialAad("user-a", "connection-a", "oauth_tokens")
    );

    expect(() =>
      decryptCredential(encrypted, keyring, integrationCredentialAad("user-b", "connection-a", "oauth_tokens"))
    ).toThrow(/authentication failed/);
    expect(() =>
      decryptCredential(
        {
          ...encrypted,
          ciphertext: Buffer.from("tampered").toString("base64"),
        },
        keyring,
        integrationCredentialAad("user-a", "connection-a", "oauth_tokens")
      )
    ).toThrow(/authentication failed/);
  });

  it("rejects missing active keys and malformed key lengths", () => {
    expect(() => createCredentialKeyring("missing", new Map())).toThrow();
    expect(() =>
      createCredentialKeyring("v1", new Map([["v1", Buffer.alloc(16)]]))
    ).toThrow();
  });
});
