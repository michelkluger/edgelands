// Every wall game on the menu. Add one line per game (keyboard games before shadow games); app.ts does the rest.
import { createCatch } from "../catch";
import { breakout } from "./breakout";
import { marble } from "./marble";
import { pinball } from "./pinball";
import { pong } from "./pong";
import type { GameDef } from "../wall";
  breakout,
  cycles,
  pinball,
  artillery,
  golf,
  grapple,

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

export const GAMES: GameDef[] = [
  // keyboard
  breakout,
  cycles,
  pinball,
  artillery,
  golf,
  grapple,
  // shadow
  shadowCatch,
  marble,
  pong,
  bridge,
  seek,
  paint,
  garden,
  pose,
];
