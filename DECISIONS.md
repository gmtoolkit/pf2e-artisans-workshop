# Decision log: pf2e-artisans-workshop

Newest first.

## 2026-10-27: Performance pass (M12)

**Decision:** what the first performance pass changes, and what it leaves to archiving (DESIGN 15.7, OQ-36):

- A live refresh of the Workshop renders the header, the status bar and the shown tab; a hidden tab is marked stale and renders
  when it is shown. The Queue groups the ledger's rows and day records by order once per render.
- An Earn Income job's wages for a span of days are minted in one move (one lock-first batch, one wage row a day as before, one
  purse credit for their sum); a player who is not the earner's responsible client files the span's claims in one write. The
  sweep pays a job's owed days the same way. If that move is refused or stops, none of its days is paid at that moment; the
  day records still say what they owe and the sweep pays them, as it did for a single day.
- The interface makes one `Intl` number and date formatter per language instead of one per amount.
- OQ-36's thresholds (30 and 60 workshop days) stay as proposed: they cannot be tuned before archiving (5.3.3) exists. What
  the pass measured instead is that the lock pages on the ledger, which only archiving prunes, decide its write cost, more than
  the size of its flags.

**Why:** with 200 orders, 2000 rows and 2600 lock pages every change to the ledger cost each open Workshop about 180 ms (the
hidden Queue alone 150 ms), and a week's Advance days with three earners took 40 s, 21 of its batches being one wage each. The
wage move keeps every guarantee of a single wage (the row's key, its lock, the claim path for other clients, the sweep) and
only stops paying day by day. Rendering hidden tabs bought nothing a user could see.

## 2026-10-27: Release engineering (M12)

**Decision:** how releases are built and gated, ahead of the M12 test-table pre-release (DESIGN 16.9):

- GitHub's pre-release flag picks the channel. The tag is the bare semver; `0.0.0` is never released, and a stable release
  may not carry a pre-release suffix. Stable: strings gate and registry completeness enforced, `releases/latest` manifest
  URL, registered with foundryvtt.com when the `FOUNDRY_RELEASE_TOKEN` secret exists. Pre-release: both in report mode,
  its own manifest URL, never registered.
- The Package Release API's first-run dry run (16.3) is a switch, not a one-off: every request carries `"dry-run": true`
  until the repository variable `FOUNDRY_RELEASE_LIVE` is `true`, which the author sets after a dry run has passed.
- The zip is built by the repository's own script on Node's zlib, byte-for-byte reproducible, with `NOTICE` in it and
  `lang/review/` out of it; the same script without `--out` is the local dry run.
- `LICENSE` is the MIT text alone. The Community Use Policy, ORC and OGL notices live in `NOTICE` (shipped), with the
  same notices in the README and the package description. Text that must come verbatim from a licensor, or is the
  author's legal choice, is an `AUTHOR-TODO` placeholder, and a stable release refuses to package while one is left.
- Only the job that uploads to the release can write to the repository, and it installs nothing; only the job that
  registers the release sees the token; the churn watch, which can write issues, installs nothing either.
- The churn watch measures against the pf2e release CI pins, counts only `pf2e-<x.y.z>` tags, lists commits on the dev
  branch by watched path instead of diffing, and keeps one rolling issue that a digest of the findings keeps from
  reopening on the same findings.

**Why:** the M12 test table needs a pre-release before the author's rewrite (16.2), and nothing must reach the listing
by accident: a stable release is the only thing that enforces the gates and talks to foundryvtt.com, and even then it
validates first. A plain MIT `LICENSE` is what GitHub and package indexes read as MIT. The notice text cannot be written
from memory: it has to be the licensors' own words. A reproducible zip lets a local dry run show exactly what CI will
ship. In pf2e's repository "starts with `pf2e-`" also matches the `pf2e-anachronism-*` tags, and a diff of the dev branch
since a release is mostly pack data.

**Consequences:** DESIGN 16.9 (as built, the author's list before 1.0, follow-ups), 3.3 and 15.2 (as built in M12), 16.2
and 16.6 (`NOTICE`, `lang/review/`), the M12 and M13 rows of 17. CI's pf2e checkout gains `packs/pf2e/journals/`, which a
PF2E_SRC test has read since M9a (the `registry` job failed on main without it).

## 2026-10-27: The integration surface after the M11 review

**Decision:** five rules for the module's windows and entry points, found reviewing M11:

- A key a module window answers stops there. The keys the Workshop and the Quick Alchemy panel handle themselves (a row's
  or a tab's arrows, Home, End, Enter, Space, the trapped Tab, Escape) are consumed: no default and no propagation. Tab,
  Space and Enter on any control of a formless module window stop at the window too. Other keys, and keys with Ctrl, Alt or
  Meta, stay core's.
- A window opened from the keyboard takes focus: the keybinding, the sheet entries' buttons and the context menu put it on
  the Workshop's active tab (or the open detail), the status bar's Macros button on the shelf's first tile.
- The sheet entry points follow the master switch as they follow `features.sheetEntryPoints`: either change renders the
  open character and party sheets again.
- A macro refuses with a reason about what the user asked, not about an order they never named (`no-check-order`,
  `nothing-to-finish`).
- The shelf uses the Workshop's own words for its macros' names ("Fund an order", "Collect waiting items"); the ids and API
  names keep theirs.

**Why:** core's keyboard manager listens on the browser window and treats any focused element that is not a field (an
order row, a tab, a button outside a form) as no focus, so a GM's Space on a row paused the game for everyone, an arrow
panned the canvas, and Tab cycled the controlled token and cancelled the focus move. Core focuses only an `[autofocus]`
element on a first render. DESIGN 10.18 says the sheet additions follow the master switch, and 10.9 that live updates never
steal focus. "Pledge" was retired as a money word in M4.1.

**Consequences:** DESIGN 10.18 (After the M11 review, and the lows in its follow-ups), 11.1 (as built), 13 (PF2e HUD and
Token Action HUD not verified). New helpers `keepControlKeys` and `consumeKey` (`focus.mjs`), `withTheme` (`theme.mjs`),
`renderEntrySheets` (`settings.mjs`); `openWorkshop`, `WorkshopApp#show` and `openShelf` take `focus`. New refusal codes
`no-check-order` and `nothing-to-finish`; the string `Downtime.ActivityOf` is gone (the select is named by its label and
the PC's name).

## 2026-10-27: The integration surface as built (M11)

**Decision:** six rules settled while building DESIGN 10.4, 10.9 and 11.1 (10.18):

- Every macro is one call, `api.macros.run(id, args)`, not the bare API member 11.1 names. `run` calls that member with the
  arguments over the catalogue's defaults and tells the user what came of it: a refusal in words, "Already done." for a step
  already taken. A bare API call returns its result to its caller and says nothing, which a hotbar slot cannot use.
- A macro run without an argument it needs opens what asks for it (the form, the order's funding, the tab, or a question)
  instead of refusing. The API members keep their behaviour, so scripts and the harness are unaffected.
- A tile dragged onto the hotbar becomes a world script macro the user owns, flagged with the catalogue's id, and is reused
  for later drops: one macro per user and macro. It needs core's `MACRO_SCRIPT` (Player by default); without it the shelf
  offers Run only. No compendium pack (11.1).
- The Crafting tab strip and the Party card are elements of our own with their own attribute for buttons (never
  `data-action`, `li`, `.formula-item` or `data-item-*`), prepended or inserted, never changing pf2e's markup, and only for a
  member the user owns. The Party card is put back by an observer of pf2e's Overview region, which pf2e renders again without
  a hook.
- Parchment uses core's own `themed theme-light` classes on the window, so Foundry's light colours apply inside it in either
  scheme, plus pf2e's sheet background. The sheet entries keep the light tokens in either scheme.
- The light focus ring is the module's own colour, not core's highlight, which is 2.5:1 on the light panel; a test holds the
  module's colours to WCAG 4.5:1 (text) and 3:1 (focus ring, bar segments).

**Why:** a macro is pressed by a player who sees nothing but the notice it raises, and a double press must be harmless (11.1).
A macro that needs an order or an item is still useful on the hotbar if it asks. Players without script-macro permission are
a GM's choice; the shelf must not pretend otherwise. pf2e, Toolbelt and Workbench all read the Crafting tab's rows, and pf2e's
sheets bind every `data-action` in them. Contrast and focus visibility are what 10.9 promises in both schemes.

**Consequences:** DESIGN 10.4, 10.9, 10.18, 11.1 (as built), 11.2, 13, 14.1, 14.3, 15.1, 15.3, 17 and 17.1. New settings
`features.sheetEntryPoints` (W), `ui.parchment` (C), `ui.windowSize` (C, hidden); new refusal codes `no-macro`, `macro-off`,
`macro-error`, `no-script`, `hotbar-full`, `no-card`. The Workshop's own Settings tab of 10.1 is not built in M11.

## 2026-10-27: The extension API after the M10 review

**Decision:** four changes to the extension API and one addition, found by building the circus module against it and
reviewing both:

- An income source's `perEvent` payment is recorded once per key (`incomes.<id>`, behind a lock page) before its rows are
  posted. Paying the key again posts exactly the recorded rows, so a `split` paid again after a member joins pays nobody
  more. `api.ext.incomePaid(sourceId, key)` says whether a payment is made.
- An `ActivityResult`'s store path that is a prefix of another of its paths is dropped, and so is a later run's path inside
  or around an earlier run's in the same span (the same path: the later run wins).
- A spend through a consumable sink locks the item's stack at the version it read, as the Workshop's own item moves do.
- The wizard's `downtimeDayEnd` names only the PCs whose days its own write landed.
- New within API version 1: `api.funds.posted({source, key})`, an extension's row by its key and whether it was reversed.

**Why:** "the same key posts once" has to hold for the payment, not for each recipient's row, or the payment's size changes
with the party. A result that cannot be written blocks the PC's downtime forever, though a misbehaving callback should count
as nothing. Two spends from one copy of a stack must not both give a bonus for one item. 12.3 says a hook fires on the
client that performed the write. Any member may reverse an `expense` row in the Funds tab, so an extension selling
something for one needs to see the reversal.

**Consequences:** DESIGN 4.1 (the `incomes` record), 5.1 and 5.3 (the ledger key), 11.2 and 12.6 (as built, the lows in
its follow-ups). The refusal `conflict` replaces `taken` for a spend; a spend whose key landed first answers `already`.

## 2026-10-27: The extension API as built (M10)

**Decision:** seven rules settled while building DESIGN 12 (12.6):

- An extension's store is its own flag scope on the Workshop ledger (`flags.<moduleId>`), not `ext.<moduleId>` under the
  Workshop's flags. It is written by the same key-path rules, in the same update as the Workshop's keys when they go
  together (an activity's result with its day records).
- An extension's downtime activity takes runs of its `days` days. A `consecutive` activity broken by another day starts
  again, and the broken run counts for nothing. Its check may be rolled any time before the run's last day is written,
  and the result is written with that day, behind the PC's day lock.
- Aid is the aide's own run of the activity with its own check. It is used by the aided PC's next check of that activity,
  once.
- Income cadences: `perEvent` pays when the extension asks, once per key. `perDay` pays for each day record of a PC in
  downtime. `perWeek` pays on the last day of each seven-day block of workshop days.
- A spend through a consumable sink takes one item off on its holder's own client, logged in `spends` and keyed by the
  extension's key. Inert and expired items are refused. The Bandolier offers it, and the Morning tab counts what each sink
  would take.
- Check-modifier sources apply to the Workshop's own downtime rolls (Craft, Earn Income, helper, season, Repair, extension
  activity and Aid checks) and to extensions' rolls through `api.ext.modifiers`. They do not apply to affliction saves or to
  combat.
- Payload details the design left open: `itemCrafted`'s `delivery` is "shelf" or "strongbox" (every finished item goes
  through the shelf); `downtimeDayEnd`'s `notes` for an extension run's last day are the extension's notes;
  `ledgerPosted` and `orderStatusChanged` are announced by the write path itself, once, on the writing client.

**Why:** the Workshop's migrations rewrite its own flags (4.14) and must never touch an extension's data, which the
extension versions itself (12.4). Foundry accepts any package id as a flag scope. A run's days, its check and its result
have to survive being resolved twice, by two clients or by the wizard and the owner, like an order's days (M6). pf2e's Aid
is a separate check by the helper. A cadence has to be computable by whoever resolves the day, with no timer (9.1). A
spend changes an item on a character, which only its owner's client may write (P2, P3). Combat already has its own sources
of modifiers (pf2e's rule elements). Announcing from the write path is the only place every row and transition passes
through.

**Consequences:** DESIGN 4.1, 4.8, 5.1, 5.3.1, 11.2, 12.4 and 12.6. New ledger keys `extRuns` and `spends`, a claim kind
`income`, refusal codes `ext-*`, `unknown-extension`, `no-income-source`, `not-accepted`, `sink-error`. The circus module is
built in its own repository as the first consumer.

## 2026-10-27: Treasure Vault (Remastered) variants after the second M9a review

**Decision:** six rules settled while fixing the second M9a review (DESIGN 6.16, 10.17, After the second M9a review):

- Only Quick Setup's 2-hour setup of a batch of consumables is recorded outside downtime ("Set up now"), at most 8 hours of
  such setups per crafter per day; any other setup of hours (a consumable's 4 hours, Quick Setup's 4 hours for a permanent
  item) takes the crafter's downtime day on the order.
- A Critical Crafting critical failure can still make the item: its record says so (`made`), by default for the categories
  whose example makes it (secretly cursed, draining the crafter, a malevolent mind, failing when used). It then settles as a
  success would; recorded after a failed settlement it moves the order on by an undoable step. A GM may record it before the
  settlement, and a secret one reads as a success to players.
- A Deconstruct and a crafting quest take no money at all (no pledge, no party-fund earmark).
- Garden funding stops at the seed cost, and members take their money back (the party fund's share too) whenever they ask,
  with gardens off too.
- An order started under a variant finishes under the rules it started with: its frozen setup of hours, its rushed days'
  flat check, its quest, its adjustments, its components credit (the "similar" confirmation is frozen with the commit).
- A Deconstruct's damage and the 10% a critical failure ruins of components are written on the item, not only the order.

**Why:** Quick Setup's text ties the adventuring day to the consumable case only (TV-R p.159), and the book gives no daily
number, so a working day bounds it; the book says the critical failure examples "tend towards possibilities where the item
is still created" (TV-R p.161) and suggests secret rolls so that a player does not know; money allocated to an order that
completes without a remainder has no refund path; a variant switched off mid-order must not strand money or work; anything
kept only on the order is shed by cancelling it.

**Consequences:** DESIGN 4.2.3 (the `made` transition), 6.16.1-6.16.9 and 10.17; refusal codes `downtime-day`, `hours`,
`moneyless`, `over-seed`, `made`; `withdrawGarden` and the garden's slot lock; the low findings are in 10.17, Follow-ups (M9a,
low).

## 2026-10-27: Tattoos and spell-supplied items after the M9 review

**Decision:** four rules settled while fixing the M9 review (DESIGN 10.16, After the M9 review):

- A decorative tattoo is made non-magical on the item: its `magical`, `invested` and tradition traits and its rule elements are
  removed. A tattoo still healing, a decorative one and an inactive graft are uninvested again if invested by hand.
- A subject who will sit for a tattoo or graft resolves its earlier downtime days before agreeing (`days-pending`), and "Agree"
  says what the subject gives up first. The lock still runs from the consent (no start day).
- A spellheart's casting at the spell's own rank takes the spell as it is, cantrips included; a cantrip's casting is not sold by
  a spellcasting service, so a caster supplies it.
- Prepared snares are deployed by marking the slot expended through pf2e, not by `craft`, and make no item.

**Why:** Secrets of Magic says the failed tattoo "becomes a non-magical tattoo", and pf2e applies a worn item's rules and offers to
invest anything with the `invested` trait, so only the item's own data can say so; a lock with no start day spends every
unresolved day sitting, and leaving downtime already asks for days to be resolved first; every spellheart casts a cantrip, and
the Player Core service table starts at rank 1; pf2e's `craft` expends a snare's slot and returns nothing (DESIGN 6.15 gap 23),
and placing snares is a non-goal (1.2).

**Consequences:** DESIGN 6.14, 7.1 and 10.16; refusal codes `cantrip-service` and `not-deployed`; the follow-ups the review
logged are in 10.16, Follow-ups (M9, low).

## 2026-10-27: Tattoos, grafts and the remaining crafts (M9)

**Decision:** eight rules settled while building M9 (DESIGN 6.9, 6.14, 10.16):

- Investiture: each magical tattoo and each graft lowers its subject's invest limit by one (Tattooed Historian's exemptions
  aside), and a new one fails only when that limit is already zero: a tattoo stays decorative for good, a graft is inactive until
  the limit rises. Items the subject invests each day never make it fail; the subject is told to stop investing one.
- The subject consents from the Queue; where the process needs it present (the Secrets of Magic process, every graft) it is
  locked from that consent, as a helper is from joining, until the order closes or it withdraws (before the start, or after a
  failure). The one-at-a-time limit is on the tattooist (implanter), and G11 now also reads the crafter's own lock.
- A Secrets of Magic tattoo heals for `rules.tattooHealingDays` (30) from the finish; recorded magical or alchemical healing
  ends it that day, never before the day after the finish. It is invested by the subject's own responsible client when it
  heals, which needs no ledger claim since the item is on the subject. The simple toggle and grafts have no healing.
- The rapid fulu option is not built: under the Remaster Craft a crafter with the formula already takes one setup day and may
  pay the full Price to finish at once, so the option would only cut the fulus' life to a month. Fulus last a year (365 days).
- A fulu takes its crafter's spellcasting tradition when there is exactly one; otherwise the crafter chooses one (no GM gate).
- Spell-supplied items read what they need from their own description in the installed compendium: a staff or coda every
  listed spell at every listed rank (cantrips included, supplied by casting them), a spellheart the spells it casts, a specialty
  wand one spell of its rank, any other item the spells its Craft Requirements link; a casting asked for without a link takes any
  spell. Each pledge names the listed casting it supplies.
- An upgrade of a tattoo or graft is a tattoo or graft order naming the item it replaces, at the Price difference; the old item
  goes when the new one arrives.
- The inventor class has access to uncommon gadgets through a registry entry keyed apart from the Inventor skill feat.

**Why:** the investiture reading was settled in the earlier review; Secrets of Magic p.164 and Howl of the Wild p.97 put the
one-at-a-time limit on the tattooist and implanter and keep the subject present throughout, and the helper lock is the model the
day planner already has; pf2e counts tattoos and grafts among invested items, so the subject's own client is the one that can
invest them; a Remaster rule that already gives one day and immediate finishing makes the old rapid option a strict loss; the
Craft Requirements of staves and spellhearts name their spells only in their descriptions, which the module may read at runtime
but not ship (P9).

**Consequences:** DESIGN 1.1, 4.8, 4.12, 6.9, 6.11, 6.14, 7.10, 10.16, 14.3, 15.3 and 17; three settings (`features.tattoos`,
`rules.tattooSubjectLocked`, `rules.tattooHealingDays`); registry kinds `crafterMark`, `investitureExempt`, `quickDeploy`. Unlinked
spell names in Craft Requirements are a follow-up (10.16).

## 2026-10-27: The affliction tracker after its second review (M8a)

**Decision:** six rules settled while fixing the second M8a review (DESIGN 8.10, 10.15 After the second M8a review):

- The affliction clock is world time moved on by the whole days the Advance days wizard's log runs ahead of the clock's day
  (`worldTime + max(0, manualDay − clockDay) × secondsPerDay`), not the end of the last logged day. No high-water mark is kept: a
  midnight the world clock crosses while the log is still ahead takes a day off the affliction clock, and due times wait, as for a
  clock set back.
- A stage whose text qualifies its mapped parts (a choice between them, a condition on them, a duration of their own, acting "as
  if") applies none of them; an override names the parts that do apply. "As stage N, but" replaces what it names.
- An intro that names a stage condition with "cumulative", "can't be removed", "lasts for", "ends when" or "while the poison lasts"
  needs an override: `cumulative`, `detach` or `intro: "table"`.
- A re-exposure waits behind a stage save that is pending or due, and a stage save waits behind a pending re-exposure; save
  numbers skip every reserved one. A re-exposure's save counts that exposure's own initial-save modifiers.
- Pinpoint Poisoner needs an off-guard creature for every delivery; a Strike's off-guard is read from its attack roll's options at
  the hit (flanking is the target clone's ephemeral condition, never an item on the target).
- A definition with no compendium source is kept with its claim, coating, cloud and tracker; a coated piece of ammunition becomes
  its launchers' selected ammunition, and its coating rides the launcher from the hit to the damage roll.

**Why:** the clock pinned to the end of the logged day froze every round-scale affliction until world time passed it, even after
"advance clock to match"; a stored high-water mark would also hold back exposures made after a midnight crossing, while the plain
reading only makes running ones wait, which 8.10.7 already accepts for a clock set back, and it matches the workshop day's "a clock
advance that lands inside logged days adds nothing". Applying a condition taken out of a conditional sentence (Curare's paralysis)
is worse than leaving the stage to the table. The rest are the rules as written (Player Core p.431, Player Core 2) and pf2e's own
data flow (the Strike's origin is the launcher; the fired piece is consumed after the attack roll).

**Consequences:** `scripts/data/afflictions.mjs` holds 120 overrides (10 for intro rules; Curare's stage 3 and Reaper's Shadow name
their parts); some qualified stages lose correct parts until an override names them (10.15 follow-ups); the stubs write `parent`
and `pack` into an update's operation as Foundry does, and the module passes a fresh one (`ownWrite()`).

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
