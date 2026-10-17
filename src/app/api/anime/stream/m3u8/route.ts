import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let targetUrl = searchParams.get("url")?.trim();
  let refUrl = searchParams.get("ref")?.trim();
  if (!refUrl) {
    refUrl = "https://player.bunny-frame.online/";
  }

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  const originalUrl = targetUrl;

  try {
    await assertSafeProxyUrl(targetUrl);
  } catch (e) {
    if (e instanceof UnsafeProxyUrlError) {
      return new NextResponse(`Blocked URL: ${e.message}`, { status: 400 });
    }
    throw e;
  }

  try {
    let refOrigin = "https://player.bunny-frame.online";
    try {
      refOrigin = new URL(refUrl).origin;
    } catch {}

    let res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: refUrl,
        Origin: refOrigin,
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok && (res.status === 403 || res.status === 404)) {
      let alternateUrl = "";
      if (originalUrl.includes("master.m3u8")) {
        alternateUrl = originalUrl.replace(/master\.m3u8(\?.*)?$/, "master.txt");
      } else if (originalUrl.includes("master.txt")) {
        alternateUrl = originalUrl.replace(/master\.txt(\?.*)?$/, "master.m3u8");
      }

      if (alternateUrl && alternateUrl !== originalUrl) {
        try {
          await assertSafeProxyUrl(alternateUrl);
          const fallbackRes = await fetch(alternateUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Referer: refUrl,
              Origin: refOrigin,
            },
            signal: AbortSignal.timeout(9000),
          });
          if (fallbackRes.ok) {
            res = fallbackRes;
            targetUrl = alternateUrl;
          }
        } catch {}
      }
    }

    if (!res.ok) {
      const errHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };
      if (res.status === 404) {
        errHeaders["X-Stream-Status"] = "not_found";
      }
      return new NextResponse(`Upstream error: ${res.statusText}`, { status: res.status, headers: errHeaders });
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const newLines: string[] = [];

    const isMasterPlaylist = text.includes("#EXT-X-STREAM-INF");
    let prevLine = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();

      if (stripped && !stripped.startsWith("#")) {
        const absUrl = new URL(stripped, targetUrl).toString();

        const isSubPlaylist =
          isMasterPlaylist ||
          prevLine.startsWith("#EXT-X-STREAM-INF") ||
          absUrl.includes(".m3u8") ||
          absUrl.includes("/m3/") ||
          absUrl.endsWith(".txt");

        if (isSubPlaylist) {
          newLines.push(
            `/api/anime/stream/m3u8?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(refUrl)}`
          );
        } else {
          // Proxy all video segments through /api/anime/stream/segment so Origin/Referer checks on stormzone/vividport/poorcdn always succeed
          newLines.push(
            `/api/anime/stream/segment?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(refUrl)}`
          );
        }
      } else {
        if (stripped.startsWith("#EXT-X-MEDIA:") && stripped.includes('URI="')) {
          const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
            const abs = new URL(rawUri, targetUrl).toString();
            return `URI="/api/anime/stream/m3u8?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(refUrl)}"`;
          });
          newLines.push(replaced);
        } else if (stripped.startsWith("#EXT-X-KEY:") && stripped.includes('URI="')) {
          const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
            const abs = new URL(rawUri, targetUrl).toString();
            return `URI="/api/anime/stream/segment?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(refUrl)}"`;
          });
          newLines.push(replaced);
        } else {
          newLines.push(line);
        }
      }

      if (stripped) {
        prevLine = stripped;
      }
    }

    return new NextResponse(newLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Proxy m3u8 error]:", error);
    return new NextResponse("Proxy error", {
      status: 502,
    });
  }
}
