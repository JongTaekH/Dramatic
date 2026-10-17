import net from "net";
import dns from "dns";

export class UnsafeProxyUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeProxyUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
    if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) {
      return true;
    }
    const dotted = v6.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (dotted) {
      return isBlockedIp(
        `${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`
      );
    }
    const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIp(
        `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      );
    }
    return false;
  }

  return true;
}

function normalizeIpLiteral(host: string): string | null {
  if (net.isIP(host) !== 0) return host;

  if (/^\d{1,10}$/.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n > 0xffffffff) return null;
    return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }

  const parts = host.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  const partRe = /^(0[xX][0-9a-fA-F]{1,8}|[0-7]{1,3}|\d{1,3})$/;
  if (!parts.every((p) => partRe.test(p))) return null;

  const nums = parts.map((p) =>
    /^0[xX]/.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10)
  );
  if (nums.some((n) => Number.isNaN(n) || n > 0xffffffff)) return null;

  const octets = [0, 0, 0, 0];
  for (let i = 0; i < nums.length; i++) {
    if (i < nums.length - 1) {
      if (nums[i] > 0xff) return null;
      octets[i] = nums[i];
    } else {
      const width = 4 - nums.length + 1;
      for (let b = 0; b < width; b++) {
        octets[nums.length - 1 + b] = (nums[i] >>> (8 * (width - 1 - b))) & 0xff;
      }
    }
  }
  return octets.join(".");
}

const DNS_CACHE_TTL_MS = 60_000;
const dnsCache = new Map<string, { ips: string[]; ts: number }>();

function lookupAll(host: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS lookup timeout")), timeoutMs);
    Promise.allSettled([
      dns.promises.lookup(host, { all: true, family: 4 }),
      dns.promises.lookup(host, { all: true, family: 6 }),
    ]).then(
      (results) => {
        clearTimeout(timer);
        const ips: string[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") {
            ips.push(...(r.value as dns.LookupAddress[]).map((a) => a.address));
          }
        }
        resolve(ips);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function resolveHost(host: string): Promise<string[]> {
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL_MS) return cached.ips;
  try {
    const ips = await lookupAll(host, 2000);
    dnsCache.set(host, { ips, ts: Date.now() });
    if (dnsCache.size > 1000) {
      const oldest = dnsCache.keys().next().value;
      if (oldest !== undefined) dnsCache.delete(oldest);
    }
    return ips;
  } catch {
    return [];
  }
}

export async function assertSafeProxyUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeProxyUrlError("Invalid proxy URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeProxyUrlError("Only http(s) URLs are allowed");
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    throw new UnsafeProxyUrlError("Missing hostname");
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeProxyUrlError("Blocked hostname");
  }

  const ip = normalizeIpLiteral(host);
  if (ip) {
    if (isBlockedIp(ip)) {
      throw new UnsafeProxyUrlError("Blocked IP address");
    }
    return u;
  }

  const ips = await resolveHost(host);
  if (ips.some((resolved) => isBlockedIp(resolved))) {
    throw new UnsafeProxyUrlError("Blocked IP address");
  }

  return u;
}
