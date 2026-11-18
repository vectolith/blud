import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@app/api/internal/browser-worker/route";
import { z } from "zod";

const serviceSecret = "test-auth-secret-0123456789abcdefghijklmnop";
const responseBodySchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

function request(body: string, token = serviceSecret) {
  return new Request("http://localhost:3000/api/internal/browser-worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-blud-key": token } : {}),
    },
    body,
  });
}

describe("Internal Blud Browser Worker RPC", () => {
  beforeEach(() => {
    vi.stubEnv("BLUD_INTERNAL_KEY", serviceSecret);
    vi.stubEnv("VELNOR_SHARED_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("KERNEL_API_KEY", "configured-kernel-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when service authentication is missing", async () => {
    vi.stubEnv("BLUD_INTERNAL_KEY", "");
    vi.stubEnv("VELNOR_SHARED_SECRET", "");

    const res = await POST(
      request(JSON.stringify({ message: "test", caller: "velnor" }))
    );
    expect(res.status).toBe(503);
    const body = responseBodySchema.parse(await res.json());
    expect(body.status).toBe("offline");
    expect(body.error).toBe("internal_service_auth_not_configured");
  });

  it("rejects an invalid internal service key", async () => {
    const res = await POST(
      request(JSON.stringify({ message: "test" }), "wrong-secret")
    );
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON after authentication", async () => {
    const res = await POST(request("{"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid browser delegation payload", async () => {
    const res = await POST(request(JSON.stringify({})));
    expect(res.status).toBe(400);
  });

  it("never reports success before browser execution exists", async () => {
    const res = await POST(
      request(
        JSON.stringify({
          message: "Verify the page title",
          startUrl: "https://example.com",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_execution_not_implemented");
    expect(body.message).toMatch(/no browser action was performed/i);
    expect(body.data).toBeUndefined();
  });
});
