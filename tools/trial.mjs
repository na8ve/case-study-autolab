// One trial of the research loop: run protocol.json, decide keep or discard
// against the best so far, log it, and record what was learned as facts.
//
//   node tools/trial.mjs "what you changed and why you expect it to help"
//
// keep     the run is valid and its titre beats the best by MIN_GAIN: protocol.json
//          becomes the new best (.autolab/best.json)
// discard  anything else: protocol.json is put back to the best, so the next
//          edit starts from the best (--no-restore leaves it)
// refused  the protocol is outside the envelope: it is not run
//
// Every trial, kept or not, appends a row to results.tsv and writes
// memory/experiments/EXP-NNN.facts: a discarded trial is knowledge too.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KNOBS, MIN_GAIN, describeViolation, evaluate, getPath, leaves, summaryLines, validate } from "../lab/harness.mjs";

const line = ([a, r, b, t]) => `${a} | ${r} | ${b} | ${t}`;
const clean = (s, n = 240) => String(s ?? "").replace(/[|\r\n\t]+/g, " ").trim().slice(0, n);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

export function nextId(root) {
	let max = 0;
	const ledger = join(root, "results.tsv");
	if (existsSync(ledger)) for (const m of readFileSync(ledger, "utf8").matchAll(/^EXP-(\d+)\t/gm)) max = Math.max(max, Number(m[1]));
	for (const dir of ["memory/history", "memory/experiments"]) {
		const p = join(root, dir);
		if (!existsSync(p)) continue;
		for (const file of readdirSync(p)) {
			for (const m of readFileSync(join(p, file), "utf8").matchAll(/^EXP-(\d+) \|/gm)) max = Math.max(max, Number(m[1]));
		}
	}
	return `EXP-${String(max + 1).padStart(3, "0")}`;
}

const HEADER = "id\ttitre_g_l\tstatus\tviolated\tacetate_max\tdo_min\tviability_end\tdescription\n";

export function readBest(root) {
	const p = join(root, ".autolab", "best.json");
	return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Which knobs differ from the best, as [path, from, to]. */
export function changes(before, after) {
	if (!before) return [];
	return leaves(after).filter(([path, v]) => getPath(before, path) !== v).map(([path, v]) => [path, getPath(before, path), v]);
}

export function runTrial({ root = process.cwd(), protocol, description = "", faults = {}, restore = true, facts = true }) {
	root = resolve(root);
	const id = nextId(root);
	const best = readBest(root);
	const changed = changes(best?.protocol, protocol);
	const problems = validate(protocol);
	const note = clean(description) || (best ? "no description" : "the starting protocol");
	const rec = { id, description: note, changed, status: "refused", violated: [], problems };
	let result = null;
	if (!problems.length) {
		result = evaluate(protocol, { faults });
		rec.result = result;
		rec.violated = result.violated;
		const gain = best ? result.titre > best.titre * (1 + MIN_GAIN) : true;
		rec.status = result.valid && gain ? "keep" : "discard";
		rec.reason = !result.valid
			? result.violated.length ? `invalid: ${result.violated.map(describeViolation).join("; ")}` : result.induced ? "invalid: no soluble product made" : "invalid: the culture never reached the induction point"
			: gain ? (best ? `titre up from ${f(best.titre)} g/L` : "first valid protocol") : `no gain over ${f(best.titre)} g/L`;
	} else rec.reason = `refused: ${problems[0]}`;

	if (rec.status === "keep") {
		mkdirSync(join(root, ".autolab"), { recursive: true });
		writeFileSync(join(root, ".autolab", "best.json"), `${JSON.stringify({ id, titre: result.titre, protocol }, null, 2)}\n`);
	} else if (restore && best) writeFileSync(join(root, "protocol.json"), `${JSON.stringify(best.protocol, null, 2)}\n`);

	const ledger = join(root, "results.tsv");
	if (!existsSync(ledger)) writeFileSync(ledger, HEADER);
	appendFileSync(ledger, `${[id, result ? result.titre.toFixed(3) : "0.000", rec.status, rec.violated.map((v) => v.key).join(",") || "none",
		result ? result.worst.peakAcetate.toFixed(2) : "", result ? result.worst.minDo.toFixed(1) : "", result ? result.finalViability.toFixed(1) : "", note].join("\t")}\n`);

	if (facts) writeFacts(root, rec, best);
	return rec;
}

function writeFacts(root, rec, best) {
	const { id, status, result } = rec;
	const knobs = [...new Set(rec.changed.map(([p]) => KNOBS[p]).filter(Boolean))].slice(0, 4);
	const moved = (k) => rec.changed.filter(([p]) => KNOBS[p] === k).map(([p, a, b]) => `${p} from ${a} to ${b}`).join(", ");
	const out = [];
	const verdict = status === "keep" ? "Kept" : status === "refused" ? "Refused" : "Discarded";
	if (!best || !rec.changed.length) out.push([id, "tested", "Baseline protocol", `${id} ran the protocol as it stood. ${rec.description}`]);
	for (const k of knobs) out.push([id, "tested", k, `${id} tested ${k} (${moved(k)}). ${rec.description}`]);
	if (result) {
		out.push([id, "result", `${verdict}: titre ${f(result.titre)} g/L`, `${id} gave a titre of ${f(result.titre)} g/L${best ? `, against ${f(best.titre)} g/L for the best before it` : ""}; ${rec.reason}.`]);
		for (const v of rec.violated) out.push([id, "violated", v.concept, `${id} broke the ${v.key} guardrail: ${describeViolation(v)}.`]);
		for (const k of knobs) {
			const tail = result.valid ? "" : ` and an invalid run (${rec.violated.map(describeViolation).join("; ") || "no product"})`;
			out.push([id, "informs", k, `${id} informs ${k}: moving ${moved(k)}${knobs.length > 1 ? " together with other knobs" : ""} gave ${f(result.titre)} g/L${tail}.`]);
		}
	} else {
		out.push([id, "result", "Refused: outside the envelope", `${id} was refused before it ran: ${rec.problems[0]}.`]);
	}
	const dir = join(root, "memory", "experiments");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${id}.facts`), `${[`# ${id} (synthetic).`, ...out.map((x) => line(x.map((s) => clean(s, 400))))].join("\n")}\n`);
}

export function printTrial(rec, best) {
	if (rec.result) for (const l of summaryLines(rec.result)) console.log(l);
	else console.log(`---\nstatus:           refused\nproblem:          ${rec.problems[0]}`);
	console.log(`decision:         ${rec.status}`);
	console.log(`reason:           ${rec.reason}`);
	console.log(`trial:            ${rec.id}`);
	if (best) console.log(`best:             ${best.id} at ${f(best.titre, 3)} g/L`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const flags = new Set(args.filter((a) => a.startsWith("--")));
	const fi = args.indexOf("--fault");
	const fault = fi >= 0 ? args[fi + 1] : "";
	const description = args.filter((a, i) => !a.startsWith("--") && !(fi >= 0 && i === fi + 1)).join(" ");
	let protocol;
	try {
		protocol = JSON.parse(readFileSync("protocol.json", "utf8"));
	} catch (e) {
		console.error(`cannot read protocol.json: ${e.message}`);
		process.exit(2);
	}
	const rec = runTrial({ protocol, description, restore: !flags.has("--no-restore"), faults: fault ? { [fault]: true } : {}, facts: !flags.has("--no-facts") });
	printTrial(rec, readBest(process.cwd()));
	process.exit(rec.status === "refused" ? 1 : 0);
}
