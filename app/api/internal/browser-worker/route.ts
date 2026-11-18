import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Client } from "eve/client";
import { z } from "zod";
import { taskCompletionOutputSchema } from "@shared/browser/task-completion";
import { env } from "@shared/environment/env";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ExtractionType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

type ParsedJsonValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "null"; value: null }
  | { kind: "array"; value: ParsedJsonValue[] }
  | { kind: "object"; value: Record<string, ParsedJsonValue> };

const parsedJsonValueSchema: z.ZodType<ParsedJsonValue> = z.lazy(() =>
  z.union([
    z.string().transform((value) => ({ kind: "string" as const, value })),
    z.number().transform((value) => ({ kind: "number" as const, value })),
    z.boolean().transform((value) => ({ kind: "boolean" as const, value })),
    z.null().transform((value) => ({ kind: "null" as const, value })),
    z
      .array(parsedJsonValueSchema)
      .transform((value) => ({ kind: "array" as const, value })),
    z
      .record(z.string(), parsedJsonValueSchema)
      .transform((value) => ({ kind: "object" as const, value })),
  ])
);

const extractionSchema = z.record(z.string(), parsedJsonValueSchema);
const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(8_000),
    startUrl: z.url().optional(),
    sessionRef: z.string().min(1).optional(),
    extractSchema: z
      .record(
        z.string(),
        z.enum(["string", "number", "integer", "boolean", "array", "object", "null"])
      )
      .refine((schema) => Object.keys(schema).length > 0)
      .optional(),
    caller: z.literal("velnor"),
  })
  .strict();

const runtimeEventSchema = z
  .object({
    type: z.string(),
    data: z.unknown(),
    meta: z.object({ at: z.string() }).loose(),
  })
  .loose();

const runtimeResultSchema = z.object({
  status: z.enum(["completed", "waiting", "failed"]),
  message: z.string().optional(),
  events: z.array(runtimeEventSchema),
});

const callRequestedSchema = z.object({
  callId: z.string().min(1),
  capability: z.object({
    kind: z.literal("tool"),
    name: z.string().min(1),
  }),
});

const callStartedSchema = z.object({
  callId: z.string().min(1),
  taskId: z.string().min(1),
});

const callSettledSchema = z.object({
  callId: z.string().min(1),
  outcome: z.string(),
  output: z.unknown(),
});

const agentStartedSchema = z.object({
  sessionId: z.string().min(1),
});

const browserToolNames = new Set([
  "browser_snapshot",
  "browser_text",
  "browser_find",
  "browser_wait_for",
  "browser_act",
  "playwright_execute",
  "computer_action",
]);

type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

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
    timingSafeEqual(tokenBytes, expectedBytes)
  );
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
        message:
          "The supplied sessionRef is not a Velnor-owned Blud agent session.",
      },
      { status: 400 }
    );
  }

  const host = env.VERCEL_URL
    ? `https://${env.VERCEL_URL}`
    : env.BETTER_AUTH_URL;
  if (!host) {
    return NextResponse.json(
      {
        status: "offline",
        error: "eve_runtime_origin_not_configured",
        message: "Blud's authenticated Eve runtime origin is not configured.",
      },
      { status: 503 }
    );
  }

  // Use the configured application origin so Eve enforces service identity and session ownership.
  const client = new Client({
    baseUrl: host,
    auth: { bearer: secret },
    redirect: "error",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 165_000);

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
    const rawResult: unknown = await response.result();
    const result = runtimeResultSchema.parse(rawResult);
    const completion = findRunBrowserCompletion(result.events);

    if (result.status !== "completed" || completion?.status !== "success") {
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

    const childStarted = result.events.findLast(
      (event) => event.type === "agent.started"
    );
    const childSessionId = childStarted
      ? agentStartedSchema.parse(childStarted.data).sessionId
      : undefined;
    if (!childSessionId) {
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

    const childSession = client.sessions.attach(childSessionId);
    const childEvents: RuntimeEvent[] = [];
    for await (const rawEvent of childSession.stream({ follow: false })) {
      childEvents.push(runtimeEventSchema.parse(rawEvent));
    }

    const toolNamesByCall = new Map<string, string>();
    const evidenceEvents: { tool: string; output: unknown }[] = [];
    for (const event of childEvents) {
      if (event.type === "call.requested") {
        const call = callRequestedSchema.safeParse(event.data);
        if (call.success) {
          toolNamesByCall.set(call.data.callId, call.data.capability.name);
        }
      } else if (event.type === "call.settled") {
        const call = callSettledSchema.safeParse(event.data);
        if (!call.success) continue;
        const tool = toolNamesByCall.get(call.data.callId);
        if (tool && browserToolNames.has(tool)) {
          evidenceEvents.push({ tool, output: call.data.output });
        }
      }
    }

    const evidenceText = evidenceEvents
      .map(({ output }) => JSON.stringify(output))
      .join("\n");
    const observedUrls = new Set(
      [...evidenceText.matchAll(/https?:\/\/[^\s"'<>]+/gu)].map(([url]) =>
        url.replace(/[),.;]+$/u, "")
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

    const parsedExtraction =
      completion.extractedData === undefined
        ? undefined
        : extractionSchema.safeParse(completion.extractedData);
    const extractionInvalid =
      (extractSchema !== undefined &&
        (!parsedExtraction?.success ||
          !matchesExtractionSchema(parsedExtraction.data, extractSchema))) ||
      (completion.extractedData !== undefined &&
        (!parsedExtraction?.success ||
          !isExtractionGrounded(parsedExtraction.data, evidenceText)));
    if (extractionInvalid) {
      return NextResponse.json(
        {
          status: "failure",
          error: "browser_extraction_not_grounded_in_tool_evidence",
          message:
            "The requested extraction was missing, did not match its field schema, or contained values not observed in settled browser-tool output.",
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
      data: parsedExtraction?.success
        ? serializeExtractionData(parsedExtraction.data)
        : undefined,
      images: [],
      executionReceipt: {
        taskId: completion.taskId,
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

function findRunBrowserCompletion(events: RuntimeEvent[]) {
  const runBrowserCalls = new Set<string>();
  const taskIds = new Map<string, string>();
  let completion:
    | (z.infer<typeof taskCompletionOutputSchema> & {
        taskId: string;
        completedAt: string;
      })
    | undefined;

  for (const event of events) {
    if (event.type === "call.requested") {
      const call = callRequestedSchema.safeParse(event.data);
      if (call.success && call.data.capability.name === "run_browser") {
        runBrowserCalls.add(call.data.callId);
      }
      continue;
    }

    if (event.type === "call.started") {
      const call = callStartedSchema.safeParse(event.data);
      if (call.success && runBrowserCalls.has(call.data.callId)) {
        taskIds.set(call.data.callId, call.data.taskId);
      }
      continue;
    }

    if (event.type !== "call.settled") continue;
    const call = callSettledSchema.safeParse(event.data);
    if (!call.success || call.data.outcome !== "completed") continue;
    const taskId = taskIds.get(call.data.callId);
    if (!taskId || !runBrowserCalls.has(call.data.callId)) continue;
    const parsed = taskCompletionOutputSchema.safeParse(call.data.output);
    if (parsed.success) {
      completion = {
        ...parsed.data,
        taskId,
        completedAt: event.meta.at,
      };
    }
  }

  return completion;
}

// Validate extracted values against the schema supplied by the caller.
function matchesExtractionSchema(
  data: Record<string, JsonValue>,
  schema: Record<string, JsonValue>
): boolean {
  const fields = Object.entries(schema);
  return (
    fields.length > 0 &&
    fields.every(([field, definition]) => {
      if (!(field in data)) return false;

      const stringDefinition = z.string().safeParse(definition);
      let expectedType: string | undefined;
      if (stringDefinition.success) {
        expectedType = stringDefinition.data;
      } else {
        const objectDefinition = z
          .object({ type: z.string().optional() })
          .loose()
          .safeParse(definition);
        if (!objectDefinition.success) return false;
        expectedType = objectDefinition.data.type;
      }

      if (!expectedType) return false;
      const value = data[field];

      switch (expectedType) {
        case "string":
          return z.string().safeParse(value).success;
        case "number":
          return z.number().safeParse(value).success;
        case "integer": {
          const parsedNumber = z.number().safeParse(value);
          return parsedNumber.success && Number.isInteger(parsedNumber.data);
        }
        case "boolean":
          return z.boolean().safeParse(value).success;
        case "array":
          return z.array(z.json()).safeParse(value).success;
        case "object":
          return z.record(z.string(), z.json()).safeParse(value).success;
        case "null":
          return value === null;
        default:
          return false;
      }
    })
  );
}

function isExtractionGrounded(
  value: Record<string, JsonValue>,
  evidenceText: string
): boolean {
  const observedValues: string[] = [];

  function collect(candidate: JsonValue) {
    const parsedString = z.string().safeParse(candidate);
    if (parsedString.success) {
      if (parsedString.data.length > 0) observedValues.push(parsedString.data);
      return;
    }

    const parsedNumber = z.number().safeParse(candidate);
    if (parsedNumber.success) {
      observedValues.push(String(parsedNumber.data));
      return;
    }

    const parsedBoolean = z.boolean().safeParse(candidate);
    if (parsedBoolean.success) {
      observedValues.push(String(parsedBoolean.data));
      return;
    }

    const parsedArray = z.array(z.json()).safeParse(candidate);
    if (parsedArray.success) {
      for (const item of parsedArray.data) collect(item);
      return;
    }

    const parsedObject = z.record(z.string(), z.json()).safeParse(candidate);
    if (parsedObject.success) {
      for (const item of Object.values(parsedObject.data)) collect(item);
    }
  }

  collect(value);
  return observedValues.every((observed) => evidenceText.includes(observed));
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
