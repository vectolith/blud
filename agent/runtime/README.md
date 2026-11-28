# Native BLUD runtime (migration foundation)

This package area is BLUD-owned and vendor-neutral. The orchestration contract includes durable task state, state-transition conflict handling, event history, cancellation and retry policy.

**Not yet production complete:** a concrete Postgres TaskStore, durable leases/worker loop, approval transitions, sequence-safe event IDs, crash recovery and the chat transport integration must land and be validated before this runtime can replace the current agent engine. This foundation intentionally does not claim otherwise.
