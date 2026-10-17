"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, AlertCircle } from "lucide-react";

type ProfileUser = {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
  isFirstLogin?: boolean;
};

export default function ProfileForm({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isForcePasswordChange = searchParams.get("change_password") === "1" || user.isFirstLogin;

  const [nickname, setNickname] = useState(user.nickname || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword) {
      if (newPassword.length < 4) {
        setError("새 비밀번호는 4자 이상이어야 합니다.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("새 비밀번호와 확인이 일치하지 않습니다.");
        return;
      }
      if (!currentPassword) {
        setError("현재(또는 임시) 비밀번호를 입력해주세요.");
        return;
      }
    }

    if (isForcePasswordChange && !newPassword) {
      setError("새 비밀번호를 설정해주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: isForcePasswordChange ? undefined : nickname,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();

      if (data.success) {
        if (isForcePasswordChange) {
          router.push("/");
          router.refresh();
        } else {
          setSuccess("프로필이 성공적으로 업데이트되었습니다.");
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          router.refresh();
        }
      } else {
        setError(data.message || "업데이트에 실패했습니다.");
      }
    } catch (err) {
      setError("서버 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#2B2B2B] p-4 text-[#FFFFFF]">
      <div className="w-full max-w-md rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-8 sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#FFFFFF]">
            {isForcePasswordChange ? "비밀번호 변경" : "내 프로필"}
          </h1>
          <p className="mt-2 text-sm text-[#B3B3B3]">
            {isForcePasswordChange 
              ? "안전한 서비스 이용을 위해 비밀번호를 변경해주세요." 
              : "계정 정보를 관리할 수 있습니다."}
          </p>
        </div>

        {isForcePasswordChange && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-[#B3B3B3]/30 bg-[#FFFFFF]/10 p-4 text-sm text-[#FFFFFF]">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>첫 로그인입니다. 보안을 위해 비밀번호를 변경해주세요.</p>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-sm text-emerald-300">
            <Check className="h-5 w-5 shrink-0" />
            <p>{success}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#D4D4D4]">아이디</label>
            <input
              type="text"
              value={user.username}
              disabled
              className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B]/50 px-3.5 py-2.5 text-sm text-[#B3B3B3] cursor-not-allowed"
            />
          </div>

          {!isForcePasswordChange && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#D4D4D4]">닉네임</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
                placeholder="닉네임을 입력하세요"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#D4D4D4]">
              {isForcePasswordChange ? "현재(임시) 비밀번호 *" : "현재 비밀번호 (변경 시 필수)"}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
              placeholder="현재 비밀번호를 입력하세요"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#D4D4D4]">새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
              placeholder="새 비밀번호 (4자 이상)"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#D4D4D4]">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-[#B3B3B3]/20 bg-[#2B2B2B] px-3.5 py-2.5 text-sm text-[#FFFFFF] placeholder-[#B3B3B3] transition focus:border-[#FFFFFF] focus:outline-none"
              placeholder="새 비밀번호를 다시 입력하세요"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-[#FFFFFF] py-3 text-sm font-bold text-[#2B2B2B] transition hover:bg-[#D4D4D4] disabled:opacity-50"
          >
            {loading ? "처리 중..." : (isForcePasswordChange ? "비밀번호 변경 및 시작" : "프로필 저장")}
          </button>
        </form>
      </div>
    </div>
  );
}
