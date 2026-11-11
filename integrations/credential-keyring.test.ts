import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  type CredentialKeyring,
} from "./credential-encryption";

const mocks = vi.hoisted(() => ({
  getInstallationSecrets: vi.fn(),
}));

vi.mock("@db/services/installation-secrets", () => ({
  getInstallationSecrets: mocks.getInstallationSecrets,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@example.com/database");
  vi.stubEnv("KERNEL_API_KEY", "test-kernel-key");
  vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("base64"));
  vi.stubEnv("SECRET_ENCRYPTION_KEY_VERSION", "v2");
  vi.stubEnv(
    "SECRET_ENCRYPTION_KEYRING",
    JSON.stringify({
      "installation-v1": Buffer.alloc(32, 1).toString("base64"),
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("integration credential keyring configuration", () => {
  it("retains legacy decryption keys while encrypting with the active version", async () => {
    const activeKey = Buffer.alloc(32, 2);
    mocks.getInstallationSecrets.mockResolvedValue({
      betterAuthSecret: Buffer.alloc(32, 3).toString("base64"),
      secretEncryptionKey: activeKey.toString("base64"),
      version: 1,
    });
    const { getIntegrationCredentialKeyring } =
      await import("./credential-keyring");
    const keyring: CredentialKeyring = await getIntegrationCredentialKeyring();
    const oldKey = Buffer.alloc(32, 1);
    const oldKeyring = {
      activeKeyVersion: "installation-v1",
      keys: new Map([["installation-v1", oldKey]]),
    };
    const encrypted = encryptCredential(
      "legacy token",
      oldKeyring,
      "owner:connection"
    );

    expect(keyring.activeKeyVersion).toBe("v2");
    expect(decryptCredential(encrypted, keyring, "owner:connection")).toBe(
      "legacy token"
    );
    expect(
      encryptCredential("new token", keyring, "owner:connection").keyVersion
    ).toBe("v2");
  });

  it("allows retired historical keys to be removed after ciphertext rewrapping", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEYRING", "{}");
    mocks.getInstallationSecrets.mockResolvedValue({
      betterAuthSecret: Buffer.alloc(32, 3).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 2).toString("base64"),
      version: 1,
    });
    const { getIntegrationCredentialKeyring } =
      await import("./credential-keyring");

    const keyring = await getIntegrationCredentialKeyring();
    expect(keyring.activeKeyVersion).toBe("v2");
    expect(keyring.keys.size).toBe(1);
    expect(keyring.keys.get("v2")).toEqual(Buffer.alloc(32, 2));
  });

  it("refuses a non-legacy active version without an explicit active key", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    mocks.getInstallationSecrets.mockResolvedValue({
      betterAuthSecret: Buffer.alloc(32, 3).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 1).toString("base64"),
      version: 1,
    });
    const { getIntegrationCredentialKeyring } =
      await import("./credential-keyring");

    await expect(getIntegrationCredentialKeyring()).rejects.toThrow(
      /explicitly configured active SECRET_ENCRYPTION_KEY/u
    );
  });
});
