import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { getCurrentUserId, getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = await getCurrentUserId();
  const animeId = searchParams.get("id");

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: true, is_favorited: false, items: [] });
  }

  try {
    await initDb();

    if (animeId) {
      const rows = await sql`
        SELECT 1 FROM drama_favorites
        WHERE user_id = ${userId} AND anime_id = ${animeId}
        LIMIT 1;
      `;
      return NextResponse.json({ success: true, is_favorited: rows.length > 0 });
    }

    const rows = await sql`
      SELECT * FROM drama_favorites
      WHERE user_id = ${userId}
      ORDER BY created_at DESC;
    `;
    return NextResponse.json(
      { success: true, items: rows },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    console.error("[Favorite API GET error]:", error);
    return NextResponse.json(
      { success: false, message: "즐겨찾기를 불러오지 못했습니다.", items: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: false, message: "Database not configured" });
  }

  try {
    await initDb();
    const body = await request.json();
    const effectiveUserId = await getCurrentUserId();
    const { animeId, animeTitle, animePoster = "" } = body;

    if (!animeId) {
      return NextResponse.json({ success: false, message: "Missing animeId" }, { status: 400 });
    }

    const inserted = await sql`
      INSERT INTO drama_favorites (user_id, anime_id, anime_title, anime_poster)
      VALUES (${effectiveUserId}, ${animeId}, ${animeTitle}, ${animePoster})
      ON CONFLICT (user_id, anime_id) DO NOTHING
      RETURNING id;
    `;

    if (inserted.length > 0) {
      return NextResponse.json({ success: true, is_favorited: true });
    }

    await sql`
      DELETE FROM drama_favorites
      WHERE user_id = ${effectiveUserId} AND anime_id = ${animeId};
    `;
    return NextResponse.json({ success: true, is_favorited: false });
  } catch (error) {
    console.error("[Favorite API POST error]:", error);
    return NextResponse.json({ success: false, message: "즐겨찾기 처리에 실패했습니다." }, { status: 500 });
  }
}
