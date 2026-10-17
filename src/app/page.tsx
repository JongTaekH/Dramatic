import Navbar from "@/components/Navbar";
import AnimeCard from "@/components/AnimeCard";
import HistoryList, { HistoryItem } from "@/components/HistoryList";
import { getProvider, TVWIKI_SORTS, AnimeListItem } from "@/lib/providers";
import { getDb, initDb } from "@/lib/db";
import { checkAndPromoteNewEpisodes } from "@/lib/historyPromotion";
import { getCurrentUserId, requireAuth } from "@/lib/auth";
import Link from "next/link";
import {
  Flame,
  Tv,
  ChevronLeft,
  ChevronRight,
  Star,
  Clock,
  Film,
  ArrowUpDown,
} from "lucide-react";

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  sort?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 인증 검사: 관리자 없으면 /setup 강제 이동, 미로그인이면 /login 강제 이동
  await requireAuth();

  const provider = getProvider("tvwiki");
  const params = await searchParams;
  const tab = params.tab || (params.q ? "search" : "drama");
  const q = params.q?.trim() || "";
  const page = parseInt(params.page || "1", 10) || 1;
  const sort = params.sort || "latest";

  let items: AnimeListItem[] = [];
  let historyItems: HistoryItem[] = [];
  let has_next = false;
  let total_pages = 1;
  let sourceError = "";

  if (q) {
    try {
      const res = await provider.searchAnime(q, page);
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } catch (error: any) {
      sourceError = `TVWIKI 검색에 연결하지 못했습니다: ${error?.message || "잠시 후 다시 시도해 주세요."}`;
    }
  } else if (tab === "favorites") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        const rows = await sql`
          SELECT anime_id as id, anime_title as title, anime_poster as poster, '' as detail_url, '즐겨찾기' as remarks
          FROM drama_favorites
          WHERE user_id = ${currentUserId}
          ORDER BY created_at DESC;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          poster: r.poster,
          detail_url: `/anime/${r.id}`,
          remarks: "★ 즐겨찾기",
        }));
      } catch {}
    }
  } else if (tab === "history") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        await checkAndPromoteNewEpisodes(currentUserId);

        const rows = await sql`
          SELECT * FROM (
            SELECT DISTINCT ON (anime_id)
              id, anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time, duration, is_completed, updated_at
            FROM drama_history
            WHERE user_id = ${currentUserId}
            ORDER BY anime_id, updated_at DESC
          ) t
          ORDER BY updated_at DESC
          LIMIT 50;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        historyItems = rows.map((r: any) => ({
          id: r.id,
          anime_id: r.anime_id,
          anime_title: r.anime_title,
          anime_poster: r.anime_poster || "",
          episode_number: r.episode_number,
          episode_title: r.episode_title || "",
          watch_url: r.watch_url,
          watch_time: parseFloat(r.watch_time || "0"),
          duration: parseFloat(r.duration || "0"),
          is_completed: Boolean(r.is_completed),
          updated_at: r.updated_at
            ? new Date(r.updated_at).toISOString()
            : new Date().toISOString(),
        }));
      } catch (e) {
        console.error("Failed to fetch history:", e);
      }
    }
  } else {
    try {
      const category =
        tab === "old_drama"
          ? "old_drama"
          : tab === "top"
          ? "top"
          : "drama";
      const res = await provider.getAnimeList({
        category,
        page,
        sort: tab === "top" && sort === "latest" ? "views" : sort,
      });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } catch (err: any) {
      console.error("[TVWIKI Error]:", err);
      sourceError = `TVWIKI 연결 실패: ${
        err?.message || "우측 상단 지구본 아이콘에서 텔레그램 최신 주소를 자동 적용해 주세요."
      }`;
    }
  }

  const buildUrl = (newParams: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (tab) p.set("tab", tab);
    if (q) p.set("q", q);
    if (sort && sort !== "latest") p.set("sort", sort);
    p.set("page", String(page));

    Object.entries(newParams).forEach(([k, v]) => {
      if (v === "") p.delete(k);
      else p.set(k, String(v));
    });

    return `/?${p.toString()}`;
  };

  let sectionTitle = "";
  let sectionSubtitle = "";

  if (q) {
    sectionTitle = `"${q}" 드라마 검색 결과 (${items.length}개)`;
    sectionSubtitle = "TVWIKI 최신 드라마 및 추억의 드라마 통합 검색";
  } else if (tab === "old_drama") {
    sectionTitle = "🎞️ 추억의 드라마";
    sectionSubtitle = "다시 보고 싶은 역대 명작 한국 드라마 아카이브";
  } else if (tab === "top") {
    sectionTitle = "🔥 인기 드라마 랭킹";
    sectionSubtitle = "조회수 및 좋아요가 가장 높은 화제의 인기 드라마";
  } else if (tab === "favorites") {
    sectionTitle = "⭐ 내 즐겨찾기 드라마";
    sectionSubtitle = "즐겨찾기에 추가해 둔 관심 드라마 목록";
  } else if (tab === "history") {
    sectionTitle = "🕒 최근 시청 기록 (이어보기)";
    sectionSubtitle = "시청하던 회차와 진행도가 자동으로 동기화됩니다";
  } else {
    sectionTitle = "📺 최신 방영 드라마";
    sectionSubtitle = "현재 방영 중이거나 최근 완결된 한국 드라마 업데이트";
  }

  const showSortBar = !q && (tab === "drama" || tab === "old_drama" || tab === "top");
  const activeSort = tab === "top" && sort === "latest" ? "views" : sort;

  return (
    <div className="min-h-screen bg-[#2B2B2B]">
      <Navbar />

      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-8 sm:px-6 lg:px-8 safe-x">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#B3B3B3]/20 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/?tab=drama"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "drama" && !q
                  ? "bg-[#FFFFFF] text-[#2B2B2B] shadow-sm font-bold"
                  : "text-[#B3B3B3] hover:bg-[#333333] hover:text-[#FFFFFF] border border-transparent"
              }`}
            >
              <Tv
                className={`h-4 w-4 ${
                  tab === "drama" && !q ? "text-emerald-600" : "text-emerald-400"
                }`}
              />
              최신 드라마
            </Link>

            <Link
              href="/?tab=old_drama"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "old_drama" && !q
                  ? "bg-[#FFFFFF] text-[#2B2B2B] shadow-sm font-bold"
                  : "text-[#B3B3B3] hover:bg-[#333333] hover:text-[#FFFFFF] border border-transparent"
              }`}
            >
              <Film
                className={`h-4 w-4 ${
                  tab === "old_drama" && !q ? "text-purple-600" : "text-purple-400"
                }`}
              />
              추억의 드라마
            </Link>

            <Link
              href="/?tab=top&sort=views"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "top" && !q
                  ? "bg-[#FFFFFF] text-[#2B2B2B] shadow-sm font-bold"
                  : "text-[#B3B3B3] hover:bg-[#333333] hover:text-[#FFFFFF] border border-transparent"
              }`}
            >
              <Flame
                className={`h-4 w-4 ${
                  tab === "top" && !q ? "text-orange-500" : "text-orange-400"
                }`}
              />
              인기 드라마
            </Link>

            <Link
              href="/?tab=favorites"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "favorites"
                  ? "bg-[#FFFFFF] text-[#2B2B2B] shadow-sm font-bold"
                  : "text-[#B3B3B3] hover:bg-[#333333] hover:text-[#FFFFFF] border border-transparent"
              }`}
            >
              <Star
                className={`h-4 w-4 ${
                  tab === "favorites"
                    ? "fill-amber-500 text-amber-500"
                    : "fill-amber-400/20 text-amber-400"
                }`}
              />
              즐겨찾기
            </Link>

            <Link
              href="/?tab=history"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "history"
                  ? "bg-[#FFFFFF] text-[#2B2B2B] shadow-sm font-bold"
                  : "text-[#B3B3B3] hover:bg-[#333333] hover:text-[#FFFFFF] border border-transparent"
              }`}
            >
              <Clock
                className={`h-4 w-4 ${
                  tab === "history" ? "text-sky-500" : "text-sky-400"
                }`}
              />
              시청 기록
            </Link>
          </div>

          {/* Sort Options Bar */}
          {showSortBar && (
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[#333333] p-1 text-xs border border-[#B3B3B3]/20">
              <span className="flex items-center gap-1 px-2 py-1 text-[#B3B3B3] font-semibold">
                <ArrowUpDown className="h-3 w-3" />
                정렬
              </span>
              {TVWIKI_SORTS.map(({ value: sortKey, label: sortLabel }) => {
                const isSelected = activeSort === sortKey;
                return (
                  <Link
                    key={sortKey}
                    href={buildUrl({ sort: sortKey, page: 1 })}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      isSelected
                        ? "bg-[#FFFFFF] text-[#2B2B2B] font-bold shadow-sm"
                        : "text-[#B3B3B3] hover:text-[#FFFFFF] hover:bg-[#3B3B3B]"
                    }`}
                  >
                    {sortLabel}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Section Title Header */}
        {sectionTitle && (
          <div className="mt-6 mb-2">
            <h2 className="min-w-0 text-xl font-bold text-white [overflow-wrap:anywhere]">
              {sectionTitle}
            </h2>
            {sectionSubtitle && (
              <p className="mt-1 text-xs text-slate-400">{sectionSubtitle}</p>
            )}
          </div>
        )}

        {/* History Tab vs General Grid */}
        {tab === "history" ? (
          <div className="mt-6">
            <HistoryList initialItems={historyItems} />
          </div>
        ) : (
          <>
            {items.length > 0 ? (
              <div className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {items.map((anime, idx) => (
                  <AnimeCard key={`${anime.id}-${idx}`} anime={anime} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400">
                <p className="text-base font-semibold">
                  {sourceError ||
                    (tab === "favorites"
                      ? "등록된 즐겨찾기가 없습니다. 마음에 드는 드라마를 추가해 보세요!"
                      : "드라마 목록이 없습니다.")}
                </p>
              </div>
            )}
          </>
        )}

        {/* Pagination */}
        {tab !== "favorites" && tab !== "history" && total_pages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: page - 1 })}
                className="flex items-center gap-1 rounded-xl border border-[#B3B3B3]/20 bg-[#333333] px-4 py-2 text-sm text-[#D4D4D4] transition hover:bg-[#3B3B3B] hover:text-[#FFFFFF]"
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </Link>
            )}

            <span className="px-4 py-2 text-sm font-semibold text-[#FFFFFF]">
              {page} / {total_pages || 1} 페이지
            </span>

            {has_next && (
              <Link
                href={buildUrl({ page: page + 1 })}
                className="flex items-center gap-1 rounded-xl border border-[#B3B3B3]/20 bg-[#333333] px-4 py-2 text-sm text-[#D4D4D4] transition hover:bg-[#3B3B3B] hover:text-[#FFFFFF]"
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
