"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2, ArrowDown } from "lucide-react";

const PULL_THRESHOLD = 64;
const MAX_PULL = 90;

export default function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isEligibleRef = useRef(false);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          ".art-video-player, .artplayer-wrapper, video, input, textarea, select, [role='dialog'], .player-settings-modal-root"
        )
      ) {
        isEligibleRef.current = false;
        return;
      }

      if (window.scrollY <= 2) {
        isEligibleRef.current = true;
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
      } else {
        isEligibleRef.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEligibleRef.current || isRefreshingRef.current) return;

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startYRef.current;
      const deltaX = currentX - startXRef.current;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isEligibleRef.current = false;
        setPullDistance(0);
        setIsPulling(false);
        return;
      }

      if (deltaY > 0 && window.scrollY <= 0) {
        if (e.cancelable) {
          e.preventDefault();
        }

        const damped = Math.min(MAX_PULL, Math.pow(deltaY, 0.82) * 1.3);
        setPullDistance(damped);
        setIsPulling(true);
      } else if (deltaY <= 0) {
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    const handleTouchEnd = () => {
      if (!isEligibleRef.current) return;
      isEligibleRef.current = false;

      if (pullDistance >= PULL_THRESHOLD && !isRefreshingRef.current) {
        setIsRefreshing(true);
        setPullDistance(52);

        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(25);
          } catch {}
        }

        setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [pullDistance]);

  if (pullDistance <= 0 && !isRefreshing) return null;

  const progress = Math.min(1, pullDistance / PULL_THRESHOLD);
  const isReady = pullDistance >= PULL_THRESHOLD;

  return (
    <div
      className="fixed left-1/2 z-[9999] -translate-x-1/2 pointer-events-none transition-transform"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        transform: `translate(-50%, ${pullDistance - 52}px)`,
        transition: isPulling ? "none" : "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      aria-hidden="true"
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-xl backdrop-blur-lg transition-all duration-200 ${
          isReady || isRefreshing
            ? "border-[#FFFFFF]/60 bg-[#3B3B3B] shadow-lg scale-105"
            : "border-[#B3B3B3]/20 bg-[#333333] shadow-black/50"
        }`}
        style={{
          opacity: Math.max(0.2, progress),
          transform: `scale(${0.75 + progress * 0.25})`,
        }}
      >
        {isRefreshing ? (
          <Loader2 className="h-5 w-5 animate-spin text-[#FFFFFF]" />
        ) : (
          <ArrowDown
            className={`h-5 w-5 transition-transform duration-150 ${
              isReady ? "text-[#FFFFFF] rotate-180" : "text-[#B3B3B3]"
            }`}
            style={{
              transform: isReady ? "rotate(180deg)" : `rotate(${progress * 180}deg)`,
            }}
          />
        )}
      </div>
    </div>
  );
}
