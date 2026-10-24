const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const db = {
  DEFAULT_TVWIKI_URL: 'https://tvwiki54.net',
  TELEGRAM_TVWIKI_URL: 'https://t.me/s/tvwiki_url',
  TVWIKI_STORE_URL: 'https://tvwiki.store',
  TVWIKI_URL_GUIDE: 'https://tvwikiurl.net/',
};
const provider = load('src/lib/providers/tvwiki.ts', { '../db': db });
const response = (body, url = '', ok = true) => ({ body, url, ok, status: ok ? 200 : 503, headers: {} });

test('54 episode uses 55 session and the new TVP HLS configuration', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/drama/')) return response('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>', url);
    if (url.endsWith('create_session.php')) return response(JSON.stringify({ success: true, player_url: 'https://player.example/player?existing=1', t: 'a+b', sig: 's' }), url);
    return response('<script>window.TVP_CONFIG={"mode":"direct","src":"https://cdn.example/c.html?token=abc","subtitle":"https://cdn.example/sub.vtt"};</script>', url);
  };
  const info = await provider.resolveTvwikiEpisodeStream('https://tvwiki54.net/drama/1/123', 'https://tvwiki55.net', fetcher);
  assert.equal(calls[0].url, 'https://tvwiki55.net/drama/1/123');
  assert.equal(calls[1].url, 'https://tvwiki55.net/api/create_session.php');
  assert.equal(info.m3u8_url, 'https://cdn.example/c.html?token=abc');
  assert.equal(info.stream_type, 'm3u8');
  assert.equal(new URL(info.embed_url).searchParams.get('existing'), '1');
  assert.equal(new URL(info.embed_url).searchParams.get('t'), 'a+b');
});

test('independent guide works when Telegram and store fail', async () => {
  const fetcher = async (url) => {
    if (url === db.TVWIKI_URL_GUIDE) return response('<a href="https://tvwiki55.net/">Go</a>', url);
    if (url === 'https://tvwiki55.net/drama') return response('<div id="list_type"></div>', url);
    throw new Error('Unavailable');
  };
  assert.equal(await provider.resolveLatestTvwikiUrl(fetcher), 'https://tvwiki55.net');
});

test('unverified candidates never replace the saved domain', async () => {
  const fetcher = async (url) => response(url.includes('/drama') ? 'unavailable' : 'https://tvwiki55.net/', url, !url.includes('/drama'));
  assert.equal(await provider.resolveLatestTvwikiUrl(fetcher), null);
});

test('upstream player JavaScript is never executed on the server', async () => {
  const marker = '__drama_upstream_executed';
  delete process.env[marker];
  const fetcher = async (url) => {
    if (url.includes('/drama/')) return response('<iframe id="view_iframe" data-session1="{&quot;idx&quot;:123}"></iframe>', url);
    if (url.endsWith('create_session.php')) return response(JSON.stringify({ success: true, player_url: 'https://player.example/player' }), url);
    return response(`<script>window._test=window.constructor.constructor('return process')().env.${marker}='yes';</script>`, url);
  };
  try {
    const info = await provider.resolveTvwikiEpisodeStream('https://tvwiki55.net/drama/1/123', 'https://tvwiki55.net', fetcher);
    assert.equal(process.env[marker], undefined);
    assert.equal(info.stream_type, 'iframe');
  } finally { delete process.env[marker]; }
});

test('non-admin authenticated account can save; anonymous cannot', async () => {
  let user = { id: 2, isAdmin: false };
  let saved;
  const route = load('src/app/api/settings/base-url/route.ts', {
    '@/lib/db': { ...db, setTvwikiBaseUrl: async (url) => { saved = url; return true; } },
    '@/lib/auth': { getSessionUser: async () => user },
    '@/lib/providers/tvwiki': { resilientFetch: async () => response('<div id="list_type"></div>') },
    '@/lib/proxyGuard': { assertSafeProxyUrl: async () => {}, UnsafeProxyUrlError: class extends Error {} },
  });
  const request = () => new Request('http://localhost/api/settings/base-url', { method: 'POST', body: JSON.stringify({ baseUrl: 'https://tvwiki55.net/' }) });
  const result = await route.POST(request());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).success, true);
  assert.equal(saved, 'https://tvwiki55.net');
  for (const baseUrl of ['https://example.com', 'https://tvwiki55.net.evil.test', 'http://tvwiki55.net', 'https://user:pass@tvwiki55.net', 'https://tvwiki55.net:8443', 'https://tvwiki55.net/drama']) {
    const invalid = await route.POST(new Request('http://localhost/api/settings/base-url', { method: 'POST', body: JSON.stringify({ baseUrl, force: true }) }));
    assert.equal(invalid.status, 400, baseUrl);
  }
  user = null;
  assert.equal((await route.POST(request())).status, 401);
});

test('missing database does not report permanent save success', async () => {
  const names = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING'];
  const previous = names.map(n => process.env[n]);
  names.forEach(n => delete process.env[n]);
  try {
    const actual = load('src/lib/db.ts');
    assert.equal(await actual.setTvwikiBaseUrl('https://tvwiki55.net'), false);
  } finally {
    names.forEach((n, i) => previous[i] === undefined ? delete process.env[n] : process.env[n] = previous[i]);
  }
});

test('auto-discovery reports database write failure instead of success', async () => {
  const route = load('src/app/api/settings/base-url/route.ts', {
    '@/lib/db': { ...db, setTvwikiBaseUrl: async () => false },
    '@/lib/auth': { getSessionUser: async () => ({ id: 2, isAdmin: false }) },
    '@/lib/providers/tvwiki': { resolveLatestTvwikiUrl: async () => 'https://tvwiki55.net', resilientFetch: async () => response('<div id="list_type"></div>') },
    '@/lib/proxyGuard': { assertSafeProxyUrl: async () => {}, UnsafeProxyUrlError: class extends Error {} },
  });
  const result = await route.POST(new Request('http://localhost/api/settings/base-url', { method: 'POST', body: JSON.stringify({ action: 'auto_discover' }) }));
  assert.equal(result.status, 500);
  assert.equal((await result.json()).success, false);
});
