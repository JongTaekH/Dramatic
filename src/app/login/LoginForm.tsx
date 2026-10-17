"use client";

import { useState } from "react";
import { User, KeyRound, AlertCircle, Loader2, LogIn } from "lucide-react";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "로그인에 실패했습니다.");
        setIsSubmitting(false);
        return;
      }

      window.location.href = "/";
    } catch (err: any) {
      setError(err?.message || "네트워크 연결 상태를 확인해주세요.");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* ID 입력 */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <User className="h-3.5 w-3.5 text-[#FFFFFF]" />
          아이디
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="아이디를 입력하세요"
          required
          autoComplete="username"
          className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
        />
      </div>

      {/* 비밀번호 입력 */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#D4D4D4]">
          <KeyRound className="h-3.5 w-3.5 text-[#FFFFFF]" />
          비밀번호
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호를 입력하세요"
          required
          autoComplete="current-password"
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
            <span>로그인 중...</span>
          </>
        ) : (
          <>
            <span>로그인</span>
            <LogIn className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
