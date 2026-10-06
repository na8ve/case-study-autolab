// One experiment: run protocol.json through the harness and print the result.
//
//   node tools/experiment.mjs [--protocol <file>] [--fault cavitation|chiller|column|tips]
//
// Prints the block a loop reads (`titre_g_l:`, `status:`). It decides nothing
// and writes nothing: keeping or discarding is tools/trial.mjs.

import { readFileSync } from "node:fs";
import { FAULTS } from "../lab/instruments.mjs";
import { evaluate, summaryLines, validate } from "../lab/harness.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const fault = opt("fault", "");
if (fault && !FAULTS.includes(fault)) {
	console.error(`--fault is one of ${FAULTS.join(", ")}`);
	process.exit(2);
}
let protocol;
try {
	protocol = JSON.parse(readFileSync(opt("protocol", "protocol.json"), "utf8"));
} catch (e) {
	console.error(`cannot read the protocol: ${e.message}`);
	process.exit(2);
}
const problems = validate(protocol);
if (problems.length) {
	console.log("---\nstatus:           refused");
	for (const p of problems) console.log(`problem:          ${p}`);
	process.exit(1);
}
for (const l of summaryLines(evaluate(protocol, { faults: fault ? { [fault]: true } : {} }))) console.log(l);
