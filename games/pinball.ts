// Wall Pinball: the room's real edges are the table, its bigger edge clusters are bumpers. Fixed 60 Hz steps, projector px.
import type { GameEvent } from "../game";
import type { Frame, GameDef } from "../wall";
import { type Ball, burst, clusters, drawBall, drawFx, drawTiles, fx, hitSegment, limit, moveBall, stepFx, text, trapWatch } from "./ball";

const G = 0.18, MAX = 24, DOWN = 0.45, UP = -0.45; // flipper angles: radians below (+) / above (−) horizontal

export function createPinball(cols: number, rows: number, T: number, solid: Uint8Array | null, rand: () => number, best = 0) {
  const W = cols * T, H = rows * T, py = H - 10 * T, FL = 19 * T, laneX = W - 6 * T, gy = H * 0.55;
  const pivots = [W / 2 - 24 * T, W / 2 + 24 * T];
  // fixed rails as capsules [ax, ay, ex, ey]: funnels down to the flippers, the launch lane and its floor, corner deflectors
  const rails = [
    [0, gy, pivots[0], py], [laneX, gy, pivots[1], py], [laneX, H * 0.35, laneX, H], [laneX, H - 2 * T, W, H - 2 * T],
    [W - 16 * T, 0, W, 16 * T], [0, 16 * T, 16 * T, 0],
  ];
  // room edges under the funnels, around the flippers or in the lane can't be played (or would jam the flippers): drop them
  const floorY = (x: number) => x < pivots[0] ? gy + (x / pivots[0]) * (py - gy) : x < pivots[1] ? py - 12 * T : py + ((x - pivots[1]) / (laneX - pivots[1])) * (gy - py);
  const usable = (solid ?? new Uint8Array(cols * rows)).map((v, i) => {
    const x = (i % cols) * T + T / 2;
    return v && x < laneX - 2 * T && Math.floor(i / cols) * T + T / 2 < floorY(x) - 3 * T ? 1 : 0;
  });
  // bumpers: the 4 biggest clusters that still look like objects, at most 20 tiles across (a wall-long line would make a huge bumper)
  const bumper = new Int32Array(cols * rows).fill(-1);
  const span = (k: number[], f: (t: number) => number) => Math.max(...k.map(f)) - Math.min(...k.map(f));
  const bumpers = clusters(usable, cols, rows)
    .filter((k) => k.length >= 5 && span(k, (t) => t % cols) <= 20 && span(k, (t) => Math.floor(t / cols)) <= 20)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
  bumpers.forEach((k, id) => k.forEach((t) => (bumper[t] = id)));
  const lit = new Float32Array(bumpers.length), f = fx(), angle = [DOWN, DOWN];
  const ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, r: 1.2 * T };
  const s = { score: 0, balls: 3, charge: 0, over: false, events: [] as GameEvent[], frames: 0 };
  const trapped = trapWatch(T);
  const reset = () => Object.assign(ball, { x: W - 3 * T, y: H - 2.5 * T - ball.r, vx: 0, vy: 0 });
  reset();

  const wall = (c: number, r: number) => c < 0 || c >= cols || r < 0 || (r < rows && usable[r * cols + c] === 1);
  const tip = (i: number, a = angle[i]) => [pivots[i] + (i ? -1 : 1) * FL * Math.cos(a), py + FL * Math.sin(a)];

  function step({ held }: Frame) {
    s.events = [];
    stepFx(f);
    for (let i = 0; i < lit.length; i++) lit[i] = Math.max(0, lit[i] - 1 / 30);
    if (s.over) return;
    s.frames++;
    const up = [held.has("ShiftLeft") || held.has("ArrowLeft"), held.has("ShiftRight") || held.has("ArrowRight")];
    const from = angle.slice(), to = angle.map((a, i) => (up[i] ? Math.max(UP, a - 0.22) : Math.min(DOWN, a + 0.15)));
    const inLane = ball.x > laneX;
    if (inLane && held.has("Space")) s.charge = Math.min(1, s.charge + 1 / 60); // hold to pull the plunger, let go to shoot
    else if (s.charge) {
      if (inLane) (ball.vy = -(12 + 12 * s.charge)), s.events.push("power");
      s.charge = 0;
    }
    ball.vy += G;
    // the flippers swing in step with the ball's substeps, so a fast flipper can't skip past it
    const sweep = Math.max(...to.map((a, i) => Math.abs(a - from[i]))) * FL;
    const hits = moveBall(ball, T, wall, 0.6, (b, k, n) => {
      for (const [ax, ay, ex, ey] of rails) hitSegment(b, ax, ay, ex, ey, T / 2, 0.4);
      for (const i of [0, 1]) {
        angle[i] = from[i] + ((to[i] - from[i]) * (k + 1)) / n;
        const [ex, ey] = tip(i);
        hitSegment(b, pivots[i], py, ex, ey, 0.8 * T, 0.3, (i ? -1 : 1) * (to[i] - from[i]));
      }
    }, Math.ceil(sweep / (T / 2)) + 1);
    for (const h of hits) {
      const id = bumper[h.r * cols + h.c];
      if (id >= 0 && h.v > 1) { // a bumper kicks the ball away and scores
        const sp = Math.hypot(ball.vx, ball.vy) || 1;
        ball.vx += (ball.vx / sp) * 5;
        ball.vy += (ball.vy / sp) * 5;
        s.score += 25;
        lit[id] = 1;
        s.events.push("coin");
        burst(f, rand, ball.x, ball.y, "#ff4fd8", 10);
        break; // one kick per step, however many of its tiles the ball touched
      } else if (h.v > 3) s.score += 1;
    }
    limit(ball, 0, MAX);
    // caught in a pocket of edges or resting on a ledge: kick it out (but let a ball sit on a raised flipper)
    if (trapped(ball) > 90 && !inLane && ball.y < py - 14 * T) (ball.vx = (rand() - 0.5) * 8), (ball.vy = -9);
    if (ball.y > H + ball.r) {
      s.balls--;
      s.events.push("ouch");
      f.rings.push({ x: ball.x, y: H - T, t: 0, color: "#ff8a80" });
      if (s.balls) reset();
      else (s.over = true), s.events.push("win");
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    drawTiles(ctx, usable.map((v, t) => (v && bumper[t] < 0 ? 1 : 0)), cols, T, "#28e0ff");
    bumpers.forEach((k, id) => { // brighter and bigger for a moment after a hit: fades, never blinks
      ctx.shadowBlur = 10 + 20 * lit[id];
      ctx.fillStyle = ctx.shadowColor = lit[id] > 0 ? "#ffe0f6" : "#ff4fd8";
      ctx.beginPath();
      for (const t of k) ctx.rect((t % cols) * T - lit[id] * 2, Math.floor(t / cols) * T - lit[id] * 2, T + lit[id] * 4, T + lit[id] * 4);
      ctx.fill();
    });
    ctx.lineCap = "round";
    ctx.strokeStyle = ctx.shadowColor = "#1fd67a";
    ctx.shadowBlur = 10;
    ctx.lineWidth = T;
    ctx.beginPath();
    for (const [ax, ay, ex, ey] of rails) ctx.moveTo(ax, ay), ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = ctx.shadowColor = "#ffd60a";
    ctx.lineWidth = 1.6 * T;
    ctx.beginPath();
    for (const i of [0, 1]) ctx.moveTo(pivots[i], py), ctx.lineTo(...(tip(i) as [number, number]));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ff9d00"; // plunger: sinks as you pull it
    ctx.fillRect(laneX + T, H - 1.5 * T + s.charge * T, W - laneX - 2 * T, T);
    drawBall(ctx, ball, "#e8f7ff");
    drawFx(ctx, f, T);
    text(ctx, `★ ${s.score}   balls ${"●".repeat(s.balls)}${best ? `   best ${best}` : ""}`, W * 0.2, H - 1.5 * T, 1.8 * T, 0.85);
    if (s.over) {
      text(ctx, `${s.score} points${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.42, 5 * T);
      text(ctx, "R = again · Esc = menu", W / 2, H * 0.42 + 5 * T, 2.2 * T);
    } else if (ball.x > laneX && ball.y > H * 0.8 && !s.charge) text(ctx, "Hold Space, let go to launch → · Shift or ← → = flippers", W / 2, H * 0.3, 2.2 * T, 0.8);
  }

  return { step, draw, state: s, ball, angle, bumpers, pivots, py };
}

export const pinball: GameDef = {
  id: "pinball",
  title: "Wall Pinball",
  sub: "Pinball on the room's edges: bumpers glow pink · 3 balls",
  hint: "Shift or ← → flippers · hold Space, release to launch · R again · M mute",
  input: "keys",
  create: (env) => createPinball(env.cols, env.rows, env.T, env.level?.solid ?? null, env.rand, env.best),
};
