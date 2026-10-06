// The research harness: the fixed budget, the one metric and the rules a run
// must keep. Read-only for the research loop: the agent edits protocol.json and
// nothing here, because a harness that can be edited can be made to pass.
//
//   budget    one culture of fixed length (HARDWARE.runHours), run three times
//             with different seeds; the score is the mean soluble titre
//   metric    titre_g_l, higher is better
//   rules     the safe operating envelope (a protocol outside it is refused,
//             never run) and the guardrails (a run that breaks one is invalid,
//             whatever its titre)

import { HARDWARE, simulate } from "./physics.mjs";

export const REPLICATES = [11, 12, 13];
export const MIN_GAIN = 0.01;

/** The safe operating envelope: every key of protocol.json, with the range the lab's own equipment allows. */
export const ENVELOPE = {
	inoculum_od: [0.2, 2.0],
	batch_glucose_g_l: [5, 30],
	temperature_c: [28, 39],
	ph: [6.4, 7.4],
	airflow_vvm: [0.5, 2.0],
	rpm_start: [200, 800],
	rpm_max: [600, 1200],
	do_setpoint_pct: [15, 60],
	o2_enrichment_pct: [21, 60],
	"feed.trigger_glucose_g_l": [0.05, 2.0],
	"feed.mu_set": [0.05, 0.4],
	"feed.glucose_g_l": [200, 600],
	"induction.at_od": [5, 100],
	"induction.inducer_mm": [0.05, 1.0],
	"induction.temperature_c": [20, 37],
};

/** What each knob is called in the lab's memory. A trial's facts name these, so a lesson attaches to the knob it is about. */
export const KNOBS = {
	inoculum_od: "Inoculum density",
	batch_glucose_g_l: "Batch glucose",
	temperature_c: "Growth temperature",
	ph: "pH set-point",
	airflow_vvm: "Airflow",
	rpm_start: "Agitation limit",
	rpm_max: "Agitation limit",
	do_setpoint_pct: "Oxygen cascade",
	o2_enrichment_pct: "Oxygen enrichment",
	"feed.trigger_glucose_g_l": "Feed trigger",
	"feed.mu_set": "Feed set-point",
	"feed.glucose_g_l": "Feed concentration",
	"induction.at_od": "Induction point",
	"induction.inducer_mm": "Inducer dose",
	"induction.temperature_c": "Cold shift",
};

/** The guardrails. `concept` is the failure's name in the lab's memory. */
export const GUARDRAILS = {
	acetate: { concept: "Acetate overflow", limit: 4.0, unit: "g/L", worst: "peakAcetate", broken: (v, l) => v > l, text: "acetate peaked at" },
	oxygen: { concept: "Oxygen limitation", limit: 20, unit: "%", worst: "minDo", broken: (v, l) => v < l, text: "dissolved oxygen fell to" },
	viability: { concept: "Viability loss", limit: 80, unit: "%", worst: "minViability", broken: (v, l) => v < l, text: "viability fell to" },
	volume: { concept: "Volume overrun", limit: 4.0, unit: "L", worst: "maxVolume", broken: (v, l) => v > l, text: "the broth reached" },
	temperature: { concept: "Temperature excursion", limit: 2.0, unit: "°C", worst: "maxTempDev", broken: (v, l) => v > l, text: "the reactor ran above its set-point by" },
};

export const leaves = (o, prefix = "") =>
	Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

export const getPath = (o, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

/** Problems with a protocol; empty means it may run. A protocol outside the envelope is refused, never run. */
export function validate(protocol) {
	const problems = [];
	if (!protocol || typeof protocol !== "object") return ["protocol.json is not an object"];
	const given = new Map(leaves(protocol));
	for (const [path, [lo, hi]] of Object.entries(ENVELOPE)) {
		const v = given.get(path);
		if (typeof v !== "number" || !Number.isFinite(v)) problems.push(`${path}: a number is required`);
		else if (v < lo || v > hi) problems.push(`${path}: ${v} is outside the envelope ${lo}..${hi}`);
	}
	for (const path of given.keys()) if (!(path in ENVELOPE)) problems.push(`${path}: not a knob of this lab`);
	if (!problems.length && protocol.rpm_start > protocol.rpm_max) problems.push("rpm_start: above rpm_max");
	return problems;
}

/** One protocol, three cultures. The worst case of each guardrail decides validity; the mean titre is the score. */
export function evaluate(protocol, { faults = {} } = {}) {
	const runs = REPLICATES.map((seed) => simulate(protocol, { seed, faults }));
	const worst = {
		peakAcetate: Math.max(...runs.map((r) => r.peakAcetate)),
		minDo: Math.min(...runs.map((r) => r.minDo)),
		minViability: Math.min(...runs.map((r) => r.minViability)),
		maxVolume: Math.max(...runs.map((r) => r.maxVolume)),
		maxTempDev: Math.max(...runs.map((r) => r.maxTempDev)),
	};
	const violated = Object.entries(GUARDRAILS)
		.filter(([, g]) => g.broken(worst[g.worst], g.limit))
		.map(([key, g]) => ({ key, concept: g.concept, value: worst[g.worst], limit: g.limit, unit: g.unit, text: g.text }));
	const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
	const titre = mean((r) => r.titre);
	const spread = Math.max(...runs.map((r) => r.titre)) - Math.min(...runs.map((r) => r.titre));
	return {
		valid: violated.length === 0 && titre > 0,
		titre,
		spread,
		violated,
		worst,
		runs,
		induced: runs.every((r) => r.inducedAtH !== null),
		finalViability: mean((r) => r.finalViability),
		glucoseUsedG: mean((r) => r.glucoseUsedG),
		finalVolume: mean((r) => r.finalVolume),
		inducedAtH: mean((r) => r.inducedAtH ?? NaN),
		fedAtH: mean((r) => r.fedAtH ?? NaN),
		peakBiomass: mean((r) => r.peakBiomass),
		maxPumpUtil: Math.max(...runs.map((r) => r.maxPumpUtil)),
		maxChillerLoad: Math.max(...runs.map((r) => r.maxChillerLoad)),
	};
}

/** The block a run prints, in the form `grep` can read: `titre_g_l:` and `status:` are the two lines a loop needs. */
export function summaryLines(r) {
	const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
	return [
		"---",
		`titre_g_l:        ${f(r.titre)}`,
		`replicate_spread: ${f(r.spread)}`,
		`status:           ${r.valid ? "valid" : "invalid"}`,
		`violated:         ${r.violated.length ? r.violated.map((v) => v.key).join(",") : "none"}`,
		`acetate_max_g_l:  ${f(r.worst.peakAcetate, 2)}`,
		`do_min_pct:       ${f(r.worst.minDo, 1)}`,
		`viability_end:    ${f(r.finalViability, 1)}`,
		`viability_min:    ${f(r.worst.minViability, 1)}`,
		`volume_max_l:     ${f(r.worst.maxVolume, 2)}`,
		`temp_dev_c:       ${f(r.worst.maxTempDev, 2)}`,
		`pump_util_max:    ${f(r.maxPumpUtil, 2)}`,
		`chiller_load_max: ${f(r.maxChillerLoad, 0)}`,
		`fed_at_h:         ${f(r.fedAtH, 1)}`,
		`induced_at_h:     ${f(r.inducedAtH, 1)}`,
		`glucose_used_g:   ${f(r.glucoseUsedG, 0)}`,
		`budget_hours:     ${HARDWARE.runHours}`,
	];
}

export function describeViolation(v) {
	return `${v.text} ${v.value.toFixed(v.key === "volume" || v.key === "temperature" ? 2 : 1)} ${v.unit}`;
}
