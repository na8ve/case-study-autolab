---
name: research-loop
description: "Use when asked to improve the fermentation that makes this lab's fermentation protocol, run experiments, or continue the research loop: how to ask memory first, change protocol.json, run a trial, and read keep, discard and refused."
---

# Running the research loop in this lab

`program.md` is the full instruction. This is the part to keep in front of you.

## Ask memory first, with the right question

- A cause: `cortex_explain` on what you saw. "What drives acetate overflow, and
  how has it been remedied?" asks for the chain of causes, with the facts it
  stands on.
- A fact: `cortex_recall` for a knob's name (`Feed set-point`, `Oxygen
  enrichment`, `Inducer dose`, `Cold shift`) or a trial (`EXP-005`).
- Read what a **discarded** trial says about *why*: `violated` names the guardrail,
  and the fact text says by how much. A knob that failed alone may work with its
  limit lifted.

## Reading the knobs

| knob | what memory says to check first |
|---|---|
| `feed.mu_set` | overflow above what the cells can oxidise; oxygen and heat follow the density it builds |
| `o2_enrichment_pct`, `rpm_max`, `airflow_vvm` | the oxygen limit; more transfer means more heat for the chiller |
| `induction.*` | dose against viability; point against burden and the production window; the cold shift against the chiller |
| `temperature_c` | warm growth overflows |
| `ph` | a shallow optimum: it moves little |

## A trial

1. Edit `protocol.json`: one to three knobs.
2. `npm run trial -- "<change>, because <fact>"`.
3. `keep` means a valid protocol with a titre above the best by at least one percent.
   `discard` puts `protocol.json` back to the best. `refused` means it was never run.
4. After a few trials, run `/demo autolab` again to put the new facts in memory.

## Rules

- Edit `protocol.json` and nothing else. Never `lab/`, `tools/`, `results.tsv`,
  `.autolab/`, `control/`, or the `memory/` folders.
- A titre that breaks a guardrail is not a result. Say so, and do not propose it.
- Cite the fact a change stands on in the trial description; it is stored with
  the trial.
- Never copy a number from the harness into a memory or a note. The harness owns
  its limits.
- Do not stop to ask whether to continue.
