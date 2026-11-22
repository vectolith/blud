# Standalone hosting migration

## Objective

Remove hosting-platform lock-in from BLUD. A supported installation must be deployable on independently operated infrastructure without platform-specific deployment configuration, identity, storage, runtime secrets, cron, or integration adapters.

## Current coupling inventory

- Deployment/build: platform-specific configuration, build targets, deploy scripts and framework deployment helpers.
- Authentication and application origin: host-provided URL variables and host-specific allowed-host handling.
- Installation secrets: platform Blob storage and project identity used for installation key persistence.
- Profile memory: platform Blob implementation.
- Artifact storage: platform Blob-backed browser image artifacts.
- Scheduled work: host-specific OIDC and callback infrastructure.
- Messaging and Google OAuth: managed connector abstraction.
- Inference: managed AI gateway token path.
- Development and documentation: platform CLI commands, onboarding guidance, env assumptions.
- Tooling and dependencies: platform CLI, SDKs and package families.

## Migration principles

1. Preserve standalone functionality and existing data; migrations must not silently drop user data or credentials.
2. Replace platform-bound functionality with owned interfaces and provider-neutral contracts, then add viable self-hosted implementations.
3. Keep integrations optional. No provider should be a prerequisite for BLUD's core identity or local development unless a feature genuinely requires it.
4. No paid services are required for the baseline. Provider-specific optional integrations must disclose costs and limits.
5. Secrets are explicitly provisioned or stored in a user-controlled persistent backend. Never generate ephemeral production keys that invalidate sessions or vault data on restart.
6. Scheduled tasks require a supported persistent scheduler and worker deployment—not platform cron assumptions.
7. Each migration phase must have tests, upgrade guidance, backup/rollback notes and a verified deployment path.

## Proposed sequence

### Phase 1 — Deployment surface and inventory
- Remove platform-specific deployment configuration from the canonical path.
- Establish provider-neutral build/start/migration commands.
- Update documentation and environment variable descriptions.
- Map platform dependencies to owning abstractions and tests.

### Phase 2 — Storage and installation secrets
- Define storage interfaces for private objects and installation secrets.
- Implement a baseline filesystem-backed private storage provider with safe path handling, size limits, atomic writes, permission checks and backup guidance.
- Retain an explicitly optional adapter for existing deployments during migration.
- Validate secret persistence, rotation and concurrent creation.

### Phase 3 — Authentication, origin and integration adapters
- Make canonical origin and trusted-host configuration provider-neutral.
- Replace managed connector coupling with independently configured OAuth and messaging adapters.
- Preserve user scoping, token encryption, refresh and revocation.

### Phase 4 — Inference and browser execution
- Provider-neutral inference interface and endpoint configuration; optional local inference.
- Keep browser automation provider adapters replaceable, documenting realistic compute and cost constraints.

### Phase 5 — Workers, schedules and deployment
- Persistent queue/scheduler and independent worker lifecycle.
- Document Docker Compose and production deployment patterns, health checks, backups, recovery, security and upgrade procedures.

### Phase 6 — Removal and verification
- Remove legacy adapters and dependencies only after parity and migration tests.
- Audit repository and history-facing docs for platform-specific assumptions.
- Run complete CI, security review, migration checks and deployment smoke tests.

## Status

Phase 1 is in progress: the Vercel deployment configuration was removed from the migration branch, the application-origin error messaging is now platform-neutral, local development no longer recommends a Vercel-specific setup path, and database migration guidance is operator-managed. Runtime provider dependencies remain and the migration is not yet complete.
