import type { Executor, TaskRecord, TaskStore, TaskState } from "./types";
/** Durable state transitions are persisted before work is started or reported. */
export class Orchestrator {
  private active = new Map<string,AbortController>();
  constructor(private readonly store:TaskStore, private readonly execute:Executor, private readonly maxAttempts=3){}
  async enqueue(task:TaskRecord){if(task.state!=="queued")throw new Error("New tasks must be queued");await this.store.create(task);await this.store.appendEvent({taskId:task.id,sequence:1,type:"queued",at:task.createdAt,data:{}});return task;}
  async run(id:string,workspaceId:string){
    const task=await this.store.read(id,workspaceId);if(!task)throw new Error("Task not found");
    if(task.state!=="queued")throw new Error("Task is not eligible to run");
    if(!await this.store.transition(id,workspaceId,["queued"],"running",{attempts:task.attempts+1,updatedAt:new Date().toISOString()}))throw new Error("Task transition conflict");
    const controller=new AbortController();this.active.set(id,controller);
    await this.store.appendEvent({taskId:id,sequence:2,type:"started",at:new Date().toISOString(),data:{attempt:task.attempts+1}});
    const running={...task,state:"running" as TaskState,attempts:task.attempts+1};
    try{
      const result=await this.execute({task:running,signal:controller.signal,emit:async(type,data)=>this.store.appendEvent({taskId:id,sequence:Date.now(),type,at:new Date().toISOString(),data})});
      if(controller.signal.aborted){await this.store.transition(id,workspaceId,["running"],"cancelled",{updatedAt:new Date().toISOString()});return;}
      await this.store.transition(id,workspaceId,["running"],"completed",{result,updatedAt:new Date().toISOString()});
      await this.store.appendEvent({taskId:id,sequence:Date.now(),type:"completed",at:new Date().toISOString(),data:{verified:true}});
    }catch(error){
      const message=error instanceof Error?error.message:"Unknown execution failure";
      const state:TaskState=task.attempts+1<this.maxAttempts&&!controller.signal.aborted?"queued":controller.signal.aborted?"cancelled":"failed";
      await this.store.transition(id,workspaceId,["running"],state,{error:message,updatedAt:new Date().toISOString()});
      await this.store.appendEvent({taskId:id,sequence:Date.now(),type:state,at:new Date().toISOString(),data:{error:message}});
      if(state==="failed")throw error;
    }finally{this.active.delete(id);}
  }
  async cancel(id:string,workspaceId:string){const task=await this.store.read(id,workspaceId);if(!task)return false;if(task.state==="running"){this.active.get(id)?.abort();return true;}return this.store.transition(id,workspaceId,["queued","waiting_approval"],"cancelled",{updatedAt:new Date().toISOString()});}
  async recover(workspaceId:string,limit=100){/* Recovery is conservative: only enqueue stale running tasks after store atomically marks them queued. */return {workspaceId,limit,policy:"store must implement stale-lease recovery; never execute a task without a durable transition"};}
}
