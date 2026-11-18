/*
 * oxlint-disable vitest/require-mock-type-parameters -- Auth initialization
 * needs a deliberately partial Better Auth fixture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getAuth } from "@db/services/auth";
import type { toNextJsHandler } from "better-auth/next-js";

type AuthInstance = Awaited<ReturnType<typeof getAuth>>;
type AuthHandlers = Pick<ReturnType<typeof toNextJsHandler>, "GET" | "POST">;

const handler = vi.fn<(request: Request) => Promise<Response>>();
// Explicit signatures keep the mocked Better Auth adapter contract type-checked.
const mocks = vi.hoisted(() => ({
  getAuth: vi.fn<() => Promise<AuthInstance>>(),
  toNextJsHandler: vi.fn<(auth: AuthInstance) => AuthHandlers>(),
}));

vi.mock("@db/services/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: mocks.toNextJsHandler,
}));

beforeEach(() => {
  vi.clearAllMocks();
  handler.mockResolvedValue(Response.json({ ok: true }));
  mocks.toNextJsHandler.mockReturnValue({
    GET: handler,
    POST: handler,
  });
});

describe("auth route initialization", () => {
  it("retries after transient installation-secret failures", async () => {
    mocks.getAuth
      .mockRejectedValueOnce(new Error("Blob temporarily unavailable"))
      .mockResolvedValueOnce({} as AuthInstance);
    const { GET } = await import("@app/api/auth/[...all]/route");
    const request = new Request("https://blud.example/api/auth/session");

    await expect(GET(request)).rejects.toThrow("Blob temporarily unavailable");
    await expect(GET(request)).resolves.toMatchObject({ status: 200 });
    expect(mocks.getAuth).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledOnce();
  });
});
