# BLUD repository contract

BLUD is a standalone agent product. Its runtime, orchestration, session lifecycle, tool registry and execution, permissions, memory, scheduling, channels, streaming, persistence, and recovery must be owned by this repository.

Do not introduce Eve, Vercel, or other agent-framework/hosting dependencies into the canonical runtime. External services must be replaceable adapters behind BLUD-owned contracts.

## Validate changes

Run `pnpm check` and `pnpm build` before handing off changes. Run relevant tests and report evidence accurately.

## Code organization

- Treat `shared` as a narrow contract boundary, not a default destination for application code.
- Do not add a generic `modules` layer. Give code a concrete owner and colocate it there.
- Mock imported modules at their owning or external boundary in tests. Do not export mutable dependency bags or test-only seams from production modules.
- Use lower-case file and folder names.
- Before adding types, search for existing owning exports and inference.
- Before planning or changing product UI, build from primitives in `web/components/ui` and semantic typography utilities.
