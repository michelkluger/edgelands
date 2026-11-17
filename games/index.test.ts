import { expect, test } from "bun:test";
import { GAMES } from "./index";

test("registry: every game loads, ids are unique, keyboard games come before shadow games", () => {
  expect(GAMES.length).toBe(14);
  expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
  const kinds = GAMES.map((g) => g.input).join(",");
  expect(kinds).toMatch(/^(keys,)*(shadow,?)*$/);
  for (const g of GAMES) expect(typeof g.create).toBe("function");
});
