// The lab's eight instruments, as the daemon streams them. Each one reads the
// simulator's state (physics.mjs) and adds its own noise, cadence and faults.
// The device and quantity names here are the ones the lab's knowledge uses, so
// a live reading lands on a neuron that is already in memory.
//
// Five instruments report continuously. Three belong to the sampling line and
// report one result per sample. Synthetic: no real instrument is described.

export const RUN = "Run AR-1";

const visc = (s) => 1 + 0.04 * Math.max(0, s.X) ** 1.3;

export const INSTRUMENTS = [
	{
		id: "r1", device: "Bioreactor R-1", online: true,
		channels: [
			{ key: "ph", quantity: "pH", unit: "pH", digits: 3, noise: 0.01, read: (s) => s.phSet - 0.05 * s.qAprod * s.Xv },
			{ key: "temperature", quantity: "Temperature", unit: "°C", digits: 2, noise: 0.04, read: (s) => s.Tact },
			{ key: "do", quantity: "Dissolved oxygen", unit: "%", digits: 1, noise: 0.5, read: (s) => s.DO },
			{ key: "agitation", quantity: "Agitation", unit: "rpm", digits: 0, noise: 3, read: (s) => s.rpm },
		],
	},
	{
		id: "fp1", device: "Feed Pump FP-1", online: true,
		channels: [
			{ key: "rate", quantity: "Feed rate", unit: "mL/h", digits: 2, noise: 0.15, read: (s) => s.Fdel * 1000 },
			{ key: "pressure", quantity: "Line pressure", unit: "bar", digits: 3, noise: 0.01, read: (s) => 0.9 + 1.4 * s.util * (1 + s.ripple * s.pulse) },
			{ key: "ripple", quantity: "Pressure ripple", unit: "bar", digits: 3, noise: 0.01, read: (s, c) => 2.8 * Math.max(s.util, c.faults.cavitation ? 0.35 : 0) * s.ripple },
		],
	},
	{
		id: "ch1", device: "Chiller CH-1", online: true,
		channels: [
			{ key: "jacket", quantity: "Jacket temperature", unit: "°C", digits: 2, noise: 0.08, read: (s) => Math.max(8, s.Tact - s.Q / s.UA) },
			{ key: "load", quantity: "Chiller load", unit: "%", digits: 1, noise: 0.4, read: (s) => s.chillerLoad },
		],
	},
	{
		id: "ms1", device: "Off-gas Analyzer MS-1", online: true,
		channels: [
			{ key: "o2", quantity: "Exhaust O2", unit: "%", digits: 3, noise: 0.03, read: (s) => (20.95 * s.enrich) / 21 - (100 * s.OUR * s.V) / ((s.airflow * s.V * 60 * 1000) / 24.5) },
			{ key: "co2", quantity: "Exhaust CO2", unit: "%", digits: 3, noise: 0.03, read: (s) => 0.04 + (100 * s.CER * s.V) / ((s.airflow * s.V * 60 * 1000) / 24.5) },
			{ key: "rq", quantity: "Respiratory quotient", unit: "", digits: 3, noise: 0.008, read: (s) => (s.OUR > 1 ? s.RQ : 1.0) },
		],
	},
	{
		id: "lh1", device: "Liquid Handler LH-1", everyH: 1,
		channels: [
			{ key: "cv", quantity: "Dispense CV", unit: "%", digits: 2, noise: 0.12, read: (s, c) => 1.1 + 0.55 * (visc(s) - 1) + (c.faults.tips ? 3.4 : 0) },
			{ key: "aspirate", quantity: "Aspirate pressure", unit: "kPa", digits: 2, noise: 0.05, read: (s) => 2.0 + 0.8 * (visc(s) - 1) },
		],
	},
	{
		id: "h1", device: "HPLC H-1", everyH: 2,
		channels: [
			{ key: "titre", quantity: "Titre", unit: "g/L", digits: 3, noise: 0, read: (s, c, noise) => Math.max(0, s.Ps * (1 + noise(c.cv / 100))) },
			{ key: "acetate", quantity: "Acetate", unit: "g/L", digits: 2, noise: 0.03, read: (s) => s.A },
			{ key: "retention", quantity: "Retention time", unit: "min", digits: 3, noise: 0.004, read: (s, c) => 4.21 + 0.004 * s.t + (c.faults.column ? 0.03 * s.t : 0) },
			{ key: "pressure", quantity: "Column pressure", unit: "bar", digits: 1, noise: 0.5, read: (s, c) => 182 + 0.8 * s.t + (c.faults.column ? 9 * s.t : 0) },
		],
	},
	{
		id: "pr1", device: "Plate Reader PR-1", everyH: 1,
		channels: [
			{ key: "od600", quantity: "OD600", unit: "AU", digits: 2, noise: 0, read: (s, c, noise) => s.od * (1 + noise(0.01)) },
			{ key: "fluorescence", quantity: "Reporter fluorescence", unit: "RFU", digits: 0, noise: 12, read: (s) => 900 * s.Ps },
		],
	},
	{
		id: "fc1", device: "Flow Cytometer FC-1", everyH: 2,
		channels: [
			{ key: "viability", quantity: "Viability", unit: "%", digits: 1, noise: 0.4, read: (s) => s.viability },
			{ key: "density", quantity: "Cell density", unit: "1e9/mL", digits: 2, noise: 0.03, read: (s) => s.cellsPerMl / 1e9 },
		],
	},
];

export const CHANNELS = Object.fromEntries(
	INSTRUMENTS.flatMap((i) => i.channels.map((c) => [`${i.id}:${c.key}`, { device: i.device, quantity: c.quantity, unit: c.unit, instrument: i }])),
);

/** The instrument names and what each reports: the lab's own vocabulary, used by the knowledge and the tests. */
export const LAB = {
	devices: Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.device])),
	quantities: Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i.channels.map((c) => c.quantity)])),
	run: RUN,
	phases: ["Batch phase", "Fed-batch phase", "Induction phase"],
};

export const FAULTS = ["cavitation", "chiller", "column", "tips"];

/** The readings one instrument reports at one state. `noise(sd)` is a seeded draw; `faults` are the wear the protocol did not cause. */
export function readInstrument(instrument, s, { faults = {}, noise }) {
	const c = { faults, cv: 1.1 + 0.55 * (visc(s) - 1) + (faults.tips ? 3.4 : 0) };
	return instrument.channels.map((ch) => {
		const raw = Math.max(0, ch.read(s, c, noise) + (ch.noise ? noise(ch.noise) : 0));
		const factor = 10 ** ch.digits;
		return { subject: `${instrument.id}:${ch.key}`, device: instrument.device, quantity: ch.quantity, unit: ch.unit, value: Math.round(raw * factor) / factor };
	});
}

export { visc };
