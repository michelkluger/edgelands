// Light Cycles: two riders leave glowing trails on the tile grid; the room's edges, the beam border and both trails are
// walls. First to crash loses the round, first to 5 rounds wins.
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { edgeLayer, effects, grid, say } from "./kit";

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left
const KEYS = [["KeyW", "KeyD", "KeyS", "KeyA"], ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"]];
const COLORS = ["#00e5ff", "#ff4fd8"];
export const STEP = 3, COUNT = 120, PAUSE = 150, WIN = 5; // frames per tile, countdown, after a crash; rounds to win

export function createCycles(env: Env) {
  const g = grid(env), { cols, rows, T } = g, rand = env.rand;
  const occ = new Uint8Array(cols * rows); // trails
  const blocked = (c: number, r: number) => c < 0 || r < 0 || c >= cols || r >= rows || g.solid[r * cols + c] === 1 || occ[r * cols + c] === 1;
  const run = (c: number, r: number, d: number) => {
    let n = 0;
    while (n < 60 && !blocked(c + DIRS[d][0] * (n + 1), r + DIRS[d][1] * (n + 1))) n++;
    return n;
  };

  // clearance: 4-connected steps from each free tile to the nearest edge or the border, so riders start in open space
  const clear = new Int16Array(cols * rows).fill(-1), queue: number[] = [];
  for (let i = 0; i < clear.length; i++) if (g.solid[i]) (clear[i] = 0), queue.push(i);
  for (let i = 0; i < clear.length; i++) {
    const c = i % cols, r = (i - c) / cols;
    if (clear[i] < 0 && (c === 0 || r === 0 || c === cols - 1 || r === rows - 1)) (clear[i] = 1), queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], c = i % cols, r = (i - c) / cols;
    for (const [dc, dr] of DIRS) {
      const cc = c + dc, rr = r + dr, n = rr * cols + cc;
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && clear[n] < 0) (clear[n] = clear[i] + 1), queue.push(n);
    }
  }
  const apart = (i: number, j: number) => Math.hypot((i % cols) - (j % cols), Math.floor(i / cols) - Math.floor(j / cols));
  const maxClear = clear.reduce((m, v) => Math.max(m, v), 0);
  const open = Array.from(clear.keys()).filter((i) => clear[i] >= Math.min(8, maxClear) && clear[i] > 0);

  const riders = [0, 1].map((n) => ({ c: 0, r: 0, d: 0, next: 0, trail: [] as number[], color: COLORS[n], wins: 0, dead: false }));
  const s = { riders, round: 0, phase: "count" as "count" | "ride" | "end", t: 0, ride: 0, over: false, score: 0, events: [] as GameEvent[] };
  const fx = effects(rand);

  function newRound() {
    occ.fill(0);
    s.round++, (s.phase = "count"), (s.t = 0), (s.ride = 0);
    const left = open.filter((i) => i % cols < cols / 2), pool = left.length ? left : open;
    const a = pool[Math.floor(rand() * pool.length)];
    let b = a;
    for (let k = 0; k < 400; k++) { // the farthest of a few hundred random open tiles
      const i = open[Math.floor(rand() * open.length)];
      if (apart(a, i) > apart(a, b)) b = i;
    }
    for (const [p, i] of [[riders[0], a], [riders[1], b]] as const) {
      (p.c = i % cols), (p.r = (i - p.c) / cols), (p.trail = [i]), (p.dead = false);
      occ[i] = 1;
    }
    for (const p of riders) p.d = p.next = [0, 1, 2, 3].reduce((best, d) => (run(p.c, p.r, d) > run(p.c, p.r, best) ? d : best), 0); // the longest straight
  }
  newRound();

  function step(f: Frame) {
    s.events = [];
    fx.step();
    if (s.over) return;
    s.t++;
    riders.forEach((p, n) => KEYS[n].forEach((k, d) => f.pressed.has(k) && d !== (p.d + 2) % 4 && (p.next = d)));
    if (s.phase === "count") {
      if (s.t >= COUNT) (s.phase = "ride"), (s.t = 0), s.events.push("power");
      return;
    }
    if (s.phase === "end") {
      if (s.t < PAUSE) return;
      if (riders.some((p) => p.wins >= WIN)) (s.over = true), s.events.push("win");
      else newRound();
      return;
    }
    if (s.t % STEP) return;
    const heads = riders.map((p) => ((p.d = p.next), [p.c + DIRS[p.d][0], p.r + DIRS[p.d][1]]));
    const same = heads[0][0] === heads[1][0] && heads[0][1] === heads[1][1];
    riders.forEach((p, n) => (p.dead = same || blocked(heads[n][0], heads[n][1])));
    for (const [n, p] of riders.entries()) {
      if (p.dead) {
        fx.ring(p.c * T + T / 2, p.r * T + T / 2, p.color, 1.5);
        fx.burst(p.c * T + T / 2, p.r * T + T / 2, p.color, 40, 4);
        continue;
      }
      [p.c, p.r] = heads[n];
      occ[p.r * cols + p.c] = 1;
      p.trail.push(p.r * cols + p.c);
    }
    s.ride++;
    if (riders.some((p) => p.dead)) {
      s.events.push("ouch");
      for (const p of riders) if (!p.dead) p.wins++, s.events.push("coin");
      s.score = Math.max(s.score, s.ride);
      (s.phase = "end"), (s.t = 0);
    }
  }

  const edges = edgeLayer(g, "#536dfe");
  function draw(ctx: CanvasRenderingContext2D) {
    const { W, H } = g;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    edges.draw(ctx);
    ctx.lineCap = ctx.lineJoin = "round";
    for (const p of riders) {
      ctx.beginPath();
      for (const i of p.trail) ctx.lineTo((i % cols) * T + T / 2, Math.floor(i / cols) * T + T / 2);
      ctx.strokeStyle = ctx.shadowColor = p.color;
      ctx.lineWidth = T * 0.7;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
      const x = p.c * T + T / 2, y = p.r * T + T / 2;
      ctx.fillStyle = p.dead ? p.color : "#fff";
      ctx.beginPath();
      ctx.arc(x, y, T * 0.8, 0, Math.PI * 2);
      ctx.fill();
      if (s.phase === "count") { // where you start and which way you're heading
        const [dx, dy] = DIRS[p.d];
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + dx * 2 * T, y + dy * 2 * T), ctx.lineTo(x + dx * 6 * T, y + dy * 6 * T);
        ctx.lineTo(x + dx * 4.5 * T - dy * 1.5 * T, y + dy * 4.5 * T - dx * 1.5 * T);
        ctx.moveTo(x + dx * 6 * T, y + dy * 6 * T), ctx.lineTo(x + dx * 4.5 * T + dy * 1.5 * T, y + dy * 4.5 * T + dx * 1.5 * T);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3 * T, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    fx.draw(ctx, T);
    const [a, b] = riders;
    say(ctx, `P1 ${a.wins} : ${b.wins} P2   ·   first to ${WIN}   ·   longest ride ${s.score}${env.best ? `   ·   best ${env.best}` : ""}`, W / 2, 3 * T, 2 * T, "rgba(255,255,255,0.85)");
    if (s.over) {
      const w = a.wins > b.wins ? a : b;
      say(ctx, `${w === a ? "P1" : "P2"} wins the match!`, W / 2, H * 0.42, 5 * T, w.color, true);
      say(ctx, "R = again · Esc = menu", W / 2, H * 0.42 + 5 * T, 2.2 * T);
    } else if (s.phase === "count") {
      say(ctx, `${3 - Math.floor((s.t * 3) / COUNT)}`, W / 2, H * 0.45, 8 * T, "#fff", true);
      if (s.round === 1) say(ctx, "P1: W A S D  ·  P2: arrow keys  ·  don't hit the walls or any trail", W / 2, H * 0.45 + 5 * T, 2.4 * T);
    } else if (s.phase === "end") {
      const dead = riders.filter((p) => p.dead);
      say(ctx, dead.length === 2 ? "Both crashed: no point" : `${dead[0] === a ? "P2" : "P1"} takes round ${s.round}`, W / 2, H * 0.42, 4 * T, dead.length === 2 ? "#fff" : riders.find((p) => !p.dead)!.color, true);
    }
  }

  return { step, draw, state: s, riders, occ, open };
}

export const cycles: GameDef = {
  id: "cycles",
  title: "Light Cycles",
  sub: "Two riders, glowing trails, the room's edges are walls · first to 5",
  hint: "P1 W A S D · P2 arrows · R again · M mute",
  input: "keys",
  create: createCycles,
};
