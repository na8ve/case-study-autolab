// The one way this lab sends a reading to Cortex.
//
// Both halves of the lab stream through here and nothing else does: the daemon
// with the eight instruments on the running culture, and the screening tool with
// what came off a plate. A reading carries the instrument and the quantity under
// the names the lab's own record uses, so a live reading arrives already joined
// to what memory knows about that instrument, that variant and that library.
//
// The key is an ingest key, made once with the CLI and kept outside this
// repository. With no key the lab still runs; it just keeps its results locally
// and tells you to seed them.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Readings are sent in batches of this size. */
export const MAX_BATCH = 50;
export const KEY_SHAPE = /^n8i_[A-Za-z0-9_-]{43}$/;

export const siteUrl = (given) => (given || process.env.NA8VE_SITE_URL || "https://na8ve.com").replace(/\/+$/, "");

/**
 * The ingest key, from the environment or the file the CLI wrote. Empty when there is none.
 *
 * The name is this lab's own, and deliberately not a generic one: a key file is keyed by
 * name under one home, so two demos that both called theirs `lab-daemon` would share a
 * file, and whichever made it first would decide which space the other one's readings
 * went to. A reading in the wrong space is worse than no reading.
 */
export function ingestKey(name = "autolab") {
	if (process.env.NA8VE_INGEST_KEY) return process.env.NA8VE_INGEST_KEY.trim();
	try {
		return readFileSync(join(process.env.NA8VE_HOME || join(homedir(), ".na8ve"), "ingest", `${name}.key`), "utf8").trim();
	} catch {
		return "";
	}
}

/** Send readings, in batches of MAX_BATCH. Returns what it answered, alarms included. */
export async function send(readings, { key, url, timeoutMs = 280_000 } = {}) {
	const base = siteUrl(url);
	const result = { ok: 0, sent: readings.length, alarms: [], status: 0 };
	for (let i = 0; i < readings.length; i += MAX_BATCH) {
		const res = await fetch(`${base}/api/ingest/batch`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ readings: readings.slice(i, i + MAX_BATCH) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body = await res.json().catch(() => ({}));
		result.status = res.status;
		result.ok += body.ok ?? 0;
		result.alarms.push(...(body.alarms ?? []));
		if (res.status === 404 || res.status === 401) break;
	}
	return result;
}

/** An alarm's question, and whatever the space answered, wrapped to the terminal. */
export function printAlarm(a, log = console.log) {
	log(`  ALARM ${a.severity}: ${a.question}`);
	if (a.answer) {
		if (a.context) log(`  (given ${a.context} causal fact${a.context === 1 ? "" : "s"} from the graph)`);
		log("  Cortex:");
		const width = Math.max(40, (process.stdout.columns || 100) - 4);
		for (const para of a.answer.split(/\n+/)) {
			let line = "";
			for (const word of para.split(/\s+/).filter(Boolean)) {
				if (line && line.length + word.length + 1 > width) {
					log(`    ${line}`);
					line = word;
				} else line = line ? `${line} ${word}` : word;
			}
			if (line) log(`    ${line}`);
		}
		if (a.answerId) log(`  (kept in the space as memory ${a.answerId})`);
	} else if (a.turnError) log(`  (${a.turnError})`);
}
