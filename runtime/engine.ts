import {
  runtimeTaskSchema,
  type RuntimeContext,
  type RuntimeDependencies,
  type RuntimeTask,
  type RuntimeTool,
  type RuntimeToolCall,
} from "./contracts";

const MAX_STEPS = 12;

export async function executeTask(
  taskInput: RuntimeTask,
  dependencies: RuntimeDependencies,
  signal: AbortSignal
) {
  const task = runtimeTaskSchema.parse(taskInput);
  const context: RuntimeContext = { ...task, signal };
  let taskCreated = false;

  try {
    await dependencies.repository.create(task);
    taskCreated = true;

    const toolRegistry = new Map<string, RuntimeTool>();
    for (const tool of dependencies.tools) {
      if (!tool.name.trim()) throw new Error("Tool names must be non-empty");
      if (toolRegistry.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      toolRegistry.set(tool.name, tool);
    }

    if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
    await dependencies.repository.appendMessage(task, { role: "user", content: task.prompt });
    await dependencies.repository.setStatus(task, "running");
    await dependencies.emit({ type: "task.started", taskId: task.id, sessionId: task.sessionId });

    let history = await dependencies.repository.readHistory(task);
    let output = "";

    for (let stepNumber = 0; stepNumber < MAX_STEPS; stepNumber += 1) {
      if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");

      let roundText = "";
      const pendingCalls: RuntimeToolCall[] = [];
      for await (const step of dependencies.model.run({
        prompt: task.prompt,
        history,
        tools: [...toolRegistry.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          schema: tool.inputSchema,
        })),
        signal,
      })) {
        if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
        if (step.text) {
          roundText += step.text;
          output += step.text;
          await dependencies.emit({ type: "assistant.delta", taskId: task.id, text: step.text });
        }
        pendingCalls.push(...(step.toolCalls ?? []));
      }

      // Preserve the assistant turn and tool-call intent before tool results.
      if (roundText || pendingCalls.length) {
        const content = pendingCalls.length
          ? JSON.stringify({ text: roundText, toolCalls: pendingCalls })
          : roundText;
        await dependencies.repository.appendMessage(task, { role: "assistant", content });
      }
      history = await dependencies.repository.readHistory(task);

      const invocationIds = new Set<string>();
      for (const call of pendingCalls) {
        if (!call.id?.trim()) throw new Error("Tool invocation ID must be non-empty");
        if (invocationIds.has(call.id)) {
          throw new Error(`Duplicate tool invocation ID: ${call.id}`);
        }
        invocationIds.add(call.id);
      }

      for (const call of pendingCalls) {
        if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
        const tool = toolRegistry.get(call.name);
        if (!tool) throw new Error(`Model requested unknown tool: ${call.name}`);

        const parsedInput = tool.inputSchema.parse(call.input);
        if (!(await dependencies.policy.authorizeTool(context, tool, parsedInput))) {
          throw new Error(`Tool permission denied: ${tool.name}`);
        }

        await dependencies.emit({
          type: "tool.started",
          taskId: task.id,
          toolName: tool.name,
          invocationId: call.id,
        });
        try {
          const result = await tool.execute(parsedInput, context);
          const content =
            JSON.stringify({ invocationId: call.id, toolName: tool.name, result }) ?? "null";
          await dependencies.repository.appendMessage(task, { role: "tool", content });
          history = await dependencies.repository.readHistory(task);
          await dependencies.emit({
            type: "tool.completed",
            taskId: task.id,
            invocationId: call.id,
            result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool execution failed";
          await dependencies.emit({
            type: "tool.failed",
            taskId: task.id,
            invocationId: call.id,
            error: message,
          });
          throw error;
        }
      }

      // A plain assistant response is complete; tools do not force another model call.
      if (pendingCalls.length === 0) break;
      if (stepNumber === MAX_STEPS - 1) {
        throw new Error("Maximum runtime step count exceeded");
      }
      history = await dependencies.repository.readHistory(task);
    }

    await dependencies.repository.setStatus(task, "completed", { output });
    await dependencies.emit({ type: "task.completed", taskId: task.id, output });
    return { status: "completed" as const, output };
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof Error && error.name === "AbortError");
    const message = error instanceof Error ? error.message : "Task failed";

    if (taskCreated) {
      try {
        await dependencies.repository.setStatus(
          task,
          cancelled ? "cancelled" : "failed",
          cancelled ? undefined : { error: message }
        );
      } catch {
        // Preserve the task result when the repository cannot record the failure.
      }
    }

    try {
      await dependencies.emit(
        cancelled
          ? { type: "task.cancelled", taskId: task.id }
          : { type: "task.failed", taskId: task.id, error: message }
      );
    } catch {
      // Event delivery is best-effort here; durable event delivery is not implemented yet.
    }

    return cancelled ? { status: "cancelled" as const } : { status: "failed" as const, error: message };
  }
}
