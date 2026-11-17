// Shadow Garden: gentle rain falls; seeds on the room's ledges and the floor grow into flowers while your shadow shelters
// them. Too much rain makes a plant droop (it recovers under shelter). Calm: 2 min, score = flowers in bloom.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";

const ROUND = 2 * 60 * 60;
const PETALS = ["#ffb3de", "#ffd36e", "#d4c2ff", "#9ff3ff", "#ffb0a0", "#fff08a"]; // soft and light: never read as shadow

type Plant = { c: number; r: number; h: number; rate: number; g: number; wet: number; shelter: number; petal: string; side: number };

export function createGarden({ cols, rows, T, level, rand, best }: Env) {
  const W = cols * T, H = rows * T, plants: Plant[] = [];
  // r: the row the plant stands on (rows = the floor); h: full height in tiles; grows to bloom in 10–30 s of shelter
  const add = (c: number, r: number, h: number) =>
    plants.push({ c, r, h, rate: 1 / (60 * (10 + 20 * rand())), g: 0, wet: 0, shelter: 0, petal: PETALS[Math.floor(rand() * PETALS.length)], side: rand() < 0.5 ? -1 : 1 });
  if (level) { // ledges: tops of real edges below the upper quarter of the wall, spread out
    const tops: [number, number][] = [];
    for (let r = Math.floor(rows * 0.25); r < rows - 3; r++)
      for (let c = 3; c < cols - 3; c++) if (level.solid[r * cols + c] && !level.solid[(r - 1) * cols + c]) tops.push([c, r]);
    for (let i = tops.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [tops[i], tops[j]] = [tops[j], tops[i]];
    }
    for (const [c, r] of tops) if (plants.length < 20 && plants.every((p) => Math.abs(p.c - c) > 8 || Math.abs(p.r - r) > 4)) add(c, r, 5 + rand() * 3);
  }
  for (let c = 6; c < cols - 4; c += 10) add(c + Math.floor(rand() * 5) - 2, rows, 8 + rand() * 6);
  const drops = Array.from({ length: 220 }, () => ({ x: rand() * W, y: rand() * H, v: 3 + rand() * 2 }));
  const s = { plants, drops, frames: 0, over: false, score: 0, best, events: [] as GameEvent[] };

  function step({ mask }: Frame) {
    s.events = [];
    for (const d of drops) { // rain stops on the shadow: that's the shelter
      d.y += d.v;
      d.x += 0.4;
      const c = Math.floor(d.x / T), r = Math.floor(d.y / T);
      if (d.y > H || d.x >= W || (mask && r >= 0 && mask[r * cols + c])) (d.y = s.over ? 1e9 : -rand() * 40), (d.x = rand() * W); // round over: the rain stops
    }
    if (s.over) return;
    s.frames++;
    for (const p of plants) {
      let cov = 0;
      if (mask)
        for (let r = 0; r < p.r && !cov; r++)
          for (let c = Math.max(0, p.c - 1); c <= Math.min(cols - 1, p.c + 1); c++) if (mask[r * cols + c]) cov = 1;
      p.shelter += (cov - p.shelter) * 0.05; // the mask is noisy at its border: shelter counts after a few frames, not one
      if (p.shelter > 0.5) {
        const opening = p.g < 1;
        p.g = Math.min(1, p.g + p.rate);
        p.wet = Math.max(0, p.wet - 1 / 240);
        if (opening && p.g >= 1) s.events.push("coin");
      } else if (p.g > 0) p.wet = Math.min(1, p.wet + 1 / 1200);
    }
    s.score = plants.filter((p) => p.g >= 1).length;
    if (s.frames >= ROUND) (s.over = true), s.events.push("win");
  }

  function drawPlant(ctx: CanvasRenderingContext2D, p: Plant) {
    const x = p.c * T + T / 2, y = p.r * T, k = p.h / 10;
    if (p.g <= 0) { // a seed: shows where to give shelter
      ctx.fillStyle = "#ffe0a8";
      ctx.beginPath();
      ctx.ellipse(x, y - T * 0.4, T * 1.2, T * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const h = p.h * T * Math.min(1, p.g / 0.75), droop = p.wet * p.side;
    const tx = x + droop * h * 0.5, ty = y - h + p.wet * h * 0.3, mx = x + (tx - x) * 0.25 + droop * T, my = (y + ty) / 2 + T; // leaf spot
    ctx.strokeStyle = "#a8f5a0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x, y - h * 0.6, tx, ty);
    ctx.stroke();
    ctx.fillStyle = "#c8ffb8";
    const leaf = (lx: number, ly: number, size: number, a: number) => {
      ctx.beginPath();
      ctx.ellipse(lx, ly, size, size * 0.4, a, 0, Math.PI * 2);
      ctx.fill();
    };
    if (p.g < 0.35) leaf(tx - T * 0.6, ty, T * 0.8, -0.5), leaf(tx + T * 0.6, ty, T * 0.8, 0.5); // sprout
    else {
      const L = T * k * 1.6 * Math.min(1, (p.g - 0.35) / 0.3);
      leaf(mx - L * 0.8, my, L, -0.5 + p.wet), leaf(mx + L * 0.8, my, L, 0.5 + p.wet);
    }
    if (p.g > 0.75) { // bud opening into a bloom
      const R = T * k * (0.4 + 1.2 * ((p.g - 0.75) / 0.25));
      ctx.fillStyle = ctx.shadowColor = p.petal;
      ctx.shadowBlur = 8;
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5 + p.wet;
        ctx.beginPath();
        ctx.arc(tx + Math.cos(a) * R * 0.6, ty + Math.sin(a) * R * 0.6, R * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff6c2";
      ctx.beginPath();
      ctx.arc(tx, ty, R * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(200,235,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const d of drops) ctx.moveTo(d.x, d.y), ctx.lineTo(d.x - 0.3 * T, d.y - 3 * T);
    ctx.stroke();
    for (const p of plants) drawPlant(ctx, p);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `bold ${2 * T}px sans-serif`;
    const left = Math.max(0, Math.ceil((ROUND - s.frames) / 60));
    ctx.fillText(`✿ ${s.score} in bloom   ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}${best ? `   best ${best}` : ""}`, W / 2, 3 * T);
    if (s.over) {
      ctx.font = `bold ${5 * T}px sans-serif`;
      ctx.fillText(`Your garden: ${s.score} flower${s.score === 1 ? "" : "s"}${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.22);
      ctx.font = `${2.2 * T}px sans-serif`;
      ctx.fillText("R = again · Esc = menu", W / 2, H * 0.22 + 5 * T);
    } else if (s.frames < 300) {
      ctx.globalAlpha = Math.min(1, (300 - s.frames) / 40);
      ctx.font = `bold ${3.5 * T}px sans-serif`;
      ctx.fillText("Shelter the seeds from the rain with your shadow", W / 2, H * 0.22);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
  }

  return { step, draw, state: s };
}

export const garden: GameDef = {
  id: "garden",
  title: "Shadow Garden",
  sub: "Shelter seeds from the rain with your shadow and watch them bloom · 2 min",
  hint: "Step out of the light for the 3 s countdown, then stand over the seeds · R again · M mute",
  input: "shadow",
  create: createGarden,
};
