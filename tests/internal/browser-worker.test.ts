import { describe, expect, it } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";

// Do not claim success until a real browser executor is implemented.
describe("retired internal browser-worker RPC", () => {
  it("never reports a browser task as successful without executing it", async () => {
    const req = new Request(
      "http://localhost:3000/api/internal/browser-worker",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-blud-key": "test-auth-secret-0123456789abcdefghijklmnop",
        },
        body: JSON.stringify({
          message: "Verify homepage load",
          startUrl: "https://example.com",
          caller: "velnor",
        })
      }
    );

    const res = await POST(req);
    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      error: "Retired."
    });
  });
});
