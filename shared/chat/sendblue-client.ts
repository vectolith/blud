import { env } from "@shared/environment";
import { z } from "zod";

const SENDBLUE_SEND_URL = "https://api.sendblue.co/api/send-message";
const REQUEST_TIMEOUT_MS = 15_000;

export type SendblueResult =
  | { ok: true; messageHandle?: string }
  | { ok: false; retryable: boolean; detail: string };

const sendResponseSchema = z.object({ message_handle: z.string().optional() });

/** The send-message request body Sendblue accepts. */
interface SendblueSendPayload {
  number: string;
  content: string;
  from_number?: string;
  media_url?: string;
}

/** Every credential Sendblue needs. Missing any one of them disables the channel. */
function sendblueConfigured(): boolean {
  return Boolean(
    env.SENDBLUE_API_KEY && env.SENDBLUE_API_SECRET && env.SENDBLUE_FROM_NUMBER
  );
}

/**
 * Send one iMessage through Sendblue.
 *
 * A 2xx with a message handle proves the provider accepted the message. A 4xx is a
 * rejection and must not be retried. A timeout, 429 or 5xx is ambiguous: the message
 * may already have been delivered, so callers may retry only with an idempotency key
 * the provider can recognise.
 */
export async function sendSendblueMessage(input: {
  to: string;
  text: string;
  mediaUrl?: string;
}): Promise<SendblueResult> {
  if (!sendblueConfigured()) {
    return {
      ok: false,
      retryable: false,
      detail: "Sendblue is not configured.",
    };
  }
  if (!input.to || !input.text.trim()) {
    return {
      ok: false,
      retryable: false,
      detail: "A recipient and text are required.",
    };
  }

  const payload: SendblueSendPayload = {
    number: input.to,
    content: input.text,
  };
  const fromNumber = env.SENDBLUE_FROM_NUMBER;
  if (fromNumber) payload.from_number = fromNumber;
  if (input.mediaUrl) payload.media_url = input.mediaUrl;

  let response: Response;
  try {
    response = await fetch(SENDBLUE_SEND_URL, {
      method: "POST",
      headers: {
        "sb-api-key-id": env.SENDBLUE_API_KEY ?? "",
        "sb-api-secret-key": env.SENDBLUE_API_SECRET ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      detail:
        error instanceof Error ? error.message : "Sendblue request failed.",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      retryable: response.status >= 500 || response.status === 429,
      detail:
        detail.slice(0, 300) ||
        "Sendblue rejected the message (" + String(response.status) + ").",
    };
  }

  const parsed = sendResponseSchema.safeParse(
    await response.json().catch(() => null)
  );
  return {
    ok: true,
    messageHandle: parsed.success ? parsed.data.message_handle : undefined,
  };
}
