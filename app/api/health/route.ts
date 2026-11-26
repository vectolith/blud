import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@db";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness probe for hosting health checks (Render, Railway, Fly).
 * Reports 503 when the database is unreachable so a bad deploy is never marked
 * healthy.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "up" });
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "down" },
      { status: 503 }
    );
  }
}
