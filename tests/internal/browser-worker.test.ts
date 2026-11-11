import { describe, expect, it } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";

describe("Internal Blud Browser Worker RPC", () => {
  it("rejects requests without the configured internal key", async () => {
    const req = new Request(
      "http://localhost:3000/api/internal/browser-worker",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test" }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects invalid task payload when authorized", async () => {
    const req = new Request(
      "http://localhost:3000/api/internal/browser-worker",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-blud-key": "test-internal-key-0123456789abcdefghijklmnop",
        },
        body: JSON.stringify({}),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("does not claim to execute a valid browser task", async () => {
    const req = new Request(
      "http://localhost:3000/api/internal/browser-worker",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-blud-key": "test-internal-key-0123456789abcdefghijklmnop",
        },
        body: JSON.stringify({
          message: "Verify homepage load",
          startUrl: "https://example.com",
          caller: "velnor",
        }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(501);
  });
});
