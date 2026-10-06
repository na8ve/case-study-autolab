// The process the lab runs: a fed-batch culture of E. coli making a recombinant
// protein. Everything here is a model, and every number is synthetic.
//
// One state, many instruments: the simulator is the only place the process is
// computed. The eight instruments in instruments.mjs read this state and add
// their own noise and faults, and the research harness in harness.mjs scores
// the same run. Read-only for the research loop.

export const HARDWARE = {
	runHours: 30,
	dt: 0.02,
	startVolumeL: 2.0,
	pumpMaxLh: 0.15,
	pumpCavitatesAbove: 0.85,
	glucoseStockG: 450,
	kla0: 650,
	chillerUA: 16,
	chillerSupplyC: 8,
	tankMaxL: 5.0,
	odToDcw: 0.4,
	setpointRampCh: 10,
};

const K = {
	qSmax: 1.25, Ks: 0.05, qScrit: 0.45,
	Yox: 0.5, Yof: 0.12, Yac: 0.3, maint: 0.04,
	qO2max: 13, YA: 0.6, qAupMax: 0.4, KA: 0.3, acetateInhibit: 6,
	qPmax: 0.04, KI: 0.08, burden: 0.8,
	heatPerMmolO2: 0.46,
	cellsPerGDcw: 2e9,
};

export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const bell = (x, centre, width) => Math.exp(-(((x - centre) / width) ** 2));
const logistic = (x, centre, width) => 1 / (1 + Math.exp((x - centre) / width));

/** Growth falls off either side of 37 C. */
export const growthTemperature = (T) => bell(T, 37, 11);
/** The rate of making product peaks a little below the growth optimum. */
export const productTemperature = (T) => bell(T, 34, 9);
/** The share of new product that folds soluble: warm cells make inclusion bodies. */
export const solubleShare = (T) => logistic(T, 33.5, 2.5);

/**
 * One culture, stepped. `step()` returns the full state of the next step, or null when the budget is spent;
 * the instruments and the daemon watch the same run the harness scores. `adjust(path, value)` changes a
 * set-point while the culture runs, which is how an approved recommendation reaches the lab.
 * `faults`: { cavitation, chiller } wear that the protocol did not cause.
 */
export function createRun(protocol, { seed = 1, faults = {} } = {}) {
	const H = HARDWARE;
	const r = rng(seed);
	const jit = (s) => 1 + s * (r() * 2 - 1);
	const qSmax = K.qSmax * jit(0.03);
	const qPmax = K.qPmax * jit(0.05);
	const qO2max = K.qO2max * jit(0.03);

	const p = JSON.parse(JSON.stringify(protocol));
	const od0 = p.inoculum_od;
	let Xv = od0 * H.odToDcw * 0.97;
	let Xd = od0 * H.odToDcw * 0.03;
	let S = p.batch_glucose_g_l;
	let A = 0;
	let P = 0;
	let Ps = 0;
	let V = H.startVolumeL;
	let rpm = p.rpm_start;
	let Tact = p.temperature_c;
	let Tsp = p.temperature_c;
	let Q = 0;
	let cumGlu = p.batch_glucose_g_l * V;
	let fed = false, F0 = 0, tFeed = 0;
	let induced = false, tInd = 0;
	let DOpct = 100;
	const UA = H.chillerUA * (faults.chiller ? 0.6 : 1);

	const peak = { acetate: 0, minDo: 1e9, minViability: 100, maxTempDev: 0, maxVolume: V, maxUtil: 0, maxX: 0, maxChillerLoad: 0 };
	let fedAtH = null;

	const steps = Math.round(H.runHours / H.dt);
	let i = 0;

	function step() {
		if (i > steps) return null;
		const t = i * H.dt;
		const X = Xv + Xd;

		if (!induced && X / H.odToDcw >= p.induction.at_od) { induced = true; tInd = t; }
		const Tgoal = induced ? p.induction.temperature_c : p.temperature_c;
		Tsp += Math.max(-H.setpointRampCh * H.dt, Math.min(H.setpointRampCh * H.dt, Tgoal - Tsp));
		const Tset = Tsp;
		if (!fed && t > 0.5 && S < p.feed.trigger_glucose_g_l) {
			fed = true; tFeed = t; fedAtH = t;
			F0 = ((p.feed.mu_set / 0.45 + K.maint) * Xv * V) / p.feed.glucose_g_l;
		}

		let Fcmd = fed && cumGlu < H.glucoseStockG ? F0 * Math.exp(p.feed.mu_set * (t - tFeed)) : 0;
		Fcmd = Math.min(Fcmd, H.pumpMaxLh);
		const util = Fcmd / H.pumpMaxLh;
		let ripple = util > H.pumpCavitatesAbove ? (0.8 * (util - H.pumpCavitatesAbove)) / (1 - H.pumpCavitatesAbove) : 0;
		if (faults.cavitation && fed) ripple = Math.max(ripple, 0.5);
		const pulse = Math.sin((2 * Math.PI * t) / 0.15);
		let Fdel = Math.max(0, Fcmd * (1 + ripple * pulse));
		if (V + Fdel * H.dt > H.tankMaxL) Fdel = 0;
		const D = Fdel / V;
		const Sf = p.feed.glucose_g_l;

		const indFrac = induced ? p.induction.inducer_mm / (K.KI + p.induction.inducer_mm) : 0;
		const fT = growthTemperature(Tact);
		const fpH = bell(p.ph, 7.0, 0.9);
		const inhA = 1 / (1 + A / K.acetateInhibit);
		const qSeff = qSmax * fT * fpH * inhA;
		const kS = qSeff / (K.Ks + S);
		const Sn = (S + H.dt * D * Sf) / (1 + H.dt * (D + kS * Math.max(Xv, 1e-9)));
		const qS = Math.max(0, (S + H.dt * D * Sf - Sn * (1 + H.dt * D)) / (H.dt * Math.max(Xv, 1e-9)));

		const qSoxDem = Math.min(qS, K.qScrit);
		let qSof = qS - qSoxDem;
		const kLa = H.kla0 * (rpm / 1000) ** 1.3 * p.airflow_vvm ** 0.45;
		const Cstar = (0.21 * p.o2_enrichment_pct) / 21;
		const qO2dem = ((qO2max * qSoxDem) / K.qScrit) * (1 + 0.15 * indFrac);
		const demand = qO2dem * Xv;
		const cap = kLa * Cstar * 0.97;
		let oxScale = 1, CL;
		if (demand <= cap) CL = Cstar - demand / kLa;
		else { oxScale = cap / demand; CL = 0.03 * Cstar; }
		const qSox = qSoxDem * oxScale;
		qSof += qSoxDem * (1 - oxScale);
		const OUR = Math.min(demand, cap);
		DOpct = (CL / 0.21) * 100;
		const fof = qS > 0 ? qSof / qS : 0;
		const CER = OUR * (1 + 0.5 * fof);

		const qAprod = K.YA * qSof;
		let qAup = K.qAupMax * (A / (K.KA + A)) * Math.max(0, 1 - qS / K.qScrit);
		qAup = Math.min(qAup, (A + H.dt * qAprod * Xv) / (H.dt * Math.max(Xv, 1e-9)));

		let mu = K.Yox * qSox + K.Yof * qSof + K.Yac * qAup - K.maint * fT;
		mu = Math.max(mu, -0.02) / (1 + K.burden * indFrac);
		const fed_E = Math.min(1, (qSox + 0.5 * qAup) / 0.12);
		const qP = induced ? qPmax * indFrac * productTemperature(Tact) * fed_E * oxScale * inhA : 0;
		const kd = 0.004
			+ (induced ? 0.02 * indFrac * indFrac * (1 + Math.max(0, (Tact - 33) / 6)) : 0)
			+ (0.12 * Math.max(0, A - 5)) / 5
			+ 0.15 * (1 - oxScale);

		const Xvn = Xv + H.dt * ((mu - kd - D) * Xv);
		const Xdn = Xd + H.dt * (kd * Xv - D * Xd);
		const An = Math.max(0, A + H.dt * ((qAprod - qAup) * Xv - D * A));
		const Pn = P + H.dt * (qP * Xv - D * P);
		const Psn = Ps + H.dt * (solubleShare(Tact) * qP * Xv - D * Ps);
		cumGlu += Fdel * H.dt * Sf;

		Q = K.heatPerMmolO2 * OUR * V;
		const Ttarget = Math.max(Tset, H.chillerSupplyC + Q / UA);
		const chillerLoad = Math.min(100, (100 * Q) / Math.max(1e-9, UA * (Tset - H.chillerSupplyC)));

		const viability = (100 * Xv) / Math.max(1e-9, Xv + Xd);
		const state = {
			t, Xv, Xd, X: Xv + Xd, S, A, P, Ps, V, rpm, Tact, Tset, DO: DOpct, kLa, Cstar, mu, qS, qSof, qSox, qAup,
			OUR, CER, RQ: OUR > 0 ? CER / OUR : 1, Q, chillerLoad, Fcmd, Fdel, util, ripple, pulse, viability,
			phase: induced ? "Induction phase" : fed ? "Fed-batch phase" : "Batch phase", induced, fed, tInd, tFeed,
			cumGlu, od: (Xv + Xd) / H.odToDcw, phSet: p.ph, enrich: p.o2_enrichment_pct, airflow: p.airflow_vvm, qAprod, UA, cellsPerMl: (Xv + Xd) * K.cellsPerGDcw / 1000,
		};

		peak.acetate = Math.max(peak.acetate, A);
		if (t >= 2) peak.minDo = Math.min(peak.minDo, DOpct);
		peak.minViability = Math.min(peak.minViability, viability);
		peak.maxTempDev = Math.max(peak.maxTempDev, Tact - Tset);
		peak.maxVolume = Math.max(peak.maxVolume, V);
		peak.maxUtil = Math.max(peak.maxUtil, util);
		peak.maxX = Math.max(peak.maxX, Xv + Xd);
		peak.maxChillerLoad = Math.max(peak.maxChillerLoad, chillerLoad);

		Xv = Xvn; Xd = Xdn; S = Sn; A = An; P = Pn; Ps = Psn; V += Fdel * H.dt;
		Tact += (Ttarget - Tact) * (H.dt / 0.05);
		rpm = Math.min(p.rpm_max, Math.max(p.rpm_start, rpm + 100 * (p.do_setpoint_pct - DOpct) * H.dt));
		i++;
		return state;
	}

	function adjust(path, value) {
		const tn = i * H.dt;
		const now = fed ? F0 * Math.exp(p.feed.mu_set * (tn - tFeed)) : 0;
		if (fed && path === "feed.mu_set") { F0 = now; tFeed = tn; }
		if (fed && path === "feed.glucose_g_l") { F0 = (now * p.feed.glucose_g_l) / value; tFeed = tn; }
		const ks = path.split(".");
		const last = ks.pop();
		ks.reduce((a, k) => a[k], p)[last] = value;
	}

	function summary() {
		return {
			titre: Ps,
			totalProduct: P,
			finalVolume: V,
			finalViability: (100 * Xv) / Math.max(1e-9, Xv + Xd),
			fedAtH,
			inducedAtH: induced ? tInd : null,
			glucoseUsedG: cumGlu,
			peakAcetate: peak.acetate,
			minDo: peak.minDo === 1e9 ? DOpct : peak.minDo,
			minViability: peak.minViability,
			maxTempDev: peak.maxTempDev,
			maxVolume: peak.maxVolume,
			maxPumpUtil: peak.maxUtil,
			peakBiomass: peak.maxX,
			maxChillerLoad: peak.maxChillerLoad,
		};
	}

	return { step, adjust, summary, protocol: p, get index() { return i; }, get time() { return i * H.dt; } };
}

/** Run one culture to the end and score it. `onStep(state)` sees every step. */
export function simulate(protocol, { seed = 1, faults = {}, onStep } = {}) {
	const run = createRun(protocol, { seed, faults });
	for (let s = run.step(); s; s = run.step()) if (onStep) onStep(s);
	return run.summary();
}
