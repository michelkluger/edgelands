// A swinging rope (Critter Clash's Vine Swing): shoot it at an edge, swing on it, let go to fly. hy: how far above the
// body's point (its feet) the rope holds on.
import type { Body } from "./kit";

export const PUMP = 0.1, REEL = 1.5; // px/frame² along the swing; px/frame reeled
export type Rope = { x: number; y: number; len: number };

/** The first edge tile along rays fanning out from angle a (0 = right, π/2 = up) at (x, y), closest to the aim first. */
export function ropeTarget(edge: (c: number, r: number) => boolean, T: number, x: number, y: number, a: number, reach: number) {
  for (let k = 0; k <= 24; k++) {
    const b = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05, dx = Math.cos(b), dy = -Math.sin(b);
    for (let d = T; d <= reach; d += T / 2) {
      const c = Math.floor((x + dx * d) / T), r = Math.floor((y + dy * d) / T);
      if (edge(c, r)) return { x: c * T + T / 2, y: r * T + T / 2 };
    }
  }
  return null;
}

/** Held keys while hanging: push along the swing toward dir (-1, 0, 1); reel < 0 pulls in, > 0 lets out (up to max). */
export function swing(p: Body, rope: Rope, hy: number, dir: number, reel: number, max: number, T: number) {
  const dx = p.x - rope.x, dy = p.y - hy - rope.y, d = Math.hypot(dx, dy) || 1;
  if (dir) {
    const flip = -dy * dir < 0 ? -1 : 1;
    (p.vx += (flip * -dy * PUMP) / d), (p.vy += (flip * dx * PUMP) / d);
  }
  rope.len = Math.max(2 * T, Math.min(max, rope.len + reel * REEL));
}

/** After the move: never farther out than the rope's length; the outward part of the velocity goes. */
export function tether(p: Body, rope: Rope, hy: number, wall: (c: number, r: number) => boolean, T: number) {
  const dx = p.x - rope.x, dy = p.y - hy - rope.y, d = Math.hypot(dx, dy);
  if (d <= rope.len) return;
  const nx = dx / d, ny = dy / d, x = rope.x + nx * rope.len, y = rope.y + hy + ny * rope.len;
  if (!wall(Math.floor(x / T), Math.floor(y / T))) (p.x = x), (p.y = y);
  const out = p.vx * nx + p.vy * ny;
  if (out > 0) (p.vx -= out * nx), (p.vy -= out * ny);
}
