// Critter Clash: two teams of blob critters take turns on the room's real edges, lobbing rockets, bombs and popcorn
// through the wind. Blasts chew holes in the edges; the last team standing wins. Hot-seat on one keyboard.
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";
import { G, MAX_POWER, MIN_POWER, launch } from "./aim";
import { BLASTS, type Kind, type Shell, WEAPONS, type World, drawShell, stepShell, zapRay } from "./clash-weapons";
import { type Body, edgeLayer, effects, floorAt, grid, keys, ledges, say, segDist, slide } from "./kit";
import { type Rope, ropeTarget, swing, tether } from "./rope";

export const HP = 100, TURN = 30 * 60, PAUSE = 60, WALK = 1, FALL = 8; // FALL: tiles a critter drops unhurt
export const TEAMS = [
  { name: "Bobbles", color: "#ff7aa8" }, // bobble hats
  { name: "Sprouts", color: "#4fd8ff" }, // leaf sprouts
];
const NAMES = ["Pip", "Mochi", "Bean", "Tofu", "Nib", "Waffle", "Dot", "Fig", "Momo", "Pudding", "Sprinkle", "Biscuit"];
const EDGE = "#a58cff";
export const U = 1.5; // critter size unit, in tiles: big enough to read across the room

export type Critter = Body & { team: number; name: string; hp: number; ground: boolean; face: number; peak: number; walk: number; walked: number; dizzy: number; blink: number };

export function createClash(env: Env) {
  const g = grid(env), { cols, rows, T, W, H } = g, rand = env.rand;
  const u = U * T, HY = 1.7 * u, HIT = 2 * u; // critter size unit; body centre above the feet; hit radius
  const REACH = 0.4 * H; // the vine's length
  for (let c = 0; c < cols; c++) g.solid[(rows - 1) * cols + c] = 1; // an unbreakable floor: sparse rooms still have ground
  const solid = g.edge; // the beam's sides and top are open: fly out there and you're out

  // three critters a team, each on a ledge in its own band of its half (real edges first, the floor if there are none)
  const spots = ledges(g, 6).filter(([, r]) => r >= Math.max(12, rows * 0.2)); // below the HUD
  const names = [...NAMES], critters: Critter[] = [];
  for (let team = 0; team < 2; team++)
    for (let i = 0; i < 3; i++) {
      const lo = (team ? 0.55 : 0.03) + i * 0.14, band = spots.filter(([c]) => c >= cols * lo && c < cols * (lo + 0.14));
      const high = band.filter(([, r]) => r < rows - 1), pool = high.length ? high : band;
      const [c, r] = pool.length ? pool[Math.floor(rand() * pool.length)] : floorAt(g, Math.round(cols * (lo + 0.07)));
      const name = names.splice(Math.floor(rand() * names.length), 1)[0], y = r * T - 0.01;
      critters.push({ x: c * T + T / 2, y, vx: 0, vy: 0, team, name, hp: HP, ground: true, face: team ? -1 : 1, peak: y, walk: 0, walked: -9, dizzy: 0, blink: 60 + rand() * 240 });
    }

  const s = {
    critters, team: 0, cur: critters[0], phase: "move" as "move" | "fly" | "settle", t: 0, timer: TURN, turns: 0,
    weapon: 0, aim: 0.6, power: 0, zaps: 2, rope: null as Rope | null, shells: [] as Shell[],
    ammo: [0, 1].map(() => WEAPONS.map((w) => w.ammo)), wind: 0, winner: -1, frames: 0, over: false, score: 0, events: [] as GameEvent[],
  };
  const last = [-1, -1]; // whose turn it was last in each team
  const fx = effects(rand), edges = edgeLayer(g, EDGE);
  const popups: { x: number; y: number; t: number; text: string; color: string }[] = [];
  const zaps: { x0: number; y0: number; x1: number; y1: number; t: number }[] = [];
  const alive = (k: Critter) => k.hp > 0;
  const angle = (k: Critter) => (k.face > 0 ? s.aim : Math.PI - s.aim);

  function startTurn(team: number) {
    const mine = critters.filter((k) => k.team === team);
    for (let i = 1; i <= mine.length; i++) {
      const n = (last[team] + i) % mine.length;
      if (alive(mine[n])) {
        (last[team] = n), (s.cur = mine[n]);
        break;
      }
    }
    Object.assign(s, { team, phase: "move", t: 0, timer: TURN, aim: 0.6, power: 0, zaps: 2, rope: null });
    s.turns++;
    if (!s.ammo[team][s.weapon]) s.weapon = 0;
    s.wind = Math.round((rand() * 2 - 1) * 30) / 1000; // ±0.03 px/frame²: drifts a long shot by up to ~10 tiles
  }
  startTurn(0);

  function faint(k: Critter) {
    k.hp = 0;
    fx.ring(k.x, k.y - HY, TEAMS[k.team].color, 0.5);
    fx.burst(k.x, k.y - HY, "#ffffff", 24, 2);
    popups.push({ x: k.x, y: k.y - 4 * u, t: 0, text: "poof!", color: TEAMS[k.team].color });
  }
  function hurt(k: Critter, n: number) {
    if (n <= 0 || !alive(k)) return;
    k.hp = Math.max(0, k.hp - n);
    k.dizzy = 100;
    popups.push({ x: k.x, y: k.y - 7 * u, t: 0, text: `-${n}`, color: "#fff27a" });
    s.events.push("ouch");
    if (!k.hp) faint(k);
  }

  function boom(x: number, y: number, kind: Kind) {
    const [R, dmg, kick] = BLASTS[kind], c0 = Math.floor(x / T), r0 = Math.floor(y / T), reach = R * T + 2 * u;
    for (let r = r0 - Math.ceil(R); r <= r0 + Math.ceil(R); r++)
      for (let c = c0 - Math.ceil(R); c <= c0 + Math.ceil(R); c++)
        if (r < rows - 1 && g.edge(c, r) && Math.hypot(c + 0.5 - x / T, r + 0.5 - y / T) <= R) {
          g.solid[r * cols + c] = 0;
          fx.burst(c * T + T / 2, r * T + T / 2, EDGE, 1, 2); // debris
        }
    edges.dirty();
    fx.ring(x, y, "#ffb74d", R / 7);
    fx.burst(x, y, "#ffd180", Math.round(6 * R), 3);
    s.events.push("stomp");
    for (const k of critters) {
      const dx = k.x - x, dy = k.y - HY - y, d = Math.hypot(dx, dy);
      if (!alive(k) || d > reach) continue;
      const f = 1 - d / reach, nx = d ? dx / d : 0, ny = d ? dy / d : -1;
      hurt(k, Math.round(dmg * f));
      (k.vx += nx * kick * f), (k.vy += (ny - 0.8) * kick * f * 0.8); // away, and up a bit
      if (k.ground) (k.ground = false), (k.peak = k.y);
    }
  }

  const world: World = {
    T, W, rand, wind: 0, edge: solid, boom,
    add: (sh) => s.shells.push(sh),
    struck: (x0, y0, x1, y1, owner, t) => critters.some((k) => alive(k) && (k !== owner || t > 15) && segDist(k.x, k.y - HY, x0, y0, x1, y1) < HIT),
  };

  function land(k: Critter) {
    (k.ground = true), (k.vx = k.vy = 0);
    const drop = (k.y - k.peak) / T;
    if (drop > FALL) hurt(k, Math.round((drop - FALL) * 3));
    else if (drop > 2) s.events.push("land");
  }

  /** Walking: along the surface, up or down steps of up to 2 tiles; a wall stops it; off an edge it falls. */
  function walk(k: Critter, dir: number) {
    const r = Math.floor(k.y / T) + 1, nx = k.x + dir * WALK, nc = Math.floor(nx / T);
    if (nc < 0 || nc >= cols) return;
    (k.walk++), (k.walked = s.frames);
    if (nc === Math.floor(k.x / T)) return void (k.x = nx);
    const fits = (rr: number) => !solid(nc, rr) && !solid(nc, rr - 1); // feet tile and one above open
    for (const d of [0, 1, 2, -1, -2])
      if (solid(nc, r - d) && fits(r - d - 1)) return void ((k.x = nx), (k.y = (r - d) * T - 0.01));
    if (fits(r - 1)) (k.x = nx), (k.ground = false), (k.peak = k.y);
  }

  function move(k: Critter, dir: number) {
    if (k.ground && !solid(Math.floor(k.x / T), Math.floor(k.y / T) + 1)) (k.ground = false), (k.peak = k.y); // its ground was blasted
    if (k.ground) {
      if (dir) walk(k, dir);
      return;
    }
    k.vy += G;
    const vy = k.vy, hit = slide(k, T, solid);
    k.peak = Math.min(k.peak, k.y);
    if (hit.hitX) k.vx = 0;
    if (hit.hitY) vy > 0 ? land(k) : (k.vy = 0);
  }

  function settle() {
    (s.phase = "settle"), (s.t = 0), (s.rope = null), (s.power = 0);
  }

  function fire(k: Critter) {
    const a = angle(k), kind = (["rocket", "bomb", "pod"] as const)[s.weapon];
    s.shells.push({ kind, ...launch(k.x + Math.cos(a) * 2.5 * u, k.y - HY - Math.sin(a) * 2.5 * u, { a, power: s.power }), t: 0, owner: k });
    s.ammo[s.team][s.weapon]--;
    (s.power = 0), (s.phase = "fly"), (s.t = 0);
    s.events.push("shoot");
  }

  /** The current critter's turn: walk, jump, aim, pick a weapon, charge and fire, or swing on the vine. */
  function control(k: Critter, f: Frame) {
    const L = keys(f.held, "ArrowLeft"), R = keys(f.held, "ArrowRight"), dir = L === R ? 0 : R ? 1 : -1;
    const up = f.held.has("ArrowUp"), down = f.held.has("ArrowDown"), space = f.held.has("Space");
    for (let n = 0; n < WEAPONS.length; n++)
      if (f.pressed.has(`Digit${n + 1}`) && !s.power && !s.rope && s.zaps === 2 && s.ammo[s.team][n] > 0) s.weapon = n;
    if (!s.rope) {
      if (up) s.aim = Math.min(1.5, s.aim + 0.025);
      if (down) s.aim = Math.max(-1.5, s.aim - 0.025);
      if (dir && !s.power) k.face = dir;
      if (f.pressed.has("Enter") && k.ground && !s.power) {
        (k.ground = false), (k.peak = k.y), (k.vy = -4.2), (k.vx = k.face * 1.8);
        s.events.push("jump");
      }
    }
    if (s.weapon === 4) { // the vine: hold Space to hang on, let go to fly; the turn goes on
      if (f.pressed.has("Space") && !s.rope) {
        const t = ropeTarget(solid, T, k.x, k.y - HY, angle(k), REACH);
        if (t) {
          s.rope = { ...t, len: Math.max(2 * T, Math.hypot(k.x - t.x, k.y - HY - t.y)) };
          (k.ground = false), s.events.push("jump");
        }
      }
      if (!space || (s.rope && !solid(Math.floor(s.rope.x / T), Math.floor(s.rope.y / T)))) s.rope = null;
    } else if (s.weapon === 3) {
      if (f.pressed.has("Space")) {
        const a = angle(k), x = k.x, y = k.y - HY, end = zapRay(world, x, y, a, k, H);
        zaps.push({ x0: x + Math.cos(a) * 2 * T, y0: y - Math.sin(a) * 2 * T, x1: end.x, y1: end.y, t: 0 });
        s.events.push("shoot");
        if (end.hit) boom(end.x, end.y, "zap");
        if (!--s.zaps) settle();
      }
    } else if (space) {
      s.power = s.power ? s.power + (MAX_POWER - MIN_POWER) / 80 : MIN_POWER; // full power in ~1.3 s
      if (s.power >= MAX_POWER) fire(k);
    } else if (s.power) fire(k);
    if (s.rope) {
      swing(k, s.rope, HY, dir, up ? -1 : down ? 1 : 0, REACH, T);
      k.vy += G;
      const hit = slide(k, T, solid);
      if (hit.hitX) k.vx = 0;
      if (hit.hitY) k.vy = 0;
      tether(k, s.rope, HY, solid, T);
      k.peak = k.y; // a swing never counts as a fall
    } else move(k, s.power ? 0 : dir);
  }

  function step(f: Frame) {
    s.events = [];
    fx.step();
    s.frames++;
    for (const p of popups) p.t++;
    for (const z of zaps) z.t++;
    while (popups[0]?.t > 70) popups.shift();
    while (zaps[0]?.t > 20) zaps.shift();
    for (const k of critters) {
      k.dizzy = Math.max(0, k.dizzy - 1);
      if (--k.blink < -7) k.blink = 180 + rand() * 240; // eyes shut for 7 frames every 3–7 s
    }
    if (s.over) return;
    s.t++;
    const me = s.cur;
    for (const k of critters) if (alive(k) && (k !== me || s.phase !== "move")) move(k, 0);
    if (s.phase === "move" && alive(me)) control(me, f);
    for (const k of critters)
      if (alive(k) && (k.x < -T || k.x > W + T || k.y < -4 * T)) faint(k), s.events.push("ouch"); // off the beam: out
    if (s.phase === "move") {
      if (--s.timer <= 0 || !alive(me)) settle();
    } else if (s.phase === "fly") {
      world.wind = s.wind;
      for (const sh of [...s.shells]) {
        if (sh.kind !== "bomb" && s.frames % 3 === 0) fx.burst(sh.x, sh.y, "rgba(255,255,255,0.6)", 1, 0.3); // a puff trail
        if (stepShell(sh, world)) s.shells.splice(s.shells.indexOf(sh), 1);
      }
      if (!s.shells.length) settle();
    } else if ((s.t > PAUSE && critters.every((k) => !alive(k) || k.ground)) || s.t > 600) {
      const left = [0, 1].filter((t) => critters.some((k) => k.team === t && alive(k)));
      if (left.length > 1) return startTurn(1 - s.team);
      s.winner = left[0] ?? -1;
      s.score = critters.reduce((n, k) => n + (k.team === s.winner ? k.hp : 0), 0);
      s.over = true;
      s.events.push("win");
    }
  }

  // ---- drawing ----
  function drawCritter(ctx: CanvasRenderingContext2D, k: Critter) {
    const color = TEAMS[k.team].color, me = k === s.cur && !s.over;
    const happy = s.over && k.team === s.winner, x = k.x, y = k.y - (happy ? Math.abs(Math.sin(s.frames / 9)) * 1.2 * u : 0);
    const walking = k.ground && s.frames - k.walked < 3;
    const step = walking ? Math.sin(k.walk / 4) : 0, cy = y - HY - Math.abs(step) * 0.15 * u;
    // where the eyes look: the aim (whoever's turn), the nearest shell (in flight), else the critter whose turn it is
    const shell = s.shells.reduce<Shell | null>((b, sh) => (!b || Math.hypot(sh.x - x, sh.y - cy) < Math.hypot(b.x - x, b.y - cy) ? sh : b), null);
    let lx = k.face, ly = 0;
    if (me && s.phase === "move") (lx = Math.cos(angle(k))), (ly = -Math.sin(angle(k)));
    else if (shell || !me) {
      const tx = shell ? shell.x : s.cur.x, ty = shell ? shell.y : s.cur.y - HY, d = Math.hypot(tx - x, ty - cy) || 1;
      if (d > u) (lx = (tx - x) / d), (ly = (ty - cy) / d);
    }
    const worried = !!shell && Math.hypot(shell.x - x, shell.y - cy) < 16 * T, dizzy = k.dizzy > 0;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 0.18 * u);
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = color; // little feet that waddle
    for (const f of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + f * 0.75 * u + f * step * 0.3 * u, y - 0.25 * u - Math.max(0, f * step) * 0.35 * u, 0.55 * u, 0.3 * u, 0, 0, Math.PI * 2);
      ctx.fill(), ctx.stroke();
    }
    ctx.translate(x, cy);
    ctx.rotate(step * 0.08);
    if (happy) // arms up
      for (const f of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(f * 1.5 * u, 0), ctx.lineTo(f * 2.3 * u, -1.3 * u);
        ctx.stroke();
      }
    ctx.beginPath(); // the blob
    ctx.ellipse(0, 0, 1.8 * u, 1.55 * u, 0, 0, Math.PI * 2);
    ctx.fill(), ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.22)"; // belly
    ctx.beginPath();
    ctx.ellipse(0, 0.6 * u, 1.1 * u, 0.75 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)"; // shine
    ctx.beginPath();
    ctx.ellipse(-1 * u, -0.85 * u, 0.32 * u, 0.2 * u, -0.6, 0, Math.PI * 2);
    ctx.fill();
    if (k.team === 0) { // a yellow bobble hat
      ctx.fillStyle = "#ffd84d";
      ctx.beginPath();
      ctx.ellipse(0, -1.15 * u, 1.3 * u, 0.95 * u, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(-1.45 * u, -1.35 * u, 2.9 * u, 0.45 * u, 0.2 * u);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0.1 * u * Math.sin(s.frames / 40 + k.x), -2.25 * u, 0.42 * u, 0, Math.PI * 2);
      ctx.fill();
    } else { // a leaf sprout, swaying
      const sway = Math.sin(s.frames / 45 + k.x) * 0.3 * u;
      ctx.strokeStyle = "#7dff8a";
      ctx.beginPath();
      ctx.moveTo(0, -1.5 * u), ctx.quadraticCurveTo(0, -2.1 * u, sway, -2.4 * u);
      ctx.stroke();
      ctx.fillStyle = "#7dff8a";
      for (const f of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sway + f * 0.45 * u, -2.5 * u, 0.55 * u, 0.25 * u, f * -0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#ffffff";
    }
    // the face, shifted a little toward where it looks
    const fx0 = lx * 0.3 * u, fy0 = -0.15 * u + ly * 0.15 * u, er = 0.52 * u;
    ctx.fillStyle = "rgba(255,120,160,0.45)"; // cheeks
    for (const f of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(fx0 + f * 1.15 * u, fy0 + 0.55 * u, 0.3 * u, 0.18 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#1a1030";
    ctx.lineWidth = Math.max(1.5, 0.14 * u);
    ctx.lineCap = "round";
    for (const f of [-1, 1]) {
      const ex = fx0 + f * 0.62 * u, ey = fy0;
      ctx.beginPath();
      if (happy) ctx.arc(ex, ey + 0.15 * u, er * 0.6, Math.PI * 1.15, Math.PI * 1.85); // ^ ^
      else if (dizzy) { // swirly eyes, turning slowly
        for (let i = 0; i <= 20; i++) {
          const a = i * 0.6 + f * s.frames / 12, rr = (i / 20) * er;
          ctx.lineTo(ex + Math.cos(a) * rr, ey + Math.sin(a) * rr);
        }
      } else if (k.blink < 0) ctx.arc(ex, ey, er * 0.7, Math.PI * 0.15, Math.PI * 0.85); // blink: closed, smiling lids
      else {
        ctx.fillStyle = "#ffffff";
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        const px = ex + lx * 0.22 * u, py = ey + ly * 0.22 * u;
        ctx.fillStyle = "#1a1030";
        ctx.beginPath();
        ctx.arc(px, py, 0.3 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px - 0.1 * u, py - 0.12 * u, 0.1 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
      }
      ctx.stroke();
      if (worried && !dizzy && !happy) { // brows up in the middle
        ctx.beginPath();
        ctx.moveTo(ex - f * 0.15 * u, ey - 0.85 * u), ctx.lineTo(ex + f * 0.45 * u, ey - 0.65 * u);
        ctx.stroke();
      }
    }
    const mx = fx0, my = fy0 + 0.7 * u;
    ctx.beginPath();
    if (happy) {
      ctx.fillStyle = "#1a1030";
      ctx.arc(mx, my - 0.1 * u, 0.4 * u, 0, Math.PI);
      ctx.fill();
    } else if (dizzy) {
      ctx.moveTo(mx - 0.4 * u, my);
      for (let i = 1; i <= 4; i++) ctx.lineTo(mx - 0.4 * u + i * 0.2 * u, my + (i % 2 ? -0.1 : 0.1) * u);
      ctx.stroke();
    } else if (worried) {
      ctx.ellipse(mx, my, 0.16 * u, 0.22 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(mx, my - 0.2 * u, 0.25 * u, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
    ctx.restore();
    // name and HP bar above
    const top = y - 5.4 * u;
    say(ctx, k.name, x, top, 1.8 * T, color, true);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(x - 1.6 * u, top + 0.5 * u, 3.2 * u, 0.4 * u);
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.6 * u, top + 0.5 * u, (3.2 * u * k.hp) / HP, 0.4 * u);
    if (me) { // a gently bobbing pointer over whoever's turn it is
      const by = top - 3.6 * T + Math.sin(s.frames / 20) * 0.5 * T;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - T, by), ctx.lineTo(x + T, by), ctx.lineTo(x, by + 1.3 * T);
      ctx.fill();
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    const k = s.cur, color = TEAMS[s.team].color, hx = k.x, hy = k.y - HY, a = angle(k);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    edges.draw(ctx);
    if (s.rope) { // the vine, with a few leaves along it
      ctx.strokeStyle = ctx.fillStyle = WEAPONS[4].color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(hx, hy), ctx.lineTo(s.rope.x, s.rope.y);
      ctx.stroke();
      const n = Math.floor(s.rope.len / (3 * T));
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        ctx.ellipse(hx + ((s.rope.x - hx) * i) / n, hy + ((s.rope.y - hy) * i) / n, 0.5 * T, 0.25 * T, i, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (!s.over && s.phase === "move" && alive(k)) {
      if (s.weapon === 4) { // where the vine would catch, or a short fading strand when it found nothing
        const t = ropeTarget(solid, T, hx, hy, a, REACH);
        ctx.strokeStyle = t ? "rgba(125,255,138,0.6)" : "rgba(255,110,156,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (t) ctx.arc(t.x, t.y, T, 0, Math.PI * 2);
        else ctx.moveTo(hx, hy), ctx.lineTo(hx + Math.cos(a) * 5 * T, hy - Math.sin(a) * 5 * T);
        ctx.stroke();
      }
      const cx = hx + Math.cos(a) * 7 * u, cy = hy - Math.sin(a) * 7 * u; // crosshair
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.9 * T, 0, Math.PI * 2);
      ctx.moveTo(cx - 1.6 * T, cy), ctx.lineTo(cx + 1.6 * T, cy), ctx.moveTo(cx, cy - 1.6 * T), ctx.lineTo(cx, cy + 1.6 * T);
      ctx.stroke();
      if (s.power) { // the charge: a wedge growing along the aim, yellow to red
        const p = (s.power - MIN_POWER) / (MAX_POWER - MIN_POWER);
        ctx.strokeStyle = `hsl(${50 - 50 * p}, 100%, 60%)`;
        ctx.lineWidth = 0.4 * u + p * 0.6 * u;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(a) * 2.2 * u, hy - Math.sin(a) * 2.2 * u);
        ctx.lineTo(hx + Math.cos(a) * (2.2 + 6 * p) * u, hy - Math.sin(a) * (2.2 + 6 * p) * u);
        ctx.stroke();
      }
    }
    for (const z of zaps) {
      ctx.globalAlpha = 1 - z.t / 20;
      ctx.strokeStyle = WEAPONS[3].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(z.x0, z.y0), ctx.lineTo(z.x1, z.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const c of critters) if (alive(c)) drawCritter(ctx, c);
    for (const sh of s.shells) drawShell(ctx, sh, 1.4 * T); // a bit larger than a tile: readable next to the critters
    fx.draw(ctx, T);
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, (70 - p.t) / 25);
      say(ctx, p.text, p.x, p.y - p.t * 0.5, 2.2 * T, p.color, true);
    }
    ctx.globalAlpha = 1;
    drawHud(ctx, color);
  }

  function drawHud(ctx: CanvasRenderingContext2D, color: string) {
    const y = 4 * T;
    TEAMS.forEach((tm, n) => { // each team's name and total HP
      const x = W * (n ? 0.78 : 0.22), hp = critters.reduce((sum, k) => sum + (k.team === n ? k.hp : 0), 0);
      say(ctx, tm.name, x, y, 2.2 * T, tm.color, true);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(x - 12 * T, y + T, 24 * T, T);
      ctx.fillStyle = tm.color;
      ctx.fillRect(x - 12 * T, y + T, (24 * T * hp) / (3 * HP), T);
    });
    const rx = W / 2, ry = y - 0.5 * T, R = 2.6 * T; // the turn timer: a ring that drains
    ctx.lineWidth = 0.6 * T;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.arc(rx, ry, R, 0, Math.PI * 2);
    ctx.stroke();
    if (!s.over && s.phase === "move") {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(rx, ry, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.timer) / TURN);
      ctx.stroke();
      say(ctx, String(Math.ceil(s.timer / 60)), rx, ry + 0.7 * T, 2 * T, "#fff", true);
    }
    const wx = W / 2 + 12 * T, len = (s.wind / 0.03) * 5 * T; // wind: an arrow, length ∝ strength
    ctx.strokeStyle = "#b0bec5";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wx - len, ry), ctx.lineTo(wx + len, ry);
    if (Math.abs(len) > T) ctx.moveTo(wx + len - Math.sign(len) * T, ry - T), ctx.lineTo(wx + len, ry), ctx.lineTo(wx + len - Math.sign(len) * T, ry + T);
    ctx.stroke();
    say(ctx, s.wind ? "wind" : "no wind", wx, ry + 3 * T, 1.4 * T, "#b0bec5");
    if (env.best) say(ctx, `best ${env.best} HP left`, W / 2 - 12 * T, ry + 0.6 * T, 1.5 * T, "#b0bec5");
    if (s.over) {
      const won = s.winner >= 0;
      say(ctx, won ? `${TEAMS[s.winner].name} win!` : "Everyone fainted: a draw!", W / 2, H * 0.4, 5 * T, won ? TEAMS[s.winner].color : "#fff", true);
      say(ctx, `${s.score} HP left${won && s.score > env.best ? " · new best!" : ""} · R = again · Esc = menu`, W / 2, H * 0.4 + 5 * T, 2.2 * T);
      return;
    }
    WEAPONS.forEach((w, n) => { // the weapon bar
      const x = W / 2 + (n - 2) * 22 * T, on = n === s.weapon, ammo = s.ammo[s.team][n];
      ctx.globalAlpha = ammo > 0 ? 1 : 0.35;
      say(ctx, `${n + 1} ${w.name}${ammo < Infinity ? ` ×${ammo}` : ""}`, x, 10.5 * T, 1.7 * T, on ? w.color : "rgba(255,255,255,0.55)", on);
      if (on) ctx.fillStyle = w.color, ctx.fillRect(x - 8 * T, 11.3 * T, 16 * T, 0.4 * T);
    });
    ctx.globalAlpha = 1;
    if (s.turns === 1 && s.phase === "move" && s.timer > TURN - 420)
      say(ctx, "←/→ walk · Enter jump · ↑/↓ aim · 1–5 weapon · hold Space to charge, let go to fire", W / 2, H * 0.3, 2.3 * T);
  }

  return { step, draw, state: s, grid: g };
}

export const clash: GameDef = {
  id: "clash",
  title: "Critter Clash",
  sub: "Two teams of blob critters take turns blasting your room's edges · last team standing",
  hint: "←/→ walk · Enter jump · ↑/↓ aim · 1–5 weapon · hold Space, let go to fire · R again",
  input: "keys",
  create: createClash,
};
