"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Player, { type PlayerProps } from "./Player";
import { decodeHlsKey } from "@/lib/hlsKey";

type EpisodePlaybackProps = Omit<PlayerProps,
  "m3u8Url" | "defaultVttUrl" | "streamType" | "embedUrl" | "serverSources" | "onRefreshStream"
>;

interface PlaybackSource {
  url: string;
  rawUrl?: string;
  embedUrl?: string;
  serverSources?: PlayerProps["serverSources"];
  streamType?: "m3u8" | "iframe";
  subtitle: string;
  title?: string;
  previous?: number | null;
  next?: number | null;
}

export async function buildClientProxiedManifestBlobUrl(
  rawM3u8Url: string,
  playerRef = "https://player.bunny-frame.online/",
  signal?: AbortSignal
): Promise<string | null> {
  if (!rawM3u8Url || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  try {
    const res = await fetch(rawM3u8Url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim().startsWith("#EXTM3U")) return null;

    const lines = text.split(/\r?\n/);
    let keyDataUri = "";

    // Find and decode #EXT-X-KEY on the client so poorcdn's IP-bound key7 token succeeds
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped.startsWith("#EXT-X-KEY:") && stripped.includes('URI="')) {
        const match = stripped.match(/URI="([^"]+)"/);
        if (match && match[1]) {
          const absKeyUrl = new URL(match[1], rawM3u8Url).toString();
          const keyRes = await fetch(absKeyUrl, {
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal,
          });
          if (!keyRes.ok) return null;
          const rawKeyBytes = new Uint8Array(await keyRes.arrayBuffer());
          const decodedKey = decodeHlsKey(rawKeyBytes);
          let binary = "";
          for (let i = 0; i < decodedKey.length; i++) {
            binary += String.fromCharCode(decodedKey[i]);
          }
          keyDataUri = `data:application/octet-stream;base64,${btoa(binary)}`;
          break;
        }
      }
    }

    const isMasterPlaylist = text.includes("#EXT-X-STREAM-INF");
    let prevLine = "";
    const newLines: string[] = [];

    for (const line of lines) {
      const stripped = line.trim();
      const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      if (stripped && !stripped.startsWith("#")) {
        const absUrl = new URL(stripped, rawM3u8Url).toString();
        const isSubPlaylist =
          isMasterPlaylist ||
          prevLine.startsWith("#EXT-X-STREAM-INF") ||
          absUrl.includes(".m3u8") ||
          absUrl.includes("/m3/") ||
          absUrl.endsWith(".txt");
        if (isSubPlaylist) {
          newLines.push(
            `${origin}/api/anime/stream/m3u8?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(playerRef)}`
          );
        } else {
          newLines.push(
            `${origin}/api/anime/stream/segment?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(playerRef)}`
          );
        }
      } else if (stripped.startsWith("#EXT-X-KEY:") && stripped.includes('URI="')) {
        if (keyDataUri) {
          newLines.push(stripped.replace(/URI="([^"]+)"/, `URI="${keyDataUri}"`));
        } else {
          const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
            const abs = new URL(rawUri, rawM3u8Url).toString();
            return `URI="${origin}/api/anime/stream/segment?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(playerRef)}"`;
          });
          newLines.push(replaced);
        }
      } else if (stripped.startsWith("#EXT-X-MEDIA:") && stripped.includes('URI="')) {
        const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
          const abs = new URL(rawUri, rawM3u8Url).toString();
          return `URI="${origin}/api/anime/stream/m3u8?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(playerRef)}"`;
        });
        newLines.push(replaced);
      } else {
        newLines.push(line);
      }
      if (stripped) prevLine = stripped;
    }

    const blob = new Blob([newLines.join("\n")], { type: "application/vnd.apple.mpegurl" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
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
          let resolvedM3u8Url: string = data.proxied_m3u8;
          if (typeof data.raw_m3u8 === "string" && data.raw_m3u8.startsWith("https://")) {
            const clientBlobUrl = await buildClientProxiedManifestBlobUrl(
              data.raw_m3u8,
              typeof data.player_ref === "string" && data.player_ref ? data.player_ref : "https://player.bunny-frame.online/",
              controller.signal
            );
            if (clientBlobUrl) {
              resolvedM3u8Url = clientBlobUrl;
            }
          }
          if (!controller.signal.aborted) {
            let safeEmbedUrl = "";
            if (typeof data.embed_url === "string" && data.embed_url) {
              try {
                const parsedEmbed = new URL(data.embed_url);
                if (parsedEmbed.protocol === "https:" && parsedEmbed.hostname === "player.bunny-frame.online") {
                  safeEmbedUrl = parsedEmbed.toString();
                }
              } catch {}
            }
            setSource({
              url: resolvedM3u8Url,
              rawUrl: typeof data.raw_m3u8 === "string" ? data.raw_m3u8 : undefined,
              embedUrl: safeEmbedUrl || undefined,
              serverSources: Array.isArray(data.server_sources) ? data.server_sources : undefined,
              subtitle: data.proxied_vtt || "",
              title: data.episode_title,
              previous: data.link_pre_ep_num,
              next: data.link_next_ep_num,
            });
          }
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
      setSource(prev => {
        if (prev?.embedUrl) {
          return { ...prev, streamType: "iframe" };
        }
        setError("영상 서버 연결을 복구하지 못했습니다. 다시 시도해 주세요.");
        return null;
      });
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
    m3u8Url={source.url} defaultVttUrl={source.subtitle} streamType={source.streamType || "m3u8"}
    embedUrl={source.embedUrl} serverSources={source.serverSources}
    onRefreshStream={refreshStream} />;
}
