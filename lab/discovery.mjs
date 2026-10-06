// The discovery side of the lab: a library of engineered binders against one
// target, and what an assay returns when you spend a plate on one of them.
//
// Read-only for the research loop, like the harness. The traits here are LATENT:
// nothing reads them but an assay, and an assay costs plate budget and carries
// noise, so the only way to learn a variant is to screen it.
//
// A variant is an abstract code over eight engineered positions. There are no
// sequences anywhere in this lab, real or invented: a position holds a small
// integer, and the model says what that integer does to binding, stability,
// aggregation and selectivity. Everything is synthetic, and no real target,
// binder, vector, cell line or measurement is described.
//
// The three designed facts of this library, which the lab's memory states in
// other words and an agent has to put together:
//
//   1. affinity and stability trade off at positions 3, 4 and 6
//   2. the position-7 substitution repairs stability in that background,
//      and raises aggregation
//   3. an aggregation-prone construct will not express solubly under the
//      standard induction, and does under a colder, gentler one
//
// So the best binder in the library is invisible until the expression
// conditions change, which is a decision about equipment, not about screening.

import { solubleShare } from "./physics.mjs";

export const TARGET = "Kinase TK-7";
export const COUNTER_TARGET = "Kinase TK-3";
export const HOST = "Expression host EC-B";
export const POSITIONS = 8;
export const PLATE_FORMAT = 384;
/** Wells a plate keeps for its controls. */
export const CONTROL_WELLS = 24;

/** What the campaign is looking for. A candidate meets all four. */
export const TARGET_PROFILE = {
	kd_nm: { op: "<=", value: 5, what: "binds the target at or below 5 nM" },
	tm_c: { op: ">=", value: 60, what: "melts at or above 60 °C" },
	off_ratio: { op: ">=", value: 100, what: "is at least 100-fold selective over the counter-target" },
	yield_mg_l: { op: ">=", value: 20, what: "expresses solubly at or above 20 mg/L" },
};

/** The expression vectors the lab sub-clones into, and what each one costs you. */
export const VECTORS = {
	"pEX-01": { yield: 1.00, tagBias: 1.6, site: "BsaI", fusion: false, note: "the standard vector; its purification tag is left on, and a tagged construct reads weaker in the binding assay" },
	"pEX-02": { yield: 0.55, tagBias: 1.0, site: "BsaI", fusion: false, note: "secretes to the periplasm and the tag is cleaved, so the binding assay reads true; the yield is about half" },
	"pEX-03": { yield: 0.80, tagBias: 1.0, site: "BsmBI", fusion: true, note: "a solubility fusion partner, cleaved after capture; it carries an aggregation-prone construct that the others cannot" },
	"pEX-04": { yield: 1.35, tagBias: 1.6, site: "BsaI", fusion: false, note: "codon-optimised for the host and the highest yielding; its cloning site is the same enzyme as pEX-01's" },
};
export const DEFAULT_VECTOR = "pEX-01";

export const LIBRARIES = {
	"L-1": { from: 101, n: 80, what: "the parent library: the scaffold with eight positions varied broadly" },
	"L-2": { from: 201, n: 80, what: "affinity-matured from the best of L-1, selected on binding alone" },
	"L-3": { from: 301, n: 80, what: "the L-2 background carrying the position-7 substitution" },
};

/**
 * What an assay costs in wells, which is what makes the plate budget bite.
 * A binding measurement is a dose-response curve in triplicate, so fifteen
 * variants fill a plate; an expression check is three wells, so a whole library
 * fits on one. Choosing which fifteen is the decision this lab is about.
 */
export const ASSAYS = {
	express: { wells: 3, what: "sub-clone, express and purify", gives: "yield_mg_l", needs: null },
	binding: { wells: 24, what: "measure the dissociation constant against the target", gives: "kd_nm", needs: "yield_mg_l" },
	thermal: { wells: 3, what: "measure the melting temperature", gives: "tm_c", needs: "yield_mg_l" },
	counter: { wells: 12, what: "counter-screen against the counter-target", gives: "off_ratio", needs: "yield_mg_l" },
};
/** How many variants one plate of that assay holds. */
export const capacity = (kind) => Math.floor((PLATE_FORMAT - CONTROL_WELLS) / ASSAYS[kind].wells);

function hash(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}
/** A seeded stream, so a variant's code and an assay's noise are the same every run. */
function stream(seed) {
	let a = hash(String(seed)) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** What each choice at each position does. Index: [position][choice]. */
const W_BIND = [
	[0, 0.10, 0.18, 0.08], [0, 0.12, 0.05, 0.20],
	[0, 0.55, 0.80, 0.30], [0, 0.62, 0.88, 0.25], // 3 and 4: the affinity positions
	[0, 0.15, 0.22, 0.10], [0, 0.48, 0.74, 0.20], // 6: the third affinity position
	[0, 0.05, 0.12, 0.08], [0, 0.04, 0.10, 0.06],
];
const W_STAB = [
	[0, 0.10, 0.05, 0.12], [0, 0.08, 0.14, 0.06],
	[0, -0.42, -0.70, -0.15], [0, -0.50, -0.78, -0.12], // the cost of affinity
	[0, 0.12, 0.06, 0.10], [0, -0.38, -0.66, -0.10],
	[0, 0.15, 0.10, 0.08], [0, 0.10, 0.12, 0.05],
];
const W_AGG = [
	[0, 0.03, 0.06, 0.02], [0, 0.04, 0.02, 0.05],
	[0, 0.08, 0.14, 0.04], [0, 0.07, 0.12, 0.03],
	[0, 0.03, 0.05, 0.02], [0, 0.06, 0.11, 0.03],
	[0, 0.02, 0.04, 0.03], [0, 0.03, 0.02, 0.04],
];
const W_OFF = [
	[0, 0.10, 0.05, 0.14], [0, 0.22, 0.34, 0.08],
	[0, 0.06, 0.02, 0.12], [0, 0.05, 0.03, 0.10],
	[0, 0.26, 0.40, 0.09], [0, 0.04, 0.02, 0.08],
	[0, 0.12, 0.18, 0.06], [0, 0.08, 0.14, 0.05],
];
/** Position 7, choice 2: the substitution that repairs stability in the matured background, and aggregates. */
const REPAIR = { position: 6, choice: 2, stability: 1.55, aggregation: 0.42 };

const sum = (w, code) => code.reduce((a, c, i) => a + w[i][c], 0);

/** A variant's code: eight small integers, biased by the library it came from. */
export function codeOf(id, library) {
	const r = stream(`${id}|code`);
	const code = [];
	for (let i = 0; i < POSITIONS; i++) {
		let c = Math.floor(r() * 4);
		if (library !== "L-1" && [2, 3, 5].includes(i) && r() < 0.78) c = r() < 0.55 ? 2 : 1; // matured on binding
		if (library === "L-3" && i === REPAIR.position) c = REPAIR.choice;
		if (library === "L-1" && [2, 3, 5].includes(i) && r() < 0.35) c = 0;
		code.push(c);
	}
	return code;
}

/** What a variant really is. Nothing outside this file may read it except through an assay. */
export function latent(id, library) {
	const code = codeOf(id, library);
	const bind = sum(W_BIND, code);
	let stab = sum(W_STAB, code);
	let agg = sum(W_AGG, code);
	if (code[REPAIR.position] === REPAIR.choice) {
		stab += REPAIR.stability;
		agg += REPAIR.aggregation;
	}
	const off = sum(W_OFF, code);
	const r = stream(`${id}|lot`);
	return {
		code,
		kd_nm: 42 * Math.exp(-1.35 * bind) * (0.9 + 0.2 * r()),
		tm_c: 58 + 7.5 * stab + 1.2 * (r() - 0.5),
		aggregation: Math.max(0, Math.min(1.4, agg)),
		off_ratio: 12 * Math.exp(2.6 * off) * (0.85 + 0.3 * r()),
		/** A construct carrying an internal site for that enzyme cannot be cloned into a vector that cuts with it. */
		internalSite: r() < 0.14 ? "BsaI" : null,
	};
}

export const cloningFails = (lat, vector) => lat.internalSite !== null && VECTORS[vector].site === lat.internalSite;

/**
 * What the expression run gives. `conditions` comes from a protocol: the induction
 * temperature and the inducer dose. An aggregation-prone construct needs a colder,
 * gentler induction, or the fusion vector, or it comes out as inclusion bodies.
 */
export function expressionYield(lat, vector, conditions) {
	const v = VECTORS[vector];
	const T = conditions.temperature_c;
	const dose = conditions.inducer_mm;
	const soluble = solubleShare(T);
	const rescue = v.fusion ? 0.55 : 0;
	const strain = Math.max(0, lat.aggregation - rescue) * (0.45 + 1.9 * dose) * (1 + Math.max(0, T - 26) / 7);
	const base = 58 * v.yield * (0.75 + 0.5 * Math.min(1, dose / 0.3));
	return Math.max(0, base * soluble * Math.exp(-1.35 * strain));
}

/** One assay reading: the latent value, as the instrument sees it. */
export function assay(kind, { id, lat, vector, conditions, well, round }) {
	const r = stream(`${id}|${kind}|${round}|${well}`);
	const noise = (cv) => 1 + cv * (r() + r() + r() - 1.5) * 1.1;
	const edge = /^(A|P)|(01|24)$/.test(well) ? 1.9 : 1; // an edge well is noisier
	if (kind === "express") return { yield_mg_l: Number((expressionYield(lat, vector, conditions) * noise(0.09 * edge)).toFixed(1)) };
	if (kind === "binding") return { kd_nm: Number((lat.kd_nm * VECTORS[vector].tagBias * noise(0.12 * edge)).toFixed(2)) };
	if (kind === "thermal") return { tm_c: Number((lat.tm_c + (r() - 0.5) * 1.2 * edge).toFixed(1)) };
	if (kind === "counter") return { off_ratio: Number((lat.off_ratio * noise(0.2 * edge)).toFixed(1)) };
	throw new Error(`no assay called "${kind}"`);
}

/** Does a measured set of measurements meet the target profile? Returns the ones it misses. */
export function missing(measurements) {
	const out = [];
	for (const [key, rule] of Object.entries(TARGET_PROFILE)) {
		const v = measurements[key];
		if (v === undefined) out.push({ key, why: "not measured" });
		else if (rule.op === "<=" ? v > rule.value : v < rule.value) out.push({ key, why: `${v} ${rule.op === "<=" ? "above" : "below"} ${rule.value}` });
	}
	return out;
}

/** Every variant in the library, with the facts that are true before any assay. */
export function library() {
	const out = [];
	for (const [lib, spec] of Object.entries(LIBRARIES)) {
		for (let i = 0; i < spec.n; i++) {
			const id = `V-${spec.from + i}`;
			out.push({ id, library: lib, parent: lib === "L-1" ? "Scaffold SC-0" : `V-${LIBRARIES[lib === "L-2" ? "L-1" : "L-2"].from + (i % 40)}` });
		}
	}
	return out;
}

/** The wells a round uses, in plate order, skipping the control column. */
export function wellsFor(n, plate) {
	const rows = "ABCDEFGHIJKLMNOP".split("");
	const out = [];
	for (let c = 2; c <= 23 && out.length < n; c++) {
		for (const row of rows) {
			if (out.length >= n) break;
			out.push(`${plate}:${row}${String(c).padStart(2, "0")}`);
		}
	}
	return out;
}
