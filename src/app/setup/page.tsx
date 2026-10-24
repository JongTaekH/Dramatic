import { getUserCount } from "@/lib/db";
import { redirect } from "next/navigation";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "초기 마스터 관리자 설정 - Dramas",
};

export default async function SetupPage() {
  const count = await getUserCount();
  if (count > 0) {
    // 이미 계정이 하나라도 존재하면 셋업 진입 불가 -> 로그인 페이지로 리다이렉트
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#2B2B2B] px-4 py-12 safe-top safe-bottom safe-x">
      <div className="w-full max-w-md rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-8 sm:p-10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-wide text-[#FFFFFF] sm:text-3xl">
            ADMIN SETUP
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#FFFFFF]">
            최초 마스터 관리자 설정
          </p>
          <p className="mt-2 text-[11px] text-[#B3B3B3] leading-relaxed">
            최초 1회에 한해 최고 권한을 가진 마스터 관리자 계정을 생성합니다.
            설정 완료 후 바로 시스템에 로그인됩니다.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  );
}
