import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTask } from "../../runtime/engine";
import type { RuntimeDependencies, RuntimeTask } from "../../runtime/contracts";

function fixture(overrides: Partial<RuntimeDependencies> = {}) {
  const state = { status: "", messages: [] as string[], events: [] as string[] };
  const repository: RuntimeDependencies["repository"] = {
    async create() {},
    async setStatus(_id, status, data) { state.status = status; if (data?.output) state.messages.push(data.output); },
    async appendMessage(_task, message) { state.messages.push(message.content); },
    async readHistory() { return state.messages.map((content, index) => ({ role: index === 0 ? "user" as const : "tool" as const, content })); },
  };
  const dependencies: RuntimeDependencies = {
    repository,
    model: { async *run() { yield { text: "hello", finish: true }; } },
    tools: [],
    policy: { async authorizeTool() { return true; } },
    emit(event) { state.events.push(event.type); },
    ...overrides,
  };
  return { state, dependencies };
}

const task: RuntimeTask = { id: "task-1", sessionId: "session-1", workspaceId: "workspace-1", userId: "user-1", prompt: "Hello" };

describe("BLUD native runtime engine", () => {
  it("persists and emits a successful response", async () => {
    const { state, dependencies } = fixture();
    const result = await executeTask(task, dependencies, new AbortController().signal);
    expect(result).toEqual({ status: "completed", output: "hello" });
    expect(state.status).toBe("completed");
    expect(state.events).toEqual(["task.started", "assistant.delta", "task.completed"]);
  });

  it("rejects duplicate tool names", async () => {
    const tool = { name: "duplicate", description: "", inputSchema: z.object({}), async execute() { return null; } };
    const { dependencies } = fixture({ tools: [tool, tool] });
    await expect(executeTask(task, dependencies, new AbortController().signal)).rejects.toThrow("Duplicate tool name");
  });

  it("denies unauthorized tool calls", async () => {
    const tool = { name: "danger", description: "", inputSchema: z.object({}), async execute() { return "should not run"; } };
    const { state, dependencies } = fixture({
      tools: [tool],
      policy: { async authorizeTool() { return false; } },
      model: { async *run() { yield { toolCalls: [{ id: "call-1", name: "danger", input: {} }] }; yield { finish: true }; } },
    });
    const result = await executeTask(task, dependencies, new AbortController().signal);
    expect(result.status).toBe("failed");
    expect(state.status).toBe("failed");
    expect(state.messages).not.toContain("should not run");
  });

  it("records cancellation when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { state, dependencies } = fixture();
    const result = await executeTask(task, dependencies, controller.signal);
    expect(result.status).toBe("cancelled");
    expect(state.status).toBe("cancelled");
    expect(state.events).toContain("task.cancelled");
  });

  it("persists assistant output between tool rounds", async () => {
    const tool = { name: "echo", description: "", inputSchema: z.object({ value: z.string() }), async execute(input: unknown) { return input; } };
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const { state, dependencies } = fixture({
      tools: [tool],
      model: { async *run({ history }) {
        seen.push(history);
        if (seen.length === 1) {
          yield { text: "I will use a tool.", toolCalls: [{ id: "call-1", name: "echo", input: { value: "ok" } }] };
        } else {
          yield { text: "Done.", finish: true };
        }
      } },
    });
    const result = await executeTask(task, dependencies, new AbortController().signal);
    expect(result.status).toBe("completed");
    expect(state.messages).toContain("I will use a tool.");
    expect(state.messages).toContain("Done.");
    expect(seen.length).toBe(2);
    expect(seen[1].some((entry) => entry.content === "I will use a tool.")).toBe(true);
  });
});
