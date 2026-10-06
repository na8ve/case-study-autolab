// The lab's own checks: the culture, the library, the catalogue, both loops, the
// control path and the daemon. Zero dependencies. Every test that writes copies the lab first,
// and points NA8VE_HOME at a scratch folder, so nothing here touches the real one.

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const SRC = join(import.meta.dirname, "..");
const lab = () => {
	const d = mkdtempSync(join(tmpdir(), "autolab-"));
	cpSync(SRC, d, { recursive: true, filter: (p) => !/^(node_modules|control|\.autolab|results\.tsv)/.test(relative(SRC, p)) });
	return d;
};
const homeDir = () => mkdtempSync(join(tmpdir(), "autolab-home-"));
const imp = (dir, file) => import(`${pathToFileURL(join(dir, file)).href}?${Math.random()}`);
/**
 * Nothing here may find this machine's own key or reach a real service. Every run gets a
 * scratch NA8VE_HOME, an empty key, and a site that answers nothing, unless the test says
 * otherwise — a tool that falls back to the real keychain would otherwise post to it.
 */
const ISOLATED = { NA8VE_HOME: mkdtempSync(join(tmpdir(), "autolab-scratch-home-")), NA8VE_INGEST_KEY: "", NA8VE_SITE_URL: "http://127.0.0.1:1" };
const node = (dir, args, env = {}) => spawnSync(process.execPath, args, { cwd: dir, env: { ...process.env, ...ISOLATED, ...env }, encoding: "utf8", timeout: 120_000 });
const protocol = (dir) => JSON.parse(readFileSync(join(dir, "protocol.json"), "utf8"));

test("the simulator: deterministic, and a stepped run equals a whole one", async () => {
	const { createRun, simulate } = await imp(SRC, "lab/physics.mjs");
	const p = protocol(SRC);
	const a = simulate(p, { seed: 11 });
	assert.deepEqual(simulate(p, { seed: 11 }), a, "the same seed gives the same culture");
	assert.notEqual(simulate(p, { seed: 12 }).titre, a.titre, "control: another seed differs");
	const run = createRun(p, { seed: 11 });
	while (run.step());
	assert.deepEqual(run.summary(), a, "stepping gives what simulate gives");
});

test("an adjustment reaches the culture, and the feed does not jump when its set-point moves", async () => {
	const { createRun } = await imp(SRC, "lab/physics.mjs");
	const p = protocol(SRC);
	const run = createRun(p, { seed: 11 });
	let s;
	while ((s = run.step()) && !s.fed);
	for (let i = 0; i < 100; i++) s = run.step();
	const before = s.Fcmd;
	run.adjust("feed.mu_set", 0.1);
	const after = run.step().Fcmd;
	assert.ok(Math.abs(after - before) / before < 0.05, `the feed is continuous across the change (${before} to ${after})`);
	const base = createRun(p, { seed: 11 });
	while (base.step());
	while (run.step());
	assert.ok(run.summary().titre !== base.summary().titre, "the changed culture ends elsewhere");
	assert.deepEqual(run.protocol.feed.mu_set, 0.1);
	assert.equal(p.feed.mu_set, 0.06, "control: the protocol it was given is not modified");
});

test("the harness: the starting protocol is valid, the incident scenarios break what they should, the envelope refuses", async () => {
	const { evaluate, validate } = await imp(SRC, "lab/harness.mjs");
	const base = evaluate(protocol(SRC));
	assert.ok(base.valid && base.titre > 2 && base.titre < 2.8, `valid at about 2.4 g/L (${base.titre})`);
	const sc = (n) => evaluate(JSON.parse(readFileSync(join(SRC, "scenarios", `${n}.json`), "utf8")));
	assert.ok(sc("overfeed").violated.some((v) => v.key === "acetate"), "overfeed overflows");
	assert.ok(sc("hot").violated.some((v) => v.key === "temperature"), "hot runs away");
	assert.ok(sc("toxic-dose").violated.some((v) => v.key === "viability"), "a toxic dose kills the culture");
	const bad = protocol(SRC);
	bad.feed.mu_set = 2;
	assert.match(validate(bad)[0], /outside the envelope/);
	bad.feed.mu_set = 0.1;
	bad.surprise = 1;
	assert.match(validate(bad).join(), /not a knob/);
	assert.deepEqual(validate(protocol(SRC)), []);
});

test("a trial: keep, discard (and put back), refused, with a ledger and facts, ids continuing past the history", async () => {
	const dir = lab();
	execFileSync(process.execPath, [join(dir, "tools", "campaign.mjs")], { cwd: dir });
	const t = await imp(dir, "tools/trial.mjs");
	const p = protocol(dir);
	const first = t.runTrial({ root: dir, protocol: p, description: "the starting protocol" });
	assert.equal(first.status, "keep");
	assert.equal(first.id, "EXP-021", "the campaign used EXP-001 to EXP-020");
	const worse = JSON.parse(JSON.stringify(p));
	worse.feed.mu_set = 0.3;
	const lost = t.runTrial({ root: dir, protocol: worse, description: "faster feed" });
	assert.equal(lost.status, "discard");
	assert.match(lost.reason, /invalid: acetate/);
	assert.deepEqual(protocol(dir), p, "protocol.json is put back to the best");
	const wild = JSON.parse(JSON.stringify(p));
	wild.rpm_max = 9999;
	assert.equal(t.runTrial({ root: dir, protocol: wild, description: "too fast" }).status, "refused");
	const better = JSON.parse(JSON.stringify(p));
	better.o2_enrichment_pct = 35;
	better.feed.mu_set = 0.08;
	const won = t.runTrial({ root: dir, protocol: better, description: "oxygen first, then the feed" });
	assert.equal(won.status, "keep", "the combination the campaign never tried");
	assert.ok(won.result.titre > first.result.titre * 1.1, `a gain beyond the noise (${first.result.titre.toFixed(2)} to ${won.result.titre.toFixed(2)})`);
	const rows = readFileSync(join(dir, "results.tsv"), "utf8").trim().split("\n");
	assert.equal(rows.length, 5);
	assert.equal(rows[0].split("\t").length, 8);
	const facts = readFileSync(join(dir, "memory", "experiments", `${lost.id}.facts`), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
	for (const f of facts) assert.equal(f.split(" | ").length, 4, `a typed fact: ${f.slice(0, 60)}`);
	assert.ok(facts.some((f) => f.includes("| violated | Acetate overflow |")));
	assert.ok(facts.some((f) => f.includes("| tested | Feed set-point |")));
	assert.ok(!existsSync(join(dir, "memory", "experiments", "EXP-ZZZ.facts")));
});

test("the campaign: ends at the shipped protocol, and its file is current", () => {
	const dir = lab();
	assert.equal(node(dir, [join(dir, "tools", "campaign.mjs")]).status, 0);
	const check = node(dir, [join(dir, "tools", "campaign.mjs"), "--check"]);
	assert.equal(check.status, 0, check.stderr);
	const text = readFileSync(join(dir, "memory", "history", "campaign-1.facts"), "utf8");
	assert.ok(/EXP-007 \| result \| Discarded: titre 0\.00 g\/L/.test(text), "a culture that never reached induction is a recorded failure");
	assert.ok(text.includes("| violated | Oxygen limitation |"), "and so is an oxygen limit");
	writeFileSync(join(dir, "memory", "history", "campaign-1.facts"), `${text}x\n`);
	assert.equal(node(dir, [join(dir, "tools", "campaign.mjs"), "--check"]).status, 1, "control: a stale file fails the check");
});

test("the control arm runs the same trial and never reads memory", () => {
	const dir = lab();
	const r = node(dir, [join(dir, "tools", "auto.mjs"), "--trials", "6", "--seed", "3", "--quiet"]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(readFileSync(join(dir, "results.tsv"), "utf8").trim().split("\n").length, 8);
	assert.ok(!/memory/.test(readFileSync(join(dir, "tools", "auto.mjs"), "utf8").replace(/\/\/.*\n/g, "").replace(/`[^`]*`/g, "")), "its code names no memory path");
});

test("the control path: what may change, signed approvals, and a replay that matches the live run", async () => {
	const home = homeDir();
	process.env.NA8VE_HOME = home;
	const c = await imp(SRC, "lab/control.mjs");
	const { createRun } = await imp(SRC, "lab/physics.mjs");
	const p = protocol(SRC);
	assert.deepEqual(c.checkChanges(p, [{ path: "feed.mu_set", to: 0.1 }]), []);
	assert.match(c.checkChanges(p, [{ path: "inoculum_od", to: 1.5 }])[0], /not a set-point that can be changed/);
	assert.match(c.checkChanges(p, [{ path: "feed.mu_set", to: 0.9 }])[0], /outside the envelope/);
	assert.match(c.checkChanges(p, [{ path: "o2_enrichment_pct", to: 60 }])[0], /more than 40%/, "a large jump is refused");
	assert.match(c.checkChanges(p, [{ path: "temperature_c", to: 30 }], { induced: true }).join(), /already induced/);
	assert.match(c.checkChanges(p, []).join(), /no change/);
	assert.match(c.checkChanges(p, [1, 2, 3, 4].map((n) => ({ path: "airflow_vvm", to: 1 + n / 100 }))).join(), /at most 3/);

	const key = c.approvalKey({ create: true });
	const a = { id: "ADJ-001", changes: [{ path: "feed.mu_set", to: 0.1 }], approvedBy: "p", approvedAt: "2026-10-04T00:00:00Z" };
	a.signature = c.sign(key, a);
	assert.ok(c.verifySignature(key, a));
	assert.ok(!c.verifySignature(key, { ...a, changes: [{ path: "feed.mu_set", to: 0.2 }] }), "a changed value breaks it");
	assert.ok(!c.verifySignature("0".repeat(64), a), "control: another key does not verify it");
	assert.ok(!c.verifySignature("", a), "no key, no approval");
	assert.ok(!c.verifySignature(key, { ...a, signature: "zz" }));

	const live = { protocol: p, seed: 11, faults: {}, atStep: 600, adjustments: [{ atStep: 300, changes: [{ path: "o2_enrichment_pct", to: 30 }] }] };
	const run = createRun(p, { seed: 11 });
	for (let i = 0; i < 600; i++) { if (i === 300) run.adjust("o2_enrichment_pct", 30); run.step(); }
	const { run: again } = c.replay(live);
	assert.equal(again.index, run.index);
	while (run.step());
	const fc = c.forecast(live, []);
	assert.ok(Math.abs(fc.unchanged.titre - run.summary().titre) < 1e-12, "the forecast of a live run is that run");
	assert.notEqual(c.forecast(live, [{ path: "feed.mu_set", to: 0.09 }]).proposed.titre, fc.unchanged.titre);
});

test("approval is made at a terminal, and a rejection is remembered", async () => {
	const dir = lab();
	const home = homeDir();
	const env = { NA8VE_HOME: home };
	mkdirSync(join(dir, "control"), { recursive: true });
	const p = protocol(dir);
	writeFileSync(join(dir, "control", "live.json"), JSON.stringify({ protocol: p, seed: 11, faults: {}, atStep: 450, adjustments: [], done: false }));
	const made = node(dir, [join(dir, "tools", "propose.mjs"), "--set", "feed.mu_set=0.09", "--because", "test"], env);
	assert.equal(made.status, 0, made.stderr);
	assert.match(made.stdout, /ADJ-001/);
	assert.ok(existsSync(join(dir, "control", "proposals", "ADJ-001.json")));
	assert.equal(node(dir, [join(dir, "tools", "propose.mjs"), "--set", "feed.mu_set=0.09"], env).status, 1, "a recommendation says why");
	assert.equal(node(dir, [join(dir, "tools", "propose.mjs"), "--set", "inoculum_od=1.2", "--because", "x"], env).status, 1, "a knob that cannot change live is refused");
	const refused = node(dir, [join(dir, "tools", "approve.mjs"), "ADJ-001"], env);
	assert.equal(refused.status, 3, "with no terminal there is no approval");
	assert.ok(!existsSync(join(dir, "control", "approved", "ADJ-001.json")));
	assert.ok(!existsSync(join(home, "lab", "approval.key")), "and no key was made for it");
	const ap = await imp(dir, "tools/approve.mjs");
	process.env.NA8VE_HOME = home;
	ap.rejectProposal(dir, "ADJ-001", { reason: "the chiller is being serviced" });
	const facts = readFileSync(join(dir, "memory", "adjustments", "ADJ-001.facts"), "utf8");
	assert.match(facts, /\| result \| Rejected: the chiller is being serviced \|/);
	assert.match(facts, /\| tested \| Feed set-point \|/);
});

test("the daemon: eight instruments, faults, and it refuses a protocol outside the envelope", () => {
	const dir = lab();
	const run = (...a) => node(dir, [join(dir, "daemon", "lab-daemon.mjs"), "--dry-run", ...a]);
	const r = run("--windows", "6");
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /8 instruments, 4 online/);
	assert.equal(r.stdout.split("\n").filter((l) => /^\d\d:\d\d:\d\d/.test(l)).length, 6);
	const rq = (out) => out.split("\n").filter((l) => /^\d\d:\d\d:\d\d/.test(l)).map((l) => Number(/RQ ([\d.]+)/.exec(l)[1]));
	assert.ok(rq(r.stdout)[0] > 1.1, "the legacy protocol overflows in its batch phase, so the RQ alarm has something to say");
	const rip = (out) => Math.max(...out.split("\n").filter((l) => /^\d\d:\d\d:\d\d/.test(l)).map((l) => Number(/ripple ([\d.]+)/.exec(l)[1])));
	assert.ok(rip(run("--windows", "40").stdout) < 0.3, "control: no ripple without the fault");
	assert.ok(rip(run("--windows", "40", "--fault", "cavitation").stdout) > 0.3, "a cavitating pump ripples");
	assert.equal(run("--fault", "pump").status, 2, "control: an unknown fault is refused");
	const bad = join(dir, "bad.json");
	writeFileSync(bad, JSON.stringify({ ...protocol(dir), rpm_max: 5000 }));
	assert.equal(run("--protocol", bad).status, 2);
	const over = run("--protocol", join(dir, "scenarios", "overfeed.json"), "--windows", "40");
	assert.ok(rip(over.stdout) > 0.3, "the overfeed scenario overloads the pump");
});

test("the loop closed: a stream, a proposal, a person's signed approval, an applied change, an outcome as facts", async () => {
	const dir = lab();
	const home = homeDir();
	const env = { NA8VE_HOME: home, NA8VE_INGEST_KEY: `n8i_${"a".repeat(43)}` };
	let received = 0;
	const srv = http.createServer((req, res) => {
		let b = "";
		req.on("data", (c) => (b += c));
		req.on("end", () => {
			const n = JSON.parse(b || "{}").readings?.length ?? 0;
			received += n;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: n, alarms: [] }));
		});
	});
	await new Promise((r) => srv.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${srv.address().port}`;
	const d = spawn(process.execPath, [join(dir, "daemon", "lab-daemon.mjs"), "--window", "1", "--speed", "60", "--url", url], { cwd: dir, env: { ...process.env, ...ISOLATED, ...env } });
	let out = "";
	d.stdout.on("data", (c) => (out += c));
	d.stderr.on("data", (c) => (out += c));
	const closed = new Promise((r) => d.on("close", r));
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const atH = () => { try { return JSON.parse(readFileSync(join(dir, "control", "live.json"), "utf8")).atStep * 0.02; } catch { return -1; } };
	for (let waited = 0; atH() < 9; waited += 200) {
		assert.ok(waited < 60_000 && d.exitCode === null, `the daemon reached process hour 9 (${out})`);
		await sleep(200);
	}
	const prop = node(dir, [join(dir, "tools", "propose.mjs"), "--set", "o2_enrichment_pct=35", "--set", "feed.mu_set=0.08", "--because", "lift oxygen, then the feed", "--cite", "EXP-004", "--json"], env);
	assert.equal(prop.status, 0, prop.stderr);
	const proposal = JSON.parse(prop.stdout);
	assert.ok(proposal.forecast.proposed.titre > proposal.forecast.unchanged.titre, "the forecast says it helps");
	assert.deepEqual(proposal.forecast.proposed.violated, [], "and that it breaks no guardrail");
	const ap = await imp(dir, "tools/approve.mjs");
	process.env.NA8VE_HOME = home;
	const forged = { ...proposal, status: "approved", approvedBy: "agent", approvedAt: new Date().toISOString(), signature: "0".repeat(64) };
	mkdirSync(join(dir, "control", "approved"), { recursive: true });
	writeFileSync(join(dir, "control", "approved", "ADJ-099.json"), JSON.stringify({ ...forged, id: "ADJ-099" }));
	ap.approveProposal(dir, proposal.id, { approver: "a person" });
	await closed;
	srv.close();
	assert.match(out, /ADJUSTED ADJ-001 at t=\d+\.\d h, approved by a person/);
	assert.match(out, /REFUSED ADJ-099: the approval's signature does not verify/, "control: a forged approval is refused");
	const applied = JSON.parse(readFileSync(join(dir, "control", "applied", "ADJ-001.json"), "utf8"));
	assert.ok(applied.appliedAtH >= 9 && applied.appliedAtH < 13);
	assert.ok(!existsSync(join(dir, "control", "applied", "ADJ-099.json")));
	assert.match(out, /culture complete at 30\.0 h/);
	const final = JSON.parse(readFileSync(join(dir, "control", "live.json"), "utf8")).final;
	assert.ok(Math.abs(final.titre - proposal.forecast.proposed.titre) < 0.15, `the forecast (${proposal.forecast.proposed.titre.toFixed(2)}) is what the culture did (${final.titre.toFixed(2)})`);
	assert.ok(received > 300, "the readings reached the gateway");
	const o = node(dir, [join(dir, "tools", "outcome.mjs"), "ADJ-001"], env);
	assert.equal(o.status, 0, o.stderr);
	const facts = readFileSync(join(dir, "memory", "adjustments", "ADJ-001.facts"), "utf8");
	assert.match(facts, /\| result \| Applied: /);
	assert.match(facts, /the forecast made when it was approved said a final titre of/i);
	for (const f of facts.split("\n").filter((l) => l && !l.startsWith("#"))) assert.equal(f.split(" | ").length, 4);
	assert.ok(readdirSync(join(dir, "control", "refused")).includes("ADJ-099.json"));
});

// ---- the discovery half: the library, the catalogue, the plates ----------------------------

test("the library: deterministic, and the trade-off it is built on is really there", async () => {
	const D = await imp(SRC, "lab/discovery.mjs");
	const rows = D.library().map((v) => ({ ...v, lat: D.latent(v.id, v.library) }));
	assert.equal(rows.length, 240);
	assert.deepEqual(D.latent("V-332", "L-3"), D.latent("V-332", "L-3"), "a variant is the same every time it is asked for");
	const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const of = (lib, f) => med(rows.filter((r) => r.library === lib).map(f));
	assert.ok(of("L-2", (r) => r.lat.kd_nm) < of("L-1", (r) => r.lat.kd_nm) / 3, "maturing on binding alone tightened the binding");
	assert.ok(of("L-2", (r) => r.lat.tm_c) < of("L-1", (r) => r.lat.tm_c) - 5, "and cost the fold: that is the trade-off");
	assert.ok(of("L-3", (r) => r.lat.tm_c) > of("L-2", (r) => r.lat.tm_c) + 8, "the position-7 substitution repairs it");
	assert.ok(of("L-3", (r) => r.lat.kd_nm) < of("L-1", (r) => r.lat.kd_nm) / 3, "and keeps the binding");
	assert.ok(of("L-3", (r) => r.lat.aggregation) > of("L-2", (r) => r.lat.aggregation) + 0.3, "and makes it aggregate, which is the whole puzzle");
});

test("the thesis: a candidate exists, none is reachable as the last campaign ran, and two things rescue it", async () => {
	const D = await imp(SRC, "lab/discovery.mjs");
	const rows = D.library().map((v) => ({ ...v, lat: D.latent(v.id, v.library) }));
	const std = { temperature_c: 30, inducer_mm: 0.2 };
	const gentle = { temperature_c: 24, inducer_mm: 0.05 };
	const meets = (r, cond, vec) =>
		!D.cloningFails(r.lat, vec) &&
		r.lat.kd_nm * D.VECTORS[vec].tagBias <= D.TARGET_PROFILE.kd_nm.value &&
		r.lat.tm_c >= D.TARGET_PROFILE.tm_c.value &&
		r.lat.off_ratio >= D.TARGET_PROFILE.off_ratio.value &&
		D.expressionYield(r.lat, vec, cond) >= D.TARGET_PROFILE.yield_mg_l.value;
	assert.ok(rows.filter((r) => meets(r, gentle, "pEX-01")).length >= 10, "P1: candidates exist");
	assert.equal(rows.filter((r) => meets(r, std, "pEX-01")).length, 0, "P2: none under the conditions the last campaign used");
	const expresses = (cond, vec) => rows.filter((r) => r.library === "L-3" && !D.cloningFails(r.lat, vec) && D.expressionYield(r.lat, vec, cond) >= D.TARGET_PROFILE.yield_mg_l.value).length;
	assert.equal(expresses(std, "pEX-01"), 0, "control: as it was run, none of the repaired library expressed");
	assert.ok(expresses(std, "pEX-03") >= 50, `P3: the fusion vector rescues it (${expresses(std, "pEX-03")})`);
	assert.ok(expresses(gentle, "pEX-01") >= 50, `P3: so does a gentler induction (${expresses(gentle, "pEX-01")})`);
});

test("P5: the induction that rescues the library is one the fermentation loop would discard", async () => {
	const { evaluate, MIN_GAIN } = await imp(SRC, "lab/harness.mjs");
	const p = protocol(SRC);
	const best = evaluate(p);
	const gentler = JSON.parse(JSON.stringify(p));
	gentler.induction.temperature_c = 27;
	gentler.induction.inducer_mm = 0.1;
	const got = evaluate(gentler);
	assert.ok(got.valid, "it is a legal protocol");
	assert.ok(got.titre < best.titre * (1 + MIN_GAIN), "but it loses on the metric, so a trial would discard it");
	assert.ok(got.titre < best.titre * 0.8, `and not narrowly: ${got.titre.toFixed(2)} against ${best.titre.toFixed(2)}`);
});

test("the catalogue: a filter is what was asked and nothing else", async () => {
	const dir = lab();
	assert.equal(node(dir, [join(dir, "tools", "screen.mjs"), "--history"]).status, 0);
	const { Catalogue } = await imp(dir, "lab/catalogue.mjs");
	const cat = Catalogue.load(join(dir, "discovery", "catalogue.json"));
	const q = (o) => cat.query(o).map((e) => e.name);
	const bound = q({ include: ["ProteinVariant", "BindingScreened"] });
	assert.equal(bound.length, 30, "two binding plates were spent, fifteen variants each");
	const tight = q({ include: ["ProteinVariant"], where: [{ field: "kd_nm", op: "<", value: 5 }] });
	const open = q({ include: ["ProteinVariant"], exclude: ["ThermalScreened"], where: [{ field: "kd_nm", op: "<", value: 5 }] });
	assert.ok(open.length && open.length < tight.length, "excluding a label narrows it");
	for (const n of open) assert.ok(!cat.get(n).labels.includes("ThermalScreened"), `${n} really has no melt`);
	assert.ok(!q({ include: ["ProteinVariant"], exclude: ["kd_nm"] }).some((n) => tight.includes(n)), "excluding a measure means it was never measured");
	assert.deepEqual(q({ include: ["ProteinVariant"], where: [{ field: "library", op: "=", value: "L-3" }], limit: 3 }), ["V-301", "V-302", "V-303"]);
	assert.throws(() => cat.query({ include: ["Nonsense"] }), /nothing is recorded/, "control: an unknown name is refused, not ignored");
	assert.throws(() => cat.get("V-999"), /nothing on record/);
	const since = q({ include: ["ProteinVariant", "BindingScreened"], since: "2026-09-29" });
	assert.ok(since.length && since.length < bound.length, "a date narrows it too");
});

test("the catalogue answers the question the campaign actually asks", async () => {
	const dir = lab();
	node(dir, [join(dir, "tools", "screen.mjs"), "--history"]);
	const out = node(dir, [join(dir, "tools", "query.mjs"), "--include", "ProteinVariant", "--where", "kd_nm<5", "--exclude", "ThermalScreened", "--since", "2026-09-28", "--json"]);
	assert.equal(out.status, 0, out.stderr);
	const rows = JSON.parse(out.stdout);
	assert.ok(rows.length >= 3 && rows.length <= 12, `the ones that bind tightly and have not been through the melt (${rows.length})`);
	for (const r of rows) assert.ok(r.kd_nm < 5 && !r.labels.includes("ThermalScreened") && r.measured_on >= "2026-09-28");
	const profile = JSON.parse(node(dir, [join(dir, "tools", "query.mjs"), "--profile", "--json"]).stdout);
	assert.equal(profile.leads.length, 0, "the campaign as it stands has found nothing");
	assert.equal(profile.of, 240);
	assert.ok(profile.missing.yield_mg_l > 100, "and the commonest reason is that it would not express");
});

test("a screening round: it costs plates, refuses what it cannot assay, and stops at the budget", async () => {
	const dir = lab();
	node(dir, [join(dir, "tools", "screen.mjs"), "--history"]);
	const screen = (...a) => node(dir, [join(dir, "tools", "screen.mjs"), ...a, "--no-stream"]);
	const before = JSON.parse(node(dir, [join(dir, "tools", "query.mjs"), "--profile", "--json"]).stdout);
	assert.equal(before.plates.used, 7);
	const r1 = screen("--assay", "express", "--library", "L-3", "--vector", "pEX-03");
	assert.equal(r1.status, 0, r1.stderr);
	assert.match(r1.stdout, /R-008: express on 80 variants in pEX-03/);
	const tooBig = screen("--assay", "binding", "--library", "L-3", "--include", "ExpressionValidated");
	assert.equal(tooBig.status, 1, "a binding plate holds fifteen, so seventy-five of them is refused");
	assert.match(tooBig.stderr, /plate\(s\) and 4 are left/);
	const r2 = screen("--assay", "binding", "--library", "L-3", "--include", "ExpressionValidated", "--limit", "15");
	assert.equal(r2.status, 0, r2.stderr);
	screen("--assay", "thermal", "--library", "L-3", "--include", "BindingScreened,HighAffinity");
	const r4 = screen("--assay", "counter", "--library", "L-3", "--include", "ThermostableHit,HighAffinity");
	assert.match(r4.stdout, /meets the whole target profile: /, "P4: four of the five remaining plates produce a candidate");
	const after = JSON.parse(node(dir, [join(dir, "tools", "query.mjs"), "--profile", "--json"]).stdout);
	assert.ok(after.leads.length >= 1 && after.plates.used === 11);
	const refused = screen("--assay", "binding", "--variants", "V-101..V-104");
	assert.match(refused.stdout, /refused: it (has not been expressed|expressed at only)/);
	assert.equal(screen("--assay", "nonsense", "--variants", "V-301").status, 1, "control: an unknown assay is refused");
	assert.equal(screen("--assay", "express", "--variants", "V-999").status, 1, "control: an unknown variant is refused");
});

test("every round is written as facts, and the history is current and reproducible", async () => {
	const dir = lab();
	node(dir, [join(dir, "tools", "screen.mjs"), "--history"]);
	const check = node(dir, [join(dir, "tools", "screen.mjs"), "--history", "--check"]);
	assert.equal(check.status, 0, check.stderr);
	const text = readFileSync(join(dir, "memory", "history", "campaign-2.facts"), "utf8");
	const facts = text.split("\n").filter((l) => l && !l.startsWith("#"));
	for (const f of facts) assert.equal(f.split(" | ").length, 4, `a typed fact: ${f.slice(0, 60)}`);
	assert.ok(facts.length > 300, `every variant the campaign touched is in memory, not only the notable ones (${facts.length})`);
	assert.ok(facts.some((f) => /^R-007 \| informs \| L-3 \|.*yield_mg_l/.test(f)), "the dead end is stated");
	assert.ok(facts.filter((f) => /^V-3\d\d \| has \| LowYield \|/.test(f)).length > 50, "and so is every variant it happened to");
	assert.ok(facts.some((f) => /^V-2\d\d \| binds \| Kinase TK-7 \|/.test(f)), "the matured library's binders are named");
	writeFileSync(join(dir, "memory", "history", "campaign-2.facts"), `${text}x\n`);
	assert.equal(node(dir, [join(dir, "tools", "screen.mjs"), "--history", "--check"]).status, 1, "control: a stale file fails the check");
});

test("a round streams its plate to the gateway the culture uses, in the same shape", async () => {
	const dir = lab();
	node(dir, [join(dir, "tools", "screen.mjs"), "--history"]);
	const got = [];
	const srv = http.createServer((req, res) => {
		let b = "";
		req.on("data", (c) => (b += c));
		req.on("end", () => {
			const r = JSON.parse(b || "{}").readings ?? [];
			got.push(...r);
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: r.length, alarms: r.some((x) => x.subject === "screen:leads" && x.value > 0) ? [{ severity: "critical", question: "a lead?", answer: "look again" }] : [] }));
		});
	});
	await new Promise((r) => srv.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${srv.address().port}`;
	// Spawned, not spawnSync: the gateway it posts to is this process, which has to stay free to answer.
	const out = await new Promise((done) => {
		const c = spawn(process.execPath, [join(dir, "tools", "screen.mjs"), "--assay", "express", "--library", "L-3", "--vector", "pEX-03", "--url", url], { cwd: dir, env: { ...process.env, ...ISOLATED, NA8VE_INGEST_KEY: `n8i_${"a".repeat(43)}` } });
		let stdout = "";
		let stderr = "";
		c.stdout.on("data", (d) => (stdout += d));
		c.stderr.on("data", (d) => (stderr += d));
		c.on("close", (status) => done({ status, stdout, stderr }));
	});
	srv.close();
	assert.equal(out.status, 0, out.stderr);
	assert.match(out.stdout, /streamed \d+\/\d+ readings -> 200/);
	assert.ok(got.length > 70, `one reading per variant measured, plus the round's own (${got.length})`);
	const one = got.find((r) => r.subject.startsWith("express:V-3"));
	assert.equal(one.device, "Liquid Handler LH-1");
	assert.equal(one.quantity, "Soluble yield");
	assert.equal(one.unit, "mg/L");
	assert.ok(one.tags.includes("L-3") && one.tags.some((t) => /^V-3\d\d$/.test(t)) && one.tags.includes("R-008"), "tagged with the variant, its library and the round");
	assert.ok(got.some((r) => r.subject === "screen:leads"));
	const names = new Set(JSON.parse(readFileSync(join(dir, "daemon", "alarms.jsonc"), "utf8")).map((a) => a.subject));
	assert.ok(names.has("screen:leads"), "and the key's alarms watch for one");
	const offline = node(dir, [join(dir, "tools", "screen.mjs"), "--assay", "thermal", "--variants", "V-301..V-310"], {});
	assert.match(offline.stdout, /no ingest key, so nothing was streamed/, "control: with no key the round still stands");
});
