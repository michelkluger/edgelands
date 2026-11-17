// The start menu, drawn on the projector canvas: a shelf of game tiles, a setup row, a detail panel for the highlighted
// item, live status. Designed at 1920×1080 and scaled. Steady glow only: no blinking.
import type { Level } from "./edges";

export type MenuItem = { id: string; key?: string; title: string; sub: string; hint?: string; blocked: string; kind: "keys" | "shadow" | "setup" };
export type MenuStatus = { label: string; ok: boolean }[];
type Rect = [number, number, number, number]; // x, y, w, h in 1920×1080 design px

const CYAN = "#7df9ff", PINK = "#ff5fd2", GOLD = "#ffd84d", DIM = "#5a6478";
const ACCENT = { keys: PINK, shadow: GOLD, setup: CYAN };
const PER_ROW = 5, X0 = 150, WIDTH = 1620;

/** Where each item sits: games in rows of 5 (keyboard first, then shadow), the setup tiles in one row below. */
export function menuLayout(items: MenuItem[]): Rect[] {
  const games = items.filter((it) => it.kind !== "setup").length, setups = items.length - games;
  const gw = (WIDTH - 20 * (PER_ROW - 1)) / PER_ROW, sy = 175 + Math.ceil(games / PER_ROW) * 112 + 10;
  const sw = (WIDTH - 20 * (setups - 1)) / setups;
  let g = 0, s = 0;
  return items.map((it) =>
    it.kind === "setup" ? [X0 + s++ * (sw + 20), sy, sw, 80] : [X0 + (g % PER_ROW) * (gw + 20), 175 + Math.floor(g++ / PER_ROW) * 112, gw, 96],
  );
}

/** Arrow keys move to the nearest tile in that direction: left/right within a row, up/down to the nearest row. */
export function moveSel(sel: number, key: string, rects: Rect[]) {
  const c = (r: Rect) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
  const [x0, y0] = c(rects[sel]);
  let best = sel, bd = Infinity;
  rects.forEach((r, i) => {
    const [x, y] = c(r), dx = x - x0, dy = y - y0;
    const ok = key === "ArrowLeft" ? dx < -1 && Math.abs(dy) < 1 : key === "ArrowRight" ? dx > 1 && Math.abs(dy) < 1
      : key === "ArrowUp" ? dy < -1 : key === "ArrowDown" ? dy > 1 : false;
    const d = Math.abs(dy) * 1e4 + Math.abs(dx);
    if (ok && d < bd) (bd = d), (best = i);
  });
  return best;
}

export function drawMenu(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  items: MenuItem[], sel: number, status: MenuStatus, level: Level | null, msg: string,
) {
  const u = Math.min(W / 1920, H / 1080);
  ctx.fillStyle = "#0b0d14";
  ctx.fillRect(0, 0, W, H);
  if (level) { // your own room's edges, faint behind everything: the menu is already "on" your wall
    const sx = W / (level.cols * level.tile), sy = H / (level.rows * level.tile);
    ctx.fillStyle = "rgba(125,249,255,0.13)";
    for (let t = 0; t < level.solid.length; t++)
      if (level.solid[t]) ctx.fillRect((t % level.cols) * level.tile * sx, Math.floor(t / level.cols) * level.tile * sy, level.tile * sx, level.tile * sy);
  }
  const text = (s: string, x: number, y: number, size: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign; glow?: number; max?: number } = {}) => {
    ctx.font = `${opts.bold ? "bold " : ""}${Math.round(size * u)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = opts.align ?? "left";
    ctx.fillStyle = ctx.shadowColor = color;
    ctx.shadowBlur = (opts.glow ?? 0) * u;
    ctx.fillText(s, x * u, y * u, opts.max ? opts.max * u : undefined);
    ctx.shadowBlur = 0;
  };
  const panel = (x: number, y: number, w: number, h: number, stroke: string, glow: boolean, fill = "rgba(20,24,36,0.85)") => {
    ctx.beginPath();
    ctx.roundRect(x * u, y * u, w * u, h * u, 14 * u);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = (glow ? 4 : 2) * u;
    ctx.strokeStyle = ctx.shadowColor = stroke;
    ctx.shadowBlur = glow ? 22 * u : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  text("EDGELANDS", 960, 110, 84, CYAN, { bold: true, align: "center", glow: 26 });
  text("games that live on your wall", 960, 150, 24, "#aab4c8", { align: "center" });

  const rects = menuLayout(items);
  items.forEach((it, i) => {
    const [x, y, w, h] = rects[i], on = i === sel, blocked = !!it.blocked, accent = ACCENT[it.kind];
    panel(x, y, w, h, blocked ? DIM : on ? accent : "rgba(125,249,255,0.3)", on, on ? "rgba(125,249,255,0.10)" : undefined);
    const keyW = it.key ? 44 : 0;
    if (it.key) {
      ctx.beginPath();
      ctx.roundRect((x + 18) * u, (y + h / 2 - 20) * u, 36 * u, 40 * u, 8 * u);
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = on ? "#fff" : DIM;
      ctx.stroke();
      text(it.key, x + 36, y + h / 2 + 10, 24, on ? "#fff" : "#aab4c8", { bold: true, align: "center" });
    }
    if (it.kind === "setup") text(it.title, x + 22 + keyW, y + h / 2 + 11, 30, blocked ? DIM : "#fff", { bold: true, max: w - 40 - keyW });
    else {
      text(it.title, x + 22 + keyW, y + 46, 30, blocked ? DIM : "#fff", { bold: true, max: w - 40 - keyW });
      text(it.kind === "keys" ? "⌨ keyboard" : "◐ shadow", x + 22 + keyW, y + 78, 20, blocked ? DIM : accent);
    }
  });

  // detail panel for the highlighted item
  const it = items[sel], dy = rects[rects.length - 1][1] + 105, accent = ACCENT[it.kind];
  panel(X0, dy, WIDTH, 150, "rgba(125,249,255,0.25)", false);
  text(it.title, X0 + 30, dy + 52, 40, "#fff", { bold: true });
  text(it.sub, X0 + 30, dy + 92, 26, "#c8d0e0", { max: WIDTH - 60 });
  text(it.blocked || (it.hint ? `Enter to start · ${it.hint}` : "Enter to start"), X0 + 30, dy + 130, 22, it.blocked ? "#ff9aa8" : accent, { max: WIDTH - 60 });

  let cx = X0;
  for (const s of status) {
    const label = `${s.ok ? "●" : "○"} ${s.label}`;
    ctx.font = `${Math.round(24 * u)}px "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(label).width / u + 36;
    ctx.beginPath();
    ctx.roundRect(cx * u, 950 * u, w * u, 44 * u, 22 * u);
    ctx.fillStyle = s.ok ? "rgba(90,255,160,0.12)" : "rgba(255,120,140,0.12)";
    ctx.fill();
    text(label, cx + 18, 980, 24, s.ok ? "#7dffb0" : "#ff9aa8");
    cx += w + 14;
  }
  if (msg) text(msg, X0, 1030, 24, "#ffe08a", { max: WIDTH });
  text("← → ↑ ↓ choose · Enter start · or press the letter · Esc back here", 960, 1068, 20, DIM, { align: "center" });
  ctx.textAlign = "start";
}
