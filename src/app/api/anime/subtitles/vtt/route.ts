import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return new NextResponse("WEBVTT\n\n", {
    status: 200,
    headers: { "Content-Type": "text/vtt; charset=utf-8" },
  });
}
