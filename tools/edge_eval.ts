// Scores edges.ts against hand-labelled real edges for every archived scan (the autoresearch metric).
//
//   bun tools/edge_eval.ts            → per-scan table + mean SCORE (higher is better, 0..1)
//   bun tools/edge_eval.ts --json     → machine-readable
//   bun tools/edge_eval.ts --holdout  → score the held-out walls (tools/edge_truth_holdout/): never tune on these
//
// Ground truth: tools/edge_truth/<scan>.json = { segments: [[x1,y1,x2,y2], ...] } in camera px of that scan's photo.
// Each segment is rasterised in camera space and mapped through the scan's own camera→projector table into game tiles.
// Matching tolerance: 2 tiles (labels are hand-placed). Horizontal-ish segments count double in recall: they are the
// platforms the game is built on. SCORE = F1 of (precision, weighted recall), averaged over scans.
import { readdirSync } from "node:fs";
import { fillHoles } from "../calibrate";
import { edgeTiles } from "../edges";

const ROOT = `${import.meta.dir}/..`;
const TOL = 2, MARGIN = 2; // tiles; edgeTiles ignores the 2-tile frame margin (beam border), so the truth does too

export async function evaluate(detect = edgeTiles, truthDir = `${import.meta.dir}/edge_truth`) {
  const rows: { scan: string; precision: number; recall: number; hRecall: number; f1: number; detected: number; truth: number }[] = [];
  for (const file of readdirSync(truthDir).filter((f) => f.endsWith(".json")).sort()) {
    const scan = file.replace(/\.json$/, ""), sdir = `${ROOT}/calibration/scans/${scan}`;
    const segments: number[][] = (await Bun.file(`${truthDir}/${file}`).json()).segments;
    const calib = await Bun.file(`${sdir}/calibration.json`).json();
    const [cw, ch] = calib.cam, [pw, ph] = calib.proj;
    const white = new Uint8Array(await Bun.file(`${sdir}/white.gray`).arrayBuffer());
    const lut = fillHoles(new Int16Array(await Bun.file(`${sdir}/map.bin`).arrayBuffer()), cw, ch);

    const level = detect(white, cw, ch, lut, pw, ph);
    const { cols, rows: nr, tile } = level;
    const truthW = new Map<number, number>(); // tile → weight (2 = horizontal-ish)
    for (const [x1, y1, x2, y2] of segments) {
      const w = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 2 : 1, n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2) + 1;
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x1 + ((x2 - x1) * k) / n), y = Math.round(y1 + ((y2 - y1) * k) / n);
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        const u = lut[2 * (y * cw + x)], v = lut[2 * (y * cw + x) + 1];
        if (u < 0) continue;
        const c = Math.floor(u / tile), r = Math.floor(v / tile);
        if (c < MARGIN || r < MARGIN || c >= cols - MARGIN || r >= nr - MARGIN) continue;
        truthW.set(r * cols + c, Math.max(truthW.get(r * cols + c) ?? 0, w));
      }
    }
    const near = (set: (i: number) => boolean, i: number) => {
      const c = i % cols, r = (i - c) / cols;
      for (let dr = -TOL; dr <= TOL; dr++)
        for (let dc = -TOL; dc <= TOL; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < nr && cc < cols && set(rr * cols + cc)) return true;
        }
      return false;
    };
    let det = 0, tp = 0;
    for (let i = 0; i < level.solid.length; i++) if (level.solid[i]) (det++, near((j) => truthW.has(j), i) && tp++);
    let wSum = 0, wHit = 0, hSum = 0, hHit = 0;
    for (const [i, w] of truthW) {
      const hit = near((j) => level.solid[j] === 1, i);
      (wSum += w), hit && (wHit += w);
      if (w === 2) (hSum++, hit && hHit++);
    }
    const precision = det ? tp / det : 0, recall = wSum ? wHit / wSum : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    rows.push({ scan, precision, recall, hRecall: hSum ? hHit / hSum : 1, f1, detected: det, truth: truthW.size });
  }
  return { rows, score: rows.reduce((a, r) => a + r.f1, 0) / Math.max(rows.length, 1) };
}

if (import.meta.main) {
  const { rows, score } = await evaluate(edgeTiles, process.argv.includes("--holdout") ? `${import.meta.dir}/edge_truth_holdout` : undefined);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ score, rows }));
  else {
    const p = (x: number) => x.toFixed(3);
    for (const r of rows)
      console.log(`${r.scan}  P ${p(r.precision)}  R ${p(r.recall)}  hR ${p(r.hRecall)}  F1 ${p(r.f1)}  (detected ${r.detected}, truth ${r.truth} tiles)`);
    console.log(`SCORE ${p(score)}  (mean F1 over ${rows.length} scans)`);
  }
}
