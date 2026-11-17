import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import { createGolf, golf } from "./golf";

const frame = (held: string[] = [], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed), mask: null });
const room = (cols: number, rows: number, solid: (c: number, r: number) => boolean, seed = 1) => {
  const level = fromMap(8, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (solid(c, r) ? "#" : ".")).join("")));
  return { cols, rows, T: 8, level, rand: seeded(seed), best: 0 };
};
const shelves = (c: number, r: number) => (r === 25 && c >= 10 && c <= 40) || (r === 30 && c >= 70 && c <= 110) || (c === 55 && r > 32);
const T = 8;

test("holes: 3 to 5, tee and cup far apart, cups on flat ledges or the floor; lower is better", () => {
  expect(golf.lowerIsBetter).toBe(true);
  for (let seed = 1; seed <= 8; seed++) {
    const g = createGolf(room(120, 60, shelves, seed));
    const { holes } = g.state;
    expect(holes.length).toBeGreaterThanOrEqual(3);
    expect(holes.length).toBeLessThanOrEqual(5);
    for (const { tee, cup } of holes) {
      expect(Math.abs(tee[0] - cup[0])).toBeGreaterThan(30);
      expect(cup[1] === 60 || (g.grid.edge(cup[0] - 1, cup[1]) && g.grid.edge(cup[0] + 1, cup[1]))).toBe(true);
    }
  }
  expect(createGolf(room(120, 60, () => false)).state.holes.every((h) => h.cup[1] === 60)).toBe(true); // no ledges: the floor
});

test("a shot bounces, rolls and comes to rest on an edge; strokes count", () => {
  const g = createGolf(room(120, 60, shelves));
  const s = g.state;
  Object.assign(s.ball, { x: 15 * T, y: 25 * T - 0.01 });
  s.aim.a = Math.PI * 0.35;
  s.aim.power = 7;
  g.step(frame([], ["Space"]));
  expect(s.phase).toBe("roll");
  let landed = false;
  for (let i = 0; i < 1000 && s.phase === "roll"; i++) g.step(frame()), (landed ||= s.events.includes("land"));
  expect(landed).toBe(true);
  expect(s.phase).toBe("aim");
  expect(s.ball.vx).toBe(0);
  expect(g.grid.wall(Math.floor(s.ball.x / T), Math.floor(s.ball.y / T) + 1)).toBe(true); // resting on something
  expect(s.ball.x).toBeGreaterThan(15 * T);
  expect(s.strokes).toBe(1);
  expect(s.total).toBe(1);
});

test("a slow ball over the cup drops in; all holes done ends the round with total strokes as the score", () => {
  const g = createGolf(room(120, 60, shelves, 3));
  const s = g.state;
  let strokes = 0;
  for (let h = 0; h < s.holes.length; h++) {
    expect(s.hole).toBe(h);
    expect(s.strokes).toBe(0);
    for (let k = 0; k <= h % 2; k++) { // 1 or 2 strokes per hole
      g.step(frame([], ["Space"]));
      strokes++;
      const [c, r] = s.holes[h].cup;
      if (k === h % 2) Object.assign(s.ball, { x: c * T + T / 2 - 4 * T, y: r * T - 0.01, vx: 1.6, vy: 0 }); // rolling toward the cup
      for (let i = 0; i < 2000 && s.phase === "roll"; i++) g.step(frame());
      expect(s.phase).toBe(k === h % 2 ? "done" : "aim");
    }
    expect(s.inCup).toBe(true);
    expect(s.events).toContain("coin");
    for (let i = 0; i < 101; i++) g.step(frame());
  }
  expect(s.over).toBe(true);
  expect(s.score).toBe(strokes);
});
