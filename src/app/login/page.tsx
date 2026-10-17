import { getUserCount } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "로그인 - DramaLand",
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/");
  }

  const userCount = await getUserCount();
  if (userCount === 0) {
    // 관리자가 없으면 무조건 셋업으로 강제 리디렉션
    redirect("/setup");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#2B2B2B] px-4 py-12 safe-top safe-bottom safe-x">
      <div className="w-full max-w-md rounded-3xl border border-[#B3B3B3]/20 bg-[#333333] p-8 sm:p-10">
        {/* 상단 브랜딩 */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-tight text-[#FFFFFF]">
            DramaLand
          </h1>
          <p className="mt-2 text-xs font-medium text-[#B3B3B3]">시스템 로그인</p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
