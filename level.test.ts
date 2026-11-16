import { expect, test } from "bun:test";
import { fillHoles } from "./calibrate";
import { edgeTiles, fromMap, thin, toMap } from "./edges";

test("thin: a 3-wide band becomes a 1-wide line of the same length", () => {
  const cols = 20, rows = 5, g = new Uint8Array(cols * rows);
  for (let r = 1; r <= 3; r++) for (let c = 2; c < 18; c++) g[r * cols + c] = 1;
  thin(g, cols, rows);
  for (let c = 4; c < 16; c++) expect(g[1 * cols + c] + g[2 * cols + c] + g[3 * cols + c]).toBe(1); // one tile per column in the middle
});
import { createGame, seeded } from "./game";

test("edges: a dark strip of tape becomes solid tiles, the beam border does not", () => {
  const CW = 160, CH = 120, T = 8;
  // camera (10..150, 10..110) → projector 280×200 at 2× scale
  const white = new Uint8Array(CW * CH), map = new Int16Array(2 * CW * CH).fill(-1);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const inBeam = x >= 10 && x < 150 && y >= 10 && y < 110, tape = x >= 40 && x < 120 && y >= 58 && y < 62;
      white[y * CW + x] = !inBeam ? 10 : tape ? 40 : 180;
      if (inBeam) map.set([2 * x - 20, 2 * y - 20], 2 * (y * CW + x));
    }
  const level = edgeTiles(white, CW, CH, fillHoles(map, CW, CH), 280, 200, T);
  const rowsWithEdge = new Set<number>();
  for (let i = 0; i < level.solid.length; i++) if (level.solid[i]) rowsWithEdge.add(Math.floor(i / level.cols));
  expect([...rowsWithEdge].every((r) => r >= 11 && r <= 13)).toBe(true); // tape maps to v 96..104
  const tapeCols = new Set(Array.from(level.solid.keys()).filter((i) => level.solid[i]).map((i) => i % level.cols));
  expect(tapeCols.size).toBeGreaterThanOrEqual(16); // the tape spans projector cols 7..27: the line must cover most of it
  expect(fromMap(T, toMap(level)).solid).toEqual(level.solid);
});

test("game: a director plan is snapped onto real surfaces and junk is ignored", () => {
  const map = Array.from({ length: 30 }, () => ".".repeat(40).split(""));
  for (let c = 5; c <= 15; c++) map[22][c] = "#";
  const level = fromMap(8, map.map((r) => r.join("")));
  const g = createGame(level, () => 0.5, {
    name: "Test room",
    colors: { edge: "javascript:alert(1)" },
    coins: [{ c: 7, r: 20 }, { c: 12, r: 24 }, { c: 30, r: 28 }, { c: 999, r: -5 }, null as never],
    enemies: [],
    hazards: [{ c: 1, r: 26, w: 3, h: 3 }, { c: 30, r: 20, w: 2, h: 2, label: "zap" }],
    goal: { c: 36, r: 27 },
  });
  const coinRows = g.state.coins.slice(0, 3).map((c) => c.y / 8 + 2); // plan coins come first; a coin sits 2 tiles above its surface
  expect(g.state.coins.length).toBeLessThanOrEqual(10); // the off-map coin and the null are dropped, the rest topped up
  expect(coinRows.sort()).toEqual([22, 22, 29]); // two on the ledge, one on the ground
  for (let i = 0; i < 60; i++) g.step([{ left: false, right: false, jump: false }]);
  expect(g.state.falls).toBe(0); // the hazard right next to the start was dropped
});

test("game: edges are one-way platforms, vertical edges don't block, side walls do", () => {
  const map = Array.from({ length: 30 }, () => ".".repeat(40).split(""));
  for (let c = 5; c <= 15; c++) map[22][c] = "#"; // a ledge
  for (let r = 18; r < 29; r++) map[r][25] = "#"; // a vertical edge, like a door frame
  const g = createGame(fromMap(8, map.map((r) => r.join(""))), () => 0.5);
  g.state.enemies.length = 0; // physics only
  const run = (n: number, inp: Partial<{ left: boolean; right: boolean; jump: boolean }>) => {
    for (let i = 0; i < n; i++) g.step([{ left: false, right: false, jump: false, ...inp }]);
  };
  const p = () => g.state.players[0];
  run(120, {});
  expect(p().ground).toBe(true);
  expect(p().y + p().h).toBe(29 * 8); // on the added ground

  while (p().x < 64) run(1, { right: true });
  run(40, { jump: true }); // jump up through the ledge from below…
  run(60, {});
  expect(p().y + p().h).toBe(22 * 8); // …and land on top of it
  expect(p().ground).toBe(true);

  run(300, { right: true }); // walk off the ledge, through the vertical edge, into the right side wall
  expect(p().x).toBeGreaterThan(25 * 8);
  expect(p().x + p().w).toBeLessThanOrEqual(39 * 8);
  expect(p().y + p().h).toBe(29 * 8);
});

test("game: coins only go where a jump can reach, and the exit needs every coin", () => {
  const map = Array.from({ length: 40 }, () => ".".repeat(60).split(""));
  for (let c = 20; c <= 35; c++) map[8][c] = "#"; // 31 tiles above the ground: higher than any jump (15)
  for (let c = 8; c <= 16; c++) map[30][c] = "#"; // 9 tiles up: reachable
  const g = createGame(fromMap(8, map.map((r) => r.join(""))), () => 0.3, { goal: { c: 50, r: 38 } });
  const rows = new Set(g.state.coins.map((c) => c.y / 8 + 2));
  expect(g.state.coins.length).toBeGreaterThan(3);
  expect(rows.has(8)).toBe(false); // nothing on the unreachable ledge
  expect(rows.has(30)).toBe(true); // the reachable ledge is used

  g.state.enemies.length = 0;
  for (const c of g.state.coins) c.taken = true; // all coins in, but not at the exit yet
  g.step([{ left: false, right: false, jump: false }]);
  expect(g.state.won).toBe(false);
  for (let i = 0; i < 400 && !g.state.won; i++) g.step([{ left: false, right: true, jump: false }]);
  expect(g.state.won).toBe(true);
  expect(g.state.events).toContain("win");
});

test("game: two players get separate input and separate coin counts", () => {
  const map = Array.from({ length: 30 }, () => ".".repeat(60).split(""));
  const g = createGame(fromMap(8, map.map((r) => r.join(""))), () => 0.5, null, { players: 2 });
  g.state.enemies.length = 0;
  const [a, b] = g.state.players;
  for (let i = 0; i < 60; i++) g.step([{ left: false, right: true, jump: false }, { left: false, right: false, jump: false }]);
  expect(a.x).toBeGreaterThan(b.x); // only P1 moved
  expect(b.ground).toBe(true);
});

// seeded RNG so the variety tests are repeatable

const room = () => {
  const map = Array.from({ length: 60 }, () => ".".repeat(100).split(""));
  for (const [r, c0, c1] of [[50, 10, 30], [44, 35, 55], [50, 60, 80], [40, 70, 90], [36, 20, 40]] as const) for (let c = c0; c <= c1; c++) map[r][c] = "#";
  for (let r = 20; r < 59; r++) map[r][50] = "#"; // a long vertical edge (door frame)
  return fromMap(8, map.map((r) => r.join("")));
};
const idle = { left: false, right: false, jump: false };

test("variety: from round 2 the exit moves around, and every round gets a twist", () => {
  const exits = new Set<string>(), mods = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const g = createGame(room(), seeded(seed), null, { round: 2 + (seed % 3) });
    exits.add(`${g.state.goal?.x},${g.state.goal?.y}`);
    mods.add(String(g.state.mod));
  }
  expect(exits.size).toBeGreaterThan(4);
  expect(mods.has("null")).toBe(false);
  expect(mods.size).toBeGreaterThan(2);
});

test("sparks crawl along real edge tiles only", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = createGame(room(), seeded(seed), null, { round: 1 });
    const sparks = g.state.enemies.filter((e) => e.kind === "spark");
    if (!sparks.length) continue;
    g.state.players[0].inv = 1e9; // ignore hits
    for (let i = 0; i < 600; i++) {
      g.step([idle]);
      for (const e of sparks) expect(room().solid[e.r * 100 + e.c]).toBe(1);
    }
    return;
  }
  throw new Error("no seed produced a spark");
});

test("boots give exactly one extra jump in the air; low gravity jumps higher", () => {
  const flat = () => fromMap(8, Array.from({ length: 60 }, () => ".".repeat(60)));
  // hold jump, but let go during the listed frame windows: each re-press is a new jump attempt
  const apex = (boots: boolean, mod: "low gravity" | null, gaps: number[]) => {
    const g = createGame(flat(), seeded(3), null, { round: 2, mod });
    g.state.enemies.length = 0;
    g.state.players[0].boots = boots;
    for (let i = 0; i < 60; i++) g.step([idle]);
    const y0 = g.state.players[0].y;
    let min = y0;
    for (let i = 0; i < 150; i++) {
      g.step([{ ...idle, jump: !gaps.some((at) => i >= at && i < at + 3) }]);
      min = Math.min(min, g.state.players[0].y);
    }
    return y0 - min;
  };
  const single = apex(false, null, [20]);
  const double = apex(true, null, [20]);
  expect(double).toBeGreaterThan(single * 1.3); // the re-press in the air counts…
  expect(apex(true, null, [20, 34])).toBeLessThanOrEqual(double + 0.01); // …but only once
  expect(apex(false, "low gravity", [])).toBeGreaterThan(apex(false, null, []));
});

test("the secret gem sits on a reachable spot and takes 10 s off the clock", () => {
  const g = createGame(room(), seeded(7), null, { round: 3 });
  const gem = g.state.gem!;
  expect(gem).toBeTruthy();
  for (let i = 0; i < 900; i++) g.step([idle]);
  const p = g.state.players[0];
  Object.assign(p, { x: gem.x - p.w / 2, y: gem.y - p.h / 2, inv: 999 });
  const before = g.state.frames;
  g.step([idle]);
  expect(gem.taken).toBe(true);
  expect(g.state.frames).toBeLessThan(before - 500);
  expect(g.state.events).toContain("secret");
});

test("power-ups: shield takes one hit, freeze stops enemies, ghost can't be hurt, speed runs faster", () => {
  const g = createGame(room(), seeded(11), null, { round: 3, mod: null });
  const p = g.state.players[0], e = g.state.enemies.find((x) => x.kind === "walker")!;
  expect(g.state.powers.length).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 200; i++) g.step([idle]); // let the round intro pass, everyone settles

  const touch = () => Object.assign(p, { x: e.x, y: e.y, vy: 0, inv: 0 }); // side-on contact: a hit, not a stomp
  p.shield = true;
  touch();
  g.step([idle]);
  expect([p.shield, g.state.falls]).toEqual([false, 0]); // shield gone, no damage
  p.ghost = 100;
  touch();
  g.step([idle]);
  expect(g.state.falls).toBe(0); // ghost: untouchable
  p.ghost = 0;
  touch();
  g.step([idle]);
  expect(g.state.falls).toBe(1); // no protection left: ouch

  g.state.freeze = 120;
  const x0 = e.x;
  for (let i = 0; i < 60; i++) g.step([idle]);
  expect(e.x).toBe(x0); // frozen walker didn't move

  const runFor = (fast: number) => {
    const q = createGame(fromMap(8, Array.from({ length: 30 }, () => ".".repeat(200))), seeded(2), null, { round: 1 });
    q.state.enemies.length = 0;
    const pl = q.state.players[0];
    pl.fast = fast;
    for (let i = 0; i < 60; i++) q.step([idle]);
    const x = pl.x;
    for (let i = 0; i < 60; i++) q.step([{ ...idle, right: true }]);
    return pl.x - x;
  };
  expect(runFor(600)).toBeGreaterThan(runFor(0) * 1.3);
});

test("more power-ups: bomb, clock, spring, jetpack, slowmo, and more of them per round", () => {
  const flat = () => fromMap(8, Array.from({ length: 60 }, () => ".".repeat(60)));
  const g = createGame(room(), seeded(5), null, { round: 3, mod: null });
  expect(g.state.powers.length).toBeGreaterThanOrEqual(3);
  expect(new Set(g.state.powers.map((x) => x.kind)).size).toBe(g.state.powers.length); // all different
  for (let i = 0; i < 400; i++) g.step([idle]);
  const p = g.state.players[0];
  const grab = (kind: string) => {
    const pw = g.state.powers[0];
    Object.assign(pw, { kind, taken: false });
    Object.assign(p, { x: pw.x - p.w / 2, y: pw.y - p.h / 2, inv: 999 });
    g.step([idle]);
  };
  const near = () => g.state.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 30 * 8).length;
  grab("bomb");
  expect(near()).toBe(0);
  const t = g.state.frames;
  grab("clock");
  expect(g.state.frames).toBeLessThan(t - 250);

  const height = (setup: Partial<Record<string, unknown>>, mod: "low gravity" | null = null) => {
    const q = createGame(flat(), seeded(3), null, { round: 2, mod });
    q.state.enemies.length = 0;
    Object.assign(q.state.players[0], setup);
    for (let i = 0; i < 60; i++) q.step([idle]);
    const y0 = q.state.players[0].y;
    let min = y0;
    for (let i = 0; i < 120; i++) q.step([{ ...idle, jump: true }]), (min = Math.min(min, q.state.players[0].y));
    return y0 - min;
  };
  const normal = height({});
  expect(height({ spring: true })).toBeGreaterThan(normal * 1.4);
  expect(height({ jet: 300 })).toBeGreaterThan(normal * 1.5);

  const slow = createGame(room(), seeded(11), null, { round: 3, mod: null });
  const walker = slow.state.enemies.find((e) => e.kind === "walker")!;
  slow.state.players[0].inv = 1e9;
  for (let i = 0; i < 200; i++) slow.step([idle]);
  slow.state.slow = 400;
  const before = walker.t;
  for (let i = 0; i < 100; i++) slow.step([idle]);
  expect(walker.t - before).toBe(50); // half speed
});

test("R replays the same level: same seed = same twist, exit, start, coins and power-ups", () => {
  const snapshot = (seed: number) => {
    const g = createGame(room(), seeded(seed), null, { round: 4 });
    const s = g.state;
    return JSON.stringify([s.mod, s.goal, s.players[0].x, s.players[0].y, s.coins, s.powers.map((p) => p.kind), s.enemies.map((e) => [e.kind, e.x, e.y])]);
  };
  expect(snapshot(42)).toBe(snapshot(42));
  expect(snapshot(42)).not.toBe(snapshot(43));
});

test("every player stays inside the walls and the beam: random starts near the right wall, both players", () => {
  const blank = () => Array.from({ length: 60 }, () => ".".repeat(100).split(""));
  const flat = () => fromMap(8, blank().map((r) => r.join("")));
  const rightEdge = () => { // ledges that run into the right wall (and into the wall column itself)
    const map = blank();
    for (const [r, c0] of [[50, 70], [40, 80], [30, 90]] as const) for (let c = c0; c < 100; c++) map[r][c] = "#";
    return fromMap(8, map.map((r) => r.join("")));
  };
  for (const [name, make] of [["room", room], ["flat", flat], ["right edge", rightEdge]] as const) {
    const level = make(), W = level.cols * 8, H = level.rows * 8;
    for (let seed = 1; seed <= 200; seed++)
      for (const round of [1, 2, 3, 4])
        for (const players of [1, 2]) {
          const g = createGame(level, seeded(seed), null, { round, players });
          for (let i = 0; i < 200; i++) {
            g.step([idle, idle]);
            for (const p of g.state.players)
              if (p.x < 0 || p.x + p.w > W || p.y < 0 || p.y + p.h > H)
                throw new Error(`${name} seed ${seed} round ${round} P${p.n + 1} frame ${i}: box ${p.x},${p.y} ${p.w}×${p.h} outside ${W}×${H}`);
          }
        }
  }
});

test("down drops through a real edge onto the surface below, never through the ground", () => {
  const map = Array.from({ length: 30 }, () => ".".repeat(40).split(""));
  for (let c = 1; c <= 38; c++) map[22][c] = "#"; // a skirting board across the whole beam
  const g = createGame(fromMap(8, map.map((r) => r.join(""))), () => 0.5, { spawn: { c: 10, r: 22 } });
  g.state.enemies.length = 0;
  const p = g.state.players[0];
  for (let i = 0; i < 60; i++) g.step([idle]);
  expect([p.ground, p.y + p.h]).toEqual([true, 22 * 8]); // stuck on the ledge…
  for (let i = 0; i < 60; i++) g.step([{ ...idle, down: true }]);
  expect([p.ground, p.y + p.h]).toEqual([true, 29 * 8]); // …until down drops it onto the ground
  for (let i = 0; i < 60; i++) g.step([{ ...idle, down: true }]);
  expect([p.ground, p.y + p.h]).toEqual([true, 29 * 8]); // the ground holds
});

test("a jetpack can't fly over a side wall out of the world", () => {
  const g = createGame(fromMap(8, Array.from({ length: 30 }, () => ".".repeat(40))), seeded(1), null, { round: 1 });
  g.state.enemies.length = 0;
  const p = g.state.players[0];
  for (let i = 0; i < 60; i++) g.step([idle]);
  p.jet = 300;
  for (let i = 0; i < 300; i++) g.step([{ ...idle, jump: i > 2, right: true }]); // ~1800 px above the beam, pressing right
  for (let i = 0; i < 400; i++) g.step([{ ...idle, right: true }]);
  expect(p.x + p.w).toBeLessThanOrEqual(39 * 8);
  expect(p.y + p.h).toBe(29 * 8);
});
