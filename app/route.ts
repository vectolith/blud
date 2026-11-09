import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    channels: ["linq-imessage"],
    mode: "headless-messaging-only",
    service: "Blud",
    webInterface: false,
  });
}
