import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { seeded } from "../game";
import type { Env } from "../wall";
import { createBridge, CRITTERS } from "./bridge";

const T = 8, cols = 60, rows = 60;
// two ledges at the same height with a gap between them, far above the floor (a fall into the gap knocks a critter out)
const level = fromMap(T, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 15 && ((c >= 3 && c <= 20) || (c >= 35 && c <= 56)) ? "#" : ".")).join("")));
const env = (lv = level, n = 1): Env => ({ cols: lv?.cols ?? 160, rows: lv?.rows ?? 90, T, level: lv, rand: seeded(n), best: 0 });
const frame = (mask: Uint8Array | null) => ({ held: new Set<string>(), pressed: new Set<string>(), mask });

test("Shadow Bridge: the door is on one ledge, home on the other side of the gap", () => {
  const g = createBridge(env());
  expect(g.door[1]).toBe(15);
  expect(g.door[0]).toBeLessThanOrEqual(20);
  expect(g.door[2]).toBe(1); // walking towards the gap
  expect(g.home[0]).toBeGreaterThanOrEqual(35);
  expect(g.home[1]).toBe(15);
});

test("Shadow Bridge: a shadow bridge across the gap (with a flickering mask) gets them all home", () => {
  const g = createBridge(env());
  const mask = new Uint8Array(cols * rows);
  for (let c = 21; c < 35; c++) mask[15 * cols + c] = 1;
  for (let i = 0; i < 6000 && !g.state.over; i++) g.step(frame(i % 3 === 0 ? null : mask));
  expect(g.state.over).toBe(true);
  expect(g.state.score).toBe(CRITTERS);
  expect(g.state.lost).toBe(0);
  expect(g.state.events).toContain("win");
});

test("Shadow Bridge: no bridge, they fall into the gap and are lost; the round still ends", () => {
  const g = createBridge(env());
  let ouch = 0;
  for (let i = 0; i < 6000 && !g.state.over; i++) g.step(frame(new Uint8Array(cols * rows))), (ouch += g.state.events.filter((e) => e === "ouch").length);
  expect(g.state.over).toBe(true);
  expect(g.state.score).toBe(0);
  expect(g.state.lost).toBe(CRITTERS);
  expect(ouch).toBe(CRITTERS);
});

test("Shadow Bridge: works without an edge map (generated ledges), the round ends", () => {
  const g = createBridge(env(null as never, 3));
  expect(g.home).not.toEqual(g.door.slice(0, 2));
  for (let i = 0; i < 9000 && !g.state.over; i++) g.step(frame(null));
  expect(g.state.over).toBe(true);
});
