# Account and workspace data lifecycle

BLUD stores Better Auth principals in workspace membership rows using the namespaced identifier `better-auth:<user-id>`. This is intentional: workspace membership identifies an application principal, not a raw Better Auth row ID, so a direct foreign key from `workspace_memberships.user_id` to `user.id` would be incorrect.

Migration `0016_better_auth_workspace_cleanup.sql` installs a PostgreSQL `AFTER DELETE` trigger on the Better Auth `user` table. When a Better Auth user is deleted, the trigger:

1. Removes only that user's `better-auth:<id>` workspace memberships.
2. Deletes a workspace only when no other principal remains a member.
3. Relies on the existing workspace foreign keys to cascade deletion of that workspace's owned data.
4. Preserves shared workspace data while another membership remains.

The migration is database-level so cleanup applies regardless of which supported path deletes the Better Auth row. The migration tests cover both sole-owner deletion and shared-workspace preservation.

Better Auth's built-in user deletion endpoint remains disabled unless explicitly enabled in the auth configuration. The trigger does not enable that endpoint; it guarantees consistent cleanup if account deletion is enabled later or performed by an administrative database operation.
