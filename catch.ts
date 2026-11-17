// Shadow Catch: stars and bombs fall from the room's real edges; catch them with your shadow. Fixed 60 Hz steps, projector px.
import type { Level } from "./edges";

export type CatchEvent = "coin" | "secret" | "ouch" | "win";
type Item = { x: number; y: number; vy: number; kind: "star" | "gold" | "bomb"; spin: number };

// Shadows only show on a lit wall, so the whole beam is an even backdrop. Everything drawn on it stays at least as bright
// as ~60% of it, or the camera would mistake it for a shadow (shadow.ts ratio 0.55): no dark text, no dark items.
export const BACKDROP = "rgb(110,120,140)";
export const ROUND = 60 * 60; // 60 s

export function createCatch(cols: number, rows: number, T: number, level: Level | null, rand = Math.random) {
  // things fall from the tops of real edges in the upper part of the wall (the ceiling lines, the door lintel)
  const spawns: [number, number][] = [];
  if (level && level.cols === cols)
    for (let r = 2; r < rows * 0.6; r++)
      for (let c = 2; c < cols - 2; c++) if (level.solid[r * cols + c] && !level.solid[(r - 1) * cols + c]) spawns.push([c, r]);
  const items: Item[] = [], rings: { x: number; y: number; t: number }[] = [];
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  const s = { items, rings, sparks, score: 0, combo: 1, streak: 0, frames: 0, over: false, best: 0, events: [] as CatchEvent[] };

  const inShadow = (mask: Uint8Array, x: number, y: number) => {
    const c = Math.floor(x / T), r = Math.floor(y / T);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && mask[rr * cols + cc]) return true;
      }
    return false;
  };
  const burst = (x: number, y: number, color: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, v = 1 + rand() * 3;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 25 + rand() * 15, color });
    }
  };

  function step(mask: Uint8Array | null) {
    s.events = [];
    for (const q of sparks) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.1), q.life--;
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    for (const g of rings) g.t++;
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > 30) rings.splice(i, 1);
    if (s.over) return;
    s.frames++;
    const p = s.frames / ROUND; // 0 → 1 over the round: more and faster things
    if (s.frames % Math.max(15, Math.round(50 - 32 * p)) === 0) {
      const r = rand(), kind = r < 0.25 ? "bomb" : r < 0.32 ? "gold" : "star";
      const [c, row] = spawns.length ? spawns[Math.floor(rand() * spawns.length)] : [2 + Math.floor(rand() * (cols - 4)), -1];
      items.push({ x: c * T + T / 2 + (rand() - 0.5) * 2 * T, y: row * T, vy: 1.2 + 2.2 * p + rand() * 0.5, kind, spin: rand() * 6 });
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.vy;
      it.spin += 0.08;
      if (mask && inShadow(mask, it.x, it.y)) {
        items.splice(i, 1);
        if (it.kind === "bomb") {
          (s.score = Math.max(0, s.score - 5)), (s.streak = 0), (s.combo = 1);
          rings.push({ x: it.x, y: it.y, t: 0 });
          s.events.push("ouch");
        } else {
          s.score += (it.kind === "gold" ? 5 : 1) * s.combo;
          s.streak++;
          s.combo = Math.min(5, 1 + Math.floor(s.streak / 3)); // every 3 clean catches in a row: one more multiplier
          burst(it.x, it.y, it.kind === "gold" ? "#ffcc33" : "#fff27a", it.kind === "gold" ? 24 : 12);
          s.events.push(it.kind === "gold" ? "secret" : "coin");
        }
      } else if (it.y > rows * T + T) items.splice(i, 1);
    }
    if (s.frames >= ROUND) (s.over = true), s.events.push("win");
  }

  function draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null) {
    const W = cols * T, H = rows * T, f = s.frames;
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    if (mask) { // a soft cyan halo on the wall just outside your shadow: shows the camera sees you (inside it would land on you)
      ctx.fillStyle = "rgba(125,249,255,0.55)";
      for (let t = 0; t < mask.length; t++) {
        if (mask[t]) continue;
        const c = t % cols;
        if ((c > 0 && mask[t - 1]) || (c < cols - 1 && mask[t + 1]) || mask[t - cols] || mask[t + cols]) ctx.fillRect(c * T, Math.floor(t / cols) * T, T, T);
      }
    }
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.spin);
      if (it.kind === "bomb") { // bright red, never dark (a dark bomb would look like a shadow to the camera)
        ctx.fillStyle = "#ff4d6d";
        ctx.beginPath();
        ctx.arc(0, 0, 1.3 * T, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff6d5";
        ctx.fillRect(-T * 0.15, -1.9 * T, T * 0.3, T * 0.7); // fuse
      } else {
        const R = it.kind === "gold" ? 2 * T : 1.4 * T;
        ctx.fillStyle = ctx.shadowColor = it.kind === "gold" ? "#ffcc33" : "#fff27a";
        ctx.shadowBlur = it.kind === "gold" ? 14 : 6;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k * Math.PI) / 5 - Math.PI / 2, r = k % 2 ? R * 0.45 : R;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
    ctx.lineWidth = 3;
    for (const g of rings) { // bomb hit: an expanding ring, no flash
      ctx.strokeStyle = `rgba(255,120,140,${1 - g.t / 30})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, (g.t + 4) * T * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const q of sparks) {
      ctx.globalAlpha = Math.min(1, q.life / 25);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff"; // white: text must never be darker than the backdrop
    ctx.textAlign = "center";
    ctx.font = `bold ${2 * T}px sans-serif`;
    const left = Math.max(0, Math.ceil((ROUND - f) / 60));
    ctx.fillText(`★ ${s.score}   ×${s.combo}   ${left}s${s.best ? `   best ${s.best}` : ""}`, W / 2, 3 * T);
    if (s.over) {
      ctx.font = `bold ${5 * T}px sans-serif`;
      ctx.fillText(`${s.score} points${s.score > 0 && s.score >= s.best ? " · new best!" : ""}`, W / 2, H * 0.42);
      ctx.font = `${2.2 * T}px sans-serif`;
      ctx.fillText("R = again · Esc = menu", W / 2, H * 0.42 + 5 * T);
    } else if (f < 150) {
      ctx.globalAlpha = Math.min(1, (150 - f) / 40);
      ctx.font = `bold ${3.5 * T}px sans-serif`;
      ctx.fillText("Catch the stars with your shadow. Avoid the red bombs!", W / 2, H * 0.42);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
  }

  return { step, draw, state: s, spawns: spawns.length };
}
