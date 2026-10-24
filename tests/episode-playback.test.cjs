const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const load = require('./load-ts.cjs');

test('playback fetches fresh HLS, renews it once, and offers retry without mounting a remote iframe', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dramatic-seven.vercel.app/watch/dr_12442/2' });
  const previous = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, proxied_m3u8: `/api/anime/stream/m3u8?fresh=${calls.length}`, embed_url: 'https://player.example/invalid', stream_type: 'iframe' }));
  };
  const Component = load('src/components/EpisodePlayback.tsx', {
    './Player': { __esModule: true, default: props => React.createElement('button', {
      'data-source': props.m3u8Url, 'data-type': props.streamType, 'data-embed': props.embedUrl || '',
      'data-episode': props.episodeNumber, onClick: () => props.onRefreshStream(3),
    }, 'simulate expired stream') },
  }).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await React.act(async () => root.render(React.createElement(Component, { animeId: 'dr_12442', animeTitle: 'Test', episodeNumber: 2 })));
    let button = dom.window.document.querySelector('[data-source]');
    assert.equal(button.dataset.source, '/api/anime/stream/m3u8?fresh=1');
    assert.equal(button.dataset.type, 'm3u8');
    assert.equal(button.dataset.embed, '');
    assert.equal(calls[0].options.cache, 'no-store');
    await React.act(async () => button.click());
    button = dom.window.document.querySelector('[data-source]');
    assert.equal(button.dataset.source, '/api/anime/stream/m3u8?fresh=2');
    assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('ep'), '3');
    assert.equal(button.dataset.episode, '3');
    await React.act(async () => button.click());
    assert.equal(calls.length, 2, 'recovery must be bounded');
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    assert.equal(dom.window.document.querySelector('iframe'), null);
    await React.act(async () => dom.window.document.querySelector('[data-retry]').click());
    assert.equal(dom.window.document.querySelector('[data-source]').dataset.source, '/api/anime/stream/m3u8?fresh=3');
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    global.window = previous.window; global.document = previous.document; global.fetch = previous.fetch; global.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
