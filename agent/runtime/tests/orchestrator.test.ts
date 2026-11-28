import { describe,it,expect,vi } from "vitest";
import { Orchestrator } from "../orchestrator";
import type { TaskRecord,TaskStore,TaskEvent } from "../types";
function store():TaskStore{
 const records=new Map<string,TaskRecord>();const events:TaskEvent[]=[];
 return {create:async(t)=>{records.set(t.id,t)},read:async(id,w)=>records.get(id)?.workspaceId===w?records.get(id)!:null,
 transition:async(id,w,from,to,patch)=>{const r=records.get(id);if(!r||r.workspaceId!==w||!from.includes(r.state))return false;records.set(id,{...r,...patch,state:to});return true},
 appendEvent:async(e)=>{events.push(e)},events:async(id,w)=>events.filter(e=>e.taskId===id&&records.get(id)?.workspaceId===w)};
}
const task:TaskRecord={id:"t1",workspaceId:"w1",ownerId:"u1",state:"queued",attempts:0,payload:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
describe("native orchestrator",()=>{
 it("persists task and completes it",async()=>{const s=store();const o=new Orchestrator(s,async()=>({ok:true}));await o.enqueue(task);await o.run("t1","w1");expect((await s.read("t1","w1"))?.state).toBe("completed");});
 it("fails closed for workspace mismatch",async()=>{const s=store();const o=new Orchestrator(s,async()=>{});await o.enqueue(task);await expect(o.run("t1","other")).rejects.toThrow("Task not found");});
 it("does not execute duplicate state transitions",async()=>{const s=store();const execute=vi.fn(async()=>{});const o=new Orchestrator(s,execute);await o.enqueue(task);await o.run("t1","w1");await expect(o.run("t1","w1")).rejects.toThrow("Task is not eligible to run");expect(execute).toHaveBeenCalledTimes(1);});
 it("requeues transient failures while attempts remain",async()=>{const s=store();const o=new Orchestrator(s,async()=>{throw new Error("transient")},3);await o.enqueue(task);await expect(o.run("t1","w1")).resolves.toBeUndefined();expect((await s.read("t1","w1"))?.state).toBe("queued");expect((await s.read("t1","w1"))?.attempts).toBe(1);});
 it("fails terminally when retry budget is exhausted",async()=>{const s=store();const o=new Orchestrator(s,async()=>{throw new Error("fatal")},1);await o.enqueue(task);await expect(o.run("t1","w1")).rejects.toThrow("fatal");expect((await s.read("t1","w1"))?.state).toBe("failed");});
 it("records cancellation of queued work",async()=>{const s=store();const o=new Orchestrator(s,async()=>{});await o.enqueue(task);expect(await o.cancel("t1","w1")).toBe(true);expect((await s.read("t1","w1"))?.state).toBe("cancelled");});
 it("does not execute if the running transition conflicts",async()=>{const s=store();const execute=vi.fn(async()=>{});const wrapped:TaskStore={...s,transition:async()=>false};const o=new Orchestrator(wrapped,execute);await o.enqueue(task);await expect(o.run("t1","w1")).rejects.toThrow("Task transition conflict");expect(execute).not.toHaveBeenCalled();});
});
