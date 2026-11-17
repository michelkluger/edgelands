// Marble Run: glowing marbles roll down the room's real edges; your shadow is solid too, steer them into the cups.
// Fixed 60 Hz steps, projector px.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Frame, GameDef } from "../wall";
import { type Ball, burst, drawBall, drawFx, drawHalo, drawTiles, fx, hitSegment, limit, moveBall, stepFx, text } from "./ball";

export const ROUND = 90 * 60; // 90 s
const COLORS = ["#fff27a", "#ff9de6", "#9dffcb", "#ffd08a"];
type Marble = Ball & { color: string; still: number };

export function createMarble(cols: number, rows: number, T: number, solid: Uint8Array | null, rand: () => number, best = 0) {
  const W = cols * T, H = rows * T, top = H - 9 * T, floor = H - 2 * T;
  const cups = [0.2, 0.5, 0.8].map((k) => [W * k - 7 * T, W * k + 7 * T]); // [left, right] x of each cup
  const rails = cups.flatMap(([a, b]) => [[a, top, a, floor], [a, floor, b, floor], [b, floor, b, top]]);
  // no edges in the cups' band: they'd plug a cup, and a floor line would catch every marble that misses
  const usable = (solid ?? new Uint8Array(cols * rows)).map((v, i) => (v && Math.floor(i / cols) * T < top - 4 * T ? 1 : 0));
  const marbles: Marble[] = [], f = fx();
  const s = { score: 0, over: false, events: [] as GameEvent[], frames: 0 };

  function step({ mask }: Frame) {
    s.events = [];
    stepFx(f);
    if (s.over) return;
    s.frames++;
    if (s.frames % 70 === 1 && marbles.length < 30)
      marbles.push({ x: W * (0.05 + 0.9 * rand()), y: -T, vx: (rand() - 0.5) * 2, vy: 1, r: 1.2 * T, color: COLORS[Math.floor(rand() * 4)], still: 0 });
    // the sides are walls, the top is open (marbles drop in) and so is the bottom (missed marbles fall out)
    const wall = (c: number, r: number) => c < 0 || c >= cols || (r >= 0 && r < rows && (usable[r * cols + c] === 1 || mask?.[r * cols + c] === 1));
    // shortcut: marbles pass through each other; add marble-marble bounces if cups look crowded on the real wall
    for (let i = marbles.length - 1; i >= 0; i--) {
      const m = marbles[i];
      m.vy += 0.1;
      moveBall(m, T, wall, 0.35, (b) => rails.forEach(([ax, ay, ex, ey]) => hitSegment(b, ax, ay, ex, ey, T / 2, 0.3)));
      m.vx *= 0.995; // rolling friction: a marble on a flat ledge slows down instead of sliding forever
      limit(m, 0, 6); // slow-ish: the shadow arrives ~80 ms late
      m.still = Math.hypot(m.vx, m.vy) < 0.2 ? m.still + 1 : 0;
      const cup = cups.findIndex(([a, b]) => m.x > a && m.x < b && m.y > top + m.r);
      if (cup >= 0) {
        s.score++;
        s.events.push("coin");
        burst(f, rand, m.x, top, m.color, 16);
        f.rings.push({ x: m.x, y: m.y, t: 0, color: "#ffffff" });
        marbles.splice(i, 1);
      } else if (m.y > H + m.r || m.still > 300) marbles.splice(i, 1); // fell out, or stuck on a ledge for 5 s
    }
    if (s.frames >= ROUND) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null) {
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    drawHalo(ctx, mask, cols, T);
    drawTiles(ctx, usable, cols, T, "#d8fbff");
    ctx.lineCap = "round";
    ctx.lineWidth = T;
    ctx.strokeStyle = ctx.shadowColor = "#ffd84d";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (const [ax, ay, ex, ey] of rails) ctx.moveTo(ax, ay), ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (const m of marbles) drawBall(ctx, m, m.color);
    drawFx(ctx, f, T);
    const left = Math.max(0, Math.ceil((ROUND - s.frames) / 60));
    text(ctx, `● ${s.score}   ${left}s${best ? `   best ${best}` : ""}`, W / 2, 3 * T, 2 * T);
    if (s.over) {
      text(ctx, `${s.score} marbles${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.42, 5 * T);
      text(ctx, "R = again · Esc = menu", W / 2, H * 0.42 + 5 * T, 2.2 * T);
    } else if (s.frames < 180) text(ctx, "Your shadow is solid: steer the marbles into the gold cups!", W / 2, H * 0.42, 3.5 * T, Math.min(1, (180 - s.frames) / 40));
  }

  return { step, draw, state: s, marbles, cups, top };
}

export const marble: GameDef = {
  id: "marble",
  title: "Marble Run",
  sub: "Steer rolling marbles into the cups with your shadow · 90 s",
  hint: "Step out of the light for the 3 s countdown · R again · M mute",
  input: "shadow",
  create: (env) => createMarble(env.cols, env.rows, env.T, env.level?.solid ?? null, env.rand, env.best),
};
