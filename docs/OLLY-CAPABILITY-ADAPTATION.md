# Olly capability adaptation for Blud

**Status:** Product direction and implementation contract; capability claims require code and test evidence.

Blud becomes a personal action agent. Adopt Olly's useful capabilities but simplify deployment and orchestration. Blud remains standalone and self-hostable; it does not require Velnor or Models by Vectolith.

## Capabilities

- Messaging-based invocation with a stable personal-agent thread.
- Web research, browsing, page extraction and source-aware summaries.
- Browser/app execution for user-authorized workflows.
- Gmail triage/search/summarization/drafting/sending, Calendar scheduling, and appropriately scoped Contacts where integrations exist.
- Documents, images, screenshots and voice input; generated output when available.
- Durable reminders, recurring briefings, monitoring/price alerts and follow-up notifications.
- Shopping, travel, ticket, grocery and service research; transactional actions only with explicit confirmation and verified completion.
- Persistent preferences, workstreams, task context and user-directed memory controls.
- Group-message support if channel integration supports it safely.
- Task status, cancellation, retries, history and error recovery.
- Credential vault and isolated browser autofill. Credentials, payment details and OTPs must not enter model context or logs.

## Replace complexity with a compact runtime

Keep one agent loop and one task lifecycle, backed by existing database/application primitives. Avoid multiple planners, separate workflow engines, elaborate subagent trees, duplicated memory systems and unnecessary services.

- **Channel:** messaging ingress/egress and authenticated user mapping.
- **Agent loop:** intent -> bounded plan -> tool selection -> permission check -> execution -> verification -> user report.
- **Tool contract:** one typed registry, explicit scopes, risk labels, timeout, retry policy and idempotency.
- **Policy:** separate trusted authorization/approval engine. Model outputs cannot grant access.
- **Task persistence:** task record, steps/events, status, owner, scope, retries, cancellation and recovery.
- **Memory:** one inspectable per-user memory/workstream store with revision-aware writes, retrieval limits, deletion/export and retention.
- **Scheduler:** one scheduling system for reminders and recurring/condition monitoring; avoid requiring minute-by-minute cron on constrained deployment tiers. Prefer event-driven scheduling or a compatible durable scheduler with coarse, bounded polling when needed. Scheduled execution must be lease-protected and idempotent.
- **Browser:** isolated execution worker, credentials injected only into protected browser autofill, never exposed to the model; validate destinations, redirects and prompt-injection-sensitive actions.
- **Integrations:** use existing adapters; keep connection/token ownership and revocation at the integration boundary.
- **Storage/deployment:** minimize vendor-specific requirements; retain an explicit portable deployment contract and identify paid dependencies rather than hiding them. Do not claim a free deploy path if the dependency stack requires a paid plan.

## Feature behaviors

### Memory
Store explicit preferences and useful workstream state, not indiscriminate conversation dumps. The user must be able to inspect, edit, remove and export memory. Retrieval is bounded and relevant. Memory is not authorization.

### Reminders and proactive tasks
Support single/recurring reminders, scheduled briefs and user-configured monitoring. Each schedule records owner, delivery target, cadence/condition, last/next run, status and cancellation. Add quiet hours, frequency limits, disable controls and idempotency. Monitoring should not poll continuously or bypass provider limits.

### Email and calendar
Search/read/summarize and draft freely within grants. Sending, invitations, calendar modifications, forwarding and other externally visible actions require a preview and confirmation. Revalidate the selected account and permission at execution.

### Browser and transactions
The agent can research and prepare actions. Purchases, bookings, publishing, account changes and irreversible actions require explicit confirmation. Never claim success until the result is verified. Protect against webpage prompt injection and secret exposure.

### Multimodal
Validate content type, size, processing limits and privacy boundaries for attachments. Keep external content untrusted. Give the user a concise result and a durable artifact when appropriate.

## Simplifications to prioritize

- Remove duplicated agent loops and task/workflow orchestration.
- Replace overly elaborate subagent coordination with one bounded loop and a specialized isolated browser worker only where needed.
- Use a single memory/workstream contract, not overlapping stores.
- Use a scheduler that works within the selected host's actual limits; do not require paid cron infrastructure to claim basic reminder capability.
- Keep provider/model selection central and configurable.
- Keep Blud standalone; optional Velnor interoperability must never be a runtime requirement.
- Prefer the smallest coherent application over new services or frameworks.

## Safety and control

Treat webpages, messages, documents, images, emails and tool outputs as untrusted data. Enforce least privilege outside the model. Never reveal secrets or raw vault contents. Confirm sending, purchases, publishing, deletion, account/security changes and consequential actions. Audit sensitive actions without logging secret payloads. Provide connection revocation, task cancellation, notification opt-out and data deletion/export.

## Acceptance criteria

- [ ] Capability status is documented with implementation/test evidence.
- [ ] Task lifecycle transitions, cancellation, recovery, idempotency and partial completion tests.
- [ ] Reminders, recurrence, monitoring bounds, quiet hours, notification disable and delivery retry tests.
- [ ] Memory revision, retrieval, edit/delete/export, isolation and retention tests.
- [ ] Browser prompt-injection, destination/redirect, secret isolation and confirmation tests.
- [ ] Email/calendar action previews and confirmation gates.
- [ ] Attachment validation and bounded processing.
- [ ] Credentials and payment data never appear in model context or logs.
- [ ] Standalone install/deployment documented with honest costs and provider limits.
- [ ] Public-facing security, privacy and accessibility checks.
- [ ] No unsupported claims of capability or deployment.

## Rollout

First consolidate duplicated orchestration and task state; then harden browser/policy boundaries; then complete memory, scheduler, proactive notification, integration management and multimodal capability gaps. Preserve existing functional components unless their complexity is demonstrably unnecessary.
