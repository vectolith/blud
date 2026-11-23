ALTER TABLE "scheduled_agent_jobs" DROP CONSTRAINT IF EXISTS "scheduled_agent_jobs_conversation_channel_check";--> statement-breakpoint
UPDATE "scheduled_agent_jobs" SET "conversation_channel" = 'sendblue' WHERE "conversation_channel" = 'linq';--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" ADD CONSTRAINT "scheduled_agent_jobs_conversation_channel_check" CHECK ("scheduled_agent_jobs"."conversation_channel" IN ('eve', 'sendblue'));--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" DROP COLUMN IF EXISTS "reply_anchor_message_id";
