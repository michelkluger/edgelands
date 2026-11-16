import { expect, test } from "bun:test";
import { SKIP, bitsFor, decode, fillHoles, fromGray, gray, lit } from "./calibrate";

test("gray code round-trips", () => {
  for (let n = 0; n < 5000; n++) expect(fromGray(gray(n))).toBe(n);
});

test("decode recovers every lit pixel's projector coordinate, even across a fold", () => {
  const PW = 320, PH = 200, CW = 160, CH = 120;
  // two planes meeting at camera x = 80, like a room corner: different scale on each side
  const truth = (x: number, y: number): [number, number] => [x < 80 ? 1.5 * x : 120 + 2.5 * (x - 80), 1.6 * y + (x < 80 ? 0 : 0.3 * (x - 80))];
  const shot = (f: (u: number, v: number) => number) => {
    const g = new Uint8Array(CW * CH);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const [u, v] = truth(x, y);
        g[y * CW + x] = u >= PW || v >= PH ? 10 : f(Math.floor(u), Math.floor(v));
      }
    return g;
  };
  const pairs = (bits: number, pick: (u: number, v: number) => number) =>
    Array.from({ length: bits }, (_, k) => [
      shot((u, v) => (lit(pick(u, v), k, bits) ? 200 : 10)),
      shot((u, v) => (lit(pick(u, v), k, bits) ? 10 : 200)),
    ] as [Uint8Array, Uint8Array]);
  const { map, lit: litN, decoded } = decode(shot(() => 10), shot(() => 200), pairs(bitsFor(PW), (u) => u), pairs(bitsFor(PH), (_, v) => v));
  expect(decoded).toBe(litN);
  const half = (1 << SKIP) / 2;
  for (let i = 0; i < CW * CH; i++) {
    if (map[2 * i] < 0) continue;
    const [u, v] = truth(i % CW, Math.floor(i / CW));
    expect(Math.abs(map[2 * i] - u)).toBeLessThanOrEqual(half);
    expect(Math.abs(map[2 * i + 1] - v)).toBeLessThanOrEqual(half);
  }
});

test("fillHoles spreads values into small gaps only", () => {
  const map = new Int16Array(2 * 10).fill(-1); // 10×1 strip, only pixel 0 known
  map[0] = 7;
  map[1] = 9;
  const filled = fillHoles(map, 10, 1, 3);
  expect([filled[6], filled[7], filled[8]]).toEqual([7, 9, -1]);
});
