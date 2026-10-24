import { NextRequest, NextResponse } from "next/server";
import { getProviderByAnimeId } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("id")?.trim();
  const epNum = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const isDub = searchParams.get("is_dub") === "1" || searchParams.get("is_dub") === "true";

  if (!animeId) {
    return NextResponse.json({ success: false, message: "Missing drama id" }, { status: 400 });
  }

  const provider = getProviderByAnimeId(animeId);
  const anime = await provider.getAnimeDetail(animeId);
  if (!anime) {
    return NextResponse.json({ success: false, message: "Drama not found" }, { status: 404 });
  }

  const epList = isDub && anime.dub_episodes.length > 0 ? anime.dub_episodes : anime.sub_episodes;
  const matched = epList.find((e) => e.number === epNum) || epList[0];
  const watchUrl = matched?.watch_url || "";

  if (!watchUrl) {
    return NextResponse.json({ success: false, message: "Watch URL not found" }, { status: 404 });
  }

  const streamInfo = await provider.getEpisodeStream(watchUrl);
  if (!streamInfo?.m3u8_url) {
    const code = streamInfo?.unsupported_reason || "STREAM_UNAVAILABLE";
    const messages: Record<string, string> = {
      EPISODE_FETCH_FAILED: "회차 페이지에 연결하지 못했습니다.",
      EPISODE_EMPTY: "회차 페이지가 빈 응답을 보냈습니다.",
      EPISODE_SESSION_MISSING: "회차 페이지에서 재생 세션 정보를 찾지 못했습니다.",
      EPISODE_SESSION_INVALID: "회차 페이지의 재생 세션 정보를 읽지 못했습니다.",
      SESSION_FETCH_FAILED: "영상 서버의 세션 발급에 연결하지 못했습니다.",
      SESSION_EMPTY: "영상 서버가 빈 세션 응답을 보냈습니다.",
      SESSION_INVALID: "영상 서버의 세션 응답을 읽지 못했습니다.",
      SESSION_REJECTED: "영상 서버가 재생 세션 발급을 거부했습니다.",
      PLAYER_FETCH_FAILED: "영상 플레이어 서버에 연결하지 못했습니다.",
      PLAYER_EMPTY: "영상 플레이어 서버가 빈 응답을 보냈습니다.",
      PLAYER_CONFIG_UNSUPPORTED: "영상 플레이어의 재생 설정을 읽지 못했습니다.",
      PLAYER_SOURCE_INVALID: "영상 주소 API가 재생 정보를 제공하지 않았습니다.",
      PLAYER_SOURCE_FETCH_FAILED: "영상 주소 API에 연결하지 못했습니다.",
      PLAYER_ACCESS_BLOCKED: "영상 서버의 보안 정책이 현재 호스팅 서버의 접속을 차단하고 있습니다. 원본 페이지에서 확인해 주세요.",
    };
    const httpFailure = code.match(/^(EPISODE|SESSION|PLAYER|PLAYER_SOURCE)_HTTP_(\d+)$/);
    const labels: Record<string, string> = { EPISODE: "회차 페이지", SESSION: "재생 세션 서버", PLAYER: "영상 플레이어 서버", PLAYER_SOURCE: "영상 주소 API" };
    const message = httpFailure
      ? `${labels[httpFailure[1]]} 응답에 오류가 있습니다 (HTTP ${httpFailure[2]}).`
      : messages[code] || "영상 서버에서 재생 주소를 가져오지 못했습니다.";
    return NextResponse.json(
      { success: false, code, watch_url: watchUrl,
        message: code === "PLAYER_ACCESS_BLOCKED" ? message : `${message} 다시 시도해 주세요.` },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
  const playerRef = streamInfo?.player_url || "";
  const rawM3u8 = streamInfo?.m3u8_url || "";
  const rawVtt = streamInfo?.vtt_url || "";

  const proxiedM3u8 = rawM3u8
    ? `/api/anime/stream/m3u8?url=${encodeURIComponent(rawM3u8)}&ref=${encodeURIComponent(playerRef)}`
    : "";
  const proxiedVtt = rawVtt ? `/api/anime/stream/vtt?url=${encodeURIComponent(rawVtt)}` : "";

  let linkPre = "";
  let linkNext = "";
  let linkPreEpNum: number | null = null;
  let linkNextEpNum: number | null = null;
  let epTitle = `${epNum}화`;

  for (let idx = 0; idx < epList.length; idx++) {
    const e = epList[idx];
    if (e.number === epNum) {
      epTitle = e.title;
      if (idx > 0) {
        linkPre = epList[idx - 1].watch_url;
        linkPreEpNum = epList[idx - 1].number;
      }
      if (idx + 1 < epList.length) {
        linkNext = epList[idx + 1].watch_url;
        linkNextEpNum = epList[idx + 1].number;
      }
      break;
    }
  }

  return NextResponse.json(
    {
      success: true,
      anime_id: animeId,
      anime_title: anime.title,
      episode_number: epNum,
      episode_title: epTitle,
      watch_url: watchUrl,
      proxied_m3u8: proxiedM3u8,
      proxied_vtt: proxiedVtt,
      m3u8_url: proxiedM3u8,
      vtt_url: proxiedVtt,
      embed_url: streamInfo?.embed_url || "",
      link_pre: linkPre,
      link_next: linkNext,
      link_pre_ep_num: linkPreEpNum,
      link_next_ep_num: linkNextEpNum,
      is_dub: isDub,
      server_sources: streamInfo?.server_sources || [],
      stream_type: streamInfo?.stream_type,
      subtitle_mode: streamInfo?.subtitle_mode,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
