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

