// The start menu, drawn on the projector canvas: two game cards, a setup row, live status. Steady glow only: no blinking.
import type { Level } from "./edges";

export type MenuItem = { key: string; title: string; sub: string; blocked: string; game?: "runner" | "catch"; hint?: string };
export type MenuStatus = { label: string; ok: boolean }[];

const CYAN = "#7df9ff", PINK = "#ff5fd2", DIM = "#5a6478";

/** Arrow-key move through a 2-row grid: games on top (first `top` items), setup below. */
export function moveSel(sel: number, key: string, n: number, top = 2) {
  const row = sel < top ? 0 : 1, lo = row ? top : 0, hi = row ? n - 1 : top - 1;
  if (key === "ArrowLeft") return Math.max(lo, sel - 1);
  if (key === "ArrowRight") return Math.min(hi, sel + 1);
  if (key === "ArrowDown" && !row) return Math.min(n - 1, top + Math.round((sel * (n - top - 1)) / Math.max(1, top - 1)));
  if (key === "ArrowUp" && row) return Math.round(((sel - top) * (top - 1)) / Math.max(1, n - top - 1));
  return sel;
}

export function drawMenu(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  items: MenuItem[], sel: number, status: MenuStatus, level: Level | null, msg: string,
) {
  const u = Math.min(W / 1920, H / 1080); // design at 1920×1080, scale to the real projector
  ctx.fillStyle = "#0b0d14";
  ctx.fillRect(0, 0, W, H);
  if (level) { // your own room's edges, faint behind everything: the menu is already "on" your wall
    const sx = W / (level.cols * level.tile), sy = H / (level.rows * level.tile);
    ctx.fillStyle = "rgba(125,249,255,0.13)";
    for (let t = 0; t < level.solid.length; t++)
      if (level.solid[t]) ctx.fillRect((t % level.cols) * level.tile * sx, Math.floor(t / level.cols) * level.tile * sy, level.tile * sx, level.tile * sy);
  }
  const text = (s: string, x: number, y: number, size: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign; glow?: number } = {}) => {
    ctx.font = `${opts.bold ? "bold " : ""}${Math.round(size * u)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = opts.align ?? "left";
    ctx.fillStyle = ctx.shadowColor = color;
    ctx.shadowBlur = (opts.glow ?? 0) * u;
    ctx.fillText(s, x * u, y * u);
    ctx.shadowBlur = 0;
  };
  const box = (x: number, y: number, w: number, h: number, on: boolean, blocked: boolean, accent: string) => {
    ctx.beginPath();
    ctx.roundRect(x * u, y * u, w * u, h * u, 18 * u);
    ctx.fillStyle = on ? "rgba(125,249,255,0.10)" : "rgba(20,24,36,0.85)";
    ctx.fill();
    ctx.lineWidth = (on ? 4 : 2) * u;
    ctx.strokeStyle = ctx.shadowColor = blocked ? DIM : on ? accent : "rgba(125,249,255,0.35)";
    ctx.shadowBlur = on ? 24 * u : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  const keycap = (k: string, x: number, y: number, on: boolean) => {
    ctx.beginPath();
    ctx.roundRect(x * u, y * u, 52 * u, 52 * u, 10 * u);
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = on ? "#fff" : DIM;
    ctx.stroke();
    text(k, x + 26, y + 38, 30, on ? "#fff" : "#aab4c8", { bold: true, align: "center" });
  };

  text("EDGELANDS", 960, 150, 110, CYAN, { bold: true, align: "center", glow: 30 });
  text("games that live on your wall", 960, 205, 30, "#aab4c8", { align: "center" });

  // games: two big cards
  items.forEach((it, i) => {
    const on = i === sel, blocked = !!it.blocked;
    if (it.game) {
      const x = i ? 990 : 150, y = 270, w = 780, h = 330, accent = it.game === "catch" ? "#ffd84d" : PINK;
      box(x, y, w, h, on, blocked, accent);
      ctx.globalAlpha = blocked ? 0.4 : 1;
      if (it.game === "runner") icoRunner(ctx, (x + 650) * u, (y + 95) * u, u);
      else icoCatch(ctx, (x + 650) * u, (y + 110) * u, u);
      ctx.globalAlpha = 1;
      keycap(it.key, x + 40, y + 40, on);
      text(it.title, x + 40, y + 160, 64, blocked ? DIM : "#fff", { bold: true, glow: on ? 16 : 0 });
      text(it.sub, x + 40, y + 215, 30, "#c8d0e0");
      text(it.blocked || "Ready", x + 40, y + 268, 28, blocked ? "#ff9aa8" : accent, { bold: true });
      if (it.hint) text(it.hint, x + 40, y + 308, 22, "#8a94a8");
    } else {
      const w = 375, x = 150 + (i - 2) * 415, y = 650, h = 190; // 4 tiles across 150..1770
      box(x, y, w, h, on, blocked, CYAN);
      keycap(it.key, x + 28, y + 28, on);
      text(it.title, x + 100, y + 68, 38, blocked ? DIM : "#fff", { bold: true });
      text(it.blocked || it.sub, x + 28, y + 130, 24, blocked ? "#ff9aa8" : "#aab4c8");
    }
  });

  // status chips
  let cx = 150;
  ctx.font = `${Math.round(26 * u)}px "Segoe UI", system-ui, sans-serif`;
  for (const s of status) {
    const label = `${s.ok ? "●" : "○"} ${s.label}`, w = ctx.measureText(label).width / u + 40;
    ctx.beginPath();
    ctx.roundRect(cx * u, 880 * u, w * u, 48 * u, 24 * u);
    ctx.fillStyle = s.ok ? "rgba(90,255,160,0.12)" : "rgba(255,120,140,0.12)";
    ctx.fill();
    text(label, cx + 20, 913, 26, s.ok ? "#7dffb0" : "#ff9aa8");
    ctx.font = `${Math.round(26 * u)}px "Segoe UI", system-ui, sans-serif`;
    cx += w + 16;
  }
  if (msg) text(msg, 150, 985, 28, "#ffe08a");
  text("← → ↑ ↓ choose · Enter start · or press the letter · Esc back here", 960, 1050, 24, DIM, { align: "center" });
  ctx.textAlign = "start";
}

/** A tiny platform scene: neon ledges and a runner mid-jump. */
function icoRunner(ctx: CanvasRenderingContext2D, x: number, y: number, u: number) {
  ctx.lineWidth = 8 * u;
  ctx.lineCap = "round";
  ctx.strokeStyle = ctx.shadowColor = CYAN;
  ctx.shadowBlur = 14 * u;
  for (const [a, b] of [[-130, 50], [10, 90], [-30, -60]]) {
    ctx.beginPath();
    ctx.moveTo(x + a * u, y + b * u);
    ctx.lineTo(x + (a + 110) * u, y + b * u);
    ctx.stroke();
  }
  ctx.fillStyle = ctx.shadowColor = PINK;
  ctx.fillRect(x - 70 * u, y - 10 * u, 34 * u, 44 * u);
  ctx.fillStyle = ctx.shadowColor = "#ffd84d";
  ctx.beginPath();
  ctx.arc(x + 90 * u, y + 60 * u, 14 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** A shadow figure reaching for a falling star. */
function icoCatch(ctx: CanvasRenderingContext2D, x: number, y: number, u: number) {
  ctx.fillStyle = ctx.strokeStyle = "#4a5570"; // shadow grey, readable on the dark card
  ctx.beginPath();
  ctx.arc(x - 30 * u, y - 22 * u, 22 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x - 58 * u, y + 6 * u, 56 * u, 74 * u, 20 * u);
  ctx.fill();
  ctx.lineWidth = 16 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6 * u, y + 18 * u);
  ctx.lineTo(x + 46 * u, y - 36 * u);
  ctx.stroke();
  ctx.fillStyle = ctx.shadowColor = "#ffd84d";
  ctx.shadowBlur = 16 * u;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5 - Math.PI / 2, r = (k % 2 ? 0.45 : 1) * 30 * u;
    ctx.lineTo(x + 80 * u + Math.cos(a) * r, y - 62 * u + Math.sin(a) * r);
  }
  ctx.fill();
  ctx.shadowBlur = 0;
}
