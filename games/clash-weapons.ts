// Critter Clash's arsenal: the weapons, how their shells fly and pop, and how they look.
import { G, fly } from "./aim";
import { type Body, say, slide } from "./kit";

export type Kind = "rocket" | "bomb" | "pod" | "corn" | "zap";
export type Shell = Body & { kind: Kind; t: number; owner: unknown };
export const FUSE = 180; // the Boing Bomb pops 3 s after it leaves
export const WEAPONS = [
  { name: "Fizz Rocket", color: "#ff8a5c", ammo: Infinity },
  { name: "Boing Bomb", color: "#c08bff", ammo: Infinity },
  { name: "Popcorn Pod", color: "#ffe066", ammo: 2 },
  { name: "Zap-Zap", color: "#7df9ff", ammo: Infinity }, // two straight shots a turn
  { name: "Vine Swing", color: "#7dff8a", ammo: Infinity }, // a rope: moving, not a turn's shot
];
/** Per kind: blast radius in tiles, damage at the centre, knockback px/frame at the centre. */
export const BLASTS: Record<Kind, [number, number, number]> = {
  rocket: [4, 45, 6], bomb: [4.5, 50, 6.5], pod: [2, 12, 3], corn: [2.5, 20, 4], zap: [1.2, 14, 2.5],
};

export type World = {
  T: number; W: number; wind: number; rand: () => number;
  edge(c: number, r: number): boolean;
  struck(x0: number, y0: number, x1: number, y1: number, owner: unknown, t: number): boolean; // a critter on the way
  boom(x: number, y: number, kind: Kind): void;
  add(sh: Shell): void;
};

/** One frame of a shell; true when it's done (popped, or lost off a side of the beam). */
export function stepShell(sh: Shell, w: World) {
  sh.t++;
  const x0 = sh.x, y0 = sh.y;
  if (sh.kind === "bomb") { // bounces about, ignores critters and wind, pops on its fuse
    sh.vy += G;
    const vx = sh.vx, vy = sh.vy, hit = slide(sh, w.T, w.edge);
    if (hit.hitX) sh.vx = -vx * 0.5;
    if (hit.hitY) (sh.vy = Math.abs(vy) < 1 ? 0 : -vy * 0.45), (sh.vx *= 0.8);
    if (sh.t >= FUSE) return w.boom(sh.x, sh.y, "bomb"), true;
  } else {
    const hit = fly(sh, sh.kind === "corn" ? 0 : w.wind, w.T, w.edge);
    if (hit.hitX || hit.hitY || w.struck(x0, y0, sh.x, sh.y, sh.owner, sh.t)) {
      w.boom(sh.x, sh.y, sh.kind);
      if (sh.kind === "pod") // bursts into popcorn from where it was a frame ago: open air, not inside the edge
        for (let k = 0; k < 5; k++) w.add({ kind: "corn", x: x0, y: y0, vx: (k - 2) * 1.1 + w.rand() - 0.5, vy: -3.5 - w.rand() * 1.5, t: 0, owner: null });
      return true;
    }
  }
  return sh.x < -4 * w.T || sh.x > w.W + 4 * w.T || sh.t > 1200;
}

/** The Zap-Zap: an instant straight shot from (x, y) along a. Where it stops, and whether it hit something there. */
export function zapRay(w: World, x: number, y: number, a: number, owner: unknown, H: number) {
  const dx = Math.cos(a), dy = -Math.sin(a);
  for (let d = 2 * w.T; ; d += w.T / 2) {
    const px = x + dx * d, py = y + dy * d;
    if (w.edge(Math.floor(px / w.T), Math.floor(py / w.T)) || w.struck(px, py, px, py, owner, 0)) return { x: px, y: py, hit: true };
    if (px < 0 || px > w.W || py < 0 || py > H) return { x: px, y: py, hit: false };
  }
}

export function drawShell(ctx: CanvasRenderingContext2D, sh: Shell, T: number) {
  ctx.save();
  ctx.translate(sh.x, sh.y);
  if (sh.kind === "rocket") { // a chubby rocket with a white nose, pointing where it flies
    ctx.rotate(Math.atan2(sh.vy, sh.vx));
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.moveTo(-1.2 * T, -0.8 * T), ctx.lineTo(-0.4 * T, 0), ctx.lineTo(-1.2 * T, 0.8 * T);
    ctx.fill();
    ctx.fillStyle = WEAPONS[0].color;
    ctx.beginPath();
    ctx.roundRect(-1.3 * T, -0.5 * T, 2.4 * T, T, 0.5 * T);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(1.1 * T, 0, 0.45 * T, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  } else if (sh.kind === "bomb") { // a round plum with a shine and a fizzing fuse, its seconds above it
    ctx.fillStyle = WEAPONS[1].color;
    ctx.beginPath();
    ctx.arc(0, 0, T, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(-0.35 * T, -0.35 * T, 0.28 * T, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -T), ctx.quadraticCurveTo(0.4 * T, -1.6 * T, 0.8 * T, -1.5 * T);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(0.8 * T, -1.5 * T, 0.25 * T + 0.1 * T * Math.sin(sh.t / 10), 0, Math.PI * 2);
    ctx.fill();
    say(ctx, String(Math.ceil((FUSE - sh.t) / 60)), 0, -2.3 * T, 2 * T, "#fff", true);
  } else if (sh.kind === "pod") { // a corn cob, tumbling
    ctx.rotate(sh.t / 8);
    ctx.fillStyle = WEAPONS[2].color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.2 * T, 0.7 * T, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7dff8a";
    ctx.beginPath();
    ctx.ellipse(-1.1 * T, 0, 0.5 * T, 0.3 * T, 0, 0, Math.PI * 2);
    ctx.fill();
  } else { // a puff of popcorn
    ctx.fillStyle = "#fff6d5";
    for (const [x, y] of [[-0.3, 0], [0.3, 0], [0, -0.35]]) {
      ctx.beginPath();
      ctx.arc(x * T, y * T, 0.4 * T, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
