import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createPose, PER, POSES } from "./pose";

const cols = 120, rows = 68, T = 8; // half the real grid: four full rounds stay fast
const play = (seed: number, maskFor: (pose: Uint8Array) => Uint8Array | null) => {
  const g = createPose({ cols, rows, T, level: null, rand: seeded(seed), best: 0 }), s = g.state;
  while (!s.over) g.step({ held: new Set(), pressed: new Set(), mask: maskFor(s.poses[Math.floor(s.frames / PER)]) });
  return s;
};

test("Hole in the Wall: 8 poses standing on the floor, about 60% of the wall tall", () => {
  const s = play(1, () => null);
  expect(s.poses.length).toBe(POSES);
  for (const p of s.poses) {
    let top = rows, bottom = 0;
    for (let t = 0; t < p.length; t++) if (p[t]) (top = Math.min(top, Math.floor(t / cols))), (bottom = Math.floor(t / cols));
    expect(bottom).toBe(rows - 1);
    expect(bottom - top).toBeGreaterThan(rows * 0.4);
    expect(bottom - top).toBeLessThan(rows * 0.8);
  }
});

test("Hole in the Wall: a shadow matching the pose scores ~100%, none 0, a full-wall shadow low; the round ends after 8", () => {
  const exact = play(2, (p) => p);
  expect(exact.results.length).toBe(POSES);
  for (const r of exact.results) expect(r).toBeGreaterThanOrEqual(98);
  expect(exact.score).toBeGreaterThanOrEqual(98 * POSES);
  expect(play(2, () => null).score).toBe(0);
  const full = new Uint8Array(cols * rows).fill(1);
  for (const r of play(2, () => full).results) expect(r).toBeLessThan(10);
  const grown = play(2, (p) => p.map((v, t) => v || p[t - 1] || p[t + 1] || p[t - cols] || p[t + cols] ? 1 : 0)); // a noisy, slightly bigger shadow
  for (const r of grown.results) expect(r).toBeGreaterThanOrEqual(98);
});
