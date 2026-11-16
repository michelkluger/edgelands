import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { evaluate } from "./tools/edge_eval";

// Edge detection vs. the hand-labelled scans (user data, so skipped when they're not on this machine).
const data = existsSync(`${import.meta.dir}/calibration/scans`) && existsSync(`${import.meta.dir}/tools/edge_truth`);
test.skipIf(!data)("edge detection keeps its score on the labelled scans", async () => {
  expect((await evaluate()).score).toBeGreaterThanOrEqual(0.8); // 0.825 when this guard was added
});
