import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  startUrl: z.string().url().optional(),
  sessionRef: z.string().optional(),
  extractSchema: z.record(z.string(), z.unknown()).optional(),
  caller: z.literal("velnor"),
}).strict();

function configuredServiceSecret(): string {
  return process.env.BLUD_INTERNAL_KEY || process.env.VELNOR_SHARED_SECRET || "";
}

function isAuthorized(request: Request, secret: string): boolean {
  const token =
    request.headers.get("x-blud-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const expectedBytes = Buffer.from(secret);
  const tokenBytes = Buffer.from(token);
  return (
    tokenBytes.length === expectedBytes.length &&
    timingSafeEqual(tokenBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const secret = configuredServiceSecret();
  if (!secret) {
    return NextResponse.json(
      {
        status: "offline",
        error: "internal_service_auth_not_configured",
        message: "Blud internal browser-worker authentication is not configured.",
      },
      { status: 503 }
    );
  }

  if (!isAuthorized(request, secret)) {
    return NextResponse.json(
      { error: "Unauthorized: valid internal service key required." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid browser task payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // This route is not yet wired to Eve's authenticated root-agent/subagent
  // runtime. Returning success here would fabricate a browser execution
  // receipt: initializing the Kernel SDK alone does not create a browser,
  // navigate a page, or verify an outcome. Fail closed until the real
  // coordinator can return a verifiable execution receipt.
  return NextResponse.json(
    {
      status: "failure",
      error: "browser_execution_not_implemented",
      message:
        "No browser action was performed. The internal endpoint is not yet connected to Blud's browser-agent runtime.",
    },
    { status: 501 }
  );
}
