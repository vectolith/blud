# BLUD-owned runtime foundation

This folder introduces the framework-independent execution boundary. It does
not invoke Eve, Vercel, a provider SDK, or a host-specific route.

The runtime engine accepts four independently replaceable boundaries:

- A repository for task/session/message persistence.
- A model adapter.
- A BLUD-owned tool registry with schemas and execution functions.
- A policy implementation that authorizes each tool invocation.

## Current limitations

This is an initial engine foundation, not a release runtime. The persistence
contract still needs a production database implementation and migrations for
task, turn, and tool-invocation records. Model adapters, durable event
streaming, job leases, replay/idempotency, worker recovery, API
authentication/ownership, and route/UI integration remain to be implemented.

The current loop uses a bounded step count and an AbortSignal for in-process
cancellation; cancellation and retries are not durable across process
restarts.

No production or release claim should be made until these contracts are
implemented, integrated, and tested against the actual application and CI.
