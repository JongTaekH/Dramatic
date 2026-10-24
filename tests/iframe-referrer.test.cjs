const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const load = require('./load-ts.cjs');

test('external fallback iframe does not send the application origin as Referer', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dramatic-seven.vercel.app/watch/dr_12442/2' });
  const previous = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => new Response(JSON.stringify({ success: true, items: [] }));
  const Player = load('src/components/IframePlayer.tsx', {
    'lucide-react': new Proxy({}, { get: () => () => null }),
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/iframePip': load('src/lib/iframePip.ts'),
  }).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await React.act(async () => {
      root.render(React.createElement(Player, {
        animeId: 'dr_12442', animeTitle: 'Test episode', episodeNumber: 2,
        embedUrl: 'https://player.bunny-frame.online/v/test?t=1&sig=test',
      }));
    });
    const frame = dom.window.document.querySelector('iframe');
    assert.ok(frame, 'fallback player must be mounted');
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.ok(!frame.getAttribute('sandbox').split(' ').includes('allow-fullscreen'));
    assert.equal(new URL(frame.src).searchParams.get('sig'), 'test');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    global.window = previous.window;
    global.document = previous.document;
    global.fetch = previous.fetch;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test('iframe player shows Netflix-style next episode card on ended event and omits duplicate mobile tap zones', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dramatic-seven.vercel.app/watch/dr_12442/2' });
  const previous = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    fetch: global.fetch,
    act: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => new Response(JSON.stringify({ success: true, items: [] }));
  const Player = load('src/components/IframePlayer.tsx', {
    'lucide-react': new Proxy({}, { get: () => () => null }),
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/iframePip': load('src/lib/iframePip.ts'),
  }).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await React.act(async () => {
      root.render(React.createElement(Player, {
        animeId: 'dr_12442',
        animeTitle: '테스트 드라마',
        episodeNumber: 2,
        linkNextEp: 3,
        embedUrl: 'https://player.bunny-frame.online/v/test?t=1&sig=test',
      }));
    });
    const frame = dom.window.document.querySelector('iframe');
    assert.ok(frame, 'fallback player must be mounted');
    assert.equal(dom.window.document.querySelector('.md\\:hidden'), null, 'duplicate mobile tap overlay should be removed');
    assert.equal(dom.window.document.querySelector('.art-netflix-next-card'), null, 'next episode card hidden before end');

    await React.act(async () => {
      const msg = new dom.window.MessageEvent('message', {
        data: { source: 'tvp', type: 'ended', idx: 2 },
        source: frame.contentWindow,
      });
      dom.window.dispatchEvent(msg);
    });

    const nextCard = dom.window.document.querySelector('.art-netflix-next-card.active');
    assert.ok(nextCard, 'Netflix next episode card should appear when video ends');
    assert.ok(nextCard.textContent.includes('다음 화 재생 (3화)'));
    assert.ok(nextCard.textContent.includes('계속 보기'));
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    global.window = previous.window;
    global.document = previous.document;
    global.localStorage = previous.localStorage;
    global.fetch = previous.fetch;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
