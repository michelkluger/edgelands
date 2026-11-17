// Shots through the wind, used by Critter Clash: launch at an angle and power, then fly a frame at a time.
import { type Body, slide } from "./kit";

export const G = 0.25; // px per frame²: a full-power 45° shot carries ~1900 px, across a 1080p wall
export const MIN_POWER = 2, MAX_POWER = 22;
export type Aim = { a: number; power: number }; // a: radians, 0 = right, π/2 = straight up, π = left

export const launch = (x: number, y: number, aim: Aim): Body => ({ x, y, vx: Math.cos(aim.a) * aim.power, vy: -Math.sin(aim.a) * aim.power });

/** One frame of flight: wind and gravity, then the move against the tiles. */
export function fly(b: Body, wind: number, T: number, wall: (c: number, r: number) => boolean) {
  b.vx += wind;
  b.vy += G;
  return slide(b, T, wall);
}
