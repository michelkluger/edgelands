import { expect, test } from "bun:test";
import { G } from "./aim";
import { slide } from "./kit";
import { ropeTarget, swing, tether } from "./rope";

const T = 8, strip = (c: number, r: number) => r === 20 && c >= 10 && c <= 60; // a ceiling line

test("ropeTarget: the first edge along the aim (fanning out a little), none out of reach", () => {
  const t = ropeTarget(strip, T, 30 * T, 40 * T, Math.PI / 2, 30 * T)!;
  expect(strip(Math.floor(t.x / T), Math.floor(t.y / T))).toBe(true);
  expect(Math.abs(t.x - 30 * T)).toBeLessThan(T);
  expect(ropeTarget(strip, T, 30 * T, 40 * T, Math.PI / 2, 10 * T)).toBeNull();
  expect(ropeTarget(strip, T, 30 * T, 40 * T, -Math.PI / 2, 30 * T)).toBeNull(); // aiming down at nothing
});

test("the swing keeps the rope's length, swings through, and letting go keeps the momentum", () => {
  const rope = { x: 30 * T + 4, y: 20 * T + 4, len: Math.hypot(12 * T, 2 * T) }, hy = T;
  const p = { x: rope.x + 12 * T, y: rope.y + hy + 2 * T, vx: 0, vy: 0 };
  let worst = 0, minX = Infinity;
  for (let i = 0; i < 300; i++) {
    swing(p, rope, hy, 0, 0, 40 * T, T);
    p.vy += G;
    slide(p, T, strip);
    tether(p, rope, hy, strip, T);
    worst = Math.max(worst, Math.abs(Math.hypot(p.x - rope.x, p.y - hy - rope.y) - rope.len));
    minX = Math.min(minX, p.x);
  }
  expect(worst).toBeLessThan(1);
  expect(minX).toBeLessThan(rope.x - 8 * T);
  // pumping toward a side speeds the swing up; reeling in shortens the rope, never below 2 tiles
  const v = Math.hypot(p.vx, p.vy);
  swing(p, rope, hy, p.vx > 0 ? 1 : -1, 0, 40 * T, T);
  expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(v);
  for (let i = 0; i < 200; i++) swing(p, rope, hy, 0, -1, 40 * T, T);
  expect(rope.len).toBe(2 * T);
});
