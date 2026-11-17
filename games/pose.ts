// Hole in the Wall: a neon pose outline closes in over 5 s; fill it with your shadow. Score per pose = shadow inside the
// pose minus a penalty for shadow outside it. 8 poses per round.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";

export const SHOW = 60, MATCH = 300, RESULT = 120, PER = SHOW + MATCH + RESULT, POSES = 8;

type Limb = [number, number]; // upper and lower segment: degrees from straight down, + = away from the body
type Spec = { arms: [Limb, Limb]; legs: [Limb, Limb]; tilt?: number };
const SPECS: Spec[] = [
  { arms: [[130, 130], [130, 130]], legs: [[25, 25], [25, 25]] }, // star jump
  { arms: [[170, 175], [170, 175]], legs: [[5, 5], [5, 5]] }, // arms up
  { arms: [[90, 90], [90, 90]], legs: [[8, 8], [8, 8]] }, // T-pose
  { arms: [[60, 100], [60, 100]], legs: [[75, 0], [75, 0]] }, // crouch
  { arms: [[100, 100], [100, 100]], legs: [[5, 5], [80, 0]] }, // one leg, knee up
  { arms: [[150, 150], [60, 60]], legs: [[15, 15], [15, 15]], tilt: 15 }, // lean
  { arms: [[170, 170], [15, 15]], legs: [[10, 10], [30, 30]] }, // one arm up
  { arms: [[90, 180], [90, 0]], legs: [[20, 20], [20, 20]] }, // zigzag
];

/** A stick figure of capsules, ~60% of the wall tall, standing on the floor, rasterized to the tile grid. */
export function makePose(spec: Spec, cols: number, rows: number, rand: () => number) {
  const h = rows * 0.6, rad = Math.PI / 180, flip = rand() < 0.5 ? -1 : 1, jit = () => (rand() - 0.5) * 16;
  const segs: number[][] = []; // x1, y1, x2, y2, radius in tiles; hip at 0,0, y down
  const sh = -0.32 * h;
  const limb = (x: number, y: number, [a, b]: Limb, side: number, l1: number, l2: number, r: number) => {
    const a1 = (a + jit()) * rad, a2 = (b + jit()) * rad, kx = x + side * Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
    segs.push([x, y, kx, ky, r], [kx, ky, kx + side * Math.sin(a2) * l2, ky + Math.cos(a2) * l2, r]);
  };
  segs.push([0, 0, 0, sh + 0.05 * h, 0.09 * h], [0, sh, 0, sh - 0.12 * h, 0.03 * h], [0, sh - 0.12 * h, 0, sh - 0.12 * h, 0.065 * h]); // torso, neck, head
  for (const [i, side] of [[0, -1], [1, 1]]) {
    limb(side * 0.07 * h, sh + 0.03 * h, spec.arms[i], side, 0.17 * h, 0.16 * h, 0.035 * h);
    limb(side * 0.04 * h, 0, spec.legs[i], side, 0.25 * h, 0.25 * h, 0.045 * h);
  }
  const ca = Math.cos((spec.tilt ?? 0) * rad), sa = Math.sin((spec.tilt ?? 0) * rad);
  for (const g of segs)
    for (const k of [0, 2]) [g[k], g[k + 1]] = [flip * (g[k] * ca - g[k + 1] * sa), g[k] * sa + g[k + 1] * ca];
  const foot = Math.max(...segs.flatMap((g) => [g[1] + g[4], g[3] + g[4]]));
  const ox = cols * (0.5 + (rand() - 0.5) * 0.3), oy = rows - foot;
  const pose = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c + 0.5 - ox, y = r + 0.5 - oy;
      for (const [x1, y1, x2, y2, R] of segs) {
        const dx = x2 - x1, dy = y2 - y1, u = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
        if ((x - x1 - u * dx) ** 2 + (y - y1 - u * dy) ** 2 <= R * R) {
          pose[r * cols + c] = 1;
          break;
        }
      }
    }
  return pose;
}

const stars = (p: number) => (p >= 85 ? 3 : p >= 65 ? 2 : p >= 40 ? 1 : 0);

export function createPose({ cols, rows, T, rand, best }: Env) {
  const order = SPECS.map((sp) => [rand(), sp] as const).sort((a, b) => a[0] - b[0]);
  const poses = order.slice(0, POSES).map(([, sp]) => makePose(sp, cols, rows, rand));
  const near = (p: Uint8Array, t: number) => { const c = t % cols; return (c > 0 && p[t - 1]) || (c < cols - 1 && p[t + 1]) || p[t - cols] || p[t + cols]; };
  // the outline sits on the wall just outside the pose, so it stays visible when your shadow fills the pose
  const rims = poses.map((p) => {
    const rim: [number, number][] = []; // outline tile, the pose tile it borders
    for (let t = 0; t < p.length; t++) {
      const c = t % cols;
      if (!p[t] && near(p, t)) rim.push([t, (c > 0 && p[t - 1]) ? t - 1 : (c < cols - 1 && p[t + 1]) ? t + 1 : p[t - cols] ? t - cols : t + cols]);
    }
    return rim;
  });
  const centers = poses.map((p) => {
    let n = 0, x = 0, y = 0;
    for (let t = 0; t < p.length; t++) if (p[t]) n++, (x += t % cols), (y += Math.floor(t / cols));
    return [(x / n + 0.5) * T, (y / n + 0.5) * T];
  });
  const cov = new Float32Array(cols * rows); // smoothed shadow per tile: the mask is noisy at its border and arrives at ~30 fps
  const s = { poses, results: [] as number[], frames: 0, over: false, score: 0, best, events: [] as GameEvent[] };

  function step({ mask }: Frame) {
    s.events = [];
    if (s.over) return;
    const i = Math.floor(s.frames / PER), t = s.frames % PER, pose = poses[i];
    if (t === 0) cov.fill(0);
    if (t >= SHOW && t < SHOW + MATCH) for (let k = 0; k < cov.length; k++) cov[k] += ((mask?.[k] ?? 0) - cov[k]) * 0.1;
    if (t === SHOW + MATCH - 1) {
      let area = 0, inside = 0, outside = 0;
      for (let k = 0; k < cov.length; k++)
        if (pose[k]) area++, (inside += cov[k]);
        else if (!near(pose, k)) outside += cov[k]; // a one-tile margin around the pose is free: the mask's border is noisy
      const p = Math.round(100 * Math.max(0, Math.min(1, (inside - 0.5 * outside) / area)));
      s.results.push(p);
      s.score += p;
      s.events.push(stars(p) === 3 ? "secret" : stars(p) ? "coin" : "ouch");
    }
    s.frames++;
    if (s.frames >= PER * POSES) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D) {
    const W = cols * T, H = rows * T, i = Math.min(POSES - 1, Math.floor(s.frames / PER)), t = s.frames % PER, pose = poses[i], rim = rims[i];
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    if (!s.over) {
      ctx.globalAlpha = Math.min(1, t / SHOW);
      if (t < SHOW + MATCH) { // the closing rim: the countdown
        const k = 1 + 0.6 * (1 - Math.max(0, t - SHOW) / MATCH), [cx, cy] = centers[i];
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(k, k);
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        for (const [k2] of rim) ctx.rect((k2 % cols) * T, Math.floor(k2 / cols) * T, T, T);
        ctx.fillStyle = "#fff27a";
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,255,255,0.18)"; // the pose's open parts: a light tint, never a dark fill
      for (let k = 0; k < pose.length; k++) if (pose[k] && cov[k] < 0.5) ctx.fillRect((k % cols) * T, Math.floor(k / cols) * T, T, T);
      for (const [color, covered] of [["#ff5fd2", false], ["#5dff9a", true]] as const) {
        ctx.beginPath();
        for (const [k, p] of rim) if (cov[p] >= 0.5 === covered) ctx.rect((k % cols) * T, Math.floor(k / cols) * T, T, T);
        ctx.fillStyle = ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `bold ${2 * T}px sans-serif`;
    ctx.fillText(`Pose ${i + 1}/${POSES}   ★ ${s.score}${best ? `   best ${best}` : ""}`, W / 2, 3 * T);
    if (s.over) {
      ctx.font = `bold ${5 * T}px sans-serif`;
      ctx.fillText(`${s.score} points${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.3);
      ctx.font = `bold ${3 * T}px sans-serif`;
      ctx.fillText(s.results.map((p) => "★".repeat(stars(p)) + "☆".repeat(3 - stars(p))).join("  "), W / 2, H * 0.3 + 5 * T);
      ctx.font = `${2.2 * T}px sans-serif`;
      ctx.fillText("R = again · Esc = menu", W / 2, H * 0.3 + 9 * T);
    } else if (t >= SHOW + MATCH) {
      const p = s.results[i] ?? 0;
      ctx.font = `bold ${5 * T}px sans-serif`;
      ctx.fillText(`${p}%  ${"★".repeat(stars(p))}${"☆".repeat(3 - stars(p))}`, W / 2, 10 * T);
    } else if (i === 0) {
      ctx.font = `bold ${3.5 * T}px sans-serif`;
      ctx.fillText("Fill the shape with your shadow before it closes in!", W / 2, 9 * T);
    }
    ctx.textAlign = "start";
  }

  return { step, draw, state: s };
}

export const pose: GameDef = {
  id: "pose",
  title: "Hole in the Wall",
  sub: "Twist your shadow into the shape before the outline closes in · 8 poses",
  hint: "Step out of the light for the 3 s countdown, then strike the pose · R again · M mute",
  input: "shadow",
  create: createPose,
};
