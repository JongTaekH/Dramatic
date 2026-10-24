"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { LogIn, LogOut, User, Globe, Settings, Users, ChevronDown } from "lucide-react";
import { PwaInstallButton } from "./PwaRegister";
import BaseUrlSettingsModal from "./BaseUrlSettingsModal";
import NavbarSearch from "./NavbarSearch";

interface CurrentUser {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
}

export default function Navbar() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [domainStatus, setDomainStatus] = useState<"healthy" | "unhealthy" | "loading">("loading");

  const menuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingAuth(false));

    fetch("/api/settings/base-url?provider=tvwiki")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDomainStatus(data.isHealthy ? "healthy" : "unhealthy");
        }
      })
      .catch(() => setDomainStatus("unhealthy"));
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setCurrentUser(null);
      window.location.href = "/login";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-[#B3B3B3]/20 bg-[#2B2B2B]/95 backdrop-blur-md safe-top">
        <div className="mx-auto flex h-16 min-w-0 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 gap-2 lg:gap-3 safe-x">
          {/* Logo (Dramas Wordmark) */}
          <Link href="/" className="flex items-center shrink-0 group py-1">
            <span className="text-xl sm:text-2xl font-black tracking-tight text-[#FFFFFF] transition group-hover:text-[#D4D4D4]">
              Dramas
            </span>
          </Link>

          {/* Search Input */}
          <NavbarSearch />

          {/* Right Auth & Settings Controls */}
          <div className="relative flex items-center gap-1.5 lg:gap-2 shrink-0" ref={menuRef}>
            <PwaInstallButton className="hidden lg:inline-flex" />

            {/* 도메인 설정 버튼 */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="도메인 주소 설정"
              title="TVWIKI 도메인 주소 설정 및 자동 탐색"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#B3B3B3]/20 bg-[#333333] text-[#D4D4D4] hover:text-[#FFFFFF] hover:border-[#D4D4D4]/30 hover:bg-[#3B3B3B] transition shadow-sm"
            >
              <Globe className="h-4 w-4 text-[#D4D4D4]" />
              <span
                className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#2B2B2B] ${
                  domainStatus === "healthy"
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                    : domainStatus === "unhealthy"
                    ? "bg-rose-500 animate-pulse"
                    : "bg-slate-500"
                }`}
              />
            </button>

            {!isLoadingAuth && (
              <>
                {currentUser ? (
                  <>
                    {/* 통합 닉네임/메뉴 트리거 버튼 */}
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen((prev) => !prev)}
                      aria-label="계정 메뉴"
                      aria-expanded={isMenuOpen}
                      className="flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-[#B3B3B3]/20 bg-[#333333] lg:w-auto lg:px-3 text-xs text-[#FFFFFF] hover:border-[#D4D4D4]/30 hover:bg-[#3B3B3B] transition shadow-sm"
                    >
                      <User className="h-3.5 w-3.5 text-[#D4D4D4]" />
                      <span className="hidden lg:inline font-semibold max-w-[120px] truncate text-[#FFFFFF]">
                        {currentUser.nickname}
                      </span>
                      {currentUser.isAdmin && (
                        <span className="hidden lg:inline rounded-full bg-white/10 text-[#FFFFFF] border border-[#B3B3B3]/30 px-1.5 py-0.2 text-[9px] font-bold">
                          관리자
                        </span>
                      )}
                      <ChevronDown
                        className={`hidden lg:block h-3 w-3 text-[#B3B3B3] transition-transform ${
                          isMenuOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* 목록형 드롭다운 메뉴 */}
                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-[#B3B3B3]/25 bg-[#333333] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                        {/* 1. 도메인 설정 */}
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            setIsSettingsOpen(true);
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-[#D4D4D4] hover:bg-[#3B3B3B] hover:text-[#FFFFFF] transition"
                        >
                          <div className="flex items-center gap-2.5">
                            <Globe className="h-3.5 w-3.5 text-[#B3B3B3]" />
                            <span>TVWIKI 도메인 설정</span>
                          </div>
                          <span
                            className={`h-2 w-2 rounded-full ${
                              domainStatus === "healthy" ? "bg-emerald-400" : "bg-rose-500"
                            }`}
                          />
                        </button>

                        {/* 2. 프로필 수정 */}
                        <Link
                          href="/profile"
                          onClick={() => setIsMenuOpen(false)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[#D4D4D4] hover:bg-[#3B3B3B] hover:text-[#FFFFFF] transition"
                        >
                          <Settings className="h-3.5 w-3.5 text-[#B3B3B3]" />
                          <span>프로필 설정</span>
                        </Link>

                        {/* 3. 계정 관리 (관리자) */}
                        {currentUser.isAdmin && (
                          <Link
                            href="/admin"
                            onClick={() => setIsMenuOpen(false)}
                            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[#FFFFFF] hover:bg-[#3B3B3B] transition"
                          >
                            <Users className="h-3.5 w-3.5 text-[#D4D4D4]" />
                            <span>사용자 계정 관리</span>
                          </Link>
                        )}

                        <div className="my-1 border-t border-[#B3B3B3]/20" />

                        {/* 4. 로그아웃 */}
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>로그아웃</span>
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <Link
                    href="/login"
                    aria-label="로그인"
                    className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-[#B3B3B3]/30 bg-[#FFFFFF] lg:w-auto lg:px-3.5 text-xs font-bold text-[#2B2B2B] transition hover:bg-[#D4D4D4]"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">로그인</span>
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 safe-x lg:hidden">
          <span className="text-xs text-[#B3B3B3]">Dramas를 앱으로 이용하세요</span>
          <PwaInstallButton />
        </div>
      </header>

      {/* 도메인 설정 모달 */}
      <BaseUrlSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onUpdated={() => {
          // Recreate the server page and player with a freshly issued stream URL.
          // A status-only update leaves the previous signed URL in the player.
          window.location.reload();
        }}
      />
    </>
  );
}
