import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import { HP, createArtillery } from "./artillery";

const frame = (held: string[] = [], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed), mask: null });
const room = (cols: number, rows: number, solid: (c: number, r: number) => boolean, seed = 1) => {
  const level = fromMap(8, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (solid(c, r) ? "#" : ".")).join("")));
  return { cols, rows, T: 8, level, rand: seeded(seed), best: 0 };
};
// two shelves at row 30, a tall line in the middle
const shelves = (c: number, r: number) => (r === 30 && ((c >= 5 && c <= 25) || (c >= 75 && c <= 95))) || (c === 50 && r > 20);
const T = 8;

test("cannons stand on real ledges, far apart; with no ledges they stand on the floor", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const g = createArtillery(room(100, 50, shelves, seed));
    const [a, b] = g.state.cannons;
    for (const k of [a, b]) {
      expect(Math.floor(k.y / T)).toBe(29); // resting in the row above the shelf
      expect(g.grid.edge(Math.floor(k.x / T), 30)).toBe(true);
    }
    expect(b.x - a.x).toBeGreaterThan(40 * T);
  }
  const g = createArtillery(room(100, 50, () => false));
  for (const k of g.state.cannons) expect(k.y).toBeCloseTo(50 * T - 0.01, 3);
});

test("a shot blasts edge tiles away, a near hit damages, a cannon without ground falls, turns alternate", () => {
  const g = createArtillery(room(100, 50, shelves));
  const s = g.state, [a, b] = s.cannons, solid = () => g.grid.solid.reduce((n, v) => n + v, 0);
  const before = solid();
  s.phase = "fly";
  s.shot = { x: 50 * T + 4, y: 10 * T, vx: 0, vy: 2 }; // straight down onto the middle line
  for (let i = 0; i < 60 && s.phase === "fly"; i++) g.step(frame());
  expect(s.phase).toBe("settle");
  expect(solid()).toBeLessThan(before);
  expect(g.grid.edge(50, 21)).toBe(false);
  expect(a.hp + b.hp).toBe(2 * HP); // too far from both
  for (let i = 0; i < 60; i++) g.step(frame());
  expect(s.turn).toBe(1);
  expect(s.phase).toBe("aim");

  // P2 (either key set works) fires; we steer the shot onto P1's base: hit, and the shelf under it is gone
  for (let i = 0; i < 10; i++) g.step(frame(["KeyA", "ArrowUp"]));
  g.step(frame([], ["Space"]));
  expect(s.phase).toBe("fly");
  expect(s.events).toContain("shoot");
  s.shot = { x: a.x, y: a.y - 8 * T, vx: 0, vy: 4 };
  for (let i = 0; i < 30 && s.phase === "fly"; i++) g.step(frame());
  expect(a.hp).toBe(HP - 1);
  expect(b.hp).toBe(HP);
  const y0 = a.y;
  for (let i = 0; i < 120; i++) g.step(frame());
  expect(a.y).toBeGreaterThan(y0 + 5 * T); // fell
  expect(a.y).toBeCloseTo(50 * T - 0.01, 3); // onto the floor
  expect(s.turn).toBe(0);
});

test("the third hit wins the match", () => {
  const g = createArtillery(room(100, 50, shelves));
  const s = g.state, [, b] = s.cannons;
  b.hp = 1;
  s.phase = "fly";
  s.shot = { x: b.x, y: b.y - 6 * T, vx: 0, vy: 4 };
  for (let i = 0; i < 200 && !s.over; i++) g.step(frame());
  expect(s.over).toBe(true);
  expect(s.winner).toBe(0);
  expect(s.score).toBe(HP);
});
