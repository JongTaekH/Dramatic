const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const provider = load('src/lib/providers/tvwiki.ts', { '../db': {} });
const reply = (body, status = 200) => ({ body, ok: status === 200, status, headers: {} });

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
      getEpisodeStream: async () => ({ success: true, stream_type: 'iframe', m3u8_url: '', embed_url: 'https://player.example/v/invalid' }),
    }) },
  });
  const result = await route.GET(new Request('http://localhost/api/anime/episode_info?id=dr_1&ep=2'));
  assert.equal(result.status, 502);
  assert.equal((await result.json()).success, false);
});
