// What the loop has done so far: counts, the guardrails it broke, and the running best.
//
//   node tools/report.mjs

import { existsSync, readFileSync } from "node:fs";

if (!existsSync("results.tsv")) {
	console.log('no trials yet: node tools/trial.mjs "the starting protocol"');
	process.exit(0);
}
const rows = readFileSync("results.tsv", "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
const count = (s) => rows.filter((r) => r[2] === s).length;
console.log(`${rows.length} trials: ${count("keep")} kept, ${count("discard")} discarded, ${count("refused")} refused`);
const why = {};
for (const r of rows) for (const v of (r[3] ?? "none").split(",")) if (v && v !== "none") why[v] = (why[v] ?? 0) + 1;
if (Object.keys(why).length) console.log(`guardrails broken: ${Object.entries(why).map(([k, n]) => `${k} ${n}`).join(", ")}`);
let top = 0;
const peak = Math.max(0.001, ...rows.filter((r) => r[2] === "keep").map((r) => Number(r[1]) || 0));
console.log("\nrunning best (g/L)");
for (const r of rows) {
	if (r[2] === "keep") top = Math.max(top, Number(r[1]));
	console.log(`${r[0]}  ${r[2].padEnd(7)} ${top.toFixed(2).padStart(6)}  ${"#".repeat(Math.round((top / peak) * 40))}`);
}
if (existsSync(".autolab/best.json")) console.log(`\nbest: ${JSON.stringify(JSON.parse(readFileSync(".autolab/best.json", "utf8")).protocol)}`);
