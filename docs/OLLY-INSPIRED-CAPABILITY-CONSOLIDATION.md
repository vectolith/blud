# Olly-inspired Blud product consolidation

**Decision:** adopt the practical capabilities of a text-first personal agent
similar to Olly, but simplify Blud's architecture to a coherent consumer
product. This is the target product specification; it does not imply all
capabilities are implemented.

## Product experience

Blud is a personal AI agent users can message or use through the app. The user
asks naturally, Blud plans and executes work using connected services and tools,
and reports verifiable results. It should also deliver opt-in reminders,
scheduled briefings, and monitored updates.

## Capabilities

- Research, web retrieval, grounded summaries, comparisons and citations.
- Email inbox triage, search, summaries, drafting, replies and supported mailbox
  actions.
- Calendar planning, availability, event creation and reminders.
- Tasks and schedules, recurring reports and proactive notifications.
- Files, PDFs, URLs and personal-document search; image understanding and image
  generation when supported.
- Voice-note input/output and transcription when supported.
- Isolated browser/computer agent for interactive multi-step workflows.
- Watches for price, availability, status, replies and user-defined conditions.
- Travel planning, local research, translation, and booking links.
- Shopping comparison and purchase preparation; never silently purchase.
- Group conversation assistance with strict boundaries against leaking private
  memory.
- Personal memory that is scoped, inspectable, editable, exportable and
  deletable.

## Simplify the system

Replace unnecessary architectural layers with these five pieces:

1. **App and channel adapters:** chat UI, messaging channels, voice and API.
2. **Single agent runtime:** one task loop for planning, tool use, verification
   and response; specialist subagents only when a task clearly benefits from
   isolation.
3. **Capability/tool registry:** research, documents/media, browser, connected
   services, messaging, calendar/email, tasks and monitoring.
4. **Durable task engine:** tasks, reminders, schedules and watch triggers share
   state, cancellation, retries, idempotency, delivery and history.
5. **Trust boundary:** authentication, per-user permissions, approvals, encrypted
   credentials, audit, quotas, privacy and tenant isolation.

Prefer the existing code and contracts; remove or replace complexity only
through measured, tested changes. Keep the modular monolith until scale or
isolation justifies separate services. Do not create overlapping task
schedulers, duplicate agent loops, redundant memory systems or speculative
abstraction layers.

## Permission rules

- Read/search/summarize: use only connected, granted scopes.
- Draft, plan and prepare: allowed; present the result.
- Sending, publishing, purchases, booking, deletion, sharing or account-changing
  actions: explicit approval before execution.
- Browser and connected credentials: isolated per user/task and never returned to
  the client or model logs.
- Watches and schedules: user-defined, pauseable and deletable; bounded polling
  and notification controls.
- Private memory is not shared into groups or other users' tasks by default.

## Rollout

**P0:** consolidate durable tasks, permissions/approval UX, memory controls,
activity history, retry/cancel and channel experience.

**P1:** research, files/URLs, email/calendar, reminders, voice/image capabilities
and proactive reports.

**P2:** isolated browser execution, watches/monitoring, travel/shopping workflows
and group assistance.

**P3:** polished consumer onboarding, connection health, export/deletion,
reliability/security evaluations and end-to-end flows.

## Acceptance

Every feature has a status, permission/scopes, bounded retries, cancellation,
verification, tests and truthful user-facing failure states. Do not claim
feature completion until tested. Keep Blud's standalone consumer product
boundary and avoid VELNOR runtime dependencies.
