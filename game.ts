// Platformer on the mapped wall: the real edges are the platforms. Fixed 60 Hz steps, units are projector px.
import type { Level } from "./edges";

export type Input = { left: boolean; right: boolean; jump: boolean; down?: boolean }; // down = drop through a one-way edge
export type GameEvent = "jump" | "land" | "coin" | "stomp" | "ouch" | "win" | "secret" | "power" | "shoot" | "shield";
/**
 * Round-long: boots = double jump, magnet = pulls coins, shield = absorbs one hit, spring = 30% higher jumps,
 * compass = arrows to the remaining coins and the gem. Timed: speed, freeze, ghost, jetpack (hold jump to fly), slowmo.
 * Instant: bomb = clears enemies nearby, clock = -5 s.
 */
export const POWERS = {
  boots: "⇈", magnet: "🧲", shield: "🛡", spring: "🦘", compass: "🧭",
  speed: "⚡", freeze: "❄", ghost: "👻", jetpack: "🚀", slowmo: "⏳",
  bomb: "💣", clock: "⏱",
} as const;
export type Power = keyof typeof POWERS;
const POWER_FRAMES = { speed: 600, freeze: 300, ghost: 360, jetpack: 300, slowmo: 480 }; // 10 s, 5 s, 6 s, 5 s, 8 s
export const MODS = ["low gravity", "darkness", "ice", "turbo"] as const; // one random twist per round from round 2
export type Mod = (typeof MODS)[number];
type Kind = "walker" | "hopper" | "flyer" | "spark" | "turret" | "drone";
type Body = { x: number; y: number; w: number; h: number; vx: number; vy: number; ground: boolean };
type Player = Body & {
  n: number; face: number; coins: number; coyote: number; buffer: number; inv: number; prevJump: boolean; squash: number; color: string;
  boots: boolean; magnet: boolean; shield: boolean; spring: boolean; compass: boolean;
  air: number; fast: number; ghost: number; jet: number; // fast/ghost/jet: frames left
};
type Enemy = Body & { kind: Kind; dead: boolean; t: number; baseY: number; c: number; r: number; pc: number; pr: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
type Cell = { c: number; r: number }; // tile column/row in projector space
type Pickup = { x: number; y: number; taken: boolean };
/** Level design from the Haiku director (calibration/director.json). Untrusted: every field is validated or snapped. */
export type Plan = {
  name?: string;
  colors?: { edge?: string; player?: string; enemy?: string; coin?: string };
  spawn?: Cell;
  goal?: Cell;
  coins?: Cell[];
  enemies?: Cell[];
  hazards?: { c: number; r: number; w: number; h: number; label?: string }[];
};

/** Seeded random (mulberry32): the same seed rebuilds the same round, so a restart replays the same level. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};

const MAX_FALL = 7; // < tile, so nothing tunnels through a 1-tile edge
const COYOTE = 6, BUFFER = 6, INVULNERABLE = 90; // frames

export function createGame(
  level: Level,
  rand = Math.random,
  plan: Plan | null = null,
  opts: { players?: number; round?: number; mod?: Mod | null } = {},
) {
  const { tile: T, cols, rows } = level;
  const nPlayers = opts.players === 2 ? 2 : 1, round = Math.max(1, Math.floor(opts.round ?? 1));
  const mod: Mod | null = opts.mod !== undefined ? opts.mod : round === 1 ? null : MODS[Math.floor(rand() * MODS.length)];
  // px per 60 Hz frame. Normal apex ≈ JUMP²/(2·G) = 120 px = 15 tiles.
  const G = mod === "low gravity" ? 0.32 : 0.55, JUMP = mod === "low gravity" ? 9.6 : 11.5;
  const RUN = mod === "turbo" ? 4.6 : 3.6, ACCEL = mod === "ice" ? 0.18 : 0.6, FRICTION = mod === "ice" ? 0.97 : 0.75;
  const pace = (mod === "turbo" ? 1.6 : 1) * (0.8 + 0.25 * round); // enemy speed

  // Real edges are one-way platforms (land on top, pass through sideways and from below): vertical edges like door frames
  // would otherwise wall the player in. Only the added ground and side walls are hard, even where an edge overlaps them,
  // and they go on past the beam: nothing jumps or flies over a wall out of the world.
  const edge = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && level.solid[r * cols + c] === 1;
  const hard = (c: number, r: number) => c <= 0 || c >= cols - 1 || r >= rows - 1 || r < 0; // walls, ground, and a ceiling at the top of the beam (jetpacks can't leave the screen)
  const at = (c: number, r: number) => hard(c, r) || edge(c, r);
  const top = (c: number, r: number) => edge(c, r) && !edge(c, r - 1); // only the top of an edge carries weight, never the middle of a vertical line
  const under = (b: Body, r: number) => {
    for (let c = Math.floor(b.x / T); c <= Math.floor((b.x + b.w - 0.01) / T); c++) if (top(c, r)) return true;
    return false;
  };
  const hits = (b: Body) => {
    for (let r = Math.floor(b.y / T); r <= Math.floor((b.y + b.h - 0.01) / T); r++)
      for (let c = Math.floor(b.x / T); c <= Math.floor((b.x + b.w - 0.01) / T); c++) if (hard(c, r)) return true;
    return false;
  };
  /** Moves with gravity and tile collision. `drop` = row of a one-way edge to fall through. Returns true when blocked sideways. */
  const move = (b: Body, drop = -1) => {
    let blocked = false;
    b.x += b.vx;
    if (hits(b)) {
      b.x = b.vx > 0 ? Math.floor((b.x + b.w - 0.01) / T) * T - b.w : (Math.floor(b.x / T) + 1) * T;
      blocked = true;
    }
    // walking into a one-tile rise on an edge: step up, so slanted edges (staircases of tiles) are walkable
    if (b.ground && b.vx !== 0 && under(b, Math.floor((b.y + b.h - 0.01) / T))) {
      b.y -= T;
      if (hits(b)) b.y += T;
    }
    b.vy = Math.min(b.vy + G, MAX_FALL);
    const bottom = b.y + b.h;
    b.y += b.vy;
    b.ground = false;
    const r = Math.floor((b.y + b.h - 0.01) / T);
    if ((b.vy > 0 && bottom <= r * T + 0.01 && r !== drop && under(b, r)) || hits(b)) {
      if (b.vy > 0) (b.y = r * T - b.h), (b.ground = true);
      else b.y = (Math.floor(b.y / T) + 1) * T;
      b.vy = 0;
    }
    return blocked;
  };
  const body = (x: number, y: number, w: number, h: number): Body => {
    x = Math.max(T, Math.min(x, (cols - 1) * T - w)); // between the side walls: lifting below can't get a box out of one
    const b = { x, y, w, h, vx: 0, vy: 0, ground: false };
    while (hits(b) && b.y > 0) b.y -= T;
    return b;
  };
  const pick = <V>(list: V[]) => list[Math.floor(rand() * list.length)];
  const shuffle = <V>(list: V[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  // Surfaces: solid tiles with 4 open tiles above (room for the player). Shuffled, real edges before the artificial ground.
  const surfaces: [number, number][] = [];
  for (let r = 4; r < rows; r++)
    for (let c = 1; c < cols - 1; c++) if (at(c, r) && [1, 2, 3, 4].every((d) => !at(c, r - d))) surfaces.push([c, r]);
  shuffle(surfaces).sort((a, b) => Number(a[1] === rows - 1) - Number(b[1] === rows - 1)); // stable: wall edges first, still shuffled

  const nearest = (cell: unknown, pool: [number, number][], maxD = 12): [number, number] | null => {
    const { c, r } = (cell ?? {}) as Cell;
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    let best: [number, number] | null = null, bd = maxD;
    for (const sf of pool) {
      const d = Math.hypot(sf[0] - c, sf[1] - r);
      if (d < bd) (bd = d), (best = sf);
    }
    return best;
  };

  // Reachability with the real jump physics: widest horizontal distance a jump covers while ending `up` tiles higher
  // (negative = lower). 0.8 = margin for imperfect timing. One-way platforms never block the way up.
  const reachX = (up: number) => {
    const d = JUMP * JUMP - 2 * G * up * T;
    return d < 0 ? -1 : (0.8 * RUN * (JUMP + Math.sqrt(d))) / G / T;
  };
  const reachFrom = (sc: [number, number]) => {
    const seen = new Uint8Array(surfaces.length), from = nearest({ c: sc[0], r: sc[1] }, surfaces, 99);
    const first = from ? surfaces.indexOf(from) : -1;
    if (first < 0) return [];
    const queue = [first];
    seen[first] = 1;
    while (queue.length) {
      const [c1, r1] = surfaces[queue.pop()!];
      for (let j = 0; j < surfaces.length; j++)
        if (!seen[j] && Math.abs(surfaces[j][0] - c1) <= reachX(r1 - surfaces[j][1])) (seen[j] = 1), queue.push(j);
    }
    return surfaces.filter((_, i) => seen[i]);
  };

  // Start: the director's spawn in round 1, a random spot later (if most of the level is reachable from it).
  const groundStart: [number, number] = [2, rows - 1];
  let startCell: [number, number] = (round === 1 && nearest(plan?.spawn, surfaces)) || groundStart;
  let reachable = reachFrom(startCell);
  if (round > 1 && surfaces.length) {
    const cand = pick(surfaces), r = reachFrom(cand);
    if (r.length >= Math.max(20, surfaces.length * 0.4)) (startCell = cand), (reachable = r);
  }
  const dist = (sf: [number, number]) => Math.hypot(sf[0] - startCell[0], sf[1] - startCell[1]);
  const farthest = (share: number, score = dist) => {
    const sorted = [...reachable].sort((a, b) => score(b) - score(a));
    return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * share)));
  };

  const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  const colors = {
    edge: color(plan?.colors?.edge, "#ff8a1f"),
    player: color(plan?.colors?.player, "#28e0ff"),
    enemy: color(plan?.colors?.enemy, "#b04aff"),
    coin: color(plan?.colors?.coin, "#ffd60a"),
  };
  const spawnAt = (n: number) => body((startCell[0] + n * 4) * T, (startCell[1] - 4) * T, 3 * T, 4 * T);
  const far = (list: { x: number; y: number }[], x: number, y: number, d: number) => list.every((o) => Math.hypot(o.x - x, o.y - y) > d);
  const start = spawnAt(0);
  const awayFromStart = (x: number, y: number, d: number) => Math.hypot(x - start.x, y - start.y) > d * T;

  // Exit: the director's in round 1, a random far-away spot after that.
  const goalCell = (round === 1 && nearest(plan?.goal, reachable)) || (reachable.length ? pick(farthest(0.3)) : null);
  const goal = goalCell && { x: goalCell[0] * T - T, y: (goalCell[1] - 6) * T, w: 4 * T, h: 6 * T };
  const hazards = (Array.isArray(plan?.hazards) ? plan.hazards : [])
    .filter((z) => [z?.c, z?.r, z?.w, z?.h].every(Number.isFinite) && z.w > 0 && z.h > 0)
    .slice(0, 6)
    .map((z) => ({ x: z.c * T, y: z.r * T, w: Math.min(z.w, 30) * T, h: Math.min(z.h, 30) * T, label: String(z.label ?? "").slice(0, 20) }))
    .filter((z) => !overlap(start, z.x - 6 * T, z.y - 6 * T, z.w + 12 * T, z.h + 12 * T)); // never next to the start: endless respawn loop
  const nearHazard = (x: number, y: number) => hazards.some((z) => x > z.x - 3 * T && x < z.x + z.w + 3 * T && y > z.y - 3 * T && y < z.y + z.h + 3 * T);
  const nearGoal = (x: number, y: number) => !!goal && Math.hypot(x - goal.x, y - goal.y) < 6 * T;
  const free = (x: number, y: number) => !nearHazard(x, y) && !nearGoal(x, y) && awayFromStart(x, y, 6);

  const coins: Pickup[] = [];
  const nCoins = round === 1 ? 10 : 6 + Math.floor(rand() * 7);
  const planCoins = round === 1 && Array.isArray(plan?.coins) ? plan.coins.map((c) => nearest(c, reachable)).filter((x): x is [number, number] => x !== null) : [];
  for (const [c, r] of [...planCoins, ...shuffle([...reachable])]) {
    const x = c * T + T / 2, y = (r - 2) * T;
    if (coins.length < nCoins && free(x, y) && far(coins, x, y, 4 * T)) coins.push({ x, y, taken: false });
  }

  // Secret gem: on one of the hardest-to-reach spots (far and high), invisible until you come close.
  const gemCell = reachable.length ? pick(farthest(0.15, (sf) => dist(sf) + (rows - sf[1]) * 1.5)) : null;
  const gem: Pickup | null = gemCell && free(gemCell[0] * T + T / 2, (gemCell[1] - 2) * T) ? { x: gemCell[0] * T + T / 2, y: (gemCell[1] - 2) * T, taken: false } : null;
  // Power-ups: 1 in round 1, 2–3 later, different kinds, spread over the reachable level.
  const powers: (Pickup & { kind: Power })[] = [];
  const kinds = shuffle(Object.keys(POWERS) as Power[]);
  for (const [c, r] of shuffle([...reachable])) {
    if (powers.length >= (round === 1 ? 2 : 3 + Math.floor(rand() * 2))) break;
    const x = c * T + T / 2, y = (r - 2) * T;
    if (free(x, y) && far(powers, x, y, 15 * T) && far(coins, x, y, 3 * T)) powers.push({ x, y, taken: false, kind: kinds[powers.length] });
  }

  // Enemies: more kinds and more of them each round.
  const pool: Kind[] = ["walker", "spark", ...(round >= 2 ? (["hopper", "turret"] as Kind[]) : []), ...(round >= 3 ? (["flyer", "drone"] as Kind[]) : [])];
  const runOk = ([c, r]: [number, number]) => [-2, -1, 1, 2, 3].every((d) => top(c + d, r) || (r === rows - 1 && !at(c + d, r - 1)));
  const planEnemies = round === 1 && Array.isArray(plan?.enemies) ? plan.enemies.map((c) => nearest(c, surfaces)).filter((x): x is [number, number] => x !== null) : [];
  // sparks ride long real edges only: tiles of 8-connected edge clusters with at least 12 tiles
  const longEdge: [number, number][] = [];
  {
    const seen = new Uint8Array(cols * rows);
    for (let s0 = 0; s0 < seen.length; s0++) {
      if (!level.solid[s0] || seen[s0]) continue;
      const comp = [s0], stack = [s0];
      seen[s0] = 1;
      while (stack.length) {
        const t = stack.pop()!, c = t % cols, r = (t - c) / cols;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const n = (r + dr) * cols + c + dc;
            if (edge(c + dc, r + dr) && !seen[n]) (seen[n] = 1), comp.push(n), stack.push(n);
          }
      }
      if (comp.length >= 12) for (const t of comp) longEdge.push([t % cols, Math.floor(t / cols)]);
    }
  }
  const enemies: Enemy[] = [];
  const spot = (kind: Kind): { x: number; y: number; c: number; r: number } | null => {
    const cands: [number, number][] =
      kind === "spark" ? shuffle([...longEdge])
      : kind === "drone" ? Array.from({ length: 30 }, () => [10 + Math.floor(rand() * (cols - 20)), Math.floor(rows * (0.15 + rand() * 0.35))] as [number, number])
      : kind === "walker" ? [...planEnemies, ...surfaces.filter(runOk)]
      : kind === "hopper" ? surfaces.filter(runOk)
      : surfaces;
    for (const [c, r] of cands) {
      const x = c * T, y = kind === "spark" || kind === "drone" ? r * T : kind === "flyer" ? (r - 10) * T : (r - 2) * T;
      if (far(enemies, x, y, 8 * T) && awayFromStart(x, y, kind === "drone" ? 45 : 25) && !nearGoal(x, y)) return { x, y, c, r };
    }
    return null;
  };
  for (let i = 0, want = Math.min(2 + round, 9); i < want; i++) {
    const kind: Kind = i === 0 ? "walker" : pick(pool);
    const at0 = spot(kind);
    if (!at0) continue;
    const size = kind === "spark" ? 1.5 * T : 2 * T;
    const b = kind === "spark" || kind === "drone" || kind === "flyer" ? { x: at0.x, y: at0.y, w: size, h: size, vx: 0, vy: 0, ground: false } : body(at0.x, at0.y, size, size);
    enemies.push({ ...b, kind, dead: false, t: Math.floor(rand() * 90), baseY: b.y, c: at0.c, r: at0.r, pc: at0.c, pr: at0.r });
    enemies[enemies.length - 1].vx = (rand() < 0.5 ? -1 : 1) * pace;
  }
  const bolts: { x: number; y: number; vx: number; life: number }[] = [];

  const players: Player[] = Array.from({ length: nPlayers }, (_, n) => ({
    ...spawnAt(n),
    n, face: 1, coins: 0, coyote: 0, buffer: 0, inv: 0, prevJump: false, squash: 0,
    color: n === 0 ? colors.player : "#ff4fd8",
    boots: false, magnet: false, shield: false, spring: false, compass: false, air: 0, fast: 0, ghost: 0, jet: 0,
  }));
  const particles: Particle[] = [];
  const s = {
    players, coins, enemies, bolts, particles, gem, powers, goal, mod, round,
    freeze: 0, slow: 0, flash: 0, boomX: 0, boomY: 0, frames: 0, falls: 0, won: false, events: [] as GameEvent[], best: 0, secretsTotal: 0, reachable: reachable.length,
  };
  const burst = (x: number, y: number, color: string, n: number, speed = 3) => {
    for (let i = 0; i < n && particles.length < 500; i++) {
      const a = rand() * Math.PI * 2, v = speed * (0.4 + rand());
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 30 + rand() * 20, color });
    }
  };
  const hurt = (p: Player) => {
    if (p.ghost) return;
    if (p.shield) { // the shield takes the hit instead
      p.shield = false;
      p.inv = 60;
      burst(p.x + p.w / 2, p.y + p.h / 2, "#7fd8ff", 30, 4);
      return void s.events.push("shield");
    }
    s.falls++;
    s.events.push("ouch");
    burst(p.x + p.w / 2, p.y + p.h / 2, p.color, 25, 4);
    Object.assign(p, spawnAt(p.n), { inv: INVULNERABLE, squash: 0 });
  };
  const nearestPlayer = (x: number, y: number) =>
    players.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));

  function stepSpark(e: Enemy) {
    if (e.t % Math.max(3, 8 - round) === 0) {
      const dc = e.c - e.pc, dr = e.r - e.pr;
      const options: [number, number][] = [];
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if ((x || y) && edge(e.c + x, e.r + y) && !(e.c + x === e.pc && e.r + y === e.pr)) options.push([e.c + x, e.r + y]);
      const straight = options.find(([c, r]) => c === e.c + dc && r === e.r + dr);
      const next = straight && rand() < 0.8 ? straight : options.length ? pick(options) : [e.pc, e.pr]; // dead end: turn around
      [e.pc, e.pr, e.c, e.r] = [e.c, e.r, next[0], next[1]];
    }
    e.x += (e.c * T + T / 2 - e.w / 2 - e.x) * 0.3; // glide toward the current tile
    e.y += (e.r * T + T / 2 - e.h / 2 - e.y) * 0.3;
  }

  function step(inputs: Input[]) {
    s.events = [];
    for (const q of particles) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.15), q.life--;
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    if (s.won) return;
    s.frames++;

    for (const p of players) {
      const inp = inputs[p.n] ?? inputs[0] ?? { left: false, right: false, jump: false };
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const run = p.fast ? RUN * 1.45 : RUN;
      if (dir) (p.vx = Math.max(-run, Math.min(run, p.vx + dir * ACCEL))), (p.face = dir);
      else p.vx = Math.abs(p.vx) < 0.2 ? 0 : p.vx * FRICTION;
      p.buffer = inp.jump && !p.prevJump ? BUFFER : Math.max(0, p.buffer - 1); // a press shortly before landing still counts
      p.coyote = p.ground ? COYOTE : Math.max(0, p.coyote - 1); // a jump shortly after running off a ledge still counts
      if (p.ground) p.air = p.boots ? 1 : 0;
      const jump = p.spring ? JUMP * 1.3 : JUMP;
      if (p.buffer && p.coyote) (p.vy = -jump), (p.buffer = p.coyote = 0), (p.squash = -0.25), s.events.push("jump");
      else if (p.buffer && p.air && inp.jump && !p.prevJump)
        p.air--, (p.vy = -jump * 0.85), (p.buffer = 0), (p.squash = -0.25), burst(p.x + p.w / 2, p.y + p.h, "#ffffff", 10, 2), s.events.push("jump");
      if (p.jet) { // jetpack: hold jump in the air to fly up
        p.jet--;
        if (inp.jump && !p.ground && !p.buffer) {
          p.vy = Math.max(p.vy - 1.2, -6);
          particles.push({ x: p.x + p.w / 2, y: p.y + p.h, vx: (rand() - 0.5) * 2, vy: 2 + rand() * 2, life: 18, color: rand() < 0.5 ? "#ff9d00" : "#fff36b" });
        }
      }
      if (!inp.jump && p.vy < -3) p.vy = -3; // let go early = short hop
      p.prevJump = inp.jump;
      const falling = p.vy;
      // down on an edge: skip landing on it for the one frame it takes to sink below its top; hits() still holds the ground
      if (move(p, inp.down && p.ground ? Math.round((p.y + p.h) / T) : -1)) p.vx = 0;
      if (p.ground && falling > 4) (p.squash = 0.3), burst(p.x + p.w / 2, p.y + p.h, "#ffffff", 6, 1.5), s.events.push("land");
      p.squash *= 0.8;
      if (p.inv) p.inv--;
      for (const c of coins) {
        if (c.taken) continue;
        if (p.magnet && Math.hypot(c.x - p.x, c.y - p.y) < 14 * T) (c.x += (p.x + p.w / 2 - c.x) * 0.08), (c.y += (p.y + p.h / 2 - c.y) * 0.08);
        if (overlap(p, c.x - T, c.y - T, 2 * T, 2 * T)) (c.taken = true), p.coins++, burst(c.x, c.y, colors.coin, 14), s.events.push("coin");
      }
      if (gem && !gem.taken && overlap(p, gem.x - T, gem.y - T, 2 * T, 2 * T)) {
        gem.taken = true;
        s.frames = Math.max(0, s.frames - 600); // −10 s
        burst(gem.x, gem.y, "#7df9ff", 40, 5);
        s.events.push("secret");
      }
      for (const pw of powers) {
        if (pw.taken || !overlap(p, pw.x - T, pw.y - T, 2 * T, 2 * T)) continue;
        pw.taken = true;
        const k = pw.kind;
        if (k === "freeze") s.freeze = POWER_FRAMES.freeze;
        else if (k === "slowmo") s.slow = POWER_FRAMES.slowmo;
        else if (k === "speed") p.fast = POWER_FRAMES.speed;
        else if (k === "ghost") p.ghost = POWER_FRAMES.ghost;
        else if (k === "jetpack") p.jet = POWER_FRAMES.jetpack;
        else if (k === "clock") s.frames = Math.max(0, s.frames - 300);
        else if (k === "bomb") {
          for (const e of enemies)
            if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 30 * T) (e.dead = true), burst(e.x + e.w / 2, e.y + e.h / 2, "#ff9d00", 25, 5);
          bolts.length = 0;
          (s.flash = 30), (s.boomX = p.x + p.w / 2), (s.boomY = p.y + p.h / 2);
          s.events.push("stomp");
        } else p[k] = true;
        burst(pw.x, pw.y, "#ffffff", 30, 4);
        s.events.push("power");
      }
      if (p.fast) p.fast--, s.frames % 3 || particles.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.8, vx: -p.vx * 0.3, vy: 0, life: 15, color: "#fff36b" }); // speed trail
      if (p.ghost) p.ghost--;
      if (!p.inv && hazards.some((z) => overlap(p, z.x, z.y, z.w, z.h))) hurt(p);
    }

    if (s.freeze) s.freeze--;
    if (s.slow) s.slow--;
    if (s.flash) s.flash--;
    const still = s.freeze > 0 || (s.slow > 0 && s.frames % 2 === 1); // slowmo = enemies move every other frame
    for (const e of enemies) {
      if (e.dead) continue;
      if (!still) e.t++;
      if (still) {} // frozen in place (still dangerous to touch, still stompable)
      else if (e.kind === "spark") stepSpark(e);
      else if (e.kind === "flyer") {
        e.x += e.vx;
        if (e.x < T || e.x + e.w > (cols - 1) * T) e.vx = -e.vx;
        e.y = e.baseY + Math.sin(e.t / 25) * 3 * T;
      } else if (e.kind === "drone") {
        if (s.frames > 180) { // a grace period before it starts hunting
          const p = nearestPlayer(e.x, e.y), dx = p.x + p.w / 2 - e.x - e.w / 2, dy = p.y + p.h / 2 - e.y - e.h / 2, d = Math.hypot(dx, dy) || 1;
          const v = Math.min(1.3, 0.35 + 0.1 * round) * (mod === "turbo" ? 1.5 : 1);
          (e.x += (dx / d) * v), (e.y += (dy / d) * v), (e.vx = dx);
        }
      } else if (e.kind === "turret") {
        if (e.t % Math.max(70, 160 - 15 * round) === 0) {
          const dirX = nearestPlayer(e.x, e.y).x > e.x ? 1 : -1;
          bolts.push({ x: e.x + e.w / 2, y: e.y + e.h * 0.4, vx: dirX * (2.5 + 0.3 * round), life: 400 });
          (e.vx = dirX), s.events.push("shoot");
        }
      } else {
        if (e.kind === "hopper" && e.ground && e.t % 90 === 0) e.vy = -8;
        const front = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        if (move(e) || (e.ground && !at(Math.floor(front / T), Math.floor((e.y + e.h + 1) / T)))) e.vx = -e.vx; // turn at walls and drops
      }
      for (const p of players) {
        if (e.dead || p.inv || !overlap(p, e.x, e.y, e.w, e.h)) continue;
        const stomp = e.kind !== "spark" && p.vy > 0 && p.y + p.h - e.y < 14; // sparks are spiky: never stomp them
        if (stomp) (e.dead = true), (p.vy = -8), burst(e.x + T, e.y + T, colors.enemy, 20), s.events.push("stomp");
        else hurt(p);
      }
    }
    for (const b of bolts) {
      if (!still) (b.x += b.vx), b.life--;
      for (const p of players) if (!p.inv && b.life > 0 && overlap(p, b.x - 3, b.y - 3, 6, 6)) (b.life = 0), hurt(p);
    }
    for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].life <= 0 || bolts[i].x < 0 || bolts[i].x > cols * T) bolts.splice(i, 1);

    if (coins.every((c) => c.taken) && (!goal || players.some((p) => overlap(p, goal.x, goal.y, goal.w, goal.h)))) {
      s.won = true;
      s.events.push("win");
      for (let i = 0; i < 6; i++) burst(T * (20 + 24 * i), T * 20, ["#ff4fd8", "#ffd60a", "#28e0ff", "#00ff88"][i % 4], 30, 5);
    }
  }

  let layer: OffscreenCanvas | null = null; // static neon level, painted once
  function paintLevel() {
    layer = new OffscreenCanvas(cols * T, rows * T);
    const g = layer.getContext("2d")!;
    const p = (c: number, r: number) => [c * T + T / 2, r * T + 2] as const; // line sits on the tile top, where feet land
    g.beginPath();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!edge(c, r)) continue;
        let linked = false;
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
          if (!edge(c + dc, r + dr)) continue;
          linked = true;
          if (dc && dr && (edge(c + dc, r) || edge(c, r + dr))) continue; // corner already joined straight: no criss-cross
          g.moveTo(...p(c, r)), g.lineTo(...p(c + dc, r + dr));
        }
        if (!linked && !edge(c - 1, r) && !edge(c, r - 1) && !edge(c - 1, r - 1) && !edge(c + 1, r - 1))
          g.moveTo(c * T + 1, r * T + 2), g.lineTo(c * T + T - 1, r * T + 2); // lone tile: short dash
      }
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = g.shadowColor = colors.edge;
    g.lineWidth = 4;
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,255,255,0.75)"; // hot core: reads as neon
    g.lineWidth = 1.5;
    g.stroke();
    g.beginPath();
    g.moveTo(T, 0), g.lineTo(T, (rows - 1) * T), g.lineTo((cols - 1) * T, (rows - 1) * T), g.lineTo((cols - 1) * T, 0);
    g.strokeStyle = g.shadowColor = "#1fd67a";
    g.lineWidth = 3;
    g.shadowBlur = 10;
    g.stroke();
  }

  function draw(ctx: CanvasRenderingContext2D) {
    const f = s.frames, W = cols * T, H = rows * T;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H); // level units: the caller scales the level to the canvas, so this covers all of it
    if (!layer) paintLevel();
    ctx.drawImage(layer!, 0, 0);
    const left = coins.filter((c) => !c.taken).length;
    // status line first, at the bottom (the top is often where the level starts): coins and players draw over it
    const hud = () => {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `${1.6 * T}px sans-serif`;
      ctx.textAlign = "center";
      const name = typeof plan?.name === "string" ? plan.name.slice(0, 40) + " · " : "";
      const score = players.length === 2 ? `P1 ${players[0].coins} · P2 ${players[1].coins}` : `coins ${coins.length - left}/${coins.length}`;
      const active = players.flatMap((p) => [p.boots && POWERS.boots, p.magnet && POWERS.magnet, p.shield && POWERS.shield, p.spring && POWERS.spring, p.compass && POWERS.compass, p.fast && POWERS.speed, p.ghost && POWERS.ghost, p.jet && POWERS.jetpack]).concat(s.freeze ? [POWERS.freeze] : [], s.slow ? [POWERS.slowmo] : []).filter(Boolean).join("");
      const extras = [mod, active, s.best && `best ${(s.best / 60).toFixed(1)}s`, s.secretsTotal && `💎 ${s.secretsTotal}`].filter(Boolean).join(" · ");
      ctx.fillText(`${name}round ${round} · ${score} · ${(f / 60).toFixed(1)}s · ouch ${s.falls}${extras ? " · " + extras : ""}`, W / 2, (rows - 2) * T);
      ctx.textAlign = "start";
    };
    hud();

    for (const z of hazards) {
      ctx.strokeStyle = ctx.shadowColor = "#ff1744"; // steady colour: no blinking (photosensitivity)
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.strokeRect(z.x, z.y, z.w, z.h);
      ctx.beginPath(); // crackle: a fresh zigzag every few frames
      for (let k = 0, x = z.x; k <= 6; k++, x += z.w / 6) ctx.lineTo(x, z.y + z.h / 2 + (Math.sin(Math.floor(f / 12) * 7.3 + k * 2.1) * z.h) / 3);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff8a80";
      ctx.font = `${1.5 * T}px sans-serif`;
      ctx.fillText(z.label, z.x, z.y - T / 2);
    }
    ctx.fillStyle = ctx.shadowColor = colors.coin;
    ctx.shadowBlur = 8;
    for (const c of coins) {
      if (c.taken) continue;
      ctx.beginPath(); // spinning coin: squeeze its width
      ctx.ellipse(c.x, c.y + Math.sin(f / 10 + c.x) * 2, 1 + T * 0.7 * Math.abs(Math.cos(f / 8 + c.x)), T * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.font = `bold ${2.4 * T}px sans-serif`;
    for (const pw of powers) {
      if (pw.taken) continue;
      ctx.fillStyle = ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 10 + 6 * Math.sin(f / 20);
      ctx.beginPath(); // glowing bubble around the icon
      ctx.arc(pw.x, pw.y + Math.sin(f / 12) * 2, 1.6 * T, 0, Math.PI * 2);
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillText(POWERS[pw.kind], pw.x, pw.y + 0.8 * T + Math.sin(f / 12) * 2);
    }
    ctx.textAlign = "start";
    if (gem && !gem.taken) {
      const d = Math.min(...players.map((p) => Math.hypot(p.x - gem.x, p.y - gem.y))) / T;
      const a = Math.max(0, Math.min(1, (16 - d) / 8)); // fades in from 16 tiles away, fully visible at 8
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.fillStyle = ctx.shadowColor = "#7df9ff";
        ctx.shadowBlur = 14;
        ctx.beginPath(); // diamond
        ctx.moveTo(gem.x, gem.y - T), ctx.lineTo(gem.x + T * 0.8, gem.y), ctx.lineTo(gem.x, gem.y + T), ctx.lineTo(gem.x - T * 0.8, gem.y);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0;
    for (const e of enemies) if (!e.dead) drawEnemy(ctx, e, s.freeze ? "#7fd8ff" : s.slow ? "#b9a3ff" : colors.enemy, f); // frozen: icy blue, slowed: lilac
    ctx.fillStyle = ctx.shadowColor = "#ff3df0";
    ctx.shadowBlur = 10;
    for (const b of bolts) ctx.fillRect(b.x - 4, b.y - 2, 8, 4);
    ctx.shadowBlur = 0;
    for (const p of players) drawPlayer(ctx, p, f);
    for (const p of players) { // compass: little arrows around the player pointing at what's left to find
      if (!p.compass) continue;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const targets: [number, number, string][] = coins.filter((c) => !c.taken).map((c) => [c.x, c.y, colors.coin]);
      if (gem && !gem.taken) targets.push([gem.x, gem.y, "#7df9ff"]);
      for (const [tx, ty, col] of targets) {
        const a = Math.atan2(ty - cy, tx - cx), r = 4.5 * T;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + T), cy + Math.sin(a) * (r + T));
        ctx.lineTo(cx + Math.cos(a + 0.25) * r, cy + Math.sin(a + 0.25) * r);
        ctx.lineTo(cx + Math.cos(a - 0.25) * r, cy + Math.sin(a - 0.25) * r);
        ctx.fill();
      }
    }
    for (const q of particles) {
      ctx.globalAlpha = Math.min(1, q.life / 30);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    if (s.flash) { // bomb: an expanding orange ring (no full-screen flash: photosensitivity)
      ctx.strokeStyle = `rgba(255,157,0,${s.flash / 30})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.boomX, s.boomY, (30 - s.flash + 1) * T, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (mod === "darkness") { // everything black except a glow around each player; the exit still shines through
      ctx.fillStyle = "rgba(0,0,0,0.94)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      for (const p of players) {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = 15 * T;
        ctx.moveTo(cx + R, cy);
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
      }
      ctx.fill("evenodd");
    }
    if (goal) {
      const open = left === 0;
      ctx.strokeStyle = ctx.shadowColor = open ? "#00ff88" : "#2e5e46";
      ctx.shadowBlur = open ? 10 + 8 * Math.sin(f / 20) : 0;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(goal.x, goal.y, goal.w, goal.h, [goal.w / 2, goal.w / 2, 2, 2]); // arched door
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${1.5 * T}px sans-serif`;
      ctx.fillText(open ? "EXIT" : `${left}🔒`, goal.x, goal.y - T / 2);
    }

    if (mod === "darkness") hud(); // again on top, so the dark doesn't swallow it
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    if (f < 150) { // round intro banner
      ctx.globalAlpha = Math.min(1, (150 - f) / 40);
      ctx.font = `bold ${4 * T}px sans-serif`;
      ctx.fillText(`Round ${round}`, W / 2, H * 0.35);
      ctx.font = `${2.2 * T}px sans-serif`;
      const hint = { "low gravity": "Low gravity: floaty jumps", darkness: "Darkness: find the coins by your own light", ice: "Ice: slippery floors", turbo: "Turbo: everything is faster" };
      ctx.fillText([mod ? hint[mod] : "Collect every coin, then reach the exit", gem ? "A secret gem is hidden somewhere…" : ""].filter(Boolean).join("  ·  "), W / 2, H * 0.35 + 4 * T);
      ctx.globalAlpha = 1;
    }
    if (s.won) {
      ctx.font = `bold ${4 * T}px sans-serif`;
      const who = players.length === 2 ? (players[0].coins === players[1].coins ? "Draw! " : players[0].coins > players[1].coins ? "P1 wins! " : "P2 wins! ") : "";
      ctx.fillText(`${who}Round ${round} in ${(f / 60).toFixed(1)} s${gem?.taken ? " 💎" : ""}`, W / 2, H * 0.4);
      ctx.font = `${2 * T}px sans-serif`;
      ctx.fillText("Enter = next round · R = again · Esc = menu", W / 2, H * 0.4 + 4 * T);
    }
    ctx.textAlign = "start";
  }

  return { step, draw, state: s };
}

const overlap = (a: Body, x: number, y: number, w: number, h: number) => a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y;

function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, f: number) {
  // invulnerable or ghost: see-through instead of blinking (photosensitivity); a ghost fades back in over its last 1.5 s
  if (p.inv) ctx.globalAlpha = 0.45;
  if (p.ghost) ctx.globalAlpha = p.ghost < 90 ? 0.45 + (0.4 * (90 - p.ghost)) / 90 : 0.45;
  if (p.shield) {
    ctx.strokeStyle = ctx.shadowColor = "#7fd8ff";
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.95, p.h * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const w = p.w * (1 + p.squash), h = p.h * (1 - p.squash), x = p.x + (p.w - w) / 2, y = p.y + p.h - h; // squash on landing, stretch on jump
  const walk = p.ground && Math.abs(p.vx) > 0.5 ? Math.sin(f / 3) * h * 0.08 : 0;
  ctx.fillStyle = ctx.shadowColor = p.color;
  ctx.shadowBlur = p.boots || p.magnet || p.fast || p.spring || p.jet ? 22 : 12; // powered up: brighter glow
  ctx.beginPath();
  ctx.roundRect(x, y, w, h * 0.82, w / 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = p.boots ? "#ffffff" : p.color; // white boots = double jump
  ctx.fillRect(x + w * 0.12, y + h * 0.82, w * 0.28, h * 0.18 - Math.max(0, walk)); // feet
  ctx.fillRect(x + w * 0.6, y + h * 0.82, w * 0.28, h * 0.18 - Math.max(0, -walk));
  eyes(ctx, x, y + h * 0.22, w, h * 0.2, p.face, p.vy < -2 ? -1 : 0);
  ctx.globalAlpha = 1;
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, color: string, f: number) {
  if (e.kind === "spark") { // a crackling star riding the edge line
    ctx.strokeStyle = ctx.shadowColor = "#fff36b";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + f / 5, r = k % 2 ? e.w * 0.35 : e.w * 0.85;
      ctx.moveTo(cx, cy), ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    return;
  }
  ctx.fillStyle = ctx.shadowColor = e.kind === "drone" ? "#ff3d3d" : e.kind === "turret" ? "#9aa0a6" : color;
  ctx.shadowBlur = 10;
  if (e.kind === "flyer") {
    const flap = Math.sin(f / 3) * e.h * 0.5;
    ctx.beginPath(); // wings
    ctx.moveTo(e.x, e.y + e.h * 0.4), ctx.lineTo(e.x - e.w * 0.6, e.y + e.h * 0.4 - flap), ctx.lineTo(e.x + e.w * 0.3, e.y + e.h * 0.6);
    ctx.moveTo(e.x + e.w, e.y + e.h * 0.4), ctx.lineTo(e.x + e.w * 1.6, e.y + e.h * 0.4 - flap), ctx.lineTo(e.x + e.w * 0.7, e.y + e.h * 0.6);
    ctx.fill();
  }
  if (e.kind === "drone") { // spinning rotor
    ctx.fillRect(e.x + e.w / 2 - e.w * 0.7 * Math.cos(f / 2), e.y - 3, e.w * 1.4 * Math.cos(f / 2), 2);
  }
  ctx.beginPath();
  if (e.kind === "turret") ctx.rect(e.x, e.y + e.h * 0.2, e.w, e.h * 0.8), ctx.rect(e.x + e.w / 2 + (e.vx >= 0 ? 0 : -e.w * 0.8), e.y + e.h * 0.3, e.w * 0.8, e.h * 0.2);
  else ctx.roundRect(e.x, e.y, e.w, e.kind === "hopper" ? e.h * 0.75 : e.h, e.w / 2.5);
  ctx.fill();
  if (e.kind === "hopper") {
    ctx.strokeStyle = color; // spring
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 4; k++) ctx.lineTo(e.x + e.w / 2 + (k % 2 ? 4 : -4), e.y + e.h * 0.75 + (k * e.h * 0.25) / 4);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  eyes(ctx, e.x, e.y + e.h * (e.kind === "turret" ? 0.35 : 0.2), e.w, e.h * 0.28, Math.sign(e.vx) || 1, 1);
}

/** Two eyes looking toward `face`; brow 1 = angry, -1 = surprised (jumping), 0 = none. */
function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, s: number, face: number, brow: number) {
  for (const ex of [x + w * 0.3, x + w * 0.62]) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(ex - s * 0.35, y, s * 0.7, s);
    ctx.fillStyle = "#000";
    ctx.fillRect(ex - s * 0.15 + face * s * 0.15, y + s * 0.3, s * 0.3, s * 0.5);
    if (brow) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const inner = ex < x + w / 2 ? 1 : -1; // angry brows slope down toward the nose
      ctx.moveTo(ex - s * 0.4, y - 2 + (brow > 0 ? -inner * 2 : -2)), ctx.lineTo(ex + s * 0.4, y - 2 + (brow > 0 ? inner * 2 : -2));
      ctx.stroke();
    }
  }
}
