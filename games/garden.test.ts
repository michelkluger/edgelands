import { expect, test } from "bun:test";
import { seeded } from "../game";
import { createGarden } from "./garden";

const cols = 80, rows = 45, T = 8;
const f = (mask: Uint8Array | null) => ({ held: new Set<string>(), pressed: new Set<string>(), mask });

test("Shadow Garden: plants under a sheltering shadow bloom, plants in the open rain don't, the round ends", () => {
  const ledge = { tile: T, cols, rows, solid: new Uint8Array(cols * rows).fill(1, 30 * cols + 40, 30 * cols + 60) };
  for (const level of [null, ledge]) {
    const g = createGarden({ cols, rows, T, level, rand: seeded(3), best: 0 }), s = g.state;
    if (level) expect(s.plants.some((p) => p.r === 30)).toBe(true); // seeds on the ledge
    const umbrella = new Uint8Array(cols * rows).fill(1, 10 * cols, 10 * cols + cols / 2); // a shadow band over the left half
    for (let i = 0; i < 35 * 60; i++) g.step(f(umbrella));
    const left = s.plants.filter((p) => p.c < cols / 2 - 1), right = s.plants.filter((p) => p.c > cols / 2 + 1);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.every((p) => p.g >= 1)).toBe(true);
    expect(right.every((p) => p.g === 0)).toBe(true);
    expect(s.score).toBe(s.plants.filter((p) => p.g >= 1).length);
    expect(s.drops.some((d) => d.y > 11 * T && d.y < rows * T && d.x < (cols / 2 - 1) * T)).toBe(false); // rain stops on the shadow

    for (let i = 0; i < 30 * 60; i++) g.step(f(null)); // open rain: blooms droop, never die
    expect(left.every((p) => p.g >= 1 && p.wet === 1)).toBe(true);
    for (let i = 0; i < 2 * 60 * 60; i++) g.step(f(null));
    expect(s.over).toBe(true);
  }
});
