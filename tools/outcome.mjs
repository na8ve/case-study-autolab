// What an adjustment did. Closes the loop: the readings before and after the
// change, and the forecast against what the culture did, written as facts so the
// next recommendation starts from them.
//
//   node tools/outcome.mjs ADJ-001 [--hours 3] [--no-facts]
//
// It compares the mean of each traced channel over the process hours before the
// change with the same span after it (control/trace.jsonl, written by the daemon),
// and refuses to conclude from fewer than two windows on either side.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KNOBS } from "../lab/harness.mjs";
import { dirs, readLive } from "../lab/control.mjs";

const NAMES = {
	"ms1:rq": ["respiratory quotient", 2, 0.03], "r1:do": ["dissolved oxygen", 0, 3], "r1:temperature": ["reactor temperature", 1, 0.3],
	"ch1:load": ["chiller load", 0, 3], "fp1:ripple": ["pressure ripple", 2, 0.03], "fp1:rate": ["feed rate", 1, 1], "h1:acetate": ["acetate", 1, 0.2],
	"h1:titre": ["titre", 2, 0.05], "fc1:viability": ["viability", 0, 1.5], "pr1:od600": ["OD600", 0, 1],
};
const clean = (s, n = 300) => String(s ?? "").replace(/[|\r\n\t]+/g, " ").trim().slice(0, n);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function measure(root, id, { hours = 3 } = {}) {
	root = resolve(root);
	const d = dirs(root);
	const file = join(d.applied, `${id}.json`);
	if (!existsSync(file)) throw new Error(`${id} has not been applied`);
	const applied = JSON.parse(readFileSync(file, "utf8"));
	const rows = existsSync(d.trace) ? readFileSync(d.trace, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
	const before = rows.filter((r) => r.t > applied.appliedAtH - hours && r.t <= applied.appliedAtH);
	const after = rows.filter((r) => r.t > applied.appliedAtH);
	if (before.length < 2 || after.length < 2) return { applied, ready: false, reason: `too early: ${before.length} windows before the change and ${after.length} after; at least two of each are needed` };
	const span = Math.min(hours, after[after.length - 1].t - applied.appliedAtH);
	const post = after.filter((r) => r.t <= applied.appliedAtH + span);
	const moves = [];
	for (const [k, [name, digits, minMove]] of Object.entries(NAMES)) {
		const b = before.map((r) => r.v[k]).filter((x) => x !== undefined);
		const a = post.map((r) => r.v[k]).filter((x) => x !== undefined);
		if (b.length < 2 || a.length < 2) continue;
		const from = mean(b), to = mean(a);
		moves.push({ key: k, name, digits, from, to, notable: Math.abs(to - from) >= minMove });
	}
	return { applied, ready: true, span, moves, live: readLive(root) };
}

export function writeOutcome(root, id, m) {
	const { applied } = m;
	const knobs = [...new Set(applied.changes.map((c) => KNOBS[c.path] ?? c.path))];
	const moved = (k) => applied.changes.filter((c) => (KNOBS[c.path] ?? c.path) === k).map((c) => `${c.path} from ${c.from} to ${c.to}`).join(", ");
	const fmt = (x) => `${x.from.toFixed(x.digits)} to ${x.to.toFixed(x.digits)}`;
	const notable = m.moves.filter((x) => x.notable);
	const headline = notable[0] ? `${notable[0].name} ${fmt(notable[0])}` : "no visible change";
	const final = m.live?.final;
	const forecast = applied.forecast?.proposed;
	const calibration = final && forecast ? ` The forecast made when it was approved said a final titre of ${forecast.titre.toFixed(2)} g/L; the culture finished at ${final.titre.toFixed(2)} g/L.` : "";
	const lines = [`# ${id} (synthetic).`];
	for (const k of knobs) lines.push(`${id} | tested | ${k} | ${id} changed ${k} (${moved(k)}) on the live culture at t=${applied.appliedAtH.toFixed(1)} h, after a person approved it. ${clean(applied.because)}`);
	lines.push(`${id} | result | Applied: ${headline} | ${id} was applied by the lab controller and observed for ${m.span.toFixed(1)} process hours: ${notable.length ? notable.map((x) => `${x.name} went from ${fmt(x)}`).join("; ") : "no channel moved by more than its noise"}.${calibration}`);
	for (const k of knobs) lines.push(`${id} | informs | ${k} | ${id} informs ${k}: moving ${moved(k)}${knobs.length > 1 ? " together with other knobs" : ""} on the live culture, ${notable.length ? notable.map((x) => `${x.name} went from ${fmt(x)}`).join("; ") : "no channel moved by more than its noise"} over ${m.span.toFixed(1)} process hours.`);
	mkdirSync(join(root, "memory", "adjustments"), { recursive: true });
	writeFileSync(join(root, "memory", "adjustments", `${id}.facts`), `${lines.join("\n")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const id = args.find((a) => /^ADJ-\d+$/.test(a));
	if (!id) { console.error("usage: node tools/outcome.mjs ADJ-001 [--hours 3] [--no-facts]"); process.exit(2); }
	const hi = args.indexOf("--hours");
	try {
		const m = measure(process.cwd(), id, { hours: hi >= 0 ? Number(args[hi + 1]) : 3 });
		if (!m.ready) { console.log(m.reason); process.exit(0); }
		console.log(`${id}, applied at t=${m.applied.appliedAtH.toFixed(1)} h; ${m.span.toFixed(1)} process hours either side`);
		for (const x of m.moves) console.log(`  ${x.name.padEnd(22)} ${x.from.toFixed(x.digits).padStart(8)} -> ${x.to.toFixed(x.digits).padStart(8)}${x.notable ? "   *" : ""}`);
		if (!args.includes("--no-facts")) { writeOutcome(process.cwd(), id, m); console.log(`recorded in memory/adjustments/${id}.facts: seed it so the next recommendation can read it`); }
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
