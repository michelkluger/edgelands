import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createMarble, ROUND } from "./marble";

const T = 8, cols = 120, rows = 60, none = new Set<string>();

/** Drop one marble at x and step with this shadow (other spawns removed); returns the score it made. */
function drop(x: number, mask: Uint8Array | null) {
  const g = createMarble(cols, rows, T, null, seeded(1));
  g.step({ held: none, pressed: none, mask });
  g.marbles.length = 0;
  g.marbles.push({ x, y: 2 * T, vx: 0, vy: 0, r: 1.2 * T, color: "#fff", still: 0 });
  const m = g.marbles[0];
  for (let i = 0; i < 600 && g.marbles.includes(m); i++) {
    g.step({ held: none, pressed: none, mask });
    g.marbles.splice(0, g.marbles.length, ...g.marbles.filter((k) => k === m));
  }
  return g.state.score;
}

test("Marble Run: a marble over a cup scores; between cups it falls out; a shadow ramp steers it into the cup", () => {
  expect(drop(480, null)).toBe(1); // middle cup at x 424..536
  expect(drop(330, null)).toBe(0); // between cups 1 and 2
  const ramp = new Uint8Array(cols * rows);
  for (let c = 37; c <= 54; c++) ramp[(20 + Math.floor((c - 37) / 2)) * cols + c] = 1; // slopes down to the right, ends over the middle cup
  expect(drop(330, ramp)).toBe(1);
});

test("Marble Run: the round ends after 90 s", () => {
  const g = createMarble(cols, rows, T, null, seeded(2));
  for (let i = 0; i < ROUND; i++) g.step({ held: none, pressed: none, mask: null });
  expect(g.state.over).toBe(true);
  expect(g.state.events).toContain("win");
});
