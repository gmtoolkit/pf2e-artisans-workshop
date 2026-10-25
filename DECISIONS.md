# Decision log: pf2e-artisans-workshop

Newest first.

## 2026-10-25: Requirements are the gate, not GM approval

**Decision:** no order needs GM approval. An order can start when its rules
requirements are met: the crafter can use a formula (known, covered by a base formula,
granted by a feature, or obtained by buying, copying, Inventor or reverse-engineering
an item the party holds), the materials are on hand (including precious-material
quantities), the item level, rarity access, proficiency and feat gates pass, and the
up-front gold is funded. Narrative Craft Requirements are a checklist the crafter
confirms, not something the module adjudicates.

**Why:** the GM's lever is in the fiction: whether the party can source the formula,
the item to copy, the materials or the gold. If the party has them, the Craft works
and the module does not second-guess it. Approval prompts would add GM workload
without adding control.

**Consequences:** the planned GM approval inbox is dropped. The reversible ledger
stays (anyone can see who moved what; the author of a row, or a GM, can reverse it).
GM tooling focuses on settings, Earn Income task levels, and data hygiene.

## 2026-10-25: Works with no GM online

**Decision:** players can file requests, pledge and escrow gold, run Crafts and log
their own downtime with no GM connected. Shared state lives in module-created
documents that every player owns: a Workshop ledger and a strongbox actor for escrowed
coins, created once by the GM's client when the module is first enabled. Each player
otherwise writes only documents they own (their own actor). Finished items for another
PC go to a pickup shelf in the strongbox and are claimed by the recipient's own client;
a GM relay over core `CONFIG.queries` is used only as an accelerator when a GM is online.
Tables whose players already own the pf2e Party actor can use its stash instead.

**Why:** the author's table should not stall on GM availability, and players cannot
write documents they don't own (pf2e #12645 confirms the party stash needs Owner).

**Consequences:** the trust model is cooperative: owners can edit shared rows, so
every ledger row records its author and nothing is silently overwritten. The
one-responsible-client rule still applies to hook-driven writes.

## 2026-10-25: Downtime days follow the world clock, with a manual wizard fallback

**Decision:** when world time advances (core time controls or any calendar module,
via `updateWorldTime`), PCs marked as in downtime accrue days on their current
activity, and the owning player gets one prompt to resolve them. When nobody uses the
clock, an "Advance days" wizard walks the party through each day: activity per PC,
checks due, cost reductions, Earn Income, expiry.

**Why:** some tables run a calendar module and some never touch the clock; time passing
also doesn't mean the party was in downtime, so accrual needs the per-PC downtime flag.

## 2026-10-25: Interview answers that set defaults

- Escrow: pledged coins move into the strongbox and are refunded by outcome.
- Expiry: Quick Alchemy items and infused items are marked inert automatically, with
  the feat and item exceptions honoured.
- Cooking is flavour plus Cooking Lore for Earn Income; no meal or recipe system.
- Tattoos: the Secrets of Magic process (subject present, healing period, investiture)
  is the default, with a simple-Craft toggle; the item catalogue is mostly Treasure
  Vault (Remastered). Tattoo Artist is Remaster (Impossible Magic).
- Target devices are laptops and desktops; windows from about 1024 px wide.

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
