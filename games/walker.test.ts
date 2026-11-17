import { expect, test } from "bun:test";
import { fromMap } from "../edges";
import { createWorld } from "./walker";

const T = 8;
const world = (map: string[]) => {
  const l = fromMap(T, map);
  return { l, w: createWorld(l.cols, l.rows, T, l.solid) };
};

test("walker: walks along an edge, steps up a one-tile rise, turns at a wall", () => {
  const { w } = world([
    "....................",
    "....................",
    "....................",
    "..........#.........",
    "..........#.........",
    "..........#.........",
    "......##..#.........",
    "####################",
    "....................",
  ]);
  const k = w.spawn(2, 7, 1);
  let top = k.y;
  for (let i = 0; i < 200; i++) w.step(k), (top = Math.min(top, k.y));
  expect(top).toBe(6 * T); // climbed onto the "##" step
  for (let i = 0; i < 200 && k.dir > 0; i++) w.step(k);
  expect(k.dir).toBe(-1); // the 4-tile post is a wall
  expect(k.ground).toBe(true);
});

test("walker: falls off the end of a ledge and reports the fall on landing", () => {
  const { w } = world([
    "..............",
    "..............",
    "#####.........",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
  ]);
  const k = w.spawn(1, 2, 1);
  let fell = 0;
  for (let i = 0; i < 400 && !fell; i++) fell = w.step(k);
  expect(fell).toBe(6); // row 2 → the beam's bottom row 8
  expect(k.ground).toBe(true);
  expect(Math.floor(k.x / T)).toBe(5);
});

test("walker: stands and walks on shadow tiles, and a one-frame dropout of the mask doesn't drop it", () => {
  const { l, w } = world(Array.from({ length: 20 }, () => ".".repeat(30)));
  const mask = new Uint8Array(l.cols * l.rows);
  for (let c = 2; c < 28; c++) mask[10 * l.cols + c] = 1; // an arm held out level
  const k = w.spawn(5, 10, 1);
  for (let i = 0; i < 120; i++) {
    w.sense(i % 4 === 2 ? null : i % 4 === 3 ? new Uint8Array(mask.length) : mask); // camera gaps and flicker
    w.step(k);
    expect(k.ground).toBe(true);
    expect(k.y).toBe(10 * T);
  }
  expect(k.x).toBeGreaterThan(5 * T + T); // and it walked along it
  for (let i = 0; i < 30; i++) w.sense(null), w.step(k); // the arm is really gone
  expect(k.ground).toBe(false);
});

test("walker: a shadow rising into it lifts it on top", () => {
  const { l, w } = world(Array.from({ length: 20 }, () => ".".repeat(30)));
  const k = w.spawn(10, 19, 1);
  const mask = new Uint8Array(l.cols * l.rows);
  for (let r = 14; r < 19; r++) for (let c = 6; c < 16; c++) mask[r * l.cols + c] = 1;
  for (let i = 0; i < 20; i++) w.sense(mask), w.step(k);
  expect(k.y).toBe(14 * T);
  expect(k.ground).toBe(true);
});
