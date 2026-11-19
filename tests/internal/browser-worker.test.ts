import { describe, expect, it } from "vitest";
import * as route from "@app/api/internal/browser-worker/route";

describe("retired internal browser-worker RPC", () => {
  it("answers 410 so a browser task is never reported successful", async () => {
    // The retired handler takes no request object: it answers 410 before any
    // payload is read, so a queued browser task can never be reported done.
    const res = await route.POST();
    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({ error: "Retired." });
  });

  it("exposes no other method that could queue browser work", () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(route).not.toHaveProperty(method);
    }
  });
});
