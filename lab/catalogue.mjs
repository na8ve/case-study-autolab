// The lab's catalogue: every gene, variant, vector, cell line, plate and sample
// it has on record, and everything it has measured about them.
//
// It is laid out in columns rather than in objects. A record is a numeric id and
// nothing else; its measurements live in arrays beside it, one array per measure,
// blank where a record has none. A categorical state — IsKinase, ThermalScreened —
// is one bit in that record's label word. A link between two records is a row in
// three packed arrays: from, kind of link, to.
//
// A question is a filter over those columns in one pass: must have these, must not
// have those, and this column satisfies that test. `tools/query.mjs` is the command.
// Nothing here guesses, ranks or infers; it answers exactly what was asked of what
// has been measured.
//
// This is the lab's own store of readings. It is not the lab's memory: the
// catalogue says a variant melts at 61.8 °C, and memory says that the position-7
// substitution is what repairs melting points in that background, and what that
// then costs you.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** What a record is. Each record is exactly one of these. */
export const KINDS = ["Target", "ProteinVariant", "Vector", "CellLine", "Plate", "Sample", "Library", "Instrument"];

/** Categorical states: no value, just set or not. */
export const LABELS = [
	"IsKinase", "ExpressionValidated", "BindingScreened", "ThermalScreened", "CounterScreened",
	"CloningFailed", "LowYield", "HighAffinity", "ThermostableHit", "Selective", "LeadCandidate", "Deprioritised",
];

/** Measured numbers: one column each. */
export const MEASURES = ["kd_nm", "tm_c", "yield_mg_l", "off_ratio", "measured_round", "expressed_round"];

/** Short text fields: sparse, because most records have none. */
export const FIELDS = ["library", "vector", "well", "measured_on", "note"];

/** How two records can be linked. */
export const LINKS = ["derived_from", "member_of", "cloned_into", "expressed_in", "located_in", "binds", "inhibits", "assayed_by"];

const bit = (label) => {
	const i = LABELS.indexOf(label);
	if (i < 0) throw new Error(`no label called "${label}"`);
	return 1 << i;
};

export class Catalogue {
	constructor() {
		this.ids = [];
		this.index = new Map();
		this.kind = [];
		this.labels = [];
		this.num = Object.fromEntries(MEASURES.map((k) => [k, []]));
		this.text = Object.fromEntries(FIELDS.map((k) => [k, []]));
		this.link = { from: [], kind: [], to: [] };
		this.plates = { used: 0, total: 12 };
		this.round = 0;
	}

	/** The id for a name, making the record if it is new. */
	record(name, kind) {
		const got = this.index.get(name);
		if (got !== undefined) return got;
		const id = this.ids.length;
		this.ids.push(name);
		this.index.set(name, id);
		this.kind.push(KINDS.indexOf(kind));
		this.labels.push(0);
		for (const k of MEASURES) this.num[k].push(Number.NaN);
		for (const k of FIELDS) this.text[k].push("");
		return id;
	}

	idOf(name) {
		const i = this.index.get(name);
		if (i === undefined) throw new Error(`nothing on record called "${name}"`);
		return i;
	}
	has(name) {
		return this.index.has(name);
	}
	name(id) {
		return this.ids[id];
	}
	kindOf(id) {
		return KINDS[this.kind[id]];
	}
	labelsOf(id) {
		return LABELS.filter((f) => this.labels[id] & bit(f));
	}

	set(name, values) {
		const id = this.idOf(name);
		for (const [k, v] of Object.entries(values)) {
			if (MEASURES.includes(k)) this.num[k][id] = v;
			else if (FIELDS.includes(k)) this.text[k][id] = String(v);
			else throw new Error(`nothing is recorded called "${k}"`);
		}
		return id;
	}
	mark(name, ...labels) {
		const id = this.idOf(name);
		for (const f of labels) this.labels[id] |= bit(f);
		return id;
	}
	unmark(name, ...labels) {
		const id = this.idOf(name);
		for (const f of labels) this.labels[id] &= ~bit(f);
		return id;
	}
	get(name) {
		const id = this.idOf(name);
		const out = { id, name, kind: this.kindOf(id), labels: this.labelsOf(id) };
		for (const k of MEASURES) if (!Number.isNaN(this.num[k][id])) out[k] = this.num[k][id];
		for (const k of FIELDS) if (this.text[k][id]) out[k] = this.text[k][id];
		return out;
	}

	join(from, link, to) {
		if (!LINKS.includes(link)) throw new Error(`no link called "${link}"`);
		this.link.from.push(this.idOf(from));
		this.link.kind.push(LINKS.indexOf(link));
		this.link.to.push(this.idOf(to));
	}
	/** Links out of, or into, a record. One pass: the columns are small and packed. */
	links({ from, to, link } = {}) {
		const f = from === undefined ? -1 : this.idOf(from);
		const t = to === undefined ? -1 : this.idOf(to);
		const r = link === undefined ? -1 : LINKS.indexOf(link);
		const out = [];
		for (let i = 0; i < this.link.from.length; i++) {
			if (f >= 0 && this.link.from[i] !== f) continue;
			if (t >= 0 && this.link.to[i] !== t) continue;
			if (r >= 0 && this.link.kind[i] !== r) continue;
			out.push({ from: this.ids[this.link.from[i]], link: LINKS[this.link.kind[i]], to: this.ids[this.link.to[i]] });
		}
		return out;
	}

	/**
	 * One pass over the columns. `include` and `exclude` name a kind, a label or a
	 * measure (meaning: it has been measured). `where` tests a column.
	 */
	query({ include = [], exclude = [], where = [], since = "", limit = 0 } = {}) {
		const read = (names) => {
			const kinds = names.filter((n) => KINDS.includes(n)).map((n) => KINDS.indexOf(n));
			const bits = names.filter((n) => LABELS.includes(n)).reduce((a, n) => a | bit(n), 0);
			const cols = names.filter((n) => MEASURES.includes(n));
			const texts = names.filter((n) => FIELDS.includes(n));
			const unknown = names.filter((n) => !KINDS.includes(n) && !LABELS.includes(n) && !MEASURES.includes(n) && !FIELDS.includes(n));
			if (unknown.length) throw new Error(`nothing is recorded called "${unknown[0]}"`);
			return { kinds, bits, cols, texts };
		};
		const inc = read(include);
		const exc = read(exclude);
		for (const w of where) if (!MEASURES.includes(w.field) && !FIELDS.includes(w.field)) throw new Error(`cannot filter on "${w.field}"`);
		const out = [];
		for (let id = 0; id < this.ids.length; id++) {
			if (inc.kinds.length && !inc.kinds.includes(this.kind[id])) continue;
			if (exc.kinds.includes(this.kind[id])) continue;
			if ((this.labels[id] & inc.bits) !== inc.bits) continue;
			if (this.labels[id] & exc.bits) continue;
			if (inc.cols.some((c) => Number.isNaN(this.num[c][id]))) continue;
			if (exc.cols.some((c) => !Number.isNaN(this.num[c][id]))) continue;
			if (inc.texts.some((c) => !this.text[c][id])) continue;
			if (exc.texts.some((c) => this.text[c][id])) continue;
			if (since && !(this.text.measured_on[id] && this.text.measured_on[id] >= since)) continue;
			let ok = true;
			for (const w of where) {
				const v = MEASURES.includes(w.field) ? this.num[w.field][id] : this.text[w.field][id];
				if (MEASURES.includes(w.field) && Number.isNaN(v)) { ok = false; break; }
				if (!compare(v, w.op, w.value)) { ok = false; break; }
			}
			if (!ok) continue;
			out.push(this.get(this.ids[id]));
			if (limit && out.length >= limit) break;
		}
		return out;
	}

	/** Which combinations of labels and measures actually occur, and how many records wear each. */
	shapes(kind) {
		const counts = new Map();
		for (let id = 0; id < this.ids.length; id++) {
			if (kind && this.kindOf(id) !== kind) continue;
			const sig = [this.kindOf(id), ...this.labelsOf(id), ...MEASURES.filter((k) => !Number.isNaN(this.num[k][id]) && k !== "measured_round" && k !== "expressed_round")].join(" + ");
			counts.set(sig, (counts.get(sig) ?? 0) + 1);
		}
		return [...counts].sort((a, b) => b[1] - a[1]).map(([shape, n]) => ({ shape, n }));
	}

	toJSON() {
		return { ids: this.ids, kind: this.kind, labels: this.labels, num: Object.fromEntries(MEASURES.map((k) => [k, this.num[k].map((x) => (Number.isNaN(x) ? null : x))])), text: this.text, link: this.link, plates: this.plates, round: this.round };
	}
	static from(json) {
		const c = new Catalogue();
		c.ids = json.ids;
		c.index = new Map(json.ids.map((n, i) => [n, i]));
		c.kind = json.kind;
		c.labels = json.labels;
		for (const k of MEASURES) c.num[k] = (json.num[k] ?? []).map((x) => (x === null ? Number.NaN : x));
		for (const k of FIELDS) c.text[k] = json.text[k] ?? json.ids.map(() => "");
		c.link = json.link;
		c.plates = json.plates;
		c.round = json.round ?? 0;
		return c;
	}
	save(path) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(this.toJSON())}\n`);
	}
	static load(path) {
		if (!existsSync(path)) throw new Error(`there is no catalogue at ${path}: run \`npm run screen -- --history\``);
		return Catalogue.from(JSON.parse(readFileSync(path, "utf8")));
	}
}

function compare(v, op, value) {
	if (op === "<") return v < value;
	if (op === "<=") return v <= value;
	if (op === ">") return v > value;
	if (op === ">=") return v >= value;
	if (op === "=" || op === "==") return typeof v === "string" ? v === String(value) : v === Number(value);
	if (op === "!=") return typeof v === "string" ? v !== String(value) : v !== Number(value);
	throw new Error(`no comparison "${op}"`);
}

/** `kd_nm<5`, `tm_c>=60`, `library=L-3`. */
export function parseWhere(s) {
	const m = /^\s*([a-z_0-9]+)\s*(<=|>=|!=|==|<|>|=)\s*(.+?)\s*$/.exec(s);
	if (!m) throw new Error(`a filter looks like "kd_nm<5", not "${s}"`);
	const value = Number(m[3]);
	return { field: m[1], op: m[2], value: Number.isNaN(value) ? m[3] : value };
}
