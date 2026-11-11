# Encryption key rotation

BLUD encrypts integration credentials and OAuth PKCE verifiers with AES-256-GCM. Vault ciphertext carries its key version in the stored envelope. The legacy vault envelope is retained as `v1` and maps to `installation-v1`.

The active key is configured with:

- `SECRET_ENCRYPTION_KEY`: base64-encoded 32-byte active key.
- `SECRET_ENCRYPTION_KEY_VERSION`: stable version identifier, for example `2026-11`.
- `SECRET_ENCRYPTION_KEYRING`: JSON object mapping retained historical versions to base64-encoded 32-byte keys.

## Rotation procedure

1. Back up the database and securely retain the current encryption key before changing configuration.
2. Generate a new key with `openssl rand -base64 32`.
3. Deploy the new active key and version to every application instance. Keep every historical key needed by stored ciphertext in `SECRET_ENCRYPTION_KEYRING`. For example:

   ```json
   {
     "installation-v1": "<previous-base64-key>"
   }
   ```

4. Do not replace `BETTER_AUTH_SECRET` as part of an encryption-key rotation. When only `SECRET_ENCRYPTION_KEY` is overridden, BLUD reads the existing private installation-secret record and overlays the new encryption key.
5. Wait until all old application instances have drained. Run the one-off maintenance command against the production database:

   ```sh
   pnpm security:rewrap-keys
   ```

6. The command re-encrypts integration credentials, stored OAuth authorization verifiers, and vault secrets using the active key. It then checks that no database ciphertext remains on an older key version. It prints counts only, never secret material.
7. Only after the command succeeds, all application instances use the new configuration, and backups have been handled according to the retention policy, remove retired keys from `SECRET_ENCRYPTION_KEYRING`.

The command is safe to rerun after a partial failure. Each owner/workspace is rewrapped transactionally; already-rotated records are skipped. If a historical key is missing, the command fails closed. Keep all old keys configured and restore the missing key before retrying.

Do not remove a historical key merely because a deployment succeeded. Remove it only after the rewrap command reports zero remaining old-key records.
