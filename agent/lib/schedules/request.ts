import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";

const eveDevServerSchema = z.object({
  appRoot: z.string(),
  origin: z.url(),
});

interface ScheduledRunRequestBodies {
  "/internal/scheduled-run/report": { runId: string };
  "/internal/scheduled-run/respond": {
    answer: string;
    leaseToken: string;
    runId: string;
  };
}

/**
 * Shared-secret header used by the scheduler callbacks. Both the worker that
 * posts a route and the channel that receives it read BLUD_INTERNAL_KEY, so a
 * deployment does not need a hosting-platform identity provider.
 */
export function internalRequestAuthorized(request: Request) {
  const expected = env.BLUD_INTERNAL_KEY;
  if (!expected) return env.NODE_ENV !== "production";
  const provided = request.headers.get("authorization");
  if (!provided?.startsWith("Bearer ")) return false;
  return secretsMatch(provided.slice("Bearer ".length), expected);
}

export async function postScheduledRunRoute<
  Route extends keyof ScheduledRunRequestBodies,
>(route: Route, body: ScheduledRunRequestBodies[Route]) {
  const headers = new Headers({ "content-type": "application/json" });
  if (env.BLUD_INTERNAL_KEY) {
    headers.set("authorization", "Bearer " + env.BLUD_INTERNAL_KEY);
  }
  const origin = await scheduledRunOrigin();
  return fetch(new URL(route, origin), {
    body: JSON.stringify(body),
    headers,
    method: "POST",
    redirect: "error",
  });
}

async function scheduledRunOrigin() {
  if (env.NODE_ENV === "development") {
    try {
      const registry = eveDevServerSchema.parse(
        JSON.parse(await readFile(".eve/next-dev-server.json", "utf8"))
      );
      if (registry.appRoot === process.cwd()) {
        return new URL(registry.origin).origin;
      }
    } catch {
      // Standalone development does not create the Next.js server registry.
    }
  }
  return applicationOrigin();
}

export async function postScheduledReport(runId: string) {
  const response = await postScheduledRunRoute(
    "/internal/scheduled-run/report",
    { runId }
  );
  if (response.status !== 202) {
    throw new Error(
      "Scheduled report callback failed (" + String(response.status) + ")."
    );
  }
}

function secretsMatch(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
