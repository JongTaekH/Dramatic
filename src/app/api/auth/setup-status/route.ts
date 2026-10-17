import { NextResponse } from "next/server";
import { getUserCount } from "@/lib/db";

export async function GET() {
  try {
    const count = await getUserCount();
    return NextResponse.json({
      needsSetup: count === 0,
      userCount: count,
    });
  } catch (error: any) {
    console.error("[setup-status API error]:", error);
    return NextResponse.json({ needsSetup: false }, { status: 500 });
  }
}
