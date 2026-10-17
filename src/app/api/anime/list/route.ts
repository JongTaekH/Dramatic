import { NextRequest, NextResponse } from "next/server";
import { getProvider, TVWIKI_SORT_OPTIONS, TVWIKI_CATEGORIES } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = getProvider("tvwiki");

  const q = searchParams.get("q")?.trim() || "";
  const tab = searchParams.get("tab") || "drama";
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  const sort = searchParams.get("sort") || "subidx";

  let result;
  if (q) {
    result = await provider.searchAnime(q, page);
  } else {
    const category =
      tab === "old_drama" || tab === "finished"
        ? "old_drama"
        : tab === "top"
        ? "top"
        : "drama";
    const effectiveSort = tab === "top" && !searchParams.get("sort") ? "wr_hit" : sort;
    result = await provider.getAnimeListFiltered({
      category,
      page,
      sort: effectiveSort,
    });
  }

  const noCache = searchParams.get("nocache") === "1";
  const cacheControl =
    noCache || q
      ? "no-store"
      : "public, s-maxage=300, stale-while-revalidate=600";

  return NextResponse.json(
    {
      ...result,
      source: "tvwiki",
      tab,
      sort,
      filters: {
        sorts: TVWIKI_SORT_OPTIONS,
        categories: TVWIKI_CATEGORIES,
        genres: [],
        years: [],
        types: [],
      },
    },
    {
      headers: {
        "Cache-Control": cacheControl,
      },
    }
  );
}
