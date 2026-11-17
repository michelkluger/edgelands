// Live shadow input: which projector tiles does a body's shadow cover right now? No DOM, testable.

/**
 * `cur` and `ref` are grayscale camera frames downscaled by `step` (ref = the empty lit wall, same exposure). A camera sample
 * counts as shadow when it's much darker than the empty wall there; each sample is mapped through the camera→projector
 * table `map` (full camera resolution, width `camW`) onto a projector tile. A tile is shadow when most of its samples are.
 * Tiles no sample landed on take the majority of their 4 neighbours, so the mask has no pin-holes.
 */
export function shadowMask(
  cur: Uint8Array,
  ref: Uint8Array,
  map: Int16Array,
  camW: number,
  step: number,
  cols: number,
  rows: number,
  tile: number,
  ratio = 0.55, // < 55% of the empty wall = shadow; anything the game draws stays brighter than that (see catch.ts)
) {
  const dark = new Uint16Array(cols * rows), all = new Uint16Array(cols * rows), w = Math.round(camW / step);
  for (let i = 0; i < cur.length; i++) {
    const j = Math.floor(i / w) * step * camW + (i % w) * step, u = map[2 * j];
    if (u < 0 || ref[i] < 24) continue; // outside the beam, or too dark to tell shadow from wall
    const t = Math.floor(map[2 * j + 1] / tile) * cols + Math.floor(u / tile);
    if (t < 0 || t >= all.length) continue;
    all[t]++;
    if (cur[i] < ref[i] * ratio) dark[t]++;
  }
  const mask = new Uint8Array(cols * rows);
  for (let t = 0; t < mask.length; t++) mask[t] = all[t] && dark[t] * 2 > all[t] ? 1 : 0;
  for (let t = 0; t < mask.length; t++) {
    if (all[t]) continue;
    const c = t % cols, n = (c > 0 ? mask[t - 1] : 0) + (c < cols - 1 ? mask[t + 1] : 0) + (mask[t - cols] ?? 0) + (mask[t + cols] ?? 0);
    if (n >= 2) mask[t] = 1;
  }
  return mask;
}
