// Decode the JSON key envelope used by current TVP direct HLS streams.
// Legacy endpoints already return the raw 16-byte AES key.
export function decodeHlsKey(input: Uint8Array): Uint8Array {
  if (input.length === 16) return new Uint8Array(input);
  if (input.length > 65536) throw new Error("HLS key response too large");
  const envelope = JSON.parse(Buffer.from(input).toString("utf8"));
  if (envelope.version !== 7 || envelope.key_length !== 16 || !Array.isArray(envelope.layers)) {
    throw new Error("Unsupported HLS key envelope");
  }
  const layers = new Map<string, any>(envelope.layers.map((layer: any) => [layer.name, layer]));
  const layer = (name: string) => {
    const value = layers.get(name);
    if (!value) throw new Error(`Missing HLS key layer: ${name}`);
    return value;
  };
  const bytes = (value: unknown): Buffer => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_+/=-]+$/.test(value)) throw new Error("Invalid key encoding");
    const result = Buffer.from(value, "base64url");
    if (!result.length) throw new Error("Empty key data");
    return result;
  };
  const integers = (value: unknown, max: number): number[] => {
    if (!Array.isArray(value) || !value.length || value.length > 1024 ||
        !value.every(n => Number.isInteger(n) && n >= 0 && n <= max)) {
      throw new Error("Invalid HLS key metadata");
    }
    return value;
  };
  const permutation = (value: unknown, size: number) => {
    const items = integers(value, size - 1);
    if (items.length !== size || new Set(items).size !== size) throw new Error("Invalid key permutation");
    return items;
  };

  const encoded = bytes(envelope.encrypted_key);
  const mask = bytes(layer("final_encrypt").xor_mask);
  const shuffle = layer("decoy_shuffle");
  const lengths = integers(shuffle.segment_lengths, 4096);
  const total = lengths.reduce((sum, size) => sum + size, 0);
  if (total > encoded.length || lengths.some(size => size === 0)) throw new Error("Truncated key segments");
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const length of lengths) {
    const chunk = Buffer.alloc(length);
    for (let n = 0; n < length; n++, offset++) chunk[n] = encoded[offset] ^ mask[offset % mask.length];
    chunks.push(chunk);
  }
  const positions = integers(shuffle.real_positions, chunks.length - 1);
  if (positions.length !== 16 || new Set(positions).size !== 16) throw new Error("Invalid real key segments");
  const order = permutation(layer("segment_noise").perm, 16);
  const rotated = new Uint8Array(16);
  let previous = bytes(layer("xor_chain").init_key);
  positions.forEach((position, index) => {
    const chunk = chunks[position];
    rotated[order[index]] = chunk[0] ^ previous[0];
    previous = chunk.subarray(0, 4);
  });
  const rotations = integers(layer("bit_rotate").rotations, 255);
  const substitution = bytes(layer("sbox").inverse_sbox);
  if (substitution.length !== 256 || new Set(substitution).size !== 256) throw new Error("Invalid key substitution");
  const packed = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const shift = rotations[i % rotations.length] % 8;
    const value = ((rotated[i] >>> shift) | (rotated[i] << (8 - shift))) & 255;
    packed[i] = substitution[value];
  }
  const bitOrder = permutation(layer("bit_interleave").perm, 128);
  const key = new Uint8Array(16);
  bitOrder.forEach((destination, source) => {
    const bit = (packed[source >> 3] >> (7 - (source & 7))) & 1;
    key[destination >> 3] |= bit << (7 - (destination & 7));
  });
  return key;
}
