// Shadow Bridge: critters pop out high on the room's edges and walk on. Hold out an arm, a leg or your body: its shadow is
// the bridge, ramp or wall that leads them home across the gaps. Score = critters home.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { COLORS, createFx, createWorld, drawCritter, drawHalo, drawText, edgeMap, type Walker } from "./walker";

export const CRITTERS = 20, EVERY = 120; // one every 2 s
const KO = 10; // a longer fall (tiles) knocks a critter out
const LOST_AFTER = 90 * 60; // nobody paces a closed ledge forever: the round must end

export function createBridge(env: Env) {
  const { cols, rows, T, rand } = env, edge = edgeMap(env), w = createWorld(cols, rows, T, edge);
  // the door: one of the highest ledges (below the HUD line) with room to walk, facing its longer side
  const doors = w.surfaces(8, rows - 1).flatMap(([c, r]) => {
    const right = w.run(c, r, 1), left = w.run(c, r, -1);
    return Math.max(right, left) >= 8 ? [[c, r, right >= left ? 1 : -1]] : [];
  });
  const [sc, sr, sdir] = doors.length ? doors[Math.floor(rand() * Math.min(5, doors.length))] : [3, rows - 1, 1];
  // where a critter goes without help: home must be off that path, so it takes a bridge
  const path = new Set<number>(), probe = w.spawn(sc, sr, sdir);
  for (let i = 0; i < 3600 && w.step(probe) <= KO; i++) if (probe.ground) path.add(Math.round(probe.y / T) * cols + Math.floor(probe.x / T));
  const offPath = (c: number, r: number) => {
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) if (path.has((r + dr) * cols + c + dc)) return false;
    return true;
  };
  const homes = w
    .surfaces(sr - 10, sr + 31)
    .filter(([c, r]) => Math.abs(c - sc) >= 15 && w.run(c, r, 1) + w.run(c, r, -1) >= 4 && offPath(c, r))
    .sort((a, b) => Math.abs(b[0] - sc) - Math.abs(a[0] - sc));
  const [gc, gr] = homes.length ? homes[Math.floor(rand() * Math.ceil(homes.length * 0.3))] : [sc < cols / 2 ? cols - 8 : 8, rows - 1];

  const critters: (Walker & { color: string })[] = [], fx = createFx(rand, T);
  const s = { events: [] as GameEvent[], over: false, score: 0, best: env.best, saved: 0, lost: 0, spawned: 0, frames: 0 };

  function step(f: Frame) {
    s.events = [];
    fx.step();
    if (s.over) return;
    s.frames++;
    w.sense(f.mask);
    if (s.spawned < CRITTERS && s.frames % EVERY === 1) critters.push({ ...w.spawn(sc, sr, sdir), color: COLORS[s.spawned++ % COLORS.length] });
    for (let i = critters.length - 1; i >= 0; i--) {
      const k = critters[i], fell = w.step(k), c = Math.floor(k.x / T), r = Math.round(k.y / T);
      if (fell > KO || k.t > LOST_AFTER) {
        critters.splice(i, 1), s.lost++, s.events.push("ouch");
        fx.ring(k.x, k.y - T, "rgba(255,255,255,0.9)"); // soft poof
      } else if (k.ground && Math.abs(c - gc) <= 2 && Math.abs(r - gr) <= 2) {
        critters.splice(i, 1), s.saved++, s.events.push("coin");
        fx.burst(k.x, k.y - 2 * T, k.color, 16);
      }
    }
    s.score = s.saved;
    if (s.spawned === CRITTERS && !critters.length) (s.over = true), s.events.push("win");
  }

  const edgeTiles = edge.reduce<number[]>((a, v, t) => (v && a.push(t), a), []);
  function draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null) {
    const W = cols * T, H = rows * T, f = s.frames;
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,226,170,0.4)"; // the edges they walk on
    for (const t of edgeTiles) ctx.fillRect((t % cols) * T, Math.floor(t / cols) * T, T, T);
    drawHalo(ctx, mask, cols, T);
    const dx = sc * T + T / 2, dy = sr * T; // the door they come out of
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx - 2 * T, dy), ctx.lineTo(dx - 2 * T, dy - 3 * T), ctx.arc(dx, dy - 3 * T, 2 * T, Math.PI, 0), ctx.lineTo(dx + 2 * T, dy);
    ctx.fill();
    ctx.stroke();
    const hx = gc * T + T / 2, hy = gr * T; // home: a house glowing slowly
    ctx.fillStyle = ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 14 + 8 * Math.sin(f / 40);
    ctx.beginPath();
    ctx.moveTo(hx - 3 * T, hy), ctx.lineTo(hx - 3 * T, hy - 3.5 * T), ctx.lineTo(hx, hy - 6 * T), ctx.lineTo(hx + 3 * T, hy - 3.5 * T), ctx.lineTo(hx + 3 * T, hy);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = "#fff6d5";
    ctx.fillRect(hx - T, hy - 2.5 * T, 2 * T, 2.5 * T);
    for (const k of critters) drawCritter(ctx, k.x, k.y, k.dir, k.color, k.t, T, Math.min(1.5, 0.3 + k.t / 20), !k.ground);
    fx.draw(ctx);
    const hudY = sr < rows / 2 ? H - T : 3 * T; // the critters walk the high ledges: keep the score out of their way
    const hud = `${s.saved}/${CRITTERS} home   ${s.lost} lost${s.best ? `   best ${s.best}` : ""}`;
    if (s.over) drawText(ctx, W, H, T, hud, hudY, `${s.saved} of ${CRITTERS} home${s.saved > 0 && s.saved >= s.best ? " · new best!" : ""}`, "R = again · Esc = menu");
    else drawText(ctx, W, H, T, hud, hudY, "Your shadow is their bridge: lead the critters home!", "", Math.max(0, Math.min(1, (240 - f) / 40)));
  }

  return { step, draw, state: s, door: [sc, sr, sdir], home: [gc, gr], critters };
}

export const bridge: GameDef = {
  id: "bridge",
  title: "Shadow Bridge",
  sub: "Your shadow is the bridge: lead the critters home",
  hint: "Step out of the light for the 3 s countdown · R again · M mute",
  input: "shadow",
  create: createBridge,
};
