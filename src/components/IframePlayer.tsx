"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  Clock,
  Sparkles,
  Loader2,
  Film,
  PictureInPicture2,
} from "lucide-react";
import { EpisodeItem } from "./Player";
import type { ServerSource } from "@/lib/providers/types";
import { openIframePip, createIframePlaybackRestore, type IframePipSession } from "@/lib/iframePip";

interface IframePlayerProps {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
  episodeNumber: number;
  initialEpTitle?: string;
  m3u8Url?: string;
  defaultVttUrl?: string;
  linkPreEp?: number | null;
  linkNextEp?: number | null;
  isDub?: boolean;
  subEpisodes?: EpisodeItem[];
  dubEpisodes?: EpisodeItem[];
  streamType?: "m3u8" | "iframe";
  embedUrl?: string;
  serverSources?: ServerSource[];
  initialSubtitle?: any;
  initialCreator?: string;
  initialSubUrl?: string;
}

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${String(m).padStart(2, "0")}:${s.padStart(4, "0")}`;
}

function sendIframeSeekCommands(target: Window | WindowProxy | null | undefined, time: number) {
  if (!target || time <= 0) return;
  try {
    target.postMessage({ command: "seek", time }, "*");
    target.postMessage({ command: "setCurrentTime", time }, "*");
    target.postMessage({ event: "command", func: "seek", args: [time] }, "*");
    target.postMessage({ action: "seek", value: time }, "*");
    target.postMessage({ method: "setCurrentTime", value: time }, "*");
  } catch {}
}

export default function IframePlayer({
  animeId,
  animeTitle,
  animePoster,
  episodeNumber,
  initialEpTitle,
  linkPreEp,
  linkNextEp,
  subEpisodes = [],
  embedUrl = "",
  serverSources = [],
}: IframePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pipSessionRef = useRef<IframePipSession | null>(null);
  const pipOpeningRef = useRef(false);
  const mountedRef = useRef(true);
  const iframeMessageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const playbackRestoreRef = useRef(createIframePlaybackRestore());
  const pipReturnTimeRef = useRef(0);
  const [isPipOpen, setIsPipOpen] = useState(false);
  const [supportsDocumentPip, setSupportsDocumentPip] = useState<boolean | null>(null);

  // States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("anime_auto_next");
        if (saved !== null) return saved === "1" || saved === "true";
        const settingsRaw = localStorage.getItem("anime_player_settings");
        if (settingsRaw) {
          const parsed = JSON.parse(settingsRaw);
          if (typeof parsed.autoNext === "boolean") return parsed.autoNext;
        }
      } catch {}
    }
    return true;
  });
  const [isVideoEnded, setIsVideoEnded] = useState(false);
  const [isNextCardDismissed, setIsNextCardDismissed] = useState(false);
  const [endedCountdownSec, setEndedCountdownSec] = useState<number | null>(null);

  const autoNextRef = useRef(autoNextEnabled);
  useEffect(() => {
    autoNextRef.current = autoNextEnabled;
  }, [autoNextEnabled]);

  const isNextCardDismissedRef = useRef(isNextCardDismissed);
  useEffect(() => {
    isNextCardDismissedRef.current = isNextCardDismissed;
  }, [isNextCardDismissed]);

  const lastHistorySaveTime = useRef(0);
  const lastCurrentTimeRef = useRef(0);
  const lastDurationRef = useRef(0);

  const setMobileLandscape = useCallback(async (lock: boolean) => {
    if (typeof window === "undefined") return;
    const isMobile = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches;
    if (!isMobile) return;
    const orientation = window.screen?.orientation as (ScreenOrientation & {
      lock?: (orientation: "landscape") => Promise<void>;
      unlock?: () => void;
    }) | undefined;
    if (!orientation) return;
    try {
      if (lock && typeof orientation.lock === "function") {
        await orientation.lock("landscape");
      } else if (!lock && typeof orientation.unlock === "function") {
        orientation.unlock();
      }
    } catch {
      // iOS Safari and some installed PWAs do not allow programmatic locking.
    }
  }, []);

  // Show temporary toast notice
  const showNotice = useCallback((msg: string, duration = 3000) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, duration);
  }, []);

  const [activeRipple, setActiveRipple] = useState<{ side: "left" | "right"; text: string } | null>(null);
  const rippleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerSkipRipple = useCallback((side: "left" | "right", seconds: number) => {
    if (rippleTimerRef.current) clearTimeout(rippleTimerRef.current);
    setActiveRipple({ side, text: side === "left" ? `-${seconds}s` : `+${seconds}s` });
    rippleTimerRef.current = setTimeout(() => {
      setActiveRipple(null);
    }, 650);
  }, []);

  const seekVideoBy = useCallback((delta: number) => {
    const cur = lastCurrentTimeRef.current || currentVideoTime;
    const newTime = Math.max(0, cur + delta);
    if (iframeRef.current?.contentWindow) {
      sendIframeSeekCommands(iframeRef.current.contentWindow, newTime);
    }
    setCurrentVideoTime(newTime);
    lastCurrentTimeRef.current = newTime;
    showNotice(delta > 0 ? `⏩ ${delta}초 앞으로` : `⏪ ${Math.abs(delta)}초 뒤로`);
  }, [currentVideoTime, showNotice]);

  const lastIframeTouchTime = useRef(0);
  const lastIframeTouchSide = useRef<"left" | "right" | null>(null);
  const cumulativeSkipRef = useRef<{ side: "left" | "right" | null; sec: number; lastTime: number }>({
    side: null,
    sec: 0,
    lastTime: 0,
  });

  const executeCumulativeIframeSeek = useCallback((side: "left" | "right") => {
    const now = Date.now();
    if (cumulativeSkipRef.current.side === side && now - cumulativeSkipRef.current.lastTime < 750) {
      cumulativeSkipRef.current.sec += 10;
    } else {
      cumulativeSkipRef.current.side = side;
      cumulativeSkipRef.current.sec = 10;
    }
    cumulativeSkipRef.current.lastTime = now;

    seekVideoBy(side === "left" ? -10 : 10);
    triggerSkipRipple(side, cumulativeSkipRef.current.sec);
  }, [seekVideoBy, triggerSkipRipple]);

  const handleIframeDoubleTap = useCallback((side: "left" | "right") => {
    const now = Date.now();
    const diff = now - lastIframeTouchTime.current;
    if (lastIframeTouchSide.current === side && diff < 320) {
      executeCumulativeIframeSeek(side);
      lastIframeTouchTime.current = 0;
      lastIframeTouchSide.current = null;
    } else {
      lastIframeTouchTime.current = now;
      lastIframeTouchSide.current = side;
      setTimeout(() => {
        if (lastIframeTouchSide.current === side && Date.now() - lastIframeTouchTime.current >= 320) {
          lastIframeTouchSide.current = null;
        }
      }, 320);
    }
  }, [executeCumulativeIframeSeek]);

  const lastSeekButtonTouch = useRef(0);
  const lastSeekPointerType = useRef("");
  const handleSeekButtonClick = useCallback((_event: React.MouseEvent<HTMLButtonElement>, side: "left" | "right") => {
    lastIframeTouchTime.current = 0;
    lastIframeTouchSide.current = null;
    executeCumulativeIframeSeek(side);
  }, [executeCumulativeIframeSeek]);

  useEffect(() => {
    mountedRef.current = true;
    setSupportsDocumentPip(typeof (window as any).documentPictureInPicture?.requestWindow === "function");
    return () => {
      mountedRef.current = false;
      pipSessionRef.current?.close();
      pipSessionRef.current = null;
    };
  }, []);

  const toggleIframePip = useCallback(async () => {
    if (pipSessionRef.current) {
      pipSessionRef.current.close();
      return;
    }
    if (pipOpeningRef.current || !containerRef.current) return;
    if (typeof (window as any).documentPictureInPicture?.requestWindow !== "function") {
      showNotice("PIP 모드는 데스크톱 Chrome 또는 Edge에서 사용할 수 있습니다.");
      return;
    }
    pipOpeningRef.current = true;
    try {
      const session = await openIframePip(containerRef.current, {
        beforeMove: () => {
          const currentTime = lastCurrentTimeRef.current || currentVideoTime;
          pipReturnTimeRef.current = currentTime;
          playbackRestoreRef.current.queue(currentTime);
        },
        onMove: async (pipWindow) => {
          const currentTime = pipReturnTimeRef.current;
          if (currentTime > 0) {
            const pipIframe = pipWindow.document.querySelector("iframe") as HTMLIFrameElement | null;
            const sendSeek = () => {
              const target = pipIframe?.contentWindow || iframeRef.current?.contentWindow;
              sendIframeSeekCommands(target, currentTime);
            };
            if (pipIframe) {
              pipIframe.addEventListener("load", sendSeek);
            }
            [0, 250, 750, 1500, 3000, 5000, 8000].forEach((delay) => {
              setTimeout(sendSeek, delay);
            });
          }
        },
        onMessage: (event) => iframeMessageHandlerRef.current?.(event),
        onClose: () => {
          pipSessionRef.current = null;
          const returnTime = pipReturnTimeRef.current;
          if (returnTime > 0) {
            playbackRestoreRef.current.queue(returnTime);
            const restoredIframe = containerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
            const sendReturnSeek = () => {
              const target = restoredIframe?.contentWindow || iframeRef.current?.contentWindow;
              sendIframeSeekCommands(target, returnTime);
            };
            if (restoredIframe) {
              restoredIframe.addEventListener("load", sendReturnSeek);
            }
            [0, 250, 750, 1500, 3000, 5000, 8000].forEach((delay) => {
              setTimeout(sendReturnSeek, delay);
            });
          }
          if (mountedRef.current) setIsPipOpen(false);
        },
      });
      if (!mountedRef.current) {
        session.close();
        return;
      }
      pipSessionRef.current = session;
      setIsPipOpen(true);
    } catch (error) {
      console.warn("Iframe PiP failed:", error);
      if (mountedRef.current) showNotice("PIP 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      pipOpeningRef.current = false;
    }
  }, [currentVideoTime, showNotice]);

  const syncHistory = useCallback(
    (isEnded = false) => {
      const curTime = lastCurrentTimeRef.current;
      const dur = lastDurationRef.current;
      if (curTime <= 2 && !isEnded) return;

      const isCompleted = isEnded || (dur > 0 && curTime / dur > 0.85);

      fetch("/api/anime/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animeId,
          animeTitle,
          animePoster: animePoster || "",
          episodeNumber,
          episodeTitle: initialEpTitle || `${episodeNumber}화`,
          watchUrl: `/watch/${animeId}/${episodeNumber}`,
          currentTime: Math.floor(curTime),
          duration: Math.floor(dur),
          isCompleted,
          anime_id: animeId,
          anime_title: animeTitle,
          anime_poster: animePoster || "",
          episode_number: episodeNumber,
          episode_title: initialEpTitle || `${episodeNumber}화`,
          watch_url: `/watch/${animeId}/${episodeNumber}`,
          watch_time: Math.floor(curTime),
          is_completed: isCompleted,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [animeId, animeTitle, animePoster, episodeNumber, initialEpTitle]
  );

  const navigateToNextEpisode = useCallback(() => {
    if (!linkNextEp) return;
    syncHistory(true);
    window.location.href = `/watch/${animeId}/${linkNextEp}`;
  }, [animeId, linkNextEp, syncHistory]);

  const toggleAutoNext = useCallback(() => {
    setAutoNextEnabled((prev) => {
      const nextVal = !prev;
      try {
        localStorage.setItem("anime_auto_next", nextVal ? "1" : "0");
        const raw = localStorage.getItem("anime_player_settings");
        if (raw) {
          const parsed = JSON.parse(raw);
          localStorage.setItem("anime_player_settings", JSON.stringify({ ...parsed, autoNext: nextVal }));
        }
      } catch {}
      showNotice(`다음 화 자동재생: ${nextVal ? "활성화(ON)" : "비활성화(OFF)"}`);
      return nextVal;
    });
  }, [showNotice]);

  const sendNextEpisodeInfoToIframe = useCallback(() => {
    if (!iframeRef.current?.contentWindow || !linkNextEp || !autoNextRef.current) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "nextEpisodeInfo",
          idx: linkNextEp,
          url: `/watch/${animeId}/${linkNextEp}`,
          title: `${animeTitle} ${linkNextEp}화`,
          thumb: animePoster || "",
        },
        "*"
      );
    } catch {}
  }, [animeId, animeTitle, animePoster, linkNextEp]);

  // 에피소드 변경 시 다음 화 안내 상태 초기화 및 원본 플레이어에 다음화 메타데이터 전달
  useEffect(() => {
    setIsVideoEnded(false);
    setIsNextCardDismissed(false);
    setEndedCountdownSec(null);
    const t = setTimeout(() => {
      sendNextEpisodeInfoToIframe();
    }, 1200);
    return () => clearTimeout(t);
  }, [episodeNumber, embedUrl, sendNextEpisodeInfoToIframe]);

  // 영상 종료(ended) 시 5초 넷플릭스 카운트다운 및 자동 다음화 이동
  useEffect(() => {
    if (!isVideoEnded || !linkNextEp || isNextCardDismissed) {
      setEndedCountdownSec(null);
      return;
    }
    if (!autoNextEnabled) {
      setEndedCountdownSec(null);
      return;
    }
    setEndedCountdownSec(5);
    const interval = setInterval(() => {
      setEndedCountdownSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          navigateToNextEpisode();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVideoEnded, linkNextEp, isNextCardDismissed, autoNextEnabled, navigateToNextEpisode]);

  // postMessage polling (100ms) & message listeners
  useEffect(() => {
    const timer = setInterval(() => {
      if (pipSessionRef.current) return;
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ command: "getTime" }, "*");
      }
    }, 100);

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.source !== iframeRef.current?.contentWindow) return;
      const playerDocument = containerRef.current?.ownerDocument || document;

      if (event.data.source === "tvp" && event.data.type === "requestNextEpisode") {
        sendNextEpisodeInfoToIframe();
        return;
      }

      // tvwiki / bunny-frame 원본 플레이어(tvp) 종료 및 다음화 이동 이벤트 처리
      if (
        (event.data.source === "tvp" && event.data.type === "goNextEpisode") ||
        event.data.command === "goNextEpisode"
      ) {
        if (linkNextEp) {
          navigateToNextEpisode();
        }
        return;
      }

      if (
        (event.data.source === "tvp" && event.data.type === "ended") ||
        event.data.type === "video:ended" ||
        event.data.event === "ended"
      ) {
        syncHistory(true);
        setIsVideoEnded(true);
        return;
      }

      if (event.data.zenCommand === "getFullscreenState") {
        event.source?.postMessage(
          { zenFullscreenState: !!playerDocument.fullscreenElement },
          "*" as any
        );
      }

      if (event.data.zenCommand === "toggleFullscreen") {
        if (pipSessionRef.current) return;
        if (!playerDocument.fullscreenElement) {
          containerRef.current?.requestFullscreen?.().catch(() => {});
        } else {
          playerDocument.exitFullscreen?.().catch(() => {});
        }
      }

      if (typeof event.data.currentTime === "number" && Number.isFinite(event.data.currentTime)) {
        const time = event.data.currentTime;
        if (!playbackRestoreRef.current.accept(time, Number(event.data.duration) || 0, (target) => {
          sendIframeSeekCommands(iframeRef.current?.contentWindow, target);
        })) return;
        setCurrentVideoTime(time);
        lastCurrentTimeRef.current = time;
        if ((pipSessionRef.current || pipOpeningRef.current) && time > 0) {
          pipReturnTimeRef.current = time;
        }

        if (typeof event.data.duration === "number") {
          setVideoDuration(event.data.duration);
          lastDurationRef.current = event.data.duration;
          if (event.data.duration > 30 && event.data.duration - time <= 0.6 && time > 10) {
            setIsVideoEnded(true);
          }
        }

        const now = Date.now();
        if (now - lastHistorySaveTime.current > 10000 && time > 2) {
          lastHistorySaveTime.current = now;
          syncHistory(false);
        }
      }
    };

    iframeMessageHandlerRef.current = handleMessage;
    window.addEventListener("message", handleMessage);

    const handleFullscreenChange = () => {
      const fullscreen = !!document.fullscreenElement;
      setIsFullscreen(fullscreen);
      void setMobileLandscape(fullscreen);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    const handleUnload = () => {
      syncHistory(false);
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      syncHistory(false);
      clearInterval(timer);
      window.removeEventListener("message", handleMessage);
      if (iframeMessageHandlerRef.current === handleMessage) iframeMessageHandlerRef.current = null;
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      void setMobileLandscape(false);
    };
  }, [setMobileLandscape, syncHistory, linkNextEp, navigateToNextEpisode]);

  // 이전 시청 기록 조회 및 이어보기 안내 / 복원 시도
  useEffect(() => {
    let isCancelled = false;
    async function checkSavedHistory() {
      try {
        const res = await fetch(`/api/anime/history?anime_id=${encodeURIComponent(animeId)}`);
        const data = await res.json();
        if (isCancelled || !data.success || !Array.isArray(data.items)) return;

        const epItem = data.items.find((item: any) => Number(item.episode_number) === Number(episodeNumber));
        if (epItem) {
          const savedTime = parseFloat(epItem.watch_time || epItem.current_time || "0");
          if (savedTime > 10 && !epItem.is_completed) {
            showNotice(`이어보기: ${formatTime(savedTime)}부터 시청 기록이 있습니다.`);
            if (iframeRef.current?.contentWindow) {
              sendIframeSeekCommands(iframeRef.current.contentWindow, savedTime);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch drama history for resume:", err);
      }
    }
    checkSavedHistory();
    return () => {
      isCancelled = true;
    };
  }, [animeId, episodeNumber, showNotice]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Top Header / Breadcrumb & Episode Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href={`/anime/${animeId}`}
            onClick={() => syncHistory(false)}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600/20 px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-600 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            작품으로
          </Link>
          <div>
            <h1 className="text-base font-bold text-white line-clamp-1">
              {animeTitle}
            </h1>
            <p className="text-xs text-purple-400">
              {initialEpTitle || `${episodeNumber}화`} • 1080p HD
            </p>
          </div>
        </div>

        {/* Episode Switcher Dropdown & Nav Buttons */}
        <div className="flex items-center gap-2">
          {linkPreEp && (
            <Link
              href={`/watch/${animeId}/${linkPreEp}`}
              onClick={() => syncHistory(false)}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              이전화
            </Link>
          )}

          {subEpisodes.length > 0 && (
            <div className="relative">
              <select
                value={episodeNumber}
                onChange={(e) => {
                  const targetEp = e.target.value;
                  if (targetEp) {
                    syncHistory(false);
                    window.location.href = `/watch/${animeId}/${targetEp}`;
                  }
                }}
                className="appearance-none rounded-xl border border-purple-500/30 bg-slate-800/90 py-1.5 pl-3 pr-8 text-xs font-bold text-purple-200 outline-none transition focus:border-purple-400 cursor-pointer"
              >
                {subEpisodes.map((ep) => (
                  <option key={ep.number} value={ep.number} className="bg-slate-900 text-white">
                    {ep.title || `${ep.number}화`}
                  </option>
                ))}
              </select>
              <List className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400" />
            </div>
          )}

          {linkNextEp && (
            <Link
              href={`/watch/${animeId}/${linkNextEp}`}
              onClick={() => syncHistory(true)}
              className="flex items-center gap-1 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/30 transition hover:bg-purple-500"
            >
              다음화
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Main Video Box */}
      <div>
        <div
          ref={containerRef}
          className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-purple-500/30 bg-black shadow-2xl shadow-purple-950/40 ${
            isFullscreen ? "fixed inset-0 z-50 h-screen w-screen rounded-none border-none" : ""
          }`}
        >
          {supportsDocumentPip !== null && embedUrl ? (
            <iframe
              ref={iframeRef}
              src={embedUrl}
              title="Drama Player"
              className="absolute inset-0 h-full w-full border-0 z-0"
              allow={`autoplay; fullscreen; encrypted-media; picture-in-picture${supportsDocumentPip ? " 'none'" : ""}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-purple-400 mb-3" />
              <p className="text-sm font-semibold text-slate-300">
                영상 스트림 플레이어를 불러오는 중입니다...
              </p>
            </div>
          )}

          {/* Double-Tap Netflix Ripple Feedback (하단 툴바 10s 버튼 클릭 시 피드백) */}
          {activeRipple && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 z-30 flex items-center justify-center pointer-events-none ${
                activeRipple.side === "left" ? "left-[10%]" : "right-[10%]"
              }`}
            >
              <div className="flex flex-col items-center justify-center rounded-full bg-black/70 backdrop-blur-md px-5 py-4 border border-white/20 text-white shadow-2xl animate-fade-in">
                <span className="text-xl font-black">{activeRipple.text}</span>
                <span className="text-[11px] text-purple-300 font-bold">
                  {activeRipple.side === "left" ? "⏪ 10초 뒤로" : "⏩ 10초 앞으로"}
                </span>
              </div>
            </div>
          )}

          {/* 넷플릭스(Netflix) 스타일 다음 화 전환 카드 오버레이 (종료 20초 전 표시) */}
          {linkNextEp &&
            !isNextCardDismissed &&
            (isVideoEnded || (videoDuration > 25 && videoDuration - currentVideoTime <= 20 && videoDuration - currentVideoTime >= 0)) && (
              <div className="art-netflix-next-card active" role="region" aria-label="다음 에피소드 안내">
                <div className="art-netflix-next-header">
                  <span className="art-netflix-next-badge">NEXT EPISODE</span>
                  <span className="art-netflix-next-status">
                    {autoNextEnabled
                      ? endedCountdownSec !== null
                        ? endedCountdownSec <= 0
                          ? "다음 화로 자동 연결 중..."
                          : `${endedCountdownSec}초 후 자동 재생`
                        : `${Math.max(1, Math.ceil(videoDuration - currentVideoTime))}초 후 자동 재생`
                      : "다음 에피소드 준비됨"}
                  </span>
                </div>
                <div className="art-netflix-next-title">
                  {animeTitle} • {linkNextEp}화
                </div>
                <div className="art-netflix-next-actions">
                  <button
                    type="button"
                    onClick={navigateToNextEpisode}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      navigateToNextEpisode();
                    }}
                    className="art-netflix-next-play-btn"
                  >
                    <span
                      className="art-netflix-next-progress"
                      style={{
                        width: autoNextEnabled
                          ? endedCountdownSec !== null
                            ? `${Math.min(100, Math.max(0, ((5 - endedCountdownSec) / 5) * 100))}%`
                            : `${Math.min(100, Math.max(0, ((20 - Math.max(0, videoDuration - currentVideoTime)) / 20) * 100))}%`
                          : "100%",
                      }}
                    />
                    <span className="art-netflix-next-play-content">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span>다음 화 재생 ({linkNextEp}화)</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsNextCardDismissed(true);
                      showNotice("현재 화를 끝까지 시청합니다.");
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setIsNextCardDismissed(true);
                      showNotice("현재 화를 끝까지 시청합니다.");
                    }}
                    className="art-netflix-next-cancel-btn"
                  >
                    <span>계속 보기</span>
                  </button>
                </div>
              </div>
            )}

          {/* Toast Notification Banner inside player */}
          {noticeMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-purple-500/40 bg-slate-900/90 px-4 py-2 text-xs font-bold text-purple-200 shadow-2xl backdrop-blur-md animate-fade-in pointer-events-none">
              <Sparkles className="h-4 w-4 text-purple-400" />
              {noticeMessage}
            </div>
          )}
        </div>
      </div>

      {/* Player Control Toolbar (자막 UI 제거, 재생/탐색/PIP/전체화면 컨트롤만 유지) */}
      <div className="rounded-2xl border border-purple-500/20 bg-slate-900/70 p-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* 스트리밍 소스 뱃지 */}
            <span className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 text-xs font-bold text-purple-300">
              <Film className="h-3.5 w-3.5 text-purple-400" />
              {serverSources[0]?.label || "1080p 고화질 스트림"}
            </span>

            {/* Video Time Monitor & Skip Buttons */}
            <button
              type="button"
              onClick={toggleIframePip}
              aria-pressed={isPipOpen}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-600/20 px-2.5 py-1 text-xs font-bold text-purple-200 transition hover:bg-purple-600 hover:text-white"
              title="작은 창(PIP)으로 열기"
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
              {isPipOpen ? "PIP 닫기" : "PIP 모드"}
            </button>
            <span className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-sky-400">
              <Clock className="h-3 w-3" />
              {formatTime(currentVideoTime)} / {formatTime(videoDuration)}
            </span>

            {/* 10초 스킵 탐색 버튼 */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onPointerUp={(event) => { lastSeekPointerType.current = event.pointerType; }}
                onTouchEnd={() => { lastSeekPointerType.current = "touch"; lastSeekButtonTouch.current = Date.now(); }}
                onClick={(event) => handleSeekButtonClick(event, "left")}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/90 px-2.5 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700 active:scale-95"
                title="10초 뒤로 이동"
              >
                ⏪ -10s
              </button>
              <button
                type="button"
                onPointerUp={(event) => { lastSeekPointerType.current = event.pointerType; }}
                onTouchEnd={() => { lastSeekPointerType.current = "touch"; lastSeekButtonTouch.current = Date.now(); }}
                onClick={(event) => handleSeekButtonClick(event, "right")}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/90 px-2.5 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700 active:scale-95"
                title="10초 앞으로 이동"
              >
                ⏩ +10s
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 다음 화 자동재생 토글 */}
            <label
              htmlFor="iframeAutoNextToggle"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition border cursor-pointer select-none ${
                autoNextEnabled
                  ? "bg-indigo-600/20 text-indigo-200 border-indigo-500/50 shadow-sm"
                  : "bg-slate-800/80 text-slate-400 border-slate-700"
              }`}
            >
              <input
                type="checkbox"
                id="iframeAutoNextToggle"
                checked={autoNextEnabled}
                onChange={toggleAutoNext}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-600 accent-indigo-600 cursor-pointer"
              />
              <span>다음 화 자동재생</span>
            </label>

            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" /> 축소
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" /> 전체화면
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
