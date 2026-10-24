"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  ShieldAlert,
  ArrowRight,
  Send,
  Sparkles,
} from "lucide-react";

interface BaseUrlSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: (newUrl: string) => void;
}

export default function BaseUrlSettingsModal({
  isOpen,
  onClose,
  onUpdated,
}: BaseUrlSettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>("https://tvwiki54.net");
  const [defaultUrl, setDefaultUrl] = useState<string>("https://tvwiki54.net");
  const [inputUrl, setInputUrl] = useState<string>("");
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [loadingCheck, setLoadingCheck] = useState<boolean>(false);
  const [loadingSave, setLoadingSave] = useState<boolean>(false);
  const [loadingDiscover, setLoadingDiscover] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState<boolean>(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  // 모달 열릴 때 현재 상태 조회
  const fetchStatus = async () => {
    setLoadingCheck(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/settings/base-url?provider=tvwiki");
      const data = await res.json();
      if (data.success) {
        setCurrentUrl(data.baseUrl);
        setDefaultUrl(data.defaultUrl);
        setInputUrl(data.baseUrl);
        setIsHealthy(Boolean(data.isHealthy));
        setLatencyMs(data.latencyMs ?? null);
        setStatusText(data.statusText || null);
      } else {
        setErrorMessage(data.message || "설정 정보를 불러오지 못했습니다.");
      }
    } catch {
      setErrorMessage("서버와 통신할 수 없습니다.");
    } finally {
      setLoadingCheck(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSuccessMessage(null);
      setNeedsConfirmation(false);
      setConfirmMessage(null);
      fetchStatus();
    }
  }, [isOpen]);

  // 텔레그램 (https://t.me/s/tvwiki_url)에서 최신 주소 원클릭 자동 탐색
  const handleAutoDiscover = async () => {
    setLoadingDiscover(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setNeedsConfirmation(false);
    setConfirmMessage(null);

    try {
      const res = await fetch("/api/settings/base-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto_discover" }),
      });
      const data = await res.json();

      if (data.success && data.baseUrl) {
        setCurrentUrl(data.baseUrl);
        setInputUrl(data.baseUrl);
        setIsHealthy(data.health ? data.health.ok : true);
        setLatencyMs(data.health ? data.health.latencyMs : null);
        setStatusText(data.health ? data.health.statusText : null);
        setSuccessMessage(
          data.message || `최신 주소(${data.baseUrl})를 찾아 자동 적용했습니다.`
        );
        if (onUpdated) {
          onUpdated(data.baseUrl);
        }
      } else {
        setErrorMessage(data.message || "주소 안내 사이트와 텔레그램에서 최신 주소를 찾지 못했습니다.");
      }
    } catch {
      setErrorMessage("최신 주소 자동 탐색 중 오류가 발생했습니다.");
    } finally {
      setLoadingDiscover(false);
    }
  };

  const handleSave = async (force = false) => {
    if (!inputUrl.trim()) {
      setErrorMessage("URL을 입력해주세요.");
      return;
    }

    setLoadingSave(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!force) {
      setNeedsConfirmation(false);
      setConfirmMessage(null);
    }

    try {
      const res = await fetch("/api/settings/base-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: inputUrl.trim(), force, provider: "tvwiki" }),
      });

      const data = await res.json();

      if (res.status === 422 && data.needsConfirmation) {
        setNeedsConfirmation(true);
        setConfirmMessage(
          data.message || "해당 도메인에 연결할 수 없습니다. 강제로 저장하시겠습니까?"
        );
        setLoadingSave(false);
        return;
      }

      if (data.success) {
        setCurrentUrl(data.baseUrl);
        setIsHealthy(data.health ? data.health.ok : true);
        setLatencyMs(data.health ? data.health.latencyMs : null);
        setStatusText(data.health ? data.health.statusText : null);
        setSuccessMessage(data.message || "TVWIKI 도메인 주소가 성공적으로 변경되었습니다.");
        setNeedsConfirmation(false);
        setConfirmMessage(null);
        if (onUpdated) {
          onUpdated(data.baseUrl);
        }
      } else {
        setErrorMessage(data.message || "저장에 실패했습니다.");
      }
    } catch {
      setErrorMessage("요청을 처리하는 중 오류가 발생했습니다.");
    } finally {
      setLoadingSave(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 모달 열려 있을 때 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const portalTarget =
    (typeof document !== "undefined" && (document.fullscreenElement as HTMLElement)) ||
    (typeof document !== "undefined" ? document.body : null);

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-purple-500/30 bg-[#0d1322] shadow-2xl shadow-purple-950/60 animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/30 text-purple-400 border border-purple-500/30">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">TVWIKI 도메인 주소 설정</h2>
              <p className="text-xs text-slate-400">
                최신 주소를 저장하면 화면을 새로고침하여 재생 정보를 갱신합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin scrollbar-thumb-purple-500/30">
          {/* Current Status Box */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">현재 적용된 TVWIKI URL</span>
              <button
                onClick={() => fetchStatus()}
                disabled={loadingCheck}
                title="상태 다시 확인"
                className="flex items-center gap-1 text-[11px] font-medium text-purple-400 hover:text-purple-300 transition"
              >
                <RefreshCw className={`h-3 w-3 ${loadingCheck ? "animate-spin" : ""}`} />
                <span>새로고침</span>
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 overflow-hidden">
              <span className="font-mono text-sm font-bold text-white truncate">{currentUrl}</span>
              <div className="flex items-center gap-1.5 shrink-0 text-xs">
                {loadingCheck ? (
                  <span className="text-slate-400">연결 확인 중...</span>
                ) : isHealthy ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    정상 ({latencyMs}ms)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    접속 실패
                  </span>
                )}
              </div>
            </div>
            {statusText && !isHealthy && (
              <p className="mt-1 text-[11px] text-rose-400/80 truncate">상태: {statusText}</p>
            )}
          </div>

          {/* 1-Click Auto Discovery from Telegram */}
          <div className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-bold text-purple-200">
                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                  <span>주소 안내 사이트와 텔레그램에서 최신 주소 탐색</span>
                </h3>
                <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                  기존 주소 접속이 안 될 경우 <code className="text-purple-300">t.me/s/tvwiki_url</code>{" "}
                  , <a href="https://tvwikiurl.net/" target="_blank" rel="noopener noreferrer" className="text-purple-300 underline">tvwikiurl.net</a>
                  과 tvwiki.store에서 접속 가능한 도메인을 찾아 적용합니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAutoDiscover}
              disabled={loadingDiscover || loadingSave}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-sky-900/40 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 transition"
            >
              {loadingDiscover ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>접속 가능한 최신 주소 탐색 중...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>최신 주소 찾기 및 자동 적용</span>
                </>
              )}
            </button>
          </div>

          {/* URL Input Form */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              직접 TVWIKI 도메인 URL 입력
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder={defaultUrl}
                className="flex-1 rounded-xl border border-white/10 bg-slate-900/80 px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none transition focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
              <button
                onClick={() => setInputUrl(defaultUrl)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200 transition shrink-0"
                title="초기 기본 주소로 복원"
              >
                기본값
              </button>
            </div>
          </div>

          {/* Messages */}
          {errorMessage && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 p-2.5 text-xs text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Needs Confirmation Alert */}
          {needsConfirmation && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
              <div className="flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                <div>
                  <p className="font-semibold text-amber-200">연결 확인 실패 경고</p>
                  <p className="mt-0.5 text-amber-300/90">{confirmMessage}</p>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={loadingSave}
                    className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-3 py-1 font-bold text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 transition"
                  >
                    <span>그래도 강제 저장하기</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/10 px-6 py-4 shrink-0 bg-slate-900/40 rounded-b-3xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={loadingSave || loadingDiscover}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:opacity-90 disabled:opacity-50 transition"
          >
            {loadingSave && <RefreshCw className="h-3 w-3 animate-spin" />}
            <span>변경 사항 저장</span>
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
