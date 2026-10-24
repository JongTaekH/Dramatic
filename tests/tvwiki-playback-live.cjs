// Run manually: node tests/tvwiki-playback-live.cjs
// Exercises the real provider and proxy handlers. Only the local auth boundary
// and database configuration are replaced; all upstream HTTP requests are real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = require('./load-ts.cjs');

async function main() {
  const realFetch = global.fetch;
  let episodeApiCalls = 0;
  let sourceApiCalls = 0;
  let playerDocumentCalls = 0;
  global.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input.toString());
    if (url.pathname === '/bbs/get_episode.php') episodeApiCalls++;
    if (url.pathname === '/player/api/source.php') sourceApiCalls++;
    if (url.hostname.includes('bunny-frame') && /^\/v\/[^/]+$/.test(url.pathname)) playerDocumentCalls++;
    const response = await realFetch(input, options);
    if (process.env.PLAYBACK_DIAGNOSTICS === '1' && !response.ok) {
      const text = (await response.clone().text())
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/https?:\/\/[^\s"<>]+/g, '[url]')
        .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, '[redacted]').slice(0, 300);
      console.log('UPSTREAM_RESPONSE', JSON.stringify({
        host: url.hostname, path: url.pathname, status: response.status,
        server: response.headers.get('server'), challenge: response.headers.get('cf-mitigated'), text,
      }));
    }
    return response;
  };
  try {
  const provider = load('src/lib/providers/tvwiki.ts', { '../db': {
    DEFAULT_TVWIKI_URL: 'https://tvwiki55.net',
    getTvwikiBaseUrl: async () => 'https://tvwiki55.net',
  } }).tvwikiProvider;
  const auth = { getSessionUser: async () => ({ id: 1 }) };
  const endpoint = load('src/app/api/anime/episode_info/route.ts', {
    '@/lib/auth': auth,
    '@/lib/providers': { getProviderByAnimeId: () => provider },
  });
  const common = {
    '@/lib/auth': auth,
    '@/lib/proxyGuard': load('src/lib/proxyGuard.ts'),
    '@/lib/hlsKey': load('src/lib/hlsKey.ts'),
    '@/lib/tsDemuxer': load('src/lib/tsDemuxer.ts'),
  };
  const playlist = load('src/app/api/anime/stream/m3u8/route.ts', common);
  const segment = load('src/app/api/anime/stream/segment/route.ts', common);
  const infoResponse = await endpoint.GET(new Request('http://localhost/api/anime/episode_info?id=dr_12442&ep=2'));
  const info = await infoResponse.json();
  if (infoResponse.status !== 200) console.log('PLAYBACK_FAILURE', JSON.stringify(info));
  assert.equal(infoResponse.status, 200);
  assert.equal(new URL(info.watch_url).pathname, '/drama/12442/406786118');
  assert.ok(info.proxied_m3u8.startsWith('/api/anime/stream/m3u8?'));
  assert.ok(episodeApiCalls > 0 || sourceApiCalls > 0, 'fresh episode or source API must be used');
  assert.equal(playerDocumentCalls, 0, 'player document must not be needed');
  const manifestResponse = await playlist.GET(new Request(new URL(info.proxied_m3u8, 'http://localhost')));
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.text();
  assert.ok(manifest.startsWith('#EXTM3U'));
  const keyLine = manifest.split(/\r?\n/).find(line => line.startsWith('#EXT-X-KEY:'));
  const keyUrl = keyLine.match(/URI="([^"]+)"/)[1];
  const iv = Buffer.from(keyLine.match(/IV=0x([a-f0-9]+)/i)[1], 'hex');
  const mediaUrl = manifest.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
  const [keyResponse, mediaResponse] = await Promise.all([
    segment.GET(new Request(new URL(keyUrl, 'http://localhost'))),
    segment.GET(new Request(new URL(mediaUrl, 'http://localhost'))),
  ]);
  assert.equal(keyResponse.status, 200);
  assert.equal(mediaResponse.status, 200);
  const key = Buffer.from(await keyResponse.arrayBuffer());
  assert.equal(key.length, 16);
  const media = Buffer.from(await mediaResponse.arrayBuffer());
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const decoded = Buffer.concat([decipher.update(media), decipher.final()]);
  assert.equal(decoded.length % 188, 0);
  for (let offset = 0; offset < decoded.length; offset += 188) assert.equal(decoded[offset], 0x47);
  console.log(JSON.stringify({ episode: 2, episodeApiCalls, sourceApiCalls, playerDocumentCalls, episodeInfo: 200, manifest: 200, keyBytes: key.length, media: 200, decodedBytes: decoded.length, allMpegTsPacketsValid: true }));
  } finally { global.fetch = realFetch; }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
