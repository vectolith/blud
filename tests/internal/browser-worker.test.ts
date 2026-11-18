import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

interface ClientOptions {
  baseUrl: string;
  auth: { bearer: string };
  redirect: "error";
}

interface TestWorkerCompletion {
  status: "success";
  message: string;
  images: [];
  finalUrl: string;
  extractedData?: { title: string | number };
}

interface TestBrowserToolOutput {
  content: { type: "text"; text: string }[];
}

type TestTaskOutput = TestWorkerCompletion | TestBrowserToolOutput;

interface TestEventData {
  callId?: string;
  capability?: { kind: "tool"; name: string };
  input?: { message: string };
  owner?: { runId: string };
  taskId?: string;
  name?: string;
  sessionId?: string;
  streamPath?: string;
  outcome?: "completed";
  output?: TestTaskOutput;
}

interface TestRuntimeEvent {
  type: string;
  data: TestEventData;
  meta: { at: string };
}

interface TestRuntimeResult {
  status: "completed" | "waiting" | "failed";
  message?: string;
  events: TestRuntimeEvent[];
}

interface TestSession {
  id: string;
  send: (
    message: string,
    options: { signal: AbortSignal }
  ) => Promise<{ result: () => Promise<TestRuntimeResult> }>;
  stream: (options: { follow: false }) => AsyncIterable<TestRuntimeEvent>;
}

const mocks = vi.hoisted(() => ({
  create: vi.fn<() => Promise<{ session: TestSession }>>(),
  attach: vi.fn<(sessionId: string) => TestSession>(),
  send: vi.fn<TestSession["send"]>(),
  result: vi.fn<() => Promise<TestRuntimeResult>>(),
  stream: vi.fn<TestSession["stream"]>(),
  clientOptions: new Array<ClientOptions>(),
}));

vi.mock("eve/client", () => ({
  Client: class {
    sessions = { create: mocks.create, attach: mocks.attach };

    constructor(options: ClientOptions) {
      mocks.clientOptions.push(options);
    }
  },
}));

const serviceSecret = "test-auth-secret-0123456789abcdefghijklmnop";
const responseBodySchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  data: z.record(z.string(), z.string()).optional(),
  sessionRef: z.string().optional(),
  executionReceipt: z
    .object({
      taskId: z.string(),
      state: z.literal("completed"),
      completedAtUtc: z.string(),
      finalUrl: z.string(),
      evidenceSha256: z.string(),
    })
    .optional(),
});

let post: (request: Request) => Promise<Response>;
let session: TestSession;
let childSession: TestSession;

async function loadPost() {
  vi.resetModules();
  const route = await import("@app/api/internal/browser-worker/route");
  post = route.POST;
}

async function responseBody(response: Response) {
  const rawBody: unknown = await response.json();
  return responseBodySchema.parse(rawBody);
}

function request(body: string, token = serviceSecret) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token.length > 0) headers.set("x-blud-key", token);
  return new Request("http://localhost:3000/api/internal/browser-worker", {
    method: "POST",
    headers,
    body,
  });
}

function successfulRuntimeResult(
  finalUrl = "https://example.com/",
  extractedData: { title: string } | null = { title: "Example Domain" }
): TestRuntimeResult {
  const completionOutput: TestWorkerCompletion = {
    status: "success",
    message: "Verified the page title.",
    images: [],
    finalUrl,
  };
  if (extractedData !== null) {
    completionOutput.extractedData = extractedData;
  }

  return {
    status: "completed",
    message: "Browser assignment completed.",
    events: [
      {
        type: "call.requested",
        data: {
          callId: "run-browser-call",
          capability: { kind: "tool", name: "run_browser" },
          input: { message: "Inspect Example" },
          owner: { runId: "run_1" },
        },
        meta: { at: "2026-11-18T10:00:00.000Z" },
      },
      {
        type: "call.started",
        data: {
          callId: "run-browser-call",
          taskId: "browser-task-1",
        },
        meta: { at: "2026-11-18T10:00:00.000Z" },
      },
      {
        type: "agent.started",
        data: {
          name: "browser-agent",
          sessionId: "browser-agent-session",
          streamPath: "/eve/v1/session/browser-agent-session/stream",
        },
        meta: { at: "2026-11-18T10:00:00.000Z" },
      },
      {
        type: "call.settled",
        data: {
          callId: "run-browser-call",
          outcome: "completed",
          output: completionOutput,
        },
        meta: { at: "2026-11-18T10:00:00.000Z" },
      },
    ],
  };
}

// These tests validate the service boundary without invoking a real browser provider.
describe("Internal Blud Browser Worker RPC", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.clientOptions.length = 0;
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@example.com/database"
    );
    vi.stubEnv("BLUD_INTERNAL_KEY", serviceSecret);
    vi.stubEnv("VELNOR_SHARED_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("KERNEL_API_KEY", "configured-kernel-key");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");

    session = {
      id: "wrun_internal_1",
      send: mocks.send,
      stream: mocks.stream,
    };
    childSession = {
      id: "browser-agent-session",
      send: mocks.send,
      stream: mocks.stream,
    };
    mocks.create.mockResolvedValue({ session });
    mocks.attach.mockImplementation((sessionId) =>
      sessionId === childSession.id ? childSession : session
    );
    mocks.send.mockResolvedValue({ result: mocks.result });
    mocks.result.mockResolvedValue(successfulRuntimeResult());
    mocks.stream.mockImplementation(async function* () {
      yield {
        type: "call.requested",
        data: {
          callId: "snapshot-call",
          capability: { kind: "tool", name: "browser_snapshot" },
        },
        meta: { at: "2026-11-18T10:00:00.000Z" },
      };
      yield {
        type: "call.settled",
        data: {
          callId: "snapshot-call",
          outcome: "completed",
          output: {
            content: [
              {
                type: "text",
                text: "Page title: Example Domain\nURL: https://example.com/",
              },
            ],
          },
        },
        meta: { at: "2026-11-18T10:00:01.000Z" },
      };
    });
    await loadPost();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when service authentication is missing", async () => {
    vi.stubEnv("BLUD_INTERNAL_KEY", "");
    vi.stubEnv("VELNOR_SHARED_SECRET", "");
    await loadPost();

    const res = await post(
      request(JSON.stringify({ message: "test", caller: "velnor" }))
    );
    expect(res.status).toBe(503);
    const body = await responseBody(res);
    expect(body.status).toBe("offline");
    expect(body.error).toBe("internal_service_auth_not_configured");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed when the configured Eve origin is missing", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    await loadPost();

    const res = await post(
      request(JSON.stringify({ message: "test", caller: "velnor" }))
    );
    const body = await responseBody(res);
    expect(res.status).toBe(503);
    expect(body.status).toBe("offline");
    expect(body.error).toBe("eve_runtime_origin_not_configured");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid internal service key", async () => {
    const res = await post(
      request(
        JSON.stringify({ message: "test", caller: "velnor" }),
        "wrong-secret"
      )
    );
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON after authentication", async () => {
    const res = await post(request("{"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid browser delegation payload", async () => {
    const res = await post(request(JSON.stringify({})));
    expect(res.status).toBe(400);
  });

  it("does not issue a success receipt without a settled run_browser task", async () => {
    mocks.result.mockResolvedValue({
      status: "completed",
      message: "No browser workflow was executed.",
      events: [],
    });
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(200);
    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_worker_did_not_complete_successfully");
    expect(body.executionReceipt).toBeUndefined();
  });

  it("dispatches into Eve and returns a receipt bound to settled browser evidence", async () => {
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          startUrl: "https://example.com",
          extractSchema: { title: "string" },
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(200);
    const body = await responseBody(res);
    expect(body.status).toBe("success");
    expect(body.sessionRef).toBe("wrun_internal_1");
    expect(body.executionReceipt).toMatchObject({
      taskId: "browser-task-1",
      state: "completed",
      finalUrl: "https://example.com/",
      completedAtUtc: "2026-11-18T10:00:00.000Z",
    });
    expect(body.executionReceipt?.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data).toEqual({ title: "Example Domain" });
    const expectedClientOptions: ClientOptions = {
      baseUrl: "http://localhost:3000",
      auth: { bearer: serviceSecret },
      redirect: "error",
    };
    expect(mocks.clientOptions).toContainEqual(expectedClientOptions);
    const sentCall = mocks.send.mock.calls[0];
    expect(sentCall?.[0]).toContain("Start URL: https://example.com");
    expect(sentCall?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(mocks.attach).toHaveBeenCalledWith("browser-agent-session");
  });

  it("rejects non-HTTP final URLs even when the worker reports success", async () => {
    mocks.result.mockResolvedValue(
      successfulRuntimeResult("javascript:alert(1)")
    );
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(200);
    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_final_url_missing");
    expect(body.executionReceipt).toBeUndefined();
  });

  it("rejects a model-reported final URL absent from settled browser evidence", async () => {
    mocks.result.mockResolvedValue(
      successfulRuntimeResult("https://other.example/")
    );
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(200);
    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_evidence_does_not_confirm_final_url");
    expect(body.executionReceipt).toBeUndefined();
  });

  it("rejects extracted values that do not appear in settled browser evidence", async () => {
    const result = successfulRuntimeResult();
    const completionEvent = result.events.find(
      (event) => event.type === "call.settled"
    );
    const output = completionEvent?.data.output;
    if (!output || !("status" in output)) {
      throw new Error("The test worker completion event is missing.");
    }
    output.extractedData = { title: "A fabricated page title" };
    mocks.result.mockResolvedValue(result);
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          extractSchema: { title: "string" },
          caller: "velnor",
        })
      )
    );

    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_extraction_not_grounded_in_tool_evidence");
    expect(body.executionReceipt).toBeUndefined();
  });

  it("rejects a missing extraction when an extraction schema was requested", async () => {
    const result = successfulRuntimeResult();
    const completionEvent = result.events.find(
      (event) => event.type === "call.settled"
    );
    const output = completionEvent?.data.output;
    if (!output || !("status" in output)) {
      throw new Error("The test worker completion event is missing.");
    }
    delete output.extractedData;
    mocks.result.mockResolvedValue(result);
    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          extractSchema: { title: "string" },
          caller: "velnor",
        })
      )
    );

    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_extraction_not_grounded_in_tool_evidence");
  });

  it("rejects extraction values that do not match the requested field type", async () => {
    const result = successfulRuntimeResult();
    const completionEvent = result.events.find(
      (event) => event.type === "call.settled"
    );
    const output = completionEvent?.data.output;
    if (!output || !("status" in output)) {
      throw new Error("The test worker completion event is missing.");
    }
    output.extractedData = { title: 123 };
    mocks.result.mockResolvedValue(result);

    const res = await post(
      request(
        JSON.stringify({
          message: "Verify the page title",
          extractSchema: { title: "string" },
          caller: "velnor",
        })
      )
    );

    const body = await responseBody(res);
    expect(body.status).toBe("failure");
    expect(body.error).toBe("browser_extraction_not_grounded_in_tool_evidence");
  });

  it("can resume only a Velnor-owned Eve session reference", async () => {
    const res = await post(
      request(
        JSON.stringify({
          message: "Continue the page inspection",
          sessionRef: "wrun_existing_123",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(200);
    expect(mocks.attach).toHaveBeenCalledWith("wrun_existing_123");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects non-Eve session references before dispatch", async () => {
    const res = await post(
      request(
        JSON.stringify({
          message: "Continue the page inspection",
          sessionRef: "kernel-browser-session",
          caller: "velnor",
        })
      )
    );

    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});
