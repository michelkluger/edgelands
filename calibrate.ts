// Pure math for projector↔camera mapping: Gray code stripes → a dense per-pixel lookup table.
// Dense (not one homography) because the beam covers a room corner, ceiling and a doorway, not one flat wall.
// No DOM here so `bun test` can exercise it with synthetic frames.

export const SKIP = 3; // finest stripe is 8 px: a 720p laptop webcam blurs 4 px stripes into each other

export const gray = (n: number) => n ^ (n >> 1);
export function fromGray(g: number) {
  let b = g;
  for (let s = g >> 1; s; s >>= 1) b ^= s;
  return b;
}
export const bitsFor = (size: number) => Math.ceil(Math.log2(Math.ceil(size / (1 << SKIP))));
/** Is projector coordinate c white in stripe pattern k (0 = coarsest)? */
export const lit = (c: number, k: number, bits: number) => ((gray(c >> SKIP) >> (bits - 1 - k)) & 1) === 1;

/**
 * Per camera pixel i, map[2i], map[2i+1] = projector (u, v) at stripe-block centre, or -1 where undecodable.
 * lit = camera pixels the beam reaches, so decoded / lit is the coverage quality.
 */
export function decode(
  black: Uint8Array,
  white: Uint8Array,
  cols: [Uint8Array, Uint8Array][],
  rows: [Uint8Array, Uint8Array][],
  minLit = 20,
  minBit = 5,
) {
  const axis = (i: number, pairs: [Uint8Array, Uint8Array][]) => {
    let g = 0;
    for (const [p, n] of pairs) {
      const d = p[i] - n[i];
      if (Math.abs(d) < minBit) return -1; // ambiguous stripe edge or too dark
      g = (g << 1) | (d > 0 ? 1 : 0);
    }
    return (fromGray(g) << SKIP) + (1 << SKIP) / 2;
  };
  const map = new Int16Array(black.length * 2).fill(-1);
  let litCount = 0, decoded = 0;
  for (let i = 0; i < black.length; i++) {
    if (white[i] - black[i] < minLit) continue; // beam doesn't reach this camera pixel
    litCount++;
    const u = axis(i, cols), v = u < 0 ? -1 : axis(i, rows);
    if (v < 0) continue;
    map[2 * i] = u;
    map[2 * i + 1] = v;
    decoded++;
  }
  return { map, lit: litCount, decoded };
}

/** Spread valid entries into undecoded neighbours (`passes` px), so edge pixels sitting on a decode gap still map. */
export function fillHoles(map: Int16Array, w: number, h: number, passes = 4) {
  let cur = map.slice();
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[2 * i] >= 0) continue;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
          if (j >= 0 && cur[2 * j] >= 0) {
            next[2 * i] = cur[2 * j];
            next[2 * i + 1] = cur[2 * j + 1];
            break;
          }
      }
    cur = next;
  }
  return cur;
}
