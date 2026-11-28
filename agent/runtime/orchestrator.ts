import type { Executor, TaskRecord, TaskStore, TaskState } from "./types";

/** Executes tasks only after durable, conditional state transitions succeed. */
export class Orchestrator {
  private active = new Map<string, AbortController>();

  constructor(
    private readonly store: TaskStore,
    private readonly execute: Executor,
    private readonly maxAttempts = 3,
  ) {}

  async enqueue(task: TaskRecord) {
    if (task.state !== "queued") throw new Error("New tasks must be queued");
    await this.store.create(task);
    await this.store.appendEvent({
      taskId: task.id,
      sequence: 1,
      type: "queued",
      at: task.createdAt,
      data: {},
    });
    return task;
  }

  async run(id: string, workspaceId: string) {
    const task = await this.store.read(id, workspaceId);
    if (!task) throw new Error("Task not found");
    if (task.state !== "queued") throw new Error("Task is not eligible to run");

    const updatedAt = new Date().toISOString();
    if (
      !await this.store.transition(id, workspaceId, ["queued"], "running", {
        attempts: task.attempts + 1,
        updatedAt,
      })
    ) {
      throw new Error("Task transition conflict");
    }

    const controller = new AbortController();
    this.active.set(id, controller);
    const running = {
      ...task,
      state: "running" as const,
      attempts: task.attempts + 1,
      updatedAt,
    };

    try {
      await this.store.appendEvent({
        taskId: id,
        sequence: 0,
        type: "started",
        at: updatedAt,
        data: { attempt: running.attempts },
      });
      const result = await this.execute({
        task: running,
        signal: controller.signal,
        emit: async (type, data) =>
          this.store.appendEvent({
            taskId: id,
            sequence: 0,
            type,
            at: new Date().toISOString(),
            data,
          }),
      });

      if (controller.signal.aborted) {
        if (
          !await this.store.transition(id, workspaceId, ["running"], "cancelled", {
            updatedAt: new Date().toISOString(),
          })
        ) {
          throw new Error("Cancellation transition conflict");
        }
        await this.store.appendEvent({
          taskId: id,
          sequence: 0,
          type: "cancelled",
          at: new Date().toISOString(),
          data: {},
        });
        return;
      }

      if (
        !await this.store.transition(id, workspaceId, ["running"], "completed", {
          result,
          updatedAt: new Date().toISOString(),
        })
      ) {
        throw new Error("Completion transition conflict");
      }
      await this.store.appendEvent({
        taskId: id,
        sequence: 0,
        type: "completed",
        at: new Date().toISOString(),
        data: { resultPersisted: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown execution failure";
      const state: TaskState = controller.signal.aborted
        ? "cancelled"
        : running.attempts < this.maxAttempts
          ? "queued"
          : "failed";
      const transition = await this.store.transition(id, workspaceId, ["running"], state, {
        error: message,
        updatedAt: new Date().toISOString(),
      });
      if (transition) {
        await this.store.appendEvent({
          taskId: id,
          sequence: 0,
          type: state,
          at: new Date().toISOString(),
          data: { error: message },
        });
      }
      if (state === "failed") throw error;
      if (!transition) throw new Error("Failure state transition conflict", { cause: error });
    } finally {
      this.active.delete(id);
    }
  }

  async cancel(id: string, workspaceId: string) {
    const task = await this.store.read(id, workspaceId);
    if (!task) return false;
    if (task.state === "running") {
      const controller = this.active.get(id);
      if (!controller) return false;
      controller.abort();
      return true;
    }
    const cancelled = await this.store.transition(
      id,
      workspaceId,
      ["queued", "waiting_approval"],
      "cancelled",
      { updatedAt: new Date().toISOString() },
    );
    if (cancelled) {
      await this.store.appendEvent({
        taskId: id,
        sequence: 0,
        type: "cancelled",
        at: new Date().toISOString(),
        data: {},
      });
    }
    return cancelled;
  }

  async recover(_workspaceId: string, _limit = 100): Promise<never> {
    throw new Error(
      "Recovery is not implemented: refusing to report recovered work until lease-safe recovery exists",
    );
  }
}
