import Navbar from "@/components/Navbar";
import EpisodePlayback from "@/components/EpisodePlayback";
import { getProviderByAnimeId } from "@/lib/providers";
import { requireAuth } from "@/lib/auth";
import { notFound } from "next/navigation";

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
        <EpisodePlayback
          key={`${id}:${epNum}:${isDub}`}
          animeId={id}
          animeTitle={anime.title}
          animePoster={anime.poster}
          episodeNumber={epNum}
          initialEpTitle={epTitle}
          linkPreEp={linkPreEpNum}
          linkNextEp={linkNextEpNum}
          isDub={isDub}
          subEpisodes={anime.sub_episodes}
          dubEpisodes={anime.dub_episodes}
        />
      </main>
    </div>
  );
}
