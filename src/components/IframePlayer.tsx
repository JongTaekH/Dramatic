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
  }, [setMobileLandscape, syncHistory]);

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

          {/* Mobile Netflix Double-Tap Skip Zones */}
          <div className="absolute top-14 bottom-20 inset-x-0 z-25 flex pointer-events-none select-none md:hidden">
            <div
              className="w-[32%] h-full pointer-events-auto cursor-pointer touch-manipulation"
              onTouchEnd={() => {
                handleIframeDoubleTap("left");
              }}
            />
            <div className="flex-1 h-full pointer-events-none" />
            <div
              className="w-[32%] h-full pointer-events-auto cursor-pointer touch-manipulation"
              onTouchEnd={() => {
                handleIframeDoubleTap("right");
              }}
            />
          </div>

          {/* Double-Tap Netflix Ripple Feedback */}
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
