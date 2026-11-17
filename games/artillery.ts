// Wall Artillery: two cannons on the room's real ledges take turns firing through the wind. Shots blast holes in the edges,
// a cannon that loses its ground falls. 3 hits win.
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { type Aim, G, drawAim, fly, launch, steer } from "./aim";
import { type Body, edgeLayer, effects, floorAt, grid, ledges, say, slide } from "./kit";

export const HP = 3, BLAST = 3, REACH = 5; // hits to lose; tiles blasted; damage reach in tiles
const COLORS = ["#00e5ff", "#ff9d00"];

/** Distance from point p to the segment a→b: a fast shot moves more than a cannon's width per frame. */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
};

export function createArtillery(env: Env) {
  const g = grid(env), { cols, T, W, H } = g, rand = env.rand;
  const spots = ledges(g, 4);
  const place = (lo: number, hi: number, fallback: number): Body => {
    const pool = spots.filter(([c]) => c >= cols * lo && c < cols * hi);
    const [c, r] = pool.length ? pool[Math.floor(rand() * pool.length)] : floorAt(g, Math.round(cols * fallback));
    return { x: c * T + T / 2, y: r * T - 0.01, vx: 0, vy: 0 };
  };
  const cannons = [place(0.03, 0.35, 0.12), place(0.65, 0.97, 0.88)].map((b, n) => ({ ...b, hp: HP, color: COLORS[n], aim: { a: n ? Math.PI * 0.75 : Math.PI * 0.25, power: 12 } as Aim }));
  type Cannon = (typeof cannons)[number];
  const s = { cannons, turn: 0, phase: "aim" as "aim" | "fly" | "settle", t: 0, shot: null as Body | null, shots: 0, wind: 0, winner: -1, over: false, score: 0, events: [] as GameEvent[] };
  const fx = effects(rand), edges = edgeLayer(g, "#1fd67a");
  const newWind = () => (s.wind = Math.round((rand() * 2 - 1) * 30) / 1000); // ±0.03 px/frame²: drifts a long shot by up to ~10 tiles
  newWind();
  const muzzle = (k: Cannon) => [k.x + Math.cos(k.aim.a) * 2.6 * T, k.y - T - Math.sin(k.aim.a) * 2.6 * T] as const;
  const shotWall = (c: number, r: number) => r >= g.rows || g.edge(c, r); // the sides are open: a wide shot is lost

  function blast(x: number, y: number) {
    const c0 = Math.floor(x / T), r0 = Math.floor(y / T);
    for (let r = r0 - BLAST; r <= r0 + BLAST; r++)
      for (let c = c0 - BLAST; c <= c0 + BLAST; c++) if (g.edge(c, r) && Math.hypot(c - c0, r - r0) <= BLAST) g.solid[r * cols + c] = 0;
    edges.dirty();
    fx.ring(x, y, "#ffb74d", 1.2);
    fx.burst(x, y, "#ffd180", 30, 4);
    s.events.push("stomp");
    for (const k of cannons)
      if (k.hp > 0 && Math.hypot(k.x - x, k.y - T - y) <= REACH * T) {
        k.hp--;
        fx.burst(k.x, k.y - T, k.color, 40, 5);
        s.events.push("ouch");
      }
  }

  function step(f: Frame) {
    s.events = [];
    fx.step();
    for (const k of cannons) { // no ground below: fall
      const v = (k.vy += G);
      if (slide(k, T, g.wall).hitY) (k.vy = 0), v > 3 && s.events.push("land");
    }
    if (s.over) return;
    s.t++;
    const k = cannons[s.turn];
    if (s.phase === "aim" && steer(k.aim, f)) {
      s.shot = launch(...muzzle(k), k.aim);
      (s.phase = "fly"), (s.t = 0), s.shots++;
      s.events.push("shoot");
    } else if (s.phase === "fly") {
      const b = s.shot!, x0 = b.x, y0 = b.y, hit = fly(b, s.wind, T, shotWall);
      const struck = cannons.some((c) => (c !== k || s.t > 20) && segDist(c.x, c.y - T, x0, y0, b.x, b.y) < 1.6 * T);
      if (hit.hitX || hit.hitY || struck || b.x < -4 * T || b.x > W + 4 * T) {
        if (b.x >= 0 && b.x <= W) blast(b.x, b.y);
        (s.shot = null), (s.phase = "settle"), (s.t = 0);
      }
    } else if (s.phase === "settle" && s.t > 50 && cannons.every((c) => c.vy === 0)) {
      if (cannons.some((c) => c.hp <= 0)) {
        const alive = cannons.filter((c) => c.hp > 0);
        s.winner = alive.length ? cannons.indexOf(alive[0]) : 1 - s.turn; // both down: the shooter blew themselves up
        (s.over = true), (s.score = cannons[s.winner].hp);
        s.events.push("win");
      } else (s.turn = 1 - s.turn), (s.phase = "aim"), newWind();
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    edges.draw(ctx);
    // wind: an arrow at the top, length ∝ strength
    const wx = W / 2, wy = 7 * T, len = (s.wind / 0.03) * 10 * T;
    ctx.strokeStyle = "#b0bec5";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx - len, wy), ctx.lineTo(wx + len, wy);
    if (Math.abs(len) > T) ctx.moveTo(wx + len - Math.sign(len) * 1.5 * T, wy - T), ctx.lineTo(wx + len, wy), ctx.lineTo(wx + len - Math.sign(len) * 1.5 * T, wy + T);
    ctx.stroke();
    say(ctx, s.wind ? `wind ${Math.abs(s.wind * 1000).toFixed(0)}` : "no wind", wx, wy + 3 * T, 1.6 * T, "#b0bec5");
    cannons.forEach((k, n) => {
      const active = !s.over && n === s.turn;
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = k.hp > 0 ? k.color : "#555";
      ctx.shadowBlur = active ? 14 + 6 * Math.sin(s.t / 30) : 6; // a slow breathing glow on whoever's turn it is
      ctx.lineWidth = 0.8 * T;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(k.x, k.y - T), ctx.lineTo(...muzzle(k));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(k.x, k.y, 1.6 * T, Math.PI, 0);
      ctx.fill();
      ctx.shadowBlur = 0;
      for (let h = 0; h < HP; h++) { // hit points
        ctx.globalAlpha = h < k.hp ? 1 : 0.25;
        ctx.beginPath();
        ctx.arc(k.x + (h - 1) * 1.6 * T, k.y - 4.6 * T, 0.5 * T, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      say(ctx, `P${n + 1}`, k.x, k.y - 6 * T, 1.6 * T, k.color, true);
      if (active && s.phase === "aim") {
        drawAim(ctx, ...muzzle(k), k.aim, s.wind, k.color);
        say(ctx, `${Math.round((k.aim.a * 180) / Math.PI)}° · power ${Math.round(k.aim.power)}`, k.x, k.y - 8 * T, 1.5 * T, k.color);
      }
    });
    if (s.shot) {
      ctx.fillStyle = ctx.shadowColor = "#fff";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.shot.x, s.shot.y, 0.5 * T, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    fx.draw(ctx, T);
    const [a, b] = cannons;
    say(ctx, `P1 ${"♥".repeat(Math.max(0, a.hp))}   ·   P2 ${"♥".repeat(Math.max(0, b.hp))}${env.best ? `   ·   best win ${env.best}♥ left` : ""}`, W / 2, 3 * T, 2 * T, "rgba(255,255,255,0.85)");
    if (s.over) {
      say(ctx, `P${s.winner + 1} wins!`, W / 2, H * 0.4, 5 * T, cannons[s.winner].color, true);
      say(ctx, "R = again · Esc = menu", W / 2, H * 0.4 + 5 * T, 2.2 * T);
    } else if (!s.shots)
      say(ctx, "←/→ aim · ↑/↓ power · Space fire (A D W S work too)", W / 2, H * 0.3, 2.4 * T);
  }

  return { step, draw, state: s, grid: g };
}

export const artillery: GameDef = {
  id: "artillery",
  title: "Wall Artillery",
  sub: "Two cannons on your shelves, wind, and edges that blow apart · 3 hits",
  hint: "Your turn: ←/→ aim · ↑/↓ power · Space fire · R again",
  input: "keys",
  create: createArtillery,
};
