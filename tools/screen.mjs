// Spend a plate on an assay, and record what came back.
//
//   node tools/screen.mjs --plan
//   node tools/screen.mjs --assay express --library L-3 --vector pEX-03
//   node tools/screen.mjs --assay binding --where "yield_mg_l>=20" --include ExpressionValidated --limit 15
//   node tools/screen.mjs --assay thermal --variants V-332,V-377,V-340
//   node tools/screen.mjs --assay express --library L-3 --using live
//   node tools/screen.mjs --history [--check]
//
// Picking the variants is the whole decision: a binding plate holds fifteen of
// them and the library has 240. Select with the same filters `tools/query.mjs`
// takes, so what you asked memory can be what you screen.
//
// Expression uses the induction conditions of a protocol: `protocol.json` by
// default, or `--using live` for the culture that is running now, with whatever
// adjustments a person has approved on it. An assay that needs a yield refuses a
// variant that has none.
//
// Every round costs plates from a fixed budget, appends a row to campaign.tsv,
// and writes what it found to memory/screens/ as facts.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLive, replay } from "../lab/control.mjs";
import * as D from "../lab/discovery.mjs";
import { Catalogue, parseWhere } from "../lab/catalogue.mjs";
import { KEY_SHAPE, ingestKey, printAlarm, send, siteUrl } from "../lab/stream.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CATALOGUE = join(ROOT, "discovery", "catalogue.json");
const LEDGER = join(ROOT, "campaign.tsv");
const HEADER = "round\tassay\tvariants\tplates\tvector\tconditions\tfound\tnote\n";
const clean = (s, n = 300) => String(s ?? "").replace(/[|\r\n\t]+/g, " ").trim().slice(0, n);
const line = ([a, r, b, t]) => `${a} | ${r} | ${b} | ${t}`;
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const DAY = ["2026-09-21", "2026-09-22", "2026-09-24", "2026-09-28", "2026-09-29", "2026-10-01", "2026-10-02"];

/** The induction conditions an expression round runs under. */
export function conditionsFrom(root, using) {
	if (using === "live") {
		const live = readLive(root);
		if (!live) throw new Error("there is no live run: start the lab (npm run lab), or leave out --using live");
		const { run } = replay(live);
		return { temperature_c: run.protocol.induction.temperature_c, inducer_mm: run.protocol.induction.inducer_mm, source: "the running culture" };
	}
	const p = JSON.parse(readFileSync(join(root, using || "protocol.json"), "utf8"));
	return { temperature_c: p.induction.temperature_c, inducer_mm: p.induction.inducer_mm, source: using || "protocol.json" };
}
const condText = (c) => `${c.temperature_c} °C, ${c.inducer_mm} mM`;

/** A fresh catalogue holding the library and the things around it, before anything is measured. */
export function blank() {
	const r = new Catalogue();
	r.record(D.TARGET, "Target");
	r.mark(D.TARGET, "IsKinase");
	r.record(D.COUNTER_TARGET, "Target");
	r.mark(D.COUNTER_TARGET, "IsKinase");
	r.record(D.HOST, "CellLine");
	for (const [name, v] of Object.entries(D.VECTORS)) {
		r.record(name, "Vector");
		r.set(name, { note: v.note });
	}
	for (const [lib, spec] of Object.entries(D.LIBRARIES)) {
		r.record(lib, "Library");
		r.set(lib, { note: spec.what });
	}
	for (const v of D.library()) {
		r.record(v.id, "ProteinVariant");
		r.set(v.id, { library: v.library });
		r.join(v.id, "member_of", v.library);
		if (r.has(v.parent)) r.join(v.id, "derived_from", v.parent);
	}
	return r;
}

/** The variants a round is about, from the same filters the query tool takes. */
export function select(cat, a) {
	let names = [];
	if (a.variants) {
		for (const part of a.variants.split(",").map((s) => s.trim()).filter(Boolean)) {
			const range = /^([A-Za-z]+-)(\d+)\.\.(?:[A-Za-z]+-)?(\d+)$/.exec(part);
			if (range) for (let i = Number(range[2]); i <= Number(range[3]); i++) names.push(`${range[1]}${i}`);
			else names.push(part);
		}
		for (const n of names) if (!cat.has(n)) throw new Error(`no variant called "${n}"`);
	} else {
		const where = (a.where ?? []).map(parseWhere);
		if (a.library) where.push({ field: "library", op: "=", value: a.library });
		names = cat.query({ include: ["ProteinVariant", ...(a.include ?? [])], exclude: a.exclude ?? [], where, since: a.since }).map((e) => e.name);
	}
	if (a.limit) names = names.slice(0, a.limit);
	return names;
}

/** Run one round. Returns what it cost, what it measured and what it found. */
export function round(cat, { root = ROOT, assay, names, vector = D.DEFAULT_VECTOR, conditions, note = "", day }) {
	const spec = D.ASSAYS[assay];
	if (!spec) throw new Error(`the assays are: ${Object.keys(D.ASSAYS).join(", ")}`);
	if (!D.VECTORS[vector]) throw new Error(`the vectors are: ${Object.keys(D.VECTORS).join(", ")}`);
	if (!names.length) throw new Error("that selection is empty, so there is nothing to screen");
	const cap = D.capacity(assay);
	const plates = Math.ceil(names.length / cap);
	const left = cat.plates.total - cat.plates.used;
	if (plates > left) throw new Error(`${names.length} variants is ${plates} ${assay} plate(s) and ${left} are left; a ${assay} plate holds ${cap}`);

	cat.round += 1;
	const id = `R-${String(cat.round).padStart(3, "0")}`;
	const on = day ?? DAY[Math.min(DAY.length - 1, cat.round - 1)];
	const rows = [];
	let plateNo = 0;
	names.forEach((name, i) => {
		if (i % cap === 0) {
			plateNo++;
			cat.record(`Plate ${id}-${plateNo}`, "Plate");
		}
		const plate = `Plate ${id}-${plateNo}`;
		const well = D.wellsFor(cap, `${id}-${plateNo}`)[i % cap].split(":")[1];
		const lib = cat.get(name).library;
		const lat = D.latent(name, lib);
		const sample = `S-${id}-${name}`;
		cat.record(sample, "Sample");
		cat.set(sample, { well, vector, measured_on: on });
		cat.join(sample, "derived_from", name);
		cat.join(sample, "located_in", plate);
		cat.join(sample, "assayed_by", plate);

		const row = { name, sample, well, lib };
		if (assay === "express") {
			cat.set(name, { vector, measured_on: on, expressed_round: cat.round });
			cat.join(name, "cloned_into", vector);
			if (D.cloningFails(lat, vector)) {
				cat.mark(name, "CloningFailed");
				cat.unmark(name, "ExpressionValidated");
				row.failed = `an internal ${lat.internalSite} site, which is ${vector}'s own cloning site`;
			} else {
				cat.unmark(name, "CloningFailed");
				cat.join(name, "expressed_in", D.HOST);
				const y = D.assay("express", { id: name, lat, vector, conditions, well, round: cat.round }).yield_mg_l;
				cat.set(name, { yield_mg_l: y });
				row.yield_mg_l = y;
				const ok = y >= D.TARGET_PROFILE.yield_mg_l.value;
				if (ok) cat.mark(name, "ExpressionValidated");
				else cat.unmark(name, "ExpressionValidated");
				if (ok) cat.unmark(name, "LowYield");
				else cat.mark(name, "LowYield");
			}
		} else {
			const y = cat.get(name).yield_mg_l;
			if (y === undefined || y < D.TARGET_PROFILE.yield_mg_l.value) {
				row.failed = y === undefined ? "it has not been expressed" : `it expressed at only ${f(y, 1)} mg/L`;
			} else {
				const used = cat.get(name).vector ?? vector;
				const got = D.assay(assay, { id: name, lat, vector: used, conditions, well, round: cat.round });
				cat.set(name, { ...got, measured_on: on, measured_round: cat.round });
				Object.assign(row, got, { vector: used });
				if (assay === "binding") {
					cat.mark(name, "BindingScreened");
					if (got.kd_nm <= D.TARGET_PROFILE.kd_nm.value) cat.mark(name, "HighAffinity");
					else cat.unmark(name, "HighAffinity");
				}
				if (assay === "thermal") {
					cat.mark(name, "ThermalScreened");
					if (got.tm_c >= D.TARGET_PROFILE.tm_c.value) cat.mark(name, "ThermostableHit");
					else cat.unmark(name, "ThermostableHit");
				}
				if (assay === "counter") {
					cat.mark(name, "CounterScreened");
					if (got.off_ratio >= D.TARGET_PROFILE.off_ratio.value) cat.mark(name, "Selective");
					else cat.unmark(name, "Selective");
				}
			}
		}
		if (!D.missing(cat.get(name)).length) {
			cat.mark(name, "LeadCandidate");
			cat.join(name, "binds", D.TARGET);
			cat.join(name, "inhibits", D.TARGET);
		}
		rows.push(row);
	});
	cat.plates.used += plates;
	const leads = names.filter((n) => cat.labelsOf(cat.idOf(n)).includes("LeadCandidate"));
	return { id, assay, vector, conditions, plates, on, rows, leads, note: clean(note), names };
}

/** The round as facts: what was asked, what came back, and what it says about the libraries. */
export function roundFacts(cat, r) {
	const out = [];
	const libs = [...new Set(r.names.map((n) => cat.get(n).library))];
	const where = `${r.vector}${r.assay === "express" ? ` at ${condText(r.conditions)}` : ""}`;
	for (const lib of libs) out.push([r.id, "tested", lib, `${r.id} ran a ${r.assay} assay on ${r.names.filter((n) => cat.get(n).library === lib).length} variants of ${lib} in ${where}, on ${r.on}, over ${r.plates} plate(s). ${r.note}`]);
	const done = r.rows.filter((x) => !x.failed);
	const key = D.ASSAYS[r.assay].gives;
	const values = done.map((x) => x[key]).filter((v) => v !== undefined);
	const med = values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
	const refused = r.rows.filter((x) => x.failed);
	out.push([r.id, "result", `${done.length} of ${r.rows.length} assayed`, `${r.id}: ${done.length} of ${r.rows.length} variants gave a reading${med === null ? "" : `, median ${key} ${f(med)}`}${refused.length ? `; ${refused.length} did not (${clean(refused[0].failed, 80)})` : ""}.`]);
	for (const lib of libs) {
		const mine = done.filter((x) => x.lib === lib).map((x) => x[key]).filter((v) => v !== undefined);
		if (!mine.length) {
			out.push([r.id, "informs", lib, `${r.id} informs ${lib}: no variant of it gave a ${r.assay} reading in ${where}; ${clean(refused.find((x) => x.lib === lib)?.failed ?? "none was assayable", 90)}.`]);
			continue;
		}
		const sorted = [...mine].sort((a, b) => a - b);
		out.push([r.id, "informs", lib, `${r.id} informs ${lib}: its ${mine.length} ${r.assay} readings in ${where} ran from ${f(sorted[0])} to ${f(sorted[sorted.length - 1])} ${key}, median ${f(sorted[Math.floor(sorted.length / 2)])}.`]);
	}
	// Every variant the round touched gets its own fact. The catalogue is the lab's
	// instrument-side view; memory is what anyone reasons from, so nothing measured
	// may exist only in a file on this machine.
	for (const x of r.rows) {
		if (x.failed) {
			const why = x.failed.startsWith("an internal") ? "CloningFailed" : "LowYield";
			out.push([x.name, "has", why, `${x.name} gave no ${r.assay} reading in ${r.id}: ${x.failed}.`]);
			continue;
		}
		if (r.assay === "binding") out.push([x.name, "binds", D.TARGET, `${x.name} bound ${D.TARGET} at ${f(x.kd_nm)} nM in ${r.id}, measured from a ${x.vector} construct.`]);
		else out.push([x.name, "has", labelFor(r.assay, x[key]), `${x.name} read ${f(x[key])} ${key} in ${r.id} (${where}).`]);
		if (r.leads.includes(x.name)) {
			const c = cat.get(x.name);
			out.push([x.name, "has", "LeadCandidate", `${x.name} meets the whole target profile: ${f(c.kd_nm)} nM, ${f(c.tm_c, 1)} °C, ${f(c.off_ratio, 0)}-fold selective, ${f(c.yield_mg_l, 1)} mg/L from ${c.vector}.`]);
			const parent = cat.links({ from: x.name, link: "derived_from" })[0];
			if (parent) out.push([x.name, "derived_from", parent.to, `${x.name} came from ${parent.to}, in ${c.library}.`]);
		}
	}
	return out;
}
const isHit = (assay, v) => (assay === "binding" ? v <= D.TARGET_PROFILE.kd_nm.value : assay === "thermal" ? v >= D.TARGET_PROFILE.tm_c.value : assay === "counter" ? v >= D.TARGET_PROFILE.off_ratio.value : v >= D.TARGET_PROFILE.yield_mg_l.value);
/** The label a reading earns: a variant that missed is recorded as having missed, not left out. */
const labelFor = (assay, v) => {
	const hit = isHit(assay, v);
	if (assay === "thermal") return hit ? "ThermostableHit" : "ThermalScreened";
	if (assay === "counter") return hit ? "Selective" : "CounterScreened";
	return hit ? "ExpressionValidated" : "LowYield";
};

/**
 * What a round puts on the wire: one reading per variant per measurement, carrying the
 * instrument and the quantity under the lab's own names and the variant, its library and
 * the round as tags — so it arrives joined to what memory already holds about all three.
 * The same shape the culture's instruments send, the same way.
 */
export function readingsOf(cat, r) {
	const at = new Date().toISOString();
	const unit = { kd_nm: "nM", tm_c: "°C", yield_mg_l: "mg/L", off_ratio: "fold" };
	const quantity = { kd_nm: "Dissociation constant", tm_c: "Melting temperature", yield_mg_l: "Soluble yield", off_ratio: "Selectivity" };
	const device = r.assay === "express" ? "Liquid Handler LH-1" : "Plate Reader PR-1";
	const key = D.ASSAYS[r.assay].gives;
	const out = [];
	for (const x of r.rows) {
		if (x.failed || x[key] === undefined) continue;
		out.push({
			subject: `${r.assay}:${x.name}`, value: x[key], unit: unit[key], at, device, quantity: quantity[key],
			tags: [x.name, x.lib, r.id, r.vector].slice(0, 8),
			...(cat.labelsOf(cat.idOf(x.name)).includes("LeadCandidate") ? { error: "LEAD" } : {}),
		});
	}
	out.push({ subject: "screen:leads", value: r.leads.length, unit: "variants", at, device: "Plate Reader PR-1", quantity: "Lead candidates", tags: [r.id, ...libsOf(cat, r)].slice(0, 8) });
	return out;
}
const libsOf = (cat, r) => [...new Set(r.names.map((n) => cat.get(n).library))];

export function record(root, cat, r, facts = true) {
	cat.save(join(root, "discovery", "catalogue.json"));
	const ledger = join(root, "campaign.tsv");
	if (!existsSync(ledger)) writeFileSync(ledger, HEADER);
	appendFileSync(ledger, `${[r.id, r.assay, r.names.length, r.plates, r.vector, condText(r.conditions), r.leads.length, r.note || `${r.assay} on ${r.names.length} variants`].join("\t")}\n`);
	if (facts) {
		const dir = join(root, "memory", "screens");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${r.id}.facts`), `${[`# ${r.id} (synthetic).`, ...roundFacts(cat, r).map((x) => line(x.map((s) => clean(s, 400))))].join("\n")}\n`);
	}
}

// ---- campaign 2: what the lab screened before this loop -------------------------------------

/** The seven rounds the discovery group ran, replayed through the same `round` an agent uses. */
export const HISTORY = [
	{ assay: "express", library: "L-1", vector: "pEX-01", note: "the parent library, in the standard vector" },
	{ assay: "binding", library: "L-1", include: ["ExpressionValidated"], limit: 15, note: "the first fifteen of L-1 that expressed" },
	{ assay: "thermal", library: "L-1", include: ["ExpressionValidated"], note: "everything of L-1 that expressed" },
	{ assay: "express", library: "L-2", vector: "pEX-01", note: "the affinity-matured library, in the standard vector" },
	{ assay: "binding", library: "L-2", include: ["ExpressionValidated"], limit: 15, note: "the first fifteen of L-2 that expressed" },
	{ assay: "thermal", library: "L-2", include: ["ExpressionValidated", "BindingScreened"], limit: 8, note: "the first eight of L-2's binders; the plate was given over to the L-3 cloning before the rest were run" },
	{ assay: "express", library: "L-3", vector: "pEX-01", note: "the position-7 library, in the standard vector, exactly as L-1 and L-2 were run" },
];

export function replayHistory(root = ROOT) {
	const cat = blank();
	const conditions = conditionsFrom(root, "protocol.json");
	const lines = ["# Campaign 2: what the discovery group screened before this loop (synthetic)."];
	for (const step of HISTORY) {
		const names = select(cat, step);
		const r = round(cat, { root, assay: step.assay, names, vector: step.vector, conditions, note: step.note });
		for (const fact of roundFacts(cat, r)) lines.push(line(fact.map((s) => clean(s, 400))));
	}
	return { cat, facts: `${lines.join("\n")}\n`, conditions };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const argv = process.argv.slice(2);
	const one = (n, d) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
	};
	const many = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
	const flag = (n) => argv.includes(`--${n}`);
	const root = process.cwd();
	try {
		if (flag("history")) {
			const { cat, facts, conditions } = replayHistory(root);
			const out = join(root, "memory", "history", "campaign-2.facts");
			if (flag("check")) {
				const have = existsSync(out) ? readFileSync(out, "utf8") : "";
				if (have !== facts) throw new Error("memory/history/campaign-2.facts is stale: run `npm run screen -- --history`");
				console.log(`campaign 2 is current: ${cat.plates.used} of ${cat.plates.total} plates spent at ${condText(conditions)}`);
			} else {
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, facts);
				cat.save(join(root, "discovery", "catalogue.json"));
				writeFileSync(join(root, "campaign.tsv"), HEADER);
				console.log(`wrote memory/history/campaign-2.facts and discovery/catalogue.json: ${HISTORY.length} rounds, ${cat.plates.used} of ${cat.plates.total} plates spent`);
			}
			process.exit(0);
		}
		const cat = Catalogue.load(join(root, "discovery", "catalogue.json"));
		if (flag("plan") || !flag("assay")) {
			console.log(`plates: ${cat.plates.used} of ${cat.plates.total} spent, ${cat.plates.total - cat.plates.used} left; ${cat.round} rounds so far`);
			for (const [k, s] of Object.entries(D.ASSAYS)) console.log(`  ${k.padEnd(8)} ${String(D.capacity(k)).padStart(3)} variants a plate   ${s.what}`);
			const c = conditionsFrom(root, "protocol.json");
			console.log(`expression would run at ${condText(c)} (${c.source})`);
			process.exit(0);
		}
		const assay = one("assay");
		const names = select(cat, { variants: one("variants"), library: one("library"), include: many("include").flatMap((s) => s.split(",")), exclude: many("exclude").flatMap((s) => s.split(",")), where: many("where"), since: one("since"), limit: Number(one("limit", "0")) });
		const conditions = conditionsFrom(root, one("using"));
		const r = round(cat, { root, assay, names, vector: one("vector", D.DEFAULT_VECTOR), conditions, note: argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--"))).join(" ") || one("note", "") });
		record(root, cat, r, !flag("no-facts"));
		console.log(`${r.id}: ${assay} on ${names.length} variants in ${r.vector}${assay === "express" ? ` at ${condText(conditions)}` : ""}, ${r.plates} plate(s); ${cat.plates.total - cat.plates.used} left`);
		const key = D.ASSAYS[assay].gives;
		for (const x of r.rows.slice(0, 40)) console.log(`  ${x.name.padEnd(8)} ${x.well.padEnd(4)} ${x.failed ? `refused: ${x.failed}` : `${key} ${f(x[key])}${isHit(assay, x[key]) ? "   *" : ""}`}`);
		if (r.rows.length > 40) console.log(`  … ${r.rows.length - 40} more; read them with tools/query.mjs`);
		if (r.leads.length) console.log(`\nmeets the whole target profile: ${r.leads.join(", ")}`);
		console.log(`\nrecorded in memory/screens/${r.id}.facts`);

		// The plate goes to Cortex the way the culture's instruments do: same way, same
		// shape, one reading per measurement. With no key the round still stands; it is
		// seeded from its facts instead.
		const KEY = ingestKey(one("key-name", "autolab"));
		if (flag("no-stream") || !KEY_SHAPE.test(KEY)) {
			console.log(KEY ? "not streamed (--no-stream); seed the facts so the next question reads them" : "no ingest key, so nothing was streamed; seed the facts, or make a key (see the README)");
		} else {
			const readings = readingsOf(cat, r);
			try {
				const sent = await send(readings, { key: KEY, url: siteUrl(one("url")) });
				console.log(`streamed ${sent.ok}/${readings.length} readings -> ${sent.status}`);
				for (const a of sent.alarms) printAlarm(a);
				if (sent.status === 404 || sent.status === 401) console.error("the ingest key was refused");
			} catch (e) {
				console.log(`not streamed (${e.cause?.message ?? e.name}); the round is recorded locally and can be seeded`);
			}
		}
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
