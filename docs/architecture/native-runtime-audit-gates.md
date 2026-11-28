# BLUD-native runtime migration: dependency inventory and gates

This audit is an implementation gate, not a claim that BLUD is already independent.

## Confirmed coupling on main

- `eve` is a direct runtime dependency (`1.0.0-rc.1`).
- Build, deployment, development, start, browser evaluation, and benchmark scripts invoke Eve.
- `@vercel/blob`, `@vercel/connect`, and `@vercel/oidc` are direct dependencies.
- Browser execution uses Kernel SDK/loop dependencies.
- `ai` is present as a model/runtime integration dependency.

## Required replacement boundaries

1. **Runtime core:** BLUD-owned orchestration, turn lifecycle, cancellation, deadlines, recovery and durable task state.
2. **Sessions and events:** BLUD-owned session/turn persistence, event schema, streaming and replay.
3. **Tools and policy:** typed registry, dispatch, permission checks, approvals and auditable tool results.
4. **Memory:** BLUD-owned contracts, lifecycle, retrieval and privacy controls.
5. **Workers and scheduling:** durable jobs, leases, retries, cancellation, idempotency and shared-key or equivalent deployment-neutral auth.
6. **Channels:** BLUD-owned channel interfaces and adapters; no vendor runtime in core.
7. **Browser execution:** provider adapter boundary, with provider-specific implementations isolated and replaceable.
8. **Inference:** provider-neutral interface, structured output, streaming, tool-call normalization, timeouts and fallback policies.
9. **Storage/auth/deployment:** remove platform-specific dependencies and configuration from core; optional adapters only.
10. **Developer experience:** standard scripts, reproducible local setup, CI and deploy-neutral smoke tests.

## Acceptance gates

- Runtime and application tests pass at exact branch head.
- Typecheck, lint, formatting, dependency inventory and build pass.
- Durable execution is tested for cancellation, crash recovery, retries, duplicate delivery and task history.
- Permission boundaries and secret-handling tests pass.
- Deployment-neutral smoke tests pass.
- Dependency and source scans demonstrate that Eve and Vercel are not foundational runtime/build/deploy dependencies.
- Evidence and remaining optional integrations are documented honestly.


## Platform-dependency elimination audit (expanded)

The target is not merely removal of the Vercel deployment button. Any capability that currently depends on Vercel/Eve APIs, hosting assumptions, identity tokens, storage, or build wrappers must be replaced with BLUD-owned code or a neutral adapter. Vendor-specific adapters may remain only as optional, isolated integrations and must not be required to run BLUD.

### Confirmed Vercel coupling to remove

- **Build/deployment:** `vercel.json`, `build:vercel` Turbo tasks, deployment docs, Eve Next wrapper (`next.config.ts`), Vercel runtime routing and cron configuration.
- **Identity and connected integrations:** `@vercel/connect`, `@vercel/connect/eve`, `@vercel/oidc`, Linq/Google Workspace authorization flows that are implemented through Connect, OIDC token acquisition and platform-specific callback routing.
- **Blob storage:** `@vercel/blob` usages for installation secrets, browser-image artifacts, image retrieval and cleanup. Replace with storage abstraction and self-hostable/local or neutral-compatible implementation; no required Blob account.
- **Inference access:** Vercel OIDC/AI Gateway fallback and environment variables that make hosted model access depend on Vercel identity. Replace with provider-neutral inference configuration and explicit provider adapters.
- **Runtime framework:** Eve imports across agent definition, channels, hooks, tool definitions, context/state, evaluations, runtime smoke, scripts, event handling, schedules and sessions. Replace with BLUD runtime primitives; no Eve CLI or runtime required.
- **Browser execution:** Kernel SDK and browser-loop API assumptions, credentials, provider-specific browser sessions, telemetry, screenshot masking/autofill and computer-action implementations. Replace with a BLUD browser-provider interface and independent implementation(s); provider credentials must be optional and isolated.
- **Environment/configuration:** `VERCEL_*`, `VERCEL_OIDC_TOKEN`, `BLOB_*`, `KERNEL_*`, and provider-specific deployment variables that are mandatory or silently select platform behavior. Keep only neutral configuration or optional adapters.
- **Scripts, tests and CI:** Remove Vercel/Eve/Kernel-required setup from development, evals, tests, smoke tests, dependency checks, patches, workspace allowlists, lockfile and docs. Test local self-hosted paths without vendor credentials.

### Confirmed hotspots from repository-wide source search

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `taze.config.ts`, `knip.config.ts`
- `next.config.ts`, `vercel.json`, `turbo.json`, `.env.example`, `proxy.ts`, `AGENTS.md`
- `agent/agent.ts`, `agent/channels/eve.ts`, `agent/channels/sendblue.ts`, `agent/lib/mode.ts`, `agent/hooks/evlog.ts`, `agent/tools/*`
- `agent/memory/profile.ts`, `agent/lib/profile-memory.ts`, `db/services/installation-secrets.ts`, `app/artifacts/[artifactId]/route.ts`
- `agent/lib/schedules/request.ts`, schedule/channel/lease modules, `scripts/dev.ts`, `scripts/run-runtime-smoke.ts`, `scripts/run-agent-evals.ts`
- `agent/subagents/browser-agent/**` (Kernel SDK/browser-loop/provider-bound code), browser tests and evals
- `web/trpc/router.ts`, `shared/google-workspace/connection.ts`, Google Workspace authorization client
- `evals/**`, `patches/**`, deployment and migration docs, third-party notices

This is a search-derived hotspot list, not a complete file-by-file verified dependency graph. Each path must be revisited during implementation, including transitive dependencies and lockfile references.

### Migration sequence and hard stop criteria

1. Establish the BLUD-native runtime and interfaces, then migrate application execution, channel lifecycle and durable persistence.
2. Replace Vercel Connect/OIDC identity flows with BLUD-owned authorization/session/connection contracts and neutral adapters.
3. Replace Blob usage with BLUD storage interfaces and an operational self-hostable storage implementation; migrate/read existing artifacts safely.
4. Replace AI Gateway/OIDC inference assumptions with explicit provider configuration.
5. Replace Kernel/browser-loop with an independently deployable browser implementation behind BLUD's adapter boundary.
6. Remove Eve/Vercel packages, patches, wrappers, scripts, configuration, lockfile entries and docs only after all consumers have been migrated.
7. Prove a clean install, migration, test, build and operational smoke test with no Vercel account, Vercel credentials, Eve CLI, or Kernel Marketplace provisioning.

**Completion is blocked** until repository-wide scans of source, scripts, tests, CI, deployment files, lockfile, package manifests and docs show no required Vercel/Eve integration. References retained for migration history must be non-executable documentation and clearly marked historical; optional vendor adapters must not be a dependency of BLUD's default runtime.
