import { runtimeTaskSchema, type RuntimeContext, type RuntimeDependencies, type RuntimeTask, type RuntimeTool } from "./contracts";

const MAX_STEPS = 12;

export async function executeTask(taskInput: RuntimeTask, dependencies: RuntimeDependencies, signal: AbortSignal) {
  const task = runtimeTaskSchema.parse(taskInput);
  const context: RuntimeContext = { ...task, signal };
  const toolRegistry = new Map<string, RuntimeTool>();
  for (const tool of dependencies.tools) {
    if (toolRegistry.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    toolRegistry.set(tool.name, tool);
  }

  await dependencies.repository.create(task);
  await dependencies.repository.appendMessage(task, { role: "user", content: task.prompt });
  await dependencies.repository.setStatus(task.id, "running");
  await dependencies.emit({ type: "task.started", taskId: task.id, sessionId: task.sessionId });

  try {
    let history = await dependencies.repository.readHistory(task.sessionId);
    let output = "";
    for (let stepNumber = 0; stepNumber < MAX_STEPS; stepNumber += 1) {
      if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
      let sawFinish = false;
      for await (const step of dependencies.model.run({
        prompt: task.prompt,
        history,
        tools: [...toolRegistry.values()].map((tool) => ({ name: tool.name, description: tool.description, schema: tool.inputSchema })),
        signal,
      })) {
        if (signal.aborted) throw new DOMException("Task cancelled", "AbortError");
        if (step.text) {
          output += step.text;
          await dependencies.emit({ type: "assistant.delta", taskId: task.id, text: step.text });
        }
        for (const call of step.toolCalls ?? []) {
          const tool = toolRegistry.get(call.name);
          if (!tool) throw new Error(`Model requested unknown tool: ${call.name}`);
          const parsedInput = tool.inputSchema.parse(call.input);
          if (!(await dependencies.policy.authorizeTool(context, tool, parsedInput))) {
            throw new Error(`Tool permission denied: ${tool.name}`);
          }
          await dependencies.emit({ type: "tool.started", taskId: task.id, toolName: tool.name, invocationId: call.id });
          try {
            const result = await tool.execute(parsedInput, context);
            const content = JSON.stringify(result);
            history = [...history, { role: "tool", content }];
            await dependencies.repository.appendMessage(task, { role: "tool", content });
            await dependencies.emit({ type: "tool.completed", taskId: task.id, invocationId: call.id, result });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Tool execution failed";
            await dependencies.emit({ type: "tool.failed", taskId: task.id, invocationId: call.id, error: message });
            throw error;
          }
        }
        if (step.finish) sawFinish = true;
      }
      if (sawFinish || !toolRegistry.size) break;
      if (stepNumber === MAX_STEPS - 1) throw new Error("Maximum runtime step count exceeded");
      history = await dependencies.repository.readHistory(task.sessionId);
    }

    await dependencies.repository.appendMessage(task, { role: "assistant", content: output });
    await dependencies.repository.setStatus(task.id, "completed", { output });
    await dependencies.emit({ type: "task.completed", taskId: task.id, output });
    return { status: "completed" as const, output };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      await dependencies.repository.setStatus(task.id, "cancelled");
      await dependencies.emit({ type: "task.cancelled", taskId: task.id });
      return { status: "cancelled" as const };
    }
    const message = error instanceof Error ? error.message : "Task failed";
    await dependencies.repository.setStatus(task.id, "failed", { error: message });
    await dependencies.emit({ type: "task.failed", taskId: task.id, error: message });
    return { status: "failed" as const, error: message };
  }
}
