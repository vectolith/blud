import { getInstallationSecrets } from "@db/services/installation-secrets";
import { env } from "@shared/environment";
import { createCredentialKeyring } from "./credential-encryption";

const legacyKeyVersion = "installation-v1";

export async function getIntegrationCredentialKeyring() {
  const { secretEncryptionKey } = await getInstallationSecrets();
  const activeKeyVersion = env.SECRET_ENCRYPTION_KEY_VERSION;
  const keys = new Map<string, Buffer>();

  for (const [version, encodedKey] of Object.entries(
    env.SECRET_ENCRYPTION_KEYRING
  )) {
    keys.set(version, Buffer.from(encodedKey, "base64"));
  }

  if (activeKeyVersion === legacyKeyVersion) {
    keys.set(
      legacyKeyVersion,
      Buffer.from(secretEncryptionKey, "base64")
    );
  } else {
    if (!keys.has(legacyKeyVersion)) {
      throw new Error(
        "Encryption key rotation requires retaining the installation-v1 key until all legacy ciphertext has been rewrapped."
      );
    }
    keys.set(activeKeyVersion, Buffer.from(secretEncryptionKey, "base64"));
  }

  return createCredentialKeyring(activeKeyVersion, keys);
}
