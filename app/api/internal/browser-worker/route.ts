import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Retired." },
    { status: 410 },
  );
}
