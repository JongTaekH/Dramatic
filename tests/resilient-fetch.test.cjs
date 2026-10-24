const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { resilientFetch } = load('src/lib/providers/tvwiki.ts', { '../db': {} });

test('player requests try standard HTTPS before using custom TLS', async () => {
  const original = global.fetch;
  let standard = 0, fallback = 0;
  global.fetch = async (_url, options) => {
    standard++;
    assert.equal(options.cache, 'no-store');
    return new Response('standard player response');
  };
  try {
    const result = await resilientFetch('https://player.bunny-frame.online/v/test', {}, async () => {
      fallback++;
      return { ok: true, status: 200, headers: {}, body: 'fallback' };
    });
    assert.equal(standard, 1);
    assert.equal(fallback, 0);
    assert.equal(result.body, 'standard player response');
  } finally { global.fetch = original; }
});

test('body reads remain timed out and blocked primary status survives a failed fallback', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (_url, options) => ({
      text: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('body timeout')))),
    });
    const result = await resilientFetch('https://player.bunny-frame.online/v/test', { timeoutMs: 10 }, async () => ({ ok: true, status: 200, headers: {}, body: 'recovered body' }));
    assert.equal(result.body, 'recovered body');
    global.fetch = async () => new Response('Forbidden', { status: 403 });
    const blocked = await resilientFetch('https://player.bunny-frame.online/v/test', {}, async () => { throw new Error('fallback unavailable'); });
    assert.equal(blocked.status, 403);
  } finally { global.fetch = original; }
});

test('a failed standard connection uses the existing fallback and preserves POST data', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error('connection reset'); };
  try {
    const result = await resilientFetch('https://tvwiki55.net/api/create_session.php', { method: 'POST', body: '{"idx":1}', headers: { Cookie: 'session=test' } }, async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{"idx":1}');
      assert.equal(options.headers.Cookie, 'session=test');
      return { ok: true, status: 200, headers: {}, body: 'recovered' };
    });
    assert.equal(result.body, 'recovered');
  } finally { global.fetch = original; }
});
