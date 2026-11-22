import { env } from "@shared/environment";

const SENDBLUE_SEND_URL = "https://api.sendblue.co/api/send-message";
const REQUEST_TIMEOUT_MS = 15_000;

export type SendblueResult =
  | { ok: true; messageHandle?: string }
  | { ok: false; retryable: boolean; detail: string };

/** Every credential Sendblue needs. Missing any one of them disables the channel. */
export function sendblueConfigured(): boolean {
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

  let response: Response;
  try {
    response = await fetch(SENDBLUE_SEND_URL, {
      method: "POST",
      headers: {
        "sb-api-key-id": env.SENDBLUE_API_KEY ?? "",
        "sb-api-secret-key": env.SENDBLUE_API_SECRET ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        number: input.to,
        from_number: env.SENDBLUE_FROM_NUMBER,
        content: input.text,
        ...(input.mediaUrl ? { media_url: input.mediaUrl } : {}),
      }),
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
        "Sendblue rejected the message (" + response.status + ").",
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    message_handle?: string;
  };
  return { ok: true, messageHandle: payload.message_handle };
}
