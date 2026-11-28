/** BLUD-owned orchestration contracts. Provider adapters are deliberately outside the runtime core. */
export type TaskState = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type TaskEvent = { taskId:string; sequence:number; type:string; at:string; data:unknown };
export type TaskRecord = { id:string; workspaceId:string; ownerId:string; state:TaskState; attempts:number; payload:unknown; result?:unknown; error?:string; createdAt:string; updatedAt:string };
export type TaskStore = {
  create(task:TaskRecord):Promise<void>;
  read(id:string, workspaceId:string):Promise<TaskRecord|null>;
  transition(id:string, workspaceId:string, from:TaskState[], to:TaskState, patch?:Partial<TaskRecord>):Promise<boolean>;
  appendEvent(event:TaskEvent):Promise<void>;
  events(id:string, workspaceId:string):Promise<TaskEvent[]>;
};
export type ExecutionContext = { task:TaskRecord; signal:AbortSignal; emit(type:string,data:unknown):Promise<void> };
export type Executor = (context:ExecutionContext)=>Promise<unknown>;
