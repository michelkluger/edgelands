import { expect, test } from "bun:test";
import { GAMES } from "./index";

test("registry: every game loads, ids are unique, keyboard games come before shadow games", () => {
  expect(GAMES.length).toBe(12);
  expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
  const kinds = GAMES.map((g) => g.input).join(",");
  expect(kinds).toMatch(/^(keys,)*(shadow,?)*$/);
  for (const g of GAMES) expect(typeof g.create).toBe("function");
  // every game has its own menu letter, and none collides with setup (C V E H), Edge Runner (G) or in-game R/M
  const letters = GAMES.map((g) => g.key ?? "");
  for (const k of letters) expect(k).toMatch(/^[A-Z]$/);
  expect(new Set(letters).size).toBe(GAMES.length);
  for (const k of "CVEHGRM") expect(letters).not.toContain(k);
});
