import { NextResponse } from "next/server";

/**
 * Retired legacy cross-product RPC endpoint.
 *
 * Blud is a standalone product. The former Velnor bridge did not perform a
 * real browser operation and could return success-shaped responses without
 * execution evidence. Keep the route explicitly unavailable rather than
 * silently accepting work or fabricating a completion receipt.
 */
export async function POST() {
  return NextResponse.json(
    {
      status: "unavailable",
      error: "The legacy cross-product browser RPC has been retired. Blud operates as a standalone product.",
    },
    { status: 410 },
  );
}
