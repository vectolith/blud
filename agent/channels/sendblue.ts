import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { env } from "@shared/environment";
import { sendSendblueMessage } from "@shared/chat/sendblue-client";
import { resolveSendbluePrincipal } from "@agent/lib/sendblue/identity";
import { verifySendblueWebhook } from "@agent/lib/sendblue/webhook-auth";

interface SendblueInbound {
  content?: string;
  from_number?: string;
  is_outbound?: boolean;
  message_handle?: string;
  media_url?: string;
  status?: string;
}

const inboundSchema = z.object({
  content: z.string().optional(),
  from_number: z.string().optional(),
  is_outbound: z.boolean().optional(),
  message_handle: z.string().optional(),
  media_url: z.string().optional(),
  status: z.string().optional(),
});

const MAX_INBOUND_CHARS = 8000;

// Sendblue can report the same completed reply more than once for one turn. Remember
// the last text sent to each address so a retry cannot deliver a duplicate message.
const lastDelivered = new Map<string, string>();

function readSecret(request: Request): string | null {
  const header = request.headers.get("x-blud-webhook-secret");
  if (header) return header;
  return new URL(request.url).searchParams.get("secret");
}

export default defineChannel({
  routes: [
    POST("/sendblue/webhook", async (request, { from }) => {
      const decision = verifySendblueWebhook({
        configuredSecret: env.SENDBLUE_WEBHOOK_SECRET,
        providedSecret: readSecret(request),
        isProduction: env.NODE_ENV === "production",
      });
      if (!decision.ok) {
        return new Response(decision.error, { status: decision.status });
      }

      const parsed = inboundSchema.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success) {
        return new Response("Invalid JSON", { status: 400 });
      }
      const body: SendblueInbound = parsed.data;

      // Delivery receipts and any outbound echo are provider state, not user input.
      if (body.is_outbound || body.status) {
        return Response.json({ ignored: true }, { status: 202 });
      }

      const text = body.content?.trim().slice(0, MAX_INBOUND_CHARS);
      const sender = body.from_number;
      if (!text || !sender) {
        return new Response("Missing content or sender", { status: 400 });
      }

      const principal = await resolveSendbluePrincipal(sender);
      if (!principal) {
        await sendSendblueMessage({
          to: sender,
          text: "This number is not linked to a BLUD account. Sign in with this number, verify it, then text again.",
        });
        return Response.json({ status: "unlinked" }, { status: 202 });
      }

      const delivery = body.message_handle
        ? await from(sender).send(text, {
            auth: principal,
            idempotencyKey: body.message_handle,
          })
        : await from(sender).send(text, { auth: principal });
      return Response.json(delivery, { status: 202 });
    }),
  ],

  events: {
    async "content.completed"(event, ctx) {
      if (event.data.phase !== "reply") return;
      const value = z.string().safeParse(event.data.value);
      if (!value.success) return;
      const text = value.data.trim();
      if (!text) return;

      const address = ctx.channel.continuation?.token;
      if (!address) return;
      if (lastDelivered.get(address) === text) return;

      const result = await sendSendblueMessage({ to: address, text });
      if (result.ok) {
        lastDelivered.set(address, text);
      } else {
        console.error("[sendblue] reply delivery failed", {
          sessionId: ctx.session.id,
          retryable: result.retryable,
        });
      }
    },
  },
});
