"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallContext = createContext<{
  install: () => Promise<void>;
  installed: boolean;
  installing: boolean;
} | null>(null);

export function PwaInstallButton({ className = "" }: { className?: string }) {
  const install = useContext(InstallContext);
  if (!install) return null;
  return (
    <button
      type="button"
      data-pwa-install
      onClick={install.install}
      disabled={install.installed || install.installing}
      className={
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-60 " +
        className
      }
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {install.installed ? "설치됨" : install.installing ? "설치 중…" : "앱 설치"}
    </button>
  );
}

export default function PwaRegister({ children }: { children?: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installingRef = useRef(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const registerWorker = () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.warn("[PWA] Service Worker registration failed:", err);
        });
      }
    };
    if (document.readyState === "complete") registerWorker();
    else window.addEventListener("load", registerWorker, { once: true });

    const standalone = window.matchMedia("(display-mode: standalone)");
    const isStandalone = () =>
      standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
    setInstalled(isStandalone());

    const ua = navigator.userAgent;
    if (
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    ) {
      setInstructions("Safari에서 이 사이트를 열고 공유 버튼 → 홈 화면에 추가를 선택하세요.");
    } else if (/Android/i.test(ua)) {
      setInstructions(
        "Chrome 메뉴(⋮)에서 앱 설치 또는 홈 화면에 추가를 선택하세요. 앱 안의 브라우저라면 Chrome으로 열어 주세요."
      );
    } else {
      setInstructions(
        "Chrome 또는 Edge의 주소창 설치 아이콘이나 브라우저 메뉴의 앱 설치를 이용하세요. Mac Safari에서는 파일 → Dock에 추가를 선택하세요."
      );
    }

    const handleInstalled = () => {
      setInstalled(true);
      setShowInstallBanner(false);
      promptRef.current = null;
      setDeferredPrompt(null);
    };
    const handleDisplayMode = () => {
      if (isStandalone()) handleInstalled();
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isStandalone()) return;
      promptRef.current = event as BeforeInstallPromptEvent;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setInstalled(false);
      setError("");
      let dismissed = false;
      try {
        dismissed = !!localStorage.getItem("dramaland_pwa_dismissed");
      } catch {}
      if (!dismissed) setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    standalone.addEventListener("change", handleDisplayMode);
    return () => {
      window.removeEventListener("load", registerWorker);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      standalone.removeEventListener("change", handleDisplayMode);
    };
  }, []);

  const handleInstallClick = async () => {
    if (installed || installingRef.current) return;
    setError("");
    const prompt = promptRef.current;
    if (!prompt) {
      setShowInstallBanner(true);
      return;
    }
    promptRef.current = null;
    setDeferredPrompt(null);
    installingRef.current = true;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setShowInstallBanner(false);
      }
    } catch {
      setError("설치창을 열지 못했습니다. 아래 방법으로 설치해 주세요.");
      setShowInstallBanner(true);
    } finally {
      installingRef.current = false;
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    setShowInstallBanner(false);
    try {
      localStorage.setItem("dramaland_pwa_dismissed", "true");
    } catch {}
  };

  return (
    <InstallContext.Provider value={{ install: handleInstallClick, installed, installing }}>
      {children}
      {showInstallBanner && !installed && (
        <div
          data-install-banner
          role="region"
          aria-label="앱 설치 안내"
          className="fixed bottom-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] left-[max(1rem,env(safe-area-inset-left,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] sm:left-auto sm:right-6 z-50 max-w-sm rounded-2xl border border-[#B3B3B3]/20 bg-[#333333] p-4 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3B3B3B] text-white">
              <Download className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-white">DramaLand 앱 설치</h4>
              <p className="mt-1 text-xs leading-relaxed text-[#B3B3B3]" aria-live="polite">
                {error && <span className="mb-1 block text-white">{error}</span>}
                {deferredPrompt
                  ? "홈 화면에 앱으로 추가하여 전체 화면으로 빠르게 시청하세요."
                  : instructions}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {deferredPrompt && (
                  <button
                    type="button"
                    onClick={handleInstallClick}
                    disabled={installing}
                    className="min-h-11 rounded-lg bg-white px-3 text-xs font-bold text-[#2B2B2B] transition hover:bg-[#D4D4D4] disabled:opacity-60"
                  >
                    앱 설치하기
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="min-h-11 rounded-lg px-2.5 text-xs text-[#B3B3B3] transition hover:text-white"
                >
                  닫기
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-[#B3B3B3] transition hover:text-white"
              aria-label="설치 안내 닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </InstallContext.Provider>
  );
}
