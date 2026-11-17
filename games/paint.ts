// Shadow Paint: the edge of your shadow leaves glowing paint that drips down onto the room's real edges. A toy: 3 min,
// score = share of the wall painted.
import { BACKDROP } from "../catch";
import type { GameEvent } from "../game";
import type { Env, Frame, GameDef } from "../wall";

const ROUND = 3 * 60 * 60;
const HOLD = 8 * 60; // frames per palette colour: a slow drift, never a flicker
// light colours only, all brighter than BACKDROP: paint must never read as shadow to the camera
const PALETTE = [[255, 143, 216], [255, 211, 110], [157, 255, 138], [127, 243, 255], [169, 164, 255], [255, 159, 138]];

export function createPaint({ cols, rows, T, level, rand, best }: Env) {
  const px = new Uint8ClampedArray(cols * rows * 4); // the paint layer: one RGBA pixel per tile, alpha 0 = bare wall
  const drips: { c: number; y: number; v: number; col: number[] }[] = [];
  const s = { px, drips, painted: 0, frames: 0, over: false, score: 0, best, events: [] as GameEvent[] };
  const stops = (c: number, r: number) => r >= rows - 1 || (!!level && level.solid[(r + 1) * cols + c] === 1); // floor or a real edge below
  const put = (t: number, col: number[]) => {
    const fresh = !px[4 * t + 3];
    if (fresh) s.painted++;
    px.set([col[0], col[1], col[2], 255], 4 * t);
    return fresh;
  };
  const colour = (ahead = 0) => {
    const k = s.frames / HOLD + ahead, i = Math.floor(k), a = PALETTE[i % 6], b = PALETTE[(i + 1) % 6];
    return a.map((v, j) => v + (b[j] - v) * (k - i));
  };

  function step({ mask }: Frame) {
    s.events = [];
    if (s.over) return;
    s.frames++;
    const col = colour();
    if (mask)
      for (let t = 0; t < mask.length; t++) {
        if (mask[t]) continue; // paint the wall just outside the shadow, where it shows
        const c = t % cols;
        if (!((c > 0 && mask[t - 1]) || (c < cols - 1 && mask[t + 1]) || mask[t - cols] || mask[t + cols])) continue;
        put(t, col);
        if (drips.length < 40 && rand() < 0.0002) drips.push({ c, y: Math.floor(t / cols), v: 0.05 + rand() * 0.1, col: colour(3) }); // the opposite palette colour: drips stand out on fresh paint
      }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i], r = Math.floor(d.y);
      if (stops(d.c, r)) { // pool on the edge
        for (let dc = -2; dc <= 2; dc++) if (d.c + dc >= 0 && d.c + dc < cols) put(r * cols + d.c + dc, d.col);
        drips.splice(i, 1);
        continue;
      }
      d.y += d.v;
      put(Math.floor(d.y) * cols + d.c, d.col);
    }
    s.score = Math.round((100 * s.painted) / (cols * rows));
    if (s.frames >= ROUND) (s.over = true), s.events.push("win");
  }

  let layer: OffscreenCanvas | null = null;
  function draw(ctx: CanvasRenderingContext2D) {
    const W = cols * T, H = rows * T;
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, W, H);
    layer ??= new OffscreenCanvas(cols, rows);
    layer.getContext("2d")!.putImageData(new ImageData(px, cols, rows), 0, 0);
    ctx.imageSmoothingEnabled = true; // stretched with smoothing: soft, glowing edges instead of tile blocks
    ctx.drawImage(layer, 0, 0, W, H);
    for (const d of drips) {
      ctx.fillStyle = `rgb(${d.col.join(",")})`;
      ctx.beginPath();
      ctx.arc(d.c * T + T / 2, d.y * T + T, T * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `bold ${2 * T}px sans-serif`;
    const left = Math.max(0, Math.ceil((ROUND - s.frames) / 60));
    ctx.fillText(`✿ ${s.score}% painted   ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}${best ? `   best ${best}%` : ""}`, W / 2, 3 * T);
    if (s.over) {
      ctx.font = `bold ${5 * T}px sans-serif`;
      ctx.fillText(`You painted ${s.score}% of the wall${s.score > 0 && s.score >= best ? " · new best!" : ""}`, W / 2, H * 0.3);
      ctx.font = `${2.2 * T}px sans-serif`;
      ctx.fillText("R = again · Esc = menu", W / 2, H * 0.3 + 5 * T);
    } else if (s.frames < 240) {
      ctx.globalAlpha = Math.min(1, (240 - s.frames) / 40);
      ctx.font = `bold ${3.5 * T}px sans-serif`;
      ctx.fillText("Move! The edge of your shadow paints the wall", W / 2, H * 0.3);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "start";
  }

  return { step, draw, state: s };
}

export const paint: GameDef = {
  id: "paint",
  title: "Shadow Paint",
  sub: "Your shadow's edge paints the wall; paint drips onto the room's edges · 3 min",
  hint: "Step out of the light for the 3 s countdown, then move · R again · M mute",
  input: "shadow",
  create: createPaint,
};
