import { expect, test } from "bun:test";
import { createCatch, ROUND } from "./catch";
import { seeded } from "./game";
import { shadowMask } from "./shadow";

test("shadowMask: a dark blob on the lit wall becomes shadow tiles, the rest doesn't", () => {
  const camW = 64, camH = 36, step = 2, w = camW / step, h = camH / step, T = 8;
  const map = new Int16Array(2 * camW * camH);
  for (let y = 0; y < camH; y++) for (let x = 0; x < camW; x++) map.set([x * 2, y * 2], 2 * (y * camW + x)); // proj = 2 × cam
  const ref = new Uint8Array(w * h).fill(150), cur = ref.slice();
  for (let y = 4; y < 10; y++) for (let x = 8; x < 16; x++) cur[y * w + x] = 20; // a shadow
  const cols = 16, rows = 9, mask = shadowMask(cur, ref, map, camW, step, cols, rows, T);
  expect(mask[3 * cols + 5]).toBe(1); // inside the blob (proj x 32..63, y 16..39)
  expect(mask[7 * cols + 12]).toBe(0); // lit wall
  expect(mask.reduce((a, b) => a + b, 0)).toBeLessThan(20);
  // a lit body in front of the wall (brighter than the wall) is not a shadow
  const lit = ref.map(() => 230);
  expect(shadowMask(lit, ref, map, camW, step, cols, rows, T).reduce((a, b) => a + b, 0)).toBe(0);
});

test("Shadow Catch: a star in your shadow scores, a bomb costs and resets the combo, the round ends at 60 s", () => {
  const cols = 20, rows = 30, T = 8;
  const g = createCatch(cols, rows, T, null, seeded(1));
  const band = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) band[15 * cols + c] = 1; // a shadow band across row 15
  const s = g.state;
  const drop = (kind: "star" | "gold" | "bomb") => {
    s.items.length = 0;
    s.items.push({ x: 80, y: 0, vy: 3, kind, spin: 0 });
    for (let i = 0; i < 100 && s.items.some((it) => it.x === 80); i++) g.step(band);
  };
  for (let k = 0; k < 3; k++) drop("star");
  expect(s.score).toBe(3);
  expect(s.combo).toBe(2); // three clean catches in a row
  drop("gold");
  expect(s.score).toBe(3 + 5 * 2);
  drop("bomb");
  expect(s.score).toBe(8);
  expect(s.combo).toBe(1);

  const h = createCatch(cols, rows, T, null, seeded(2));
  for (let i = 0; i < ROUND; i++) h.step(null); // nobody in the beam: nothing caught, the round still ends
  expect(h.state.over).toBe(true);
  expect(h.state.events).toContain("win");
  expect(h.state.score).toBe(0);
});
