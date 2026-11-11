import { getInstallationSecrets } from "@db/services/installation-secrets";
import { createCredentialKeyring } from "@integrations/credential-encryption";

const installationKeyVersion = "installation-v1";

export async function getIntegrationCredentialKeyring() {
  const { secretEncryptionKey } = await getInstallationSecrets();
  return createCredentialKeyring(
    installationKeyVersion,
    new Map([
      [installationKeyVersion, Buffer.from(secretEncryptionKey, "base64")],
    ])
  );
}
