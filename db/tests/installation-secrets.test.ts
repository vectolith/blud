import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationSecrets } from "@db/services/installation-secrets";

const mocks = vi.hoisted(() => ({
  readObject: vi.fn(),
  writeObject: vi.fn(),
}));

vi.mock("@shared/storage/object-store", () => ({
  objectStoreConfigured: () => true,
  readObject: mocks.readObject,
  writeObject: mocks.writeObject,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
  vi.stubEnv("BLUD_INSTALLATION_ID", "installation-test");
  vi.stubEnv("S3_ACCESS_KEY_ID", "key");
  vi.stubEnv("S3_BUCKET", "bucket");
  vi.stubEnv("S3_ENDPOINT", "https://s3.example.com");
  vi.stubEnv("S3_REGION", "auto");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("installation secrets", () => {
  it("atomically creates and caches independent secrets in the object store", async () => {
    mocks.readObject.mockResolvedValue(undefined);
    mocks.writeObject.mockResolvedValue(undefined);

    const getInstallationSecrets = await loadInstallationSecrets();
    const [first, second] = await Promise.all([
      getInstallationSecrets(),
      getInstallationSecrets(),
    ]);

    expect(first).toEqual(second);
    expect(first.betterAuthSecret).not.toBe(first.secretEncryptionKey);
    expect(Buffer.from(first.betterAuthSecret, "base64")).toHaveLength(32);
    expect(Buffer.from(first.secretEncryptionKey, "base64")).toHaveLength(32);
    expect(mocks.readObject).toHaveBeenCalledOnce();
    expect(mocks.writeObject).toHaveBeenCalledOnce();

    const call = mocks.writeObject.mock.calls[0];
    if (!call) throw new Error("Expected an installation secrets upload.");
    const [environment, pathname, body, options] = call;
    expect(environment.S3_BUCKET).toBe("bucket");
    expect(pathname).toMatch(
      /^blud\/system\/[a-f0-9]{32}\/installation-secrets\.v1\.json$/u
    );
    const serialized = Buffer.from(body).toString("utf8");
    expect(JSON.parse(serialized)).toEqual(first);
    expect(options).toMatchObject({
      cacheControl: "private, max-age=31536000, immutable",
      contentType: "application/json",
      createOnly: true,
    });
  });

  it("reads the winning value when another runtime creates it first", async () => {
    const winner = {
      betterAuthSecret: Buffer.alloc(32, 2).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 3).toString("base64"),
      version: 1 as const,
    };
    mocks.readObject
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(objectResult(winner));
    mocks.writeObject.mockRejectedValue(new Error("PreconditionFailed"));

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).resolves.toEqual(winner);
    expect(mocks.readObject).toHaveBeenCalledTimes(2);
  });

  it("preserves explicit overrides without accessing the object store", async () => {
    const configured = {
      betterAuthSecret: Buffer.alloc(32, 4).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 5).toString("base64"),
      version: 1 as const,
    };
    vi.stubEnv("BETTER_AUTH_SECRET", configured.betterAuthSecret);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", configured.secretEncryptionKey);

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).resolves.toEqual(configured);
    expect(mocks.readObject).not.toHaveBeenCalled();
    expect(mocks.writeObject).not.toHaveBeenCalled();
  });

  it("rotates one secret while preserving the other from the object store", async () => {
    const stored = {
      betterAuthSecret: Buffer.alloc(32, 6).toString("base64"),
      secretEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
      version: 1 as const,
    };
    const rotatedEncryptionKey = Buffer.alloc(32, 8).toString("base64");
    mocks.readObject.mockResolvedValue(objectResult(stored));
    vi.stubEnv("SECRET_ENCRYPTION_KEY", rotatedEncryptionKey);

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).resolves.toEqual({
      ...stored,
      secretEncryptionKey: rotatedEncryptionKey,
    });
    expect(mocks.readObject).toHaveBeenCalledOnce();
    expect(mocks.writeObject).not.toHaveBeenCalled();
  });

  it("rejects a partial override when no existing object-store record exists", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", Buffer.alloc(32, 6).toString("base64"));
    mocks.readObject.mockResolvedValue(undefined);

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).rejects.toThrow(
      "A partial installation-secret override requires an existing object-store secret record."
    );
    expect(mocks.writeObject).not.toHaveBeenCalled();
  });

  it("retries after a transient object-store read failure", async () => {
    mocks.readObject
      .mockRejectedValueOnce(new Error("Object store temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    mocks.writeObject.mockResolvedValue(undefined);

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).rejects.toThrow(
      "Object store temporarily unavailable"
    );
    await expect(getInstallationSecrets()).resolves.toMatchObject({
      version: 1,
    });
    expect(mocks.readObject).toHaveBeenCalledTimes(2);
    expect(mocks.writeObject).toHaveBeenCalledOnce();
  });

  it("rejects malformed installation-secret storage", async () => {
    mocks.readObject.mockResolvedValue(objectResult({ version: 1 }));

    const getInstallationSecrets = await loadInstallationSecrets();

    await expect(getInstallationSecrets()).rejects.toThrow(
      "Invalid input: expected string"
    );
    expect(mocks.writeObject).not.toHaveBeenCalled();
  });
});

async function loadInstallationSecrets() {
  const secretsModule = await import("@db/services/installation-secrets");
  return secretsModule.getInstallationSecrets;
}

type InstallationSecretsFixture = Partial<InstallationSecrets> &
  Pick<InstallationSecrets, "version">;

function objectResult(value: InstallationSecretsFixture) {
  const body = new TextEncoder().encode(JSON.stringify(value));
  return {
    body,
    contentLength: body.byteLength,
    contentType: "application/json",
    etag: "etag-winner",
  };
}
