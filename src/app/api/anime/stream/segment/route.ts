import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";
import { extractAacFromTs } from "@/lib/tsDemuxer";
import { decodeHlsKey } from "@/lib/hlsKey";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url")?.trim();
  let refUrl = searchParams.get("ref")?.trim();
  if (!refUrl) {
    refUrl = "https://player.bunny-frame.online/";
  }
  const isAudioOnly = searchParams.get("audio") === "1" || searchParams.get("audio") === "true";

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

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

    const fetchHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: refUrl,
      Origin: refOrigin,
      Accept: "*/*",
    };

    let res: Response | null = null;
    let fetchError: any = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(targetUrl, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) break;
      } catch (err) {
        fetchError = err;
      }
    }

    if (!res || !res.ok) {
      const errHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };
      if (res && res.status === 404) {
        errHeaders["X-Stream-Status"] = "not_found";
      }
      return new NextResponse(
        `Upstream segment error: ${res ? res.statusText : fetchError?.message || "timeout"}`,
        { status: res ? res.status : 504, headers: errHeaders }
      );
    }

    const responseHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200, immutable",
    };

    // key7 serves a JSON envelope, not the raw AES key expected by HLS.js.
    if (/\/v\/key7\/?$/.test(new URL(targetUrl).pathname)) {
      const key = decodeHlsKey(new Uint8Array(await res.arrayBuffer()));
      return new NextResponse(Buffer.from(key), {
        status: 200,
        headers: {
          ...responseHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Length": "16",
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (isAudioOnly) {
      const arrayBuffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const aac = extractAacFromTs(uint8);
      if (aac.length > 0 && aac.length < uint8.length) {
        const aacBuffer = aac.buffer.slice(aac.byteOffset, aac.byteOffset + aac.byteLength) as ArrayBuffer;
        responseHeaders["Content-Type"] = "audio/aac";
        return new NextResponse(aacBuffer, {
          status: 200,
          headers: responseHeaders,
        });
      }
      responseHeaders["Content-Type"] = "video/mp2t";
      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: responseHeaders,
      });
    }

    const arrayBuffer = await res.arrayBuffer();
    const isKey = targetUrl.includes("/key") || arrayBuffer.byteLength === 16;
    responseHeaders["Content-Type"] = isKey ? "application/octet-stream" : "video/mp2t";
    responseHeaders["Content-Length"] = String(arrayBuffer.byteLength);

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[Segment Proxy error]:", error);
    return new NextResponse("Proxy error", {
      status: 502,
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
