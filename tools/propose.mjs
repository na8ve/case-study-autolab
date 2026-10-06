// An agent's recommendation, as a proposal a person can approve. It changes nothing.
//
//   node tools/propose.mjs --set feed.mu_set=0.04 [--set o2_enrichment_pct=40] \
//        --because "why, in a sentence" [--cite "EXP-005"] [--cite "Acetate overflow"] [--json]
//
// The live run is rebuilt from control/live.json (written by the daemon), the
// changes are checked against what can be changed while a culture runs, and the
// run is played forward twice from now: as it stands, and with the changes made.
// The proposal records both, so the person approving reads a forecast, not a hope.
// Nothing happens until a person runs tools/approve.mjs.

import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPath } from "../lab/harness.mjs";
import { LIVE_ADJUSTABLE, checkChanges, dirs, ensureDirs, forecast, nextProposalId, readLive, replay } from "../lab/control.mjs";

const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const clean = (s, n = 400) => String(s ?? "").replace(/[|\r\n\t]+/g, " ").trim().slice(0, n);

export function proposeChanges(root, { changes, because, cites = [] }) {
	root = resolve(root);
	const live = readLive(root);
	if (!live) throw new Error("there is no live run: start the lab (npm run lab) first");
	if (live.done) throw new Error("the culture has finished; there is nothing left to adjust");
	if (!clean(because)) throw new Error("--because is required: a recommendation says why");
	const { run, last } = replay(live);
	const problems = checkChanges(run.protocol, changes, { induced: last?.induced ?? false });
	if (problems.length) throw new Error(problems.join("\n"));
	const fc = forecast(live, changes);
	const d = ensureDirs(root);
	const id = nextProposalId(root);
	const proposal = {
		id, status: "pending", createdAt: new Date().toISOString(), atH: fc.atH,
		changes: changes.map((c) => ({ path: c.path, from: getPath(run.protocol, c.path), to: c.to, device: LIVE_ADJUSTABLE[c.path].device, what: LIVE_ADJUSTABLE[c.path].what })),
		because: clean(because), cites: cites.map((c) => clean(c, 120)).slice(0, 8), forecast: fc,
	};
	writeFileSync(join(d.proposals, `${id}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
	return proposal;
}

export function describeProposal(p) {
	const lines = [`${p.id}  proposed at t=${f(p.atH, 1)} h`];
	for (const c of p.changes) lines.push(`  ${c.device}: ${c.what} ${c.from} -> ${c.to}   (${c.path})`);
	lines.push(`  because: ${p.because}`);
	if (p.cites.length) lines.push(`  cites:   ${p.cites.join("; ")}`);
	const u = p.forecast.unchanged, n = p.forecast.proposed;
	lines.push(`  forecast, this culture to the end (a single run, not the three the loop scores):`);
	lines.push(`    as it stands:  titre ${f(u.titre)} g/L, guardrails broken: ${u.violated.join(", ") || "none"}`);
	lines.push(`    as proposed:   titre ${f(n.titre)} g/L, guardrails broken: ${n.violated.join(", ") || "none"}`);
	return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
	const changes = all("set").map((s) => {
		const [path, v] = s.split("=");
		return { path, to: Number(v) };
	});
	const json = args.includes("--json");
	try {
		const p = proposeChanges(process.cwd(), { changes, because: all("because")[0] ?? "", cites: all("cite") });
		if (json) console.log(JSON.stringify(p));
		else {
			for (const l of describeProposal(p)) console.log(l);
			console.log(`\nwaiting for a person: npm run approve -- ${p.id}`);
		}
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
void existsSync;
void dirs;
