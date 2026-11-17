// Every wall game on the menu. Add one line per game (keyboard games before shadow games); app.ts does the rest.
import { createCatch } from "../catch";
import type { GameDef } from "../wall";
import { breakout } from "./breakout";
import { bridge } from "./bridge";
import { clash } from "./clash";
import { cycles } from "./cycles";
import { garden } from "./garden";
import { marble } from "./marble";
import { paint } from "./paint";
import { pinball } from "./pinball";
import { pong } from "./pong";
import { pose } from "./pose";
import { seek } from "./seek";

const shadowCatch: GameDef = {
  id: "catch",
  title: "Shadow Catch",
  sub: "Catch falling stars with your shadow · 60 s",
  hint: "Step out of the light for the 3 s countdown · R again · M mute",
  input: "shadow",
  create(env) {
    const g = createCatch(env.cols, env.rows, env.T, env.level, env.rand);
    g.state.best = env.best;
    return { step: (f) => g.step(f.mask), draw: (ctx, mask) => g.draw(ctx, mask), state: g.state };
  },
};

// Menu shortcuts: one letter each. Taken elsewhere: C V E H (setup), G (Edge Runner), R M (restart, mute in games).
export const GAMES: GameDef[] = [
  // keyboard
  { ...breakout, key: "B" },
  { ...cycles, key: "L" },
  { ...pinball, key: "P" },
  { ...clash, key: "W" },
  // shadow
  { ...shadowCatch, key: "S" },
  { ...marble, key: "U" },
  { ...pong, key: "O" },
  { ...bridge, key: "I" },
  { ...seek, key: "K" },
  { ...paint, key: "N" },
  { ...garden, key: "D" },
  { ...pose, key: "X" },
];
