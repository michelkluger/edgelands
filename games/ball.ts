// Shared ball engine for the wall games: a circle bouncing off solid tiles (edges, bricks, shadow) and capsules (paddles,
// flippers, guide rails), plus the sparks and rings they all draw. No DOM, testable. Units are projector px per 60 Hz step.
export type Ball = { x: number; y: number; vx: number; vy: number; r: number };
export type Hit = { c: number; r: number; v: number }; // a tile the ball bounced off, v = impact speed along its normal
type Solid = (c: number, r: number) => boolean | number; // may be asked about tiles outside the grid: say true for walls

/**
 * Move b one step in substeps of at most T/2 (with r >= T/2 it can't tunnel through a 1-tile edge). extra(b, k, n) runs
 * after each substep for moving shapes (a flipper at its in-between angle). Returns the tiles it bounced off.
 */
export function moveBall(b: Ball, T: number, solid: Solid, bounce = 1, extra?: (b: Ball, k: number, n: number) => void, minSteps = 1) {
  const hits: Hit[] = [], n = Math.max(minSteps, Math.ceil(Math.hypot(b.vx, b.vy) / (T / 2)));
  for (let k = 0; k < n; k++) {
    b.x += b.vx / n;
    b.y += b.vy / n;
    const c0 = Math.floor(b.x / T), r0 = Math.floor(b.y / T);
    if (solid(c0, r0)) unstick(b, T, solid, c0, r0, hits);
    for (let it = 0; it < 4; it++) { // deepest contact first, then the next (a ball in a corner touches two tiles)
      let pen = 0, nx = 0, ny = 0, hc = 0, hr = 0;
      for (let r = Math.floor((b.y - b.r) / T); r <= Math.floor((b.y + b.r) / T); r++)
        for (let c = Math.floor((b.x - b.r) / T); c <= Math.floor((b.x + b.r) / T); c++) {
          if (!solid(c, r)) continue;
          const dx = b.x - Math.max(c * T, Math.min(b.x, c * T + T)), dy = b.y - Math.max(r * T, Math.min(b.y, r * T + T));
          const d = Math.hypot(dx, dy);
          if (d > 0 && b.r - d > pen) (pen = b.r - d), (nx = dx / d), (ny = dy / d), (hc = c), (hr = r);
        }
      if (!pen) break;
      b.x += nx * pen;
      b.y += ny * pen;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) (b.vx -= (1 + bounce) * vn * nx), (b.vy -= (1 + bounce) * vn * ny), hits.push({ c: hc, r: hr, v: -vn });
    }
    extra?.(b, k, n);
  }
  return hits;
}

/** A shadow moved over the ball: pop it out to the nearest free tile and send it that way (your shadow pushes things). */
function unstick(b: Ball, T: number, solid: Solid, c0: number, r0: number, hits: Hit[]) {
  for (let d = 1; d <= 4; d++) {
    let bc = 0, br = 0, bd = Infinity;
    for (let r = r0 - d; r <= r0 + d; r++)
      for (let c = c0 - d; c <= c0 + d; c++) {
        const dist = Math.hypot((c + 0.5) * T - b.x, (r + 0.5) * T - b.y);
        if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) === d && !solid(c, r) && dist < bd) (bd = dist), (bc = c), (br = r);
      }
    if (bd === Infinity) continue;
    const nx = ((bc + 0.5) * T - b.x) / bd, ny = ((br + 0.5) * T - b.y) / bd, sp = Math.max(1.5, Math.hypot(b.vx, b.vy));
    b.x = (bc + 0.5) * T;
    b.y = (br + 0.5) * T;
    b.vx = nx * sp;
    b.vy = ny * sp;
    hits.push({ c: c0, r: r0, v: sp });
    return;
  }
}

/**
 * Bounce b off a capsule from a to e of half-thickness w. spin: the capsule's angular velocity around a (rad per step,
 * a swinging flipper), whose surface speed is added to the bounce. True if it touched.
 */
export function hitSegment(b: Ball, ax: number, ay: number, ex: number, ey: number, w: number, bounce = 1, spin = 0) {
  const sx = ex - ax, sy = ey - ay, t = Math.max(0, Math.min(1, ((b.x - ax) * sx + (b.y - ay) * sy) / (sx * sx + sy * sy || 1)));
  const px = ax + t * sx, py = ay + t * sy, d = Math.hypot(b.x - px, b.y - py);
  if (d >= b.r + w || d === 0) return false;
  const nx = (b.x - px) / d, ny = (b.y - py) / d;
  b.x = px + nx * (b.r + w);
  b.y = py + ny * (b.r + w);
  const ux = -spin * (py - ay), uy = spin * (px - ax), vn = (b.vx - ux) * nx + (b.vy - uy) * ny;
  if (vn < 0) (b.vx -= (1 + bounce) * vn * nx), (b.vy -= (1 + bounce) * vn * ny);
  return true;
}

/** 8-connected clusters of solid tiles, as lists of tile indices (r * cols + c), each in flood order (neighbours stay close). */
export function clusters(solid: ArrayLike<number>, cols: number, rows: number) {
  const seen = new Uint8Array(cols * rows), out: number[][] = [];
  for (let s = 0; s < cols * rows; s++) {
    if (!solid[s] || seen[s]) continue;
    const comp = [s]; // doubles as the breadth-first queue
    seen[s] = 1;
    for (let i = 0; i < comp.length; i++) {
      const t = comp[i], c = t % cols, r = (t - c) / cols;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc, n = rr * cols + cc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && solid[n] && !seen[n]) (seen[n] = 1), comp.push(n);
        }
    }
    out.push(comp);
  }
  return out;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
/** Keep the ball's speed within [lo, hi] without changing its direction. */
export function limit(b: Ball, lo: number, hi: number) {
  const s = Math.hypot(b.vx, b.vy) || 1, k = clamp(s, lo, hi) / s;
  b.vx *= k;
  b.vy *= k;
}

/** Counts the steps a ball stays within 3 tiles of one spot: the room's edges have pockets that can trap it for good. */
export function trapWatch(T: number) {
  let ax = NaN, ay = NaN, n = 0;
  return (b: Ball) => (Math.hypot(b.x - ax, b.y - ay) <= 3 * T ? ++n : ((ax = b.x), (ay = b.y), (n = 0)));
}

// ---- effects: sparks and expanding rings (never a flash: photosensitive players) ----
export type Fx = { sparks: { x: number; y: number; vx: number; vy: number; life: number; color: string }[]; rings: { x: number; y: number; t: number; color: string }[] };
export const fx = (): Fx => ({ sparks: [], rings: [] });
export function burst(f: Fx, rand: () => number, x: number, y: number, color: string, n: number, speed = 3) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, v = 1 + rand() * speed;
    f.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 25 + rand() * 15, color });
  }
}
export function stepFx(f: Fx) {
  for (const q of f.sparks) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.1), q.life--;
  f.sparks = f.sparks.filter((q) => q.life > 0);
  for (const g of f.rings) g.t++;
  f.rings = f.rings.filter((g) => g.t < 30);
}
export function drawFx(ctx: CanvasRenderingContext2D, f: Fx, T: number) {
  ctx.lineWidth = 3;
  for (const g of f.rings) {
    ctx.globalAlpha = 1 - g.t / 30;
    ctx.strokeStyle = g.color;
    ctx.beginPath();
    ctx.arc(g.x, g.y, (g.t + 3) * T * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const q of f.sparks) {
    ctx.globalAlpha = Math.min(1, q.life / 25);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

/** A glowing ball: a coloured halo around a white-hot core. */
export function drawBall(ctx: CanvasRenderingContext2D, b: Ball, color: string) {
  ctx.fillStyle = ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Shadow games: a soft cyan halo on the wall just outside your shadow (inside it would land on you), as in catch.ts. */
export function drawHalo(ctx: CanvasRenderingContext2D, mask: Uint8Array | null, cols: number, T: number) {
  if (!mask) return;
  ctx.fillStyle = "rgba(125,249,255,0.55)";
  for (let t = 0; t < mask.length; t++) {
    if (mask[t]) continue;
    const c = t % cols;
    if ((c > 0 && mask[t - 1]) || (c < cols - 1 && mask[t + 1]) || mask[t - cols] || mask[t + cols]) ctx.fillRect(c * T, Math.floor(t / cols) * T, T, T);
  }
}

/** Room edges as small bright tiles (shadow games draw them light on the lit backdrop, never dark). */
export function drawTiles(ctx: CanvasRenderingContext2D, solid: Uint8Array, cols: number, T: number, color: string, glow = 10) {
  ctx.beginPath();
  for (let t = 0; t < solid.length; t++) if (solid[t]) ctx.rect((t % cols) * T + 1, Math.floor(t / cols) * T + 1, T - 2, T - 2);
  ctx.fillStyle = ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** One centred line of HUD text (white: never darker than a lit backdrop). */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = `bold ${size}px sans-serif`;
  ctx.fillText(s, x, y);
  ctx.textAlign = "start";
  ctx.globalAlpha = 1;
}
