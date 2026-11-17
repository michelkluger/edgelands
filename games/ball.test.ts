import { expect, test } from "bun:test";
import { type Ball, clusters, hitSegment, moveBall } from "./ball";

const T = 8, cols = 20, rows = 20;
const grid = (tiles: [number, number][]) => {
  const g = new Uint8Array(cols * rows);
  for (const [c, r] of tiles) g[r * cols + c] = 1;
  return (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && g[r * cols + c] === 1;
};

test("a fast ball bounces off a 1-tile line instead of tunnelling through it", () => {
  const solid = grid(Array.from({ length: cols }, (_, c) => [c, 10] as [number, number]));
  const b: Ball = { x: 80, y: 20, vx: 0, vy: 30, r: T / 2 };
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    hits += moveBall(b, T, solid).length;
    expect(b.y).toBeLessThan(80);
  }
  expect(hits).toBeGreaterThan(0);
});

test("a diagonal (8-connected) edge holds too", () => {
  const solid = grid(Array.from({ length: cols }, (_, c) => [c, c] as [number, number]));
  const b: Ball = { x: 120, y: 40, vx: -14, vy: 14, r: T / 2 };
  for (let i = 0; i < 30; i++) {
    moveBall(b, T, solid);
    expect(b.y).toBeLessThan(b.x); // still on the upper-right side of the line
  }
});

test("a shadow over the ball pushes it out; a swinging capsule adds its speed", () => {
  const solid = grid([[5, 5], [6, 5], [5, 6], [6, 6]]);
  const b: Ball = { x: 44, y: 44, vx: 0, vy: 0, r: T / 2 };
  const hits = moveBall(b, T, solid);
  expect(solid(Math.floor(b.x / T), Math.floor(b.y / T))).toBe(false);
  expect(hits.length).toBeGreaterThan(0);

  const c: Ball = { x: 50, y: -5, vx: 0, vy: 0, r: 4 };
  expect(hitSegment(c, 0, 0, 100, 0, 2, 0.5, -0.1)).toBe(true); // flipper turning upward under the ball
  expect(c.vy).toBeLessThan(-4);
});

test("clusters: separate lines are separate clusters", () => {
  const g = new Uint8Array(cols * rows);
  for (let c = 2; c < 8; c++) g[3 * cols + c] = 1;
  for (let c = 10; c < 14; c++) g[9 * cols + c] = g[(9 + c - 10) * cols + c] = 1;
  expect(clusters(g, cols, rows).map((k) => k.length).sort()).toEqual([6, 7]);
});
