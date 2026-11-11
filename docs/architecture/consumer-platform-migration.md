# Consumer Platform Migration Plan

**Status:** Architecture baseline complete; provider-independent session milestone implemented. Consumer sign-in UI and provider setup remain pending.
**Target:** A consumer-facing Blud product with managed AI access, account-based sign-in, first-party service authorization, and an optional self-hosted edition.
**Branch:** `architecture/consumer-platform-foundation`

## Product decision

Blud is a consumer product, not a developer utility. A customer must be able to create a Blud account, sign in, authorize supported services, and use the assistant without obtaining or pasting model-provider API keys.

The hosted product will operate as a multi-tenant service. A self-hosted edition may remain available for technically capable operators, but self-hosting must not be a prerequisite for ordinary customers.

## Repository facts verified before planning

The current repository already contains a Better Auth implementation and PostgreSQL-backed `user`, `account`, `session`, and `verification` tables. It is not necessary to introduce a second identity framework.

The current Better Auth configuration:
- Enables verified phone-number authentication.
- Disables email sign-in, email sign-up, and social sign-in routes.
- Uses Linq through Vercel Connect to deliver phone OTPs.
- The original session helper required a verified phone number. The first runtime milestone now accepts authenticated sessions by stable user ID; phone verification remains specific to phone-dependent channels.

The current deployment is materially Vercel-coupled:
- `vercel.json` routes scheduled-run endpoints to the Eve service.
- `@vercel/connect/eve` supplies Linq and Google Workspace authorization.
- `@vercel/blob` stores installation secrets and browser-image artifacts.
- Vercel OIDC / AI Gateway is part of the hosted model-access path.
- The README's default deployment provisions Vercel, Kernel, Neon, Blob, and Linq resources.
- The current Compose file provisions PostgreSQL only.
- The README explicitly says the current software is not intended for production use.

These are repository observations, not claims that a migration or production validation has already occurred.

## Target consumer experience

1. **Blud account:** Sign up and sign in with Apple, Google, or email. Phone verification may remain an optional account-recovery or messaging-channel verification method; it must not be the only supported identity.
2. **Managed AI:** Hosted Blud calls model providers through a server-side model gateway. Provider credentials belong only in the hosted backend's secret manager. Customers never supply model API keys.
3. **Connected services:** Users explicitly authorize each external service through its official OAuth or supported authorization flow. Grants are scoped to the user, encrypted at rest, revocable, and never exposed to the browser beyond what the provider's flow requires.
4. **Subscriptions and quotas:** Blud owns plans, entitlements, usage metering, rate limits, and billing. Model spend is bounded by server-side policy.
5. **Task execution:** Tasks and schedules are durable, tenant-scoped, observable, retryable, and cancellable. Sensitive actions require explicit user approval.
6. **Privacy and isolation:** Every conversation, memory record, browser session, integration grant, artifact, and task is scoped to a tenant/user. Authorization is enforced server-side on every access.

## Target architecture

| Capability | Hosted consumer product | Self-hosted edition |
|---|---|---|
| Identity | Blud-managed Better Auth deployment; Apple, Google, email | Same code; operator-configured identity providers |
| Database | Managed PostgreSQL | PostgreSQL |
| AI access | Blud-operated model gateway and provider accounts | Operator-configured provider or local model |
| Browser automation | Isolated browser workers behind a provider interface | Playwright/Chromium worker, optionally remote browser provider |
| Object storage | Private S3-compatible object storage | S3-compatible storage or MinIO |
| Queue and schedules | Durable queue and scheduler workers | Redis/Valkey-backed workers |
| Integrations | Blud-managed OAuth app registrations and encrypted per-user grants | Operator-provided OAuth app registrations |
| Observability | Central metrics, traces, audit events, usage controls | OpenTelemetry-compatible local stack |

The application must depend on internal interfaces rather than Vercel-specific SDKs for identity, OAuth token access, object storage, model inference, browser execution, and scheduling. Provider adapters may be retained where they are useful, but no provider should be mandatory solely because the application imports its SDK directly.

## Identity migration requirements

- Keep Better Auth and its existing database tables unless a tested migration demonstrates a concrete need to change them.
- Add Apple and Google social providers and an email sign-in path using server-side credentials. Do not enable an OAuth provider until its callback URLs, credentials, account-linking rules, and verification behavior are configured and tested.
- [x] Replace the phone-only session schema with a canonical authenticated-user schema. Phone number and verification status are no longer universal session prerequisites.
- Preserve existing phone-auth users and sessions where possible. Design and test a migration path before changing the session contract.
- Establish explicit account-linking rules to prevent account takeover through unverified email addresses or conflicting provider identities.
- Require verified email or provider-verified identity before enabling recovery and sensitive account changes.
- Add session revocation, device/session management, rate limiting, abuse controls, and audit events.
- Keep all secrets out of source control, client bundles, logs, analytics, and error responses.

## Managed AI and billing requirements

- Introduce a server-only model-provider interface and route all hosted model calls through it.
- Keep model selection, fallback, timeout, retry, token/cost accounting, and safety policy centralized.
- Do not silently use a customer's model account or ask for a model API key in the consumer onboarding flow.
- Meter usage by tenant and user; enforce subscription entitlements and hard spend ceilings before dispatching model work.
- Support provider failover only when the fallback is configured and permitted by product policy. Record which provider/model handled each request without logging prompts or secrets unnecessarily.
- Keep local-model and operator-supplied credentials as self-hosting options, not consumer requirements.

## Migration sequence

### Phase 0 — baseline and contracts
- Record current repository dependencies and deployment assumptions.
- Define provider-neutral interfaces and security invariants.
- Add architecture decision records and a migration test plan.
- No production behavior changes in this phase.

### Phase 1 — consumer identity foundation
- Extend Better Auth for Apple, Google, and email authentication.
- Make the session contract independent of phone-number presence.
- Add account linking, verification, recovery, rate limits, and session management.
- Add migration tests proving existing phone-auth accounts remain accessible.
- Keep phone OTP available only as an explicitly configured channel.

### Phase 2 — managed AI gateway and entitlements
- Add a server-side model gateway abstraction.
- Implement tenant-level usage metering, quotas, plan entitlements, and spend controls.
- Remove consumer-facing instructions to provide model API keys.
- Retain provider-specific credentials only in server-side deployment secrets.

### Phase 3 — infrastructure independence
- Replace direct Vercel Blob use with an object-storage interface and S3-compatible adapter.
- Replace Vercel Connect OAuth dependencies with provider-neutral per-user OAuth authorization and token storage.
- Replace Vercel-specific scheduled routing with durable queue/scheduler workers.
- Add independent deployment manifests and health checks.
- Keep a compatibility adapter only where it reduces migration risk.

### Phase 4 — browser and integration isolation
- Put Kernel behind a browser-provider interface and add a Playwright/Chromium implementation.
- Isolate browser contexts and credentials by user/task.
- Make Google and messaging integrations use explicit, revocable per-user grants.
- Add integration contract tests and authorization-boundary tests.

### Phase 5 — consumer launch hardening
- Add billing, usage visibility, support/admin controls, abuse prevention, deletion/export flows, backup/restore, incident logging, and operational runbooks.
- Run load, security, recovery, and tenant-isolation tests.
- Remove the README's non-production warning only after the release criteria are met.

## Release gates

A phase is not complete because code compiles alone. Required evidence includes:
- Type checking, linting, unit tests, and integration tests.
- Database migration tests against both empty and existing databases.
- Authentication tests for sign-up, sign-in, account linking, session expiry, revocation, and recovery.
- Tenant-isolation tests for database records, object storage, browser contexts, jobs, and integrations.
- Secret-scanning and client-bundle checks.
- Reproducible local deployment and a documented clean-install path.
- Operational tests for queue retries, duplicate delivery, worker restarts, and scheduled-task recovery.
- A successful production-like staging deployment before any production-readiness claim.

## Explicit non-goals

- Do not put a shared AI provider key in the public repository, mobile app, browser bundle, or distributed client.
- Do not require every consumer to create accounts with OpenAI, Anthropic, or another model provider.
- Do not replace working code wholesale without tests and a migration path.
- Do not claim Vercel independence until Vercel-specific runtime dependencies have been removed or isolated behind optional adapters and a non-Vercel deployment has been exercised.
- Do not claim production readiness until the release gates above pass.

## Immediate next engineering task

Start Phase 1 by tracing the complete Better Auth client/server flow, the current sign-in UI, environment validation, account schema, and session consumers. Implement Apple/Google/email support and the phone-independent session contract as one tested change set. Do not guess OAuth configuration names or callback behavior; verify them against the installed Better Auth version and its documentation before implementation.
