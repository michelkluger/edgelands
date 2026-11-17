import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createPaint } from "./paint";

const cols = 40, rows = 30, T = 8;
const block = (c0: number) => {
  const m = new Uint8Array(cols * rows);
  for (let r = 5; r < 10; r++) for (let c = c0; c < c0 + 5; c++) m[r * cols + c] = 1;
  return m;
};
const ledge = { tile: T, cols, rows, solid: new Uint8Array(cols * rows).fill(1, 20 * cols, 21 * cols) }; // an edge across row 20

test("Shadow Paint: the shadow's border gets paint, drips pool on an edge or the floor, the painted share rises", () => {
  for (const level of [ledge, null]) {
    const g = createPaint({ cols, rows, T, level, rand: seeded(1), best: 0 }), s = g.state;
    const a = (c: number, r: number) => s.px[4 * (r * cols + c) + 3];
    g.step({ held: new Set(), pressed: new Set(), mask: block(10) });
    expect(a(9, 7)).toBe(255); // just left of the shadow
    expect(a(12, 4)).toBe(255); // just above
    expect(a(12, 7)).toBe(0); // inside the shadow: that's the player
    expect(a(30, 7)).toBe(0);
    const before = s.score;
    expect(before).toBeGreaterThan(0);
    for (let x = 12; x < 30; x++) g.step({ held: new Set(), pressed: new Set(), mask: block(x) });
    expect(s.score).toBeGreaterThan(before);

    s.drips.length = 0;
    s.drips.push({ c: 35, y: 2, v: 0.1, col: [255, 255, 255] });
    for (let i = 0; i < 400; i++) g.step({ held: new Set(), pressed: new Set(), mask: null });
    expect(s.drips.length).toBe(0);
    const stop = level ? 19 : rows - 1;
    expect(a(35, 10)).toBe(255); // the trail
    expect(a(35, stop)).toBe(255);
    expect(a(33, stop)).toBe(255); // the pool
    if (level) expect(a(35, 21)).toBe(0); // never past the edge
  }
});

test("Shadow Paint: the round ends after 3 minutes", () => {
  const g = createPaint({ cols, rows, T, level: null, rand: seeded(2), best: 0 });
  for (let i = 0; i < 3 * 60 * 60; i++) g.step({ held: new Set(), pressed: new Set(), mask: null });
  expect(g.state.over).toBe(true);
});
