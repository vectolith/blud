import { describe, expect, it } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";

describe("retired cross-product browser RPC", () => {
  it("returns gone instead of claiming a browser task was executed", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.status).toBe("unavailable");
    expect(body.error).toMatch(/standalone product/i);
  });
});
