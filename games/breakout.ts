// Break the Room: Breakout where the room's real edges are the bricks. Fixed 60 Hz steps, projector px.
import type { GameEvent } from "../game";
import type { Frame, GameDef } from "../wall";
import { type Ball, burst, clamp, clusters, drawBall, drawFx, fx, hitSegment, limit, moveBall, stepFx, text } from "./ball";

const BRICK = 6; // tiles per brick: a wall line breaks in a few chunks, not hundreds of single-tile hits
const COLORS = ["#ff4fd8", "#28e0ff", "#ffd60a", "#00ff88"];

export function createBreakout(cols: number, rows: number, T: number, solid: Uint8Array | null, rand: () => number, best = 0) {
  const W = cols * T, H = rows * T, py = H - 5 * T, pw = 14 * T;
  // bricks: edge clusters cut into runs of BRICK tiles; edges at or below the paddle can't be reached, so they don't count
  const brick = new Int32Array(cols * rows).fill(-1), bricks: number[][] = [];
  const usable = (solid ?? new Uint8Array(cols * rows)).map((v, i) => (v && Math.floor(i / cols) * T < py - 3 * T ? 1 : 0));
  for (const comp of clusters(usable, cols, rows))
    for (let i = 0; i < comp.length; i += BRICK) {
      const b = comp.slice(i, i + BRICK);
      for (const t of b) brick[t] = bricks.length;
      bricks.push(b);
    }
  const alive = new Uint8Array(bricks.length).fill(1), f = fx();
  const ball: Ball = { x: W / 2, y: py - 2 * T, vx: 0, vy: 0, r: T };
  const s = { score: 0, lives: 3, left: bricks.length, over: bricks.length === 0, events: [] as GameEvent[], frames: 0 };
  let px = W / 2, docked = true; // docked: the ball rides the paddle until Space

  const wall = (c: number, r: number) => c < 0 || c >= cols || r < 0 || (r < rows && brick[r * cols + c] >= 0 && alive[brick[r * cols + c]] === 1);
  const speed = () => Math.min(11, 6.5 + 0.06 * (bricks.length - s.left)); // a little faster with every brick

  function step({ held, pressed }: Frame) {
    s.events = [];
    stepFx(f);
    if (s.over) return;
    s.frames++;
    const dir = (held.has("ArrowRight") || held.has("KeyD") ? 1 : 0) - (held.has("ArrowLeft") || held.has("KeyA") ? 1 : 0);
    px = clamp(px + dir * 14, pw / 2, W - pw / 2);
    if (docked) {
      ball.x = px;
      ball.y = py - T / 2 - ball.r - 1;
      if (pressed.has("Space")) (docked = false), (ball.vx = (rand() - 0.5) * 4), (ball.vy = -speed());
      return;
    }
    const hits = moveBall(ball, T, wall, 1, (b) => {
      if (!hitSegment(b, px - pw / 2, py, px + pw / 2, py, T / 2) || b.y > py) return;
      const a = clamp((b.x - px) / (pw / 2), -1, 1) * 1.05, sp = Math.hypot(b.vx, b.vy); // where it lands on the paddle sets the angle (±60°)
      (b.vx = sp * Math.sin(a)), (b.vy = -sp * Math.cos(a));
      s.events.push("jump");
    });
    for (const h of hits) {
      const id = brick[h.r * cols + h.c];
      if (id < 0 || !alive[id]) continue;
      alive[id] = 0;
      s.left--;
      s.score += 10;
      s.events.push("coin");
      for (const t of bricks[id]) burst(f, rand, (t % cols) * T + T / 2, Math.floor(t / cols) * T + T / 2, COLORS[id % 4], 4);
    }
    const sp = speed();
    if (Math.abs(ball.vy) < 0.3 * sp) ball.vy = (ball.vy < 0 ? -0.3 : 0.3) * sp; // no endless side-to-side rallies
    limit(ball, sp, sp);
    if (ball.y > H + ball.r) {
      s.lives--;
      s.events.push("ouch");
      f.rings.push({ x: ball.x, y: H - T, t: 0, color: "#ff8a80" });
      docked = true;
      if (!s.lives) s.over = true;
    }
    if (!s.left) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.shadowBlur = 10;
    COLORS.forEach((color, k) => { // one glowing path per colour: cheap enough for every frame
      ctx.beginPath();
      for (let id = k; id < bricks.length; id += 4) if (alive[id]) for (const t of bricks[id]) ctx.rect((t % cols) * T + 0.5, Math.floor(t / cols) * T + 0.5, T - 1, T - 1);
      ctx.fillStyle = ctx.shadowColor = color;
      ctx.fill();
    });
    ctx.fillStyle = ctx.shadowColor = "#e8f7ff";
    ctx.beginPath();
    ctx.roundRect(px - pw / 2, py - T / 2, pw, T, T / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    drawBall(ctx, ball, "#7df9ff");
    drawFx(ctx, f, T);
    text(ctx, `★ ${s.score}   ${"♥".repeat(s.lives)}   bricks ${s.left}${best ? `   best ${best}` : ""}`, W / 2, H - 1.2 * T, 1.6 * T, 0.85);
    if (s.over) {
      text(ctx, `${s.left ? "Out of balls" : "Room cleared!"} · ${s.score} points${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.45, 4 * T);
      text(ctx, "R = again · Esc = menu", W / 2, H * 0.45 + 4 * T, 2.2 * T);
    } else if (docked) text(ctx, "Space = launch · ← → or A D move", W / 2, py - 5 * T, 2.2 * T, 0.8);
  }

  return { step, draw, state: s, ball, bricks, alive, paddle: () => px };
}

export const breakout: GameDef = {
  id: "breakout",
  title: "Break the Room",
  sub: "Breakout: the room's own edges are the bricks · 3 lives",
  hint: "← → or A D move · Space launch · R again · M mute",
  input: "keys",
  create: (env) => createBreakout(env.cols, env.rows, env.T, env.level?.solid ?? null, env.rand, env.best),
};
