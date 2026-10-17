"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Clock, Film, CheckCircle2, X } from "lucide-react";

export interface HistoryItem {
  id: number;
  anime_id: string;
  anime_title: string;
  anime_poster?: string;
  episode_number: number;
  episode_title?: string;
  watch_url: string;
  watch_time: number;
  duration: number;
  is_completed: boolean;
  updated_at: string;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const kst = new Date(utc + 9 * 3600000);
    const m = String(kst.getMonth() + 1).padStart(2, "0");
    const day = String(kst.getDate()).padStart(2, "0");
    const h = String(kst.getHours()).padStart(2, "0");
    const min = String(kst.getMinutes()).padStart(2, "0");
    return `${m}-${day} ${h}:${min}`;
  } catch {
    return "";
  }
}

export default function HistoryList({ initialItems }: { initialItems: HistoryItem[] }) {
  const [items, setItems] = useState<HistoryItem[]>(initialItems);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleDelete = async (e: React.MouseEvent, animeId: string, ep: number) => {
    e.preventDefault();
    e.stopPropagation();

    setItems((prev) =>
      prev.filter((i) => !(i.anime_id === animeId && i.episode_number === ep))
    );

    try {
      await fetch(`/api/anime/history?anime_id=${animeId}&ep=${ep}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("Failed to delete history item:", err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("모든 이어보기 시청 기록을 삭제하시겠습니까?")) return;
    setIsDeleting(true);
    setItems([]);
    try {
      await fetch("/api/anime/history", { method: "DELETE" });
    } catch (err) {
      console.error("Failed to clear history:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-8 text-center backdrop-blur-md">
        <Clock className="h-12 w-12 text-sky-400/60 mb-3" />
        <h3 className="text-lg font-bold text-white">아직 시청 기록이 없습니다</h3>
        <p className="mt-1 text-xs text-[#B3B3B3]">
          드라마를 시청하면 여기에 얇은 가로 줄 형태로 시청 진도율과 함께 기록됩니다.
        </p>
        <Link
          href="/?tab=drama"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#3B3B3B] border border-[#B3B3B3]/30 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-[#2B2B2B] hover:border-white/50"
        >
          <Film className="h-3.5 w-3.5 text-sky-400" /> 최신 방영 드라마 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-[#B3B3B3]/20 pb-3">
        <h5 className="flex items-center gap-2 text-sm sm:text-base font-bold text-white">
          <Clock className="h-4 w-4 text-sky-400" />
          최근 시청 중인 드라마 ({items.length}개)
        </h5>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={isDeleting}
          className="rounded-full border border-red-500/30 px-3 py-1 text-xs font-semibold text-red-400 transition hover:bg-red-500 hover:text-white disabled:opacity-50"
        >
          전체 기록 삭제
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((item) => {
          const percent =
            item.duration > 0
              ? Math.min(100, Math.max(0, Math.round((item.watch_time / item.duration) * 100)))
              : 0;

          const watchUrl = `/watch/${item.anime_id}/${item.episode_number}`;

          return (
            <Link
              key={`${item.anime_id}_ep${item.episode_number}`}
              href={watchUrl}
              className="group relative flex items-center gap-3.5 rounded-2xl border border-[#B3B3B3]/20 bg-[#333333] p-3 backdrop-blur-md transition duration-200 hover:border-[#B3B3B3]/50 hover:bg-[#3B3B3B] hover:translate-x-1 hover:shadow-lg text-decoration-none"
            >
              <div className="relative w-[70px] h-[95px] flex-shrink-0 overflow-hidden rounded-xl bg-[#2B2B2B] shadow-md">
                {item.anime_poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.anime_poster}
                    alt={item.anime_title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                    No Poster
                  </div>
                )}
              </div>

              <div className="flex flex-1 min-w-0 flex-col justify-between h-[95px] py-0.5">
                <div className="flex items-center justify-between gap-1.5">
                  {item.is_completed ? (
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      {item.episode_title || `${item.episode_number}화`} 완주
                    </span>
                  ) : item.watch_time === 0 ? (
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/20">
                      NEW · {item.episode_title || `${item.episode_number}화`}
                    </span>
                  ) : (
                    <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-[11px] font-bold text-sky-300 border border-sky-500/40">
                      {item.episode_title || `${item.episode_number}화`}
                    </span>
                  )}

                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] text-[#B3B3B3] flex items-center gap-1"
                      suppressHydrationWarning
                    >
                      <Clock className="h-3 w-3 text-[#B3B3B3]/70" />
                      {mounted ? formatDateTime(item.updated_at) : ""}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, item.anime_id, item.episode_number)}
                      title="이 기록 삭제"
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-red-500/30 text-red-400 transition hover:bg-red-500 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <h6
                  className="font-bold text-white text-sm truncate transition group-hover:text-sky-300 my-auto"
                  title={item.anime_title}
                >
                  {item.anime_title}
                </h6>

                <div>
                  <div className="flex items-center justify-between text-xs text-[#B3B3B3] mb-1">
                    {item.is_completed ? (
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        시청 완료 (다음 화 대기)
                      </span>
                    ) : item.watch_time === 0 ? (
                      <>
                        <span className="text-[11px] text-emerald-400 font-bold">
                          신규 회차 방영!
                        </span>
                        <span className="text-[11px] text-[#B3B3B3] font-mono">
                          00:00 (처음부터)
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] text-sky-300 font-medium">이어서 보기</span>
                        <span className="text-[11px] text-[#B3B3B3] font-mono">
                          {item.duration > 0
                            ? `${formatTime(item.watch_time)} / ${formatTime(item.duration)}`
                            : "시청 중"}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        item.is_completed
                          ? "bg-emerald-400"
                          : item.watch_time === 0
                          ? "bg-emerald-400"
                          : "bg-sky-400"
                      }`}
                      style={{ width: `${item.is_completed ? 100 : percent}%` }}
                    />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
