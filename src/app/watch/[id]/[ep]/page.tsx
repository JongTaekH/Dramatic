import Navbar from "@/components/Navbar";
import Player from "@/components/Player";
import { getProviderByAnimeId } from "@/lib/providers";
import { requireAuth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ep: string }>;
  searchParams: Promise<{ dub?: string }>;
}) {
  await requireAuth();

  const { id, ep } = await params;
  const { dub } = await searchParams;
  const epNum = parseInt(ep, 10) || 1;
  const isDub = dub === "1";

  const provider = getProviderByAnimeId(id);
  const anime = await provider.getAnimeDetail(id);
  if (!anime) {
    notFound();
  }

  const epList = isDub ? anime.dub_episodes : anime.sub_episodes;
  const matched = epList.find((e) => e.number === epNum) || epList[0];
  const watchUrl = matched?.watch_url || "";

  if (!watchUrl) {
    notFound();
  }

  const streamInfo = await provider.getEpisodeStream(watchUrl);
  if (!streamInfo || (!streamInfo.m3u8_url && !streamInfo.embed_url)) {
    return (
      <div className="min-h-screen bg-[#2B2B2B]">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-16 text-center">
          <div className="rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-8">
            <h2 className="text-xl font-bold text-red-400">스트림 주소를 불러오지 못했습니다.</h2>
            <p className="mt-2 text-sm text-[#B3B3B3]">
              해당 회차 영상 소스가 아직 업로드되지 않았거나 연결이 원활하지 않습니다.
            </p>
            <Link
              href={`/anime/${id}`}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#FFFFFF] px-5 py-2.5 text-sm font-bold text-[#2B2B2B] hover:bg-[#D4D4D4] transition"
            >
              <ArrowLeft className="h-4 w-4" /> 드라마 회차 목록으로 돌아가기
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const rawM3u8 = streamInfo.m3u8_url || "";
  const hasM3u8 = Boolean(
    rawM3u8 &&
      (rawM3u8.includes(".m3u8") ||
        rawM3u8.includes(".txt") ||
        rawM3u8.includes("/m3/") ||
        rawM3u8.includes("/hls/") ||
        streamInfo.stream_type === "m3u8")
  );
  const isIframe = streamInfo.stream_type === "iframe" || !hasM3u8;
  const embedUrl = streamInfo.embed_url || streamInfo.player_url || "";
  let playerRef = streamInfo.player_url || "";
  if (!playerRef && rawM3u8) {
    try {
      playerRef = new URL(rawM3u8).origin + "/";
    } catch {}
  }
  const rawVtt = streamInfo.vtt_url || "";

  const proxiedM3u8 =
    !isIframe && rawM3u8
      ? `/api/anime/stream/m3u8?url=${encodeURIComponent(rawM3u8)}&ref=${encodeURIComponent(
          playerRef
        )}`
      : "";
  const proxiedVtt = rawVtt ? `/api/anime/stream/vtt?url=${encodeURIComponent(rawVtt)}` : "";

  let linkPreEpNum: number | null = null;
  let linkNextEpNum: number | null = null;
  let epTitle = `${epNum}화`;

  for (let idx = 0; idx < epList.length; idx++) {
    const e = epList[idx];
    if (e.number === epNum) {
      epTitle = e.title;
      if (idx > 0) {
        linkPreEpNum = epList[idx - 1].number;
      }
      if (idx + 1 < epList.length) {
        linkNextEpNum = epList[idx + 1].number;
      }
      break;
    }
  }

  return (
    <div className="min-h-screen bg-[#2B2B2B] pb-16">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Player
          animeId={id}
          animeTitle={anime.title}
          animePoster={anime.poster}
          episodeNumber={epNum}
          initialEpTitle={epTitle}
          m3u8Url={proxiedM3u8}
          defaultVttUrl={proxiedVtt}
          linkPreEp={linkPreEpNum}
          linkNextEp={linkNextEpNum}
          isDub={isDub}
          subEpisodes={anime.sub_episodes}
          dubEpisodes={anime.dub_episodes}
          streamType={isIframe ? "iframe" : "m3u8"}
          embedUrl={embedUrl}
          serverSources={streamInfo.server_sources}
        />
      </main>
    </div>
  );
}
