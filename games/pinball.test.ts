import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createPinball } from "./pinball";

const T = 8, cols = 120, rows = 80, none = new Set<string>();
const frame = (held = none) => ({ held, pressed: none, mask: null });

test("Wall Pinball: the plunger launches, a flipper sends the ball up, a bumper scores", () => {
  const solid = new Uint8Array(cols * rows);
  for (let r = 30; r < 33; r++) for (let c = 40; c < 43; c++) solid[r * cols + c] = 1; // a 9-tile cluster: a bumper
  const g = createPinball(cols, rows, T, solid, seeded(1));
  expect(g.bumpers.length).toBe(1);
  for (let i = 0; i < 60; i++) g.step(frame(new Set(["Space"])));
  g.step(frame());
  expect(g.ball.vy).toBeLessThan(-20);
  expect(g.state.events).toContain("power");

  // resting on the left flipper, then flip
  const [px] = g.pivots, a = 0.45;
  Object.assign(g.ball, { x: px + 12 * T * Math.cos(a), y: g.py + 12 * T * Math.sin(a) - 2.2 * T, vx: 0, vy: 0 });
  let minVy = 0;
  for (let i = 0; i < 8; i++) g.step(frame(new Set(["ShiftLeft"]))), (minVy = Math.min(minVy, g.ball.vy));
  expect(minVy).toBeLessThan(-8);

  Object.assign(g.ball, { x: 41.5 * T, y: 24 * T, vx: 0, vy: 4 });
  for (let i = 0; i < 30 && !g.state.events.includes("coin"); i++) g.step(frame());
  expect(g.state.score).toBeGreaterThanOrEqual(25);
});

test("Wall Pinball: a ball between the flippers drains; the third drain ends the game", () => {
  const g = createPinball(cols, rows, T, new Uint8Array(cols * rows), seeded(2));
  for (let n = 0; n < 3; n++) {
    Object.assign(g.ball, { x: (cols * T) / 2, y: g.py, vx: 0, vy: 3 });
    for (let i = 0; i < 120; i++) if ((g.step(frame()), g.state.events.includes("ouch"))) break;
    expect(g.state.balls).toBe(2 - n);
  }
  expect(g.state.over).toBe(true);
});
