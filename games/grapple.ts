// Grapple: swing from the room's real edges to an exit high up on the far side. Hold Space to shoot a rope up-forward and
// hang on, let go to fly. Touching the floor sends you back to where you last grabbed. Fastest time wins.
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { edgeLayer, effects, grid, keys, ledges, say, slide } from "./kit";

export const G = 0.3, RUN = 2.2, AIR = 0.08, PUMP = 0.1, REEL = 1.5, AIM = Math.PI / 3; // px/frame(²); AIM: rope elevation

export function createGrapple(env: Env) {
  const g = grid(env), { cols, rows, T, W, H } = g, rand = env.rand;
  const spots = ledges(g, 4);
  const sky = spots.length < 3; // almost no edges: the rope catches the top of the beam instead, from anywhere
  const REACH = sky ? 2 * H : 0.32 * H; // rope length: about a third of the wall, whatever the room's size
  const high = spots.filter(([, r]) => r < rows * 0.4 && r >= 8); // not so high that the door leaves the beam
  const pool = high.length ? high : [...spots].sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(spots.length / 4));
  const [ec, er] = pool.length ? pool[Math.floor(rand() * pool.length)] : [Math.round(cols * 0.85), Math.round(rows * 0.3)];
  const exit = { x: ec * T + T / 2, y: er * T - T };
  // The floor is the bottom band of the wall: the beam's bottom, or a baseboard edge just above it (stand on that, not under it).
  const FLOOR = Math.ceil(rows * 0.85);
  const floorRow = (c: number) => Array.from({ length: rows - FLOOR }, (_, k) => FLOOR + k).find((r) => g.edge(c, r)) ?? rows;
  // start on the floor on the far side from the exit, in the first column with open wall around and above it
  const open = (c: number) => {
    for (let dc = -3; dc <= 3; dc++) for (let k = 1; k <= 10; k++) if (g.edge(c + dc, floorRow(c) - k)) return false;
    return true;
  };
  const order = Array.from({ length: Math.floor(cols / 2) - 4 }, (_, i) => (exit.x > W / 2 ? 4 + i : cols - 5 - i));
  const sc = order.find(open) ?? order[0];
  const start = { x: sc * T + T / 2, y: floorRow(sc) * T - 0.01 };

  const p = { x: start.x, y: start.y, vx: 0, vy: 0 };
  const s = {
    p, exit, face: exit.x > start.x ? 1 : -1, rope: null as null | { x: number; y: number; len: number }, miss: 0,
    check: null as null | { x: number; y: number }, hover: 0, frames: 0, falls: 0, over: false, score: 0, events: [] as GameEvent[],
  };
  const fx = effects(rand), edges = edgeLayer(g, "#b388ff");

  /** The rope's target: the first edge tile along rays fanning out from the aim direction (closest to the aim first). */
  function target() {
    for (let k = 0; k <= 24; k++) {
      const a = AIM + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05, dx = s.face * Math.cos(a), dy = -Math.sin(a);
      for (let d = T; d <= REACH; d += T / 2) {
        const c = Math.floor((p.x + dx * d) / T), r = Math.floor((p.y - T + dy * d) / T);
        if (c < 0 || c >= cols) break;
        if (r < 0) {
          if (sky) return { x: c * T + T / 2, y: 0 };
          break;
        }
        if (g.edge(c, r)) return { x: c * T + T / 2, y: r * T + T / 2 };
      }
    }
    return null;
  }

  function step(f: Frame) {
    s.events = [];
    fx.step();
    if (s.over) return;
    s.frames++;
    const L = keys(f.held, "ArrowLeft", "KeyA"), R = keys(f.held, "ArrowRight", "KeyD");
    if (L !== R) s.face = R ? 1 : -1;
    if (f.pressed.has("Space") && !s.rope) {
      const t = target();
      if (t) {
        s.rope = { ...t, len: Math.max(2 * T, Math.hypot(p.x - t.x, p.y - T - t.y)) };
        if (p.y < FLOOR * T) s.check = { x: p.x, y: p.y }; // free air within reach of this anchor: where a fall brings you back
        (s.hover = 0), s.events.push("shoot");
      } else s.miss = 20;
    }
    if (!f.held.has("Space")) s.rope = null;
    s.miss = Math.max(0, s.miss - 1);
    if (s.hover > 0) { // just respawned: wait in the air for the next rope (or a step)
      s.hover = L || R ? 0 : s.hover - 1;
      return;
    }
    const ground = g.wall(Math.floor(p.x / T), Math.floor((p.y + 1) / T));
    const rope = s.rope;
    if (rope) {
      const dx = p.x - rope.x, dy = p.y - T - rope.y, d = Math.hypot(dx, dy) || 1;
      if (L !== R) { // push along the swing, toward the held side
        const flip = -dy * (R ? 1 : -1) < 0 ? -1 : 1;
        (p.vx += (flip * -dy * PUMP) / d), (p.vy += (flip * dx * PUMP) / d);
      }
      if (keys(f.held, "ArrowUp", "KeyW")) rope.len = Math.max(2 * T, rope.len - REEL);
      if (keys(f.held, "ArrowDown", "KeyS")) rope.len = Math.min(REACH, rope.len + REEL);
    } else if (ground) p.vx = L !== R ? (R ? RUN : -RUN) : p.vx * 0.7;
    else p.vx = Math.max(-8, Math.min(8, p.vx + (L !== R ? (R ? AIR : -AIR) : 0)));
    p.vy += G;
    const vy = p.vy, hit = slide(p, T, g.wall);
    if (hit.hitX) p.vx = 0;
    if (hit.hitY) (p.vy = 0), vy > 6 && s.events.push("land");
    if (rope) { // the rope: never longer than its length; the outward part of the velocity goes
      const dx = p.x - rope.x, dy = p.y - T - rope.y, d = Math.hypot(dx, dy);
      if (d > rope.len) {
        const nx = dx / d, ny = dy / d, x = rope.x + nx * rope.len, y = rope.y + T + ny * rope.len;
        if (!g.wall(Math.floor(x / T), Math.floor(y / T))) (p.x = x), (p.y = y);
        const out = p.vx * nx + p.vy * ny;
        if (out > 0) (p.vx -= out * nx), (p.vy -= out * ny);
      }
    }
    if (s.check && !s.rope && hit.hitY && vy > 0 && p.y >= FLOOR * T) { // landed on the floor: back to the last grab
      Object.assign(p, { ...s.check, vx: 0, vy: 0 });
      (s.rope = null), (s.hover = 90), s.falls++;
      fx.ring(p.x, p.y - T, "#ff6e9c");
      s.events.push("ouch");
    }
    if (Math.hypot(p.x - exit.x, p.y - T - exit.y) < 4 * T) {
      (s.over = true), (s.score = Math.round(s.frames / 6) / 10);
      fx.ring(exit.x, exit.y, "#00ff88", 1.5);
      fx.burst(exit.x, exit.y, "#00ff88", 50, 4);
      s.events.push("win");
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    edges.draw(ctx);
    const f = s.frames;
    ctx.strokeStyle = ctx.shadowColor = "#00ff88"; // exit: an arched door on its ledge
    ctx.shadowBlur = 10 + 8 * Math.sin(f / 30);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(exit.x - 2 * T, exit.y - 4 * T, 4 * T, 5 * T, [2 * T, 2 * T, 2, 2]);
    ctx.stroke();
    ctx.shadowBlur = 0;
    say(ctx, "EXIT", exit.x, exit.y - 5 * T, 1.6 * T, "#00ff88", true);
    const hx = p.x, hy = p.y - T; // the hand
    if (s.rope) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy), ctx.lineTo(s.rope.x, s.rope.y);
      ctx.stroke();
    } else if (!s.over) { // where the rope would catch
      const t = target();
      ctx.strokeStyle = t ? "rgba(255,255,255,0.5)" : "rgba(255,110,156,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (t) ctx.arc(t.x, t.y, T, 0, Math.PI * 2);
      else ctx.moveTo(hx, hy), ctx.lineTo(hx + s.face * Math.cos(AIM) * 4 * T, hy - Math.sin(AIM) * 4 * T);
      ctx.stroke();
      if (s.miss) { // a rope that found nothing: a short fading strand
        ctx.globalAlpha = s.miss / 20;
        ctx.beginPath();
        ctx.moveTo(hx, hy), ctx.lineTo(hx + s.face * Math.cos(AIM) * REACH, hy - Math.sin(AIM) * REACH);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = ctx.shadowColor = s.hover ? "#ff6e9c" : "#28e0ff"; // the swinger: a glowing body and head
    ctx.shadowBlur = 14;
    ctx.fillRect(p.x - 0.6 * T, p.y - 2.2 * T, 1.2 * T, 2.2 * T);
    ctx.beginPath();
    ctx.arc(p.x, p.y - 2.9 * T, 0.7 * T, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    fx.draw(ctx, T);
    say(ctx, `${(f / 60).toFixed(1)} s   ·   falls ${s.falls}${env.best ? `   ·   best ${env.best.toFixed(1)} s` : ""}`, W / 2, 3 * T, 2 * T, "rgba(255,255,255,0.85)");
    if (s.over) {
      say(ctx, `Out in ${s.score.toFixed(1)} s${!env.best || s.score < env.best ? " · new best!" : ""}`, W / 2, H * 0.4, 5 * T, "#00ff88", true);
      say(ctx, "R = again · Esc = menu", W / 2, H * 0.4 + 5 * T, 2.2 * T);
    } else if (f < 240 && !s.check) say(ctx, "Hold Space: rope up-forward · ←/→ direction and swing · ↑/↓ reel · let go to fly · reach the EXIT", W / 2, H * 0.3, 2.3 * T);
  }

  return { step, draw, state: s, grid: g };
}

export const grapple: GameDef = {
  id: "grapple",
  title: "Grapple",
  sub: "Swing from your room's edges to the exit high up · fastest time",
  hint: "Hold Space rope · ←/→ direction & swing · ↑/↓ reel · R again",
  input: "keys",
  lowerIsBetter: true,
  create: createGrapple,
};
