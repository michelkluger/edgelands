import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createPong, WIN } from "./pong";

const T = 8, cols = 120, rows = 60, none = new Set<string>();

test("Shadow Pong: a shadow returns the ball (a rally), the ball out on the right scores for the left", () => {
  const g = createPong(cols, rows, T, null, seeded(1));
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) mask[r * cols + 5] = 1; // the left player blocks the whole height
  g.state.wait = 0;
  Object.assign(g.ball, { vx: -5, vy: 0.5 });
  for (let i = 0; i < 1000 && g.state.pts[0] + g.state.pts[1] === 0; i++) g.step({ held: none, pressed: none, mask });
  expect(g.state.pts).toEqual([1, 0]);
  expect(g.state.score).toBe(1); // longest rally
  expect(g.state.events).toContain("coin");
});

test("Shadow Pong: nobody defends: points go in and the first to 7 ends the game", () => {
  const g = createPong(cols, rows, T, null, seeded(2));
  for (let i = 0; i < 60 * 300 && !g.state.over; i++) g.step({ held: none, pressed: none, mask: null });
  expect(g.state.over).toBe(true);
  expect(Math.max(...g.state.pts)).toBe(WIN);
  expect(g.state.events).toContain("win");
});
