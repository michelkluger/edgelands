// Creature engine for the shadow games: little walkers on the room's edges and on your shadow. Tiles, projector px, 60 Hz.
import type { Env } from "../wall";

/** x: centre, y: feet (the top of the tile it stands on). fallFrom: row it left the ground from. */
export type Walker = { x: number; y: number; dir: number; vy: number; ground: boolean; fallFrom: number; t: number };
export const BODY = 3; // tiles of headroom a walker needs
const SPEED = 0.6, G = 0.2, MAX_FALL = 6, CLIMB = 2;
const GRACE = 10; // steps a tile stays solid after the shadow left it: the mask flickers at its border, ~30 fps
const WALL = -1, FALL = -2;

/** The room's edges, or (no edge map for this grid) a few generated ledges, so every game still has somewhere to walk. */
export function edgeMap(env: Env) {
  if (env.level) return env.level.solid;
  const { cols, rows } = env, solid = new Uint8Array(cols * rows);
  for (const [c0, c1, r] of [[0.08, 0.3, 0.22], [0.62, 0.88, 0.38], [0.35, 0.5, 0.6], [0.7, 0.9, 0.78]])
    for (let c = Math.round(c0 * cols); c < c1 * cols; c++) solid[Math.round(r * rows) * cols + c] = 1;
  return solid;
}

export function createWorld(cols: number, rows: number, T: number, edge: Uint8Array) {
  const shade = new Uint8Array(cols * rows);
  // the beam's sides and bottom are hard, so nobody walks out of the picture
  const solid = (c: number, r: number) => c <= 0 || c >= cols - 1 || r >= rows - 1 || (r >= 0 && (edge[r * cols + c] === 1 || shade[r * cols + c] > 0));
  const clear = (c: number, r: number) => {
    for (let d = 1; d <= BODY; d++) if (solid(c, r - d)) return false;
    return true;
  };
  /** The row a walker on row r stands on after stepping into column c: a step up or down of up to CLIMB tiles, else WALL or FALL. */
  const next = (c: number, r: number) => {
    for (const d of [0, -1, -2, 1, 2]) if (Math.abs(d) <= CLIMB && solid(c, r + d) && clear(c, r + d)) return r + d;
    return clear(c, r) ? FALL : WALL;
  };
  /** One frame of the shadow: tiles it covers become solid, and stay so for a few steps after it leaves them. */
  const sense = (mask: Uint8Array | null) => {
    for (let t = 0; t < shade.length; t++) shade[t] = mask?.[t] ? GRACE : shade[t] && shade[t] - 1;
  };
  const spawn = (c: number, r: number, dir: number): Walker => ({ x: c * T + T / 2, y: r * T, dir, vy: 0, ground: true, fallFrom: r, t: 0 });
  /** Moves one step. Returns how many tiles it fell when it lands, else 0. */
  const step = (k: Walker) => {
    k.t++;
    const c = Math.floor(k.x / T), r = Math.round(k.y / T);
    if (k.ground) {
      if (solid(c, r - 1)) return (k.y -= T), 0; // the shadow rose into it: ride up on top of it
      if (!solid(c, r)) (k.ground = false), (k.fallFrom = r); // the ground went away (the shadow moved)
      else {
        const nx = k.x + k.dir * SPEED, nc = Math.floor(nx / T);
        const nr = nc === c ? r : next(nc, r);
        if (nr === WALL) return (k.dir = -k.dir), 0;
        k.x = nx;
        if (nr === FALL) (k.ground = false), (k.fallFrom = r), (k.vy = 0);
        else return (k.y = nr * T), 0;
      }
    }
    const before = k.y, fc = Math.floor(k.x / T);
    k.vy = Math.min(k.vy + G, MAX_FALL);
    k.y += k.vy;
    for (let rr = Math.max(0, Math.ceil(before / T)); rr <= Math.floor(k.y / T); rr++)
      if (solid(fc, rr)) {
        (k.y = rr * T), (k.vy = 0), (k.ground = true);
        return rr - k.fallFrom;
      }
    return 0;
  };
  /** Tiles a walker can stand on (solid, with headroom), from the static edges only. */
  const surfaces = (r0 = 0, r1 = rows) => {
    const out: [number, number][] = [];
    for (let r = Math.max(1, r0); r < Math.min(rows, r1); r++)
      for (let c = 1; c < cols - 1; c++) if ((r === rows - 1 || edge[r * cols + c]) && clear(c, r)) out.push([c, r]);
    return out;
  };
  /** How many columns a walker gets from (c, r) in direction dir before a wall or a drop (capped). */
  const run = (c: number, r: number, dir: number, cap = 40) => {
    let n = 0;
    for (; n < cap; n++) {
      const nr = next(c + dir, r);
      if (nr < 0) break;
      (c += dir), (r = nr);
    }
    return n;
  };
  return { solid, sense, spawn, step, surfaces, run, shade };
}

// ---- drawing, shared by the creature games (bright colours, light outlines: nothing darker than the backdrop) ----
export const COLORS = ["#7dffb0", "#ffd166", "#ff9ecd", "#9ad7ff", "#c3a6ff", "#ffb380"];

/** A round critter standing at feet (x, y): s = scale, cheer = arms up, alpha for fades. */
export function drawCritter(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, color: string, t: number, T: number, s = 1, cheer = false) {
  const u = T * s, step = Math.sin(t / 6) * 0.35 * u;
  ctx.fillStyle = "#ffffff";
  for (const f of [-1, 1]) { // feet
    ctx.beginPath();
    ctx.ellipse(x + f * 0.5 * u + (f > 0 ? step : -step), y - 0.25 * u, 0.45 * u, 0.25 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, 0.2 * u);
  if (cheer)
    for (const f of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + f * 0.8 * u, y - 1.6 * u), ctx.lineTo(x + f * 1.4 * u, y - 2.9 * u);
      ctx.stroke();
    }
  ctx.beginPath();
  ctx.ellipse(x, y - 1.45 * u, 1.05 * u, 1.25 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // tuft
  ctx.moveTo(x - 0.2 * u, y - 2.6 * u), ctx.quadraticCurveTo(x + dir * 0.2 * u, y - 3.4 * u, x + dir * 0.6 * u, y - 3 * u);
  ctx.stroke();
  drawEyes(ctx, x + dir * 0.35 * u, y - 1.75 * u, dir, 0.32 * u);
}

/** Two round eyes looking towards dir (pupils mid blue: dark enough to read, far brighter than a shadow). */
export function drawEyes(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, r: number) {
  for (const f of [-1, 1]) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x + f * 1.15 * r, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a6fe0";
    ctx.beginPath();
    ctx.arc(x + f * 1.15 * r + dir * 0.35 * r, y + 0.1 * r, 0.5 * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Soft cyan halo on the wall just outside the shadow (inside it would land on the player), as in catch.ts. */
export function drawHalo(ctx: CanvasRenderingContext2D, mask: Uint8Array | null, cols: number, T: number) {
  if (!mask) return;
  ctx.fillStyle = "rgba(125,249,255,0.55)";
  for (let t = 0; t < mask.length; t++) {
    if (mask[t]) continue;
    const c = t % cols;
    if ((c > 0 && mask[t - 1]) || (c < cols - 1 && mask[t + 1]) || mask[t - cols] || mask[t + cols]) ctx.fillRect(c * T, Math.floor(t / cols) * T, T, T);
  }
}

/** Sparks and soft expanding rings: the only feedback effects (no flashes). */
export function createFx(rand: () => number, T: number) {
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  const rings: { x: number; y: number; t: number; color: string }[] = [];
  return {
    sparks,
    rings,
    burst(x: number, y: number, color: string, n: number) {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, v = 1 + rand() * 3;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 25 + rand() * 15, color });
      }
    },
    ring: (x: number, y: number, color: string) => rings.push({ x, y, t: 0, color }),
    step() {
      for (const q of sparks) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.1), q.life--;
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
      for (const g of rings) g.t++;
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > 40) rings.splice(i, 1);
    },
    draw(ctx: CanvasRenderingContext2D) {
      ctx.lineWidth = 3;
      for (const g of rings) {
        ctx.globalAlpha = 1 - g.t / 40;
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.arc(g.x, g.y, (g.t / 4 + 1) * T, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const q of sparks) {
        ctx.globalAlpha = Math.min(1, q.life / 25);
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    },
  };
}

/** White HUD line (at hudY), and the big end-of-round / intro text in the middle. */
export function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, T: number, hud: string, hudY: number, big: string, small: string, alpha = 1) {
  ctx.fillStyle = "#ffffff"; // white: text must never be darker than the backdrop
  ctx.textAlign = "center";
  ctx.font = `bold ${2 * T}px sans-serif`;
  ctx.fillText(hud, W / 2, hudY);
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${4 * T}px sans-serif`;
  if (big) ctx.fillText(big, W / 2, H * 0.42);
  ctx.font = `${2.2 * T}px sans-serif`;
  if (small) ctx.fillText(small, W / 2, H * 0.42 + 5 * T);
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
}
