# What this lab is testing

The lab is trying to find a binder against one target that meets a four-part
profile at once: it must hold the target tightly, survive heating, prefer the
target to its close relative, and be makeable in useful amounts. The four limits
are set in `lab/discovery.mjs` and stated nowhere else, so they cannot drift.

Two campaigns have already run, and both are in memory with every number they
measured. The first tuned the fermentation that makes the protein. The second
screened two libraries of variants and stalled. The claims below are about
whether the lab's own record is enough to get it moving again, and each can be
wrong.

## H1 — the candidate is already in the library, and the last campaign could not have found it

The second campaign screened 160 variants and found nothing meeting the profile.
Its tightest binders came from the matured library and melt too low; the library
built to repair that would not express at all, so it was never assayed further.

**The claim:** at least one variant meets the whole profile, and **no** variant
of any library meets it under the conditions that campaign used — the standard
vector at the standard induction. The campaign did not screen badly; it screened
under conditions that hid exactly the variants worth having.

**What would show it false:** a variant meeting the profile under those same
conditions, which would mean the last campaign simply missed it.

## H2 — what hid it is a property of the thing that makes it good

The substitution that repairs the melting temperature also makes the construct
aggregate, and so does the matured binding loop it sits in. An aggregating
construct comes out as inclusion bodies, and what aggregates is not recovered.

**The claim:** the same variants fail the yield limit under the standard
induction and pass it under a gentler, colder one, or in the solubility-fusion
vector — so the screen's blind spot is an expression problem, not a binding one.

**What would show it false:** the library expressing no better under either
change, which would mean the dead end is real.

## H3 — the fix is an equipment decision the research loop would refuse

The gentler induction that rescues those constructs makes less protein overall.
The fermentation loop scores a protocol on bulk soluble titre and discards
anything that does not beat the best, so it would throw that protocol away.

**The claim:** the induction that rescues the campaign scores materially *worse*
on the fermentation metric, and is therefore a decision a person has to take
rather than one the loop can reach — which is what the approval path exists for.

**What would show it false:** a setting that both rescues the library and keeps
the titre, in which case the two loops never disagree and no one need decide.

## H4 — memory is what makes the next plate the right one

Five plates are left. A binding assay is a dose-response curve in replicate, so
one plate holds few variants and the library holds 240.

**The claim:** an agent that can read the lab's record finds a variant meeting
the whole profile inside the remaining budget, and one that cannot does not,
because the facts that join *"the melt fails"* to *"the repair aggregates"* to
*"aggregation is fixed by cooling or by the fusion vector"* are the whole
search.

**What would show it false:** the arms finishing level, or the arm without
memory finding a candidate just as fast.

## Registered before the arms ran (2026-10-04)

| | prediction | measured |
|---|---|---|
| P1 | at least one variant meets the whole profile | **held**: 22 of 240 do |
| P2 | none meets it under the last campaign's conditions, in any library | **held**: 0 of 240 |
| P3 | re-expressing the repaired library in the fusion vector, or under a gentler induction, brings at least 50 of its 80 variants above the yield limit | **held**: 75 in the fusion vector at the standard induction; 69 in the standard vector at a colder, gentler one |
| P4 | four of the five remaining plates are enough to produce at least one candidate | **held**: 6 candidates in 4 plates (express, bind, melt, counter-screen), 1 plate spare |
| P5 | the gentler induction costs the fermentation loop enough that the loop would discard it | **held**: the metric falls by about a third, far past the loop's keep rule |
| P6 | an agent with memory finds a candidate inside the remaining budget in at least 2 of 3 runs; one without, in at most 1 of 3 | **FAILED**: 3 of 3 with memory, **3 of 3 without**. Both arms used 4 of the 5 plates |

P1–P5 were measured with the lab's own tools and are reproducible from a fresh
clone.

### Why P6 failed, and what it would take to test H4 properly

Six runs, three per arm, same model and brief, five plates each. **Every run
found candidates, and every run used four plates.** The arms differed in how
they got there, not in whether they did.

The cause is in the lab, not in the agents. **The mechanism is legible without
memory.** `lab/discovery.mjs` is read-only but it is not opaque: its header
lists what the library was built to do, and each vector's note says what it is
for. Two of the three runs without memory said plainly that they read it and
that it shaped their first plate. A lab's equipment describes itself, and a
screening tool has to say what a vector does, so this is not a leak that can
simply be plugged.

**The memory arm had a second way to the answer too.** The space held a passage
of this file, and one run quoted it back rather than assembling the answer from
the facts.

So the comparison as run tests nothing: both arms could read the answer as
prose, and they differed only in where. **H4 is open.** Testing it needs a lab
whose mechanism is not readable from its source by either arm, and a space with
no write-up in it, so that the only place the reasons exist is the record.

**One difference did show, and it is not the one predicted.** Two of the three
runs without memory changed the induction settings on a hunch, to a colder,
gentler induction, without running a fermentation trial — the change H3 says
costs about a third of the titre. Neither knew that, because the cost is in the
record they did not have. The runs with memory left the protocol alone. On
"found a candidate" the arms tie; on "knew what the change would cost" they do
not. That is worth a prediction of its own, and it has not been registered or
measured.

## How to run the arms

```bash
# the lab as the last campaign left it
npm run screen -- --history
npm run query -- --profile

# an agent arm: a fresh clone each, the same model, 5 plates
#   with memory     signed in, memory seeded (see the README), program.md as the brief
#   without memory  the same agent and brief, the memory tools switched off
```

Score a run by `campaign.tsv` and `npm run query -- --profile`, never by what the
agent says it found.

## What this cannot show

- **The library is a model.** The trade-off between binding and stability, the
  cost of a repair in aggregation, and the way a gentle induction rescues a
  difficult construct are all real patterns in protein engineering, but the
  numbers here are generated, not measured from anything. No sequence, real or
  invented, appears in this lab.
- **An assay here is one draw with noise on it.** A real campaign repeats, and
  disagrees with itself more than this one does.
- **The answer is reachable two ways** — the fusion vector, or the colder
  induction — so a run that finds it has not shown which route a lab should
  prefer, and the lab has no cost model that would say.
- **Nothing here has been run with a model in the loop.** H4 is the open one.
