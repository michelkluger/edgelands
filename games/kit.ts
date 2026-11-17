// Shared by the keyboard wall games: the room's edges as a tile grid of their own, the neon edge layer, tile collision, sparks.
import type { Env } from "../wall";

export type Body = { x: number; y: number; vx: number; vy: number };

/** A copy of the edge map (games may blast holes in it). wall(): edges, plus the floor and both sides of the beam; the sky is open. */
export function grid(env: Env) {
  const { cols, rows, T, level } = env;
  const solid = level && level.cols === cols && level.rows === rows ? level.solid.slice() : new Uint8Array(cols * rows);
  const edge = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && solid[r * cols + c] === 1;
  const wall = (c: number, r: number) => c < 0 || c >= cols || r >= rows || edge(c, r);
  return { cols, rows, T, W: cols * T, H: rows * T, solid, edge, wall };
}
export type Grid = ReturnType<typeof grid>;

/** Tops of edges: an edge tile with `room` open tiles above it, something can stand there. */
export function ledges(g: Grid, room = 3) {
  const out: [number, number][] = [];
  for (let r = room; r < g.rows; r++)
    for (let c = 1; c < g.cols - 1; c++) if (g.edge(c, r) && !Array.from({ length: room }, (_, k) => g.edge(c, r - 1 - k)).some(Boolean)) out.push([c, r]);
  return out;
}

/** The floor (row `rows`, just below the beam) at a column, lifted above any edge tiles lying on it: [c, r] like a ledge. */
export function floorAt(g: Grid, c: number): [number, number] {
  let r = g.rows;
  while (r > 1 && g.edge(c, r - 1)) r--;
  return [c, r];
}

/** Moves b by its velocity in sub-steps of under half a tile, stopping flush against wall tiles. Returns the axes that hit. */
export function slide(b: Body, T: number, wall: (c: number, r: number) => boolean) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / (T / 2.5)));
  let hitX = false, hitY = false;
  for (let i = 0; i < n; i++) {
    const nx = b.x + b.vx / n, ny = b.y + b.vy / n;
    if (!hitX && b.vx) {
      if (wall(Math.floor(nx / T), Math.floor(b.y / T))) (hitX = true), (b.x = b.vx > 0 ? Math.floor(nx / T) * T - 0.01 : (Math.floor(nx / T) + 1) * T);
      else b.x = nx;
    }
    if (!hitY && b.vy) {
      if (wall(Math.floor(b.x / T), Math.floor(ny / T))) (hitY = true), (b.y = b.vy > 0 ? Math.floor(ny / T) * T - 0.01 : (Math.floor(ny / T) + 1) * T);
      else b.y = ny;
    }
  }
  return { hitX, hitY };
}

export const keys = (set: Set<string>, ...codes: string[]) => codes.some((c) => set.has(c));

/** The room's edges as neon lines, painted once into a layer; call dirty() after the tiles change. */
export function edgeLayer(g: Grid, color: string) {
  let layer: OffscreenCanvas | null = null;
  const paint = () => {
    const { T } = g, l = new OffscreenCanvas(g.W, g.H), x = l.getContext("2d")!;
    const p = (c: number, r: number) => [c * T + T / 2, r * T + 2] as const; // on the tile top, where things rest
    x.beginPath();
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        if (!g.edge(c, r)) continue;
        let linked = false;
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
          if (!g.edge(c + dc, r + dr)) continue;
          linked = true;
          if (dc && dr && (g.edge(c + dc, r) || g.edge(c, r + dr))) continue; // corner already joined straight: no criss-cross
          x.moveTo(...p(c, r)), x.lineTo(...p(c + dc, r + dr));
        }
        if (!linked && !g.edge(c - 1, r) && !g.edge(c, r - 1) && !g.edge(c - 1, r - 1) && !g.edge(c + 1, r - 1)) x.moveTo(c * T + 1, r * T + 2), x.lineTo(c * T + T - 1, r * T + 2);
      }
    x.lineCap = x.lineJoin = "round";
    x.strokeStyle = x.shadowColor = color;
    x.lineWidth = 4;
    x.shadowBlur = 14;
    x.stroke();
    x.shadowBlur = 0;
    x.strokeStyle = "rgba(255,255,255,0.7)"; // hot core: reads as neon
    x.lineWidth = 1.5;
    x.stroke();
    return l;
  };
  return { dirty: () => void (layer = null), draw: (ctx: CanvasRenderingContext2D) => ctx.drawImage((layer ??= paint()), 0, 0) };
}

/** Sparks and expanding rings: feedback without flashing. */
export function effects(rand: () => number) {
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  const rings: { x: number; y: number; t: number; color: string; size: number }[] = [];
  return {
    burst(x: number, y: number, color: string, n: number, speed = 3) {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, v = (0.3 + rand()) * speed;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 25 + rand() * 20, color });
      }
    },
    ring: (x: number, y: number, color: string, size = 1) => void rings.push({ x, y, t: 0, color, size }),
    step() {
      for (const q of sparks) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.08), q.life--;
      for (const g of rings) g.t++;
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t > 40) rings.splice(i, 1);
    },
    draw(ctx: CanvasRenderingContext2D, T: number) {
      ctx.lineWidth = 3;
      for (const g of rings) {
        ctx.globalAlpha = 1 - g.t / 40;
        ctx.strokeStyle = g.color;
        ctx.beginPath();
        ctx.arc(g.x, g.y, (g.t + 3) * T * 0.3 * g.size, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const q of sparks) {
        ctx.globalAlpha = Math.min(1, q.life / 25);
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    },
  };
}

/** Centered text. */
export function say(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color = "#fff", bold = false) {
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.font = `${bold ? "bold " : ""}${px}px sans-serif`;
  ctx.fillText(text, x, y);
  ctx.textAlign = "start";
}
