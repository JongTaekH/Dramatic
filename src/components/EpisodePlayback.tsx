"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Player, { type PlayerProps } from "./Player";

type EpisodePlaybackProps = Omit<PlayerProps,
  "m3u8Url" | "defaultVttUrl" | "streamType" | "embedUrl" | "serverSources" | "onRefreshStream"
>;

interface PlaybackSource {
  url: string;
  subtitle: string;
  title?: string;
  previous?: number | null;
  next?: number | null;
}

export default function EpisodePlayback(props: EpisodePlaybackProps) {
  const { animeId, episodeNumber, isDub } = props;
  const [attempt, setAttempt] = useState(0);
  const [requestedEpisode, setRequestedEpisode] = useState(episodeNumber);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [error, setError] = useState("");
  const [originalPage, setOriginalPage] = useState("");
  const automaticRefreshes = useRef(0);

  useEffect(() => {
    automaticRefreshes.current = 0;
  }, [animeId, episodeNumber, isDub]);

  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setError("");
    setOriginalPage("");
    const query = new URLSearchParams({ id: animeId, ep: String(requestedEpisode) });
    if (isDub) query.set("is_dub", "1");
    void (async () => {
      try {
        const response = await fetch(`/api/anime/episode_info?${query}`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.proxied_m3u8) {
          if (!controller.signal.aborted && typeof data.watch_url === "string") {
            try {
              const original = new URL(data.watch_url);
              if (original.protocol === "https:" && /^tvwiki\d+\.net$/.test(original.hostname) &&
                  !original.username && !original.password && !original.port &&
                  /^\/(?:drama|old_drama)\/\d+\/\d+\/?$/.test(original.pathname)) {
                setOriginalPage(original.toString());
              }
            } catch { /* An invalid upstream URL must not become a clickable fallback. */ }
          }
          throw new Error(data.message || "영상 재생 정보를 가져오지 못했습니다.");
        }
        if (!controller.signal.aborted) {
          setSource({ url: data.proxied_m3u8, subtitle: data.proxied_vtt || "",
            title: data.episode_title, previous: data.link_pre_ep_num, next: data.link_next_ep_num });
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "영상 서버에 연결하지 못했습니다.");
        }
      }
    })();
    return () => controller.abort();
  }, [animeId, requestedEpisode, isDub, attempt]);

  const refreshStream = useCallback((currentEpisode?: number) => {
    if (automaticRefreshes.current >= 1) {
      setSource(null);
      setError("영상 서버 연결을 복구하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    automaticRefreshes.current += 1;
    setSource(null);
    if (typeof currentEpisode === "number" && Number.isInteger(currentEpisode) && currentEpisode > 0) {
      setRequestedEpisode(currentEpisode);
    }
    setAttempt(value => value + 1);
  }, []);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-white/10 bg-black/50 px-6 py-16 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        {originalPage && <a data-original href={originalPage} target="_blank" rel="noopener noreferrer"
          className="mr-3 mt-5 inline-flex rounded-xl bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200">
          원본 페이지 열기
        </a>}
        <button type="button" data-retry className="mt-5 rounded-xl bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-500"
          onClick={() => { automaticRefreshes.current = 0; setError(""); setAttempt(value => value + 1); }}>
          재생 다시 시도
        </button>
      </div>
    );
  }
  if (!source) {
    return <div role="status" className="grid aspect-video place-items-center rounded-2xl bg-black text-sm text-purple-200">최신 영상 재생 정보를 가져오는 중입니다...</div>;
  }
  return <Player key={`${animeId}:${requestedEpisode}:${isDub}:${attempt}`} {...props}
    episodeNumber={requestedEpisode} initialEpTitle={source.title || props.initialEpTitle}
    linkPreEp={source.previous === undefined ? props.linkPreEp : source.previous}
    linkNextEp={source.next === undefined ? props.linkNextEp : source.next}
    m3u8Url={source.url} defaultVttUrl={source.subtitle} streamType="m3u8"
    onRefreshStream={refreshStream} />;
}
