# Decision log: pf2e-artisans-workshop

Newest first.

## 2026-10-27: The affliction tracker as built (M8a)

**Decision:** six rules settled while building 8.10 (DESIGN 10.15):

- The Afflictions "drawer" is a window of its own, opened from the Workshop header's pending count, the Bandolier, the API and
  the cards, not a panel inside the Workshop.
- An override may mark stages whose remaining text is for the table (`prose`): a reviewed acceptance, numbers only. The corpus
  check counts it as covered; the window shows that stage's own paragraph from the installed compendium. `reExposure` takes
  `reset-max` (Toiler's Gruel) and `table` (Grolna, whose rule is the table's) beside `none`.
- Spells and creature abilities with stages are in the corpus and can be started with Expose: a spell's save is its defense,
  against its caster's spell DC, and a creature ability's blank DC is its creature's; either is typed on the Expose.
- A stage interval an item leaves out is one round when its maximum duration is in rounds; weeks, months and years are 7, 30 and
  365 days.
- Catch-up's `pause` stops after the first automatic save of a chain (the one that fell due), `roll-each` after
  `afflictions.catchUpLimit`; a save rolled by hand starts the count again.
- A re-exposure whose affliction ended before its save was recorded starts the affliction again, as a new initial exposure.

**Why:** a window can stay open beside an encounter and opens from places the Workshop is not; most unread stage text is prose no
number can carry (item bonuses, choices, death), and the rules engine runs the rest; the system packs give spells and abilities the
same stage paragraphs; pf2e's effect units stop at days; a time skip should not roll a pile of saves unseen, but one save that is
simply due in combat must not stop; an exposure applied to nothing would otherwise leave a tracker that never ends.

**Consequences:** DESIGN 8.10 (As built in M8a), 10.15 and its follow-ups; `scripts/data/afflictions.mjs` holds 110 overrides
and 5 ignored items against pf2e-8.6.1, checked in CI.

## 2026-10-27: Combat alchemy after the second M8 review

**Decision:** five rules for combat alchemy (DESIGN 8, 10.14 After the second M8 review):

- One additive a round is enforced only in an encounter. Outside one there are no rounds, so it is not enforced.
- A Quick Alchemy item carries a tag of its stamp in pf2e's own `system.traits.otherTags`, so pf2e's stack test never merges
  it with an item of another stamp. The module does not wrap pf2e's `isStackableWith` (P6: no monkey-patching). pf2e is
  handed the compendium item with the module's flags already on it, so no client ever sees the item unstamped.
- The module sets a pf2e toggle for a Strike only when it has a value of its own: a field-vial type or material chosen, or
  the item's additive. Each toggle it changes is put back as the player had it at the next Strike through the module.
  While Duct Tape is active it sets none.
- Combine Elixirs' elixir carries both elixirs in its own data: the healing summed in `system.damage` and both
  descriptions. pf2e's `consume()` then applies both, from any sheet.
- Without a canvas, Healing Bomb's target is picked from the party and the encounter. The card lists the party's living
  members other than the target. The card goes to the owners of everyone listed.

**Why:** world time often stands still between scenes, so a world-time round made a second Healing Bomb after a fight wait for
a GM to move the clock (P2). Only system data survives pf2e's stack test, a trade and a drop on an ally. Switching off a
toggle the player set on pf2e's sheet changed their Strikes without telling them, and Duct Tape owns combat when it is
active. An ally drinks a combined elixir from pf2e's sheet, which the module cannot intercept. A table without a canvas has no
tokens to target or select.

**Consequences:** the tag shows as an item roll option (`item:tag:pf2e-artisans-workshop-quick-<id>`); a toggle the module set
stays set until its next Strike (pf2e reads it again for the damage roll); an adjacent creature outside the party gets no
Apply button without a canvas. The live plan `m8-healing-bomb` checks the additive in and out of an encounter.

## 2026-10-26: Quick Alchemy items expire on their holder's client; pf2e's own Quick Alchemy action is stamped too

**Decision:** turn expiry (DESIGN 8.8) is part of M7's expiry sweep: on core's `combatTurnChange` and when an encounter
ends, each client marks what the actors it is responsible for hold (5.6), from the encounter's state at that moment, as
party-wide expiry does (7.7), rather than the creator's client alone. An item made in an encounter carries the encounter,
the creator's combatant and the round and turn it was made in; one made outside an encounter lasts one round of world
time. What pf2e's own Quick Alchemy action makes (its chat path stamps nothing) is stamped on the client that made it, as
the module's panel stamps its own.

**Why:** a client may write only what its user owns, so the creator's client cannot mark an elixir an ally holds, and the
holder's can; reading the deadline from the encounter's state, not from one turn change, gives the same answer when turns
are skipped or a client missed the change. Players will use pf2e's own action as often as the panel: its items would
otherwise never run out.

**Consequences:** DESIGN 8.8 and 10.14 (As built in M8); the module still cannot gate pf2e's action, which crafts for free
at 0 vials. Quick Alchemy items are left off the Expiry card.

## 2026-10-26: Preserved foods stop being temporary; the rules text beats pf2e's daily-pool data

**Decision:** a food designated with Food Preservation gets `system.temporary: false` (and is made temporary again when
it spoils), and the designations are kept on the creator rather than read from its inventory. Where pf2e's data for a
daily-preparation source disagrees with the feat's text (Herbalist's two fewer outside the wilderness, Lethargy
Poisoner's doses by rank and Stupor Poison from expert, the alchemist archetype's Advanced Alchemy making consumables
only), the registry's `correction` effects lower pf2e's count or narrow what the pool makes, the Morning tab shows both
numbers, and the Workshop refuses a plan beyond the rules' count, a kept preparation included. Whether the preparations
are made in the wilderness is asked on the Morning tab for each preparation.

**Why:** pf2e's Rest for the Night deletes every temporary item on the actor that rests, so an exemption from the
module's own expiry alone kept nothing; the feat's cap counts every preserved food, wherever it went. The registry exists
for data the system gets wrong (6.11), and the module never re-implements pf2e's crafting: the corrections only make the
module ask pf2e for less than pf2e would allow, through the same `CraftingAbility` methods.

**Consequences:** DESIGN 7.4, 7.7, 7.9 and 10.13 (After the second M7 review); a correction carries the pf2e rule it
answers (`bug`), and the validation script reports it once pf2e's rule changes. pf2e's own sheet still prepares by
pf2e's numbers.

## 2026-10-26: Talisman Dabbler's daily talismans need no formula book

**Decision:** the talisman pools' virtual lists (Talisman Dabbler: common talismans of the character's level or lower;
Talisman Esoterica: the common GM Core ones) are offered on the Morning tab up to the pool's own item level (half the
character's level), and the talismans picked are made with pf2e's `CraftingAbility#craft` without consuming a prepared
slot, counted against the pool's slots by the module. Nothing is written into the formula book for them, and no
`virtual` provenance record is written. A talisman the book does have goes through the pool's prepared list as before.

**Why:** Player Core 2's Talisman Dabbler Dedication says the character remembers talisman formulas and needs no formula
book for them; writing every talisman picked into the book would fill it with formulas the character never learned
from one. pf2e drops prepared formulas the book does not know, so its prepared list cannot hold them; `craft` does not
check the book (verified), which is what lets a virtual talisman be made through the system's own method.

**Consequences:** DESIGN 7.4 and 4.13 change; the Morning tab, not the book, is where a Dabbler's talismans are chosen;
permanent talismans crafted in downtime still take the 1-day `virtual` route of 4.3 (OQ-8).

## 2026-10-26: Expiry by preparation cycle, raised at the rest

**Decision:** what a character's daily preparations make is stamped with the character's preparation cycle
(`pcs.<actorId>.prepCycle`), which goes up when Rest for the Night is taken (after pf2e-dailies' own rest when it is
active) for a character with a daily pool or versatile vials, or when "Prepare for a new day" is used without a rest.
Each holder's client marks inert what an older cycle made, wherever it is; a character in downtime without a standing
routine keeps its cycle at a rest. A party member's standing order never blocks the crafter's own preparation: one that
does not fit is left out for the day.

**Why:** the infused trait ends items at the creator's next daily preparations, and the system deletes temporary items
only on the actor that rests; the rest is the one signal every table already gives. A fighter's rest writes nothing,
since nothing it makes is stamped.

**Consequences:** DESIGN 7.7, 7.8 and 10.13 (As built in M7); the turn-based expiry of Quick Alchemy items is M8's.

## 2026-10-26: README screenshots in docs/screenshots/

**Decision:** the README shows screenshots of the module's own window, taken by `npm run screenshots` from a demo party
staged in the dev world (DESIGN 17.1) and kept in `docs/screenshots/`. The asset check allows images there and nowhere
else: PNG files directly in that folder, each at most 400 KiB. The release zip never includes `docs/`. The captions and
the window's wording are draft until the author's rewrite (M13), when the captures are taken again.

**Why:** 17.1 schedules the captures after M5's live pass. Captures of the module's own UI are not AI-generated images,
so Foundry's AI Content Policy permits them; the folder rule and the size cap keep every other image out and the
repository small.

**Consequences:** DESIGN 16.2, 16.5 and 17.1 say so; `tools/check-assets.mjs` has the folder rule, with tests. Whether
pf2e item icons may appear in the captures is still the author's open question in 17.1.

## 2026-10-26: M5 on fund accounting

**Decision:** M5 is merged onto M4.1 and its money follows the fund accounting of the entry below. Every purchase M5
writes (a formula bought, a casting bought at the service price, a spell's cost, a formula copy) is paid from a source
the user picks, the party fund or a character's purse, through M4.1's amount prompt. A purchase from the party fund
takes its coins out of the strongbox together with the fund's allocation (`purchase` with `via: "box"` is now -n
`alloc`), behind the fund slot; for an order it is earmarked and spent by the order in one move, so the order shows it as
spent by the party fund. Material stock counts in what an order still needs and is listed beside the money by who
handed it over. A formula copy's cost goes back to its source on a cancel. In the window a casting is "offered", not
"pledged", since "pledge" was the money word M4.1 retired.

**Why:** without it, M5's purchases came only from purses (the party fund could not pay for a formula or a casting),
"Fill the shortfall" ignored the stock M5 counts toward the up-front half, and M5's casting words collided with the
money words M4.1 replaced.

**Consequences:** DESIGN 4.6, 4.7, 6.6, 6.9 and 10.11 carry "As built in M5 on M4.1" notes; a new live plan `m5-fund`.
A purchase for an order never comes out of the money already earmarked for it.

## 2026-10-26: Fund accounting, from the first hands-on session

**Decision:** the party's money is shown and handled as simple fund accounting. The
strongbox holds the party fund, split into **unallocated** money and money **earmarked**
for specific orders; each earmarked amount records its source (the party fund or a
named member), and spending is shown per order. Adding money to the party fund leaves
it unallocated. Funding an order takes a source: the party fund (re-labels unallocated
money as earmarked, no coins move; any member may do it, and the ledger records who) or
the member's purse (coins move in). Spending deducts from the order's earmarked money,
any shortfall at finish asks which source to draw from, and refunds return each share
to its source. All money is entered as separate pp/gp/sp/cp fields.

**Why:** in the first real use the author deposited 18 gp to the party fund for an
order and nothing could move it onto the order; a single amount field read "18" as
copper; and "pledge" versus "deposit" was not understandable.

**Consequences:** the Funds tab and order funding are reworked in M4.1. The search box
stays an order filter; a magnifying-glass button opens the existing item picker and
pf2e's Compendium Browser rather than a new item search.

## 2026-10-25: Open questions settled by the author

- **Scope added:** every crafting variant in Treasure Vault (Remastered) pp.157-175
  (Complex Crafting with Quick Setup, crafting items with adjustments, crafting downtime
  events, Critical Crafting, Deconstruct, Grow, Gardens of Wonder, Bestowed Gifts and
  crafting quests), as world settings off by default; and a built-in affliction stage
  tracker for crafted and used poisons, using the pf2e system's affliction schema (see the
  backend entry below). Compendium poisons carry their stages only as description text, so the tracker
  parses it at runtime from the installed compendium (registry overrides for the ones
  that don't parse) and ships no Paizo text.
- **Affliction backends:** pf2e
  release builds remove the `affliction` item type (its constructor throws and no data
  model is registered), so no affliction item can exist in a released world. The tracker
  therefore keeps the type's schema in an `effect` item on the victim until pf2e enables
  the type in release builds, then migrates to native `affliction` items.
- **Scope excluded:** snare placement on the map (snares are craftable items only); a
  legacy rules toggle (legacy content is allowed and badged, but the math is always
  Remaster); items that exist only in the PF2e Legacy Data module.
- **Privacy:** roster snapshots (members' formulas, crafting-relevant feats and ranks)
  live in the shared ledger, readable by all players; the UI hides ranks when pf2e's
  party-stats setting is off.
- **Forge:** no dedicated Forge test. The design avoids every surface the Forge
  changes (uploads, FilePicker, compendium packs, runtime JSON fetch), and the first
  pre-release run at a Forge-hosted table is the smoke test.
- **Listing:** titled "PF2e Artisan's Workshop", with the Community Use Policy notice
  plus ORC and OGL notices.
- **Rules-gap defaults** (each a setting): Communal Crafting helpers roll against the
  item's DC, their degree selects the Income Earned column at (helper level - 1) and
  their rank, and a helper who leaves forfeits the benefit; interrupted setup days
  persist; a level-up recomputes the daily rate; swapping crafters restarts setup and
  check while materials carry over; legendary Crafting from item level 17; one formula
  covers every grade of an item; reverse-engineering keeps the item; copying a formula
  from an ally is free and takes an hour; downtime-crafted alchemy is not infused; one
  Workshop per world with orders tagged by party.

## 2026-10-25: Derived rules from the design review

These follow from the decisions below and were confirmed while writing `DESIGN.md`.

- **Orders own their Craft and Earn Income rolls.** Checks go through
  `actor.skills.crafting.roll` (and the skill's own roll for Earn Income) with the
  crafted item's roll options, `action:craft`, and an explicit DC. The system Craft
  macro drops the rarity adjustment and the item's roll options, so gear and feat
  bonuses predicated on the item never fire, and its pay buttons assume every day was
  worked. The system Craft button itself is left alone.
- **Responsible client.** For a write triggered by an all-client hook: the connected
  owner of the affected actor (by stable id order), else the active GM, else the first
  connected user; one browser tab per user holds a Web Locks lease, and lock-first
  batches make cross-device duplicates harmless. This replaces "the acting user, else
  the active GM", which names nobody when neither is connected.
- **Duct Tape step-aside.** If PF2e Alchemist Remaster Duct Tape is active, the combat
  features (Bandolier, Quick Alchemy panel, vial gathering, Healing Bomb) turn
  themselves off; Use best consumable and everything outside combat stay. Without it,
  combat is ours.
- **When shared documents are created.** Installing and enabling the module writes
  nothing. A GM turning on the master switch creates the ledger and strongbox (and sets
  player ownership); feature toggles then default on, except vial gathering.

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
