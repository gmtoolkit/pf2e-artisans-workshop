# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the module uses
[semantic versioning](https://semver.org/) from 1.0.0.

## [Unreleased]

### Added

- Development scaffold (milestone M0): manifest, ESLint rules, tests, the strings sign-off gate,
  the asset and manifest checks, CI, and fixture actors for the local test harness. No features
  yet.
- Rules core (milestone M1), as pure functions with tests and not yet used in Foundry: the level,
  rarity and Craft DCs; Income Earned; Craft pricing, setup (with the formula, without it, the fixed
  setups and Complex Crafting's table), the frozen plan and the money each order step moves; extra-day
  reductions with level-up recompute, minimums and the level-20 critical-success row; batches,
  including ammunition and Efficient Alchemy; formula families and coverage; eligibility gates G1-G12;
  precious materials; Communal Crafting helpers and Aid; formula routes and acquisition jobs; Earn
  Income jobs; the coin planner (pf2e change-making, create-only strongbox plans) and the pro-rata
  splitter. The numeric tables ship as data modules cited by book and page.
- Storage and sync (milestone M2), with no window yet: the master switch, which has a GM create the shared
  ledger and strongbox that every player owns (and re-create or repair them); the schema version with a
  migration framework; the key-path store over the ledger; the responsible client with a one-tab lease;
  coin moves as lock-first batches using the coin planner; claims for refunds, wages and deliveries, with the
  GM relay as an accelerator; roster snapshots; deletion guards; the GM's purge of all data; reconciliation
  and the catch-up sweep at ready. Settings for the master switch, members, auto-claim and the rules-gap
  defaults. Live-harness scenario scripts for the multi-user cases.
- Live-harness driver (`npm run harness:live`): runs the storage-and-sync scenarios in a running dev world
  with Playwright, one browser per user and device, and checks the results against the server.
- Rules registry and roll wrapper (milestone M3), with no window yet: a registry of the feats, class features and
  gear that change crafting, formulas, daily preparation and Earn Income (slugs, compendium UUIDs and numbers only),
  checked against the pf2e compendium, with lookups that feed the rules core (virtual formulas, access, unlocks,
  substitute skills and tools, batch size, setup, daily rate, formula picks owed, Experienced Professional) and a
  validation script that CI runs against the pinned pf2e release. Craft checks are rolled through the Crafting
  statistic with the item's own roll options, an explicit DC with the rarity adjustment, and the registry's options
  and modifiers, so gear and feat bonuses predicated on the item apply; Earn Income checks add `action:earn-income`.
  Each check's chat message is recorded on its order or job by its author's client, once, Hero Point rerolls
  included; settling a Craft check posts its money rows, and an Earn Income day is paid once however often it is
  resolved.
- The Workshop window (milestone M4), with its Queue and Funds tabs. The Queue lists the party's orders with a status
  chip, a progress bar of the up-front half, the reduction earned and what is left, the days to zero and the amount to
  finish now, the reasons an order cannot start, filters and a detail panel with the order's history and ledger rows.
  Orders go from a request (a form, or an item dropped on the Queue) through pledges into escrow, acceptance, start once
  every requirement is met, days of work, the Craft check and its settlement, to finishing: the remainder is paid from
  escrow, over-funding is refunded, and the item goes on the pickup shelf for the recipient's own client to collect,
  with no GM needed. Cancelling refunds every contributor; the last step can be undone. The Funds tab shows the
  strongbox, the party fund, escrow, member balances and the ledger with authors, with deposits, withdrawals and
  reversals, and reconciliation for GMs. Chat cards follow each order, notifications tell the people involved, and
  the window opens from the Actors directory, the Party sheet or the API. A delivery can no longer arrive twice, and a
  reroll that lands after its check was settled is kept as a conflict instead of replacing it. When two people act on
  the same order at the same moment (a cancel and a finish, two offers to craft), only the first goes through, and the
  purge's refunds never pay a contributor whose refund is still waiting a second time. Typing and keyboard focus survive
  the window's live updates, and a detached window keeps its forms and dialogs with it.
- Formulas (milestone M5). A Formulas tab shows a character's formula book grouped by family, with how each formula
  was learned and the other grades each family covers, the formulas its feats and features give it without a book, the
  formula picks they still owe by level, and the party's families. A formula can be bought, copied from an NPC, scanned,
  taken for an owed pick, or asked of an ally (who performs the copy), at once; or invented, reverse-engineered (keeping
  the item) or crafted as a copy for another member's book, as orders on the Queue. The learner's own client writes the
  formula into the book, with no GM needed. Scrolls, wands, staves and spellhearts take casting pledges from party
  casters (or a bought casting) before they can start, and a finished scroll or wand carries the pledged spell. Precious
  material stock (all of a stack or part of it) can be handed over toward the up-front materials before an attempt
  starts. Runes can be etched onto items they fit, at the rune's Price (or the difference to the rune they upgrade), and
  transferred between items, and items upgraded to a stronger grade at the Price difference, with the item handed over
  to the strongbox when the crafter does not hold it and returned with the change. Repair, affixing and removing talismans, Identify
  Alchemy and formula copies are service orders any member can ask for and perform.
- README screenshots (`npm run screenshots`): a demo party staged in a dev world, and the Workshop window captured
  cropped to its frame (the Queue with an order's detail, the request form, Funds, Formulas, Downtime, Morning, the
  Bandolier and the Quick Alchemy panel in an encounter, and the Queue in the light theme) into `docs/screenshots/`, the only place the asset check allows images; the world is put back afterwards. They
  are not part of the release.
- Fund accounting (M4.1, from the first hands-on session). The Funds tab shows the strongbox as the party fund's
  unallocated money plus what is earmarked for orders, each order's earmarked money by source (the party fund or a
  member) and what it spent. "Add to party fund" puts coins in unallocated; "Fund this order" takes a source, the party
  fund (earmarks unallocated money, no coins move, any member may) or a character's purse; an order's party-fund share
  can be given back; spending deducts each source's share; a finish that lacks money asks which source to draw the rest
  from; refunds go back to each source. Two members earmarking the same money at once cannot both succeed.
- Every amount is typed as pp, gp, sp and cp, with "Fill the shortfall" filling in what the order still needs.
- The order detail names each requirement in plain words ("Trained in Crafting", "Up-front materials funded"), folds the
  met ones into "11 of 12 met" and offers "Fund it" for missing up-front money; it explains the work-day rule, lists each
  setup and work day with what it took off, and sums up what a finished order cost.
- A finished order's card and detail say where the item went (delivered to whose inventory, on the pickup shelf with
  Collect, or kept in the strongbox); the header's pickup-shelf count is a Collect button.
- The Queue's search box is labelled as an order filter; a magnifying-glass button opens the request form's item search,
  and the request form's "Browse" opens pf2e's Compendium Browser to drag an item from.
- Downtime (milestone M6). A Downtime tab shows the workshop day (the world clock's day, or the days logged ahead of it)
  and, for each character (a player's own, every member for a GM), whether it is in downtime, what its days go to (an
  order it crafts, an order it helps with, an Earn Income job, or something else) and the days it has to resolve. When
  the clock moves, each character in downtime with days to resolve gets one prompt, on its player's client (the GM's
  when the player is away, or at the player's next login), and a badge on the tab. "Resolve days" resolves a
  character's days; "Advance days" is a step-by-step wizard any member can run, with or without a GM, that moves the
  days on for everyone in downtime, rolls the checks that are due, reviews what will be written and writes it; a GM
  may move the world clock to match. A day is never resolved twice, from two devices or two players at once. An
  order's "Work a day" is the same resolver for one day.
- Communal Crafting helpers: a character with a relevant skill joins an order, rolls once against the item's DC, and
  takes their share off each work day while they stay, in downtime until they leave; one who brings the feat waits for
  the crafter to accept; one who leaves early loses what they gave (all as settings). A crafter's work days wait for the
  Craft check to be settled, so a reroll never leaves days counted at the wrong result.
- Earn Income jobs: a character takes a job at a task level the party's settlement offers for the skill, rolls after
  the first day, and each day worked pays once into their purse, with no GM needed. A resumed job can be rolled again
  after a level or rank change. Ending a job waits until its days so far are resolved, so they still pay. The GM keeps
  settlement profiles (the highest task level, with exceptions by skill); any member chooses where the party is.
- Retry after a critical failure asks where the missing up-front money comes from, as Finish does.
- Formulas and castings use fund accounting (M5 on M4.1): buying a formula or a casting, a spell's cost and a formula
  copy's cost are paid from the party fund or a character's purse, chosen in the same dialog as "Fund this order"; a
  casting bought from the party fund shows as spent by the order. Precious stock handed over lowers what "Fill the
  shortfall" asks for and is listed beside the money; requirements for scrolls, etchings and formula jobs have their own
  plain names and a button that meets them (add stock, offer or buy a casting, hand the item over); the Formulas tab has
  a "Browse" button for pf2e's Compendium Browser. A cancelled formula copy refunds its cost to where it came from.
  Before start, a formula job, an upgrade, a rune or a transfer asks for half of its own Price (what its requirements
  check), not half of the item's; a finished formula job says it went into the book, and an item changed in place says
  so, instead of "On its way".
- Daily preparations (milestone M7). A Morning tab shows a character's daily sources as pf2e has them: each daily
  crafting pool (Advanced Alchemy and its other sources with each one's own slots, Talisman Dabbler and Esoterica, the
  witch's cauldron, gadgets and the rest) with its slots, item level and what is prepared by level; other prepared
  slots such as snares; versatile vials; daily uses; and the daily features pf2e has no automation for (or that
  PF2e Dailies handles). "Make daily preparations" prepares through pf2e's own crafting methods: each pool keeps its
  preparation or takes a saved loadout, which stores item families and makes the best grade the pool allows that day
  (writing that grade into the book by family when needed); a talisman pool makes the talismans picked from its list
  without a formula book (two of one if wanted). Where pf2e's data for a daily source disagrees with the feat (Herbalist
  outside the wilderness, Lethargy Poisoner's doses and Stupor Poison, the alchemist archetype's Advanced Alchemy making
  consumables only), the tab shows both counts and prepares by the rules. Party members' standing orders ("two elixirs every morning") are made too and delivered, into
  the recipient's inventory when the player owns it, else on the pickup shelf; one that does not fit is left out for
  the day. Everything made is stamped with its maker's preparation cycle: at the maker's next daily preparations it stops
  working wherever it is, and Advanced Alchemy items also after 24 hours (marked inert, or deleted by a setting);
  Food Preservation's designated foods are kept, through a rest and in other hands, until newer ones push them past the
  cap. Talisman Dabbler's talismans use the higher of the maker's class and spell DC for their saving throws. Talismans and spellhearts can be affixed and taken off from the tab, one per item, two on the item a
  Talismanic Sage treats. Rest for the Night starts a new cycle and prompts each character's own player once, with or
  without PF2e Dailies; with it, a Workshop row in PF2e Dailies' window picks each pool's loadout, applied when it
  finishes. Morning and Expiry chat cards say what was made and what stopped working.
- Combat alchemy (milestone M8). A Bandolier window, docked above the hotbar and opening by itself when an encounter
  starts, shows an alchemist's versatile vials, what is ready to throw or drink with how long it stays potent and its
  splash numbers, and pf2e's own Strike buttons with their multiple attack penalties. Its Quick Alchemy panel lists what
  the character can make (by formula or family, up to its level), works from the keyboard, makes two items with Double
  Brew and takes an additive that fits (Healing Bomb on an elixir of life, Combine Elixirs with its second vial, the
  bomb additives with pf2e's own toggles); it refuses at 0 vials, which pf2e's own action does not. Quick vials are free
  and leave the vial count alone; Quick Bomber draws or makes a bomb and throws it. A Healing Bomb is thrown at a creature
  and each living creature next to it regains the elixir's dice in Hit Points, applied by its owner. What Quick Alchemy
  makes (the panel's and pf2e's own action's) stops working at the start of the alchemist's next turn (the end of it with
  Enduring Alchemy, the end of this turn for a quick vial), wherever it is, and when the encounter ends; its effects last
  10 minutes at most. Vials come back by gathering reagents, Improvise Admixture, the Alchemist's Haversack and, if a GM
  turns it on, as world time passes. The token HUD gets an alchemy palette. With PF2e Alchemist Remaster Duct Tape active
  all of this steps aside. "Use best consumable" uses the best item of a kind a character holds, the one at hand first.
- Affliction tracker (milestone M8a). Poisons, diseases and curses the party crafts or uses are tracked through their
  stages: the stages, onset, maximum duration and save are read at runtime from the installed compendium's description
  (no rules text ships; a reviewed list of overrides covers what does not read cleanly, and the registry check runs the
  reader over every pf2e item with stages). Exposing a creature (from an item's chat card, a coated Strike, a touched or
  eaten coated item, an inhaled cloud, or by hand) asks its owner for the initial save, rolled through pf2e with the
  poison itself, so incapacitation and the bonuses against poisons apply; a failure puts an effect on the creature that
  shows its stage in pf2e's effects panel and grants the stage's conditions as pf2e's own affliction would. Stage saves fall
  due as world time passes, at the right turn in an encounter, and over days logged with the Advance days wizard; a long
  time skip rolls them one after another and stops to ask. A Hero Point reroll replaces a save; a second message for the
  same save changes nothing. Saves of a player's creature wait for that player (a GM may roll for them); creatures no
  player owns are the GM's. Poisons are applied to weapons, ammunition (the coated arrow or bolt becomes the bow's
  ammunition), items and food, keep the DC they had (an alchemist's
  Powerful Alchemy travels with an infused poison handed to an ally), go with their poison's expiry, and are spent or kept
  by the Strike as the rules say, with Sticky Poison and Double Poison. An Afflictions window lists each creature's
  afflictions and pending saves with reduce, end, undo and repair. With PF2E Affliction Forge active, template-linked
  exposures are handed to it on the GM's client.
- Tattoos and the remaining crafts (milestone M9): tattoo and graft orders made on a subject, who agrees from the Queue and,
  under the Secrets of Magic process (the default) or for a graft, sits for the work in downtime, locked to it (Agree says so
  first, and asks for earlier downtime days to be resolved); one at a time per tattooist or implanter; a tattoo heals for 30
  days (or until healing is recorded) before the subject's own client invests it, and becomes a non-magical, decorative tattoo
  when the subject's invest limit is already used up, while a graft waits for room; the simple toggle;
  grafts rolled with Medicine and needing their formula; Legendary Tattoo Artist's +1 written on the tattoo; upgrades of a tattoo
  or graft the subject has. Staves, codas, spellhearts, specialty wands and other items read the castings they need from their
  own description, and each offered casting names the one it supplies. Fulus take their crafter's tradition and last a year;
  missives are made blank and composed one at a time; prepared snares get a quick-deploy ledger with giant and broad snares on
  the Morning tab; inventors have access to uncommon gadgets. Live-harness plans `m9-*`.
- Treasure Vault (Remastered) crafting variants (milestone M9a), each a world setting that is off by default and costs
  nothing while off, with a notice in Settings when variants of more than one group are on: Complex Crafting with Quick
  Setup (Table 5-1 setups, rushed setups frozen at the start, "Set up now" for Quick Setup's 2-hour batches of
  consumables, up to 8 hours a day, while any other setup of hours takes a downtime day, rushed finishing with its flat
  check, quirks and ruined or cursed items); items crafted with their adjustments, delivered together; crafting downtime
  events rolled once by worked days, optionally pausing the order, whispered to the crafter's side; Critical Crafting on
  special items, with secret (blind) rolls while a GM is connected, recorded results (a critical failure can still make the
  item, secretly cursed or failing in use, and a secret one reads as a success to the players) and the crafter's curse;
  Deconstruct, which turns an item into components for a similar item or raw materials and counts its day toward a
  follow-on order, and whose damage stays with the item; Grow with Nature or the hybrid skills, left untended across seasons
  with a season check each; Gardens of Wonder funded by the party up to their seed cost, with the money taken back on
  request, and harvested once a day; bestowed gifts that lie dormant in the wrong hands; crafting quests gathered by the
  party and delivered once every component is found. An order started under a variant finishes as it started if the
  variant is turned off. Live-harness plans `m9a-*`.
- Extension API (milestone M10) for other modules, such as adventure-path subsystems: a registration hook during setup
  for downtime activities, income sources, consumable sinks and check-modifier sources, checked and closed at ready, with a
  warning to the GM for an extension built for another API version. Each extension keeps its data in its own space in
  the shared ledger. Its downtime activities appear among a character's activities in the Downtime tab, the Advance days
  wizard and the day resolver, with their checks (and Aid) rolled through the system's statistics and their results
  written with the day, once. Extensions can post income and expenses to the party fund or a purse, pay income per event,
  per day or per week, take alchemical items through the Bandolier, and add modifiers to the Workshop's downtime checks.
  New hooks for status changes, ledger rows, crafted items, computed income and spent items.
- Integration surface (milestone M11). The character sheet has a Workshop button in its header and, at the top of the
  Crafting tab, a strip with the character's Workshop jobs, what waits on its roll, its pickup shelf, its downtime days and
  its daily preparations, with Workshop, Request and Morning buttons; it sits beside PF2e Toolbelt's sort buttons and PF2e
  Workbench's colours without touching them. The Party sheet's overview has a Workshop card, and the Actors directory's
  context menu has "Open Workshop". A macro shelf, opened from the Workshop's status bar, lists every Workshop macro: run one,
  drag it onto the hotbar, or add it to the first free slot from the keyboard; a macro without what it needs asks for it.
  Copy-paste macros live in `macros/`. A keybinding opens the Workshop. A "Parchment look" setting gives the windows the pf2e
  sheet's parchment in either colour scheme, and the Workshop opens at the size it was last given. The order rows have a
  right-click menu, the order detail keeps keyboard focus inside it while it covers the list, and the light theme's focus
  ring and chat cards keep their contrast. A window opened from the keyboard (the keybinding, the sheet's and the card's
  buttons, the Macros button) puts focus in it, and focus stays where it was when the shelf, the strip or the card update.
- Release engineering (milestone M12), built but not yet run: a release workflow for published GitHub releases (pre-releases
  with their own manifest URL and the strings and registry checks in report mode; stable releases with both enforced,
  uploaded with the stamped `module.json` and `module.zip`, and registered with foundryvtt.com as a dry run until switched
  on), a local dry run that builds the same package into a scratch folder (`npm run release:dry-run`), a daily pf2e churn
  watch that reports new pf2e releases, changes to the pf2e code the module relies on and the registry validation against
  them, issue forms, a "For GMs" section in the README, `CONTRIBUTING.md`, and a `NOTICE` file for the Community Use
  Policy, ORC and OGL notices (their licensors' text still to be pasted in by the author).
- Performance pass (milestone M12, `npm run harness:perf`): stages a long campaign in the dev world (five members, 200 orders,
  2000 ledger rows, 60 workshop days) and times and profiles the Workshop window, ledger writes, reconciliation and the
  Advance days wizard.
- Rules registry completeness (M12): every pf2e 8.6.1 compendium item that mentions crafting, formulas, daily preparations
  or Earn Income is now reviewed, 103 into the rules registry and 657 onto its ignore list with a reason, so the stable
  release's registry check passes. Newly automated: Brigh's moderate boon (Crafting checks to invent a formula are one degree
  better), Shelyn's moderate boon (Specialty Crafting's bonus on every Craft), the Pathfinder Society Crafter's Workshop boon
  (1 day of setup), the Traveling Workshop spell (an alchemist's lab, Repair tools and a day of setup already done), access
  to uncommon tengu weapons for Tengu Weapon Familiarity and to sparklers for Firework Technicians, and Morning tab notes for
  Create Familiar Fulu, Apothecary's Garden, Underground Bounty and Zon-Kuthon's moderate boon. The rest show as notes.

### Changed

- "Pledge" and "Deposit" are now "Fund this order" (from a purse) and "Add to party fund"; "Take it" is "Collect". The
  amount dialog no longer accepts a single number read as copper.
- A casting for a scroll or wand is "offered" rather than "pledged", and an item handed over for an order is given
  back with "Give the item back".
- The Queue lists 30 orders at a time, open orders first, with "Show 30 more" under the list for the next ones; a new filter
  starts again from the top. With hundreds of orders behind a campaign the Workshop no longer slows down redrawing all of them.

### Fixed

- Counts of one read as one ("1 day", "1 casting", "1 order filed", "in 1 round" and the others); the request form hides its
  DC column from players who may not see DCs; a finished order's check card no longer offers "0 more days"; "Acting as" stays
  on one line; the formula routes table keeps its Route column readable; the order detail's labels lose a stray text shadow in
  the light theme; unmet requirements say so to screen readers.
- Keys pressed on the Workshop's order rows and tabs, in the Quick Alchemy panel's list, and Tab, Space and Enter anywhere in
  the module's windows no longer also reach Foundry's own shortcuts: Space no longer pauses the game for a GM, the arrows no
  longer pan the canvas and Tab no longer cycles the selected token.
- Switching the Workshop off or on updates open character and party sheets at once; the Parchment look applies to every
  Workshop window, not only the main one and the macro shelf; the Downtime tab's activity choice is named by its visible label;
  "Roll Craft check" and "Finish order" with nothing to do say so instead of "That order no longer exists"; the macro shelf
  says "Fund an order" and "Collect waiting items", as the Workshop does.
- Faster with a long campaign behind it (M12 performance pass): Advance days pays each Earn Income job's wages for the whole
  span at once, so a week for five characters with three jobs takes 1.6 s instead of 12 s two months into a campaign (and
  60 days 1.5 s instead of a minute); the Workshop
  redraws only the tab you are looking at when something changes, reads the ledger once for the whole Queue, and formats
  amounts and dates without rebuilding a formatter each time. With 200 orders a change now costs each open window about a
  third of what it did.
- The "Advance days" macro answers once its wizard is open, so a script that waits on it gets the window, and two quick runs
  no longer open two wizards; the macro shelf's call lines wrap inside their tiles instead of running under the buttons.
- Live harness (M11): the plans no longer pass on nothing (every rendered core window counted as one a macro opened; a missing
  Overview, Workbench's colours, the shelf's contrast and the scheme went unchecked); the keyboard walkthrough runs as the GM
  too and checks that no key reaches Foundry's pause, view or token selection, with a canvas against a scene with tokens; the
  context-menu plan needs a canvas (pf2e's directory menu fails without one); the driver no longer adds the module's
  stylesheet a second time (Foundry 14 imports module styles in a `<style>` element).

- Talismanic Sage was never recognised when affixing (its feat was missing from the rules registry), so a sage could not
  put a second talisman on an item.
- Typing in a field of the Workshop and clicking a button straight away (a talisman count, then "Make daily
  preparations") no longer loses the click: the field's change no longer redraws the tab under the button being pressed;
  it redraws once the button is released.
- A bomb already thrown no longer stays in the Bandolier's and the token HUD palette's ready list with Strike buttons (pf2e
  keeps a thrown bomb on the sheet at quantity 0), and the Bandolier stops at the bottom of the screen and scrolls, so its
  vial buttons stay in reach when much is ready.
- At a table without a canvas, what Quick Alchemy made in an encounter now stops working when the encounter ends (pf2e's
  encounter deletion fails on such a client before the end of the encounter is announced).
- A finished tattoo's or graft's subject no longer reads in the Queue as still sitting for it.
- Live harness (M9): the plans that craft roll their Craft check at a fixed die and check that the order completed, so a
  failed check no longer passes them with every check after the finish skipped; the staff, gadget and missive plans check
  a refusal or the second half too; healing is recorded on the tattoo and not on the first item found, and snares an
  earlier run deployed are prepared ready again.
- A crafting quest's item now reaches its recipient: the assembly took the lock its own pickup-shelf delivery needed, so the
  item stayed on the shelf for good.
- "Work a day" that settles a Deconstruct, or a Craft check that failed, no longer warns that the order is complete (or
  failed) and "cannot be done now" after doing what it should.
- A rushed finish whose flat check needed no roll reads "no flat check needed", not "flat check DC -5: -".
- A rushed finish that ruined the item no longer reads "On its way to ...'s inventory." for good: the Queue says nothing was
  made.
- The request form no longer offers coin stacks to deconstruct.
- The Funds tab shows a ledger row's note beside its kind, so a row another module posted (an expense, an income) says what
  it was for, rather than "Expense 50 gp" with nothing to tell which purchase a member is about to reverse.
- Live harness (M9a): the plans that craft, deconstruct or grow roll at a fixed die (or the face that lands the degree they
  check) and check the order got there, and the rushed finish's flat check rolls a natural 1 so the ruined path is checked;
  the Complex Crafting and Quick Setup plans put an alchemist's lab in the strongbox, the adjustment plan lets the crafter's
  owner accept the order, and the secret-roll plan checks the card's content is hidden from the players. A new plan, `m9a-off`, runs the M4 lifecycle with every variant off under a write audit and checks that
  no variant data is written and nothing of a variant shows in any tab, the request form or the chat log.

- Storage and sync, from the first live runs: a client stops writing the moment a shared document it uses is
  deleted, or its user loses OWNER on one, even when no update hook reaches it (players without a canvas); ages
  and timeouts read stamps on the server's own clock across relaunches of the world, so a migration lock or a
  pending row from an earlier, longer launch is no longer taken to be recent; a move waits for a late answer from
  a busy server instead of giving up after 30 s with its lock taken and nothing moved, and gives up at once when
  the connection drops; a duplicate claim or coin move that sees the first one's lock says "already" rather than
  "strongbox-short", and leaves the first one's resolution of the claim alone.
- Live harness: the scenario steps that failed on their own (the purse check across two devices, the claim
  step's row count, a GM's refunds, refunds written in one go, a race started before its claim arrived); the
  cleric fixture's Domain Initiate, granted two grants deep, no longer opens pf2e's choice prompt. In a dev
  world, a Craft check rolled from the Workshop with pf2e's own dialog no longer throws at Application V1's
  deprecation warning (pf2e's check dialog is still V1).
- A coin move whose lock request landed but whose apply request never did (a tab closed, or the connection
  dropped, between the two) is resumed by the catch-up sweep once it is past the grace time and its coins are as
  it planned them; an apply mark makes its apply request land once, whoever sends it. Before, its row stayed
  pending and its claim resolved with nothing paid. A stopped move's note no longer sets its row back to pending
  (which could undo a resume), except when the request went out without an operation.
- A pledge, deposit, withdrawal or wage with no positive amount is refused as "nothing" again, not thrown.
- A client that has to reload says why: a refused change, a dropped connection or a missing answer.
- The lint rule against the game socket catches destructuring and computed access with a name it can read again,
  and counts `on`/`off` of "disconnect" as watching the connection only with one arrow-function listener and as a
  statement of its own: they return the socket, so `game.socket.on("disconnect", f).emit("x")` reached it; socket.io
  calls a listener with `this` bound to the socket, so `function () { this.emit("x"); }` did too; and
  `off("disconnect")` with no listener removed core's listeners as well. A computed name it cannot read, or a copy of
  `game` under another name, it still cannot follow.
- A close of a pending row by hand and a GM's adjust act only on rows that need a hand, and no longer race a resume.
  Reconciliation puts every pending row in one of three states: in flight (younger than the grace time, or a request
  may be applying it now), resumable (the module finishes it by itself: a coin move a connected user's client may
  resume, a lost delivery one re-creates), or needing a hand. A close of an in-flight or resumable row is refused, and
  an adjust leaves their coins out of the difference and books only the rest, so the move still lands and credits the
  person who paid. Before, a close or an adjust took its mark and the move never landed, while its row still counted,
  crediting a pledge nobody paid out of the fund. For a row that needs a hand, the close or the adjust takes the mark a
  late apply request would take (for a lost delivery, the lock its re-creation takes) in the same request, so only one
  of them lands. A close closes every row of that move.
- A move nobody connected can resume (its author connected but no longer owning the purse), and a delivery whose
  re-creation failed, need a hand, so their author is told. A user is told only about their own rows that need a
  hand: the device that lost a resume race no longer says a move that just applied did not finish; and a resume that
  stops part-way or is refused at its dry run is reported to its author once its in-flight window ends, without
  waiting for some other event to run the sweep.
- The fixture actors' marks live in `flags.world`, outside the module's flags, so a purge no longer strips them.
