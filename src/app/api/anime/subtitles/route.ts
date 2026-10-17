import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "";
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  return NextResponse.json({
    success: true,
    anime_title: title,
    resolved_title: title,
    episode: ep,
    count: 0,
    subtitles: [],
    creators: [],
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.json({
    success: false,
    message: "로컬 자막 파일을 직접 열어 적용해 주세요.",
  });
}
