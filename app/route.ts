import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    channels: ["sendblue-imessage"],
    mode: "headless-messaging-only",
    service: "Blud",
    webInterface: false,
  });
}
