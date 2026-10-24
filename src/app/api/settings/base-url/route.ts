import { NextRequest, NextResponse } from "next/server";
import {
  getTvwikiBaseUrl,
  setTvwikiBaseUrl,
  DEFAULT_TVWIKI_URL,
  TELEGRAM_TVWIKI_URL,
  TVWIKI_STORE_URL,
  TVWIKI_URL_GUIDE,
} from "@/lib/db";
import { resilientFetch, resolveLatestTvwikiUrl } from "@/lib/providers/tvwiki";
import { getSessionUser } from "@/lib/auth";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";

export const dynamic = "force-dynamic";

const healthCache: Record<string, { ok: boolean; latencyMs: number; statusText?: string; timestamp: number }> = {};
const CACHE_TTL_MS = 30 * 1000;

async function checkUrlHealth(
  url: string,
  timeoutMs: number = 8000,
  bypassCache: boolean = false
): Promise<{ ok: boolean; latencyMs: number; statusText?: string }> {
  const now = Date.now();
  if (!bypassCache && healthCache[url] && now - healthCache[url].timestamp < CACHE_TTL_MS) {
    return healthCache[url];
  }

  const start = Date.now();
  try {
    const res = await resilientFetch(url, { timeoutMs });
    const latencyMs = Date.now() - start;
    const serverHeader = String(res.headers["server"] || "").toLowerCase();
    const isCf =
      res.status === 403 &&
      (res.headers["cf-mitigated"] === "challenge" || serverHeader.includes("cloudflare"));
    const ok = (res.status >= 200 && res.status < 400 && !res.body.includes("error-code")) || isCf;
    const result = {
      ok,
      latencyMs,
      statusText: isCf ? "200 OK (Cloudflare)" : `${res.status} ${res.statusText || "OK"}`,
    };
    healthCache[url] = { ...result, timestamp: now };
    return result;
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const result = {
      ok: false,
      latencyMs,
      statusText: err?.message || "Connection timeout or failed",
    };
    healthCache[url] = { ...result, timestamp: now - CACHE_TTL_MS + 5000 };
    return result;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bypass = searchParams.get("refresh") === "1";

  try {
    const currentBaseUrl = await getTvwikiBaseUrl(true);
    const health = await checkUrlHealth(`${currentBaseUrl}/drama`, 7000, bypass);

    return NextResponse.json({
      success: true,
      provider: "tvwiki",
      baseUrl: currentBaseUrl,
      defaultUrl: DEFAULT_TVWIKI_URL,
      telegramUrl: TELEGRAM_TVWIKI_URL,
      storeUrl: TVWIKI_STORE_URL,
      guideUrl: TVWIKI_URL_GUIDE,
      isHealthy: health.ok,
      latencyMs: health.latencyMs,
      statusText: health.statusText,
    });
  } catch (error: any) {
    console.error("[GET /api/settings/base-url error]:", error);
    return NextResponse.json(
      { success: false, message: "베이스 URL을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    // 텔레그램 (https://t.me/s/tvwiki_url) 및 리디렉션 허브에서 최신 도메인 자동 탐색 액션 지원
    if (body.action === "auto_discover") {
      const discovered = await resolveLatestTvwikiUrl();
      if (!discovered) {
        return NextResponse.json(
          {
            success: false,
            message: "주소 안내 사이트와 텔레그램에서 접속 가능한 TVWIKI 주소를 찾지 못했습니다.",
          },
          { status: 404 }
        );
      }

      const health = await checkUrlHealth(`${discovered}/drama`, 8000, true);
      const saved = await setTvwikiBaseUrl(discovered);
      if (!saved) {
        return NextResponse.json(
          { success: false, message: "데이터베이스 저장에 실패했습니다. 연결 설정을 확인해 주세요." },
          { status: 500 }
        );
      }
      delete healthCache[discovered];
      delete healthCache[`${discovered}/drama`];

      return NextResponse.json({
        success: saved,
        provider: "tvwiki",
        baseUrl: discovered,
        message: `주소 안내 사이트와 텔레그램을 확인하여 최신 주소(${discovered})를 적용했습니다.`,
        health,
      });
    }

    const rawUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const force = Boolean(body.force);

    if (!rawUrl) {
      return NextResponse.json(
        { success: false, message: "베이스 URL을 입력해주세요." },
        { status: 400 }
      );
    }

    let formatted = rawUrl;
    if (!formatted.startsWith("http://") && !formatted.startsWith("https://")) {
      formatted = `https://${formatted}`;
    }
    formatted = formatted.replace(/\/+$/, "");

    try {
      const parsed = new URL(formatted);
      // This is a TVWIKI setting, not an arbitrary upstream server selector.
      if (parsed.protocol !== "https:" || !/^tvwiki\d+\.net$/i.test(parsed.hostname) ||
          parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" ||
          parsed.search || parsed.hash) {
        return NextResponse.json(
          { success: false, message: "https://tvwiki55.net 형식의 TVWIKI 도메인만 입력해 주세요." },
          { status: 400 }
        );
      }
      formatted = parsed.origin;
    } catch {
      return NextResponse.json(
        { success: false, message: `올바른 URL 형식이 아닙니다 (예: ${DEFAULT_TVWIKI_URL})` },
        { status: 400 }
      );
    }

    try {
      await assertSafeProxyUrl(formatted);
    } catch (e) {
      if (e instanceof UnsafeProxyUrlError) {
        return NextResponse.json(
          { success: false, message: `허용되지 않는 주소입니다: ${e.message}` },
          { status: 400 }
        );
      }
      throw e;
    }

    const checkTarget = `${formatted}/drama`;
    const health = await checkUrlHealth(checkTarget, 8000, true);
    if (!health.ok && !force) {
      return NextResponse.json(
        {
          success: false,
          needsConfirmation: true,
          message: `입력하신 URL(${formatted})에 접속할 수 없습니다 (${health.statusText}). 그래도 강제로 저장하시겠습니까?`,
          health,
        },
        { status: 422 }
      );
    }

    const saved = await setTvwikiBaseUrl(formatted);
    delete healthCache[formatted];
    delete healthCache[checkTarget];

    if (!saved) {
      return NextResponse.json(
        { success: false, message: "데이터베이스 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      provider: "tvwiki",
      baseUrl: formatted,
      message: "TVWIKI 스트리밍 베이스 URL이 성공적으로 변경되었습니다.",
      health,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/base-url error]:", error);
    return NextResponse.json(
      { success: false, message: "베이스 URL 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
