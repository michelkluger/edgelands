import { expect, test } from "bun:test";
import { MAX_POWER, fly, launch } from "./aim";
import { slide } from "./kit";

test("fly: even a full-power shot stops on a one-tile line, flush on its top", () => {
  const T = 8, line = (c: number, r: number) => r === 20;
  const b = launch(100, 40, { a: -Math.PI / 2, power: MAX_POWER }); // straight down, as fast as it gets
  let hit = { hitX: false, hitY: false };
  for (let i = 0; i < 20 && !hit.hitY; i++) hit = fly(b, 0, T, line);
  expect(hit.hitY).toBe(true);
  expect(b.y).toBeCloseTo(20 * T - 0.01, 5);
  const side = { x: 10, y: 10, vx: 30, vy: 0 }; // sideways into a one-tile wall at column 5
  expect(slide(side, T, (c) => c === 5).hitX).toBe(true);
  expect(side.x).toBeCloseTo(5 * T - 0.01, 5);
});
