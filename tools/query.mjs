// Ask the catalogue. One pass over the columns, with no model in it: it answers
// exactly what was asked of what has been measured, and nothing else.
//
//   node tools/query.mjs --include ProteinVariant,HighAffinity --exclude ThermalScreened
//   node tools/query.mjs --include ProteinVariant --where "kd_nm<5" --exclude ThermalScreened --since 2026-09-28
//   node tools/query.mjs --record V-332
//   node tools/query.mjs --links V-332
//   node tools/query.mjs --well R-003-1:B07
//   node tools/query.mjs --profile
//   node tools/query.mjs --shapes [ProteinVariant]
//   node tools/query.mjs --fields
//
// … with --json on any of them, and --limit n, --sort kd_nm.
//
// The question a protein engineer actually asks — "the variants we expressed last
// week that bind under 5 nM and have not been through the melt yet" — is the first
// form: what they must have, what they must not, and a test on a column. Turning
// the question into that filter is the agent's job; running it is this tool's.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Catalogue, FIELDS, KINDS, LABELS, MEASURES, parseWhere } from "../lab/catalogue.mjs";
import * as D from "../lab/discovery.mjs";

const f = (x, d = 2) => (typeof x === "number" ? x.toFixed(d) : x === undefined ? "-" : String(x));
const COLS = [["kd_nm", 2], ["tm_c", 1], ["yield_mg_l", 1], ["off_ratio", 0]];

export function describe(e) {
	const head = `${e.name.padEnd(9)} ${(e.library ?? e.kind).padEnd(16)}`;
	const nums = COLS.filter(([k]) => e[k] !== undefined).map(([k, d]) => `${k} ${f(e[k], d)}`).join("  ");
	return `${head}${nums.padEnd(46)}${e.labels.length ? `  [${e.labels.join(" ")}]` : ""}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const argv = process.argv.slice(2);
	const one = (n, d) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
	};
	const many = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? argv[i + 1].split(",") : []));
	const flag = (n) => argv.includes(`--${n}`);
	const json = flag("json");
	const out = (x, text) => (json ? console.log(JSON.stringify(x)) : text());
	try {
		if (flag("fields")) {
			out({ kinds: KINDS, labels: LABELS, measures: MEASURES, fields: FIELDS, profile: D.TARGET_PROFILE }, () => {
				console.log(`kinds:    ${KINDS.join(", ")}`);
				console.log(`labels:   ${LABELS.join(", ")}`);
				console.log(`measures: ${MEASURES.join(", ")}`);
				console.log(`fields:   ${FIELDS.join(", ")}`);
				console.log(`\nthe target profile: ${Object.entries(D.TARGET_PROFILE).map(([k, r]) => `${k} ${r.op} ${r.value}`).join(", ")}`);
			});
			process.exit(0);
		}
		const cat = Catalogue.load(join(process.cwd(), "discovery", "catalogue.json"));
		if (one("record")) {
			const name = one("record");
			const e = cat.get(name);
			const miss = e.kind === "ProteinVariant" ? D.missing(e) : [];
			out({ ...e, links: cat.links({ from: name }), missing: miss }, () => {
				console.log(`${e.name}   ${e.kind}${e.library ? ` of ${e.library}` : ""}`);
				for (const [k, v] of Object.entries(e)) if (!["id", "name", "kind", "labels"].includes(k)) console.log(`  ${k.padEnd(14)} ${typeof v === "number" ? f(v) : v}`);
				if (e.labels.length) console.log(`  labels         ${e.labels.join(", ")}`);
				for (const ed of cat.links({ from: name })) console.log(`  ${ed.link.padEnd(14)} ${ed.to}`);
				if (e.kind === "ProteinVariant") console.log(miss.length ? `  misses the profile on: ${miss.map((m) => `${m.key} (${m.why})`).join(", ")}` : "  meets the whole target profile");
			});
			process.exit(0);
		}
		if (one("links")) {
			const name = one("links");
			const all = [...cat.links({ from: name }), ...cat.links({ to: name })];
			out(all, () => all.forEach((e) => console.log(`${e.from.padEnd(18)} ${e.link.padEnd(14)} ${e.to}`)));
			process.exit(0);
		}
		if (one("well")) {
			const [plate, well] = one("well").split(":");
			const found = cat.query({ include: ["Sample"], where: [{ field: "well", op: "=", value: well ?? plate }] })
				.filter((s) => !well || cat.links({ from: s.name, link: "located_in" }).some((e) => e.to.endsWith(plate)));
			out(found, () => found.forEach((s) => console.log(`${s.name}  well ${s.well}  ${cat.links({ from: s.name, link: "derived_from" }).map((e) => e.to).join(", ")}  ${cat.links({ from: s.name, link: "located_in" }).map((e) => e.to).join(", ")}`)));
			process.exit(0);
		}
		if (flag("shapes")) {
			const kind = argv[argv.indexOf("--shapes") + 1];
			const a = cat.shapes(kind && !kind.startsWith("--") ? kind : undefined);
			out(a, () => a.forEach((x) => console.log(`${String(x.n).padStart(5)}  ${x.shape}`)));
			process.exit(0);
		}
		if (flag("profile")) {
			const vs = cat.query({ include: ["ProteinVariant"] });
			const leads = vs.filter((v) => !D.missing(v).length);
			const why = new Map();
			for (const v of vs) for (const m of D.missing(v)) why.set(m.key, (why.get(m.key) ?? 0) + 1);
			out({ leads: leads.map((l) => l.name), of: vs.length, missing: Object.fromEntries(why), plates: cat.plates }, () => {
				console.log(`the target profile: ${Object.entries(D.TARGET_PROFILE).map(([k, r]) => `${k} ${r.op} ${r.value}`).join(", ")}`);
				console.log(`${leads.length} of ${vs.length} variants meet it`);
				for (const l of leads) console.log(`  ${describe(l)}`);
				console.log("\nwhat the rest are missing (one variant can miss more than one):");
				for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${n}`);
				console.log(`\nplates: ${cat.plates.used} of ${cat.plates.total} spent`);
			});
			process.exit(0);
		}
		const rows = cat.query({ include: many("include"), exclude: many("exclude"), where: many("where").map(parseWhere), since: one("since", ""), limit: Number(one("limit", "0")) });
		const sort = one("sort");
		if (sort) rows.sort((a, b) => (a[sort] ?? Infinity) - (b[sort] ?? Infinity));
		out(rows, () => {
			rows.forEach((r) => console.log(describe(r)));
			console.log(`\n${rows.length} on record`);
		});
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
