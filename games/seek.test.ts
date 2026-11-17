import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import type { Env } from "../wall";
import { createSeek, ROUND } from "./seek";

const T = 8;
const env = (level: Env["level"], cols = 160, rows = 90): Env => ({ cols, rows, T, level, rand: seeded(5), best: 0 });
const frame = (mask: Uint8Array | null) => ({ held: new Set<string>(), pressed: new Set<string>(), mask });

test("Hide & Seek: hiding spots sit on the room's features", () => {
  const cols = 80, rows = 50; // a door frame and a light switch
  const level = fromMap(T, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ((c === 10 || c === 20) && r > 12) || (r === 12 && c >= 10 && c <= 20) || (c >= 50 && c <= 52 && r >= 25 && r <= 27) ? "#" : ".").join("")));
  const g = createSeek(env(level, cols, rows));
  const onEdge = g.state.spots.filter(([c, r]) => level.solid[r * cols + c]);
  expect(onEdge.length).toBeGreaterThanOrEqual(3);
  expect(onEdge.some(([c]) => c >= 50 && c <= 52)).toBe(true); // the switch
});

test("Hide & Seek: covering a hider for half a second finds it (a flickering mask still counts); the round ends at 60 s", () => {
  const cols = 160, rows = 90, g = createSeek(env(null, cols, rows));
  for (let i = 0; i < 60; i++) g.step(frame(null)); // fade in
  const h = g.state.hiders[0], mask = new Uint8Array(cols * rows);
  const c = Math.floor(h.x / T) + 2, r = Math.floor(h.y / T) - 2; // a hand near it, not exactly on it
  mask[r * cols + c] = mask[r * cols + c + 1] = 1;
  for (let i = 0; i < 20; i++) g.step(frame(mask));
  expect(g.state.score).toBe(0); // a third of a second is not yet
  for (let i = 0; i < 40 && !g.state.score; i++) g.step(frame(i % 4 === 0 ? new Uint8Array(cols * rows) : mask));
  expect(g.state.score).toBe(1);
  expect(g.state.events).toContain("coin");
  expect(g.state.hiders.length).toBe(4); // someone new hides
  expect(g.state.runners.length).toBe(1);
  for (let i = 0; i < ROUND && !g.state.over; i++) g.step(frame(null));
  expect(g.state.over).toBe(true);
  expect(g.state.events).toContain("win");
  expect(g.state.score).toBe(1);
});

test("Hide & Seek: unfound critters sneak to a new spot", () => {
  const g = createSeek(env(null));
  const before = g.state.hiders.map((h) => h.spot);
  for (let i = 0; i < 3000; i++) g.step(frame(null));
  expect(g.state.hiders.map((h) => h.spot)).not.toEqual(before);
});
