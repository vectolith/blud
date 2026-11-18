import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";

const testKey = "test-auth-secret-0123456789abcdefghijklmnop";
const originalInternalKey = process.env.BLUD_INTERNAL_KEY;
const originalVelnorSecret = process.env.VELNOR_SHARED_SECRET;

beforeEach(() => {
  process.env.BLUD_INTERNAL_KEY = testKey;
});

afterEach(() => {
  if (originalInternalKey === undefined) delete process.env.BLUD_INTERNAL_KEY;
  else process.env.BLUD_INTERNAL_KEY = originalInternalKey;
  if (originalVelnorSecret === undefined) delete process.env.VELNOR_SHARED_SECRET;
  else process.env.VELNOR_SHARED_SECRET = originalVelnorSecret;
});

describe("Internal Blud Browser Worker RPC", () => {
  it("rejects credentials owned by another product", async () => {
    delete process.env.BLUD_INTERNAL_KEY;
    process.env.VELNOR_SHARED_SECRET = "velnor-only-secret";
    const req = new Request("http://localhost:3000/api/internal/browser-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
  it("rejects unauthorized request when secret is set", async () => {
    const req = new Request("http://localhost:3000/api/internal/browser-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects invalid json payload when authorized", async () => {
    const req = new Request("http://localhost:3000/api/internal/browser-worker", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-blud-key": testKey,
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts valid browser delegation task and returns coordinator status", async () => {
    const req = new Request("http://localhost:3000/api/internal/browser-worker", {
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
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data?.coordinatedBy).toBeDefined();
  });
});
