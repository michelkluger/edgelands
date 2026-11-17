// Shadow Pong: a slow ball bounces off the room's edges and your shadows. The camera can't tell people apart, so the wall
// is split: each side defends its own half. First to 7. Fixed 60 Hz steps, projector px.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Frame, GameDef } from "../wall";
import { type Ball, burst, drawBall, drawFx, drawHalo, drawTiles, fx, limit, moveBall, stepFx, text, trapWatch } from "./ball";

export const WIN = 7;
const SERVE = 90; // frames the ball waits in the middle before a serve

export function createPong(cols: number, rows: number, T: number, solid: Uint8Array | null, rand: () => number, best = 0) {
  const W = cols * T, H = rows * T, f = fx();
  // edges in the outer fifths would wall off a goal (a door frame near the side): only the middle of the room plays
  const usable = (solid ?? new Uint8Array(cols * rows)).map((v, i) => (v && i % cols >= cols * 0.2 && i % cols < cols * 0.8 ? 1 : 0));
  // serve from the clear spot nearest the middle: an edge may run right through it
  let hx = W / 2, hy = H / 2, hd = Infinity;
  for (let r = 3; r < rows - 3; r++)
    for (let c = 3; c < cols - 3; c++) {
      const d = Math.hypot(c - cols / 2, r - rows / 2);
      if (d >= hd) continue;
      let clear = true;
      for (let k = 0; k < 25 && clear; k++) clear = !usable[(r + Math.floor(k / 5) - 2) * cols + c + (k % 5) - 2];
      if (clear) (hd = d), (hx = (c + 0.5) * T), (hy = (r + 0.5) * T);
    }
  const ball: Ball = { x: hx, y: hy, vx: 0, vy: 0, r: 1.5 * T };
  // score: the longest rally (shadow returns in one point), so a best score means something when either side wins
  const s = { pts: [0, 0], rally: 0, score: 0, wait: SERVE, over: false, events: [] as GameEvent[], frames: 0 };
  let serveTo = rand() < 0.5 ? -1 : 1;
  const trapped = trapWatch(T);
  const speed = () => Math.min(8, 4.5 + 0.2 * s.rally);
  const serve = (to: number) => (Object.assign(ball, { x: hx, y: hy, vx: 0, vy: 0 }), (s.rally = 0), (s.wait = SERVE), (serveTo = to));

  function step({ mask }: Frame) {
    s.events = [];
    stepFx(f);
    if (s.over) return;
    s.frames++;
    if (s.wait > 0) {
      if (--s.wait) return;
      const a = (rand() - 0.5) * 1.2;
      (ball.vx = serveTo * speed() * Math.cos(a)), (ball.vy = speed() * Math.sin(a));
    }
    // top and bottom are walls, left and right are the goals
    const wall = (c: number, r: number) => r < 0 || r >= rows || (c >= 0 && c < cols && (usable[r * cols + c] === 1 || mask?.[r * cols + c] === 1));
    const dir = Math.sign(ball.vx), hits = moveBall(ball, T, wall, 1);
    if (mask && hits.some((h) => h.r >= 0 && h.r < rows && mask[h.r * cols + h.c] && !usable[h.r * cols + h.c]) && Math.sign(ball.vx) !== dir) { // a return: the shadow sent it back the other way
      s.rally++;
      s.score = Math.max(s.score, s.rally);
      s.events.push("jump");
      f.rings.push({ x: ball.x, y: ball.y, t: 0, color: "#ffffff" });
    }
    const sp = speed();
    if (Math.abs(ball.vx) < 0.4 * sp) ball.vx = (ball.vx < 0 ? -0.4 : 0.4) * sp; // always heading for a goal, never stuck bouncing up and down
    limit(ball, sp, sp);
    if (trapped(ball) > 150) return void serve(serveTo); // boxed in by edges or a shadow for 2.5 s: serve again, no point
    const out = ball.x < -ball.r ? 1 : ball.x > W + ball.r ? 0 : -1; // who scores: through the left side = the right player
    if (out < 0) return;
    s.pts[out]++;
    s.events.push("coin");
    burst(f, rand, out ? 2 * T : W - 2 * T, ball.y, "#ffd84d", 30, 5);
    serve(out ? -1 : 1); // the ball goes to the side that just lost the point
    if (s.pts[out] >= WIN) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null) {
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.45)"; // the halfway line: dashes, light on the lit wall
    for (let y = T; y < H; y += 4 * T) ctx.fillRect(W / 2 - T / 4, y, T / 2, 2 * T);
    drawHalo(ctx, mask, cols, T);
    drawTiles(ctx, usable, cols, T, "#d8fbff");
    if (s.wait > 0) { // serve: the ball fades in and a ring closes in on it, no blinking
      ctx.globalAlpha = 1 - s.wait / SERVE;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + (s.wait / SERVE) * 12 * T, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawBall(ctx, ball, "#ffd84d");
    ctx.globalAlpha = 1;
    drawFx(ctx, f, T);
    text(ctx, `${s.pts[0]}`, W * 0.25, 7 * T, 6 * T);
    text(ctx, `${s.pts[1]}`, W * 0.75, 7 * T, 6 * T);
    text(ctx, `rally ${s.rally} · longest ${s.score}${best ? ` · best ${best}` : ""} · first to ${WIN}`, W / 2, H - 2 * T, 1.8 * T, 0.85);
    if (s.over) {
      text(ctx, `${s.pts[0] > s.pts[1] ? "Left" : "Right"} side wins ${Math.max(...s.pts)}–${Math.min(...s.pts)}!`, W / 2, H * 0.42, 5 * T);
      text(ctx, `longest rally ${s.score}${s.score > 0 && s.score >= best ? " · new best!" : ""} · R = again · Esc = menu`, W / 2, H * 0.42 + 5 * T, 2.2 * T);
    } else if (s.frames < 180) text(ctx, "Block the ball with your shadow: left side vs right side", W / 2, H * 0.3, 3.5 * T, Math.min(1, (180 - s.frames) / 40));
  }

  return { step, draw, state: s, ball };
}

export const pong: GameDef = {
  id: "pong",
  title: "Shadow Pong",
  sub: "Two sides, one slow ball: block it with your shadow · first to 7",
  hint: "Left half vs right half · step out of the light for the countdown · R again · M mute",
  input: "shadow",
  create: (env) => createPong(env.cols, env.rows, env.T, env.level?.solid ?? null, env.rand, env.best),
};
