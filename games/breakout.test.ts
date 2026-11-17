import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createBreakout } from "./breakout";

const T = 8, cols = 40, rows = 30, none = new Set<string>();
const frame = (held = none, pressed = none) => ({ held, pressed, mask: null });

test("Break the Room: edges become bricks, a hit breaks one and scores, losing 3 balls ends the round", () => {
  const solid = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) solid[5 * cols + c] = 1; // a 40-tile line: 7 bricks, not 40
  for (let c = 0; c < cols; c++) solid[(rows - 2) * cols + c] = 1; // below the paddle: not a brick
  const g = createBreakout(cols, rows, T, solid, seeded(1));
  expect(g.bricks.length).toBe(7);
  g.step(frame(none, new Set(["Space"])));
  for (let i = 0; i < 200 && !g.state.score; i++) g.step(frame());
  expect(g.state.score).toBe(10);
  expect(g.state.events).toContain("coin");
  expect(g.state.left).toBe(6);
  expect(g.ball.y).toBeGreaterThan(6 * T); // bounced back down off the line, didn't go through

  for (let lost = 0; lost < 3; lost++) { // nobody moves the paddle: put the ball past it each time
    g.step(frame(none, new Set(["Space"])));
    Object.assign(g.ball, { x: 4 * T, y: rows * T - 2 * T, vx: 0, vy: 8 });
    for (let i = 0; i < 20 && !g.state.events.includes("ouch"); i++) g.step(frame());
    expect(g.state.lives).toBe(2 - lost);
  }
  expect(g.state.over).toBe(true);
});

test("Break the Room: a paddle that follows the ball clears the room and wins", () => {
  const solid = new Uint8Array(cols * rows);
  for (let c = 4; c < 36; c++) solid[6 * cols + c] = 1;
  const g = createBreakout(cols, rows, T, solid, seeded(3));
  for (let i = 0; i < 60 * 600 && !g.state.over; i++) {
    const d = g.ball.x - g.paddle();
    g.step(frame(new Set(d < -10 ? ["ArrowLeft"] : d > 10 ? ["ArrowRight"] : []), new Set(["Space"])));
  }
  expect(g.state.left).toBe(0);
  expect(g.state.over).toBe(true);
  expect(g.state.events).toContain("win");
});
