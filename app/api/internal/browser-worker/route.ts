import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Client } from "eve/client";
import { z } from "zod";
import { readTaskCompletion } from "@evals/browser/worker-events";
import { env } from "@shared/environment/env";

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(8_000),
    startUrl: z.url().optional(),
    sessionRef: z.string().min(1).optional(),
    extractSchema: z.record(z.string(), z.unknown()).optional(),
    caller: z.literal("velnor"),
  })
  .strict();

const browserToolNames = new Set([
  "browser_snapshot",
  "browser_text",
  "browser_find",
  "browser_wait_for",
  "browser_act",
  "playwright_execute",
  "computer_action",
]);

function configuredServiceSecret(): string {
  return env.BLUD_INTERNAL_KEY ?? env.VELNOR_SHARED_SECRET ?? "";
}

function isAuthorized(request: Request, secret: string): boolean {
  const headerKey = request.headers.get("x-blud-key");
  const bearerToken =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const token = headerKey && headerKey.length > 0 ? headerKey : bearerToken;
  const expectedBytes = Buffer.from(secret);
  const tokenBytes = Buffer.from(token);
  return (
    tokenBytes.length === expectedBytes.length &&
    timingSafeEqualBytes(tokenBytes, expectedBytes)
  );
}

function timingSafeEqualBytes(left: Buffer, right: Buffer): boolean {
  // Check lengths before timingSafeEqual because Node requires equal lengths.
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const secret = configuredServiceSecret();
  if (!secret) {
    return NextResponse.json(
      {
        status: "offline",
        error: "internal_service_auth_not_configured",
        message: "Blud internal service authentication is not configured.",
      },
      { status: 503 }
    );
  }

  if (!isAuthorized(request, secret)) {
    return NextResponse.json(
      { error: "Unauthorized: valid internal service key required." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid browser task payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { message, startUrl, extractSchema, sessionRef } = parsed.data;
  if (sessionRef && !/^wrun_[A-Za-z0-9_-]+$/.test(sessionRef)) {
    return NextResponse.json(
      {
        status: "failure",
        error: "invalid_session_reference",
        message: "The supplied sessionRef is not a Velnor-owned Blud agent session.",
      },
      { status: 400 }
    );
  }

  const requestOrigin = new URL(request.url).origin;
  const host = env.VERCEL_URL
    ? `https://${env.VERCEL_URL}`
    : requestOrigin;
  // Use the deployment-local Eve API so service identity and session ownership are enforced.
  const client = new Client({
    host,
    auth: { bearer: secret },
    redirect: "error",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);

  let sessionId = sessionRef;
  try {
    const session = sessionRef
      ? client.sessions.attach(sessionRef)
      : (await client.sessions.create()).session;
    sessionId = session.id;

    const summary = message.trim().split(/\s+/u).slice(0, 10).join(" ");
    const assignment = [
      `Task: ${summary}`,
      "",
      "Execute this browser assignment using the run_browser workflow and return its structured completion.",
      message,
      startUrl ? `Start URL: ${startUrl}` : undefined,
      extractSchema
        ? `Requested extraction schema: ${JSON.stringify(extractSchema)}`
        : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n");

    const response = await session.send(assignment, {
      signal: controller.signal,
    });
    const result = await response.result();
    const completion = readTaskCompletion(result.events);

    if (
      result.status !== "completed" ||
      !completion ||
      completion.status !== "success"
    ) {
      return NextResponse.json(
        {
          status: "failure",
          error:
            result.status === "waiting"
              ? "browser_worker_waiting_for_human_input"
              : "browser_worker_did_not_complete_successfully",
          message:
            completion?.message ??
            result.message ??
            "Blud did not return a successful structured browser-worker completion.",
          sessionRef: sessionId,
        },
        { status: 200 }
      );
    }

    const finalUrl = completion.finalUrl;
    if (!finalUrl || !isHttpUrl(finalUrl)) {
      return NextResponse.json(
        {
          status: "failure",
          error: "browser_final_url_missing",
          message:
            "The worker reported success without an observed final HTTP(S) URL.",
          sessionRef: sessionId,
        },
        { status: 200 }
      );
    }

    const runBrowserCall = result.events.findLast(
      (event) =>
        event.type === "call.requested" &&
        event.data.capability.kind === "tool" &&
        event.data.capability.name === "run_browser"
    );
    const runBrowserTaskId = runBrowserCall
      ? result.events.findLast(
          (event) =>
            event.type === "call.started" &&
            event.data.callId === runBrowserCall.data.callId
        )
      : undefined;
    if (
      !runBrowserTaskId ||
      runBrowserTaskId.type !== "call.started" ||
      !runBrowserTaskId.data.taskId
    ) {
      return NextResponse.json(
        {
          status: "failure",
          error: "browser_workflow_receipt_missing",
          message:
            "The completion was not linked to a started run_browser workflow task.",
          sessionRef: sessionId,
        },
        { status: 200 }
      );
    }

    const childStarted = result.events.findLast(
      (event) => event.type === "agent.started"
    );
    if (!childStarted || childStarted.type !== "agent.started") {
      return NextResponse.json(
        {
          status: "failure",
          error: "browser_worker_session_missing",
          message:
            "The run_browser workflow did not expose its browser-agent child session.",
          sessionRef: sessionId,
        },
        { status: 200 }
      );
    }

    const child = session.agent(childStarted);
    const childEvents = [];
    for await (const event of child.stream({ follow: false })) {
      childEvents.push(event);
    }

    const toolNamesByCall = new Map<string, string>();
    const evidenceEvents: Array<{ tool: string; output: unknown }> = [];
    for (const event of childEvents) {
      if (
        event.type === "call.requested" &&
        event.data.capability.kind === "tool"
      ) {
        toolNamesByCall.set(event.data.callId, event.data.capability.name);
      } else if (event.type === "call.settled") {
        const tool = toolNamesByCall.get(event.data.callId);
        if (tool && browserToolNames.has(tool)) {
          evidenceEvents.push({ tool, output: event.data.output });
        }
      }
    }

    const evidenceText = evidenceEvents
      .map(({ output }) => JSON.stringify(output))
      .join("\n");
    const observedUrls = new Set(
      [...evidenceText.matchAll(/https?:\/\/[^\s"'<>]+/gu)].map(
        ([url]) => url.replace(/[),.;]+$/u, "")
      )
    );
    if (evidenceEvents.length === 0 || !observedUrls.has(finalUrl)) {
      return NextResponse.json(
        {
          status: "failure",
          error: "browser_evidence_does_not_confirm_final_url",
          message:
            "The reported final URL was not present in the browser-agent's settled browser-tool evidence.",
          sessionRef: sessionId,
        },
        { status: 200 }
      );
    }

    const evidenceSha256 = createHash("sha256")
      .update(JSON.stringify(evidenceEvents))
      .digest("hex");
    return NextResponse.json({
      status: "success",
      message: completion.message,
      sessionRef: sessionId,
      data: completion.extractedData,
      images: [],
      executionReceipt: {
        taskId: runBrowserTaskId.data.taskId,
        state: "completed",
        completedAtUtc: completion.completedAt,
        finalUrl,
        evidenceSha256,
      },
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return NextResponse.json(
      {
        status: timedOut ? "failure" : "offline",
        error: timedOut ? "browser_execution_timeout" : "browser_runtime_error",
        message:
          error instanceof Error
            ? error.message
            : "The browser runtime failed unexpectedly.",
        sessionRef: sessionId,
      },
      { status: timedOut ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
