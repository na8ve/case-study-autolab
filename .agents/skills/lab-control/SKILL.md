---
name: lab-control
description: "Use when a live alarm, a reading on the stream or a trial gives a reason to change a set-point on the running culture: how to recommend it, what a person must approve, what the lab controller applies, and how to record what happened."
---

# Adjusting the running lab, with a person in the loop

The lab streams eight instruments from one culture (`npm run lab`). A recommendation
reaches an instrument by four steps, and only the first is yours.

```
you        propose   tools/propose.mjs     what to change, why, and a forecast
a person   approves  tools/approve.mjs     at a terminal, after reading the forecast
controller applies   daemon/lab-daemon.mjs only if the approval is signed and still in bounds
you        outcome   tools/outcome.mjs      what the readings did; written as facts
```

## 1. Propose

```
npm run propose -- --set feed.mu_set=0.08 --set o2_enrichment_pct=35 \
    --because "RQ above 1.1 on the stream is overflow (Acetate overflow); EXP-005 failed on oxygen alone, so lift oxygen first" \
    --cite EXP-005 --cite "Oxygen limitation"
```

- Only the set-points that can change while a culture runs are accepted: the feed
  set-point, oxygen enrichment, airflow, the agitation limit, the oxygen cascade,
  pH, the inducer dose and the two temperatures (growth only before induction,
  and the induction point only before it). Up to three, and none by more than
  two fifths of its range at once.
- Before you propose, ask memory what the reading means and what has been done
  about it. Cite the facts. A recommendation with no reason is refused.
- The tool replays the live culture and plays it forward twice: as it stands, and
  with your change made now. **Read the forecast.** If it breaks a guardrail,
  do not propose it; say what you would change instead. If you propose it
  anyway, say so in `--because`.
- The forecast is one run of this culture, not the three the loop scores, and the
  culture moves on while the person reads: at the default pace an hour of process
  time is a minute. For adjusting live, start the lab slower
  (`npm run lab -- --speed 0.25`).

## 2. A person approves

Tell the person the proposal's id and what it does, and stop. They run
`npm run approve -- ADJ-001`, see a fresh forecast, and type `approve`. You do not
run that command, you do not write to `control/approved/`, and you do not look for
the approval key. If they decline, `memory/adjustments/` gets their reason as facts,
which is useful to you next time.

## 3. The controller applies

The lab daemon picks the approval up before its next window, checks its signature
and the bounds again, and changes the set-point. If it refuses, `control/refused/`
says why. At least one process hour must pass between two adjustments, so the
culture's answer to the first can be seen.

## 4. Record the outcome

Two or more windows after the change, `npm run outcome -- ADJ-001` compares the
channels before and after, and writes `memory/adjustments/ADJ-001.facts`, with the
forecast against what the culture did. Then run `/demo autolab` again to put the new facts in memory. Say plainly
whether the change did what you recommended it for.

## Rules

- Recommend; never decide. The person's approval is the only thing that moves an
  instrument.
- Do not edit the daemon, `lab/`, or `control/`.
- Do not propose a second change to the same knob until the outcome of the first is
  recorded.
- If the stream shows a fault (`--fault` runs: a cavitating pump, a saturated
  chiller), recommend the fix the facts name (a seal, a lighter cold shift) as a
  note to the person; those are not set-points and this path cannot make them.
