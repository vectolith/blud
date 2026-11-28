import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@db";
import { runtimeTasks, runtimeTaskEvents } from "@db/schema/runtime";
import type { TaskRecord, TaskEvent, TaskState, TaskStore } from "./types";

/** PostgreSQL-backed task store; all task reads are workspace scoped. */
export const postgresTaskStore:TaskStore={
 async create(task){await db.insert(runtimeTasks).values({id:task.id,workspaceId:task.workspaceId,ownerId:task.ownerId,state:task.state,attempts:task.attempts,payload:task.payload,result:task.result,error:task.error,createdAt:new Date(task.createdAt),updatedAt:new Date(task.updatedAt)});},
 async read(id,workspaceId){const rows=await db.select().from(runtimeTasks).where(and(eq(runtimeTasks.id,id),eq(runtimeTasks.workspaceId,workspaceId))).limit(1);const r=rows[0];return r?{id:r.id,workspaceId:r.workspaceId,ownerId:r.ownerId,state:r.state as TaskState,attempts:r.attempts,payload:r.payload,result:r.result??undefined,error:r.error??undefined,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString()}:null;},
 async transition(id,workspaceId,from,to,patch={}){const values:any={state:to,updatedAt:patch.updatedAt?new Date(patch.updatedAt):new Date()};if(patch.attempts!==undefined)values.attempts=patch.attempts;if(patch.result!==undefined)values.result=patch.result;if(patch.error!==undefined)values.error=patch.error;const rows=await db.update(runtimeTasks).set(values).where(and(eq(runtimeTasks.id,id),eq(runtimeTasks.workspaceId,workspaceId),inArray(runtimeTasks.state,from))).returning({id:runtimeTasks.id});return rows.length===1;},
 async appendEvent(event){await db.insert(runtimeTaskEvents).values({id:crypto.randomUUID(),taskId:event.taskId,workspaceId:(await db.select({workspaceId:runtimeTasks.workspaceId}).from(runtimeTasks).where(eq(runtimeTasks.id,event.taskId)).limit(1))[0]?.workspaceId??"",sequence:event.sequence,type:event.type,at:new Date(event.at),data:event.data});},
 async events(id,workspaceId){const rows=await db.select().from(runtimeTaskEvents).where(and(eq(runtimeTaskEvents.taskId,id),eq(runtimeTaskEvents.workspaceId,workspaceId))).orderBy(asc(runtimeTaskEvents.sequence));return rows.map(r=>({taskId:r.taskId,sequence:r.sequence,type:r.type,at:r.at.toISOString(),data:r.data}));}
};
