import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import { COUNT, PAUSE, STEP, WIN, createCycles } from "./cycles";

const frame = (pressed: string[] = []) => ({ held: new Set<string>(), pressed: new Set(pressed), mask: null });
/** cols×rows map with the given cells solid */
const room = (cols: number, rows: number, solid: (c: number, r: number) => boolean, seed = 1) => {
  const level = fromMap(8, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (solid(c, r) ? "#" : ".")).join("")));
  return { cols, rows, T: 8, level, rand: seeded(seed), best: 0 };
};
const ride = (g: ReturnType<typeof createCycles>) => {
  for (let i = 0; i < COUNT; i++) g.step(frame());
  expect(g.state.phase).toBe("ride");
};

test("starts are in open space, apart, never inside an edge, on sparse, dense and empty maps", () => {
  const maps = [
    (c: number, r: number) => c % 12 === 0 && r > 5, // fence of vertical lines
    (c: number, r: number) => ((c * 7 + r * 13) % 11 === 0), // dense speckle
    () => false,
  ];
  for (const [m, solid] of maps.entries())
    for (let seed = 1; seed <= 5; seed++) {
      const g = createCycles(room(80, 45, solid, seed + m * 10));
      const [a, b] = g.riders;
      for (const p of g.riders) {
        expect(solid(p.c, p.r)).toBe(false);
        expect(p.c > 0 && p.r > 0 && p.c < 79 && p.r < 44).toBe(true);
      }
      expect(Math.hypot(a.c - b.c, a.r - b.r)).toBeGreaterThan(10);
    }
});

test("riding into an edge ends the round and scores for the other rider; into a trail too", () => {
  const g = createCycles(room(60, 30, (c) => c === 20));
  ride(g);
  const [a, b] = g.riders;
  Object.assign(a, { c: 19, r: 10, d: 1, next: 1 }); // heading right into the wall at column 20
  Object.assign(b, { c: 40, r: 10, d: 2, next: 2 });
  for (let i = 0; i < STEP; i++) g.step(frame());
  expect(a.dead).toBe(true);
  expect(b.wins).toBe(1);
  expect(g.state.phase).toBe("end");
  expect(g.state.events).toContain("ouch");

  for (let i = 0; i < PAUSE; i++) g.step(frame()); // next round: fresh trails
  expect(g.state.round).toBe(2);
  expect(a.trail.length).toBe(1);
  ride(g);
  Object.assign(a, { c: 30, r: 15, d: 2, next: 2 });
  Object.assign(b, { c: 25, r: 16, d: 1, next: 1 }); // rides right, into a's trail at (30, 16)
  for (let i = 0; i < STEP * 20 && g.state.phase === "ride"; i++) g.step(frame());
  expect(b.dead).toBe(true);
  expect(a.dead).toBe(false);
  expect(a.wins).toBe(1);
});

test("turning: a pressed key turns the rider, reversing is ignored; first to 5 ends the match", () => {
  const g = createCycles(room(60, 30, () => false));
  ride(g);
  const [a, b] = g.riders;
  Object.assign(a, { c: 10, r: 10, d: 1, next: 1 });
  Object.assign(b, { c: 50, r: 25, d: 0, next: 0 });
  g.step(frame(["KeyA"])); // reverse: ignored
  g.step(frame(["KeyS"]));
  for (let i = 0; i < STEP; i++) g.step(frame());
  expect(a.d).toBe(2);
  b.wins = WIN - 1;
  Object.assign(a, { c: 10, r: 28, d: 2, next: 2 }); // into the bottom border
  for (let i = 0; i < STEP + PAUSE + 1; i++) g.step(frame());
  expect(g.state.over).toBe(true);
  expect(b.wins).toBe(WIN);
});
