# Decision log: pf2e-artisans-workshop

Newest first.

## 2026-10-25: Circus management is a separate module

**Decision:** Adventure-path circus management (Prestige, Anticipation, Excitement,
shows, circus week, payouts) ships as its own module, not inside the Workshop. The
Workshop exposes a public API that such modules use: downtime activities that occupy
a PC's day, income sources that post to the party ledger, consumable sinks (e.g.
alchemical items spent on a trick), check-modifier sources, and hooks
(`downtimeDayStart`/`downtimeDayEnd`, `incomeComputed`, `itemCrafted`,
`formulaAcquired`, `ledgerPosted`, and a registration hook at setup).

**Why:** keeps the crafting module focused and campaign-agnostic; the circus rules
are adventure-path specific, partly sourced only from fan transcriptions, and carry
OGL Product Identity concerns that should not ride along in the crafting package.

**Consequences:** the extension API is a first-class deliverable, designed and tested
before the circus module is built. The first table's GM runs the circus shows, so the
circus module is the API's first consumer and its acceptance test.

## 2026-10-25: No public release until the full scope is done

**Decision:** no staged public MVP. Internal milestones are fine, but the package is
listed only when the agreed scope is complete.

**Why:** the author's call; one complete first impression for GMs deciding whether to
install it.

**Consequences:** build order is still sequenced for testing at the first table
(likely via manifest URL to that GM before the listing), but there is no reduced
public feature set to support.

## 2026-10-25: UI text is drafted in code, rewritten by the author before listing

**Decision:** Claude writes the code and drafts every user-facing string in
`lang/en.json` (plus the README and package description). The author rewrites all of
it before the package is listed, so that the published text is human-authored as
Foundry's AI Content Policy requires. A release gate enforces this: a review manifest
records a hash of each string the author has signed off, and the release workflow
fails if any `en.json` string is new or changed since its sign-off.

**Why:** Foundry's AI Content Policy (https://foundryvtt.com/article/ai-policy/,
2026-03-18) requires human-authored UI labels, journal text and package descriptions
for listed packages, and no AI-generated images. Light edits to a machine draft are a
grey area; a full rewrite is not.

**Consequences:** no AI-generated icons or art (core, pf2e or Font Awesome only).
Code must stay small and explainable enough that the author can maintain every part
of it, which the same policy requires.

## 2026-10-25: Name, home and visibility

**Decision:** the module is `pf2e-artisans-workshop` ("Artisan's Workshop"), lives in
the `gmtoolkit` GitHub org next to the other public Foundry packages, and is public
from the first commit. It will be listed on foundryvtt.com.

**Why:** the name covers every crafting journey (alchemy, magic items, cooking,
tattoos), not just alchemy, and does not collide with PF2e Workbench. The package ID
was checked free on foundryvtt.com and in the org before the repo was created.

**Consequences:** the package ID is permanent once listed, so it is fixed now. Design
churn happens in the open.

## 2026-10-25: Target the latest Foundry and PF2e, Remaster first

**Decision:** compatibility tracks the latest Foundry VTT generation and the latest
PF2e system release. Remaster rules (Player Core, Player Core 2, GM Core) are the
baseline.

**Why:** the first table runs current versions on a managed host and plays all
Remaster. Supporting older generations would mean carrying Application V1 code that
Foundry is removing.

**Consequences:** the exact minimum and verified versions are set from the platform
research before the first release, and need a fast path for following PF2e releases.

## 2026-10-25: Integrate with the modules GMs already run (proposed)

**Decision (proposed):** never duplicate pf2e-dailies, PF2e Toolbelt, PF2e Workbench
or Item Piles. Detect them and hand off or extend where they already own a feature;
daily preparation in particular has to coexist with pf2e-dailies.

**Why:** the module is adopted at a player's request, so it has to be safe to install
into a GM's existing world: no double prompts, no competing automation.

**Consequences:** integration points are researched before the daily-prep design is
fixed.
