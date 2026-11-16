// Score a candidate detector without touching the live edges.ts (the dev server hot-reloads that into the user's game).
//   bun tools/autoresearch/run.ts [absolute/path/to/candidate.ts]   (default: the live edges.ts)
import { evaluate } from "../edge_eval";
const file = process.argv[2] ?? `${import.meta.dir}/../../edges.ts`; // pass a candidate copy to compare
const { edgeTiles } = await import(file);
const t0 = performance.now();
const { rows, score } = await evaluate(edgeTiles);
const ms = (performance.now() - t0) / rows.length;
const p = (x: number) => x.toFixed(3);
for (const r of rows) console.log(`${r.scan}  P ${p(r.precision)}  R ${p(r.recall)}  hR ${p(r.hRecall)}  F1 ${p(r.f1)}  (detected ${r.detected})`);
console.log(`SCORE ${p(score)}  ~${ms.toFixed(0)} ms per scan (incl. loading)`);
