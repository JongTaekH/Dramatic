import { NextRequest, NextResponse } from "next/server";
import { getUserCount, createFirstAdmin } from "@/lib/db";
import { hashPassword, createAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const count = await getUserCount();
    if (count > 0) {
      return NextResponse.json(
        { success: false, message: "이미 관리자 계정이 등록되어 있습니다. 로그인해 주세요." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { username, nickname, password, confirmPassword } = body;

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { success: false, message: "로그인 ID를 입력해주세요." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 4) {
      return NextResponse.json(
        { success: false, message: "비밀번호는 최소 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "비밀번호 확인이 일치하지 않습니다." },
        { status: 400 }
      );
    }

    const passwordHash = hashPassword(password);
    const assignedNickname = (nickname && nickname.trim()) || "관리자";

    const newUser = await createFirstAdmin({
      username: username.trim(),
      passwordHash,
      nickname: assignedNickname,
    });

    if (!newUser) {
      return NextResponse.json(
        { success: false, message: "이미 관리자 계정이 등록되어 있습니다. 로그인해 주세요." },
        { status: 403 }
      );
    }

    const token = createAuthToken({
      id: newUser.id,
      username: newUser.username,
      nickname: newUser.nickname,
      isAdmin: newUser.is_admin,
    });

    const response = NextResponse.json({
      success: true,
      message: "🎉 초기 마스터 관리자 계정이 안전하게 생성되었습니다!",
      user: {
        id: newUser.id,
        username: newUser.username,
        nickname: newUser.nickname,
        isAdmin: newUser.is_admin,
      },
    });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 86400,
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[setup API error]:", error);
    return NextResponse.json(
      { success: false, message: "관리자 계정 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
