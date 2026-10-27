# Artisan's Workshop (PF2e)

A Foundry VTT module for the Pathfinder Second Edition system: one place to run an
alchemist or crafter, and the party that leans on them.

**Status: early development.** Nothing installable yet: the repository has the M0
scaffold (manifest, tooling, CI), the M1 rules core (pure crafting and Earn Income
rules with tests), the M2 storage and sync layer (the shared ledger and strongbox,
safe coin moves, claims, roster snapshots, purge) and the M3 rules registry and roll
wrapper (Craft and Earn Income checks rolled with the item's options and recorded once,
rerolls included), and the M4 Workshop window: the Queue and Funds tabs, the order lifecycle
from request to delivery, escrow and refunds, chat cards and the request form. Open it from
the "Workshop" button in the Actors directory or on the Party sheet, or with
`game.modules.get("pf2e-artisans-workshop").api.ui.open()`. The
specification is `DESIGN.md`; decisions land in `DECISIONS.md`.

## What it is for

- **A party crafting queue.** Party members request items; the crafter sees what
  is wanted, which formulas they have (and how they could get the missing ones),
  the materials and days each item needs, and how far along each one is. Everyone
  sees the queue and a progress bar per item.
- **Shared funding.** Party members put gold toward an item's materials, and the
  ledger remembers who paid for what.
- **Daily preparations.** Advanced Alchemy, talismans and other daily items, built
  to work alongside the PF2e system and pf2e-dailies rather than against them.
- **Rules coverage.** Feats, class features and gear that change crafting cost,
  time, batches or formulas are read from the character, not entered by hand.
- **Downtime.** Earn Income with Crafting, Cooking Lore or any other skill, paid
  straight to the earner; GMs set settlement task levels. Nothing waits on GM
  approval, and it works with no GM online.

Alchemy is the first crafting journey, not the only one: magic items and runes,
talismans, tattoos and snares are in scope.

## Screenshots

A demo party in a test world, taken by `npm run screenshots` (see Development). The wording in the window is draft
until 1.0: every string is rewritten before the first release, and these captures are taken again then.

![The Queue](docs/screenshots/queue.png)\
*The Queue: every order with its state and progress, and the detail of one in its last days of work.*

![The request form](docs/screenshots/request-form.png)\
*The request form: who in the party can make the item, how, and what it needs up front.*

![Funds](docs/screenshots/funds.png)\
*Funds: the strongbox as the party fund, unallocated and earmarked per order, with each member's share.*

![Formulas](docs/screenshots/formulas.png)\
*Formulas: a character's book by family, where each formula came from, and the ways to learn another.*

![Downtime](docs/screenshots/downtime.png)\
*Downtime: the workshop day, a character's days and what they go to, the party's settlement, and an Earn Income job with its pay.*

![Morning](docs/screenshots/morning.png)\
*Morning: a character's daily crafting by pool, a loadout's plan with an ally's standing order, and the talismans it can make today.*

![The Bandolier](docs/screenshots/bandolier.png)\
*The Bandolier in an encounter: the vials, Quick Alchemy and quick vials, and what is ready, with how long it stays potent and pf2e's Strike buttons.*

![Quick Alchemy](docs/screenshots/quick-alchemy.png)\
*Quick Alchemy: what the alchemist can make now, by formula or family, picked from the keyboard, with what it costs in vials.*

![The Afflictions window](docs/screenshots/afflictions.png)\
*The Afflictions window: a poison running on the alchemist with its stages, the next save and the maximum duration, and a save still to roll.*

![The Queue in the light theme](docs/screenshots/queue-light.png)\
*The Queue in the light theme, with a finished order's cost summary.*

![A tattoo in the Queue](docs/screenshots/tattoo.png)\
*A tattoo in the Queue: made on its subject, who agrees from here and sits for it in downtime before the work can start.*

![The macro shelf](docs/screenshots/macro-shelf.png)\
*The macro shelf: every Workshop macro with what it calls, to run, drag onto the hotbar or add to it from the keyboard.*

![The Crafting tab's Workshop strip](docs/screenshots/sheet-strip.png)\
*The character sheet's Crafting tab with the Workshop's strip at its top: the character's jobs and what waits on them.*

## For GMs

<!-- Draft written with the code (DESIGN.md 16.8); the author rewrites it before 1.0, like every string (16.4). The
settings tables list every setting a user can change; test/foundry/readme-settings.test.mjs holds them to the code. -->

### What it changes in your world

- **Nothing until you switch it on.** Installing and enabling the module writes nothing. A GM turns on **Enable the
  Artisan's Workshop** (Configure Settings, PF2e Artisan's Workshop); no reload is needed.
- **Two shared documents.** Switching it on creates the Workshop ledger (a journal entry in its own folder: orders,
  money rows, downtime records, and a snapshot of each member's formulas, crafting feats and ranks, which every player
  can read) and the strongbox (a loot actor that holds the coins put toward orders and the items waiting to be
  collected). Every player owns both, so the party can work with no GM online. Only a GM can delete them.
- **Characters and items.** It moves coins between purses and the strongbox, adds what is crafted, bought or delivered
  to the right character, adds formulas to formula books through the PF2e system, and marks items made at daily
  preparations as inert (a name suffix) when they expire, or deletes them if you choose so. It keeps its own records in
  `flags.pf2e-artisans-workshop` on characters, their items, users and chat messages.
- **Rolls and chat.** Craft and Earn Income checks are the system's own rolls through the Crafting statistic, posted
  with the Workshop's chat cards. It never replaces the system's Craft button or Craft macro.
- **The interface.** The Workshop window; a Workshop button on the Actors directory, character sheets and the Party
  sheet; a strip at the top of the Crafting tab and a card on the Party sheet's overview; "Open Workshop" in the Actors
  directory's context menu; the Bandolier, the Quick Alchemy panel and a palette in the token HUD for alchemists in an
  encounter; the Afflictions window; three keybindings (all unbound until you bind them in Configure Controls); and a
  macro shelf whose macros reach your hotbar only when you drag them there.
- **On its own.** When world time passes, a rest is taken or a turn ends, the work happens on one client only (the
  character's owner if they are connected, else a GM, else another connected player), so nobody gets a prompt twice.
  Vial gathering, which writes to characters as world time passes, is off until you turn it on.
- **Other modules.** It works beside pf2e-dailies (it adds its own daily there), PF2e Toolbelt, PF2e Workbench and Item
  Piles, and does not repeat what they do. While PF2e Alchemist Remaster Duct Tape is active, the Workshop's combat tools
  step aside. It ships no compendium packs and no images.

### Settings

All in Configure Settings under PF2e Artisan's Workshop. World settings (W) are the GM's and apply to everyone; user
settings (U) follow each user; client settings (C) stay in one browser. The keybindings are in Configure Controls.

**Switch and features** (W)

| Setting | Key | Default | What it does |
|---|---|---|---|
| Enable the Artisan's Workshop | `enabled` | off | Turns the Workshop on for this world and creates the ledger and strongbox. Off stops everything at once. |
| Workshop members | `members` | the active party | Which characters are members: the active party, or every player character. |
| Workshop chat cards | `chat.visibility` | the people involved and GMs | Who sees the Workshop's chat cards: those involved and GMs, or everyone. |
| Sheet buttons and strips | `features.sheetEntryPoints` | on | The Workshop button on character and Party sheets, the Crafting tab's strip and the Party sheet's card. |
| Formulas | `features.formulas` | on | The Formulas tab, formula jobs and services. |
| Downtime | `features.downtime` | on | The Downtime tab: who is in downtime and what their days go to, the Advance days wizard, Communal Crafting helpers. |
| Earn Income jobs | `features.income` | on | Earn Income jobs in the Downtime tab, each day worked paid into the character's purse. |
| Daily preparations | `features.morning` | on | The Morning tab: daily crafting, loadouts, standing orders and talismans. |
| Expiry across the party | `features.expiry` | on | Items made at daily preparations stop working at their maker's next preparations, wherever they are. |
| Expired items | `expiry.action` | mark it inert | Whether an expired item is marked inert or deleted. |
| Combat alchemy | `features.combat` | on | The Bandolier, the Quick Alchemy panel, the token HUD palette, quick vials, Healing Bomb, potency that ends with the turn. Steps aside while Duct Tape is active. |
| Quick Alchemy items end with the encounter | `expiry.quickAlchemyAtCombatEnd` | on | Off: what Quick Alchemy made lasts one more round of world time after the encounter. |
| Use best consumable | `features.consumables` | on | Use the best item of a kind a character holds. |
| Gather vials as time passes | `features.vialGathering` | off | Alchemists regain versatile vials as world time passes outside encounters and downtime. Writes to characters on its own. |
| Tattoos and grafts | `features.tattoos` | on | Tattoo and graft orders with a subject who agrees and sits for the work. Off: they are crafted like any other item. |
| Affliction tracker | `features.afflictions` | on | Stages, saves and timing for poisons and other afflictions the party crafts or uses. |

**Rules choices** (W). Where the books leave a choice to the GM, or say nothing; the defaults are the module's reading.

| Setting | Key | Default | What it does |
|---|---|---|---|
| Legendary item level | `rules.legendaryItemLevel` | 17 | Item level from which crafting needs legendary proficiency (17 or 16). |
| Uncommon items need the formula | `rules.uncommonNeedsFormula` | off | Uncommon and rarer items need their formula, not only access. |
| Easier DC for repeat items | `rules.easyDcForRepeat` | off | A lower DC for an item the crafter has made before. |
| Keep interrupted setup days | `rules.setupInterruptionPersists` | on | Setup days already worked are kept when an order is paused. |
| Level-up raises the daily rate | `rules.recomputeRateOnLevelUp` | on | A crafter who levels up mid-order earns the new daily rate. |
| Crafter swap restarts | `rules.crafterSwapRestarts` | on | Handing an order to another crafter starts its setup and check again. |
| Formulas cover lower grades | `rules.familyCoversLowerGrades` | on | A formula for one grade of an item also covers its lower grades. |
| Ally formula copy cost (cp) | `rules.allyCopyCostCp` | 0 | What copying a formula from another party member costs. |
| Uncommon formula surcharge (%) | `rules.formulaSurchargeUncommon` | 0 | Added to the price of uncommon formulas. |
| Rare formula surcharge (%) | `rules.formulaSurchargeRare` | 0 | Added to the price of rare formulas. |
| Invent uncommon and rare formulas | `rules.inventorRarity` | off | Whether Inventor can invent formulas for uncommon and rare items. |
| Inventor setup days | `rules.inventorSetupDays` | 2 | Setup days for inventing a formula. |
| Coins for common precious materials | `rules.preciousCoinForCommon` | on | Coins can stand in for the precious-material share of common items. |
| Snare batch size | `rules.snareDowntimeBatch` | 4 | Snares made per downtime batch. |
| Magical snares | `rules.magicalSnaresNeedMagicalCrafting` | on | Magical snares need Magical Crafting. |
| Snare toolkit | `rules.snareToolkitIsArtisans` | on | Snares are crafted with an artisan's toolkit. |
| Tattoo process | `rules.tattooProcess` | full process | The full tattoo process (subject, healing, investiture), or a plain Craft. |
| Tattoo subject stays for the work | `rules.tattooSubjectLocked` | on | The person being tattooed spends their downtime sitting for it until it is done. |
| Tattoo healing days | `rules.tattooHealingDays` | 30 | Days a new tattoo heals before it works, unless healing is recorded sooner. |
| No talismans on bombs | `rules.talismanHostsExcludeBombs` | on | Bombs cannot hold talismans. |
| Earn Income: other skills DC | `rules.earnIncomeOtherSkillDc` | 5 | Extra DC for Earn Income with a skill other than Crafting, Performance or Lore. |
| Rerolls on downtime checks | `rules.downtimeRerolls` | warn | What happens when a downtime check uses a reroll: a warning, or it is blocked. |
| Cost of living | `rules.costOfLiving` | off | Deduct cost of living from downtime income. (Not applied yet.) |
| Helper critical success | `rules.communal.helperCritUsesNextRow` | on | A Communal Crafting helper's critical success counts one level higher. |
| Helper failure | `rules.communal.helperFailUsesFailColumn` | on | A helper's failure still contributes a little. |
| Leaving helpers forfeit | `rules.communal.helperLeaveRetroactive` | on | A helper who leaves before the order ends loses what they contributed. |
| Helper limit | `rules.communal.helperCap` | 0 | Most helpers per order; 0 means no limit. |
| Helpers without the feat | `rules.communal.countHelpersWithoutFeat` | off | Helpers count even when the crafter lacks Communal Crafting. |

**Treasure Vault (Remastered) variant rules** (W). All off until you turn them on; each one's own settings matter only
while it is on. Turning on variants from more than one of the book's groups gets a reminder that the book suggests one
group at a time.

| Setting | Key | Default | What it does |
|---|---|---|---|
| Variant: Complex Crafting | `variants.complexCrafting` | off | Longer setup for items near the crafter's level and for permanent items; rushing setup or finishing. |
| Complex Crafting: a rushed finish that goes badly | `variants.complex.rushCritFail` | the item is ruined | Ruined or cursed. |
| Variant: crafting items with adjustments | `variants.adjustments` | off | An item and its adjustments as one order: one check, one price. |
| Variant: crafting downtime events | `variants.events` | off | A long stretch of crafting rolls an event. |
| Crafting events: first event on day | `variants.events.firstDay` | 7 | The downtime day of an attempt on which its first event is rolled. |
| Crafting events: one more every | `variants.events.everyDays` | 91 | Downtime days between events. |
| Crafting events: roll table | `variants.events.table` | (none) | The UUID of a world roll table you built for the events; empty rolls a d20 for you to read in the book. |
| Crafting events: pause the order | `variants.events.pauses` | off | An open event stops the order's work days until someone resolves it. |
| Variant: Critical Crafting | `variants.criticalCrafting` | off | A critical success or failure can also have a story effect, recorded on the order. |
| Critical Crafting: which criticals | `variants.critical.trigger` | natural 20s and 1s only | Or every critical. |
| Critical Crafting: special items only | `variants.critical.specialOnly` | on | Only orders marked as special before they start. |
| Critical Crafting: the money effect | `variants.critical.mode` | on top of it | Whether the story effect comes on top of the usual money effect or replaces it. |
| Critical Crafting: secret checks | `variants.critical.secret` | off | With a GM connected, these Craft checks are rolled blind until they settle. |
| Variant: Deconstruct | `variants.deconstruct` | off | Break a permanent item down into components toward another item. |
| Deconstruct: components last | `variants.deconstruct.expiryDays` | 0 | Days components keep; 0 means forever. |
| Variant: Grow | `variants.grow` | off | Grow items from living things over four days, and untended between seasons. |
| Nature crafting: skills | `variants.natureCrafting.skills` | Crafting for everything | Nature for Grow, and optionally Arcana for every other Craft. |
| Nature crafting: days in a season | `variants.natureCrafting.seasonDays` | 91 | Used when the world's calendar has no seasons. |
| Variant: gardens of wonder | `variants.gardens` | off | Gardens that give one perishable consumable a day. |
| Variant: bestowed gifts | `variants.gifts` | off | Items recorded as gifts bound to their recipient. |
| Variant: crafting quests | `variants.quests` | off | Earn an item by finding its components through encounters. |
| Crafting quests: assembly that goes badly | `variants.quests.critFail` | the item is destroyed | Destroyed or cursed. |

**Afflictions** (W)

| Setting | Key | Default | What it does |
|---|---|---|---|
| Player characters' affliction saves | `afflictions.pcSaves` | a card to roll | The player rolls each save from a card, or it is rolled for them at once. |
| Other creatures' affliction saves | `afflictions.npcSaves` | rolled at once | Saves of creatures no player owns: rolled on the GM's client at once, or the GM gets a card. |
| GM rolls for players who are away | `afflictions.gmRollsForOfflinePCs` | off | Off: a save waits for its player. On: the GM's client rolls it. |
| Apply affliction damage automatically | `afflictions.autoApplyDamage` | off | Off: stage damage is posted with the system's apply buttons. |
| After a long time skip | `afflictions.catchUp` | roll each one | Roll every save that fell due, or stop at the first. |
| Saves rolled in a row before asking | `afflictions.catchUpLimit` | 20 | After this many saves in one catch-up, the tracker asks before going on. |
| In combat, saves fall due at | `afflictions.combatAnchor` | the turn the stage began on | Or the end of the affected creature's turn. |
| Hand afflictions to Affliction Forge | `afflictions.handOffToForge` | on | While PF2E Affliction Forge is active, exposures with a linked Forge template go to it. |
| Affliction Forge without a GM | `afflictions.forgeWithoutGm` | the Workshop tracks it | With no GM connected, the Workshop tracks the exposure itself, or it waits for a GM. |

**Each user and each browser**

| Setting | Key | Scope | Default | What it does |
|---|---|---|---|---|
| Workshop notifications | `notify.level` | U | orders that involve my characters | Which order changes you are told about: every order, yours, or none. |
| Affliction notices | `afflictions.notify` | U | yours | Save prompts and stage notices for every creature, yours, or none. |
| Collect automatically | `claims.auto` | U | on | Collect deliveries and payments for your characters automatically; off, you are told something is waiting. |
| Open the Bandolier when an encounter starts | `bandolier.autoOpen` | U | on | For an alchemist you play in the encounter. |
| Parchment look | `ui.parchment` | C | off | The pf2e character sheet's parchment for the Workshop's windows, in either colour scheme. |

**Keybindings** (Configure Controls, all unbound): Open the Workshop, Open the Bandolier, Quick Alchemy.

### Turning it off

- **For the whole world:** turn off **Enable the Artisan's Workshop**. Everything stops at once, with no reload, and
  nothing is lost: turn it on again and the Workshop picks up where it was (days that passed meanwhile wait to be
  resolved or marked "not downtime").
- **One part:** turn off its feature in the first table above (the Formulas tab, downtime, daily preparations, combat
  alchemy and so on). The variant rules are off unless you turned them on.
- **Disabling the module** in Manage Modules leaves your world as it was: the module's records stay on documents and do
  nothing, the ledger is an ordinary journal entry, and the strongbox an ordinary loot actor with real coins and items
  you can hand out. Crafted items, delivered tattoos and learned formulas are ordinary PF2e data and keep working.
  Expired items keep their "(inert)" suffix.

### Removing its data

**Purge all Workshop data** (Configure Settings, PF2e Artisan's Workshop, Purge data; GMs only) removes what the module
stored, after you type the world's title to confirm:

1. It shows what each member still has in the strongbox, and offers to give it back first: as refunds each player
   collects, or by moving everything into the Party actor's stash. With refunds, run the purge again once they are
   collected.
2. It switches the Workshop off, then removes the module's records from characters and their items, world items, users,
   journal entries and folders, and from chat messages if you tick that.
3. It deletes the ledger, deletes the strongbox if it is empty (otherwise it stays as an ordinary loot actor), and puts
   the world settings back to their defaults.

It leaves crafted items, formula books and all PF2e data alone. What it does not reach, to clean by hand if you want:
the "(inert)" suffix on expired items, affliction effects still on creatures, macros you dragged from the shelf to a
hotbar, records on unlinked tokens' own copies of actors, and each user's own settings. Then disable and uninstall the
module in Manage Modules.

## Compatibility

Targets the latest Foundry VTT release and the latest PF2e system release, Remaster
rules first.

## Development

No build step and no runtime dependencies: `npm` installs only ESLint and, for the live
harness, `playwright-core` (which downloads no browser). Use Node 24.13.1 or a later 24.x
(`DESIGN.md` 3.2); `npm ci` refuses any other.

```sh
npm ci
npm run lint             # ESLint (DESIGN.md 15.1), then tools/check-source.mjs
npm test                 # node --test over test/
npm run check:manifest   # module.json against the manifest policy (DESIGN.md 3.1, 16.3)
npm run check:assets     # no images, audio, video or fonts but the README screenshots (DESIGN.md 16.5)
npm run check:strings    # strings still waiting for the author's sign-off (DESIGN.md 16.4)
npm run check:strings:enforce   # the same, failing if any is left (stable releases)
npm run signoff -- --keys <key> [<key> ...]   # sign off strings the author has rewritten
npm run harness:live     # the sync scenarios in a running dev world (below)
npm run screenshots      # the README screenshots, from a running dev world (below)
npm run harness:perf     # the performance pass, in a running dev world (below)
npm run validate:registry -- --pf2e <checkout>   # the rules registry against a pf2e checkout
npm run macros           # write macros/ from the macro catalogue (DESIGN.md 11.1)
```

Every user-facing string lives in `lang/en.json` under `pf2e-artisans-workshop.` keys.
Write each key out in full in code and templates (`"pf2e-artisans-workshop.Queue.Title"`,
not built from `MODULE_ID`) and capitalise its first segment: that is how `npm run lint`
finds keys and checks they exist, and how it tells them from hook and query names, which
are lower case. CI (`.github/workflows/ci.yml`) runs all of the above, with the strings
gate in report mode.

Releases (`DESIGN.md` 16.9): publishing a GitHub release runs `.github/workflows/release.yml`. Tag it with the bare
version (`0.12.0`, no "v"). A pre-release runs the checks above with the strings gate and the registry completeness
check in report mode and gets its own manifest URL, for a test table to install by URL; a stable release runs them in
enforce mode, refuses to package while a notice still has a placeholder, gets the `releases/latest` manifest URL and,
when the repository has the `FOUNDRY_RELEASE_TOKEN` secret, is registered with foundryvtt.com (a dry run until the
repository variable `FOUNDRY_RELEASE_LIVE` is `true`). The package can be built locally the same way, into a scratch
folder, without publishing anything:

```sh
npm run release:dry-run -- --version 0.12.0 --prerelease   # stamped module.json and module.zip in a new temp folder
npm run release:dry-run -- --version 1.0.0                 # the same as a stable release (fails on notice placeholders)
```

It prints the folder, the manifest and download URLs, what the zip holds and its SHA-256 (the zip is byte-for-byte the
same for the same files). The zip holds `module.json` (stamped), `LICENSE`, `NOTICE`, `README.md`, `CHANGELOG.md`,
`scripts/`, `templates/`, `styles/` and `lang/` (without `lang/review/`), never `docs/`, `tools/`, `test/`, `macros/` or
`node_modules/`.

The pf2e churn watch (`.github/workflows/pf2e-watch.yml`, `DESIGN.md` 3.3) runs every morning: it lists the pf2e
releases since the one CI pins and the commits on pf2e's dev branch that touch the paths the module relies on, validates
the registry against the pinned release, the newest release and the dev head, and opens or updates the "pf2e churn
watch" issue when anything is new. To see its report locally (the validations show as not run):

```sh
GH_TOKEN=$(gh auth token) node tools/pf2e-watch.mjs collect --out /tmp/watch
node tools/pf2e-watch.mjs report --dir /tmp/watch   # writes /tmp/watch/report.md
```

Layout: `scripts/` is the shipped code (`module.mjs` is the entry); `lang/` holds the
strings and `lang/review/` their sign-off hashes; `tools/` holds the dev scripts and
`tools/harness/` the fixture actors, the sync scenarios and their live driver, neither
shipped; `test/` the tests. `scripts/logic/` is the rules engine (pure functions with no
Foundry or browser globals, so `node --test` imports it directly; tests in `test/logic/`)
and `scripts/data/` its numeric tables, each cited by book and page. `scripts/foundry/`
is the code that talks to Foundry (storage and sync so far), tested in `test/foundry/`
against the small fake of Foundry in `test/foundry/stubs.mjs`. `scripts/ui/` is the
Workshop window, its chat cards and entry points (M4), with its Handlebars templates in `templates/` (no literal text:
every word is a key) and its stylesheet in `styles/`; `scripts/logic/views.mjs` holds the window's view models as pure
functions. `macros/` holds the copy-paste macros (DESIGN.md 11.1), one file per entry of the catalogue in
`scripts/logic/macros.mjs`, each the same line a hotbar macro made from the Workshop's macro shelf holds; `npm run macros`
writes them and `npm test` fails while a file and the catalogue disagree.
The extension API (`DESIGN.md` 12) is `scripts/foundry/extensions.mjs` with its pure parts in `scripts/logic/extensions.mjs`;
`test/foundry/ext-fixture.mjs` is a small extension module, registered the way a real one is, that the tests run the
Workshop against. An extension module of your own can use the Workshop checkout as a development dependency by path
(`"pf2e-artisans-workshop": "file:../pf2e-artisans-workshop"`) and run its tests over `test/foundry/stubs.mjs`.

Local Foundry harness: symlink the checkout into `Data/modules/`, enable the module in a
test world, and as GM run `await game.settings.set("pf2e-artisans-workshop", "dev", true)`
in the console, then reload. In a dev world any deprecation warning whose stack passes
through this module's files throws, even one raised inside pf2e, core or another module
that this module called (except Application V1's own warning, which pf2e's V1 check dialog
raises; `DESIGN.md` 15.1), and `game.modules.get("pf2e-artisans-workshop").dev.fixtures.create()`
builds the fixture actors of `DESIGN.md` 15.4 (`{ reset: true }` rebuilds them), marked in
`flags.world` so the module's purge leaves the marks alone. The sync
scenarios of `DESIGN.md` 15.3 load on every client of a dev world:
`game.modules.get("pf2e-artisans-workshop").dev.scenarios.list()` shows each step, and
`.run("3c", "pledge", { order: "test", cp: 120 })` runs one on that client. To check
the fixtures' compendium UUIDs and choice-set answers against a pf2e source checkout, run
`PF2E_SRC=<checkout> npm test`; the same run checks the rules registry (`scripts/data/registry.mjs`): every
entry's UUID, slug, type, remaster flag and the rule elements it relies on, and reports compendium items that mention
crafting, formulas, daily preparations or Earn Income but are in neither the registry nor its ignore list
(`npm run validate:registry`, `--enforce` to fail on them). CI runs both against the pinned pf2e release.

`npm run harness:live` runs those scenarios with every user at once
(`tools/harness/run-live.mjs`, plans in `tools/harness/live-plans.mjs`). It needs the dev
world running with the fixture actors built and users without passwords (Gamemaster,
Player One, Player Two; it creates an "Assistant GM" user), and a Chromium on the
machine; it then drives one headless browser context per user and device (a second tab
shares its device's context). Through the Foundry API it assigns Player One fixture 3 and
Player Two fixture 6 as owners and party members, and before every plan it deletes and
re-creates the shared documents and refills both purses, so use a world kept for testing.
Each scenario runs `--runs` times (default 2), then the behaviour checks (`--behaviours
all|none|<ids>`; `migration-lock` waits out the five-minute lock and takes about six
minutes, `slow-answer` holds two answers back 35 s each, `resume` drops Player One's
connection between a move's two requests and waits out the 60 s grace time twice, and
`cleric-fixture` rebuilds fixture 13 and fails if pf2e opens a choice prompt):

```sh
npm run harness:live -- --runs 2 --behaviours all --out /tmp/live     # everything
npm run harness:live -- --scenarios 3c --runs 1 --behaviours none --canvas
npm run harness:live -- --scenarios none --behaviours m4-lifecycle,m4-no-gm,m4-cancel,m4-double-delivery,m4-reroll-race,m4-shots,m4-ui --runs 1 --shots /tmp/m4-shots
npm run harness:live -- --scenarios none --behaviours m5-buy,m5-ally-copy,m5-pick,m5-jobs,m5-etch,m5-upgrade-transfer,m5-precious,m5-scroll,m5-fund,m5-services,m5-ui,m5-shots --runs 1 --shots /tmp/m5-shots
npm run harness:live -- --scenarios none --behaviours m6-clock,m6-wizard-gm,m6-wizard-players,m6-communal,m6-income,m6-settlement --runs 1
npm run harness:live -- --scenarios none --behaviours m7-morning,m7-expiry,m7-rest,m7-dailies,m7-standing,m7-affix,m7-shots --runs 1 --shots /tmp/m7-shots
npm run harness:live -- --scenarios none --behaviours m8-panel,m8-bandolier,m8-turn,m8-vials,m8-healing-bomb,m8-duct-tape,m8-use-best,m8-shots --runs 1 --shots /tmp/m8-shots
npm run harness:live -- --scenarios none --behaviours m8-hud,m8-bandolier,m8-panel --runs 1 --canvas
npm run harness:live -- --scenarios none --behaviours m8a-cloud,m8a-once,m8a-powerful,m8a-timing,m8a-forge,m8a-backends,m8a-panel,m8a-familiar,m8a-shots --runs 1 --shots /tmp/m8a-shots
npm run harness:live -- --scenarios none --behaviours m8a-strike --runs 1 --canvas
npm run harness:live -- --scenarios none --behaviours m9-tattoo,m9-simple,m9-graft,m9-fulu-missive,m9-staff,m9-snares,m9-gadget,m9-shots --runs 1 --shots /tmp/m9-shots
npm run harness:live -- --scenarios none --behaviours m9a-notice,m9a-complex,m9a-quick-setup,m9a-deconstruct,m9a-grow,m9a-garden,m9a-quest,m9a-adjust,m9a-secret,m9a-shots,m9a-off --runs 1 --shots /tmp/m9a-shots
npm run harness:live -- --scenarios none --behaviours m11-sheet,m11-companions,m11-party,m11-context,m11-shelf,m11-macros,m11-keys,m11-keyboard,m11-themes,m11-shots --runs 1 --shots /tmp/m11-shots
```

The registry check also reads every pf2e item with stages, onset or a maximum duration as an affliction (`DESIGN.md`
8.10.2): each must read cleanly, have an override in `scripts/data/afflictions.mjs`, or be on its ignore list, or the run
fails. `--affliction-baseline <json>` (an earlier run's `--json` output) lists the items whose reading changed between two
pf2e releases.

The M4 behaviours run the order lifecycle with a GM and two players (`m4-lifecycle`), with two players and no GM, the
recipient offline at the finish (`m4-no-gm`), a cancel with refunds (`m4-cancel`), the double-delivery race
(`m4-double-delivery`, which waits out the 60 s grace time) and the reroll-against-settlement race (`m4-reroll-race`);
`m4-shots` seeds orders and saves screenshots of the Queue and Funds tabs as the GM and as a player at 1440x900 and
1024x768, dark and light, into `--shots` (default `<out>/shots`); `m4-ui` drives the window as Player One with real
clicks and keys (tabs, both searches, focus through a refresh, the narrow tier, a detached Workshop, the chat cards
after a reload). The M5 behaviours (DESIGN 10.11) need the wizard
fixture (7) built besides the two player characters; each starts by taking back the items earlier M5 plans gave the
characters (marked `flags.world.pf2e-artisans-workshop-m5`) and putting their formula books back. `m5-shots` saves the
Formulas tab as the GM (showing Player One's alchemist) and as Player One, and the Queue with a handed-over item and a
service, at 1440x900 and 1024x768 in both schemes. A world launched before `module.json` named
`styles/workshop.css` serves pages without it; the driver then adds it to each page and says so in `results.json`
(`styleAdded`).

The M6 behaviours (DESIGN 10.12) move the world clock forward (never back), so run them in the dev world only.
`m6-clock` checks the one prompt per day to the owner's client (the GM's while the player is away, the player's at
login); `m6-wizard-gm` and `m6-wizard-players` drive the Advance days window step by step, with a GM moving the clock and
with players only; `m6-communal` gives Player One's alchemist Communal Crafting (marked like M5's items) for Player Two to
help; `m6-income` pays an Earn Income job from Player Two on two devices; `m6-settlement` caps a job's task level.

The M7 behaviours (DESIGN 10.13) prepare Player One's bomber (Talisman Dabbler) through pf2e's own crafting methods
(`m7-morning`: a loadout by family, virtual talismans, the stamps), hand an infused elixir to Player Two and rest
(`m7-expiry`: it goes inert on Player Two's client; 24 hours later the next batch does too), rest the party with
pf2e-dailies off (`m7-rest`: one Morning prompt, on the right client) and on (`m7-dailies`: the plan turns pf2e-dailies and
lib-wrapper on in the world's module configuration, reloads every page, drives pf2e-dailies' own window to choose a
loadout in the Workshop's row, and puts the configuration back), deliver a standing order with no GM (`m7-standing`),
affix talismans with and without Talismanic Sage (`m7-affix`), and photograph the Morning tab (`m7-shots`). Items they
give are marked `flags.world.pf2e-artisans-workshop-m7`; each plan puts the characters' formula books and prepared lists
back first.

The M8 behaviours (DESIGN 10.14) use Player One's bomber (level 11: Double Brew, Alchemical Expertise, the field discovery,
Advanced Vials). Without a canvas: `m8-panel` lists what Quick Alchemy makes, makes it through pf2e (one vial; refused at 0;
two with Double Brew) and drives the panel with real keys; `m8-bandolier` reads the vial pips, makes a quick vial (the vial
count unchanged) and throws it through pf2e's own Strike, and checks the window reopens where it was dragged; `m8-turn` runs
a token-less encounter of the fighter and the bomber and checks each Quick Alchemy item ends at its turn, on the client of
whoever holds it, and at the encounter's end; `m8-vials` turns vial gathering on, moves the clock and has two clients gather
at the cap; `m8-healing-bomb` throws a Healing Bomb at Player Two's hurt fighter; `m8-duct-tape` stands Duct Tape in on every
client (a stand-in package entry when it is not installed); `m8-use-best` uses Player Two's potions in order; `m8-shots`
photographs the Bandolier and the panel. `m8-hud` needs `--canvas` and a scene with Player One's bomber token on it (it says
it was skipped without one): the alchemy palette in the token HUD, opened by core's own palette toggle, kept open while the
token moves. Items and feats they give, and the encounters they make, are marked `flags.world.pf2e-artisans-workshop-m8`;
each plan takes them back and refills the vials first.

The M9a behaviours (DESIGN 10.17) turn on only the variants each one needs and turn every variant back off first. They
use Player Two's fighter (master, level 10) as the crafter for Complex Crafting, Quick Setup, Deconstruct and adjustments,
the legacy alchemist fixture for a rushed finish whose flat check can fail, and the druid fixture, lent to Player One, for
Grow; `m9a-grow` logs off the GM and logs 100 days in the ledger (it never moves the clock). The plans that craft, deconstruct
or grow fix the die so the order gets where their later checks look. `m9a-off` runs `m4-lifecycle` with every variant off,
under a write audit on the GM's client, and checks that nothing a variant writes is written and that no tab, request form or
chat card on any client shows a variant.

The M11 behaviours (DESIGN 10.18) drive the integration surface as Player One: the character sheet's header button and
Crafting tab strip without companions (`m11-sheet`) and with PF2e Toolbelt and PF2e Workbench switched on in the world's module
configuration, their crafting settings on, every page reloaded and the configuration put back afterwards (`m11-companions`); the
Party sheet's card, also after pf2e renders its overview again (`m11-party`); "Open Workshop" from the Actors directory's
context menu with real right-clicks (`m11-context`, with `--canvas` only: pf2e's own directory menu fails without a canvas);
the macro shelf, a tile dragged onto the hotbar twice (one macro) and Add to hotbar (`m11-shelf`); every catalogue macro once
(`m11-macros`); the keybinding, bound for the plan only (`m11-keys`); a keyboard-only walkthrough with an accessibility audit,
as Player One (`m11-keyboard`) and as the GM (`m11-keyboard-gm`), which checks that no key pressed in the Workshop reaches
Foundry's own shortcuts (the pause; with `--canvas`, a marked scene with both characters' tokens, the view and the selected
tokens); the contrast of the window's and the shelf's text in the dark and light schemes and with Parchment (`m11-themes`);
and screenshots of the strip, the card and the shelf (`m11-shots`). The macros the plans make are deleted again with their
hotbar slots.

`npm run screenshots` (`tools/harness/screenshots.mjs`, DESIGN.md 17.1) takes the README's screenshots in the same dev
world, through the same driver. It copies four fixture actors into a demo party with generic names (Player One plays the
alchemist, Player Two the fighter), makes them the party and the players' characters, stages orders in every state, money
in the party fund, three formulas and downtime (a settlement, two days of an Earn Income job, a day to resolve on an
order; the GM moves the world clock forward, so use the dev world), and captures the Workshop window cropped to its frame
as Player One at 1440x900: the Queue with an order's detail, the request form, Funds, Formulas, Downtime and Morning (a
loadout and a standing order staged for the alchemist) in the dark theme, and the Queue in the light one, then the macro shelf
and the alchemist's sheet on its Crafting tab with the Workshop's strip. Each capture is checked for raw i18n keys, fixture names and overflowing boxes, compressed with ImageMagick's `magick`
when it is installed (to 256 colours only if it would be over 400 KiB), and written to `docs/screenshots/` (`--out` for
elsewhere; `--results` for the run's JSON). Then it gives the party and the users their own characters back, deletes the
demo actors and the run's chat messages, and resets the shared documents as `harness:live` does. The captures show the
checkout the server runs. `docs/screenshots/` is the only place the asset check allows images (PNG, at most 400 KiB
each), and the release zip leaves `docs/` out.

`npm run harness:perf` (`tools/harness/perf.mjs`, DESIGN.md 15.7) is the performance pass, in the same dev world through the
same driver. It adds three copies of fixture actors to the party (five members), measures, then stages a campaign through the
module's own functions (`--seeds` runs of orders in every state, every member in downtime, three on Earn Income jobs, and
one Advance days run of `--days` days) and measures again, then copies those records up to `--orders` orders and `--rows`
ledger rows (default 200 and 2000) and measures a third time: the Workshop's opens and each tab's render as the GM and
as Player One, what one change to the ledger costs every open window, reconciliation, a ledger write and a deposit, and a
full Advance days run through the wizard, with CPU profiles of each on the GM's page summed by function and file. Then it
puts the party back, deletes the copies and the run's chat messages, and resets the shared documents as `harness:live`
does; the results are in `<out>/results.json`.

Options: `--shots` (where screenshots go), `--url` (default `http://localhost:30000`), `--chromium` (the browser binary; on
Arch the default is `/usr/lib/chromium/chromium`, behind the `/usr/bin/chromium` launcher
that adds the desktop's flags), `--headed`, `--canvas` (pages load the game canvas;
without it a player's client throws in core's `Actor#_onUpdate` whenever an actor's
ownership changes, so that client never runs its `updateActor` hooks, as at a table where
a player turned the canvas off; the module copes, and `--canvas` covers the usual case). It prints each
check, exits non-zero if any fails, and writes every step's JSON result, every check,
each page's console errors, notifications and dry-run hooks, and any slow answer from the
server to `<out>/results.json` (by default in a new folder under the system's temporary
directory). At the end it resets the world once more (switch on, fresh shared documents).

## License and notices

The code is MIT (see `LICENSE`). `NOTICE` holds the game-material notices in full, with the complete Open Game License.
This module is unofficial fan content: it is not affiliated with, published, endorsed or specifically approved by Paizo
Inc. It ships no Paizo rules text; it uses the numbers of the crafting rules, and refers to the PF2e system's compendium
for everything else.

### Community Use Policy

This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy
(paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or access this content. This
module is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo
products, visit paizo.com.

### ORC Notice

[AUTHOR-TODO: paste the ORC License's location statement verbatim from the ORC License itself. In Paizo's Remaster books
it is the first sentence of the ORC Notice, beginning "This product is licensed under the ORC License held in the Library
of Congress", and it ends with the warranty disclaimer.]

Attribution: This product is based on the following Licensed Material: [AUTHOR-TODO: paste, verbatim from each book's
own ORC Notice, the attribution line of every ORC-licensed work the module takes numbers from (title, copyright year,
Paizo Inc., authors). DESIGN.md 16.6 names Player Core, Player Core 2, GM Core and Treasure Vault (Remastered); the
rules registry also cites other Remaster books (DESIGN.md 16.9, Follow-ups, has the list and how to regenerate it).]

If you use our Licensed Material in your own published works, please credit us in your product as follows: [AUTHOR-TODO:
the credit line you want, for example "PF2e Artisan's Workshop (c) 2026, Cliff Colvin".]

Reserved Material: Reserved Material elements in this product include all elements designated as Reserved Material under
the ORC License. [AUTHOR-TODO: name this module's own Reserved Material, if any (its name, for example), or delete this
placeholder.]

Expressly Designated Licensed Material: [AUTHOR-TODO: say which of this module's material, if any, you designate as
Licensed Material (for example the numeric tables in scripts/data/), or write "This product contains no Expressly
Designated Licensed Material."]

### Open Game License

Open Game Content and Product Identity are designated, and the complete Open Game License Version 1.0a is given, in
`NOTICE`.

15. COPYRIGHT NOTICE

[AUTHOR-TODO: paste, verbatim from the section 15 of each OGL book the module takes numbers from, every line that book's
section 15 lists (it starts with "Open Game License v 1.0a Copyright 2000, Wizards of the Coast, Inc." and the System
Reference Document line, and ends with the book's own line and its authors): Pathfinder Secrets of Magic for the tattoo
process, and the legacy books of the badged registry entries (DESIGN.md 16.9, Follow-ups, has the list). Keep each
line once. Then add this module's own line, for example "PF2e Artisan's Workshop (c) 2026, Cliff Colvin".]
