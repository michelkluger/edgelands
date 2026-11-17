// Hide & Seek: critters hide beside the room's real features (door frame, light switch, corners), only a tail or two eyes
// peeking out. Cover one with your shadow for half a second to find it. 60 s, no penalties: made for small children.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { COLORS, createFx, createWorld, drawCritter, drawEyes, drawHalo, drawText, edgeMap, type Walker } from "./walker";

export const ROUND = 60 * 60;
const HIDERS = 4, FIND = 30, REACH = 5; // FIND: steps under the shadow (0.5 s) · REACH: generous hit radius in tiles
const SCURRY = 1.2; // px per step when sneaking to a new spot: slow enough to follow

type Hider = { x: number; y: number; spot: number; side: number; tail: boolean; color: string; cover: number; t: number; hideFor: number; to: number; fade: number };

export function createSeek(env: Env) {
  const { cols, rows, T, rand } = env, edge = edgeMap(env), w = createWorld(cols, rows, T, edge);
  // hiding spots: tiles of each edge cluster (about one per 30 tiles), spread out, clear of the HUD and the beam's border
  const spots: [number, number][] = [];
  const add = (c: number, r: number) => c >= 4 && c < cols - 4 && r >= 8 && r < rows - 4 && spots.every(([a, b]) => Math.hypot(a - c, b - r) >= 12) && spots.push([c, r]);
  const seen = new Uint8Array(cols * rows);
  for (let t0 = 0; t0 < edge.length; t0++) {
    if (!edge[t0] || seen[t0]) continue;
    const comp = [t0];
    seen[t0] = 1;
    for (let i = 0; i < comp.length; i++)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = (comp[i] % cols) + dc, r = Math.floor(comp[i] / cols) + dr, n = r * cols + c;
          if (c >= 0 && r >= 0 && c < cols && r < rows && edge[n] && !seen[n]) (seen[n] = 1), comp.push(n);
        }
    for (let n = 0; n <= comp.length / 30; n++) {
      const t = comp[Math.floor(rand() * comp.length)];
      add(t % cols, Math.floor(t / cols));
    }
  }
  for (let i = 0; spots.length < 8 && i < 500; i++) add(4 + Math.floor(rand() * (cols - 8)), 8 + Math.floor(rand() * (rows - 12)));

  const hiders: Hider[] = [], runners: (Walker & { color: string })[] = [], fx = createFx(rand, T);
  const s = { events: [] as GameEvent[], over: false, score: 0, best: env.best, frames: 0, hiders, runners, spots };
  const at = (i: number, side: number) => [(spots[i][0] + side * 1.5) * T + T / 2, spots[i][1] * T + T / 2]; // beside the edge tile
  const freeSpot = () => {
    const free = spots.map((_, i) => i).filter((i) => hiders.every((h) => h.spot !== i && h.to !== i));
    return free[Math.floor(rand() * free.length)];
  };
  const hide = () => {
    const spot = freeSpot(), side = rand() < 0.5 ? -1 : 1, [x, y] = at(spot, side);
    hiders.push({ x, y, spot, side, tail: rand() < 0.5, color: COLORS[Math.floor(rand() * COLORS.length)], cover: 0, t: 0, hideFor: 600 + rand() * 360, to: -1, fade: 0 });
  };
  for (let i = 0; i < HIDERS; i++) hide();

  const covered = (mask: Uint8Array, x: number, y: number) => {
    const c0 = Math.floor(x / T), r0 = Math.floor(y / T);
    for (let r = r0 - REACH; r <= r0 + REACH; r++)
      for (let c = c0 - REACH; c <= c0 + REACH; c++) if (r >= 0 && c >= 0 && r < rows && c < cols && mask[r * cols + c]) return true;
    return false;
  };

  function step(f: Frame) {
    s.events = [];
    fx.step();
    if (s.over) return;
    s.frames++;
    w.sense(f.mask);
    for (let i = runners.length - 1; i >= 0; i--) if ((w.step(runners[i]), runners[i].t > 240)) runners.splice(i, 1);
    for (let i = hiders.length - 1; i >= 0; i--) {
      const h = hiders[i];
      h.fade = Math.min(1, h.fade + 1 / 60);
      h.t++;
      // shadow over it: count up; a flickering mask only slows the count, never resets it
      h.cover = h.fade === 1 && f.mask && covered(f.mask, h.x, h.y) ? h.cover + 1 : Math.max(0, h.cover - 1);
      if (h.cover >= FIND) {
        hiders.splice(i, 1);
        s.score++, s.events.push("coin");
        fx.burst(h.x, h.y, h.color, 20), fx.burst(h.x, h.y, "#ffffff", 10), fx.ring(h.x, h.y, "#ffd166");
        const k = w.spawn(Math.floor(h.x / T), Math.floor(h.y / T) + 1, h.side);
        runners.push({ ...k, ground: false, vy: -4, color: h.color }); // a hop for joy, then it runs off
        hide();
      } else if (h.to >= 0) { // sneaking to its new spot
        const [tx, ty] = at(h.to, h.side), d = Math.hypot(tx - h.x, ty - h.y);
        if (d <= SCURRY) (h.x = tx), (h.y = ty), (h.spot = h.to), (h.to = -1), (h.t = 0);
        else (h.x += ((tx - h.x) / d) * SCURRY), (h.y += ((ty - h.y) / d) * SCURRY);
      } else if (h.t > h.hideFor && h.cover === 0) h.to = freeSpot() ?? -1;
    }
    if (s.frames >= ROUND) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null) {
    const W = cols * T, H = rows * T, f = s.frames;
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    drawHalo(ctx, mask, cols, T);
    for (const h of hiders) {
      if (h.to >= 0) {
        const tx = at(h.to, h.side)[0];
        drawCritter(ctx, h.x, h.y + T + Math.abs(Math.sin(h.t / 6)) * -T, tx < h.x ? -1 : 1, h.color, h.t, T, 1.8);
        continue;
      }
      ctx.globalAlpha = 0.75 * h.fade; // a faint, steady tell-tale
      if (h.tail) {
        ctx.strokeStyle = ctx.fillStyle = h.color;
        ctx.lineWidth = T;
        ctx.lineCap = "round";
        const ex = h.x + h.side * 2.5 * T, ey = h.y - 1.5 * T + Math.sin(h.t / 50) * 0.4 * T; // a slow sway, not a blink
        ctx.beginPath();
        ctx.moveTo(h.x, h.y + T), ctx.quadraticCurveTo(h.x + h.side * 2.5 * T, h.y + T, ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 1.1 * T, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineCap = "butt";
      } else drawEyes(ctx, h.x, h.y, h.side, T);
      ctx.globalAlpha = 1;
      if (h.cover > 0) { // progress ring, wide enough to sit on the wall around the shadow
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(h.x, h.y, (REACH + 2) * T, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * h.cover) / FIND);
        ctx.stroke();
      }
    }
    for (const k of runners) {
      ctx.globalAlpha = Math.min(1, (240 - k.t) / 60);
      drawCritter(ctx, k.x, k.y, k.dir, k.color, k.t, T, 2, k.t < 50);
    }
    ctx.globalAlpha = 1;
    fx.draw(ctx);
    const left = Math.max(0, Math.ceil((ROUND - f) / 60));
    const hud = `${s.score} found   ${left}s${s.best ? `   best ${s.best}` : ""}`;
    if (s.over) drawText(ctx, W, H, T, hud, 3 * T, `${s.score} found!${s.score > 0 && s.score >= s.best ? " · new best!" : ""}`, "R = again · Esc = menu");
    else drawText(ctx, W, H, T, hud, 3 * T, "Critters are hiding! Cover them with your shadow to find them", "", Math.max(0, Math.min(1, (240 - f) / 40)));
  }

  return { step, draw, state: s };
}

export const seek: GameDef = {
  id: "seek",
  title: "Hide & Seek",
  sub: "Find the hiding critters with your shadow · 60 s",
  hint: "Step out of the light for the 3 s countdown · R again · M mute",
  input: "shadow",
  create: createSeek,
};
