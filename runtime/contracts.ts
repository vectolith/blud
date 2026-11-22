import { z } from "zod";

export const runtimeTaskSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  prompt: z.string().trim().min(1),
});
export type RuntimeTask = z.infer<typeof runtimeTaskSchema>;

export const runtimeStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task.started"),
    taskId: z.string(),
    sessionId: z.string(),
  }),
  z.object({ type: z.literal("assistant.delta"), taskId: z.string(), text: z.string() }),
  z.object({
    type: z.literal("tool.started"),
    taskId: z.string(),
    toolName: z.string(),
    invocationId: z.string(),
  }),
  z.object({
    type: z.literal("tool.completed"),
    taskId: z.string(),
    invocationId: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("tool.failed"),
    taskId: z.string(),
    invocationId: z.string(),
    error: z.string(),
  }),
  z.object({ type: z.literal("task.completed"), taskId: z.string(), output: z.string() }),
  z.object({ type: z.literal("task.failed"), taskId: z.string(), error: z.string() }),
  z.object({ type: z.literal("task.cancelled"), taskId: z.string() }),
]);
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

export type RuntimeTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute(input: unknown, context: RuntimeContext): Promise<unknown>;
};

export type RuntimeContext = Pick<
  RuntimeTask,
  "id" | "sessionId" | "workspaceId" | "userId"
> & {
  signal: AbortSignal;
};

export type RuntimeToolCall = { id: string; name: string; input: unknown };
export type RuntimeModelStep = { text?: string; toolCalls?: RuntimeToolCall[]; finish?: boolean };

export type RuntimeModel = {
  run(input: {
    prompt: string;
    history: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
    tools: Array<{ name: string; description: string; schema: unknown }>;
    signal: AbortSignal;
  }): AsyncIterable<RuntimeModelStep>;
};

export type RuntimeRepository = {
  create(task: RuntimeTask): Promise<void>;
  setStatus(
    task: RuntimeTask,
    status: RuntimeStatus,
    data?: { output?: string; error?: string }
  ): Promise<void>;
  appendMessage(
    task: RuntimeTask,
    message: { role: "user" | "assistant" | "tool"; content: string }
  ): Promise<void>;
  readHistory(
    task: RuntimeTask
  ): Promise<Array<{ role: "user" | "assistant" | "tool"; content: string }>>;
};

export type RuntimePolicy = {
  authorizeTool(context: RuntimeContext, tool: RuntimeTool, input: unknown): Promise<boolean>;
};

export type RuntimeDependencies = {
  repository: RuntimeRepository;
  model: RuntimeModel;
  tools: readonly RuntimeTool[];
  policy: RuntimePolicy;
  emit(event: RuntimeEvent): Promise<void> | void;
};
