// Wall Golf: chip a ball over the room's real edges into a cup on a ledge or the floor. It bounces and rolls on the edges.
// 3–5 holes, fewest strokes wins.
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { type Aim, drawAim, fly, launch, steer } from "./aim";
import { edgeLayer, effects, floorAt, grid, ledges, say } from "./kit";

export const MAX_STROKES = 10; // per hole: then the ball is picked up and the hole counts 10

export function createGolf(env: Env) {
  const g = grid(env), { cols, rows, T, W, H } = g, rand = env.rand;
  const pick = <V>(l: V[]) => l[Math.floor(rand() * l.length)];
  const tees = ledges(g, 3);
  const cups = tees.filter(([c, r]) => g.edge(c - 1, r) && g.edge(c + 1, r) && !g.edge(c - 1, r - 1) && !g.edge(c + 1, r - 1)); // flat enough to hold a cup
  // the floor where it's open above (not under a baseboard edge, where the ball would be stuck in a slot)
  const floor = Array.from({ length: 9 }, (_, k) => Math.round(cols * (0.06 + 0.11 * k)))
    .filter((c) => Array.from({ length: 12 }, (_, k) => g.edge(c, rows - 1 - k)).every((e) => !e))
    .map((c): [number, number] => [c, rows]);
  if (floor.length < 2) floor.push(floorAt(g, 4), floorAt(g, cols - 5));
  const holes = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => {
    for (let k = 0; k < 100; k++) {
      const tee = pick(rand() < 0.7 && tees.length ? tees : floor), cup = pick(rand() < 0.75 && cups.length ? cups : floor);
      if (Math.abs(tee[0] - cup[0]) > cols * 0.25) return { tee, cup };
    }
    return { tee: floor[0], cup: floor[floor.length - 1] };
  });

  const s = {
    holes, hole: 0, strokes: 0, total: 0, phase: "aim" as "aim" | "roll" | "done", t: 0, inCup: false,
    ball: { x: 0, y: 0, vx: 0, vy: 0 }, aim: { a: 0, power: 8 } as Aim, over: false, score: 0, events: [] as GameEvent[],
  };
  const fx = effects(rand), edges = edgeLayer(g, "#2bd96b");
  const cup = () => ({ x: holes[s.hole].cup[0] * T + T / 2, y: holes[s.hole].cup[1] * T });
  const tee = () => {
    const [c, r] = holes[s.hole].tee;
    s.ball = { x: c * T + T / 2, y: r * T - 0.01, vx: 0, vy: 0 };
    (s.strokes = 0), (s.phase = "aim"), (s.t = 0);
    s.aim.a = cup().x > s.ball.x ? Math.PI * 0.3 : Math.PI * 0.7;
  };
  tee();

  function step(f: Frame) {
    s.events = [];
    fx.step();
    if (s.over) return;
    s.t++;
    const b = s.ball, h = cup();
    if (s.phase === "aim" && steer(s.aim, f)) {
      Object.assign(b, launch(b.x, b.y, s.aim));
      s.strokes++, s.total++, (s.phase = "roll"), (s.t = 0);
      s.events.push("shoot");
    } else if (s.phase === "roll") {
      const hit = fly(b, 0, T, g.wall), down = hit.hitY && b.vy > 0;
      if (hit.hitX) b.vx *= -0.5;
      if (hit.hitY) {
        if (down && b.vy > 1.5) (b.vx *= 0.85), b.vy > 3 && s.events.push("land"); // a real bounce, not gravity pressing it down while it rolls
        b.vy = down && b.vy <= 1.5 ? 0 : -b.vy * 0.45;
      }
      if (down && !b.vy) b.vx *= 0.975; // rolling friction
      if (Math.hypot(b.x - h.x, b.y - h.y) < 1.3 * T && Math.hypot(b.vx, b.vy) < 5) { // slow enough to drop in
        Object.assign(b, { x: h.x, y: h.y - 0.01, vx: 0, vy: 0 });
        (s.inCup = true), (s.phase = "done"), (s.t = 0);
        fx.ring(h.x, h.y, "#ffe066", 1.2);
        fx.burst(h.x, h.y, "#ffe066", 40, 4);
        s.events.push("coin");
      } else if ((down && !b.vy && Math.abs(b.vx) < 0.05) || s.t > 900) { // at rest (or stuck rocking somewhere)
        (b.vx = b.vy = 0), (s.phase = s.strokes >= MAX_STROKES ? "done" : "aim"), (s.t = 0), (s.inCup = false);
        if (s.phase === "done") s.events.push("ouch");
      }
    } else if (s.phase === "done" && s.t > 100) {
      if (s.hole + 1 < holes.length) s.hole++, tee();
      else (s.over = true), (s.score = s.total), s.events.push("win");
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    edges.draw(ctx);
    const b = s.ball, h = cup(), [tc, tr] = holes[s.hole].tee;
    ctx.fillStyle = "rgba(255,255,255,0.35)"; // tee
    ctx.fillRect(tc * T - T / 2, tr * T - 2, 2 * T, 3);
    ctx.strokeStyle = ctx.shadowColor = "#ffe066"; // cup and flag
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(h.x - 1.4 * T, h.y), ctx.lineTo(h.x - 1.4 * T, h.y + 0.6 * T), ctx.lineTo(h.x + 1.4 * T, h.y + 0.6 * T), ctx.lineTo(h.x + 1.4 * T, h.y);
    ctx.moveTo(h.x, h.y), ctx.lineTo(h.x, h.y - 7 * T);
    ctx.stroke();
    ctx.fillStyle = "#ff4f6d";
    ctx.beginPath();
    ctx.moveTo(h.x, h.y - 7 * T), ctx.lineTo(h.x + 3 * T, h.y - 6 * T), ctx.lineTo(h.x, h.y - 5 * T);
    ctx.fill();
    if (s.phase === "aim") drawAim(ctx, b.x, b.y - 0.7 * T, s.aim, 0, "#ffffff");
    ctx.fillStyle = ctx.shadowColor = "#fff";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 0.7 * T, 0.7 * T, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    fx.draw(ctx, T);
    say(ctx, `hole ${s.hole + 1}/${holes.length}   ·   stroke ${s.strokes}   ·   total ${s.total}${env.best ? `   ·   best ${env.best}` : ""}`, W / 2, 3 * T, 2 * T, "rgba(255,255,255,0.85)");
    if (s.phase === "aim") say(ctx, `${Math.round((s.aim.a * 180) / Math.PI)}° · power ${Math.round(s.aim.power)}`, b.x, b.y - 4 * T, 1.5 * T, "#ffe066");
    if (s.over) {
      say(ctx, `${s.total} strokes over ${holes.length} holes${!env.best || s.total < env.best ? " · new best!" : ""}`, W / 2, H * 0.4, 4.5 * T, "#ffe066", true);
      say(ctx, "R = again · Esc = menu", W / 2, H * 0.4 + 5 * T, 2.2 * T);
    } else if (s.phase === "done") say(ctx, s.inCup ? `In the cup · ${s.strokes} stroke${s.strokes > 1 ? "s" : ""}` : `Picked up · ${MAX_STROKES} strokes`, W / 2, H * 0.35, 4 * T, "#ffe066", true);
    else if (s.hole === 0 && s.total === 0) say(ctx, "←/→ aim · ↑/↓ power · Space swing · get the ball into the cup under the flag", W / 2, H * 0.3, 2.4 * T);
  }

  return { step, draw, state: s, grid: g };
}

export const golf: GameDef = {
  id: "golf",
  title: "Wall Golf",
  sub: "Chip the ball over your shelves into the cup · 3–5 holes, fewest strokes",
  hint: "←/→ aim · ↑/↓ power · Space swing · R again",
  input: "keys",
  lowerIsBetter: true,
  create: createGolf,
};
