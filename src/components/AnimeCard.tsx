import Link from "next/link";
import { AnimeListItem } from "@/lib/providers";
import { PlayCircle } from "lucide-react";

export default function AnimeCard({ anime }: { anime: AnimeListItem }) {
  const targetHref = anime.id
    ? `/anime/${anime.id}`
    : anime.detail_url && !anime.detail_url.startsWith("http")
    ? anime.detail_url
    : "/";

  return (
    <Link
      href={targetHref}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#B3B3B3]/20 bg-[#333333] transition duration-200 hover:-translate-y-1 hover:bg-[#3B3B3B] hover:border-[#D4D4D4]/40 text-decoration-none shadow-sm"
    >
      {/* 3:4 Vertical Drama Poster Wrapper */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#2B2B2B]">
        {anime.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={anime.poster}
            alt={anime.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[#B3B3B3]">
            No Image
          </div>
        )}

        {/* 좌측 상단 뱃지: 랭킹 or 평점 or 방영상태 */}
        {anime.rank ? (
          <span
            className={`absolute top-2 left-2 flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-extrabold shadow-sm z-10 ${
              anime.rank === 1
                ? "bg-amber-400 text-black font-black shadow-amber-500/20"
                : anime.rank === 2
                ? "bg-[#E5E5E5] text-[#2B2B2B]"
                : anime.rank === 3
                ? "bg-[#D97706]/90 text-white"
                : "bg-[#2B2B2B]/85 text-[#FFFFFF] border border-[#B3B3B3]/30 backdrop-blur-md"
            }`}
          >
            {anime.rank > 30 ? `★ ${anime.rank}%` : `${anime.rank}위`}
          </span>
        ) : anime.rating ? (
          <span className="absolute top-2 left-2 rounded-lg bg-[#2B2B2B]/85 px-2 py-0.5 text-xs font-bold text-amber-300 border border-[#B3B3B3]/30 backdrop-blur-md z-10">
            ★ {anime.rating}
          </span>
        ) : anime.time ? (
          <span className="absolute top-2 left-2 rounded-lg bg-[#2B2B2B]/85 px-2 py-0.5 text-[11px] font-semibold text-[#D4D4D4] border border-[#B3B3B3]/30 backdrop-blur-md z-10">
            {anime.time}
          </span>
        ) : null}

        {/* 우측 상단 뱃지: 회차/상태 remarks */}
        {anime.remarks ? (
          <span
            className={`absolute top-2 right-2 rounded-lg px-2 py-0.5 text-xs font-bold backdrop-blur-md z-10 ${
              anime.remarks.includes("즐겨찾기")
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10"
                : anime.remarks.includes("UP")
                ? "bg-rose-500/85 text-white border border-rose-400/50 shadow-sm"
                : anime.remarks.includes("완결")
                ? "bg-emerald-600/85 text-white border border-emerald-400/50"
                : "bg-[#2B2B2B]/85 text-[#FFFFFF] border border-[#B3B3B3]/30"
            }`}
          >
            {anime.remarks}
          </span>
        ) : null}
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col justify-between p-3.5">
        <h3
          className="line-clamp-2 text-sm font-bold text-[#FFFFFF] transition group-hover:text-[#D4D4D4] leading-snug"
          title={anime.title}
        >
          {anime.title}
        </h3>
        <div className="mt-2.5 flex items-center justify-between text-xs text-[#B3B3B3]">
          <div className="flex items-center transition group-hover:text-[#FFFFFF]">
            <PlayCircle className="h-3.5 w-3.5 text-[#FFFFFF] mr-1" />
            <span>보러가기</span>
          </div>
          {anime.time && (anime.rank || anime.rating) && (
            <span className="text-[11px] text-[#B3B3B3]">{anime.time}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
