// The contract every wall game implements, so app.ts runs them all the same way. Coordinates are projector px:
// the play area is cols×T by rows×T, and app.ts stretches it to the canvas. Fixed 60 Hz steps.
import type { Level } from "./edges";
import type { GameEvent } from "./game";

export type Env = {
  cols: number; rows: number; T: number; // tile grid; level (if any) has the same grid
  level: Level | null; // the room's edges: level.solid[r * cols + c] = 1 on an edge tile
  rand: () => number; // seeded: use it for all randomness, never Math.random
  best: number; // the saved best score (0 = none yet), to show on screen
};
export type Frame = {
  held: Set<string>; // KeyboardEvent.code of keys down now ("ArrowLeft", "KeyA", "Space", "ShiftLeft", …)
  pressed: Set<string>; // codes that went down since the last step (one-shot actions)
  mask: Uint8Array | null; // shadow games: 1 = your shadow covers this tile (cols×rows); null = no camera frame yet
};
export type WallGame = {
  step(f: Frame): void;
  draw(ctx: CanvasRenderingContext2D, mask: Uint8Array | null): void;
  // events: what happened this step, for sounds (app.ts plays them). over: round finished. score: compared with best.
  state: { events: GameEvent[]; over: boolean; score: number };
};
export type GameDef = {
  id: string;
  key?: string; // menu shortcut letter (set in games/index.ts)
  title: string;
  sub: string; // one line: what you do
  hint: string; // one line: the keys
  input: "keys" | "shadow"; // keys: needs the edge map · shadow: needs the camera and calibration (lit wall, see catch.ts BACKDROP)
  lowerIsBetter?: boolean; // e.g. golf strokes
  create(env: Env): WallGame;
};

/** A person-shaped shadow that sways slowly: lets shadow games run (and be screenshotted) without a camera. */
export function fakeMask(cols: number, rows: number, t: number) {
  const m = new Uint8Array(cols * rows), cx = cols * (0.5 + 0.3 * Math.sin(t / 120)), arm = Math.sin(t / 40);
  const put = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && (m[Math.floor(r) * cols + Math.floor(c)] = 1);
  const head = rows * 0.08;
  for (let r = rows * 0.25; r < rows; r++) for (let c = cx - cols * 0.04; c < cx + cols * 0.04; c++) put(c, r); // body
  for (let r = -head; r <= head; r++) for (let c = -head; c <= head; c++) if (r * r + c * c <= head * head) put(cx + c, rows * 0.17 + r);
  for (let k = 0; k < cols * 0.12; k++) for (let w = -1; w <= 1; w++) put(cx + k, rows * 0.32 - k * arm * 0.8 + w); // waving arm
  return m;
}
