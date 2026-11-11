# Integration and Channel Authorization Architecture

**Status:** Architecture decision with personal integration persistence and the GitHub App authorization foundation implemented. Provider action execution remains disabled.
**Scope:** Consumer Blud accounts, connected external services, and interaction
channels.
**Depends on:** `consumer-platform-migration.md`

## Decision

A Blud account is the stable identity and permission principal. An integration
is an independently authorized connection to an external service. A channel is
an interaction and delivery surface through which a person communicates with
Blud.

These are separate security domains:

1. **Identity** answers who is acting and which Blud account is authenticated.
2. **Integrations** answer which external resources that account has authorized
   Blud to access, and which actions are permitted.
3. **Channels** answer where a request arrived and where a response should be
   delivered.

A channel connection never grants access to an integration. Connecting GitHub
does not require Slack, and connecting Slack does not grant GitHub access.
The same GitHub connection may be used through the web app, Slack, or another
authenticated channel, subject to the same authorization checks.

## Repository constraints verified

The current repository already has:

- Better Auth `user`, `account`, `session`, and `verification` tables.
- Stable authenticated user IDs and a central session helper.
- A workspace scope derived from the authenticated user ID.
- `workspaces` and `workspace_memberships` tables. The current membership
  role is constrained to `owner`; the existing workspace model is effectively
  personal-workspace-only.
- A Vercel Connect-backed Google Workspace authorization path. Its subject is
  the Blud user ID, and its current scopes include Gmail modify, Calendar event
  write, Calendar free/busy, and read-only Contacts.
- A separate Linq inbound path that maps a verified phone number to a Blud user.
- A Stripe Link Better Auth account integration with its own OAuth lifecycle.

These constraints matter. The first integration implementation must be
**personal-user-owned**. Workspace-shared integrations must not be enabled
until workspace membership roles, invitation/consent flows, and administrative
authorization have been implemented and tested. Do not treat the current
owner-only membership table as proof that team sharing is supported.

## Core ownership model

### Personal connection

A user authorizes an external account for their own Blud identity. Only that
user may use, inspect, refresh, or revoke the connection. The connection remains
personal even if the user invokes Blud through a shared Slack workspace.

### Workspace connection (future capability)

An authorized workspace administrator connects an external service for a
workspace. Members may use it only when workspace policy permits the requested
action. The system must distinguish the person who authorized the connection
from the workspace that owns it. A personal grant must never become workspace
shared because a channel is shared.

Workspace connections are a later capability, not an implicit extension of
personal connections. Enabling them requires role-based membership, explicit
admin consent, member-level action policy, and audit coverage.

## Domain model

Provider catalogs are application code, not rows that users can edit. A
provider registry defines supported OAuth endpoints, scopes, capabilities,
and adapter implementation. Database records represent grants and connections
created through those providers.

| Entity                          | Purpose                                                       | Ownership                       |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------- |
| Blud `user`                     | Stable identity and account profile                           | Blud account                    |
| Better Auth `account`           | Login identity/provider link, such as Apple or Google sign-in | User                            |
| `integration_connections`       | One authorized external service account                       | User initially; workspace later |
| `integration_credentials`       | Encrypted access/refresh credentials for a connection         | Same owner as connection        |
| `integration_connection_scopes` | Exact provider scopes granted by OAuth                        | Connection                      |
| `integration_action_grants`     | Blud-level allowed/denied action policy                       | Connection and owner            |
| `channel_installations`         | A bot/app installation or channel-level credential            | User or workspace               |
| `channel_identities`            | Mapping from an external channel identity to a Blud user      | Installation                    |
| `audit_events`                  | Security-relevant authorization and execution history         | User/workspace context          |

The personal integration tables in this model are implemented in Drizzle and migration `0015_personal_integrations.sql`. Channel installation, channel identity, and audit-event tables remain proposed and are not implemented.

### Integration connection fields

The future `integration_connections` record should contain:

- Opaque internal ID and stable provider key (for example, `github` or
  `google_workspace`).
- Exactly one owner: `owner_user_id` for a personal connection, or
  `workspace_id` for a workspace connection.
- `created_by_user_id`, identifying the person who completed authorization.
- Provider account/tenant identifier and safe display metadata.
- Lifecycle state: pending, active, reauthorization-required, revoked, or
  failed.
- Created, updated, last-used, and revoked timestamps.

Enforce exactly-one-owner with a database check constraint. For a personal
connection, enforce that the owner and creator are the same user. For a
workspace connection, enforce that the creator is a member of that workspace.
Use foreign keys and uniqueness constraints to prevent duplicate active
connections for the same provider account and owner. Do not rely on UI checks.

### Credentials and scopes

Keep OAuth credentials separate from connection metadata. Store access tokens,
refresh tokens, and any provider credential material as authenticated
ciphertext, encrypted server-side using envelope encryption backed by a
managed secret/KMS key. Persist a key version so ciphertext can be rotated.
Never return ciphertext or plaintext tokens from application APIs.

Store provider-granted OAuth scopes exactly as granted. These scopes are not
the same as Blud action permissions:

- **Provider scopes** define what the external provider's token can do.
- **Action grants** define what Blud is allowed to do with that token.

Both checks are required. A Blud action must be denied if either the provider
token lacks a required scope or Blud policy has not granted that action.
A broad OAuth scope must not silently imply broad Blud permission.

Action grants should use stable action identifiers (for example,
`github.repository.read`, `github.issue.create`, `google.calendar.event.read`,
`google.calendar.event.write`, `google.gmail.message.read`, and
`google.gmail.message.send`). Keep read and write actions distinct. Sending
messages, changing repository state, deleting resources, and other sensitive
operations require explicit action-level authorization and, where policy
requires, per-action user approval.

## Channel model

A channel is an authenticated transport, not an integration provider.

A channel installation represents the bot/app authorization needed to receive
events or send messages through a provider. A channel identity maps a verified
external actor to a Blud user. For workspace-oriented channels, installation
identity and individual member identity must remain distinct.

Inbound requests must pass all of these checks:

1. Verify the provider's webhook signature or trusted transport identity.
2. Resolve the external installation and actor to a Blud user.
3. Confirm that the Blud user is active and belongs to the referenced
   workspace, if applicable.
4. Resolve the request's channel/conversation context.
5. Build a server-side actor context. Never accept a user ID or workspace ID
   supplied only in an untrusted message payload.

The existing Linq flow is a special case: verified phone-number possession
maps an inbound sender to a Blud user. Preserve that verification boundary
until a separately tested channel-identity linking flow replaces it. Browser
sessions and channel identities must not be treated as interchangeable proof.

For Slack, a workspace installation does not mean every Slack member can use
every Blud user's personal integrations. Resolve the Slack actor to their own
Blud account or to an explicitly authorized Blud workspace membership before
executing a request.

## Authorization at execution time

Every integration-backed tool call must be authorized at the point of use.
Connection-time consent alone is insufficient.

The execution boundary must:

1. Authenticate the Blud actor using a trusted session or verified channel
   identity.
2. Resolve the actor's Blud user ID and active workspace membership.
3. Resolve the requested integration connection by internal ID and provider.
4. Verify that the connection is active and owned by that user, or by a
   workspace in which the actor has the required role.
5. Verify that the exact provider OAuth scopes cover the operation.
6. Verify the Blud action grant for the requested action.
7. Require a valid approval reference for operations that need confirmation.
8. Decrypt credentials only inside the server-side adapter execution boundary.
9. Execute the provider operation and write a redacted audit event.
10. Return a typed result to the assistant; never return credentials.

The channel is used only for conversation context and response delivery. It
must not influence the integration ownership decision or bypass the action
policy.

The tool layer should receive a narrow execution context containing the actor,
workspace, connection ID, provider key, action key, and optional approval
reference. It should not receive raw tokens or arbitrary database access.

## API contracts

The following contracts are a mixture of implemented and proposed routes. The GitHub authorization, callback, and disconnect routes listed below are implemented; catalog, connection listing, and other provider routes remain proposed.

### Integration catalog and connections

- `GET /api/integrations` returns the server-supported provider catalog and
  the capabilities available to the signed-in user.
- `GET /api/integrations/connections` returns only connections the current
  user is authorized to view. It omits tokens, ciphertext, and sensitive
  provider metadata.
- `POST /api/integrations/:provider/authorizations` starts an authorization
  attempt. The server chooses allowed scopes from the provider registry; the
  browser cannot request arbitrary scopes.
- The OAuth callback validates one-time state, PKCE, provider, initiating user,
  owner type, and exact redirect URI before exchanging the code.
- `POST /api/integrations/connections/:id/revoke` revokes the provider grant
  where supported, invalidates local credentials, and records the actor and
  outcome.

Authorization attempts must be short-lived, single-use, bound to the initiating
Blud user and intended owner, protected by state and PKCE, and safe against
cross-account callback substitution. Reauthorization must rotate credentials
atomically. Refresh operations must be concurrency-safe. Revocation must make
the connection unusable locally even if the provider's revoke endpoint is
temporarily unavailable.

### Channels

Channel installation and identity-management endpoints must be separate from
integration endpoints. Channel webhooks must authenticate provider delivery
before resolving a Blud actor. Channel connection APIs may manage delivery
preferences and identity links, but may not create integration grants.

### Error behavior

Use typed, non-sensitive errors for unauthenticated actor, missing membership,
connection not found, connection revoked, missing provider scope, denied Blud
action, approval required, and provider reauthorization required. Avoid
revealing whether another user's connection exists.

## Identity provider separation

Google sign-in and Google Workspace access are separate grants:

- Better Auth Google OAuth authenticates a person and links a login identity.
- Google Workspace OAuth authorizes access to Gmail, Calendar, Drive, or other
  Google resources.

The same distinction applies to Apple sign-in versus Apple service access, and
to GitHub sign-in versus GitHub repository access. Never infer an integration
grant from a login-provider account row. Do not reuse Better Auth's
`account` table as the integration-connection store.

The existing Stripe Link account is a specialized Better Auth plugin integration
with a dedicated callback, token refresh, and revocation path. Do not migrate it
into the generic integration model until an adapter can preserve its current
security and wallet semantics under integration tests.

## Audit and privacy requirements

Record at least:

- Connection created, reauthorized, scope changed, revoked, or failed.
- Action grant added, changed, or removed.
- Integration action attempted, allowed, denied, approved, or failed.
- Channel installation and identity linked, unlinked, or revoked.
- Actor user, owner context, connection ID, action key, channel, timestamp,
  request/correlation ID, and outcome.

Audit records must not contain access tokens, refresh tokens, authorization
codes, raw webhook secrets, full message bodies, or unnecessary provider
payloads. Store only the minimum metadata needed for security review and
support. Apply retention and deletion policies to audit data explicitly.

## Migration sequence

1. Keep the current Better Auth identity tables and central user session
   contract. Do not introduce a second user table or identity framework.
2. Introduce typed provider and action registries with no database mutation.
3. Implement personal-user-owned integration connections, encrypted credential
   storage, exact OAuth scope persistence, and action grants.
4. Add a single provider adapter and prove the full authorization, refresh,
   execution, and revocation lifecycle in integration tests.
5. Migrate the existing Google Workspace path from Vercel Connect only after
   the new adapter has parity for its current scopes and user ownership.
6. Add channel installation and identity mapping independently. Preserve the
   existing Linq verified-phone mapping until a safe migration is proven.
7. Add workspace-shared connections only after workspace roles, membership
   invitations, admin consent, and member-level action policies exist.
8. Add additional providers (GitHub, Google services, Notion, and others) by
   implementing the same provider contract, not channel-specific logic.

## Required security tests

Before enabling a provider in the consumer product, cover:

- User A cannot list, inspect, use, refresh, or revoke User B's connection.
- A Slack member cannot use another user's personal integration.
- A personal integration cannot be used as a workspace integration.
- A workspace connection is inaccessible to non-members and unauthorized
  roles.
- An OAuth callback cannot be replayed, swapped across users, or completed with
  a mismatched provider, redirect URI, state, or PKCE verifier.
- Missing provider scope and missing Blud action grant each independently deny
  an operation.
- Revoked, expired, and refresh-failed connections cannot be used.
- Concurrent refresh does not lose rotated refresh tokens.
- Sensitive actions cannot execute without the required approval.
- Webhook spoofing and unlinked channel identities cannot create a Blud
  principal.
- Audit records identify the actor and outcome without persisting secrets.
- Existing Better Auth login accounts and Stripe Link wallet connections
  remain unaffected.

## Acceptance criteria for this architecture milestone

- The ownership distinction between identity, integrations, and channels is
  documented and reflected in API and database contracts.
- Personal connections are the only supported connection owner until team
  membership roles are implemented.
- Every execution path enforces both provider scopes and Blud action grants.
- Channel identity resolution cannot grant or widen integration access.
- OAuth secrets remain server-side and encrypted at rest.
- The tests above are mapped to implementation tests before runtime rollout.

The implementation status below identifies the integration schema and GitHub OAuth routes that now exist. Provider action adapters and channel mapping tables remain unimplemented.

## Implementation status

The initial typed registry now exists in `integrations/registry.ts`. It defines
GitHub and Google Workspace provider identities plus read/write action metadata.
All providers remain marked `planned`; the registry does not authorize OAuth,
execute provider operations, or advertise a working integration.

The registry tests verify provider/action ownership, non-empty provider
permission requirements, read/write separation, approval requirements for
writes, provider filtering, and the fail-closed availability state. The
persistence model, encrypted credential boundary, and GitHub OAuth token
lifecycle are now implemented. Provider activation must wait until action
adapters enforce provider permissions, Blud action grants, and approvals at
runtime, with end-to-end provider verification.

## Personal integration persistence implementation

The personal-only persistence migration is implemented in
`db/migrations/0015_personal_integrations.sql`, with Drizzle definitions in
`db/schema/integrations.ts`. It adds five tables:

- `integration_connections`: user-owned provider account and lifecycle state.
- `integration_credentials`: AES-256-GCM ciphertext, nonce, authentication tag,
  algorithm, credential type, and key version.
- `integration_connection_scopes`: provider scopes attached to the same
  connection owner.
- `integration_action_grants`: allow/deny decisions tied to the connection
  owner; the initial schema requires the owner to be the grantor.
- `integration_authorization_attempts`: owner-bound, one-time state hash,
  encrypted PKCE verifier, redirect URI, status, and expiry.

The connection owner is a foreign key to the existing Better Auth `user.id`.
Child records use composite foreign keys to `(connection_id, owner_user_id)`,
so a credential, scope, or action grant cannot be attached to a connection
under a different user ID. Deleting a Blud user cascades through their personal
connections and authorization records. No Better Auth identity, account, or
session table is altered by this migration.

Credential encryption is implemented in
`integrations/credential-encryption.ts` using Node's AES-256-GCM. Ciphertext
records persist the key version. The keyring accepts an active version plus
older decryption keys, allowing gradual rotation: new ciphertext uses the
active version while older records remain decryptable. Associated data binds
ciphertext to the Blud owner, connection, and credential type; authorization
attempt PKCE material has a separate owner/attempt binding. Key material is
injected into the encryption boundary and must come from a production secret
manager or equivalent protected runtime configuration. Do not use the
development fallback key in a deployed environment.

The persistence milestone was followed by a GitHub OAuth lifecycle implementation. The OAuth routes and owner-scoped credential repository now exist. Provider action adapters and runtime enforcement of provider permissions, Blud action grants, and approvals remain incomplete; GitHub stays disabled in the registry.

Migration and encryption tests cover owner isolation, foreign-key rejection,
grantor ownership, cascade deletion, preservation of Better Auth user/account/
session rows, authenticated encryption, tamper detection, associated-data
binding, and key-version rotation.

Operational note: production deployments must inject the active credential key
and any retained prior key versions from a managed secret store. The
application must fail closed when a row references a key version absent from
the runtime keyring; it must never fall back to the development default.

The credential repository is implemented in
`db/services/integrations/credentials.ts`. Writes are transactional and first
verify that the connection belongs to the supplied Better Auth user and is
active. Reads join against the connection and repeat the owner and active-state
checks before decrypting. Upserts replace the encrypted payload and key version
atomically; deletion is scoped by owner, connection, and credential type. The
repository never returns ciphertext records to its callers.

## Implemented personal integration foundation

The consumer-platform branch now includes the personal integration persistence
schema and server-side credential boundary:

- `integration_connections`, `integration_credentials`,
  `integration_connection_scopes`, `integration_action_grants`, and
  `integration_authorization_attempts` are represented in Drizzle and
  migration `0015_personal_integrations.sql`.
- Composite owner/connection foreign keys prevent credentials, scopes, and
  action grants from being attached to a connection owned by another user.
- Credentials and PKCE verifiers use AES-256-GCM with a persisted key version
  and owner-bound associated data. The current runtime loads one active key
  from installation secrets; multi-key rotation/rewrapping is still a release
  hardening task.
- Personal connections are not shared through workspace or channel membership.
- OAuth consent does not automatically create Blud action grants. Reauthorizing
  a connection clears its previous action grants; every action must be granted
  again explicitly before execution.

### GitHub App user authorization

The current GitHub authorization foundation implements:

1. Authenticated `POST /api/integrations/github/authorize`, protected by an
   exact same-origin check.
2. A ten-minute owner-bound state record. Only a SHA-256 state hash is stored.
3. PKCE S256 with the verifier encrypted at rest and bound to the owner and
   attempt ID.
4. GitHub App user authorization using `offline_access`, the exact configured
   callback URI, and the server-side client secret. For GitHub Apps this scope
   requests expiring tokens and refresh capability; it does not grant API
   permissions. GitHub App permissions are configured on the app and access to
   repositories is constrained by the user's access and the app's installation.
5. An owner-bound, atomic, single-use callback that validates the current Blud
   session, consumes state once, exchanges the code, and verifies the durable
   GitHub numeric user ID through `GET /user`.
6. Encrypted access/refresh token storage. Refresh rotation is serialized with a
   database row lock because GitHub invalidates a refresh token after use.
7. Authenticated `DELETE /api/integrations/github/{connectionId}`. Blud removes
   the local credential even if remote revocation cannot be confirmed; the
   response distinguishes local disconnection from confirmed GitHub grant
   revocation.

The callback returns a minimal JSON result because the current application is
headless and does not contain a settings UI. It never returns provider tokens.

Configure `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` as protected
server-side environment variables. Register the exact callback URL
`https://<application-origin>/api/integrations/github/callback` in the GitHub
App settings. The credentials are forwarded only to the application runtime
tasks by Turbo.

**Important:** GitHub remains `planned` in the provider registry. The OAuth
identity and token lifecycle are not yet a complete GitHub action integration.
Repository discovery/installation access, action-level authorization checks,
provider adapters, audit events, and end-to-end live-provider verification are
still required before enabling GitHub actions.
