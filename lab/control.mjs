// The control path: how a recommendation becomes a change on a running culture.
//
//   agent    proposes  (tools/propose.mjs)   a set-point change, with its reason and a forecast
//   person   approves  (tools/approve.mjs)   at a terminal; the approval is signed
//   daemon   applies   (daemon/lab-daemon.mjs) after checking the signature and the bounds again
//   anyone   outcome   (tools/outcome.mjs)   what the readings did afterwards, recorded as facts
//
// The controller does not trust a file. It applies a change only if the approval
// carries a valid signature from a key that lives outside the repository, the change
// is on the adjustable list, inside the envelope, small enough, and far enough from the
// last one. A proposal is never an instruction until a person has made it one.
//
// This is a gate for mistakes and for forged files, not a defence against code that
// can read the approval key. Keep that key out of the agent's reach: the agent's own
// policy should confirm any command that approves.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENVELOPE, GUARDRAILS, KNOBS, getPath } from "./harness.mjs";
import { HARDWARE, createRun } from "./physics.mjs";

/** The set-points a person can change while a culture runs, and the instrument that carries each one out. */
export const LIVE_ADJUSTABLE = {
	"feed.mu_set": { device: "Feed Pump FP-1", what: "feed set-point" },
	o2_enrichment_pct: { device: "Bioreactor R-1", what: "oxygen enrichment" },
	airflow_vvm: { device: "Bioreactor R-1", what: "airflow" },
	rpm_max: { device: "Bioreactor R-1", what: "agitation limit" },
	do_setpoint_pct: { device: "Bioreactor R-1", what: "oxygen cascade set-point" },
	ph: { device: "Bioreactor R-1", what: "pH set-point" },
	"induction.inducer_mm": { device: "Bioreactor R-1", what: "inducer dose" },
	"induction.temperature_c": { device: "Chiller CH-1", what: "cold-shift temperature" },
	temperature_c: { device: "Chiller CH-1", what: "growth temperature", beforeInduction: true },
	"induction.at_od": { device: "Bioreactor R-1", what: "induction point", beforeInduction: true },
};

export const MAX_CHANGES = 3;
/** The largest move one proposal may make to a knob, as a share of its envelope. */
export const MAX_STEP_SHARE = 0.4;
/** Process hours that must pass between two applied adjustments, so the culture's answer to one can be seen. */
export const MIN_GAP_H = 1;

export const dirs = (root) => ({
	proposals: join(root, "control", "proposals"),
	approved: join(root, "control", "approved"),
	rejected: join(root, "control", "rejected"),
	applied: join(root, "control", "applied"),
	refused: join(root, "control", "refused"),
	live: join(root, "control", "live.json"),
	trace: join(root, "control", "trace.jsonl"),
});

export function ensureDirs(root) {
	const d = dirs(root);
	for (const k of ["proposals", "approved", "rejected", "applied", "refused"]) mkdirSync(d[k], { recursive: true });
	return d;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(join(dir, f))) : []);

export function nextProposalId(root) {
	let max = 0;
	const d = dirs(root);
	for (const dir of [d.proposals, d.approved, d.rejected, d.applied, d.refused, join(root, "memory", "adjustments")]) {
		if (!existsSync(dir)) continue;
		for (const f of readdirSync(dir)) {
			const m = /^ADJ-(\d+)/.exec(f);
			if (m) max = Math.max(max, Number(m[1]));
		}
	}
	return `ADJ-${String(max + 1).padStart(3, "0")}`;
}

/** Problems with a set of changes against the protocol in force; empty means they may be made. */
export function checkChanges(inForce, changes, { induced = false } = {}) {
	const problems = [];
	if (!Array.isArray(changes) || !changes.length) return ["no change was named"];
	if (changes.length > MAX_CHANGES) problems.push(`at most ${MAX_CHANGES} changes in one proposal`);
	const seen = new Set();
	for (const c of changes) {
		const live = LIVE_ADJUSTABLE[c?.path];
		if (!live) { problems.push(`${c?.path}: not a set-point that can be changed while a culture runs`); continue; }
		if (seen.has(c.path)) problems.push(`${c.path}: named twice`);
		seen.add(c.path);
		const [lo, hi] = ENVELOPE[c.path];
		if (typeof c.to !== "number" || !Number.isFinite(c.to)) problems.push(`${c.path}: a number is required`);
		else if (c.to < lo || c.to > hi) problems.push(`${c.path}: ${c.to} is outside the envelope ${lo}..${hi}`);
		else if (Math.abs(c.to - getPath(inForce, c.path)) > MAX_STEP_SHARE * (hi - lo) + 1e-9) problems.push(`${c.path}: a move from ${getPath(inForce, c.path)} to ${c.to} is more than ${MAX_STEP_SHARE * 100}% of the envelope in one step`);
		if (live.beforeInduction && induced) problems.push(`${c.path}: the culture is already induced, so ${live.what} no longer applies`);
	}
	if (!problems.length && inForce.rpm_start > (changes.find((c) => c.path === "rpm_max")?.to ?? inForce.rpm_max)) problems.push("rpm_max: below rpm_start");
	return problems;
}

// ---- the approval key and signature ------------------------------------------------------

export const keyPath = () => join(process.env.NA8VE_HOME || join(homedir(), ".na8ve"), "lab", "approval.key");

/** The key, made on first use by a person's approval. The daemon only reads it: with no key, no approval is honoured. */
export function approvalKey({ create = false } = {}) {
	const p = keyPath();
	if (existsSync(p)) return readFileSync(p, "utf8").trim();
	if (!create) return "";
	mkdirSync(join(p, ".."), { recursive: true });
	const key = randomBytes(32).toString("hex");
	writeFileSync(p, `${key}\n`, { mode: 0o600 });
	try { chmodSync(p, 0o600); } catch { /* a filesystem without modes */ }
	return key;
}

const canonical = (a) => JSON.stringify({ id: a.id, changes: a.changes.map((c) => [c.path, c.to]), approvedBy: a.approvedBy, approvedAt: a.approvedAt });
export const sign = (key, a) => createHmac("sha256", key).update(canonical(a)).digest("hex");

export function verifySignature(key, a) {
	if (!key || typeof a?.signature !== "string" || !Array.isArray(a?.changes)) return false;
	const want = Buffer.from(sign(key, a), "hex");
	const got = Buffer.from(a.signature, "hex");
	return got.length === want.length && timingSafeEqual(got, want);
}

// ---- what the live run is, and what would happen next ---------------------------------------

/** The live run, rebuilt exactly: same protocol, seed and faults, the adjustments made at the steps they were made. */
export function replay(live, untilStep = live.atStep) {
	const run = createRun(live.protocol, { seed: live.seed, faults: live.faults });
	const adj = [...live.adjustments].sort((a, b) => a.atStep - b.atStep);
	let k = 0;
	let last = null;
	const apply = () => { while (k < adj.length && adj[k].atStep === run.index) { for (const c of adj[k].changes) run.adjust(c.path, c.to); k++; } };
	while (run.index < untilStep) {
		apply();
		last = run.step();
		if (!last) break;
	}
	apply();
	return { run, last };
}

/** Both futures of the live run from now: as it stands, and with the changes made at once. A single-seed forecast of this culture. */
export function forecast(live, changes) {
	const finish = (apply) => {
		const { run } = replay(live);
		if (apply) for (const c of changes) run.adjust(c.path, c.to);
		while (run.step());
		const s = run.summary();
		const worst = { peakAcetate: s.peakAcetate, minDo: s.minDo, minViability: s.minViability, maxVolume: s.maxVolume, maxTempDev: s.maxTempDev };
		return {
			titre: s.titre,
			violated: Object.entries(GUARDRAILS).filter(([, g]) => g.broken(worst[g.worst], g.limit)).map(([key]) => key),
			finalViability: s.finalViability,
			peakAcetate: s.peakAcetate,
			minDo: s.minDo,
		};
	};
	return { atH: live.atStep * HARDWARE.dt, unchanged: finish(false), proposed: finish(true) };
}

export const knobName = (path) => KNOBS[path] ?? path;

export function readLive(root) {
	const p = dirs(root).live;
	return existsSync(p) ? readJson(p) : null;
}
