import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import { createGrapple, grapple } from "./grapple";

const frame = (held: string[] = [], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed), mask: null });
const room = (cols: number, rows: number, solid: (c: number, r: number) => boolean, seed = 1) => {
  const level = fromMap(8, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (solid(c, r) ? "#" : ".")).join("")));
  return { cols, rows, T: 8, level, rand: seeded(seed), best: 0 };
};
const T = 8;
// a ceiling strip low over the left half, a high ledge on the right (the exit), a short shelf in between
const course = (c: number, r: number) => (r === 70 && c >= 5 && c <= 60) || (r === 12 && c >= 140 && c <= 150) || (r === 30 && c >= 90 && c <= 100);

test("the exit sits high on a real ledge, the start on the floor on the far side; lower time is better", () => {
  expect(grapple.lowerIsBetter).toBe(true);
  const g = createGrapple(room(160, 90, course));
  const { exit, p } = g.state;
  expect(g.grid.edge(Math.floor(exit.x / T), Math.floor((exit.y + T) / T))).toBe(true);
  expect(exit.y).toBeLessThan(90 * T * 0.4);
  expect(p.x).toBeLessThan(10 * T);
  expect(p.y).toBeCloseTo(90 * T - 0.01, 3);
});

test("Space attaches the rope to an edge in reach; the swing keeps the rope's length; letting go keeps the momentum", () => {
  const g = createGrapple(room(160, 90, course));
  const s = g.state, p = s.p;
  g.step(frame(["Space"], ["Space"]));
  expect(s.rope).not.toBeNull();
  const rope = s.rope!;
  expect(g.grid.edge(Math.floor(rope.x / T), Math.floor(rope.y / T))).toBe(true);
  expect(Math.floor(rope.y / T)).toBe(70);
  expect(s.events).toContain("shoot");
  // hang from the strip, out to the side: let it swing
  Object.assign(p, { x: rope.x + 12 * T, y: rope.y + T + 2 * T, vx: 0, vy: 0 });
  rope.len = Math.hypot(12 * T, 2 * T);
  let worst = 0, minX = Infinity;
  for (let i = 0; i < 300; i++) {
    g.step(frame(["Space"]));
    worst = Math.max(worst, Math.abs(Math.hypot(p.x - rope.x, p.y - T - rope.y) - rope.len));
    minX = Math.min(minX, p.x);
  }
  expect(worst).toBeLessThan(1);
  expect(minX).toBeLessThan(rope.x - 8 * T); // swung through to the other side
  const vx = p.vx, vy = p.vy;
  g.step(frame()); // let go
  expect(s.rope).toBeNull();
  expect(Math.hypot(p.vx - vx, p.vy - vy)).toBeLessThan(0.5);
});

test("no edge in reach: the rope misses; touching the floor after a grab respawns there; reaching the exit ends", () => {
  const g = createGrapple(room(160, 90, (c, r) => r === 12 && c >= 140 && c <= 150 || r === 5 && c < 30));
  const s = g.state, p = s.p;
  g.step(frame(["Space"], ["Space"]));
  expect(s.rope).toBeNull(); // the strip at row 5 is too high to reach from the floor
  s.check = { x: 50 * T, y: 40 * T };
  Object.assign(p, { x: 50 * T, y: 89.8 * T, vx: 0, vy: 5 });
  g.step(frame());
  expect(s.falls).toBe(1);
  expect(p.x).toBe(50 * T);
  expect(p.y).toBe(40 * T);
  expect(s.hover).toBeGreaterThan(0); // waits in the air for the next rope
  s.hover = 0;
  Object.assign(p, { x: s.exit.x, y: s.exit.y + T, vx: 0, vy: 0 });
  for (let i = 0; i < 60 && !s.over; i++) g.step(frame());
  expect(s.over).toBe(true);
  expect(s.events).toContain("win");
  expect(s.score).toBeGreaterThan(0);
});

test("an empty wall: the rope catches the top of the beam", () => {
  const g = createGrapple(room(80, 45, () => false));
  g.step(frame(["Space"], ["Space"]));
  expect(g.state.rope?.y).toBe(0);
});
