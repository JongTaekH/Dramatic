import * as cheerio from "cheerio";
import net from "net";
import tls from "tls";
import https from "https";
import http from "http";
import zlib from "zlib";
import crypto from "crypto";
import vm from "vm";
import { Duplex } from "stream";
import {
  getTvwikiBaseUrl,
  setTvwikiBaseUrl,
  DEFAULT_TVWIKI_URL,
  TELEGRAM_TVWIKI_URL,
  TVWIKI_STORE_URL,
} from "../db";
import {
  AnimeDetail,
  AnimeListFilterParams,
  AnimeListItem,
  AnimeListResponse,
  AnimeProvider,
  CastMember,
  EpisodeItem,
  EpisodeStreamInfo,
} from "./types";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const TVWIKI_SORT_OPTIONS = [
  { value: "subidx", label: "최근 방영순" },
  { value: "wr_datetime", label: "최근 등록순" },
  { value: "wr_hit", label: "조회수 높은순" },
  { value: "wr_good", label: "좋아요 높은순" },
  { value: "wr_6", label: "개봉일 최신순" },
  { value: "wr_5", label: "평점 높은순" },
];

export const TVWIKI_SORTS = TVWIKI_SORT_OPTIONS;

export const TVWIKI_CATEGORIES = [
  { value: "drama", label: "최신 드라마" },
  { value: "old_drama", label: "추억의 드라마" },
];

/**
 * Splits a TLS ClientHello record into two valid TLS records right across the SNI hostname
 * so ISP Deep Packet Inspection (DPI) does not reset the connection with ECONNRESET.
 */
function splitTlsClientHelloRecords(buf: Buffer, splitOffsetInHandshake: number): Buffer[] {
  if (buf.length < 5 || buf[0] !== 0x16) return [buf];
  const verMajor = buf[1];
  const verMinor = buf[2];
  const totalPayloadLen = buf.readUInt16BE(3);
  if (buf.length < 5 + totalPayloadLen || splitOffsetInHandshake <= 0 || splitOffsetInHandshake >= totalPayloadLen) {
    return [buf];
  }
  const payload = buf.subarray(5, 5 + totalPayloadLen);
  const rest = buf.subarray(5 + totalPayloadLen);

  const part1 = payload.subarray(0, splitOffsetInHandshake);
  const part2 = payload.subarray(splitOffsetInHandshake);

  const rec1 = Buffer.alloc(5 + part1.length);
  rec1[0] = 0x16;
  rec1[1] = verMajor;
  rec1[2] = verMinor;
  rec1.writeUInt16BE(part1.length, 3);
  part1.copy(rec1, 5);

  const rec2 = Buffer.alloc(5 + part2.length + rest.length);
  rec2[0] = 0x16;
  rec2[1] = verMajor;
  rec2[2] = verMinor;
  rec2.writeUInt16BE(part2.length, 3);
  part2.copy(rec2, 5);
  if (rest.length > 0) {
    rest.copy(rec2, 5 + part2.length);
  }

  return [rec1, rec2];
}

export interface ResilientFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface ResilientFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  url: string;
  body: string;
}

/**
 * Performs an HTTPS/HTTP request using TLS ClientHello Record Splitting for resilient SNI bypass.
 */
export function sniSplitRequest(
  urlStr: string,
  options: ResilientFetchOptions = {}
): Promise<ResilientFetchResponse> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRedirects = options.maxRedirects ?? 5;

  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }

    const isHttps = u.protocol === "https:";
    const port = Number(u.port) || (isHttps ? 443 : 80);
    const host = u.hostname;

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Request timeout (${timeoutMs}ms): ${urlStr}`));
      }
    }, timeoutMs);

    const finish = (err: Error | null, res?: ResilientFetchResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else if (res) resolve(res);
    };

    const handleResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && maxRedirects > 0) {
        res.resume();
        const nextUrl = new URL(location, urlStr).toString();
        clearTimeout(timer);
        settled = true;
        sniSplitRequest(nextUrl, { ...options, maxRedirects: maxRedirects - 1 })
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          let rawBuf = Buffer.concat(chunks);
          const encoding = (res.headers["content-encoding"] || "").toLowerCase();
          if (encoding === "gzip") {
            rawBuf = zlib.gunzipSync(rawBuf);
          } else if (encoding === "deflate") {
            rawBuf = zlib.inflateSync(rawBuf);
          } else if (encoding === "br") {
            rawBuf = zlib.brotliDecompressSync(rawBuf);
          }
          const bodyStr = rawBuf.toString("utf8");
          finish(null, {
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || "",
            headers: res.headers,
            url: urlStr,
            body: bodyStr,
          });
        } catch (err: any) {
          finish(err);
        }
      });
      res.on("error", (err) => finish(err));
    };

    const reqHeaders: Record<string, string> = {
      Host: u.host,
      "User-Agent": DEFAULT_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "close",
      ...(options.headers || {}),
    };
    if (options.body && !reqHeaders["Content-Length"] && !reqHeaders["content-length"]) {
      reqHeaders["Content-Length"] = String(Buffer.byteLength(options.body));
    }

    if (!isHttps) {
      const req = http.request(
        {
          host,
          port,
          path: u.pathname + u.search,
          method: options.method || "GET",
          headers: reqHeaders,
        },
        handleResponse
      );
      req.on("error", (err) => finish(err));
      if (options.body) req.write(options.body);
      req.end();
      return;
    }

    const rawSocket = net.connect(port, host, () => {
      rawSocket.setNoDelay(true);
      let firstChunk = true;
      const proxy = new Duplex({
        read() {},
        write(chunk: Buffer, encoding, callback) {
          if (firstChunk && Buffer.isBuffer(chunk)) {
            firstChunk = false;
            const idx = chunk.indexOf(Buffer.from(host));
            if (idx > 5) {
              const [r1, r2] = splitTlsClientHelloRecords(chunk, idx - 5 + Math.min(3, Math.floor(host.length / 2)));
              rawSocket.write(r1);
              setTimeout(() => {
                if (!rawSocket.destroyed) {
                  rawSocket.write(r2, callback);
                }
              }, 15);
              return;
            }
          }
          if (!rawSocket.destroyed) {
            rawSocket.write(chunk, encoding, callback);
          }
        },
      });

      rawSocket.on("data", (d) => proxy.push(d));
      rawSocket.on("end", () => proxy.push(null));
      rawSocket.on("error", (e) => {
        proxy.destroy(e);
        finish(e);
      });

      const tlsSocket = tls.connect({
        socket: proxy,
        servername: host,
        ALPNProtocols: ["http/1.1"],
      });
      tlsSocket.on("error", (e) => finish(e));

      const req = https.request(
        {
          host,
          port,
          path: u.pathname + u.search,
          method: options.method || "GET",
          headers: reqHeaders,
          createConnection: () => tlsSocket,
        },
        handleResponse
      );
      req.on("error", (e) => finish(e));
      if (options.body) req.write(options.body);
      req.end();
    });

    rawSocket.on("error", (e) => finish(e));
  });
}

/**
 * Fetches a URL using standard `fetch` first (or directly `sniSplitRequest` on ECONNRESET/timeout).
 */
export async function resilientFetch(
  urlStr: string,
  options: ResilientFetchOptions = {}
): Promise<ResilientFetchResponse> {
  // Use sniSplitRequest directly for tvwiki / bunny-frame domains or fallback when standard fetch fails
  const isTvwikiLike = /tvwiki|bunny-frame/i.test(urlStr);
  if (!isTvwikiLike) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
      const res = await fetch(urlStr, {
        method: options.method || "GET",
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          ...(options.headers || {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const body = await res.text();
      const headersObj: Record<string, string | string[] | undefined> = {};
      res.headers.forEach((v, k) => {
        headersObj[k.toLowerCase()] = v;
      });
      if (typeof (res.headers as any).getSetCookie === "function") {
        headersObj["set-cookie"] = (res.headers as any).getSetCookie();
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: headersObj,
        url: res.url || urlStr,
        body,
      };
    } catch {
      // Fallback to SNI split request
    }
  }
  return sniSplitRequest(urlStr, options);
}

/**
 * Extracts active TVWIKI domain from HTML content (such as tvwiki.store or Telegram page).
 */
export function extractTvwikiDomainFromHtml(html: string): {
  numberedDomains: string[];
  hubDomains: string[];
} {
  const numberedSet = new Set<string>();
  const hubSet = new Set<string>();

  // 1) Look for numbered tvwiki domains like https://tvwiki54.net, https://tvwiki55.net, etc.
  const numberedRegex = /https?:\/\/(?:www\.)?(tvwiki\d+\.[a-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = numberedRegex.exec(html)) !== null) {
    numberedSet.add(`https://${m[1].toLowerCase()}`);
  }

  // 2) Look for redirect hub domains like https://tvwiki.store
  const hubRegex = /https?:\/\/(?:www\.)?(tvwiki\.(?:store|org|net|com|kr|info|link|me|io|cc|top|xyz))/gi;
  while ((m = hubRegex.exec(html)) !== null) {
    const d = `https://${m[1].toLowerCase()}`;
    if (!/tvwikiurl/i.test(d)) {
      hubSet.add(d);
    }
  }

  return {
    numberedDomains: Array.from(numberedSet),
    hubDomains: Array.from(hubSet),
  };
}

/**
 * Resolves the latest working TVWIKI base URL from:
 * 1. https://t.me/s/tvwiki_url (Telegram public channel web preview)
 * 2. https://r.jina.ai/https://t.me/s/tvwiki_url (Rendered Telegram messages fallback)
 * 3. https://tvwiki.store (Official redirect hub announced on Telegram)
 */
export async function resolveLatestTvwikiUrl(): Promise<string | null> {
  const candidates: string[] = [];
  const hubsToQuery = new Set<string>([TVWIKI_STORE_URL]);

  // Step 1: Check Telegram public channel directly
  try {
    const tgRes = await resilientFetch(TELEGRAM_TVWIKI_URL, { timeoutMs: 6000 });
    if (tgRes.ok && tgRes.body) {
      const { numberedDomains, hubDomains } = extractTvwikiDomainFromHtml(tgRes.body);
      for (const d of numberedDomains.reverse()) {
        if (!candidates.includes(d)) candidates.push(d);
      }
      for (const h of hubDomains) {
        hubsToQuery.add(h);
      }
    }
  } catch {}

  // Step 2: Check Jina Reader mirror of Telegram channel if needed
  if (candidates.length === 0) {
    try {
      const jinaRes = await resilientFetch(`https://r.jina.ai/${TELEGRAM_TVWIKI_URL}`, { timeoutMs: 6000 });
      if (jinaRes.ok && jinaRes.body) {
        const { numberedDomains, hubDomains } = extractTvwikiDomainFromHtml(jinaRes.body);
        for (const d of numberedDomains.reverse()) {
          if (!candidates.includes(d)) candidates.push(d);
        }
        for (const h of hubDomains) {
          hubsToQuery.add(h);
        }
      }
    } catch {}
  }

  // Step 3: Query redirect hub(s) (e.g. https://tvwiki.store) for the latest active numbered domain
  for (const hubUrl of hubsToQuery) {
    try {
      const hubRes = await resilientFetch(hubUrl, { timeoutMs: 6000 });
      if (hubRes.ok && hubRes.body) {
        const { numberedDomains } = extractTvwikiDomainFromHtml(hubRes.body);
        // Put hub's target domain at the very front since tvwiki.store always points to the live domain
        for (const d of numberedDomains) {
          const existingIdx = candidates.indexOf(d);
          if (existingIdx !== -1) candidates.splice(existingIdx, 1);
          candidates.unshift(d);
        }
      }
    } catch {}
  }

  // Step 4: Verify candidates by checking `/drama`
  for (const candidate of candidates) {
    try {
      const testRes = await resilientFetch(`${candidate}/drama`, { timeoutMs: 6000 });
      if (testRes.ok && testRes.body.includes("list_type")) {
        return candidate.replace(/\/+$/, "");
      }
    } catch {}
  }

  return candidates[0]?.replace(/\/+$/, "") || null;
}

/**
 * Converts a TVWIKI path or URL into our internal Drama ID:
 * - `/drama/4148` or `/drama/4148/406786416` -> `dr_4148`
 * - `/old_drama/4901` or `/old_drama/4901/406784527` -> `odr_4901`
 */
export function toDramaId(category: "drama" | "old_drama", wrId: string | number): string {
  const prefix = category === "old_drama" ? "odr_" : "dr_";
  return `${prefix}${String(wrId).trim()}`;
}

export function parseDramaId(dramaId: string): { category: "drama" | "old_drama"; wrId: string } {
  const clean = String(dramaId || "").trim();
  if (clean.startsWith("odr_")) {
    return { category: "old_drama", wrId: clean.slice(4) };
  }
  if (clean.startsWith("dr_")) {
    return { category: "drama", wrId: clean.slice(3) };
  }
  if (clean.startsWith("old_drama_")) {
    return { category: "old_drama", wrId: clean.slice(10) };
  }
  if (clean.startsWith("drama_")) {
    return { category: "drama", wrId: clean.slice(6) };
  }
  return { category: "drama", wrId: clean.replace(/^[a-z]+_/i, "") };
}

function normalizeUrl(rawUrl: string | undefined, baseUrl: string): string {
  if (!rawUrl) return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? `${cleanBase}${trimmed}` : `${cleanBase}/${trimmed}`;
}

/**
 * Parses TVWIKI category list HTML (`/drama` or `/old_drama`).
 */
export function parseTvwikiCategoryListHtml(
  html: string,
  baseUrl: string,
  defaultCategory: "drama" | "old_drama" = "drama",
  currentPage = 1
): AnimeListResponse {
  const $ = cheerio.load(html);
  const items: AnimeListItem[] = [];
  const seenIds = new Set<string>();

  $("#list_type ul li").each((_, el) => {
    const $el = $(el);
    const href = $el.find(".box a.img").attr("href") || $el.find("a").first().attr("href") || "";
    const match = href.match(/\/(drama|old_drama)\/(\d+)/i);
    if (!match) return;

    const category = (match[1].toLowerCase() === "old_drama" ? "old_drama" : "drama") as "drama" | "old_drama";
    const wrId = match[2];
    const id = toDramaId(category, wrId);
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const $img = $el.find(".box a.img img").first();
    const rawPoster =
      $img.attr("data-src") || $img.attr("data-original") || $img.attr("src") || "";
    const poster = normalizeUrl(rawPoster, baseUrl);

    const title =
      $el.find(".box a.title2").text().trim() ||
      $el.find(".box a.title").text().trim() ||
      $img.attr("alt")?.trim() ||
      "";
    if (!title) return;

    const hasUpdateBadge = $el.find(".ud_new").length > 0;
    const country = $el.find(".country").text().trim() || "대한민국";
    const ratingStr = $el.find(".value").text().trim();
    const rating = ratingStr ? parseFloat(ratingStr) || null : null;
    const likesStr = $el.find(".good").text().replace(/[^\d]/g, "");
    const likes = likesStr ? parseInt(likesStr, 10) : null;

    const remarksParts: string[] = [];
    if (hasUpdateBadge) remarksParts.push("UP");
    if (category === "old_drama") remarksParts.push("추억의 드라마");
    else remarksParts.push("드라마");

    items.push({
      id,
      title,
      poster,
      detail_url: `${baseUrl}/${category}/${wrId}`,
      remarks: remarksParts.join(" · "),
      rating,
      status: hasUpdateBadge ? "UP" : category === "old_drama" ? "완결" : "방영중",
      category,
      country,
      likes,
    });
  });

  // Pagination detection
  let maxPage = currentPage;
  $(".pg_wrap a.pg_page, .pg_wrap .pg_current").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    const pageMatch = href.match(/[?&]page=(\d+)/);
    if (pageMatch) {
      const p = parseInt(pageMatch[1], 10);
      if (p > maxPage) maxPage = p;
    } else if (/^\d+$/.test(text)) {
      const p = parseInt(text, 10);
      if (p > maxPage) maxPage = p;
    }
  });
  const hasEndLink = $(".pg_wrap a.pg_end").length > 0;
  if (hasEndLink) {
    const endHref = $(".pg_wrap a.pg_end").attr("href") || "";
    const endMatch = endHref.match(/[?&]page=(\d+)/);
    if (endMatch) {
      const p = parseInt(endMatch[1], 10);
      if (p > maxPage) maxPage = p;
    }
  }

  return {
    items,
    page: currentPage,
    has_next: currentPage < maxPage,
    total_pages: Math.max(maxPage, 1),
  };
}

/**
 * Parses TVWIKI search results HTML (`/search?stx=...`), filtering strictly to `/drama` and `/old_drama`.
 */
export function parseTvwikiSearchHtml(
  html: string,
  baseUrl: string,
  currentPage = 1
): AnimeListResponse {
  const $ = cheerio.load(html);
  const items: AnimeListItem[] = [];
  const seenIds = new Set<string>();

  $("#line_type ul#mov_con_list > li, #list_type ul li").each((_, el) => {
    const $el = $(el);
    const href =
      $el.find(".box a.img").attr("href") ||
      $el.find("a.title").attr("href") ||
      $el.find("a").first().attr("href") ||
      "";
    const match = href.match(/\/(drama|old_drama)\/(\d+)/i);
    if (!match) return; // Ignore movies, variety shows, anime, etc.

    const category = (match[1].toLowerCase() === "old_drama" ? "old_drama" : "drama") as "drama" | "old_drama";
    const wrId = match[2];
    const id = toDramaId(category, wrId);
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const $img = $el.find(".box a.img img, img").first();
    const rawPoster =
      $img.attr("data-src") || $img.attr("data-original") || $img.attr("src") || "";
    const poster = normalizeUrl(rawPoster, baseUrl);

    const title =
      $el.find(".box > a.title, .box a.title2, a.title").first().text().trim() ||
      $img.attr("alt")?.trim() ||
      "";
    if (!title) return;

    const categoryBadge =
      $el.find(".thumb-category").text().trim() ||
      (category === "old_drama" ? "추억의 드라마" : "드라마");
    const likesStr = $el.find(".thumb-good, .good").text().replace(/[^\d]/g, "");
    const likes = likesStr ? parseInt(likesStr, 10) : null;

    items.push({
      id,
      title,
      poster,
      detail_url: `${baseUrl}/${category}/${wrId}`,
      remarks: categoryBadge,
      status: category === "old_drama" ? "완결" : "방영중",
      category,
      likes,
    });
  });

  return {
    items,
    page: currentPage,
    has_next: false,
    total_pages: 1,
  };
}

/**
 * Parses TVWIKI detail & episode view page (`/{category}/{wr_id}` or `/{category}/{wr_id}/{ep_idx}`).
 */
export function parseTvwikiDetailHtml(
  html: string,
  dramaId: string,
  baseUrl: string
): AnimeDetail | null {
  const $ = cheerio.load(html);
  const { category, wrId } = parseDramaId(dramaId);
  const canonicalId = toDramaId(category, wrId);

  const $h3 = $("#bo_v_movinfo h3").first().clone();
  const rawOriginalTitle = $h3.find(".ori_title").text().replace(/^원제\s*:\s*/i, "").trim();
  $h3.find(".ori_title").remove();
  let title = $h3.text().trim();

  if (!title) {
    title = $("meta[property='og:title']").attr("content")?.replace(/\s*-\s*티비위키.*$/i, "").trim() || "";
  }
  if (!title) return null;

  const rawPoster =
    $("#bo_v_poster img").attr("data-src") ||
    $("#bo_v_poster img").attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    "";
  const poster = normalizeUrl(rawPoster, baseUrl);

  let country = "";
  let language = "";
  let year = "";
  const infoDds = $("#bo_v_movinfo dl.bo_v_info dd");
  if (infoDds.length >= 1) country = $(infoDds[0]).text().trim();
  if (infoDds.length >= 2) language = $(infoDds[1]).text().trim();
  if (infoDds.length >= 3) year = $(infoDds[2]).text().trim();

  const genres: string[] = [];
  $("#bo_v_movinfo dl.tags dd a").each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g)) genres.push(g);
  });
  if (category === "old_drama" && !genres.includes("추억의 드라마")) {
    genres.unshift("추억의 드라마");
  }

  let description =
    $("#bo_v_con").text().trim() ||
    $("#bo_v_movinfo > p").text().trim() ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    "";

  const cast: CastMember[] = [];
  $(".slider_act .item").each((_, el) => {
    const $item = $(el);
    const name = $item.find(".name").text().trim();
    const imgRaw =
      $item.find("img").attr("data-src") ||
      $item.find("img").attr("src") ||
      "";
    if (name) {
      cast.push({
        name,
        image: normalizeUrl(imgRaw, baseUrl),
      });
    }
  });

  // Parse episode list (#other_list ul li)
  const rawEpisodes: {
    epIdx: string;
    epNum: number | null;
    title: string;
    watchUrl: string;
    thumbnail: string;
    summary: string;
  }[] = [];

  $("#other_list ul li").each((_, el) => {
    const $li = $(el);
    const epIdx = String($li.attr("data-ep-idx") || "").trim();
    const $link = $li.find("a.ep-link, a.title, a").first();
    const href = $link.attr("href") || (epIdx ? `/${category}/${wrId}/${epIdx}` : "");
    if (!href) return;

    const epTitle = $li.find("a.title").text().trim() || $link.attr("title")?.trim() || "";
    const $img = $li.find("img").first();
    const thumbRaw = $img.attr("data-src") || $img.attr("data-original") || $img.attr("src") || "";
    const summary = $li.find("p").text().trim();

    // Extract episode number from title (e.g. "날아올라라 나비 9화" -> 9)
    let epNum: number | null = null;
    const epMatch = epTitle.match(/第?\s*(\d+)\s*(?:화|회|부|편|장|기|Ep)/i) || epTitle.match(/(\d+)\s*$/);
    if (epMatch) {
      epNum = parseInt(epMatch[1], 10);
    }

    rawEpisodes.push({
      epIdx,
      epNum,
      title: epTitle,
      watchUrl: normalizeUrl(href, baseUrl),
      thumbnail: normalizeUrl(thumbRaw, baseUrl),
      summary,
    });
  });

  // If page has a player iframe but #other_list was empty (single episode / special drama)
  if (rawEpisodes.length === 0) {
    const iframeSession = $("#view_iframe").attr("data-session1");
    if (iframeSession) {
      try {
        const parsed = JSON.parse(iframeSession);
        const epIdx = String(parsed.idx || "1");
        const epNum = parseInt(String(parsed.s || "1"), 10) || 1;
        rawEpisodes.push({
          epIdx,
          epNum,
          title: `${title} ${epNum}화`,
          watchUrl: `${baseUrl}/${category}/${wrId}/${epIdx}`,
          thumbnail: poster,
          summary: "",
        });
      } catch {}
    }
  }

  // Sort episodes in ascending order (1화 -> 최신화)
  // TVWIKI usually lists newest episodes first in #other_list
  const reversed = [...rawEpisodes].reverse();
  const usedNums = new Set<number>();
  const subEpisodes: EpisodeItem[] = reversed.map((ep, idx) => {
    let num = ep.epNum && ep.epNum > 0 && !usedNums.has(ep.epNum) ? ep.epNum : idx + 1;
    while (usedNums.has(num)) num++;
    usedNums.add(num);

    // Strip the drama title prefix if redundant or keep clean episode label
    let cleanEpTitle = ep.title || `${num}화`;
    if (cleanEpTitle.startsWith(title)) {
      const stripped = cleanEpTitle.slice(title.length).trim();
      if (stripped) cleanEpTitle = stripped;
    }

    return {
      number: num,
      title: cleanEpTitle,
      watch_url: ep.watchUrl,
      ep_idx: ep.epIdx,
      thumbnail: ep.thumbnail,
      summary: ep.summary,
    };
  });

  subEpisodes.sort((a, b) => a.number - b.number);

  const isFinished = category === "old_drama" || /완결|종영/.test(description);

  return {
    id: canonicalId,
    title,
    poster,
    description,
    genres,
    sub_episodes: subEpisodes,
    dub_episodes: [],
    total_episodes: subEpisodes.length,
    status_text: isFinished ? "완결" : "방영중",
    year,
    is_finished: isFinished,
    original_title: rawOriginalTitle || undefined,
    country: country || undefined,
    language: language || undefined,
    cast: cast.length > 0 ? cast : undefined,
  };
}

/**
 * Decrypts Lv3 payload from TVWIKI's bunny-frame player if possible.
 */
function decryptLv3Payload(
  hexCipher: string,
  wrappedKey: string,
  wrap: { k: string; v: string }
): string {
  if (!hexCipher || !wrappedKey || !wrap?.k || !wrap?.v) return "";
  try {
    const wrapKey = Buffer.from(wrap.k, "hex");
    const wrapIv = Buffer.from(wrap.v, "hex");
    const alg1 = wrapKey.length === 16 ? "aes-128-cbc" : "aes-256-cbc";
    const d1 = crypto.createDecipheriv(alg1, wrapKey, wrapIv);
    const unwrapped = Buffer.concat([
      d1.update(Buffer.from(wrappedKey, "hex")),
      d1.final(),
    ]);
    const dynKey = unwrapped.subarray(0, 16);
    const dynIv = unwrapped.subarray(16, 32);
    const d2 = crypto.createDecipheriv("aes-128-cbc", dynKey, dynIv);
    const dec = Buffer.concat([
      d2.update(Buffer.from(hexCipher, "hex")),
      d2.final(),
    ]);
    return dec.toString("utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Extracts both the signed embed player URL and the decrypted direct HLS `.m3u8` URL
 * from a TVWIKI episode page (`/{category}/{wr_id}/{ep_idx}`).
 */
export async function resolveTvwikiEpisodeStream(
  watchUrl: string,
  baseUrl: string
): Promise<EpisodeStreamInfo | null> {
  // Replace host in watchUrl with current baseUrl in case domain changed
  let targetEpUrl = watchUrl;
  try {
    const parsedWatch = new URL(watchUrl, baseUrl);
    const parsedBase = new URL(baseUrl);
    parsedWatch.protocol = parsedBase.protocol;
    parsedWatch.host = parsedBase.host;
    targetEpUrl = parsedWatch.toString();
  } catch {}

  const epRes = await resilientFetch(targetEpUrl, {
    headers: { Referer: `${baseUrl}/` },
    timeoutMs: 8000,
  });
  if (!epRes.ok || !epRes.body) return null;

  const $ = cheerio.load(epRes.body);
  const rawSession = $("#view_iframe").attr("data-session1");
  if (!rawSession) return null;

  let sessionData: Record<string, any>;
  try {
    sessionData = JSON.parse(rawSession);
  } catch {
    return null;
  }

  const rawCookies = epRes.headers["set-cookie"];
  const cookieHeader = Array.isArray(rawCookies)
    ? rawCookies.map((c) => c.split(";")[0]).join("; ")
    : typeof rawCookies === "string"
    ? rawCookies.split(";")[0]
    : "";

  const createSessionUrl = `${baseUrl.replace(/\/+$/, "")}/api/create_session.php`;
  const sessRes = await resilientFetch(createSessionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: targetEpUrl,
      Origin: baseUrl.replace(/\/+$/, ""),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(sessionData),
    timeoutMs: 8000,
  });

  if (!sessRes.ok || !sessRes.body) return null;

  let sessJson: any;
  try {
    sessJson = JSON.parse(sessRes.body);
  } catch {
    return null;
  }

  if (!sessJson?.success || !sessJson?.player_url) return null;

  const embedUrl = `${sessJson.player_url}?t=${encodeURIComponent(sessJson.t || "")}&sig=${encodeURIComponent(sessJson.sig || "")}`;
  let m3u8Url = "";
  let vttUrl = typeof sessionData.vtt === "string" && sessionData.vtt.startsWith("http") ? sessionData.vtt : "";
  let playerOrigin = "";

  try {
    playerOrigin = new URL(embedUrl).origin;
    const pRes = await resilientFetch(embedUrl, {
      headers: { Referer: `${baseUrl.replace(/\/+$/, "")}/` },
      timeoutMs: 7000,
    });

    if (pRes.ok && pRes.body) {
      const pRawCookies = pRes.headers["set-cookie"];
      const pCookieHeader = Array.isArray(pRawCookies)
        ? pRawCookies.map((c) => c.split(";")[0]).join("; ")
        : typeof pRawCookies === "string"
        ? pRawCookies.split(";")[0]
        : "";

      const scripts = [...pRes.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((x) => x[1])
        .filter((s) => s.includes("window._") && !s.includes("key-share.php"));

      if (scripts.length > 0) {
        const ctx: { window: Record<string, any> } = { window: {} };
        for (const s of scripts) {
          try {
            vm.runInNewContext(s, ctx, { timeout: 500 });
          } catch {}
        }
        const varName = Object.keys(ctx.window)[0];
        const encObj = varName ? ctx.window[varName] : null;

        if (encObj?.t && encObj?.k && Array.isArray(encObj?.b) && encObj.b.length > 0) {
          const ksRes = await resilientFetch(`${playerOrigin}/api/key-share.php`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Referer: embedUrl,
              Origin: playerOrigin,
              ...(pCookieHeader ? { Cookie: pCookieHeader } : {}),
            },
            body: JSON.stringify({ token: encObj.t }),
            timeoutMs: 6000,
          });

          if (ksRes.ok && ksRes.body) {
            const ks = JSON.parse(ksRes.body);
            if (ks?.ok && ks?.k2) {
              let keyHex = "";
              for (let i = 0; i < encObj.k.length; i += 2) {
                keyHex += (
                  parseInt(encObj.k.substr(i, 2), 16) ^
                  parseInt(ks.k2.substr(i, 2), 16)
                )
                  .toString(16)
                  .padStart(2, "0");
              }
              const keyBuf = Buffer.from(keyHex, "hex");
              const alg = keyBuf.length === 16 ? "aes-128-cbc" : "aes-256-cbc";

              for (const block of encObj.b) {
                try {
                  const ivBuf = Buffer.from(block.v, "hex");
                  const ctBuf = Buffer.from(block.c, "base64");
                  const decipher = crypto.createDecipheriv(alg, keyBuf, ivBuf);
                  const dec = Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString("utf8");
                  const cfgMatch = dec.match(/const ART_CONFIG\s*=\s*(\{[\s\S]*?\});/);
                  if (cfgMatch) {
                    const artConfig = vm.runInNewContext("(" + cfgMatch[1] + ")", {}, { timeout: 500 });
                    if (artConfig?.wrappedKey && artConfig?.wrapNonce) {
                      const wrapReq = {
                        n: artConfig.wrapNonce,
                        sid: artConfig.wrapSession,
                        iat: String(artConfig.wrapIssuedAt),
                        sig: artConfig.wrapSignature,
                      };
                      const wRes = await resilientFetch(`${playerOrigin}/wrap_key.php`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Referer: embedUrl,
                          Origin: playerOrigin,
                          ...(pCookieHeader ? { Cookie: pCookieHeader } : {}),
                        },
                        body: JSON.stringify(wrapReq),
                        timeoutMs: 6000,
                      });
                      if (wRes.ok && wRes.body) {
                        const wData = JSON.parse(wRes.body);
                        if (wData?.a && wData?.b && wData?.c && wData?.d) {
                          const wrap = { k: wData.a + wData.b, v: wData.c + wData.d };
                          const directUrl = decryptLv3Payload(
                            artConfig.directPayload,
                            artConfig.wrappedKey,
                            wrap
                          );
                          const playbackUrl = decryptLv3Payload(
                            artConfig.urlPayload,
                            artConfig.wrappedKey,
                            wrap
                          );
                          m3u8Url = directUrl || playbackUrl || "";
                          if (!vttUrl && typeof artConfig.srt === "string" && artConfig.srt.startsWith("http")) {
                            vttUrl = artConfig.srt;
                          }
                        }
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[TVWIKI Lv3 m3u8 decrypt fallback to iframe]:", err);
  }

  return {
    success: true,
    m3u8_url: m3u8Url,
    vtt_url: vttUrl,
    player_url: playerOrigin ? `${playerOrigin}/` : embedUrl,
    embed_url: embedUrl,
    stream_type: m3u8Url ? "m3u8" : "iframe",
    server_sources: [
      {
        label: "TVWIKI 고화질 서버",
        player_url: embedUrl,
      },
    ],
    link_next: "",
    link_pre: "",
  };
}

class TvwikiProvider implements AnimeProvider {
  readonly name = "tvwiki" as const;
  readonly displayName = "TVWIKI (티비위키)";

  async getBaseUrl(): Promise<string> {
    const url = await getTvwikiBaseUrl();
    return (url || DEFAULT_TVWIKI_URL).replace(/\/+$/, "");
  }

  /**
   * Fetches a TVWIKI page with automatic Telegram / tvwiki.store domain failover if the current domain is down.
   */
  private async fetchWithFailover(
    pathAndQuery: string,
    options: ResilientFetchOptions = {}
  ): Promise<{ res: ResilientFetchResponse; baseUrl: string }> {
    let baseUrl = await this.getBaseUrl();
    const cleanPath = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;

    try {
      const res = await resilientFetch(`${baseUrl}${cleanPath}`, options);
      if (res.ok && res.body && !res.body.includes("error-code")) {
        return { res, baseUrl };
      }
    } catch {}

    // Domain failed -> discover latest domain via Telegram / tvwiki.store
    const discovered = await resolveLatestTvwikiUrl();
    if (discovered && discovered !== baseUrl) {
      await setTvwikiBaseUrl(discovered);
      baseUrl = discovered;
    }

    const retryRes = await resilientFetch(`${baseUrl}${cleanPath}`, options);
    return { res: retryRes, baseUrl };
  }

  async getAnimeListFiltered(params: AnimeListFilterParams): Promise<AnimeListResponse> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const isOldDrama =
      params.category === "old_drama" ||
      params.category === "finished" ||
      params.section === "old_drama";
    const categoryPath: "drama" | "old_drama" = isOldDrama ? "old_drama" : "drama";

    // Sort mapping
    let sst = params.sort || "subidx";
    if (!params.sort) {
      if (params.category === "top" || params.category === "trending") {
        sst = "wr_hit";
      } else {
        sst = "subidx";
      }
    }

    const sodParam = sst === "wr_6" || sst === "wr_5" ? "&sod=desc" : "";
    const query = `/${categoryPath}?sst=${encodeURIComponent(sst)}${sodParam}&page=${page}`;

    try {
      const { res, baseUrl } = await this.fetchWithFailover(query);
      if (!res.ok || !res.body) {
        return { items: [], page, has_next: false, total_pages: 1 };
      }
      return parseTvwikiCategoryListHtml(res.body, baseUrl, categoryPath, page);
    } catch (error) {
      console.error("[TvwikiProvider.getAnimeListFiltered error]:", error);
      return { items: [], page, has_next: false, total_pages: 1 };
    }
  }

  async getAnimeList(params: {
    category?:
      | "recent_caption"
      | "airing"
      | "top"
      | "movie"
      | "finished"
      | "trending"
      | "upcoming"
      | "list"
      | "adult"
      | "drama"
      | "old_drama";
    page?: number;
    genre?: string;
    period?: "day" | "week" | "month" | "all";
    sort?: string;
    day?: number | string;
    season?: string;
  }): Promise<AnimeListResponse> {
    return this.getAnimeListFiltered(params);
  }

  async searchAnime(keyword: string, page = 1): Promise<AnimeListResponse> {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return { items: [], page: 1, has_next: false, total_pages: 1 };
    }

    const query = `/search?stx=${encodeURIComponent(trimmed)}&page=${page}`;
    try {
      const { res, baseUrl } = await this.fetchWithFailover(query);
      if (!res.ok || !res.body) {
        return { items: [], page, has_next: false, total_pages: 1 };
      }
      return parseTvwikiSearchHtml(res.body, baseUrl, page);
    } catch (error) {
      console.error("[TvwikiProvider.searchAnime error]:", error);
      return { items: [], page, has_next: false, total_pages: 1 };
    }
  }

  async getAnimeDetail(animeId: string): Promise<AnimeDetail | null> {
    const { category, wrId } = parseDramaId(animeId);
    if (!wrId) return null;

    try {
      const { res, baseUrl } = await this.fetchWithFailover(`/${category}/${wrId}`);
      if (!res.ok || !res.body) return null;
      return parseTvwikiDetailHtml(res.body, animeId, baseUrl);
    } catch (error) {
      console.error("[TvwikiProvider.getAnimeDetail error]:", error);
      return null;
    }
  }

  async getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null> {
    try {
      let baseUrl = await this.getBaseUrl();
      let info = await resolveTvwikiEpisodeStream(watchUrl, baseUrl);
      if (info) return info;

      const discovered = await resolveLatestTvwikiUrl();
      if (discovered && discovered !== baseUrl) {
        await setTvwikiBaseUrl(discovered);
        baseUrl = discovered;
        info = await resolveTvwikiEpisodeStream(watchUrl, baseUrl);
      }
      return info;
    } catch (error) {
      console.error("[TvwikiProvider.getEpisodeStream error]:", error);
      return null;
    }
  }
}

export const tvwikiProvider = new TvwikiProvider();
