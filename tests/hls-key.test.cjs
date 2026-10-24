const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

// Synthetic protocol fixture: known key, non-identity permutations, decoys,
// noise, rotation, substitution, chaining and final XOR padding.
function fixture() {
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const perm = Array.from({ length: 128 }, (_, i) => (i * 17) % 128);
  const order = Array.from({ length: 16 }, (_, i) => 15 - i);
  const rotations = [1, 3, 7];
  const inverse = Buffer.from(Array.from({ length: 256 }, (_, i) => i ^ 91));
  const transformed = Buffer.alloc(16);
  perm.forEach((source, i) => transformed[i >> 3] |= ((key[source >> 3] >> (7 - (source & 7))) & 1) << (7 - (i & 7)));
  for (let i = 0; i < 16; i++) {
    const byte = transformed[i] ^ 91, r = rotations[i % rotations.length];
    transformed[i] = ((byte << r) | (byte >> (8 - r))) & 255;
  }
  const initial = Buffer.from([17, 22, 33, 44]);
  let previous = initial;
  const chunks = [Buffer.from([99, 88])], positions = [];
  order.forEach((source, i) => {
    const noisy = Buffer.from([transformed[source], 201, i]);
    const chained = Buffer.from(noisy.map((b, n) => b ^ previous[n % previous.length]));
    positions.push(chunks.length); chunks.push(chained, Buffer.from([199])); previous = chained;
  });
  const mask = Buffer.from([12, 23, 34]);
  const combined = Buffer.concat(chunks);
  const encrypted = Buffer.from(combined.map((b, i) => b ^ mask[i % mask.length]));
  return { key, data: {
    version: 7, key_length: 16, encrypted_key: Buffer.concat([encrypted, Buffer.from([123])]).toString('base64url'),
    layers: [
      { name: 'bit_interleave', perm }, { name: 'sbox', inverse_sbox: inverse.toString('base64url') },
      { name: 'bit_rotate', rotations }, { name: 'segment_noise', perm: order },
      { name: 'xor_chain', init_key: initial.toString('base64url') },
      { name: 'decoy_shuffle', segment_lengths: chunks.map(c => c.length), real_positions: positions },
      { name: 'final_encrypt', xor_mask: mask.toString('base64url') },
    ],
  } };
}

test('segment proxy returns a 16-byte HLS key for a version 7 JSON response', async () => {
  const { key, data } = fixture();
  const oldFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  try {
    const route = load('src/app/api/anime/stream/segment/route.ts', {
      '@/lib/auth': { getSessionUser: async () => ({ id: 1 }) },
      '@/lib/proxyGuard': { assertSafeProxyUrl: async () => {}, UnsafeProxyUrlError: class extends Error {} },
      '@/lib/tsDemuxer': {},
      '@/lib/hlsKey': (() => { try { return load('src/lib/hlsKey.ts'); } catch { return {}; } })(),
    });
    const res = await route.GET(new Request('http://localhost/api/anime/stream/segment?url=https%3A%2F%2Fcdn.example%2Fv%2Fkey7%3Fc%3Dtest'));
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), key);
  } finally { global.fetch = oldFetch; }
});

test('raw legacy keys remain unchanged and malformed envelopes fail closed', () => {
  const { decodeHlsKey } = load('src/lib/hlsKey.ts');
  const { key, data } = fixture();
  assert.deepEqual(Buffer.from(decodeHlsKey(key)), key);
  assert.throws(() => decodeHlsKey(Buffer.from('<html>failure</html>')));
  assert.throws(() => decodeHlsKey(Buffer.from(JSON.stringify({ ...data, version: 8 }))));
  data.layers.find(l => l.name === 'bit_interleave').perm[0] = 1;
  assert.throws(() => decodeHlsKey(Buffer.from(JSON.stringify(data))), /permutation/);
});
