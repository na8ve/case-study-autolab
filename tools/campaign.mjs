// Campaign 1: what this lab's process group tried before you arrived, replayed
// through the same trial the loop uses, so its facts are what the harness
// measured and not what anyone remembers.
//
//   node tools/campaign.mjs            writes memory/history/campaign-1.facts
//   node tools/campaign.mjs --check    fails if that file is stale, or if the
//                                      campaign no longer ends at protocol.json
//
// The group changed one idea at a time and kept only what helped. Some ideas
// were good and lost to a guardrail; some did nothing. Nothing in it combines
// two knobs that were each tried alone, and that is where the headroom is.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTrial, readBest } from "./trial.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "memory/history/campaign-1.facts";

const START = {
	inoculum_od: 0.5, batch_glucose_g_l: 15, temperature_c: 32, ph: 7.0, airflow_vvm: 1.0, rpm_start: 400, rpm_max: 800,
	do_setpoint_pct: 30, o2_enrichment_pct: 21,
	feed: { trigger_glucose_g_l: 0.5, mu_set: 0.06, glucose_g_l: 400 },
	induction: { at_od: 25, inducer_mm: 0.1, temperature_c: 32 },
};

export const STEPS = [
	["The starting protocol, as the process group inherited it", {}],
	["Raise the feed set-point to 0.3 per hour to grow faster", { "feed.mu_set": 0.3 }],
	["Raise the feed set-point to 0.15 per hour", { "feed.mu_set": 0.15 }],
	["Enrich the gas to 30 percent oxygen", { o2_enrichment_pct: 30 }],
	["Feed set-point 0.08 per hour", { "feed.mu_set": 0.08 }],
	["Raise the growth temperature to 37 C for faster growth", { temperature_c: 37 }],
	["Lower the batch glucose to 10 g/L", { batch_glucose_g_l: 10 }],
	["Double the inoculum to OD 1.0", { inoculum_od: 1.0 }],
	["Try pH 6.6 against acetate", { ph: 6.6 }],
	["Induce at OD 15 instead of 25", { "induction.at_od": 15 }],
	["Raise the inducer to 0.8 mM for a stronger signal", { "induction.inducer_mm": 0.8 }],
	["Shift to 30 C at induction for more soluble protein", { "induction.temperature_c": 30 }],
	["Double the airflow to 2 vvm", { airflow_vvm: 2.0 }],
	["Inducer 0.2 mM", { "induction.inducer_mm": 0.2 }],
	["Induce at OD 5 to give the product longer", { "induction.at_od": 5 }],
	["Allow the agitation to reach 1000 rpm", { rpm_max: 1000 }],
	["Start the feed early, while glucose is still 2 g/L", { "feed.trigger_glucose_g_l": 2.0 }],
	["Cold shift to 24 C", { "induction.temperature_c": 24 }],
	["Feed 250 g/L glucose to keep the broth thinner", { "feed.glucose_g_l": 250 }],
	["Feed set-point 0.12 per hour", { "feed.mu_set": 0.12 }],
];

const setPath = (o, path, v) => {
	const ks = path.split(".");
	const last = ks.pop();
	ks.reduce((a, k) => a[k], o)[last] = v;
};

export function replay() {
	const tmp = mkdtempSync(join(tmpdir(), "autolab-campaign-"));
	try {
		const lines = ["# Campaign 1: the process group's trials before this loop (synthetic)."];
		for (const [note, changes] of STEPS) {
			const p = JSON.parse(JSON.stringify(readBest(tmp)?.protocol ?? START));
			for (const [k, v] of Object.entries(changes)) setPath(p, k, v);
			runTrial({ root: tmp, protocol: p, description: note, restore: false });
		}
		const dir = join(tmp, "memory", "experiments");
		for (const f of readdirSync(dir).sort()) for (const l of readFileSync(join(dir, f), "utf8").split("\n")) if (l && !l.startsWith("#")) lines.push(l);
		return { facts: `${lines.join("\n")}\n`, best: readBest(tmp), trials: STEPS.length };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const { facts, best, trials } = replay();
const shipped = JSON.parse(readFileSync(join(root, "protocol.json"), "utf8"));
if (JSON.stringify(best.protocol) !== JSON.stringify(shipped)) {
	console.error("the campaign no longer ends at protocol.json: its best is\n" + JSON.stringify(best.protocol));
	process.exit(1);
}
if (process.argv.includes("--check")) {
	const have = existsSync(join(root, OUT)) ? readFileSync(join(root, OUT), "utf8") : "";
	if (have !== facts) {
		console.error(`${OUT} is stale: run node tools/campaign.mjs`);
		process.exit(1);
	}
	console.log(`${OUT} is current (${trials} trials, best ${best.titre.toFixed(2)} g/L)`);
} else {
	mkdirSync(join(root, "memory", "history"), { recursive: true });
	writeFileSync(join(root, OUT), facts);
	console.log(`wrote ${OUT}: ${trials} trials, best ${best.titre.toFixed(2)} g/L`);
}
