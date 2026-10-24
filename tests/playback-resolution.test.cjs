const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const provider = load('src/lib/providers/tvwiki.ts', { '../db': {} });
const reply = (body, status = 200) => ({ body, ok: status === 200, status, headers: {} });

test('Cloudflare server blocks are distinguished from invalid playback URLs', async () => {
  const fetcher = async url => {
    if (url.includes('/drama/')) return reply('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>');
    if (url.endsWith('create_session.php')) return reply(JSON.stringify({ success: true, short_id: 'blocked123', player_url: 'https://player.example/v/blocked123' }));
    return { ...reply('<html><h1>Sorry, you have been blocked</h1><p>Cloudflare Ray ID</p></html>', 403), headers: { server: 'cloudflare' } };
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(info.unsupported_reason, 'PLAYER_ACCESS_BLOCKED');
});

test('blocked access response includes the original episode and truthful status', async () => {
  const route = load('src/app/api/anime/episode_info/route.ts', {
    '@/lib/auth': { getSessionUser: async () => ({ id: 2 }) },
    '@/lib/providers': { getProviderByAnimeId: () => ({
      getAnimeDetail: async () => ({ title: 'Test', sub_episodes: [{ number: 2, watch_url: 'https://tvwiki55.net/drama/1/123' }], dub_episodes: [] }),
      getEpisodeStream: async () => ({ success: false, m3u8_url: '', unsupported_reason: 'PLAYER_ACCESS_BLOCKED' }),
    }) },
  });
  const result = await route.GET(new Request('http://localhost/api/anime/episode_info?id=dr_1&ep=2'));
  const data = await result.json();
  assert.equal(result.status, 502);
  assert.equal(data.watch_url, 'https://tvwiki55.net/drama/1/123');
  assert.equal(data.code, 'PLAYER_ACCESS_BLOCKED');
  assert.match(data.message, /차단/);
});

test('TVWIKI get_episode.php resolves direct HLS without contacting external player servers', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/bbs/get_episode.php')) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('bo_table'), 'drama');
      assert.equal(parsed.searchParams.get('wr_id'), '12442');
      assert.equal(parsed.searchParams.get('ep_idx'), '406786118');
      assert.equal(options.headers.Referer, 'https://tvwiki55.net/drama/12442/406786118');
      return reply(JSON.stringify({
        success: true,
        episode: {
          idx: 406786118,
          hls_url: 'https://every9.poorcdn.com/v/e/66f638/c.html?token=direct&expires=123',
          vtt: '/subtitles/ep2.vtt',
        },
      }));
    }
    return reply('Forbidden', 403);
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/12442/406786118', 'https://tvwiki55.net', fetcher);
  assert.equal(info.success, true);
  assert.equal(info.m3u8_url, 'https://every9.poorcdn.com/v/e/66f638/c.html?token=direct&expires=123');
  assert.equal(info.vtt_url, 'https://tvwiki55.net/subtitles/ep2.vtt');
  assert.equal(info.player_url, 'https://player.bunny-frame.online/');
  assert.equal(calls.length, 1);
});

test('a fresh session resolves through the player JSON API without opening its blocked HTML page', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url.includes('/drama/')) return reply('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>');
    if (url.endsWith('create_session.php')) return reply(JSON.stringify({ success: true, short_id: 'fresh123', player_url: 'https://player.example/v/fresh123', t: 1, sig: 'test' }));
    if (url.includes('/player/api/source.php')) {
      assert.equal(new URL(url).searchParams.get('id'), 'fresh123');
      assert.equal(options.headers.Referer, 'https://player.example/v/fresh123?t=1&sig=test');
      assert.equal(options.headers.Origin, 'https://player.example');
      return reply(JSON.stringify({ mode: 'direct', src: 'https://cdn.example/v/c.html?token=fresh', subtitle: '/subtitle.vtt' }));
    }
    return reply('Forbidden player document', 403);
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(info.success, true);
  assert.equal(info.m3u8_url, 'https://cdn.example/v/c.html?token=fresh');
  assert.equal(info.vtt_url, 'https://player.example/subtitle.vtt');
  assert.ok(!calls.some(url => url.startsWith('https://player.example/v/')));
});

test('legacy player HTML remains usable when the JSON source endpoint is unavailable', async () => {
  const fetcher = async url => {
    if (url.includes('/drama/')) return reply('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>');
    if (url.endsWith('create_session.php')) return reply(JSON.stringify({ success: true, short_id: 'old123', player_url: 'https://player.example/v/old123' }));
    if (url.includes('/player/api/source.php')) return reply('not found', 404);
    return reply('<script>window.TVP_CONFIG={"mode":"direct","src":"https://cdn.example/legacy.m3u8"};</script>');
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(info.m3u8_url, 'https://cdn.example/legacy.m3u8');
});

test('a multiline relay configuration produces HLS instead of an external iframe', async () => {
  const fetcher = async url => {
    if (url.includes('/drama/')) return reply('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>');
    if (url.endsWith('create_session.php')) return reply(JSON.stringify({ success: true, player_url: 'https://player.example/v/123', t: 1, sig: 'test' }));
    return reply('<script>window.TVP_CONFIG = {\n"mode":"relay",\n"src":"/player-stream/every1.example/v/c.html"\n};</script>');
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(info.m3u8_url, 'https://player.example/player-stream/every1.example/v/c.html');
  assert.equal(info.player_url, 'https://player.example/v/123?t=1&sig=test');
});

test('episode API rejects a failed HLS resolution rather than reporting successful iframe playback', async () => {
  const route = load('src/app/api/anime/episode_info/route.ts', {
    '@/lib/auth': { getSessionUser: async () => ({ id: 2 }) },
    '@/lib/providers': { getProviderByAnimeId: () => ({
      getAnimeDetail: async () => ({ title: 'Test', sub_episodes: [{ number: 2, watch_url: 'https://tvwiki55.net/drama/1/123' }], dub_episodes: [] }),
      getEpisodeStream: async () => ({ success: false, stream_type: 'iframe', m3u8_url: '', embed_url: 'https://player.example/v/invalid', unsupported_reason: 'PLAYER_HTTP_403' }),
    }) },
  });
  const result = await route.GET(new Request('http://localhost/api/anime/episode_info?id=dr_1&ep=2'));
  assert.equal(result.status, 502);
  const data = await result.json();
  assert.equal(data.success, false);
  assert.equal(data.code, 'PLAYER_HTTP_403');
  assert.ok(data.message.includes('403'));
  assert.ok(!JSON.stringify(data).includes('player.example'));
});

test('player rejection is identified without exposing the signed player address', async () => {
  const fetcher = async url => {
    if (url.includes('/drama/')) return reply('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>');
    if (url.endsWith('create_session.php')) return reply(JSON.stringify({ success: true, player_url: 'https://player.example/v/123', t: 1, sig: 'private-signature' }));
    return reply('Forbidden', 403);
  };
  const info = await provider.resolveTvwikiEpisodeStream('/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(info.unsupported_reason, 'PLAYER_HTTP_403');
  assert.equal(info.success, false);
});
