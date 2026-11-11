import { describe, expect, it } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";

describe("Internal Blud Browser Worker RPC", () => {
  it("rejects unauthorized request when secret is set", async () => {
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

  it("rejects invalid json payload when authorized", async () => {
    const req = new Request(
      "http://localhost:3000/api/internal/browser-worker",
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-blud-key": "test-auth-secret-0123456789abcdefghijklmnop",
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts valid browser delegation task and returns coordinator status", async () => {
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
        }),
      }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data?.coordinatedBy).toBeDefined();
  });
});
