// The control arm: a search with no model and no memory. A (1+1) hill climb that
// changes one or two knobs at random, keeps what beats the best and puts back
// what does not. It uses the same trial, the same harness and the same ledger as
// an agent does, so what it reaches is what the loop reaches by chance alone.
//
//   node tools/auto.mjs [--trials 40] [--seed 1] [--no-facts] [--quiet]
//
// It never reads memory/. An agent that does is the other arm.

import { readFileSync } from "node:fs";
import { ENVELOPE, getPath } from "../lab/harness.mjs";
import { rng } from "../lab/physics.mjs";
import { printTrial, readBest, runTrial } from "./trial.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const trials = Number(opt("trials", "40"));
const R = rng(Number(opt("seed", "1")));
const facts = !args.includes("--no-facts");
const quiet = args.includes("--quiet");

const clone = (o) => JSON.parse(JSON.stringify(o));
const setPath = (o, path, v) => {
	const ks = path.split(".");
	const last = ks.pop();
	ks.reduce((a, k) => a[k], o)[last] = v;
};
const round = (x) => Number(x.toPrecision(3));
const show = (rec) => {
	if (!quiet) printTrial(rec, readBest(process.cwd()));
	else console.log(`${rec.id} ${rec.status.padEnd(7)} ${rec.result ? rec.result.titre.toFixed(3) : "  n/a"}  ${rec.reason}`);
};

let best = readBest(process.cwd());
if (!best) {
	show(runTrial({ protocol: JSON.parse(readFileSync("protocol.json", "utf8")), description: "auto: the starting protocol", facts }));
	best = readBest(process.cwd());
	if (!best) {
		console.error("the starting protocol is not valid, so there is nothing to climb from");
		process.exit(1);
	}
}
const keys = Object.keys(ENVELOPE);
for (let i = 0; i < trials; i++) {
	const p = clone(best.protocol);
	const moved = [];
	for (let j = 0, n = 1 + Math.floor(R() * 2); j < n; j++) {
		const k = keys[Math.floor(R() * keys.length)];
		const [lo, hi] = ENVELOPE[k];
		setPath(p, k, Math.min(hi, Math.max(lo, round(getPath(p, k) + (R() + R() + R() - 1.5) * (hi - lo) * 0.2))));
		moved.push(k);
	}
	if (p.rpm_start > p.rpm_max) p.rpm_start = p.rpm_max;
	show(runTrial({ protocol: p, description: `auto: moved ${moved.join(", ")}`, facts }));
	best = readBest(process.cwd()) ?? best;
}
console.log(`\nbest ${best.id}: ${best.titre.toFixed(3)} g/L after ${trials} trials`);
