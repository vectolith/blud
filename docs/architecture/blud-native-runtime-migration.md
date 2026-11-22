# BLUD-native runtime migration

## Non-negotiable boundary

BLUD must not depend on Vercel or Eve (or another third-party agent framework) for its core application, orchestration, runtime, or deployment. External vendors and frameworks may only exist behind optional, replaceable adapters; the core must remain BLUD-owned.

## Target architecture

- **Runtime and orchestrator:** BLUD-owned task/turn loop, lifecycle, context assembly, model invocation boundary, tool dispatch, continuation, cancellation, and failure recovery.
- **Session persistence:** BLUD-owned session, turn, message, delivery, and execution-state contracts backed by the project's database.
- **Tool contract:** BLUD-native tool registry, schemas, authorization, capability grants, invocation records, and verification. Tools must not be framework-defined.
- **Model providers:** provider-neutral interface; support independently configured hosted or local models without OIDC/Gateway coupling.
- **Memory:** BLUD-owned memory interface, scoped privacy/consent, retrieval, retention and durable storage; storage providers are adapters.
- **Workers and scheduling:** BLUD-owned durable job records, lease/claim/recovery, scheduler and worker protocol, independent of host-specific routes.
- **Channels and UI:** channel adapters use the BLUD runtime contract. The web chat must use BLUD's session/task APIs and stream events, not framework channels.
- **Identity and permissions:** authentication and authorization stay in BLUD; enforce ownership and tool/action permissions at the boundary and in execution.
- **Observability:** BLUD-owned event and trace schema, safe redaction, execution audit and outcome verification.

## Migration sequence and gates

1. Inventory Eve and Vercel coupling by capability, dependency, environment variable, route, schema, test and production path. Mark behavior that is currently depended on.
2. Define BLUD runtime/session/tool/event contracts and compatibility fixtures before replacing the framework.
3. Implement a minimal BLUD-owned runtime loop and durable session/turn state; exercise deterministic model and tool adapters in tests.
4. Migrate tools incrementally behind BLUD-native contracts; retain authorization, safety boundaries and regression tests.
5. Replace framework channels and wire the chat UI to BLUD's own runtime API and streaming protocol.
6. Replace framework-managed memory, callbacks, scheduling, model selection and deployment behavior with BLUD-owned implementations and adapters.
7. Remove Eve, Vercel-specific packages, imports, routes, patches, config, environment names and docs only after corresponding replacement and regression evidence exist.
8. Validate clean install, lint, typecheck, unit/integration/runtime tests, build, migrations, deployment-neutral smoke tests and recovery/cancellation/security tests.

## Exit criteria

- Core BLUD application and agent runtime compile, run, and test without Eve or Vercel packages, services, credentials, tokens, or deployment environment.
- Every capability removed from the legacy framework path has a BLUD-owned replacement and tests.
- The runtime persists and resumes work; cancellation, failure recovery, tool permissions and session ownership are tested.
- The chat UI sends tasks, receives streamed events, resumes sessions, and shows verified completion/failure.
- A provider/host is optional and replaceable, not the source of core semantics.
- CI is green on the exact final commit. No unsupported claim of runtime or deployment verification.

## Current reality

PR #16 removed some deployment-specific scaffolding but is not a completed independence migration. Eve is still the agent framework, and Vercel integrations remain in the code and dependency graph. PR #17 is only a visual chat shell. Neither should be merged as representing a completed BLUD runtime.


## Independent Core Prime interoperability and learning bridge

BLUD and Core Prime are separate products and repositories. Neither is required for the other to operate. BLUD must remain usable without Core Prime; Core Prime must remain usable without BLUD. Integration is optional and replaceable, never a shared-runtime or shared-infrastructure dependency.

When configured by an operator and subject to applicable user consent, privacy, retention, and data-governance controls, BLUD may export learning signals to a Core Prime ingestion endpoint. Signals may include provider/model provenance, prompts and responses only when eligible, tool outcomes, task-level outcome labels, corrections, and evaluation feedback. The bridge must support redaction, minimization, provenance, deduplication, opt-out, and revocation/deletion workflows as appropriate. It must not silently treat all user conversations as training data.

The bridge is a transport and schema contract—not model training embedded in BLUD. Core Prime owns ingestion, dataset construction, training, evaluation, release gating, and model lifecycle. BLUD only emits eligible records through an optional adapter; failure or absence of that adapter must not block normal BLUD operation.

## Learning bridge completion gates

- BLUD runs with the bridge disabled or absent.
- Bridge authorization and consent are explicit and auditable.
- Payloads are minimized, redacted, provenance-tagged, and schema-versioned.
- Transport failures do not affect agent task execution; retry and dead-letter handling are isolated.
- Core Prime independently validates, filters, evaluates, and controls training and release.
- No automatic model promotion or unreviewed live-learning mutation occurs from raw interactions.
