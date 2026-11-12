import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@shared/environment";

const requestSchema = z.object({
  message: z.string().min(1),
  startUrl: z.url().optional(),
  sessionRef: z.string().optional(),
  caller: z.string().optional(),
});

function isAuthorized(request: Request): boolean {
  const secret = env.BLUD_INTERNAL_KEY;
  if (!secret) return false;

  const token =
    request.headers.get("x-blud-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ??
    "";
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(token);
  return (
    supplied.byteLength === expected.byteLength &&
    timingSafeEqual(supplied, expected)
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
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

  return NextResponse.json(
    {
      error:
        "Browser execution is not implemented by this legacy RPC route. Use the authenticated agent browser tools.",
    },
    { status: 501 }
  );
}
