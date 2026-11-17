import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import { HP, PAUSE, TURN, U, createClash } from "./clash";
import { FUSE } from "./clash-weapons";

const T = 8, COLS = 120, ROWS = 60, FLOOR = (ROWS - 1) * T - 0.01; // feet on the unbreakable bottom row
const frame = (held: string[] = [], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed), mask: null });
const room = (solid: (c: number, r: number) => boolean, seed = 1) => {
  const level = fromMap(T, Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (solid(c, r) ? "#" : ".")).join("")));
  return { cols: COLS, rows: ROWS, T, level, rand: seeded(seed), best: 0 };
};
const shelves = (c: number, r: number) => r === 30 && ((c >= 5 && c <= 25) || (c >= 95 && c <= 115));
const empty = () => false;
/** A game with the current critter put at column c on the floor, calm air. */
const setup = (solid: (c: number, r: number) => boolean = empty, c = 20) => {
  const g = createClash(room(solid)), s = g.state, k = s.cur;
  Object.assign(k, { x: c * T + 4, y: FLOOR, vx: 0, vy: 0, ground: true });
  s.wind = 0;
  /** Everyone else to the floor at the far right, out of the line of fire. */
  const park = () => s.critters.forEach((q, i) => q !== k && Object.assign(q, { x: (100 + i) * T, y: FLOOR, ground: true }));
  return { g, s, k, park, tiles: () => g.grid.solid.reduce((n, v) => n + v, 0) };
};
const until = (g: ReturnType<typeof createClash>, done: () => boolean, max = 2000, f = frame) => {
  let n = 0;
  while (!done() && n < max) g.step(f()), n++;
  return n;
};

test("critters spawn on ledges, never inside an edge, three a team on opposite halves; any room works", () => {
  const dense = (c: number, r: number) => ((c * 7919 + r * 104729) % 10) < 3; // ~30% of tiles: a cluttered room
  for (const [solid, seeds] of [[shelves, 5], [empty, 2], [dense, 3]] as const)
    for (let seed = 1; seed <= seeds; seed++) {
      const g = createClash(room(solid, seed)), ks = g.state.critters;
      expect(ks.length).toBe(6);
      expect(new Set(ks.map((k) => k.name)).size).toBe(6);
      for (const k of ks) {
        const c = Math.floor(k.x / T), r = Math.floor(k.y / T);
        expect(g.grid.edge(c, r + 1)).toBe(true); // standing on something
        expect(g.grid.edge(c, r)).toBe(false); // not in it
        expect(k.team ? k.x > COLS * T * 0.5 : k.x < COLS * T * 0.5).toBe(true);
        expect(k.hp).toBe(HP);
      }
      if (solid === empty) for (const k of ks) expect(k.y).toBeCloseTo(FLOOR, 3);
      if (solid === shelves) expect(ks.filter((k) => Math.floor(k.y / T) === 29).length).toBeGreaterThanOrEqual(2); // real ledges first
    }
});

test("walking follows the surface, steps up 1–2 tiles, stops at a tall wall; jumping leaves the ground", () => {
  const steps = (c: number, r: number) => (c >= 30 && c < 40 && r === 58) || (c >= 40 && c < 50 && r >= 56) || (c === 50 && r >= 45);
  const { g, s, k } = setup(steps);
  for (let i = 0; i < 400; i++) g.step(frame(["ArrowRight"]));
  expect(k.y).toBeCloseTo(56 * T - 0.01, 3); // up one, then up two
  expect(k.x).toBeLessThan(50 * T);
  expect(k.x).toBeGreaterThan(49 * T);
  expect(k.hp).toBe(HP);
  g.step(frame([], ["Enter"]));
  expect(k.ground).toBe(false);
  expect(s.events).toContain("jump");
  until(g, () => k.ground);
  expect(k.hp).toBe(HP);
});

test("Fizz Rocket: charge with Space, fly, explode on contact, blast tiles away; the turn's shot is over", () => {
  const { g, s, k, park, tiles } = setup(shelves);
  park();
  for (let i = 0; i < 20; i++) g.step(frame(["Space"]));
  expect(s.power).toBeGreaterThan(0);
  g.step(frame());
  expect(s.phase).toBe("fly");
  expect(s.events).toContain("shoot");
  expect(s.shells[0].kind).toBe("rocket");
  const before = tiles();
  s.shells[0] = { kind: "rocket", x: 100 * T, y: 20 * T, vx: 0, vy: 3, t: 30, owner: k }; // down onto the right shelf
  until(g, () => s.phase !== "fly");
  expect(s.phase).toBe("settle");
  expect(tiles()).toBeLessThan(before);
  expect(g.grid.edge(100, 30)).toBe(false);
  expect(s.events).toContain("stomp");
});

test("Boing Bomb pops on its 3 s fuse, bouncing meanwhile", () => {
  const { g, s } = setup();
  g.step(frame([], ["Digit2"]));
  expect(s.weapon).toBe(1);
  s.aim = 1.4;
  g.step(frame(["Space"]));
  g.step(frame());
  expect(s.shells[0].kind).toBe("bomb");
  const n = until(g, () => !s.shells.length);
  expect(Math.abs(n - FUSE)).toBeLessThanOrEqual(2);
  expect(s.events).toContain("stomp");
});

test("Popcorn Pod bursts into five popcorn on impact; it has limited ammo", () => {
  const { g, s, k } = setup();
  g.step(frame([], ["Digit3"]));
  expect(s.weapon).toBe(2);
  g.step(frame(["Space"]));
  g.step(frame());
  expect(s.ammo[0][2]).toBe(1);
  s.shells[0] = { kind: "pod", x: 60 * T, y: 50 * T, vx: 0, vy: 3, t: 30, owner: k };
  until(g, () => s.shells.some((sh) => sh.kind === "corn"));
  expect(s.shells.filter((sh) => sh.kind === "corn").length).toBe(5);
  until(g, () => s.phase !== "fly");
  expect(s.phase).toBe("settle");
});

test("Zap-Zap: two instant shots a turn, each blasting a small hole", () => {
  const wall = (c: number, r: number) => c === 40 && r >= 40;
  const { g, s, k, park, tiles } = setup(wall);
  park();
  g.step(frame([], ["Digit4"]));
  s.aim = 0.05;
  const before = tiles();
  g.step(frame(["Space"], ["Space"]));
  expect(s.events).toContain("shoot");
  expect(s.zaps).toBe(1);
  expect(s.phase).toBe("move");
  expect(s.shells.length).toBe(0);
  expect(tiles()).toBeLessThan(before);
  g.step(frame([], ["Digit1"])); // no switching between the two shots
  expect(s.weapon).toBe(3);
  g.step(frame(["Space"], ["Space"]));
  expect(s.phase).toBe("settle");
});

test("Vine Swing: attaches to an edge, keeps its length while swinging, and doesn't end the turn", () => {
  const ceiling = (c: number, r: number) => r === 40 && c >= 5 && c <= 60;
  const { g, s, k } = setup(ceiling);
  g.step(frame([], ["Digit5"]));
  s.aim = 1.2;
  g.step(frame(["Space"], ["Space"]));
  const rope = s.rope!;
  expect(rope).not.toBeNull();
  expect(g.grid.edge(Math.floor(rope.x / T), Math.floor(rope.y / T))).toBe(true);
  let worst = 0;
  for (let i = 0; i < 150; i++) {
    g.step(frame(["Space", i < 60 ? "ArrowRight" : "ArrowLeft"]));
    worst = Math.max(worst, Math.hypot(k.x - rope.x, k.y - 1.7 * U * T - rope.y) - rope.len);
  }
  expect(worst).toBeLessThan(1);
  g.step(frame()); // let go
  expect(s.rope).toBeNull();
  expect(s.phase).toBe("move");
  until(g, () => k.ground);
  g.step(frame([], ["Digit1"])); // still this turn: fire something
  g.step(frame(["Space"]));
  g.step(frame());
  expect(s.phase).toBe("fly");
});

test("a blast hurts by distance and knocks critters away; long falls hurt; off the beam is out", () => {
  const { g, s, k } = setup();
  const [near, far] = s.critters.filter((c) => c.team === 1);
  Object.assign(near, { x: 62 * T, y: FLOOR, ground: true });
  Object.assign(far, { x: 110 * T, y: FLOOR, ground: true });
  s.phase = "fly";
  s.shells.push({ kind: "rocket", x: 60 * T, y: 50 * T, vx: 0, vy: 3, t: 30, owner: k });
  until(g, () => !s.shells.length);
  expect(near.hp).toBeLessThan(HP);
  expect(near.hp).toBeGreaterThan(0);
  expect(near.vx).toBeGreaterThan(0); // pushed away from the blast
  expect(near.dizzy).toBeGreaterThan(0);
  expect(far.hp).toBe(HP);
  until(g, () => near.ground);

  Object.assign(far, { y: FLOOR - 5 * T, ground: false, vy: 0, peak: FLOOR - 5 * T });
  until(g, () => far.ground);
  expect(far.hp).toBe(HP); // a short drop: fine
  Object.assign(far, { y: FLOOR - 25 * T, ground: false, vy: 0, peak: FLOOR - 25 * T });
  until(g, () => far.ground);
  expect(far.hp).toBeLessThan(HP);
  expect(far.hp).toBeGreaterThan(HP - 60);

  Object.assign(far, { x: -3 * T, ground: false });
  g.step(frame());
  expect(far.hp).toBe(0);
});

test("turns alternate teams and rotate critters (skipping fainted ones); the timer ends a turn", () => {
  const { g, s } = setup();
  const ks = s.critters;
  expect(s.cur).toBe(ks[0]);
  const wind = new Set<number>();
  const next = () => {
    s.timer = 1;
    g.step(frame());
    expect(s.phase).toBe("settle");
    until(g, () => s.phase === "move");
    wind.add(s.wind);
  };
  next();
  expect([s.team, s.cur]).toEqual([1, ks[3]]);
  next();
  expect([s.team, s.cur]).toEqual([0, ks[1]]);
  next();
  expect(s.cur).toBe(ks[4]);
  ks[2].hp = 0;
  next();
  expect(s.cur).toBe(ks[0]);
  expect(wind.size).toBeGreaterThan(1); // new wind each turn
  // no input at all: the turn ends on the timer, after a short pause the other team goes
  const n = until(g, () => s.phase !== "move");
  expect(n).toBe(TURN);
  until(g, () => s.phase === "move");
  expect(s.team).toBe(1);
  expect(PAUSE).toBeLessThan(120);
});

test("the match ends when a team is wiped out; the score is the winners' HP left", () => {
  const { g, s, k } = setup();
  const [a, b, c] = s.critters.filter((q) => q.team === 1);
  b.hp = c.hp = 0;
  Object.assign(a, { x: 90 * T, y: FLOOR, ground: true, hp: 5 });
  s.phase = "fly";
  s.shells.push({ kind: "rocket", x: 90 * T, y: 50 * T, vx: 0, vy: 3, t: 30, owner: k });
  until(g, () => s.over);
  expect(s.over).toBe(true);
  expect(s.winner).toBe(0);
  expect(s.events).toContain("win");
  expect(s.score).toBe(s.critters.filter((q) => q.team === 0).reduce((n, q) => n + q.hp, 0));
  expect(s.score).toBeGreaterThan(0);
});
