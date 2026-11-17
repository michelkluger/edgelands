import { expect, test } from "bun:test";
import { MAX_POWER, MIN_POWER, fly, launch, steer } from "./aim";
import { slide } from "./kit";

const frame = (held: string[] = [], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed), mask: null });

test("steer: arrows and WASD both turn and power the aim, within limits; Space fires", () => {
  const aim = { a: Math.PI / 4, power: 10 };
  expect(steer(aim, frame(["ArrowLeft", "ArrowUp"]))).toBe(false);
  expect(aim.a).toBeGreaterThan(Math.PI / 4); // ← swings toward the left
  expect(aim.power).toBeGreaterThan(10);
  steer(aim, frame(["KeyD", "KeyD"]));
  steer(aim, frame(["KeyD"]));
  expect(aim.a).toBeLessThan(Math.PI / 4);
  for (let i = 0; i < 500; i++) steer(aim, frame(["KeyD", "KeyW"]));
  expect(aim.a).toBeGreaterThan(0);
  expect(aim.power).toBe(MAX_POWER);
  for (let i = 0; i < 500; i++) steer(aim, frame(["ArrowDown"]));
  expect(aim.power).toBe(MIN_POWER);
  expect(steer(aim, frame([], ["Space"]))).toBe(true);
});

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
