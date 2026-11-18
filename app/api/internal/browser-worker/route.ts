import { NextResponse } from "next/server";

/**
 * This legacy RPC endpoint never executed a browser task. It returned a
 * success-shaped response after optionally constructing a Kernel client, which
 * could mislead callers into treating an unexecuted task as completed.
 *
 * Browser execution is provided by the authenticated agent runtime. Keep this
 * endpoint explicitly retired until a real, independently verified execution
 * contract is implemented here.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Browser-worker RPC is retired." },
    { status: 410 },
  );
}
