// A person's decision on a proposal. Approval is made at a terminal, by a person.
//
//   node tools/approve.mjs                       list what is waiting
//   node tools/approve.mjs ADJ-001               read it, with a fresh forecast, then type "approve" or nothing
//   node tools/approve.mjs ADJ-001 --reject "why"
//
// An approval is signed with a key kept outside this repository, and only a
// signed approval is applied. Without a terminal this refuses to approve: an agent
// that runs it gets a refusal, and the agent's own policy should confirm it too.
// A rejection is recorded as facts, so the lab remembers what a person declined.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { KNOBS } from "../lab/harness.mjs";
import { approvalKey, checkChanges, dirs, ensureDirs, forecast, listJson, readLive, replay, sign } from "../lab/control.mjs";
import { describeProposal } from "./propose.mjs";

const clean = (s, n = 300) => String(s ?? "").replace(/[|\r\n\t]+/g, " ").trim().slice(0, n);

const load = (root, id) => {
	const file = join(dirs(root).proposals, `${id}.json`);
	if (!existsSync(file)) throw new Error(`no pending proposal ${id}`);
	return { file, proposal: JSON.parse(readFileSync(file, "utf8")) };
};

/** Re-check against the culture as it is now, and play the forecast again from here. */
export function recheck(root, proposal) {
	const live = readLive(root);
	if (!live) throw new Error("there is no live run");
	if (live.done) throw new Error("the culture has finished");
	const { run, last } = replay(live);
	const problems = checkChanges(run.protocol, proposal.changes, { induced: last?.induced ?? false });
	if (problems.length) throw new Error(`no longer possible: ${problems.join("; ")}`);
	return forecast(live, proposal.changes);
}

export function approveProposal(root, id, { approver = userInfo().username, key } = {}) {
	root = resolve(root);
	const { file, proposal } = load(root, id);
	const fresh = recheck(root, proposal);
	const k = key ?? approvalKey({ create: true });
	const approved = { ...proposal, status: "approved", approvedBy: approver, approvedAt: new Date().toISOString(), forecastAtApproval: fresh };
	approved.signature = sign(k, approved);
	const d = ensureDirs(root);
	writeFileSync(join(d.approved, `${id}.json`), `${JSON.stringify(approved, null, 2)}\n`);
	renameSync(file, `${file}.done`);
	return approved;
}

export function rejectProposal(root, id, { reason = "", by = userInfo().username } = {}) {
	root = resolve(root);
	const { file, proposal } = load(root, id);
	const d = ensureDirs(root);
	const rejected = { ...proposal, status: "rejected", rejectedBy: by, rejectedAt: new Date().toISOString(), reason: clean(reason) || "no reason given" };
	writeFileSync(join(d.rejected, `${id}.json`), `${JSON.stringify(rejected, null, 2)}\n`);
	renameSync(file, `${file}.done`);
	const knobs = [...new Set(proposal.changes.map((c) => KNOBS[c.path] ?? c.path))];
	const moved = (k) => proposal.changes.filter((c) => (KNOBS[c.path] ?? c.path) === k).map((c) => `${c.path} from ${c.from} to ${c.to}`).join(", ");
	const lines = [`# ${id} (synthetic).`];
	for (const k of knobs) lines.push(`${id} | tested | ${k} | ${id} proposed ${k} (${moved(k)}) on the live culture. ${clean(proposal.because)}`);
	lines.push(`${id} | result | Rejected: ${clean(rejected.reason, 80)} | ${id} was declined by a person: ${rejected.reason}.`);
	for (const k of knobs) lines.push(`${id} | informs | ${k} | ${id} informs ${k}: a person declined moving ${moved(k)} on the live culture, saying: ${rejected.reason}.`);
	mkdirSync(join(root, "memory", "adjustments"), { recursive: true });
	writeFileSync(join(root, "memory", "adjustments", `${id}.facts`), `${lines.join("\n")}\n`);
	return rejected;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const root = process.cwd();
	const args = process.argv.slice(2);
	const id = args.find((a) => /^ADJ-\d+$/.test(a));
	const ri = args.indexOf("--reject");
	try {
		if (!id) {
			const pending = listJson(dirs(root).proposals);
			if (!pending.length) console.log("nothing is waiting for approval");
			for (const p of pending) { for (const l of describeProposal(p)) console.log(l); console.log(); }
			process.exit(0);
		}
		if (ri >= 0) {
			rejectProposal(root, id, { reason: args[ri + 1] ?? "" });
			console.log(`${id} rejected, and recorded in memory/adjustments/`);
			process.exit(0);
		}
		const { proposal } = load(root, id);
		const fresh = recheck(root, proposal);
		for (const l of describeProposal({ ...proposal, forecast: fresh, atH: fresh.atH })) console.log(l);
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			console.error("\nApproval is made by a person at a terminal. This session has none, so nothing was approved.");
			process.exit(3);
		}
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const answer = (await rl.question('\nType "approve" to make this change on the live culture, anything else to leave it: ')).trim().toLowerCase();
		rl.close();
		if (answer !== "approve") { console.log("left as it was"); process.exit(0); }
		approveProposal(root, id);
		console.log(`${id} approved. The lab daemon applies it at its next window.`);
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}
