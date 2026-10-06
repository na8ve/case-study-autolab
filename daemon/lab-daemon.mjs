#!/usr/bin/env node
// The lab, live: eight instruments streaming one fermentation run (synthetic).
//
//   node daemon/lab-daemon.mjs [--protocol protocol.json] [--for 30] [--window 30] [--speed <hours per minute>]
//                              [--fault cavitation|chiller|column|tips] [--once] [--dry-run [--windows 30]]
//                              [--url https://na8ve.com] [--key-name autolab]
//
// It runs the protocol in protocol.json through the same simulator the research
// loop scores, and streams it at a pace you choose: by default the whole 30-hour
// culture plays out in --for minutes (30), so an hour of process time is a
// minute at the console. Every --window seconds it sends one batch: a summary
// (mean, min, max, last) of each online channel, and one result from each
// sampling-line instrument whose sample came due. Faults are wear the protocol
// did not cause: a pump that cavitates, a chiller that has lost capacity, a
// fouling column, worn pipette tips.
//
// It is also the lab's controller. Before each window it looks in control/approved/
// for a recommendation a person has approved, checks its signature and its bounds
// again, and changes the set-point on the running culture (lab/control.mjs). What it
// applied, and what it refused and why, is kept in control/applied/ and control/refused/.
// A slower --speed (0.25 is four minutes an hour) leaves time to approve before the
// culture has moved on.
//
// The ingest key comes from NA8VE_INGEST_KEY or ~/.na8ve/ingest/<key-name>.key.

import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_ADJUSTABLE, MIN_GAP_H, approvalKey, checkChanges, dirs, ensureDirs, listJson, verifySignature } from "../lab/control.mjs";
import { validate } from "../lab/harness.mjs";
import { FAULTS, INSTRUMENTS, RUN, readInstrument } from "../lab/instruments.mjs";
import { HARDWARE, createRun, rng } from "../lab/physics.mjs";
import { KEY_SHAPE, ingestKey, printAlarm, send, siteUrl } from "../lab/stream.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const MINUTES = Number(opt("for", "30"));
const WINDOW_S = Number(opt("window", "30"));
const SPEED = Number(opt("speed", String(HARDWARE.runHours / MINUTES)));
const FAULT = opt("fault", "");
const URL_BASE = opt("url", process.env.NA8VE_SITE_URL || "https://na8ve.com").replace(/\/+$/, "");
const DRY = flag("dry-run");
const ONCE = flag("once");
const MAX_WINDOWS = Number(opt("windows", "0"));
const SEED = 11;

if (FAULT && !FAULTS.includes(FAULT)) {
	console.error(`--fault is one of ${FAULTS.join(", ")}`);
	process.exit(2);
}
if (!(SPEED > 0) || !(WINDOW_S >= 1)) {
	console.error("--speed and --window must be positive");
	process.exit(2);
}

let protocol;
try {
	protocol = JSON.parse(readFileSync(opt("protocol", join(ROOT, "protocol.json")), "utf8"));
} catch (e) {
	console.error(`cannot read the protocol: ${e.message}`);
	process.exit(2);
}
const problems = validate(protocol);
if (problems.length) {
	console.error(`the protocol is outside the lab's envelope, so it will not run:\n  ${problems.join("\n  ")}`);
	process.exit(2);
}

const KEY = ingestKey(opt("key-name", "autolab"));
if (!DRY && !KEY_SHAPE.test(KEY)) {
	console.error("No ingest key. Run: na8ve-agent ingest-key create autolab --alarms daemon/alarms.jsonc");
	process.exit(2);
}

const faults = FAULT ? { [FAULT]: true } : {};
const run = createRun(protocol, { seed: SEED, faults });
const dt = HARDWARE.dt;
const windowH = (SPEED * WINDOW_S) / 60;
const stepsPerWindow = Math.max(1, Math.round(windowH / dt));
const noise = ((r) => (sd) => (r() + r() + r() - 1.5) * 2 * sd)(rng(20261004));
const D = ensureDirs(ROOT);
const live = { protocol, seed: SEED, faults, atStep: 0, adjustments: [], done: false, startedAt: new Date().toISOString() };
const saveLive = () => writeFileSync(D.live, `${JSON.stringify(live)}\n`);
rmSync(D.trace, { force: true });

const fmt = (x, d) => Number(x.toFixed(d));
function windowOf(values, subject, digits, unit, device, quantity, at, tags) {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const w = { seconds: WINDOW_S, n: values.length, mean: fmt(mean, digits), min: fmt(Math.min(...values), digits), max: fmt(Math.max(...values), digits), last: fmt(values[values.length - 1], digits) };
	return { subject, unit, at, device, quantity, tags, window: w, value: w.last };
}

let lastApplied = -Infinity;
let induced = false;

/** Apply what a person has approved: signature first, then the same bounds the proposal was checked against. */
function pollControl() {
	const handled = new Set([...listJson(D.applied), ...listJson(D.refused)].map((a) => a.id));
	for (const a of listJson(D.approved)) {
		if (handled.has(a.id)) continue;
		const tH = run.index * dt;
		const why = [];
		if (!verifySignature(approvalKey(), a)) why.push("the approval's signature does not verify");
		else {
			why.push(...checkChanges(run.protocol, a.changes, { induced }));
			if (tH - lastApplied < MIN_GAP_H) why.push(`the last adjustment was less than ${MIN_GAP_H} process hour ago`);
		}
		if (why.length) {
			writeFileSync(join(D.refused, `${a.id}.json`), `${JSON.stringify({ id: a.id, refusedAtH: tH, because: why }, null, 2)}\n`);
			console.log(`  REFUSED ${a.id}: ${why.join("; ")}`);
			continue;
		}
		for (const c of a.changes) run.adjust(c.path, c.to);
		lastApplied = tH;
		live.adjustments.push({ atStep: run.index, changes: a.changes.map((c) => ({ path: c.path, to: c.to })) });
		writeFileSync(join(D.applied, `${a.id}.json`), `${JSON.stringify({ id: a.id, appliedAtH: tH, atStep: run.index, approvedBy: a.approvedBy, because: a.because, cites: a.cites, forecast: a.forecastAtApproval ?? a.forecast, changes: a.changes.map((c) => ({ path: c.path, from: c.from, to: c.to })) }, null, 2)}\n`);
		console.log(`  ADJUSTED ${a.id} at t=${tH.toFixed(1)} h, approved by ${a.approvedBy}: ${a.changes.map((c) => `${LIVE_ADJUSTABLE[c.path].device} ${LIVE_ADJUSTABLE[c.path].what} ${c.from} -> ${c.to}`).join("; ")}`);
	}
}

let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\nstopping after this window"); });
console.log(`lab daemon: ${INSTRUMENTS.length} instruments, ${INSTRUMENTS.filter((i) => i.online).length} online, ${WINDOW_S}s windows, ${fmt(SPEED, 2)} process-hours per minute, ${HARDWARE.runHours}-hour culture${FAULT ? `, fault: ${FAULT}` : ""}${DRY ? " (dry run)" : ` -> ${URL_BASE}`}; approved changes are applied from control/approved/`);

const start = Date.now();
let sent = 0;
let prevT = 0;
let end = null;
const last = {};
const TRACE = ["ms1:rq", "r1:do", "r1:temperature", "ch1:load", "fp1:ripple", "fp1:rate", "h1:acetate", "h1:titre", "fc1:viability", "pr1:od600"];
while (!stop && !live.done && !(MAX_WINDOWS && sent >= MAX_WINDOWS)) {
	pollControl();
	live.atStep = run.index;
	saveLive();
	const slice = [];
	for (let k = 0; k < stepsPerWindow; k++) {
		const s = run.step();
		if (!s) { live.done = true; break; }
		slice.push(s);
	}
	if (!slice.length) break;
	sent++;
	end = slice[slice.length - 1];
	induced = end.induced;
	const t0 = prevT;
	prevT = end.t;
	const windowStart = Date.now();
	const at = new Date(DRY ? start + sent * WINDOW_S * 1000 : Date.now() + WINDOW_S * 1000).toISOString();
	const tags = [RUN, end.phase];
	const readings = [];
	for (const inst of INSTRUMENTS) {
		if (inst.online) {
			const series = slice.map((s) => readInstrument(inst, s, { faults, noise }));
			inst.channels.forEach((ch, c) => {
				const r0 = series[0][c];
				readings.push(windowOf(series.map((x) => x[c].value), r0.subject, ch.digits, r0.unit, r0.device, r0.quantity, at, tags));
			});
		} else if (Math.floor(end.t / inst.everyH) > Math.floor(t0 / inst.everyH)) {
			const due = slice.find((s) => Math.floor(s.t / inst.everyH) > Math.floor(t0 / inst.everyH)) ?? end;
			for (const r of readInstrument(inst, due, { faults, noise })) readings.push({ ...r, at, tags });
		}
	}
	for (const r of readings) last[r.subject] = r.window ? r.window.mean : r.value;
	appendFileSync(D.trace, `${JSON.stringify({ t: end.t, atStep: run.index, v: Object.fromEntries(TRACE.filter((k) => last[k] !== undefined).map((k) => [k, last[k]])) })}\n`);
	const g = (k, d = 1) => (last[k] === undefined ? "-" : last[k].toFixed(d));
	const summary = `${at.slice(11, 19)}  t=${end.t.toFixed(1).padStart(4)}h  ${end.phase.padEnd(15)} OD ${end.od.toFixed(0).padStart(3)}  DO ${g("r1:do", 0).padStart(3)}%  RQ ${g("ms1:rq", 2)}  ripple ${g("fp1:ripple", 2)}  chiller ${g("ch1:load", 0)}%  T ${g("r1:temperature")}  | via ${g("fc1:viability", 0)}%  HPLC titre ${g("h1:titre", 2)} acetate ${g("h1:acetate", 1)}`;
	if (DRY) {
		console.log(summary);
		if (ONCE) break;
		continue;
	}
	try {
		const r = await send(readings, { key: KEY, url: URL_BASE });
		console.log(`${summary}  -> ${r.status} ${r.ok}/${readings.length}`);
		for (const a of r.alarms) printAlarm(a);
		if (r.status === 404 || r.status === 401) { console.error("the key was refused; stopping"); break; }
	} catch (e) {
		console.log(`${summary}  -> not sent (${e.name}); continuing`);
	}
	if (ONCE) break;
	const wait = windowStart + WINDOW_S * 1000 - Date.now();
	if (wait > 0) await new Promise((res) => setTimeout(res, wait));
}
if (live.done && end) {
	live.final = { t: end.t, titre: end.Ps, viability: end.viability, summary: run.summary() };
	saveLive();
	console.log(`culture complete at ${end.t.toFixed(1)} h: soluble titre ${end.Ps.toFixed(2)} g/L, viability ${end.viability.toFixed(0)}%`);
} else if (existsSync(D.live)) {
	saveLive();
}
console.log("lab daemon stopped");
