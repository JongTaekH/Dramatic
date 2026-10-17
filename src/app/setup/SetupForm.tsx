"use client";

import { useState } from "react";
import { User, Shield, KeyRound, AlertCircle, Loader2, Sparkles } from "lucide-react";

export default function SetupForm() {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("관리자 로그인 ID를 입력해주세요.");
      return;
    }
    if (!password) {
      setError("마스터 비밀번호를 입력해주세요.");
      return;
    }
    if (password.length < 4) {
      setError("비밀번호는 최소 4자 이상이어야 합니다.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          nickname: nickname.trim() || "관리자",
          password,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "관리자 계정 생성에 실패했습니다.");
        setIsSubmitting(false);
        return;
      }

      setIsSuccess(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "네트워크 연결 상태를 확인해주세요.");
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FFFFFF]/20 text-[#FFFFFF]">
          <Sparkles className="h-7 w-7 animate-bounce" />
        </div>
        <h3 className="text-lg font-bold text-[#FFFFFF]">관리자 계정 생성 완료!</h3>
        <p className="mt-1.5 text-xs text-[#D4D4D4]">
          마스터 관리자 계정이 성공적으로 생성되었습니다. 메인 화면으로 이동합니다...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 관리자 로그인 ID */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <User className="h-3.5 w-3.5 text-[#FFFFFF]" />
          관리자 로그인 ID <span className="text-[#FFFFFF]">*</span>
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="사용할 관리자 ID를 입력하세요"
          required
          autoComplete="username"
          className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
        />
      </div>

      {/* 관리자 닉네임 */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <Shield className="h-3.5 w-3.5 text-[#FFFFFF]" />
          관리자 닉네임 <span className="text-[11px] text-[#B3B3B3] font-normal">(선택)</span>
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="미입력 시 '관리자'로 설정"
          className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
        />
      </div>

      <div className="border-t border-[#B3B3B3]/20 pt-2" />

      {/* 마스터 비밀번호 */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <KeyRound className="h-3.5 w-3.5 text-[#FFFFFF]" />
          마스터 비밀번호 <span className="text-[#FFFFFF]">*</span>
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="사용할 비밀번호 (4자 이상)"
          required
          autoComplete="new-password"
          className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
        />
      </div>

      {/* 비밀번호 확인 */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <KeyRound className="h-3.5 w-3.5 text-[#FFFFFF]" />
          비밀번호 확인 <span className="text-[#FFFFFF]">*</span>
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="비밀번호 한 번 더 입력"
          required
          autoComplete="new-password"
          className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FFFFFF] py-3 text-sm font-bold text-[#2B2B2B] transition hover:bg-[#D4D4D4] disabled:opacity-50"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-[#2B2B2B]" />
            <span>계정 생성 처리 중...</span>
          </>
        ) : (
          <>
            <span>관리자 계정 생성 & 시스템 가동</span>
            <Sparkles className="h-4 w-4 text-[#2B2B2B]" />
          </>
        )}
      </button>
    </form>
  );
}
