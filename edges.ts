// Real wall edges (tape, shelf lips, frames, boxes) → a tile map in projector space. No DOM, testable.
export type Level = { tile: number; cols: number; rows: number; solid: Uint8Array };

/** map: hole-filled camera→projector lookup from calibrate.ts (2 values per camera pixel, -1 = unknown). */
export function edgeTiles(
  white: Uint8Array,
  camW: number,
  camH: number,
  map: Int16Array,
  projW: number,
  projH: number,
  tile = 8,
  minGrad = 18, // edge strength relative to local brightness (higher = fewer edges); tuned by autoresearch, tools/autoresearch/log.md
  minCluster = 5, // smaller clusters are wall texture or stubs, not usable platforms
): Level {
  const cols = Math.ceil(projW / tile), rows = Math.ceil(projH / tile);
  const count = new Uint16Array(cols * rows), m = 2 * tile, g2 = minGrad * minGrad;
  // 3×3 box blur first: white-on-white edges (wall folds, door frames) need a low threshold, and blur keeps sensor noise under it
  const g = new Uint8Array(white.length);
  for (let y = 1; y < camH - 1; y++)
    for (let x = 1; x < camW - 1; x++) {
      const i = y * camW + x;
      g[i] = (white[i - camW - 1] + white[i - camW] + white[i - camW + 1] + white[i - 1] + white[i] + white[i + 1] + white[i + camW - 1] + white[i + camW] + white[i + camW + 1]) / 9;
    }
  // typical brightness of the lit wall (median over decoded pixels): an edge whose brighter side is under half of it lies in shadow or an unlit room, where the photo is noise
  const hg = new Uint32Array(256);
  let nlit = 0;
  for (let i = 0; i < camW * camH; i++) if (map[2 * i] >= 0) hg[white[i]]++, nlit++;
  let lit = 0;
  for (let acc = 0; lit < 255 && (acc += hg[lit]) < nlit / 2; lit++);
  const sg = [1, camW + 1, camW, camW - 1];
  const mag = new Float32Array(white.length), dir = new Uint8Array(white.length); // dir: 0 horizontal, 1 diag ↘, 2 vertical, 3 diag ↙
  for (let y = 2; y < camH - 2; y++)
    for (let x = 2; x < camW - 2; x++) {
      const i = y * camW + x;
      const gx = g[i - camW + 1] + 2 * g[i + 1] + g[i + camW + 1] - g[i - camW - 1] - 2 * g[i - 1] - g[i + camW - 1];
      const gy = g[i + camW - 1] + 2 * g[i + camW] + g[i + camW + 1] - g[i - camW - 1] - 2 * g[i - camW] - g[i - camW + 1];
      mag[i] = ((gx * gx + gy * gy) * 128 * 128) / Math.max(g[i], 32) ** 2; // contrast relative to local brightness (a fold changes the lighting by a ratio), in units of a mid-grey wall
      const a = ((Math.atan2(gy, gx) * 4) / Math.PI + 8.5) % 4; // gradient angle in 45° steps, 0..4
      dir[i] = Math.floor(a);
      const o = 2 * sg[dir[i]];
      const hi = Math.max(g[i - o], g[i + o]);
      if (hi < lit / 2 && hi < 3 * Math.min(g[i - o], g[i + o])) mag[i] = 0; // in the dark, keep only strong ratio steps (a silhouette against an unlit void)
    }
  // thin each edge band to its ridge (non-maximum suppression along the gradient): one-tile lines instead of thick blobs
  const step = [1, camW + 1, camW, camW - 1], LO = 0.4;
  // each projector tile lights one patch of the scene: find the 32-px camera cell receiving most of its light (the "home"),
  // so votes from elsewhere (a window reflecting the beam) can be ignored
  const CS = 32, ccols = Math.ceil(camW / CS), ncells = ccols * Math.ceil(camH / CS), hist = new Map<number, number>(), home = new Int32Array(cols * rows).fill(-1), best = new Uint32Array(cols * rows), npx = new Uint16Array(cols * rows);
  for (let i = 0; i < camW * camH; i++) {
    const u = map[2 * i];
    if (u < 0) continue;
    const t = Math.floor(map[2 * i + 1] / tile) * cols + Math.floor(u / tile), cell = Math.floor(i / camW / CS) * ccols + Math.floor((i % camW) / CS);
    npx[t]++;
    const key = t * ncells + cell, n = (hist.get(key) ?? 0) + white[i];
    hist.set(key, n);
    if (n > best[t]) (best[t] = n), (home[t] = cell);
  }
  // hysteresis: ridge pixels above minGrad seed edges, which then grow along connected ridge pixels above LO x minGrad
  // (faint wall folds and ceiling lines are long and continuous; noise of that strength is not attached to a strong edge)
  const ridge = new Uint8Array(white.length), lo2 = g2 * LO * LO, stack: number[] = [];
  for (let y = 3; y < camH - 3; y++)
    for (let x = 3; x < camW - 3; x++) {
      const i = y * camW + x, s = step[dir[i]];
      if (mag[i] < lo2 || mag[i] < mag[i - s] || mag[i] < mag[i + s]) continue;
      ridge[i] = 1;
      if (mag[i] >= g2) (ridge[i] = 2), stack.push(i);
    }
  const nb = [-camW - 1, -camW, -camW + 1, -1, 1, camW - 1, camW, camW + 1];
  while (stack.length) {
    const i = stack.pop()!;
    for (const o of nb) if (ridge[i + o] === 1 && (dir[i + o] - dir[i] + 5) % 4 <= 2) (ridge[i + o] = 2), stack.push(i + o); // grow only along a similar orientation (±45°), not into texture at junctions
  }
  const R = 6, ring = [-R, R, -R * camW, R * camW, -R * camW - R, -R * camW + R, R * camW - R, R * camW + R];
  for (let y = 3; y < camH - 3; y++)
    for (let x = 3; x < camW - 3; x++) {
      const i = y * camW + x;
      if (ridge[i] !== 2) continue;
      const u = map[2 * i], v = map[2 * i + 1];
      if (!(u >= m && v >= m && u < projW - m && v < projH - m)) continue; // the beam's own border is the projector frame edge, not a real edge
      if (x < R || y < R || x >= camW - R || y >= camH - R) continue;
      let ok = 0; // stray decodes (dark windows, glossy frames) map far from their neighbours; a real surface maps smoothly
      for (const o of ring) {
        const uu = map[2 * (i + o)], vv = map[2 * (i + o) + 1];
        if (uu >= 0 && Math.abs(uu - u) <= 4 * R && Math.abs(vv - v) <= 4 * R) ok++;
      }
      if (ok < 4) continue;
      const t = Math.floor(v / tile) * cols + Math.floor(u / tile), h = home[t];
      if (Math.abs(Math.floor(y / CS) - Math.floor(h / ccols)) > 1 || Math.abs(Math.floor(x / CS) - (h % ccols)) > 1) continue;
      count[t]++;
    }
  const solid = new Uint8Array(cols * rows);
  for (let i = 0; i < solid.length; i++) solid[i] = count[i] >= Math.max(2, Math.sqrt(npx[i]) / 2) ? 1 : 0; // a one-pixel edge crossing a tile of N camera px casts ~sqrt(N) votes: demand half a crossing

  dropSpecks(solid, cols, rows, minCluster);
  thin(solid, cols, rows);
  dropSpecks(solid, cols, rows, minCluster); // thinning can leave a band's worth of tiles as a speck shorter than a usable platform
  return { tile, cols, rows, solid };
}

/** drop specks of wall texture: 8-connected clusters smaller than minCluster tiles */
function dropSpecks(solid: Uint8Array, cols: number, rows: number, minCluster: number) {
  const seen = new Uint8Array(cols * rows);
  for (let s = 0; s < solid.length; s++) {
    if (!solid[s] || seen[s]) continue;
    const comp = [s], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const t = stack.pop()!, c = t % cols, r = (t - c) / cols;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc, n = rr * cols + cc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && solid[n] && !seen[n]) (seen[n] = 1), comp.push(n), stack.push(n);
        }
    }
    if (comp.length < minCluster) for (const t of comp) solid[t] = 0;
  }
}

/** Zhang–Suen thinning: bands of parallel edges (door frames) become one-tile lines, keeping their shape and connectivity. */
export function thin(g: Uint8Array, cols: number, rows: number) {
  const px = (c: number, r: number) => (c >= 0 && r >= 0 && c < cols && r < rows ? g[r * cols + c] : 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      const drop: number[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!g[r * cols + c]) continue;
          // neighbours clockwise from north: P2..P9
          const n = [px(c, r - 1), px(c + 1, r - 1), px(c + 1, r), px(c + 1, r + 1), px(c, r + 1), px(c - 1, r + 1), px(c - 1, r), px(c - 1, r - 1)];
          const b = n.reduce((a, v) => a + v, 0);
          let a = 0;
          for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) a++;
          const [p2, , p4, , p6, , p8] = n;
          const ok = pass === 0 ? !(p2 && p4 && p6) && !(p4 && p6 && p8) : !(p2 && p4 && p8) && !(p2 && p6 && p8);
          if (b >= 2 && b <= 6 && a === 1 && ok) drop.push(r * cols + c);
        }
      for (const i of drop) g[i] = 0;
      changed ||= drop.length > 0;
    }
  }
}

/** ASCII rows ('#' solid, '.' open): saved as level.json, readable when debugging. */
export const toMap = (l: Level) =>
  Array.from({ length: l.rows }, (_, r) => Array.from(l.solid.subarray(r * l.cols, (r + 1) * l.cols), (v) => (v ? "#" : ".")).join(""));
export const fromMap = (tile: number, map: string[]): Level => ({
  tile,
  cols: map[0].length,
  rows: map.length,
  solid: Uint8Array.from(map.join(""), (ch) => (ch === "#" ? 1 : 0)),
});
