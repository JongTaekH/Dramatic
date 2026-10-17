import { NextRequest, NextResponse } from "next/server";
import { getProviderByAnimeId } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();

  if (!id) {
    return NextResponse.json({ error: "Missing drama id" }, { status: 400 });
  }

  const provider = getProviderByAnimeId(id);
  const detail = await provider.getAnimeDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Drama not found" }, { status: 404 });
  }

  const noCache = searchParams.get("nocache") === "1";
  return NextResponse.json(detail, {
    headers: {
      "Cache-Control": noCache
        ? "no-store"
        : "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
