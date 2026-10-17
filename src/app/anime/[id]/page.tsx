import Navbar from "@/components/Navbar";
import FavoriteButton from "@/components/FavoriteButton";
import EpisodeListSection from "@/components/EpisodeListSection";
import { getProviderByAnimeId } from "@/lib/providers";
import { requireAuth, getCurrentUserId } from "@/lib/auth";
import { getAnimeHistoryMap } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Play, Calendar, CheckCircle2, Globe, Star, Users } from "lucide-react";

export default async function DramaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dub?: string }>;
}) {
  await requireAuth();
  const currentUserId = await getCurrentUserId();

  const { id } = await params;
  const { dub } = await searchParams;
  const isDub = dub === "1";

  const provider = getProviderByAnimeId(id);
  const anime = await provider.getAnimeDetail(id);
  if (!anime) {
    notFound();
  }

  const initialHistoryMap = await getAnimeHistoryMap(currentUserId, anime.id);
  const episodes = isDub ? anime.dub_episodes : anime.sub_episodes;
  const firstEpNum = episodes.length > 0 ? Math.min(...episodes.map((e) => e.number)) : 1;

  return (
    <div className="min-h-screen bg-[#2B2B2B]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Banner Card */}
        <div className="overflow-hidden rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-6 sm:p-8">
          <div className="flex flex-col gap-8 md:flex-row">
            {/* Poster */}
            <div className="mx-auto w-48 flex-shrink-0 sm:w-60 md:mx-0">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-[#B3B3B3]/20 bg-[#2B2B2B] shadow-xl">
                {anime.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={anime.poster}
                    alt={anime.title}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex flex-1 flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {anime.is_finished ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/40">
                      <CheckCircle2 className="h-3 w-3" /> 완결
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-300 border border-sky-500/40">
                      방영중
                    </span>
                  )}

                  {anime.id.startsWith("odr_") && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300 border border-purple-500/40">
                      추억의 드라마
                    </span>
                  )}

                  {anime.year && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#3B3B3B] border border-[#B3B3B3]/20 px-3 py-1 text-xs text-[#D4D4D4]">
                      <Calendar className="h-3 w-3" /> {anime.year}
                    </span>
                  )}

                  {anime.country && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#3B3B3B] border border-[#B3B3B3]/20 px-3 py-1 text-xs text-[#D4D4D4]">
                      <Globe className="h-3 w-3" /> {anime.country}
                    </span>
                  )}

                  {anime.rating && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1 text-xs font-bold text-amber-300">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {anime.rating}
                    </span>
                  )}
                </div>

                <h1 className="mt-3 text-2xl font-black tracking-tight text-[#FFFFFF] sm:text-3xl lg:text-4xl">
                  {anime.title}
                </h1>

                {anime.original_title && anime.original_title !== anime.title && (
                  <p className="mt-1 text-xs font-medium text-[#B3B3B3]">
                    원제: {anime.original_title}
                  </p>
                )}

                {anime.genres.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {anime.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-lg border border-[#B3B3B3]/20 bg-[#3B3B3B] px-2.5 py-1 text-xs font-medium text-[#D4D4D4]"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {anime.description && (
                  <p className="mt-5 text-sm leading-relaxed text-[#D4D4D4] whitespace-pre-line">
                    {anime.description}
                  </p>
                )}
              </div>

              {/* Action */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {episodes.length > 0 && (
                  <Link
                    href={`/watch/${anime.id}/${firstEpNum}${isDub ? "?dub=1" : ""}`}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#FFFFFF] px-6 py-3 font-extrabold text-[#2B2B2B] transition hover:bg-[#D4D4D4] active:scale-95 text-sm"
                  >
                    <Play className="h-4 w-4 fill-[#2B2B2B]" />
                    {firstEpNum}화 바로 시청
                  </Link>
                )}
                <FavoriteButton
                  animeId={anime.id}
                  animeTitle={anime.title}
                  animePoster={anime.poster}
                />
              </div>
            </div>
          </div>

          {/* Cast Section (TVWIKI 출연진 정보) */}
          {anime.cast && anime.cast.length > 0 && (
            <div className="mt-8 border-t border-[#B3B3B3]/20 pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4 text-[#FFFFFF]" />
                <h3 className="text-sm font-bold text-[#FFFFFF]">주요 출연진 ({anime.cast.length}명)</h3>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {anime.cast.map((actor, idx) => (
                  <div
                    key={`${actor.name}-${idx}`}
                    className="flex w-28 shrink-0 flex-col items-center rounded-2xl border border-[#B3B3B3]/15 bg-[#2B2B2B]/80 p-2.5 text-center"
                  >
                    <div className="relative h-20 w-20 overflow-hidden rounded-full border border-[#B3B3B3]/25 bg-[#333333]">
                      {actor.photo || actor.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={actor.photo || actor.image}
                          alt={actor.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-[#B3B3B3]">
                          배우
                        </div>
                      )}
                    </div>
                    <span className="mt-2 line-clamp-1 text-xs font-bold text-[#FFFFFF]">
                      {actor.name}
                    </span>
                    {actor.role && (
                      <span className="mt-0.5 line-clamp-1 text-[11px] text-[#B3B3B3]">
                        {actor.role}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Episodes Section */}
        <EpisodeListSection
          animeId={anime.id}
          subEpisodes={anime.sub_episodes}
          dubEpisodes={anime.dub_episodes}
          initialIsDub={isDub}
          initialHistoryMap={initialHistoryMap}
        />
      </main>
    </div>
  );
}
