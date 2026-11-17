// Aim and shot, used by Wall Artillery: ←/→ (or A/D) swing the aim, ↑/↓ (W/S) set the power, Space fires.
import type { Frame } from "../wall";
import { type Body, keys, slide } from "./kit";

export const G = 0.25; // px per frame²: a full-power 45° shot carries ~1900 px, across a 1080p wall
export const MIN_POWER = 2, MAX_POWER = 22;
export type Aim = { a: number; power: number }; // a: radians, 0 = right, π/2 = straight up, π = left

/** Applies held keys to the aim; true when Space was pressed (fire). */
export function steer(aim: Aim, f: Frame) {
  if (keys(f.held, "ArrowLeft", "KeyA")) aim.a = Math.min(Math.PI - 0.05, aim.a + 0.02);
  if (keys(f.held, "ArrowRight", "KeyD")) aim.a = Math.max(0.05, aim.a - 0.02);
  if (keys(f.held, "ArrowUp", "KeyW")) aim.power = Math.min(MAX_POWER, aim.power + 0.12);
  if (keys(f.held, "ArrowDown", "KeyS")) aim.power = Math.max(MIN_POWER, aim.power - 0.12);
  return f.pressed.has("Space");
}

export const launch = (x: number, y: number, aim: Aim): Body => ({ x, y, vx: Math.cos(aim.a) * aim.power, vy: -Math.sin(aim.a) * aim.power });

/** One frame of flight: wind and gravity, then the move against the tiles. */
export function fly(b: Body, wind: number, T: number, wall: (c: number, r: number) => boolean) {
  b.vx += wind;
  b.vy += G;
  return slide(b, T, wall);
}

/** Dotted preview of the first `frames` of the flight (terrain ignored): enough to aim, not enough to solve the shot. */
export function drawAim(ctx: CanvasRenderingContext2D, x: number, y: number, aim: Aim, wind: number, color: string, frames = 26) {
  const b = launch(x, y, aim);
  ctx.fillStyle = color;
  for (let i = 1; i <= frames; i++) {
    b.vx += wind;
    b.vy += G;
    b.x += b.vx;
    b.y += b.vy;
    if (i % 2) continue;
    ctx.globalAlpha = 1 - i / frames;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
