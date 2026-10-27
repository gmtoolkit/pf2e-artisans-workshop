# Artisan's Workshop: design specification

Status: draft specification for the first release (2026-10-25). Module id `pf2e-artisans-workshop`.

This file says what the module does and how. `DECISIONS.md` says why, and it wins: if the two
disagree, this file is wrong and gets corrected. Unresolved points are listed in section 18 and
referenced inline as (OQ-n). Resolved questions stay in that table, marked resolved, so their numbers
are never reused; the rule they settled is stated in the section it belongs to.

Conventions used throughout:

- Money is integer copper (cp) everywhere in code, storage and pseudo-code. 1 pp = 10 gp = 100 sp = 1,000 cp.
- `MOD` stands for `pf2e-artisans-workshop`: flag scope, settings namespace, query prefix and hook prefix.
- "pf2e source" means the `foundryvtt/pf2e` repository: release tag `pf2e-8.6.1`, cross-checked
  against `v14-dev` at `be4ab21b` (2026-10-24). Paths are relative to that repository.
- Rules are paraphrased and cited by book and page, or by compendium item name. No rules text is
  reproduced in this file or in the module.
- "Owner client": a connected Foundry client whose user has OWNER permission on the document in question.
- "Responsible client": the single client that performs a write: a client of the responsible user chosen
  by section 5.6, and among that user's connected clients the one holding the local lease (5.6).
- "Verified" means confirmed by reading the pf2e or Foundry v14 source; nothing here has been run
  in a live world yet (section 15 covers that).

---

## 1. Purpose and scope

The module gives a party one place to run crafting: who wants what, who can make it and how, where
the money is, how far each job has got, and the daily preparations and in-combat alchemy that feed
it. It is built for any PF2e character and any table. Every number comes from the character, the
item and the rules, never from a preset build.

### 1.1 Crafting journeys covered

| Journey | What the module does | Main rules |
|---|---|---|
| Alchemical items | Downtime Craft orders (batches, Efficient Alchemy), Advanced Alchemy and versatile-vial daily prep, Quick Alchemy in combat | Player Core p.237 (Craft); Player Core 2 alchemist |
| Magic items and runes | Craft orders, rune etching, upgrades by price difference, rune transfer and swap, precious materials | Player Core p.237; GM Core pp.223-225, 252-253 |
| Talismans | Craft orders; daily temporary talismans (Talisman Dabbler, Talisman Esoterica) with a virtual formula list; the DC stamp for Talisman Dabbler only; affix records | GM Core (Affix a Talisman, talisman trait); Player Core 2 Talisman Dabbler; Dark Archive (Remastered) Talisman Esoterica |
| Spellhearts | Craft orders with casting pledges (6.9); affix records shared with talismans: one talisman or spellheart per host, with the Talismanic Sage exception (7.4) | Secrets of Magic p.170; items in Treasure Vault (Remastered) and Impossible Magic |
| Fulus | Craft orders in batches of 4; an expiry stamp `rule: "world"` one year after creation; the crafter's tradition trait set on the created item. The rapid option (up to 4 at full Price in 1 day, expiring after one month) is not built: under the Remaster Craft it would only shorten the fulus' life (DECISIONS.md 2026-10-27, 10.16) | Secrets of Magic p.158 (fulu trait, Crafting a Fulu) |
| Missives | Craft orders for the blank missive, then a "compose" step on the created item (Compose Missive, 10 minutes) that records it as composed | Treasure Vault (Remastered) p.84 |
| Grafts | Graft orders (`craftType: "graft"`): G4 is Graft Technician with expert Medicine; the implant uses Medicine and reuses the tattoo subject flow (consent, subject present and locked, one at a time per implanter, invest claim) | Howl of the Wild p.97 |
| Tattoos | Tattoo orders using the Secrets of Magic process by default, with a toggle for a plain Craft | Secrets of Magic p.164; Tattoo Artist (Treasure Vault (Remastered) p.118, Impossible Magic p.241) |
| Snares | Downtime Craft orders; daily quick-deploy slot ledgers shown on the Morning tab. Snares are craftable items only: placing them on the map is a non-goal (1.2) | Player Core 2 p.297 |
| Gadgets | Access-gated Craft orders; Gadget Specialist daily slots | Guns & Gears (Remastered) p.66 |
| Scrolls, wands, staves and other spell-supplied items | Craft orders with casting pledges from party casters | GM Core pp.262, 282; staff Craft Requirements |
| Repair | Service orders | Player Core p.236 (Repair) |
| Formula acquisition | Buy, copy, Inventor, reverse-engineer, feature grants and per-level picks, formula families | Player Core p.294; Inventor (Player Core p.257) |
| Earn Income | Jobs for Crafting, any Lore (including Cooking Lore), Performance and other skills; wages paid idempotently | Player Core p.228; GM Core p.53 |
| Cooking | Flavour plus Cooking Lore Earn Income only. Alchemical foods are ordinary alchemical items; Seasoned applies through the roll wrapper | Seasoned (Player Core) |
| Afflictions | A stage tracker for poisons and other affliction-bearing consumables the module crafts or uses: weapon coatings and Strikes, contact, ingested and inhaled exposure, initial and stage saves, onset, stage intervals, maximum duration, virulent, multiple exposures, the creator's DC, rolled by the victim's owner (8.10) | Player Core pp.430-431; GM Core p.248 |
| Treasure Vault (Remastered) variants | Complex Crafting (with Quick Setup), crafting with adjustments, crafting downtime events, Critical Crafting, Deconstruct, Grow, Gardens of Wonder, Bestowed Gifts and crafting quests, each a world setting that is off by default (6.16) | Treasure Vault (Remastered) pp.157-175 |

### 1.2 Non-goals

- Circus management and every other adventure-path subsystem. They are separate modules built on
  the extension API (section 12). No AP rules ship in this package.
- Kingmaker camping meals, recipes and ingredients.
- The third-party Heroic Crafting ruleset.
- Replacing, wrapping or patching the system Craft button, the Craft action macro or its chat card.
- New tabs on character or party sheets.
- GM approval inboxes or any workflow that waits for a GM decision.
- Re-implementing anything pf2e-dailies, PF2e Toolbelt, PF2e Workbench or Item Piles already
  automates (section 13).
- Shipping Paizo text, compendium packs, images or art.
- Runesmith etched and traced runes. They are class resources used in play, not crafted items; the
  Morning tab lists them as "not automated". Runic Crafter's formulas are covered (6.8).
- Placing snares on the map (their Stealth DC, triggering, and inertness after a day). Snares are
  craftable items only.
- A legacy rules toggle. The maths always follows the Remaster books; legacy content (items, feats,
  formula books) is allowed and badged (P8, 6.11).
- Items that exist only in the PF2e Legacy Data module (different UUIDs). Only the pf2e system packs
  are in scope.
- Addiction to drugs (Gamemastery Guide p.120): the drug's own stages are tracked (8.10), the
  addiction affliction is not.
- Automatic detection of afflictions from creature abilities and spells. A user can still start the
  tracker on any item with stage text through Expose (8.10.3).
- Template or Region placement for inhaled poison clouds, as for bomb splash (OQ-29).

---

## 2. Design principles

Each principle is a rule a reviewer can check a pull request against.

| # | Rule | Check |
|---|---|---|
| P1 | **Requirements are the only gate.** A Craft starts when the gates in 6.5 pass, the up-front materials are funded, and the crafter has confirmed the narrative Craft Requirements checklist. | No code path waits on a GM decision. GM levers are settings and data tools only. |
| P2 | **No GM needed.** Every feature works with only players connected. | Each operation lists which documents it writes; all are owned by the acting user, or the change is a claim (5.5). The one carve-out is an affliction handed off to Affliction Forge, whose engine runs only on a GM client; with no GM connected the Workshop tracks it instead by default (8.10.11). |
| P3 | **Write only what you own, by key.** Shared state lives in the two module documents every player owns. Collections are objects keyed by id. | No update rewrites a whole collection or array; updates use dotted key paths; deletions use `_del`. |
| P4 | **One responsible client.** A write triggered by a hook that fires on several clients runs on exactly one client (5.6). Prompts appear only on that client. | Every all-client hook handler starts with a responsible-client guard. |
| P5 | **Idempotent effects.** Every effect has a deterministic key; repeating it is a no-op. | A catch-up sweep at `ready` can always be run safely. |
| P6 | **The system is the engine.** Use pf2e crafting abilities, the formula list, special resources, coin items, Rest for the Night and Statistic rolls. | No writes to `system.crafting.entries` or rule-element `prepared` arrays except through `CraftingAbility` methods. No libWrapper, no monkey-patching. |
| P7 | **Own the roll, not the button** (6.12). | The system Craft macro and its pay buttons are never used for orders. |
| P8 | **Remaster first.** Player Core, Player Core 2, GM Core and Treasure Vault (Remastered) are the baseline. Legacy content is allowed but badged. | Rules that differ in legacy books always follow the Remaster text; there is no legacy rules toggle. Settings exist only where the Remaster books are silent or disagree with each other. |
| P9 | **Ship numbers, not text.** Numeric tables only. Names, descriptions and images are read from the compendium by UUID at runtime. Items are matched by compendium source UUID, never by name or slug alone. | No rules prose in `lang/en.json` or code. |
| P10 | **Inert until switched on.** The master switch defaults to off, and turning it on is what creates the shared documents (5.2). Once it is on, the feature toggles default to on, so the decided defaults (escrow into the strongbox, automatic inert marking, downtime, the Secrets of Magic tattoo process, the affliction tracker) are what a table gets; vial gathering, which writes to actors as time passes, stays off. The Treasure Vault (Remastered) variants (6.16) are variant rules, not features, and stay off until a GM turns each one on. Enabling a feature changes nothing until someone uses it. | Fresh install in an existing world makes no document writes until a GM turns on the master switch. |
| P11 | **Coexist.** Detect companion modules and step aside where they own a feature (section 13). | No duplicate prompts or competing automation with pf2e-dailies, Toolbelt, Workbench, Item Piles or Duct Tape. |
| P12 | **Plain stack.** Plain ESM, ApplicationV2 with Handlebars, no build step, no jQuery, no AppV1, no deprecated global aliases, safe in detached windows, zero hard dependencies. | Lint rules in 15.1. |
| P13 | **Strings in one place.** Every user-facing string is in `lang/en.json`, rewritten by the author before listing, behind the sign-off gate (16.4). | Lint: no string literals in templates or notifications. |
| P14 | **No AI art.** Icons come from Font Awesome, Foundry core or the pf2e system; item images from the compendium. | CI asset check (16.5). |
| P15 | **Generic.** No feature, default, fixture or example targets a specific character. | Review. |
| P16 | **Target devices.** Laptops and desktops; the Foundry window is at least about 1024 px wide. | Layout tests at 1024 px (10.8). |

These principles, including P7, the responsible-client rule (5.6), the Duct Tape step-aside
(section 8) and master-switch bootstrap (P10, 5.2), are recorded in `DECISIONS.md`.

---

## 3. Compatibility

### 3.1 Versions and manifest policy

At the time of writing the latest Foundry build is 14.369 (2026-10-08) and the latest pf2e release
is 8.6.1 (2026-10-12), which declares Foundry `minimum 14.361`, `verified 14.369`, `maximum 14`.
No Foundry v15 build exists in any channel.

| Manifest field | Policy | Reason |
|---|---|---|
| `compatibility.minimum` | pf2e's own Foundry floor at release time (14.361 today). Raised only when the module needs an API that a newer build added. | Foundry enforces it hard. The Forge adds point builds about 30-35 days after release (14.367: 35 days; 14.368: 30 days) and its default channel lags further. When pf2e's floor moved past the Forge's build in April 2026, Forge users could not update for about 11 days. |
| `compatibility.verified` | The newest Foundry build actually run through the section 15 tests. | `verified` only affects the badge; an older value warns but still loads. |
| `compatibility.maximum` | `"14"` (integer, major-only). | Foundry treats an integer maximum as a hard stop at the next generation. pf2e 8.x cannot run on v15, so v15 support means a new pf2e major we have to test first. |
| `relationships.systems[pf2e].compatibility.minimum` | The oldest pf2e minor in the release test matrix. | Dependency checks use only `minimum` and `maximum`. |
| `relationships.systems[pf2e].compatibility.maximum` | Unset. | pf2e ships a minor every 2-4 weeks and these rarely break modules; the Foundry `maximum` already gates the next generation. |
| `relationships.requires` | Empty. | Core `CONFIG.queries` and `foundry.documents.modifyBatch` replace socketlib; nothing needs libWrapper. |
| `socket` | `false`. | Document updates propagate by themselves; the relay rides the core query channel. |

Until the section 15 tests first run in a live world, the unreleased scaffold sets both `verified` fields (Foundry
and the pf2e relationship) equal to their `minimum`, the weakest claim the manifest check accepts; the first harness
run raises them to the builds it ran on.

Behaviour that differs between pf2e versions is handled by feature detection, not version checks.
Example: Quick Alchemy ammunition gets the infused trait only after pf2e #23495 (merged after 8.6.1),
so expiry stamping checks the created item's traits rather than assuming either behaviour.

### 3.2 Node for local development

Foundry v14 declares Node `>=24.13.1 <25` and refuses to start below 24. Local Foundry, lint and unit
tests all run on Node 24 (CI uses the same major). Newer Node majors pass Foundry's start-up check but
are outside its declared range and are not used. `package.json` declares the same range, and `.npmrc`
sets `engine-strict` so that `npm ci` refuses any other Node (the tools rely on `import.meta.main`,
which Node 24.0 and 24.1 lack).

### 3.3 Tracking pf2e churn

A scheduled GitHub Action (daily) does four things and opens an issue when any of them changes:

1. Lists `foundryvtt/pf2e` releases whose tag starts with `pf2e-`. Never `releases/latest`: in that
   repository "latest" is usually an SF2e release.
2. Diffs the dev branch for these paths:
   - `src/module/actor/character/crafting/`
   - `src/module/rules/rule-element/crafting-ability.ts`, `special-resource.ts`
   - `src/module/system/action-macros/crafting/`
   - `src/scripts/macros/rest-for-the-night.ts`, `earn-income.ts`
   - `src/module/actor/inventory/index.ts`
   - `src/module/actor/party/`, `src/module/actor/loot/`
   - `src/module/system/check/check.ts`, `src/module/system/statistic/statistic.ts`
   - `src/module/item/affliction/`, `src/module/item/abstract-effect/`, `src/module/item/effect/data.ts`
     and the production gates for the affliction type in `src/scripts/hooks/init.ts` and `load.ts`
     (8.10.1: the day pf2e ships the type in release builds, the tracker switches backend), plus the
     triggers of `AfflictionPF2e.handleStageChange` (`_onCreate`, `_onUpdate`, the `system.onset` damage
     gate), which the native backend works around (8.10.1, OQ-44), and the effects panel's click handlers
     in `src/module/apps/effects-panel.ts`, which the tracker's stage guard intercepts (8.10.1)
   - `src/module/system/text-editor.ts` (inline `@Check` DCs, which the Powerful Alchemy DC stamp
     relies on, 8.10.4)
   - `static/templates/actors/character/tabs/crafting.hbs`, `static/templates/actors/party/sheet.hbs`
3. Runs the registry validation (6.11) against the newest `pf2e-` tag and the dev branch head.
4. Greps the release notes for craft, alchem, formula, party, rest, ApplicationV2, DialogV2, Svelte
   and TypeDataModel, plus Foundry release milestones.

Target: a `verified` bump within a week of each pf2e release. Upstream issues worth watching:
#19993 (Craft DC ignores rarity), #17796 (formula versions), #6981 (crafted item size), #7328
(Earn Income pays nothing), #10411 (reroll breaks the craft card), #20606 (quick vials), #21091
(Powerful Alchemy), and the expected move of character and party sheets to ApplicationV2 and Svelte.

---

## 4. Domain model

### 4.1 Entities at a glance

| Entity | Stored in (5.1) | Written by | Key |
|---|---|---|---|
| Order (one Craft) | Workshop ledger `orders` | requester, crafter, helpers, each on their own fields (4.2.4) | random id |
| Service order | Workshop ledger `services` | requester, performer | random id |
| Formula provenance | Workshop ledger `formulas.<actorId>` | the learner's owner | hash of item UUID |
| Ledger row | Workshop ledger `rows` | whoever performs the movement | hash of idempotency key |
| Claim | Workshop ledger `claims` (plus shelf items in the strongbox) | the creator; resolved by the claimant's owner | hash of idempotency key |
| Per-PC downtime status | Workshop ledger `pcs.<actorId>` | the PC's owner | actor id |
| Downtime-day record | Workshop ledger `days` | the resolving client: the PC's owner or the wizard runner (9.2) | `<actorId>-<day>`; variant records `<actorId>-<day>-<orderId>` (4.8) |
| Manual day log | Workshop ledger `meta.manual.<runId>` | the wizard runner (9.2) | random id |
| Lock page | JournalEntryPage in the Workshop ledger | created first in every batch that moves coins, items or formulas (5.4); pruned when its row is archived | id of what it locks: a row, a strongbox item, a purse coin stack at one version (5.4) |
| Earn Income job | Workshop ledger `jobs` | the earner's owner | random id |
| Roster snapshot | Workshop ledger `roster.<actorId>` | the PC's responsible client | actor id |
| Standing order | Workshop ledger `standing` | requester, crafter | random id |
| Daily loadout | PC actor flags `MOD.loadouts` | the PC's owner | random id |
| Expiry stamp | flags on the created item | the creator's client | item |
| DC stamp | flags on the created item (8.10.4) | the creator's client | item |
| Affix record | flags on the talisman or spellheart item | the item's owner | item |
| Coating | flags on the coated weapon, ammunition or item (8.10.5) | the coated item's owner | item |
| Affliction instance | an affliction or effect item on the victim, run state in its flags (8.10.1) | the victim's responsible client | item id |
| Affliction definition override | Workshop ledger `afflictionDefs.<hash>` (8.10.2) | any member | hash of source UUID |
| Components | flags on a deconstructed item (6.16.5) | the item's owner | item |
| Garden | Workshop ledger `gardens` (6.16.7) | any member; harvests by the harvester's owner | random id |
| Gift binding | flags on the item (6.16.8) | the item's owner | item |
| Extension data | Workshop ledger, the extension's own flag scope `flags.<moduleId>` (As built in M10, 12.4) | the extension, same rules | extension-defined |
| Extension activity run | Workshop ledger `extRuns` (12.6) | the roller of its check | hash of actor, activity, first day, aided PC |
| Consumable spend | Workshop ledger `spends` (12.6) | the item's owner | hash of sink and the extension's key |
| Income payment | Workshop ledger `incomes` (12.6, M10 review) | the client that pays it | hash of income source and the extension's key |

Every record carries `by` (user id) and `at` (`{world: worldTime seconds, real: Date.now(), server:
game.time.serverTime, launch}`) for the last write. `real` is the author's own clock, for display; ages and
timeouts are read on the server's own clock, `launch + server` (`stampTime`, `scripts/logic/core.mjs`), against the
reader's moment on the same clock (`serverNow`, `scripts/foundry/store.mjs`), so two machines' clocks are never
compared. A stamp without `launch` falls back to `real`. Ids are random (16 lowercase alphanumerics, so they are safe inside roll options) or
16-character hashes of an idempotency key; flag keys never contain dots.

As built (live harness): `game.time.serverTime` is not a clock but the time since the server launched the world
(`Date.now() - start`, Foundry 14.368 `dist/components/activity.mjs`; measured live, it matched the server's uptime),
so it starts again at every launch, and a stamp from a launch that ran longer than the current one has so far would
read as being in the future. `launch` is therefore the moment of that launch on the server's clock: the world's
`lastPlayed`, which the server sets as it launches the world (to the second, `dist/packages/world.mjs`) and every
client of that launch receives as the same string (`Date.parse(game.world.lastPlayed)`; measured live, it lay 0.06 s
from the start of `serverTime`). Within a launch every client has the same `launch`, so ages compare server times
as each client estimates them, as before; across a relaunch they are right to about a second. A client's
`serverTime` is core's estimate (`GameTime#sync`, `client/helpers/time.mjs`: the server's time at its last answer
plus half the average round trip), and a page busy when that answer came runs behind: measured live, clients agreed
within 1 ms without a canvas and within 0.4 s with one, far inside the 60 s grace and the five-minute lock timeout.

As built in M2 (`scripts/logic/ids.mjs`): a random id maps 32-bit values from `crypto.getRandomValues` onto
36 lowercase letters and digits, rejecting biased values as Foundry's `randomID` does. A hash id is two
64-bit FNV-1a hashes of the key (with two offset bases) joined into one 128-bit number, written in base 36,
last 16 digits. Both are valid Foundry document ids (16 characters of `[a-zA-Z0-9]`, Foundry 14.368
`common/data/validators.mjs` `isValidId`), which is what lets a row's id name its lock page (5.4). `idemKey`
joins a key's parts with `:` and refuses a part that is empty or contains `:`, so two operations never
share a key.

### 4.2 Order: one Craft activity

An order is one Craft by one crafter: one item, or one batch of one item. Larger requests split into
several orders. The same record type covers items, upgrades, rune etching, rune transfers, tattoos,
grafts, spell-supplied items, Craft-like formula jobs and the variant activities of 6.16 (Deconstruct,
Grow, crafting quests); `product.type` and `craftType` tell them apart.

#### 4.2.1 Fields

| Field | Type | Notes |
|---|---|---|
| `id`, `v` | string, int | `v` is the row schema version |
| `party` | actor id or null | the pf2e Party actor the order belongs to. There is one Workshop per world; orders, jobs and gardens are tagged by party, and the header's party selector filters by this tag |
| `requester` | actor UUID | who asked |
| `recipient` | `{kind: "actor" \| "strongbox", uuid?}` | where the finished item goes; selling finished items is not part of the first release |
| `product` | `{type: "item" \| "formula", uuid, family, snapshot: {name, img, level, rarity, traits, priceCp, per}}` | `uuid` is the compendium source UUID; the snapshot is for display and frozen pricing |
| `craftType` | `"item" \| "upgrade" \| "rune-etch" \| "rune-transfer" \| "tattoo" \| "graft" \| "spell-item" \| "deconstruct" \| "grow" \| "quest"` | selects rules in 6.2-6.9, 6.14 and 6.16; the last three exist only while their variant is on |
| `attempt` | int | increases at each start, retry and crafter swap; day records and the check belong to one attempt |
| `quantity` | int | within `batchMax` (6.3) |
| `target` | item UUID or actor UUID | the item being upgraded or etched, or the tattoo or graft subject |
| `crafter` | actor UUID or null | null until someone accepts |
| `skill` | skill slug | normally `crafting`; registry substitutions (6.11) |
| `route` | formula route (4.3) | evaluated live until start, frozen at start |
| `priceCp`, `upfrontCp` | int | frozen at start (6.2) |
| `dc` | `{level, rarity, repeat, adjust, final, pwol}` | frozen at start |
| `setup` | `{days, hours}` | setup needed, frozen at start; days done are derived (below). `hours` is non-zero only for a Complex Crafting setup rushed below one day (6.16.1), which takes no downtime day |
| `variant` | `{complex?: {rush, band, quick}, adjustments?: [itemUuid], special?: bool, deconstruct?: {...}, grow?: {mode}, quest?: {...}}` | variant data, frozen at start where it changes cost, DC or time (6.16) |
| `events` | `{[k]: {day, roll, tableResult?, note, status, by}}` | crafting downtime events (6.16.3) |
| `check` | `{degree, unadjusted, total, messageId, level, rank, rerolled, settled}` | written from the chat message (6.12); `settled` once the money rows are posted (4.2.3) |
| `helpers` | `{[actorId]: {skill, rank, level, degree, joinedDay, leftDay}}` | Communal Crafting (6.7) |
| `pledges` | `{[id]: {caster, spell, rank, castings, payer, day, status}}` | casting pledges (6.9) |
| `checklist` | `{[key]: {confirmedBy, at}}` | narrative Craft Requirements; text read at runtime |
| `materials` | `{[lineId]: {kind: "coin" \| "item" \| "components", itemUuid?, valueCp, material?: {type, grade}}}` | coin funding is derived from ledger rows; item lines point at earmarked strongbox items; a `components` line points at a deconstructed item (6.16.5) |
| `status`, `resumeTo` | state (4.2.2) | |
| `priority`, `notes`, `visibility` | | `visibility: "public" \| "gift"` (gift hides product details from the recipient) |
| `dependsOn` | order ids | for example a formula job that must finish first |

Funding totals, contributor shares and percentages are never stored on the order. They are derived
from ledger rows by order id, so two contributors paying at once never write the same field. Work
totals are derived the same way, from the day records of the current attempt (4.8): setup days done,
extra days worked, the cost reduction earned by the crafter and each helper, and the last day worked.
Nobody stores a running total, so two clients resolving the same day write the same record instead of
adding to the same counter.

#### 4.2.2 States

| State | Meaning |
|---|---|
| `requested` | Filed by a party member; no crafter has accepted it yet. Pledges are allowed. |
| `accepted` | A crafter has taken it. Gates (6.5) are evaluated live and shown as reasons; funding continues. |
| `setup` | Started. Price, DC and route are frozen; the up-front amount is committed; setup days accrue. |
| `gathering` | A crafting quest (6.16.9) is under way: components are being found; no setup days, no money. |
| `check` | Setup is complete; the crafter must roll the Craft check before any further day counts. |
| `rolled` | The check is recorded but not yet settled, and no money has moved. A reroll replaces the recorded check. Settling posts the money rows and moves the order to `finishing` or `failed`. |
| `finishing` | Success or critical success. Each extra day reduces the remainder; the crafter can finish at any time by paying it. |
| `paused` | Interrupted from `setup` or `finishing`; `resumeTo` holds the state to return to. |
| `failed` | Failure (materials salvaged in full) or critical failure (10% ruined). Can be retried from scratch or cancelled. |
| `complete` | Remainder paid or zero; items created and delivered or shelved (5.5). |
| `cancelled` | Closed; refunds issued by outcome (6.2.4). |
| `archived` | Moved out of the live document (5.3.3). |

"Blocked" is not a state. It is the live gate result on an `accepted` order, shown with the reason and
what would unlock it.

#### 4.2.3 Transitions

| From | Event | To | Who | Effects |
|---|---|---|---|---|
| (none) | file request | `requested` | any member | order created; crafter may file for themself, which goes straight to `accepted` |
| `requested` | accept | `accepted` | the crafter's owner | `crafter` set |
| `accepted` | release | `requested` | the crafter's owner | `crafter` cleared |
| `requested`, `accepted` | cancel | `cancelled` | requester or crafter | pledges become refund claims |
| `accepted` | start | `setup` | the crafter's owner | requires all gates; freezes price, DC and route; `attempt` + 1; `commit` rows; the crafter's downtime activity becomes this order; helpers and tattoo or graft subject locked |
| `setup` | setup day resolved | `setup` | resolving client (9.2) | a setup-day record (4.8); for a Complex Crafting setup of hours other than Quick Setup's 2-hour consumable setup, the day's `setup-hours` record (6.16.1) |
| `setup` | derived setup done: setup days reach `setup.days`, and a `setup-hours` record exists when `setup.hours` > 0 (6.2.2) | `check` | the crafter's responsible client | status only; writing it twice is harmless |
| `setup`, `finishing` | crafter's activity changes, or pause | `paused` | the crafter's owner | `resumeTo` set |
| `paused` | resume | `resumeTo` | the crafter's owner | setup days kept, or a new attempt by setting (6.2.5) |
| `check` | roll recorded | `rolled` | the rolling user (6.12) | `check` written; no rows |
| `rolled` | reroll recorded | `rolled` | the rolling user | `check` replaced; no rows |
| `rolled` | settle | `finishing` or `failed` | the crafter's owner, or automatically by the crafter's responsible client when the order's next day is resolved or at its `ready` sweep; extra-day records written in the meantime count once it settles as a success | `check.settled`; `expend` on success; `release` on failure; `ruin` and `release` on critical failure |
| `finishing` | extra day resolved | `finishing` | resolving client | an extra-day record with the day's reductions (4.8) |
| `finishing` | finish | `complete` | the crafter's owner | `remainder` row; items created; delivery or shelf |
| `failed` | retry | `setup` | the crafter's owner | `attempt` + 1; new `commit`; setup days and the check start again |
| `failed`, `finishing` | cancel | `cancelled` | requester or crafter | escrow not yet spent becomes refund claims |
| `failed` (Critical Crafting) | made anyway | `finishing` | the crafter's owner or a GM, by recording the settled critical failure as made (6.16.4) | `commit` and `expend` of what the settlement released (a ruin stays spent); undoable |
| any active state but `rolled` | crafter swap | `setup` | the new crafter's owner | `attempt` + 1: restart setup and check; escrow and earmarked materials carry over (6.2.5). A recorded check is settled first, so its outcome is never thrown away |
| `rolled` (Deconstruct) | settle | `complete` or `failed` | as for any settle | no finishing phase: success writes the components record and, when purpose is `similar` and a `followOn` is named, the follow-on's setup credit (6.16.5) |
| `accepted` (quest) | start quest | `gathering` | the crafter's owner | no rows; components listed (6.16.9) |
| `gathering` | component found | `gathering` | any member | `variant.quest.components.<id>.found = {by, day}`; nothing else |
| `gathering` | derived: every component's `found` is set | `check` or `complete` | the crafter's responsible client, when it sees the last mark | status only for `check` (when an assembly check is required); otherwise delivery as at `finish`, in a lock-first batch keyed `assemble:<orderId>:<attempt>` (5.4), so writing it twice is harmless (not `deliver:<orderId>:<attempt>`, the shelf item's claim key, whose page the recipient's delivery takes: M9a live pass) |
| `rolled` (quest) | settle | `complete` or `failed` | as for any settle | no money rows: success, and failure with a quirk note, deliver; a critical failure fails the order or delivers it cursed by `variants.quests.critFail` (6.16.9) |
| `complete`, `cancelled` | archive | `archived` | the elected archiver, automatically after the archive age (5.3.3) | moved to an archive page |

The user who made the last transition of an order or job (or another owner of the same actor) can undo
it; a GM can undo the last transition of any order or job. Undo writes reversal rows (4.6) and restores
the previous state; nothing is deleted. A crafter who settles a check by mistake, or an earner with a
wrong wage day, can therefore correct it with no GM online.

#### 4.2.4 Field ownership

The trust model is cooperative (5.10), but clients only write the fields their user is responsible for.
This keeps concurrent edits from colliding on the same key.

| Fields | Written by |
|---|---|
| `requester`, `recipient`, `quantity`, `notes`, `visibility`, `priority` (before start) | requester |
| `crafter`, `route`, `setup`, `attempt`, `status`, `checklist`, `materials`, `variant`, `events` | crafter (`variant.special` also the requester, before start) |
| `variant.quest.components.<id>.found` | any member (6.16.9) |
| `check` | the rolling user (6.12); settlement by the crafter |
| `helpers.<self>` | that helper |
| `pledges.<id>` | that caster |
| `priority` (after start) | crafter |
| day records `days.<actorId>-<day>`, and variant records `days.<actorId>-<day>-<orderId>` (4.8) | whoever resolves that day: the PC's owner or the wizard runner (9.2); a Deconstruct follow-on credit by the client that settles the Deconstruct check (6.16.5) |

The wizard runner writes day records only, never an order's `setup`, `check` or `status`. Every
resolver computes the same deterministic content for a given day (6.2.3), so a day resolved twice
leaves one record.

As built in M4 (`scripts/logic/orders.mjs`, `scripts/foundry/orders.mjs`):

- **The record** carries, besides 4.2.1: `created` (the filing stamp; queue numbers follow it), `specialty`, `log`,
  `settlement` and `conflict`. A request names a product by compendium UUID with its snapshot read from an unsaved,
  prepared copy of the item (`productFacts`); a quantity above one batch (6.3, the named crafter's `batchMax`, else the
  plain one) splits into several orders. Naming a crafter the filing user owns takes the order at once (`accepted`).
- **Transition log.** Every transition writes `orders.<id>.log.<seq> = {seq, event, from, to, prev, rows, by, at}` in
  the same request as its fields and rows: `prev` is what the changed fields held, `rows` the ledger rows it posted
  (their ids follow from their keys, so a settlement names its pro-rata spend rows before it plans the coins). Undo
  (`undoPlan`) takes back the last entry only, while the order is still in the state it left (`moved-on` otherwise),
  for the user who made it, an owner of the actor it was made for, or a GM; it restores `prev` and reverses `rows`
  (`reverseRows`, 4.6). Undoable in M4: accept, release, start, settle, pause, resume, retry. A start's or retry's
  `attempt` stays counted when undone, so day records of the undone attempt never count for a later one. An undo is
  logged (`event: "undo"`) and is not itself undone. Finish, cancel and work days are not undoable in M4.
- **Who may act** (`orderActions`): the crafter's steps belong to the crafter's owners (a GM owns every actor); a cancel
  to the requester's or the crafter's owners or a GM; pledges to any member with a character while the order is open
  and not `rolled`; a withdrawal to a contributor with an uncommitted share (`withdrawableCp`: their own allocation, no
  more than the order holds beyond what is committed). "Mine" (highlighting, the "mine" filter, notifications) is a
  user's assigned character or one they own by name; for a GM, only actors no player owns.

### 4.3 Formula routes

For each candidate crafter and item, the module computes every legal route with its cost, time and
check, and shows them side by side.

| Route | Cost | Time | Check | Notes |
|---|---|---|---|---|
| `known` | 0 | 1 setup day | Craft | UUID in `system.crafting.formulas` |
| `family` | 0 | 1 setup day | Craft | another grade of the same family is known (6.4) |
| `virtual` | 0 | 1 setup day | Craft | a feature grants knowledge without a book (6.8) |
| `none` | 0 | 2 setup days | Craft | common items, or uncommon and rarer items the crafter has access to through a registry grant (G5); shows the formula price as a "save a day" hint |
| `buy` | formula Price | 1 hour to copy | none | job (6.8); then `known` |
| `copy-npc` | formula Price | 1 hour | none | job |
| `copy-ally` | setting, default 0 | 1 hour | none | job; the ally's owner confirms |
| `invent` | formula Price, Craft-like | Craft-like | Craft | Inventor feat; order with `product.type = "formula"` |
| `reverse-engineer` | formula Price, Craft-like | Craft-like | Craft at the item's DC | item possessed; order with `product.type = "formula"` |
| `craft-copy` | formula Price, Craft-like | Craft-like | Craft at the item's DC | craft a copy of a formula the crafter knows, for someone else's book |

Uncommon and rarer items need access (Player Core p.237); a known formula grants access (Player Core
p.294), and so does a registry access grant (an ancestry, background, feat or class feature). With
access but no formula, the `none` route applies (2 setup days). GM Core p.223 reads differently: it
requires the formula itself for uncommon and rarer items. The setting `rules.uncommonNeedsFormula`
(default off) follows that reading, and then `none` is not a route for them (OQ-37).

### 4.4 Batches

A batch is several identical items from one Craft: one check, all materials up front, finished together.
The per-day reduction does not grow with batch size (Player Core p.237; the system's `calculateCosts`
agrees), so the order form shows days-to-zero for every legal quantity and points out that full
batches are the most efficient. Batch limits are in 6.3.

### 4.5 Service orders

Short jobs that party members can ask each other for. They have their own lightweight record:
`services.<id> = {kind, performer, requester, target, status: "open" | "done" | "failed", result, by, at}`.

| Kind | Time | Check | Rules | Writes |
|---|---|---|---|---|
| `repair` | 10 minutes (1 minute with Quick Repair; 3 actions at master; 1 action at legendary) | Crafting vs the item's level DC, no rarity adjustment | Player Core p.236; GM Core p.53. Requires the performer to hold or wear a repair toolkit; Improvise Tool waives it | restores HP on the target item; Crafter's Eyepiece values applied (6.13) |
| `affix` | 10 minutes; registry feats change count and time (7.4) | none | GM Core Affix a Talisman. Requires a repair toolkit on the performer, used with both hands (Improvise Tool does not waive it) | affix record on the talisman or spellheart (7.4) |
| `identify-alchemy` | 10 minutes | the system's Identify Alchemy action (secret) | Player Core p.237 | none of our own |
| `formula-copy` | 1 hour | none | Player Core p.294 | formula added to the learner's book (a formula claim, 5.5, when the performer does not own the learner); provenance |
| `rune-transfer` | 1 day of downtime, then extra days reduce cost | Craft vs the rune's level DC | GM Core p.225 | runs on the order machine with `craftType = "rune-transfer"` |

The item being repaired or affixed must be on the performer's actor, or in the strongbox earmarked to
the service. A party member hands it over through the system trade or the strongbox; the module does
not move other players' items without their client. The toolkit requirement is checked with the same
tool rule as G7 (6.5), except that a toolkit in the strongbox does not count: these are 10-minute
activities done with the kit in hand, so the performer takes it out first.

As built in M5: service records, custody and the formula-copy service are described in 10.11. As built in M5 on M4.1:
a formula copy's cost is paid from the source the requester picks (the party fund or a purse), and a cancel refunds it
to that source (10.11, As built in M5 on M4.1).

### 4.6 Ledger rows

Every movement of value is a row. Rows are append-only; corrections are new rows.

```text
rows.<id> = {
  id,              // 16-char hash of idem
  kind,            // table below
  idem,            // deterministic idempotency key
  box,             // signed int cp: change to the strongbox coin balance
  purse,           // signed int cp: change to `actor`'s purse
  alloc,           // signed int cp: change to the allocation of `order`, of `garden` (6.16.7), or of the party fund when both are null
  actor,           // actor UUID: the counterparty
  order, job, garden,  // optional links (garden: 6.16.7)
  day,             // workshop day (4.8), on `wage` rows: the day the wage pays for (6.10)
  items,           // optional [{uuid, name, qty, valueCp}] for material items
  author,          // user id that wrote the row
  at,              // {world, real}
  state,           // "pending" | "applied" (5.4)
  reverses,        // row id, for reversals
  source,          // "<moduleId>:<sourceId>" for extension rows
  note             // free text from the user (never machine-generated rules text)
}
```

| Kind | Coins move | `box` | `purse` | `alloc` | When |
|---|---|---|---|---|---|
| `pledge` | purse to strongbox | +n | −n | +n (order or garden) | a member funds an order or a garden (escrow) |
| `deposit` | purse to strongbox | +n | −n | +n (party fund) | a member funds the party fund |
| `allocate` | none | 0 | 0 | −n fund, +n order (two rows) | fund money assigned to an order |
| `withdraw` | strongbox to purse | −n | +n | −n | a contributor takes back an unspent, uncommitted share |
| `commit` | none | 0 | 0 | 0 | marks the up-front amount at start (`committed` derived from these) |
| `expend` | strongbox out | −n | 0 | −n | Craft success: up-front materials used |
| `release` | none | 0 | 0 | 0 | failure or cancel: committed amount becomes available again |
| `ruin` | strongbox out | −n | 0 | −n | critical failure: 10% of the committed amount |
| `remainder` | strongbox out | −n | 0 | −n | finishing payment |
| `refund` | strongbox to purse | −n | +n | −n | refund claim resolved (5.5) |
| `material-in`, `material-out` | items | 0 | 0 | ±value | earmarked material items enter or are consumed |
| `purchase` | purse or strongbox out | 0 or −n | −n or 0 | 0 or −n | formula buying, spellcasting services, spell costs (from the strongbox: −n on the allocation that held the coins, As built in M5 on M4.1) |
| `wage` | minted into purse | 0 | +n | 0 | Earn Income day (6.10) |
| `income` | minted | +n or 0 | 0 or +n | +n fund | extension `IncomeSource` (12.2) |
| `expense` | strongbox out | −n | 0 | −n fund | extension purchases |
| `plant` | strongbox out | −n | 0 | −n (garden) | a garden's seed cost is spent when it is planted (6.16.7); one row per contributor, pro rata |
| `delivered` | items: shelf to recipient | 0 | 0 | 0 | delivery claim resolved (5.5) |
| `carry` | none | net | net | net | archive summary per actor that replaces archived rows (5.3.3) |
| `adjust` | GM correction | ± | ± | ± | GM only |
| `reversal` | inverse of the target row | −target | −target | −target | see below |

- **Pro-rata splitting.** When an order or a garden spends money (`expend`, `ruin`, `remainder`,
  `plant`), the module writes one row per contributor in proportion to their remaining allocation.
  Rounding uses the largest-remainder method in whole copper; ties go to the earliest contribution.
- **Idempotency keys** are built from the operation, never from wall-clock time. Examples:
  `pledge:<orderId>:<actorId>:<nonce>` (the nonce is generated once when the user confirms),
  `expend:<orderId>:<attempt>:<seq>`, `day:<orderId>:<day>`, `wage:<jobId>:<day>:<seq>`,
  `refund:<orderId>:<actorId>:<transitionSeq>`, `plant:<gardenId>`. The row id is a hash of the key, so
  writing the same row twice is harmless; the coin movement is skipped when the row already exists
  (5.4). That check is only a fast path: two clients can both see the row missing, so every batch that
  moves coins starts with a lock operation (5.4).
- **Correction sequence.** A state-coupled row can be undone and written again (4.2.3): a settlement
  undone after a reroll conflict (6.12), a wage day corrected. Its lock page lives until the row is
  archived, so the corrected row needs a key of its own. `<seq>` is the number of rows with the same key
  stem (`expend:<orderId>:<attempt>`, `wage:<jobId>:<day>`) already reversed: 0 for the first write, one
  more after each undo. Every client derives it from the same rows, so two clients making the same
  payment still agree on one key, and a client that has not yet seen the undo loses the lock and re-plans
  from fresh data (5.4).
- **Author stamp.** `author` is the user who wrote the row. The UI shows "by <user>" on every row,
  and on behalf of which actor.
- **Reversal.** The author of a row, or a GM, can reverse purely financial rows (`pledge`, `deposit`,
  `allocate`, `withdraw`, `purchase`, `income`, `expense`, `adjust`). A reversal moves the coins back
  when that is still possible and writes a `reversal` row that points at the original; the original is
  marked `reversedBy`. State-coupled rows (`commit`, `expend`, `release`, `ruin`, `remainder`, `wage`)
  are reversed by undoing the transition that wrote them (4.2.3): the user who made it can undo their
  own last transition, and a GM can undo any.
- **As built in M1.** The rules engine describes the rows it would post as `{kind, cp}`, `cp` being the
  unsigned amount; the signed `box`, `purse` and `alloc` follow from the kind (table above). `commit` and
  `release` move nothing, yet the committed amount is derived from them (`committedFromRows`: commits less
  expends, releases and ruins), so stored rows carry `cp` as well (M2). Every derivation from `kind` and
  `cp` (`committedFromRows`, `expendedFromRows`, `daysPaid`, `wageSeq`) reads one reversal model,
  `liveRows` (`scripts/logic/core.mjs`): a `reversal` row and the row it reverses both drop out, and a row
  counts as reversed when it is marked `reversedBy` or a reversal names it in `reverses`, so either mark is
  enough. Sums of the signed `box`, `purse` and `alloc` give the same totals either way, since a reversal
  carries the inverse amounts. A reversal row is not itself reversible. `splitProRata`
  (`scripts/logic/split.mjs`) is the largest-remainder split; it never gives a contributor more than their
  allocation, and it throws when asked to split more than the allocations hold, so callers fund first.
  `allocationsByContributor` derives each contributor's remaining allocation from an order's (or a
  garden's) rows: the sum of `alloc` per `actor`, null for the party fund, ordered by first positive
  contribution (world time, then real time, then row id in code-point order); contributors with nothing
  left are omitted.
- **As built in M2** (`scripts/logic/rows.mjs`, `scripts/foundry/money.mjs`). `makeRow` turns a `{kind, cp}`
  row into the stored shape: the signed amounts of the table, `id` the hash of `idem`, `v: 1` and
  `state: "pending"`. Where the table leaves a sign open the caller says how: `allocate` takes `side`
  ("fund" is −n, "order" +n), `purchase` and `income` take `via` ("purse" or "box"); income paid into a purse
  allocates nothing (the table's "+n fund" can only hold for coins that reach the strongbox). `adjust` and
  `carry` carry explicit signed amounts. A spend split across contributors is one row per contributor
  keyed `<stem>:<actor UUID, or fund>` (for example `expend:<orderId>:<attempt>:<seq>:Actor.x`), and
  `seqFor(rows, stem)` counts the reversed rows whose key starts with `<stem>:` (those `liveRows` leaves out),
  so undoing a spend shared by two contributors raises the next `seq` by two; every client still derives the
  same key. Kinds that move nothing (`BOOKKEEPING_KINDS`: commit, release, allocate, adjust, carry) are written
  by one key-path write, already `applied`, without a lock page; every other kind moves coins or items
  (`material-in`, `material-out` and `delivered` record item movements, 4.1) and is written by a lock-first
  batch together with what it moves (5.4). A reversal is keyed `reversal:<row id>`. Every ordering of rows and
  claims by time uses one comparator, `compareRows` (`scripts/logic/core.mjs`), so clients cannot disagree.
- **As built in M4.** One more kind, `shelved` (0, 0, 0; items): a finished order's items put on the pickup shelf, keyed
  `shelve:<orderId>:<attempt>`, written by the finish's lock-first move with the `remainder` rows (4.7). `allocate` takes
  `back` as well as `side`, flipping the signs, for an allocation returned to the party fund (a cancelled order's share
  of a contributor whose actor is gone, 6.2.4). Reversals (`reverseRows`, `scripts/foundry/money.mjs`) move the coins
  back where the reversed rows moved them: out of or into the strongbox, and into or out of the one purse involved; a
  reversal of `expend` or `ruin` mints the spent coins back into the strongbox (an undone settlement). Reversals of rows
  that moved nothing are one key-path write, already applied. The Funds tab offers a reversal (`canReverse`,
  `scripts/logic/views.mjs`) of an applied financial row that still counts, to its author or a GM (an `adjust` to a GM
  only), when the purse is the reverser's to write, a pledge's order is open and keeps what it has committed, and the
  contributor (or the fund) still holds the amount.
- **As built in M4.1** (fund accounting, DECISIONS.md 2026-10-26; `scripts/logic/funds.mjs`, `scripts/foundry/funds.mjs`).
  "Fund this order" takes a source. From the party fund it is a pair of `allocate` rows with the fund as the source
  (`actor` null on both): the fund's side (-n) and the order's (+n), keyed `earmark:<orderId>:<nonce>:fund|order`; no coins
  move, since they are in the strongbox already. Giving an order's fund share back is the same pair with `back`
  (`unearmark:...`), up to what the order has not committed, or all of it on a closed order (`fundReturnableCp`: only an
  earmark that landed after the close leaves fund money there). From a purse it is the `pledge` of M2. Any member may
  earmark or give back (the cooperative trust model of 2026-10-25); the rows' `author` records who. Every write that takes
  money out of the unallocated fund takes the **fund slot**, a lock page keyed `fund-slot:<n>` (`fundSlotLockId`), `n`
  the number of fund rows with `alloc` below 0 so far (reversed or not, rows being append-only): earmarking, a withdrawal
  from the fund (`payout` and `withdraw` take `locks`) and the reversal of a deposit. Two of them planned from the same
  copy of the ledger name the same page, so only the first lands and the other is refused ("taken") with nothing written;
  money coming in takes no slot and does not move it. Money that leaves an order outside a transition (a give-back of the
  fund's share, a member's `withdraw`, the reversal of a pledge) takes the order's **return slot**
  (`fund-return-slot:<orderId>:<seq>:<k>`, `returnSlotLockId`, `seq` the order's last log entry, `k` the order's rows
  with `alloc` below 0 so far), and so does every transition that moves the order's money (start, retry, settle,
  finish, cancel), next to its log slot. Of a give-back or take-back and a transition planned from the same copy only
  the first lands: before this (review of M4.1) a give-back and a cancel or finish both returned the fund's share, a
  give-back or a withdrawal landing with a start left the escrow below the commit (the order then stuck in `rolled`),
  and one landing with a settlement split the spend over stale allocations. Every transition moves `seq` and every
  take-off adds a row, so taking the page never blocks a later one. Spending needed nothing new: the
  pro-rata splitter already treats the fund (`actor` null) as a contributor, so `expend`, `ruin` and `remainder` deduct
  from each source's share, and a cancel's or finish's refunds return the fund's share to the fund (`allocate` with
  `back`, M4) and a member's as a refund claim. A finish whose earmarked money falls short first draws the rest from a
  source the user picks (`finishOrder`: an earmark or a pledge of at least the shortfall, then `finish`; two writes, so a
  draw whose finish is then refused stays earmarked for the order); a retry after a critical failure ruined some of the
  materials does the same (`retryOrder`). The Funds ledger lists one row per allocation pair
  (the fund's side is its order's mirror, `rowLabel`) and names it by direction ("Earmarked from the party fund", "Given
  back to the party fund"); a `shelved` row of an order for the strongbox reads "Put in the strongbox", and item rows show
  no amount.
- **As built in M5 on M4.1** (`purchaseInputs`, `scripts/logic/funds.mjs`; `payPurchase`, `scripts/foundry/purchases.mjs`).
  Every `purchase` (a formula bought, a casting bought, a spell's cost, a formula copy) is paid from a source the user
  picks, as "Fund this order" is. From a purse it is the M2 row (`via: "purse"`). From the party fund the coins leave the
  strongbox, and `purchase` with `via: "box"` now takes them out of the allocation that held them (−n `alloc`, the table
  above; it was 0, which nothing wrote yet), so the strongbox stays the unallocated fund plus what is earmarked (4.7).
  With no order the row is the fund's own (`actor` null, `order` null) and takes the fund slot. For an order (a casting,
  a spell's cost) it is the earmark and the spend in one lock-first move: the `allocate` pair (keyed
  `earmark:<orderId>:<hash of the purchase key>:fund|order`) and the purchase from the order's party-fund share, the
  purchase row first; it takes the fund slot and the order's return slot, so neither an earmark or a withdrawal of the
  same unallocated money nor a cancel or give-back of the same order can land with it. The order then lists the
  purchase as spent by the party fund (`purchase` joins `SPEND_KINDS`) and holds nothing more than before. Any member may
  pay from the party fund, as any member may earmark it; refusals are `fund-short` (with what the fund holds), and the
  coin move's `taken` or `conflict`. The record the purchase pays for (the formula claim, the casting, the service) is
  written in the same move, so a refused payment records nothing.

### 4.7 Strongbox and pickup shelf

- **The strongbox** is a pf2e `loot` actor (sheet type "Loot") created by the module and then given
  default ownership OWNER by a follow-up update, because pf2e forces every new loot actor to LIMITED
  (5.2). It holds escrowed coins (ordinary pf2e coin items, often in many small stacks, 5.4), material
  items earmarked to orders, and shelf items. Loot actors never process rule elements (pf2e
  `LootPF2e`), so their data preparation is cheap (verified). It is never placed on a scene (OQ-4).
- **Shelf items** carry `flags.MOD.shelf = {for: actorUuid, from: actorUuid, order, claimKey, at}`.
  The recipient's responsible client claims them (5.5).
- **Earmarked materials** carry `flags.MOD.earmark = {order, line, by}` and are counted at their Price
  (raw materials have full value, Player Core p.267).
- **Reconciliation.** Expected coin balance is the sum of `box` over all rows. The Funds tab compares
  it with the strongbox's actual coins (summed over every coin stack, however the loot sheet groups
  them) and shows any difference, for example after someone dragged coins in by hand. A GM can book the
  difference as an `adjust` row. Reconciliation also lists rows still `pending` (5.4), and re-creates a
  delivered item from the row's source snapshot when a pending `delivered` row has no matching item on
  the recipient (5.5).
- **Alternative.** If every player already owns the pf2e Party actor, a world setting can use its stash
  as the strongbox instead (pf2e #12645 confirms the stash needs Owner).
- **As built in M2** (`scripts/logic/reconcile.mjs`, `scripts/foundry/reconcile.mjs`, `claims.mjs`). The
  report gives expected and actual coins, their difference, the pending rows, `stalled`: those pending
  longer than `PENDING_GRACE_MS` (60 s, by the server's clock, 4.1), since a younger one may belong to a batch
  still in flight on another client, and `lockedStacks`: strongbox coin stacks a move locked to spend but that
  are still there (it stopped part-way); no move plans with them again (5.4), so a GM resolves them. Every pending
  row is in exactly one of three states (`pendingState`, 5.4 As built: Closing by hand): `inFlight`, which a request
  may be applying right now (every row younger than the grace time is); `resumable`, which the module finishes by
  itself (a coin move a connected user's client may resume, a delivery one re-creates); and `needsHand`, for their
  author or a GM to close. A GM's `adjust` row books the difference into the strongbox and the party fund; its key
  comes from the state it corrects (the expected and actual coins and the ids of every row, `adjustNonce`), so two
  GMs, or a double click, booking the same difference write one row. A close and an adjust act only on rows that
  need a hand: the in-flight and resumable rows are still owed by their own move, so a close of one is refused and the
  adjust leaves their coins out of the difference (`owedBoxCp`) and their marks alone; for a row that needs a hand,
  either takes the mark a late request would take, so only one of them lands. Each user hears once per session about
  their own rows that need a hand, as soon as they do. A stalled `delivered` row is finished by the recipient's
  responsible client: settled if the item (flagged `flags.MOD.delivered.row`) arrived, otherwise re-created from the
  snapshot in the row (`items[0].source`), with the shelf item deleted in the same move if it is still there. The
  delivery's own lock pages exist, so the re-creation locks `recreate:<row id>` (hashed), and happens once; a close
  of the row by hand, once it needs a hand, takes the same lock, so the two never both land. The Party-stash
  alternative is not built yet: the party's own coins would share the stash with the Workshop's, which changes what
  reconciliation compares, so it comes with the Funds tab (M4).
- **As built in M4.** Finishing an order puts its item (the compendium item, `system.quantity` the order's quantity) in
  the strongbox in the apply request of the finish's coin move, flagged `flags.MOD.crafted = {order, attempt, crafter}`
  and, for an actor recipient, `shelf = {for, from, order, claimKey: deliver:<orderId>:<attempt>, at}`; the move is
  resumable like every coin move, so a lost apply request shelves the item once. Every finished item goes through the
  shelf, even for a recipient the crafter's user owns, so there is one delivery path (5.5); an order for the strongbox
  leaves its item there with no shelf flag. The header shows the shelf count for the user's characters with "Take it",
  which runs the claim sweep for the tab now (auto-claim on or off). The party-stash alternative is still not built
  (follow-up, 10.10).
- **As built in M4.1.** Fund accounting (`fundAccounts`): the coins the ledger expects (the sum of `box`) are the
  unallocated fund (the sum of the fund rows' `alloc`) plus what is earmarked for orders (and gardens), since every kind
  M4 writes moves `box` and `alloc` together. The Funds tab states it ("Strongbox 18 gp = party fund, unallocated 16 gp +
  earmarked for orders 2 gp"); when the coins counted differ, it says the ledger's side of it to everyone and the
  difference to a GM, whose reconciliation books it as before. Per order it lists the money earmarked by source (the
  party fund or a member) and what the order spent; a closed order still holding money is listed as waiting for its
  refunds. Where a finished item went (`deliveryOf`): delivered (a `delivered` row that applied, naming the recipient),
  arriving (a delivery under way, or the shelf item not here yet), on the shelf, or kept in the strongbox.
- **As built in M5 on M4.1.** Earmarked material stock (`orders.<id>.materials`, 6.6) is items, so it stays outside the
  identity, but the accounts list it beside the money: per open order, the stock by who handed it over at Price
  (`stockBySource`; an order holding only stock is listed too), shown in the Funds tab's "By order" sources and in the
  order detail's "Earmarked for this order" as "<member> (precious stock)". What an order still needs (`shortfallOf`,
  "Fill the shortfall") is the up-front half less its stock, before the start and for a retry, as the start's and the
  retry's coin commit already were (M5); handed back on a cancel, stock returns to the member it came from.

### 4.8 Downtime: workshop days, per-PC status and day records

- **Workshop day.** `day = max(clockDay, manualDay)`.
  - `clockDay = floor((worldTime + offset) / secondsPerDay)`. `secondsPerDay` comes from
    `game.time.calendar.days` (`hoursPerDay × minutesPerHour × secondsPerMinute`, 86,400 with the core
    calendar). `offset` puts the day boundary at midnight of the date the table sees. In a world with no
    calendar module, where the pf2e World Clock is the display (`game.pf2e.worldClock`, available after
    `ready`), its date is `worldCreatedOn` plus `worldTime`, and `worldCreatedOn` was captured at an
    arbitrary time of day; `offset` is then the seconds since midnight of `worldCreatedOn` (verified,
    pf2e `apps/world-clock/app.ts`). Otherwise the boundary comes from
    `game.time.calendar.timeToComponents(worldTime)`. The offset is frozen in `meta.dayOffset` the first
    time it is computed, so every client agrees.
  - `manualDay` is the highest `toDay` among the `meta.manual.<runId> = {fromDay, toDay, by, at}`
    records the Advance days wizard writes when it logs days without moving the clock (9.2). Only GMs
    and assistant GMs can move the clock, so this is how a session with no GM moves days on.
  - Taking the maximum, not the sum, means a clock advance that lands inside days already logged adds
    nothing, and one past them accrues normally. The Downtime tab shows when logged days run ahead of the
    calendar ("N days logged ahead") and offers a GM "advance clock to match".
  - Days are only ever counted forward; if the clock is set back, nothing is undone and the Downtime tab
    shows a warning.
- **Per-PC downtime status** (`pcs.<actorId>`), readable by every member because players usually cannot
  see each other's character sheets:

  | Field | Notes |
  |---|---|
  | `inDowntime` | only PCs flagged in downtime accrue days |
  | `activity` | `{kind: "craft" \| "help" \| "earn" \| "formula" \| "subsist" \| "retrain" \| "prep-only" \| "other" \| "ext", ref}` |
  | `standingRoutine` | whether daily preparations repeat each downtime day (7.2) |
  | `lockedBy` | order id when the PC is a Communal Crafting helper or a tattoo or graft subject |
  | `prepCycle` | counter incremented when the PC actually makes daily preparations: a Rest for the Night (the system treats it as including preparations) unless the PC is in downtime and chose not to prepare, the pf2e-dailies flow, or a standing routine on a downtime day (7.2, 7.7). Written only by the PC's responsible client |

  `resolvedThrough` is derived, not stored: the highest `toDay` among the PC's day records. Pending
  days are derived too: `pending = day − resolvedThrough` while `inDowntime`. Time passing therefore
  needs no write at all; only resolution writes. Turning `inDowntime` off with days pending asks the
  owner to resolve them or mark them "not downtime" (one day record covering the span, without effects).
- **As built in M9**: activity `subject` (a ref kind): the days a tattoo's or graft's subject sits for it, `{order, result:
  "subject"}`; the subject is locked as a helper is (6.14, 10.16).
- **As built in M10**: activity `ext` is a ref kind, `{kind: "ext", ref: <activity id>, aid?: <actor id>}`; its day records
  carry `ext: {run, n, of, from}`, and a run's last day `extRows` (the rows it owes) and `extNotes` (12.6).
- **Day records** (`days.<actorId>-<day>`, keyed by the record's first day):
  `{actor, day, toDay, activity, order?, attempt?, kind?: "setup" | "extra" | "setup-hours" | "season",
  hours?, rushed?, crafterCp?, helpers?: {[actorId]: cp}, afflictionSaves?: [ids], result, rows: [rowIds],
  by, at}` (`setup-hours`, `season` and `rushed` belong to the variants in 6.16; `afflictionSaves` lists
  saves due on a logged day, 8.10.7). One per PC per resolved day; a span with nothing to record (for
  example "not downtime") is one record with `toDay` set.
- **Variant records** (`days.<actorId>-<day>-<orderId>`, the same shape) are for an order other than the
  one the day record is about, so they never overwrite it: a `setup-hours` record made on an
  adventuring day or a day spent on another activity (6.16.1), a `season` record for an untended Grow
  order (6.16.6), and a Deconstruct follow-on's setup credit (6.16.5). They do not count toward
  `resolvedThrough`. Order totals (setup days done, extra days, reductions, last day worked) are sums
  and maxima over day and variant records for the order's current attempt (4.2.1). Old records are
  archived (5.3.3).
- **As built in M4** (M6 builds the clock accrual, the day resolver and the wizard): a crafter's owner logs one day of
  work on an order with "Work a day" (`workDay`), which writes the crafter's day record (`days.<actorId>-<day>`, kind
  `setup` or `extra`, `workDayRecord`) for the clock's whole day (`floor(worldTime / secondsPerDay)`, without the 4.8
  offset yet) or the day after the crafter's last record, whichever is later, so days can be logged ahead of the clock
  as the wizard does. A setup day that completes the setup moves the order to `check` in the same write (4.2.3); an
  order in `rolled` is settled first, as the order's next day settles it (4.2.3), and the day then counts as an extra
  day. The record is deterministic, so a day written twice is one record.

- **As built in M6** (`scripts/logic/downtime.mjs`, `scripts/foundry/downtime.mjs`; 10.12):
  - *The workshop day* is `today()`: `clockDay = floor((worldTime + offset) / secondsPerDay)` and the highest `toDay` of
    `meta.manual`. The offset is pf2e's World Clock's (seconds since midnight UTC of `worldCreatedOn`) unless a calendar
    module is active (Calendaria, Simple Calendar, Simple Calendar Reborn, Seasons & Stars, Simple Timekeeping), then the
    calendar's own time of day at world time 0 (`timeToComponents(0)`); any client that may write freezes it in
    `meta.dayOffset` when its status turns ready. The elected client (5.6) keeps `meta.clockHigh`, the highest clock day
    seen, so the Downtime tab can say the clock was set back (nothing is undone).
  - *Days.* The workshop day is the latest day that has happened. A PC that goes into downtime on day D
    (`pcs.<id>.since = D`, written by its owner) has days D+1 onwards; a day is pending from when the workshop day reaches
    it until a day record covers it (`pendingDays`: from `max(since, resolvedThrough) + 1` to the workshop day). So a
    clock advanced one day, or the wizard advancing one day, gives each PC in downtime one pending day. A PC not in
    downtime has no pending days; its next day (an order's "Work a day") is the day after today or after its last record.
  - *Status* records are `{id, v, inDowntime, since, activity, lockedBy, by, at}` (`standingRoutine` and `prepCycle` are
    M7's). Taking a PC out of downtime with days pending is refused (`days-pending`) unless the owner counts them as not
    downtime: one record covering the span, `result: "not-downtime"`, `activity: null`. A Communal Crafting helper stays
    in downtime until they leave the order (`helping`, 6.7).
  - *Day records* are written by `planDays`, one per PC and day, keyed `<actorId>-<day>`: a craft day is the order's setup
    or extra day (`workDayRecord`, as M4; never a day of an order in `rolled`, which stops at `settle`, and no setup day
    past the setup's count, which stops at `check`), a help day `{order, result: "help"}`, an earn day `{job, wageCp, rows: [wage
    row id]}`, any other activity just the day. A PC's days are written in one request behind the lock page
    `days:<actorId>:<first day>` (hashed), so of two resolutions planned from the same copy (two devices, the owner and a
    wizard runner) only the first lands and the other is refused (`taken`); the M4 follow-up "one user on two devices
    working two orders in the same instant writes the same day key twice" is closed by it.
- **When days accrue** (9.1, As built in M6): `updateWorldTime` when the clock's day changed (not every combat round or
  tick of a running clock, review fix) and ledger changes to `pcs`, `days` or `meta.manual` schedule a check (one second
  after the first of them, so a clock advance and the wizard's writes settle; a check already due is not put off again); each member PC with pending
  days whose responsible client this is (5.6) gets one notification per workshop day on that client
  (`Downtime.Prompt`), and the Downtime tab's button a badge (the user's own characters with pending days). An owner who
  was offline is told when their client's status turns ready.

### 4.9 Earn Income jobs

`jobs.<id> = {actor, skill, taskLevel, settlement, dc, startDay, lengthDays?, check: {degree, unadjusted,
messageId, level, rank}, perDayCp, status: "open" | "ended" | "fired"}`. Days paid are derived from the
job's `wage` rows, never stored as a counter. `settlement` is the settlement profile the job was taken
in. Rules in 6.10.

As built in M6 (`scripts/logic/jobs.mjs`, `scripts/foundry/jobs.mjs`): a job also carries `round` (its check's round, 1
at start: rolling again after a level or rank change opens round 2, 6.10), `unconfirmed` (taken with no settlement set,
OQ-17), `shortened` and `log` (`{seq, event, prev, by, at}`, as an order's: start, reroll, end, undo, each behind the lock
page of its slot `job-log:<id>:<seq>`). `startDay` is the earner's next open day. `lengthDays` stays null (not used).

### 4.10 Roster snapshots

Players normally have no permission on each other's characters, yet the queue must show which crafter
can make what and which helpers qualify. Each PC's responsible client therefore publishes a summary to
`roster.<actorId>` whenever the actor changes (debounced):

`{name, img, level, size, crafting: {rank}, skills: {slug: rank}, feats: [registry slugs held],
formulas: [uuids], abilities: [{slug, maxSlots, maxItemLevel, resource}], vials: {value, max},
investiture: {value, max}, consumables: {[family]: {qty, soonestExpiry}}, updatedAt, by}`.

Only registry-relevant feats and skills are published; `consumables` summarises the PC's consumables
by family for the party view of "Use best consumable" (8.9). When pf2e's `metagame.partyStats` setting
(Show Party-Member Stats) is off, other members' ranks, helper ranks and roster skill data are not
rendered for players (the data is still in the shared document; this is a display rule in a
cooperative trust model). The snapshots are published as described here; the author accepted that
trade-off. Orders, funding and progress bars are always shown to every member.

As built in M2 (`scripts/logic/roster.mjs`, `scripts/foundry/roster.mjs`): the snapshot also carries `id` and
`v`, and its lists are sorted, so the same character always gives the same snapshot. It is written whole
with `_replace` (a merge would keep keys that disappeared), one second after the last change to the actor
or its items, and not at all when only `updatedAt` and `by` would change. Skills are every skill the
character is trained in or better, since Earn Income may use any; feats are those whose slug is in `FEAT`
(`scripts/logic/core.mjs`) until the registry (M3) names them, a choice feat by its base slug;
`consumables` stays empty until M8. Members follow the `members` setting (14.1). Snapshots of characters
that stop being members are not removed yet. As built in M3: `feats` lists the registry keys of the character's feats and
features (`featKeysOf`), a choice feat as `<key>:<choice>` (`specialty-crafting:artistry`, which G4 reads). As built in M8:
`consumables` holds the character's consumables (consumables, and weapons with the consumable trait such as bombs) by family
(`familyKey` of the compendium source's name), `{qty, soonestExpiry}` with the earliest world-time deadline (`at`) of the
family's stamped items, inert items left out (`familySummary`, 8.9).

### 4.11 Daily loadouts and standing orders

- **Loadout** (PC actor flags, owner only): `loadouts.<id> = {name, pools: {<abilitySlug>: [{family,
  qty, uuid?}]}, talismanHosts: {<family>: hostItemId}, vialMaterials?}`. Loadouts store families, not
  exact items, so they resolve to the best grade the pool allows on the day (7.5).
- **Standing order** (shared): `standing.<id> = {requester, crafter, family, qty, recipient, pool,
  active, fromDay, untilDay?}`. A recurring request ("two healing elixirs every morning") that the
  crafter's Morning tab pre-fills (7.6).

### 4.12 Expiry stamps

Items the module creates or that the system creates through a crafting ability get:
`flags.MOD.expiry = {creator: actorUuid, cycle, rule: "prep" | "turn-start" | "turn-end" | "world",
at?, exempt?}`, and `flags.MOD.inert = true` once expired. `cycle` is the creator's daily-preparation
counter (`pcs.<actorId>.prepCycle`). On a `prep` stamp, `at` (world seconds) and `atDay` (workshop day,
for days logged without moving the clock, 4.8) are further deadlines: the item becomes inert at
whichever comes first, one of those or the creator's next cycle. One stamp covers
one item document, so a new output never shares a stack with a differently stamped one (7.1). Rules in
7.7 and 8.8. A coating (8.10.5) copies the stamp of the poison it was made from, so an infused coating
is voided with its poison (the coating is removed; the coated weapon is never marked inert);
garden produce (6.16.7) gets a `world` stamp ending with the harvest day. As built in M9: a fulu gets a `world` stamp
`{creator, cycle: null, rule: "world", fulu: true, at, atDay}` a year (365 days) after it is made; the `world` rule reads `atDay`
against the days logged ahead of the clock as the `prep` rule does (10.16).

### 4.13 Formula provenance

`formulas.<actorId>.<hash> = {uuid, route, source, day, rowId?, orderId?, by}`. Routes: `granted`
(feature or level-up pick), `bought`, `copied-npc`, `copied-ally`, `invented`, `reverse-engineered`,
`looted`, `family` (written on demand, 6.4, 7.5), `virtual` (not written since M7: virtual talismans stay out of the book,
7.4), `unrecorded` (already
in the book when the module was enabled). The system list itself only ever receives plain `{uuid}`
entries.

As built in M5: provenance records, the formula claim that writes them and the Codex are described in 10.11.

### 4.14 Schema version and migrations

- Each shared document carries `flags.MOD.schema` (integer), the only schema marker; there is no world
  setting for it, so a migration run by a player can finish. Each row type carries `v`.
- Migrations are pure functions `migrateN(data) → data`, unit tested, run in order.
- The migrating client is the active GM if one is connected, otherwise the lowest-id active user (ids
  compared with `String#compare`, 5.6). It writes a lock (`meta.migration = {to, by, at}`) first; other
  clients wait and re-read.
- A client whose module version is older than a document's schema opens read-only with a banner.
- Actor-flag data (loadouts, expiry stamps) is upgraded lazily on read and rewritten by its owner on
  the next write.

As built in M2 (`scripts/logic/migrations.mjs`, `scripts/foundry/migrate.mjs`): `SCHEMA_VERSION` is 1 and
`migrate1` changes nothing; a document without `schema` reads as 0. A migration gets the document's whole
`flags.MOD` and returns the new object; the difference is written leaf by leaf (`keyPathDiff`), never the
object whole (P3). Both shared documents carry `schema` and both are migrated. The lock is a lock page
`migration:<to>` (hashed to an id) created with `keepId`, so the server lets only one client have it;
`meta.migration` is then written as the visible marker and deleted at the end. A lock whose holder has
disconnected and that is older than five minutes is broken and taken again. The elected client must also
hold its user's lease (5.6). Waiting clients are `migrating` and re-check on every ledger change, when a user
connects or disconnects (the migrating client may be the one that left), and every minute
(`MIGRATION_RECHECK_MS`), so a lock left by a client that died is broken once it is five minutes old by the
server's clock (4.1), even if nothing else changes, and even when it was taken in an earlier launch of the world. A client whose code is older is `newer` (read-only), and
says so once per session (`scripts/foundry/state.mjs`, `sync.mjs`).

---

## 5. Storage, permissions and sync

### 5.1 Which document holds what

| Store | Scope | Holds | Who can write |
|---|---|---|---|
| World settings | world | feature toggles, rules-gap settings, settlement profiles, ids of the shared documents | GM and assistant GMs (`SETTINGS_MODIFY`) |
| **Workshop ledger** | a JournalEntry created by the module, default ownership OWNER, in a "module data" folder | `meta` (current settlement, manual day log, day offset, archive and migration locks), `orders`, `services`, `rows`, `claims`, `pcs`, `days`, `jobs`, `roster`, `formulas`, `standing`, `gardens`, `afflictionDefs`, `extRuns`, `spends`, `incomes`; and, beside the module's own flags, each extension's store under its own module id (As built in M10, 12.4) | every player |
| Ledger archive pages | JournalEntryPages inside the ledger | archived orders, rows and day records as flags | every player (page creation needs OWNER of the parent journal, which players have) |
| Lock pages | JournalEntryPages inside the ledger, `_id` = the id of what they lock (a row, a strongbox item, a purse coin stack at one version, a coin move's apply request, a lost delivery's re-creation) | the lock stamp (`lock`); on a coin move's first row, also the move itself (`move`), for a resume (5.4, As built: Resume); and a lock page may carry `hand: {kind, row}`: an apply mark or re-creation lock taken by a close by hand (`kind` "close", `row` the row closed) or a GM's adjust ("adjust", `row` the adjust row) for a row that needed a hand, so reconciliation knows no request is behind it (5.4, As built: Closing by hand); their existence is the lock | every player |
| **Strongbox** | a pf2e `loot` Actor created by the module, then updated to default ownership OWNER (5.2) | escrowed coins, earmarked materials, shelf items | every player |
| PC actor flags | each character | loadouts, per-character preferences | the PC's owner |
| Item flags | items | expiry stamps, inert marks, DC stamps, affix records, crafted-by stamp, coatings, affliction run state, components, gift bindings | the item's owner |
| User settings | user | notification level, auto-claim, last tab | that user |
| Client settings | client | window size, Parchment style | that browser |
| Chat messages | | cards only, never authoritative | their author |
| pf2e system data | characters | `system.crafting.formulas` (plain `{uuid}` appends), prepared formulas via `CraftingAbility` methods, coin and item documents | the owner, through system APIs |

### 5.2 Creating the shared documents

- Creating actors needs `ACTOR_CREATE` (default role Assistant) and creating journals needs
  `JOURNAL_CREATE` (default role Trusted), so players cannot create the shared documents themselves.
  Verified in Foundry v14 `common/constants.mjs`.
- The documents are created by the active GM's client when the GM turns on the master switch. Turning
  it on is a GM action, so a GM is always connected at that moment. This is the "first enabled" moment
  of `DECISIONS.md`: activating the module in a world writes nothing until then (P10).
- **Strongbox ownership.** pf2e's `ActorPF2e.createDocuments` sets `ownership.default` to LIMITED for
  every new loot actor, whatever the caller passes (verified, pf2e `actor/base.ts`). Foundry's server
  needs OWNER to update an actor and to create or delete its items, and pf2e's `LootPF2e.canUserModify`
  lets LIMITED users update only on the client, so a LIMITED strongbox would show players working
  controls that then fail on the server. The GM client therefore creates the strongbox and immediately
  calls `strongbox.update({"ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER})`; pf2e's
  override runs only at creation, so the update stands. Once per session the active GM's client checks that
  the default is still OWNER and repairs it if not, telling the GM. Until then, a non-OWNER strongbox counts
  as "shared documents missing" (the read-only banner below). Re-creation follows the same steps, and a harness
  assertion covers it (15.3).
- Creation writes `flags.MOD.role = "ledger"` or `"strongbox"` and stores both ids in a world setting.
  Clients find the documents by id, falling back to the role flag. If two exist (for example two GMs
  racing), the oldest by `_stats.createdTime` is used and the GM gets a merge prompt.
- **Before the documents exist** (for example after they were deleted, or in a world copied without
  them): the Workshop window opens read-only with a banner saying a GM needs to log in once. Actor-local features still
  work: the Morning tab, Quick Alchemy, the formula codex view. Nothing is queued locally; there is no
  outbox.
- Deletion guard: a `preDeleteJournalEntry` / `preDeleteActor` hook on every client cancels deletion of
  a shared document by a non-GM and explains why. A GM deleting one gets a confirmation that offers the
  purge flow (5.9) instead.
- **As built in M2** (`scripts/foundry/shared-docs.mjs`, `guards.mjs`, `sync.mjs`). Only the active GM's tab
  holding its user's lease creates the documents, whichever GM turned the switch on: a world setting's
  `onChange` runs on every client, and every client then re-checks, so the toggling GM (an assistant, or the
  higher-id of two GMs) and the active GM would otherwise both create them. On that client a second call while
  one is creating waits for it. Without Web Locks (plain http) every tab of the active GM holds the lease, so
  two of its tabs can still create two copies; the oldest-wins rule and the duplicate warning below cover that.
  The documents get random ids: a fixed id would stop re-creation after a purge that kept the strongbox as an
  ordinary loot actor. With the switch off a GM's `ready` writes nothing. Ownership is repaired once per session
  (and at creation), not on every check, so a GM who restricts a document on purpose is not overruled
  within the second; per-user entries are left alone. A client whose own user has less than OWNER on either
  document (a GM can set that per player, and Foundry reads the user's entry before the default) also counts as
  "missing" and only reads, since the server would refuse its writes. "Ready" is checked again whenever the status
  is read (`state.mjs`): once a document in use is deleted, or this user loses OWNER on one, the client is "missing"
  at once, and the deletion hook also drops the deleted document before the re-check 250 ms later. As built (live
  harness): without both, a player's client stayed "ready" on a strongbox a GM had just deleted and re-created, and
  a pledge sent then wrote its lock and a pending row before the server refused the rest; and without a canvas a
  player's client never hears that its ownership of an actor changed, since core's `Actor#_onUpdate` throws in
  `canvas.tokens.cycleTokens` before any `updateActor` hook (Foundry 14.368 `client/documents/actor.mjs`), although
  its copy of the actor has the new ownership. The ledger goes in
  a JournalEntry folder flagged `role: "folder"`; the strongbox stays at the root of the actors directory.
  Clients look the documents up by role flag, oldest first (`_stats.createdTime`, then id), so a two-GM race
  resolves the same way on every client; the active GM keeps the `docs` setting in step as the record of
  the ids. Each GM hears about a duplicate once per session; merging is by hand for now. "Missing" is a
  client status that the Workshop window (M4) shows as the banner. The guards also cover the ledger's pages
  (lock and archive pages), which only the module deletes; its own deletions pass
  `{"pf2e-artisans-workshop": {internal: true}}` in the operation options. A GM's confirmation offers the
  purge, deleting just that document, or cancelling.

### 5.3 Partial updates and concurrency

#### 5.3.1 The write rule

All writes are key-path updates, for example
`ledger.update({"flags.MOD.orders.<id>.status": "setup", "flags.MOD.orders.<id>.statusAt": at})`.
The server applies each update to the current stored document, so two clients writing different keys
at the same moment both succeed. Collections are always objects keyed by id; arrays are used only for
small values that are written once (trait snapshots). Deletion uses `_del` (`ForcedDeletion`);
the deprecated `-=` and `==` keys are banned by lint.

Key-path merges protect flags only. Foundry v14 has no increment operator (the only data operators are
`ForcedDeletion` and `ForcedReplacement`), so a number written by key path, including an item
quantity, is an absolute value computed from the writer's local copy. Two clients adding to the same
number lose one of the additions. The module therefore never stores a running total in shared data:
totals are derived from keyed records (4.2.1, 4.8), and strongbox coins follow the create-only rule in
5.4.

As built in M2 (`scripts/logic/keypath.mjs`, `scripts/foundry/store.mjs`): the store is `read(path)`,
`records(collection)` (live records only), `exists(path)` and `write({set, replace, del})`; `extStore(moduleId)`
is the extension store of 12.4 over it. A path starts with a known ledger key and reaches at least a record:
`rows.<id>`, `meta.<key>`, `meta.manual.<runId>`, `formulas.<actorId>.<hash>`, `ext.<moduleId>.<key>`. As built in M10:
`ext` is gone (an extension's store is its own flag scope on the ledger, written by `write({scopes: {[moduleId]: {set,
replace, del}}})` in the same update as the Workshop's keys, `scopeUpdate` and `checkScopePath` in `keypath.mjs`), and
`extRuns.<id>` and `spends.<id>` join the known keys (12.6), and `incomes.<id>` after the M10 review.
Segments are letters, digits, `_` and `-`, so the `-=` and `==` keys cannot be written either. `replace`
uses Foundry's `_replace` (no merge) and `del` uses `_del`. Writes go out with `diff: false`: otherwise the
client drops a `_del` for a key its own copy lacks, and any key whose value it already holds (`diffObject`,
Foundry 14.368 `common/utils/helpers.mjs`), while the server merges whatever it receives into its own
current copy (`ObjectField#_updateDiff`, `common/data/fields.mjs`). A write is refused unless the client's
status is "ready" (5.2, 4.14) and it is not stale (5.4).

#### 5.3.2 Same-key collisions

Two clients writing the same key is last-write-wins. Field ownership (4.2.4) and per-contributor rows
make that rare; where it can still happen (two users editing an order note), the UI re-reads before
saving and warns if the value changed underneath.

#### 5.3.3 Keeping the document small

Completed and cancelled orders older than the archive age (default 30 workshop days), their rows and
day records older than 60 days move to an archive page per world year. Balances are carried forward as
one `carry` summary per actor. The thresholds are tuned in testing (OQ-36).

Archiving is a timer-driven write, so it follows P4:

- Only the elected archiver runs it: the active GM, otherwise the lowest-id active user (as in 4.14).
  It holds `meta.archive = {by, at}` while it works; another client that sees a fresh lock does not
  start.
- Ids are deterministic: the page `archive:<year>` (hashed to a document id) and carry rows
  `carry:<actorId>:<throughDay>`, so a repeated or concurrent run writes the same records.
- One `modifyBatch`, in this order: create or update the page and the carry rows first, `_del` the live
  keys last. A batch that stops early leaves the live records in place, and the next run repeats it.
- On read, live records that lack `id` or `v` are discarded. They are stubs that a late key-path write
  re-created after the archive deleted the record (for example a `reversedBy` on an archived row).
- A reversal of an archived row writes to the archive page, not to the live key.
- Lock pages (5.4) whose rows are archived are deleted in the same batch, apply marks included.

As built in M2: archiving is not built yet. It needs the order lifecycle (M4) and the workshop day (M6) to
know what is old; when it comes it also prunes the stack lock pages of 5.4 (strongbox stacks that are gone,
purse stack versions that have moved on).

### 5.4 Moving coins safely

pf2e's `inventory.addCurrency` and `removeCurrency` each make their own writes, so they cannot be part
of a batch (verified). The module therefore plans coin changes itself.

**What `modifyBatch` guarantees** (verified, Foundry 14.368 server, settling OQ-1). It is not
transactional. The server first dry-runs every operation and aborts the whole batch if any of them
fails. It then applies the operations one at a time, each under its collection's database semaphore,
and stops at the first error without rolling back the earlier ones. Other users' requests can land
between the dry run and the real pass, and between operations. On the client, a failed operation only
raises a notification, and the call returns partial results. Per-document hooks do fire for batched
results.

1. **Coin planner.** A pure planner mirrors pf2e's change-making (remove exact denominations, then
   convert, then break larger coins) using the four pf2e coin items in `pf2e.equipment-srd` (resolved
   once at `ready`). Strongbox coins are **create-only**, because any member writes them:
   - a pledge or deposit creates new coin items in the strongbox, flagged `flags.MOD.lot = {row}`;
   - spending (expend, ruin, remainder, refund, withdraw) deletes whole strongbox coin items, ahead of
     the batch's creations, and creates any change as new items;
   - the planner never updates an existing strongbox coin quantity, and reconciliation tolerates the
     resulting stacks and any stacking the loot sheet does by hand.
   On the purse, ordinary quantity updates are used, each locked at the stack's version (step 3): its owner
   can still write it from two devices or two tabs, two players can own one character, and a GM can move a
   player's coins, so two moves planned from the same coins must not both land.
   As built in M1 (`scripts/logic/coins.mjs`): a plan is `{updates, deletes, creates}` over stacks
   `{id, denomination, quantity}` in item order, wherever they are. The amount's own denominations, which
   pf2e's first step removes, are its gp, sp and cp as pf2e's `Coins.normalized()` writes them (never pp),
   and minted coins (wages, change, strongbox lots) use the same three. pf2e's third step, which carries
   digit by digit, is written as "break the smallest coin left", which gives the same coins; the tests
   compare the planner with a transcription of `removeCurrency` on 5,000 seeded random purses. On a purse,
   added coins go onto the first stack of that coin in item order, even one inside a container, and
   removals walk the stacks in item order, as pf2e does (`addCurrency` names its list `topLevelCoins` but
   never filters out containers). In the strongbox, each denomination's coins come from whole stacks,
   smallest first (then by id), and the excess of the last stack comes back as a new stack along with any
   change. A pledge lot holds the amount in gp, sp and cp, not the purse's own coins. `planSpend` pairs one
   strongbox debit with the pro-rata shares of 4.6 ("debits across contributors").
2. **Fast path.** The acting client checks that the row's idempotency key is not already present. As built: a move
   whose rows are known before it is planned (every move but a spend, whose rows follow its shares) checks first;
   a duplicate that already sees the first move's lock pages would otherwise plan around the stacks they hold and
   come back "strongbox-short" (seen live). That check reads only the rows' ids (the hashes of their keys), so an
   amount the plan refuses (0, negative or missing: "nothing") is still refused, not thrown when the row is built.
3. **Lock first.** Two `foundry.documents.modifyBatch` requests, the second sent once the first applied:
   1. the lock request: create lock pages in the ledger, with `keepId` (the server refuses a page whose id
      exists, under the collection's semaphore), whose `_id`s are the coin-moving rows the move writes,
      every strongbox item it deletes (coin stacks, or a delivery's shelf item), and every purse coin
      stack it changes, at that stack's version; then the ledger rows, with `state: "pending"`, and other
      ledger keys (a claim's `resolved`). The row id is the hash of its idempotency key, so a claim and a
      direct move for the same key (a wage day resolved by the earner and by a wizard runner) share one
      lock;
   2. the apply request: the item and coin operations on the purse and the strongbox, debits first, and
      last the settle (step 4).
   A losing duplicate fails at its lock, in the dry run or in the real pass, before any coins move, and
   leaves nothing behind on either side: the lock request's only other operation is an update, which a
   refused dry run does not commit on the client either (As built, Dry-run replay). A move that stops
   after its lock leaves a pending row whose lock is already held; its author or a GM closes it, booking
   an `adjust` if the coins are not right. A move whose apply request never reached the server at all is
   resumed instead (As built, Resume). A close or an adjust acts only on a row that needs a hand: it leaves alone a
   move that is in flight or that the module resumes, and takes the mark of one that needs a hand, so only one of
   them and a late apply request lands (As built, Closing by hand).
4. **Settle.** The apply request's last operation sets the rows to `"applied"`. Reconciliation (4.7) lists
   rows still pending, locked stacks still there, and balance mismatches, for the author to retry or a GM
   to `adjust`.
5. **One at a time per user.** Each client runs coin operations behind a local mutex, shared across
   the user's tabs in the same browser through the Web Locks API (`navigator.locks`), so one client
   never sends a second plan before the first resolves. A lost lock is re-planned from fresh data on the
   next attempt: for a claim, the next sweep, which the winner's `claims` write sets off.

As built in M2 (`scripts/logic/lock-first.mjs`, `scripts/foundry/batch.mjs`, `money.mjs`):

- **Locks.** The lock request creates one lock page per row the move writes, one per strongbox item it deletes,
  and one per purse coin stack it reduces, raises or deletes, named `stack:<stack id>:<version>` (hashed), the
  version being the stack's `_stats.modifiedTime`, which the server sets on every write. The server checks
  every id before it writes any (Foundry 14.368 `dist/database/backend/server-backend.mjs`, `_createDocuments`),
  so two moves that spend the same strongbox stack for different rows (two refunds at once), or two that change
  the same purse stack from the same coins (a wage and a pledge from two devices), fail at the lock instead of
  one overwriting the other's quantity or leaving a pending row with no coins moved. A move planned after the
  stack changed names a new page. New stacks need no lock. Lock pages stay until archiving prunes them (5.3.3),
  so planning leaves out every stack whose lock page exists: such a stack is spoken for by a move in flight or
  one that stopped part-way, and picking it would only lose at the lock (`freeStacks`).
- **Two requests.** The lock request holds the lock and the ledger rows (pending) with any other ledger keys;
  the apply request holds debits (coins and items that leave: purse or strongbox stacks deleted or reduced, and
  their change), credits (coins that arrive, and items created), and last a ledger update that sets the rows to
  `applied`. The settle is the apply request's own last operation, so a row is pending exactly when its move
  stopped after its lock, and no separate settle write can be lost to a closed tab. Debits before credits means a
  move that stops part-way never creates value. The cost is one more round trip per move. A coin move's apply
  request starts with its apply mark, one more lock page, so it applies at most once whoever sends it (Resume).
- **Before sending.** The client checks its own copies first (`preflight`): a lock page it would create exists
  already ("locked"), or an item it would delete or update is gone ("gone"). Either way nothing is sent. The
  second matters because Foundry's client runs every operation through its document class before sending, and
  pf2e's `ItemPF2e.deleteDocuments` quietly drops the ids of items the actor no longer holds (pf2e
  `src/module/item/base/document.ts`), so the request would go out without them; core throws for an update of
  a missing document instead. If an operation still comes back smaller than it was sent (`shrunk`: the item
  went between the check and the client's own dry run), the move is "stopped", its rows marked pending again.
- **Outcomes.** "ok"; "conflict" (nothing applied: the lock is someone else's, or its items are gone); "stopped"
  (the lock and rows are written but not everything after them; the rows get `stopped = {applied, total, reason,
  by, at}` for reconciliation, and are set back to `pending` only when the request went out without an operation
  the client dropped, "shrunk", since only then can the settle have applied; otherwise the rows are still pending
  on the server, and writing that again could undo a resume's settle); "taken" (the lock and rows are written, and
  another client's resume sent the apply request first, or a close or an adjust took its mark: this one was refused
  at the apply mark, see Resume and Closing by hand);
  "error" (the client could not build or send it, nothing applied); "unknown" (the answer was lost with the
  connection, or never came: see Answers; the client goes stale, since the move may have applied or yet apply).
  Each result also says which request (`phase`) and why (`reason`: "locked", "gone", "dry-run", "first",
  "stopped", "shrunk", "disconnected", "timeout"). The lock is held only if the lock request's first result is its
  pages. A stopped move is not completed automatically: its author or a GM closes the row (`resolvePending`) once
  the coins are right, booking an `adjust` if they are not.
- **Answers.** The server's answer to a request is a socket.io acknowledgement, which Foundry waits for without a
  limit (`SocketInterface.dispatch`). socket.io drops the acknowledgement of every request in flight when the
  connection drops (socket.io-client 4.8 `Socket#_clearAcks`), and Foundry reloads only after five seconds offline,
  so a short drop would leave the move waiting for ever, holding the coin mutex: the move watches the game socket's
  "disconnect" while it waits and ends as "unknown" (`reason` "disconnected") when it fires. With the connection up
  it waits for the answer, however late, up to `ANSWER_LIMIT_MS` (5 minutes; then `reason` "timeout"). As built
  (live harness): the first version gave up after 30 s; a busy server answered a lock request later than that,
  the connection up, and the move ended "unknown" with its lock and pending row written, its claim resolved and no
  coins moved, which nothing retries. Waiting for the late answer completes such a move (behaviour `slow-answer`).
  A client that goes stale says why, one notice per cause (`markStale` in `state.mjs`: a request refused after this
  client replayed it, the connection dropped while a request was out, or no answer in time), and asks for a reload.
- **Resume.** A move whose lock request landed and whose apply request never did (the tab closed between the two, or
  the lock request's answer was lost with the connection or never came) leaves its rows pending, its lock held, a
  claim it resolves resolved, and no coins moved; nothing retries it, since the claim sweep sees the claim
  resolved and the move's own client is gone or stale. The verifier's probe reproduced it live (the transport
  dropped right after the lock request went out). Every coin move is therefore resumable (`lockFirstBatch` with
  `resume`, `scripts/logic/lock-first.mjs`): the lock page of its first row also holds the move (`move = {v, rows,
  apply, touched, actor}`: its apply request less the settle, every item that request deletes or updates with its
  version `_stats.modifiedTime` at planning, and the purse it moves coins in or out of), and its apply request
  starts with one more lock page, the apply mark (`apply:<first row id>`, hashed), so the server lets that request
  through once, whoever sends it, the move itself answering late or a resume. The settle is made again from the
  rows rather than stored, because Foundry expands a dotted key anywhere in flag data it stores (`ObjectField#
  _cleanType`, `common/data/fields.mjs`; seen live: the stored `rows.<id>.state` came back as a nested object).
  The catch-up sweep's "resume" step (`resumeStalled` in `money.mjs`, before "pending rows") sends the apply
  request again (`runApply`) when, on this client's copies (`resumeDecision`): the rows are all pending, with no
  `stopped` note (a request that was answered goes the manual way); no apply mark exists (a request that reached
  the server may have applied in part, which only its author or a GM can judge); the rows are past
  `PENDING_GRACE_MS` on the server's clock (a younger move may still be in flight, so the sweep comes back when it
  is due); and every touched item is still there at its planned version (otherwise the planned quantities are wrong,
  and it goes the manual way). It is this tab's to resume while the user who took the lock is connected only if it
  is that user's tab holding the lease (the user's coin mutex then keeps it behind a move of its own still waiting
  for an answer); otherwise it is the tab responsible for the purse (5.6: a connected owner, else the active GM),
  or for a move on the strongbox alone the one responsible for shared writes after that user; a purse needs a
  writer who owns it. The resume runs inside the coin mutex and judges the move again there; a resume that does
  not come back "ok" is not tried again until the client reloads. A resume's apply request refused at the mark
  ("locked" before sending, "first" in the server's real pass, or a dry-run refusal once the mark has reached this
  client) is "taken": another client sent it first, or a close or an adjust took the mark. As built (live harness,
  behaviour `resume`, which drops the connection as the lock request's answer arrives): after a reload Player One's
  two devices resumed the move at the same moment, 60.5 s after it was stamped; one applied it and the other was
  refused at the mark in the server's dry run, showing core's error toasts as any lock race does; with Player One
  gone, the GM's client resumed it. Either way the coins moved once.
- **Closing by hand** (`resolvePending` in `money.mjs`, `bookAdjustment` in `reconcile.mjs`, `pendingState` in
  `scripts/logic/reconcile.mjs`). Every pending row is in exactly one of three states, judged from the client's copies:
  - **in flight**: a request may be applying it right now. The row is younger than `PENDING_GRACE_MS` (its move's own
    apply request may still land), or a request took its mark less than that ago (a resume, a re-creation, or the
    move's own apply request answered late), or a request for it was refused at its dry run less than that ago.
  - **resumable**: the module finishes it by itself, and nobody has taken its mark. For a coin move, `resumeDecision`
    says "resume" and some connected user's client may resume it (`resumerOf`, the rules of Resume above applied to
    every user, each user's lease-holding tab taken to be there): a move only a disconnected user could resume, or
    whose author is connected but no longer owns the purse, is not resumable. For a lost delivery (4.7), it has its
    snapshot and recipient, and a connected user is responsible for the recipient.
  - **needs a hand**: anything else. A request was answered and noted `stopped`; a request took the mark more than
    the grace time ago; nobody connected may resume it; the recipient's client failed to re-create a delivery (it
    notes the row "error", since it does not try again until it reloads); or a close or an adjust took the mark
    (`hand` on its page), which leaves nothing behind it that could land.

  A close and a GM's adjust act only on rows that need a hand. An in-flight or resumable row is still owed by its own
  move: a close of one is refused ("in-flight" or "resumable"), since ending a move that would still land is a
  cancellation (a move that should not have happened is undone with a reversal, 4.6, once it has landed); the adjust
  leaves its coins out of the difference and its mark alone, booking `differenceCp + owedBoxCp`, so once the move lands
  the coins and the rows agree, and should it come to need a hand its difference shows then. When that leaves nothing
  to book, the adjust is refused ("in-flight" while such a row that changes the strongbox is in flight, else
  "resumable"); coins dragged in by hand that match what such a move will bring are booked although the report
  balances. For a row that needs a hand a late request can still land (the move's own apply request on a busy server,
  or a resume once someone may resume it again), so the close, and the adjust for each such row that changes the
  strongbox (`box` not 0), take that row's mark if nobody has (the apply mark, or for a `delivered` row the lock its
  re-creation takes, `recreateLockId`), flagged `hand: {kind, row}`, in the same request as their ledger write.
  Whichever of the two reaches the server first lands, and the other is refused at the mark ("taken": nothing written,
  or nothing applied). A close closes every pending row of that move, whose coins one request moves; the adjust leaves
  them pending, for their author or a GM to close. A row with no automatic path, or whose mark exists already, is
  closed with a plain write. Both run in the coin mutex, so they wait for this client's own move or resume under way.

  Why: the verifier's probes found a close and an adjust unarbitrated against a resume (a close landing while a resume's
  apply request was on its way left the coins moved and the row closed by hand), and then, once both took the mark of
  any move, that they cancelled moves the module would have finished: the move never applied but its row still counted
  in the expected coins and in the member balances (5.9), so a pledger was credited coins she never paid. A dry-run
  refusal counts as in flight because losing a race at a mark can look like one: the 14.368 server tells the other
  clients about a request's changes only once its last operation has applied (`#r` in
  `dist/database/backend/server-backend.mjs` broadcasts after the loop), while it answers a loser refused at its dry run
  as soon as that dry run ends, so the loser may note its rows "stopped" while the winner's mark and settle are still on
  their way.

  A user is told about their own rows only once they need a hand, so the device that loses a resume race does not say
  that a move it just saw applied did not finish (the live `resume` check asserts no module warning on any client once
  the move is stranded). An in-flight row changes state with time alone, so the notice says when to look again
  (`pendingDueInMs`) and the sweep comes back then: a resume that stops part-way, or is refused at its dry run, is
  reported to its author in that session when its in-flight window ends, not at the next unrelated event.
- **Dry-run replay.** When the server's dry run refuses a request it answers with the dry-run results of
  every operation, and the requesting client processes those that passed as if they had happened
  (`#handleModifyDocumentBatch` in `client/data/client-backend.mjs` does not look at `dryRun`), on that client
  only. As built (live harness, correcting what was read from the 14.368 source): only world-level operations get
  that far. Their hooks fire with `options.dryRun`, and an update is not committed, because
  `DataModel#updateSource` returns before committing on a dry run (`common/abstract/data.mjs`). Every embedded
  operation (lock pages, items) fails on the client instead, with core's "A parent Document provided to the
  database operation must be a Document instance" (`_getParent`, `common/abstract/backend.mjs`: the server's
  dry-run result still carries the parent it resolved), shown as one more error notification; nothing is created
  or deleted on the client. A watcher on the create, update and delete hooks of journals, pages, actors and items
  therefore tells the move it was refused through the ledger update every lock and apply request carries; a
  request with no world-level operation comes back empty and counts as refused at its first operation ("first").
  The watcher marks the client stale (it writes nothing more and asks the user to reload) only for a created or
  deleted document, which only a world-level operation could leave, and the module's requests have none: a lock
  request lost at the dry run, and an apply request refused at its dry run (a document changed outside the module
  between the two requests, or a permission the server refuses), leave nothing behind and cost no reload; the
  apply request's rows stay pending, with `stopped`. Which way races fail (live, scenario 7 and the `lost-lock`
  check): without a canvas the loser lost in the real pass in 7 races of 8, so the server's window between its dry
  run and its real pass is not the few milliseconds the source suggests; with a canvas it mostly lost at the dry
  run; either way it left nothing behind.
- **Error toasts.** Core shows every error result of a batch as a notification with the server's own text (for
  example "The _id [...] already exists within the parent collection"), in the real pass and in a refused dry
  run alike, and `modifyBatch` has no option to silence it. The checks before sending, and each client sweeping
  in its turn (5.5), make it rare; when two clients do race to the server, the loser's user sees that toast once,
  and the module only logs the conflict. An apply request refused at its dry run also shows one error for each of
  its embedded operations (see Dry-run replay).
- **Mutex.** Web Locks exist only in secure contexts (https, or localhost); over plain http the mutex covers
  one tab, and duplicates across tabs are stopped by the lock pages, as across devices.
- **Coins.** A coin stack is a pf2e treasure item of the coin category with one denomination
  (`TreasurePF2e#isCoinage` and `unit`), read from `actor.itemTypes.treasure` in item order. New stacks are
  copies of the four `equipment-srd` coin items with `system.quantity` set; strongbox stacks, change
  included, are flagged `flags.MOD.lot = {row}`. If the coin items failed to load, coin moves are refused
  ("no-coins"); the next check loads them again.

### 5.5 Claims: effects on documents the actor's user does not own

A player cannot write another player's character. Anything that must land on someone else's actor
becomes a claim that the target's owner client applies.

| Claim | Created by | Content | Applied by | Application |
|---|---|---|---|---|
| Delivery | crafter's client at completion | a shelf item in the strongbox | recipient's responsible client | one lock-first move (5.4): lock the `delivered` row and the shelf item and write the row with the item's source snapshot, then delete the shelf item and create the item on the recipient. If the move stops after its lock, reconciliation re-creates the item from the snapshot (4.7); only once nobody connected can, its author or a GM closes the row by hand, taking the re-creation lock (5.4, As built: Closing by hand). |
| Refund | whoever cancels or completes | a `claims.<id>` entry `{actor, cp, order}` | the contributor's responsible client | `refund` row and coin move strongbox to purse |
| Wage | wizard runner for a PC they don't own | `claims.<id>` `{actor, cp, job, day}` | the earner's responsible client | coins minted into the purse, `wage` row |
| Formula | the crafter's client when a formula job for someone else's book completes (6.8), or a `formula-copy` service (4.5) | `claims.<id>` `{actor, uuid, provenance, order}` | the learner's responsible client | appends `{uuid}` to its own `_source.system.crafting.formulas`, writes provenance (4.13), fires `formulaAcquired` |
| Expiry | the creator's client after daily preparations | `claims.<id>` `{creator, cycle}` | each holder's responsible client | marks matching items inert (7.7); idempotent by itself and moves nothing, so it takes no lock |
| Invest | tattoo or graft completion | `claims.<id>` `{item, healUntil}` | subject's responsible client | invests the tattoo or graft once healed (6.14) |
| Exposure | whoever exposes a creature to an affliction it does not own: a Strike with a coated weapon, an unleashed inhaled poison, Expose (8.10.3) | `claims.<id>` `{kind: "exposure", target, source, def, dc, delivery, mods, combat?, by, at}` | the target's responsible client; the active GM's client for an exposure handed off to Affliction Forge (8.10.11) | the initial save, then the affliction item on the target (8.10.6); creates a document, so it takes a lock page like a delivery. Until it is applied it is the target's pending initial save (8.10.8) |
| Coating spend | the toucher's or consumer's client, when someone else's coated item is touched or eaten (8.10.5) | `claims.<id>` `{kind: "coating-spend", item, coatingId}` | the coated item's responsible client | removes `flags.MOD.coating` from the item; idempotent by `coatingId` |

- Auto-claim is a user setting (default on). With it off, the user gets one notice with a "Take it"
  button.
- Every claim that moves coins, items or formulas, or creates a document (an exposure creates the
  affliction item), is resolved by one lock-first move (5.4): a lock page for the row or claim it
  writes (and, for a delivery, for the shelf item it takes). A second resolver, for
  example the GM fallback and the owner's `ready` sweep at the same moment, or the same user in two
  places, fails at that first operation before anything moves. `claims.<id>.resolved = {by, at}` is
  written with the lock and serves as the fast-path check.
- The sweep at `ready`, and when a user connects, applies every claim for actors the local user is
  responsible for. Nothing is lost while a player is away.
- **As built in M2** (`scripts/logic/claims.mjs`, `scripts/foundry/claims.mjs`). A ledger claim is `{id, v,
  kind, idem, actor, parties, cp?, order?, garden?, job?, day?, by, at, resolved?}`; `parties` are the UUIDs of the
  actors it came from, which the relay checks (5.7). Its `idem` is the key of the row that applying it
  writes, so claim, row and lock page share one id. M2 applies refunds (strongbox to purse), wages (minted
  into the purse) and deliveries; the other kinds register appliers with their milestones
  (`registerClaimKind`). A claim whose row someone already wrote (a direct move for the same key) is marked
  resolved without moving anything, unless the move that wrote the row resolved it already (with its lock), whose
  resolution and author stand. A claim is resolved with its move's lock request, so a move whose lock request
  landed and whose apply request never did leaves the claim resolved with nothing paid: the claim sweep leaves it,
  and the resume step (5.4, As built: Resume) completes the move. While that move is in flight or resumable, a close
  by hand or a GM's adjust leaves it alone; once it needs a hand (nobody connected may resume it, or it stopped), its
  author or a GM closes the row, and the close takes the move's apply mark, so a resume cannot pay the claim later as
  well (5.4, As built: Closing by hand). A lost delivery is the same with its re-creation lock in place of the mark. The sweep runs at `ready`, when the lease
  passes to a tab, when any user connects or disconnects (`userConnected` fires on every other client), when a
  move it waits to resume is due, and shortly after the
  ledger's `claims` change or a shelf item appears. Every client reacts to the same change, so each waits its
  turn: 500 ms, plus 600 ms for each connected user ahead of it in id order (`sweepDelay`), and usually sees
  the locks of those before it and plans around them instead of racing them to the server. A sweep runs one at
  a time on a client (a call while one runs makes it run once more), each step (claims, deliveries, roster,
  resume, pending rows) and each claim or shelf item on its own: one that throws, or that this client cannot build a
  move for, is logged and left alone until the client reloads, so it cannot hold up the others. A delivery
  looks its shelf item up again inside the coin mutex, and skips it when its row exists ("already") or the item
  is gone, so a sweep or relay call that started before another delivery took the item never sends a move
  for it. With auto-claim off the user is told once per claim; the "Take it" button belongs to the Queue (M4).
  A delivered item loses its shelf flag and any `containerId` that pointed into the strongbox, and gets
  `flags.MOD.delivered = {row}`.
- **As built in M4.1.** The completion card and the order detail say where the item went (4.7, `deliveryOf`): "Delivered
  to <actor>'s inventory" once the delivery row applied, "On the pickup shelf for <actor>" with Collect for the
  recipient's owners while the shelf item is there, "On its way" between the two, or "Kept in the strongbox". Collect
  stays until the item is delivered, and then the card says so instead. The header's "Pickup shelf: N for you" is itself
  the Collect button while something waits; "Take it" is renamed Collect everywhere.
- **As built in M5 on M4.1.** Two finishes put nothing on the shelf, so they never read "On its way": a formula job's
  formula goes into the recipient's book by a formula claim ("The formula goes into <actor>'s formula book"), and an
  item the crafter etched, upgraded or gave a rune while holding it for themself is changed where it is ("Changed where
  it is, in <actor>'s inventory"; its `shelved` row's item carries `inPlace`, and the ledger names it "Changed in
  place").

### 5.6 The responsible client

```js
// Writes to (or prompts about) an actor.
function responsibleUserFor(actor) {
  const active = game.users.filter((u) => u.active);
  return (
    active.find((u) => !u.isGM && u.character?.id === actor.id &&
                       actor.testUserPermission(u, "OWNER")) ??                          // the assigned player, if an owner
    active.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"))
          .sort((a, b) => a.id.compare(b.id))[0] ??                                 // lowest-id player owner
    game.users.activeGM ??                                                            // the active GM (may be an assistant)
    null                                                                              // nobody: the ready-sweep catches up later
  );
}

// Writes to the shared documents caused by a change another user made.
function responsibleUserForShared(triggeringUserId) {
  const u = game.users.get(triggeringUserId);
  return (u?.active ? u : null) ?? game.users.activeGM ??
         game.users.filter((x) => x.active).sort((a, b) => a.id.compare(b.id))[0] ?? null;
}
```

- Ids are compared with Foundry's `String#compare` (code-point order, documented as host- and
  locale-independent), never `localeCompare`, whose ICU tailorings reorder ASCII letters in some locales
  and would let two clients elect different users.
- `actor.primaryUpdater` is not used: it prefers the GM, and its last step does not filter for
  connected users (verified).
- **One user, several clients.** A user can be connected more than once (two tabs, or two devices).
  Foundry tracks every socket of a user and forwards a user query to each of them, so a guard that only
  checks the user would pass on every one of that user's clients. Within one browser, only the client
  holding the user's lease acts on hook-driven writes and prompts: a Web Locks lease
  (`navigator.locks.request("MOD-lease-<userId>", ...)`, held for the life of the tab and handed to the
  next tab when it closes). Across devices, the lock-first batches (5.4, 5.5) make duplicate writes
  harmless, and the purse stack locks (5.4) keep two different moves on one purse from overwriting each
  other; a duplicate prompt on a second device is accepted.
- **Assigned but not owned.** Foundry lets a GM assign a player a character they only observe (the user
  configuration lists observed actors too, `client/applications/sheets/user-config.mjs`), and such a player
  cannot write it, so the assigned player counts first only when they own the character.
- This replaces the earlier rule ("the acting user if connected, otherwise the active GM"), which
  names nobody when neither is connected (`DECISIONS.md`, derived rules).
- A user's own action runs on that user's client; no guard is needed.
- An all-client hook (`updateWorldTime`, `createChatMessage`, `combatTurnChange`, `createItem`,
  `updateActor`) acts only when the guard returns the local user.
- Hooks that fire on one client only (`pf2e.restForTheNight`, render hooks) do not need the guard, but
  any prompt they raise must still go to the responsible user of the affected actor.
- **As built in M2** (`scripts/logic/responsible.mjs`, `scripts/foundry/responsible.mjs`, `lease.mjs`). The
  pure resolver takes the users as plain data and core's `game.users.activeGM` as given (core's
  `getDesignatedUser`: highest role, then lowest id by `String#compare`). Several players assigned the same
  character (and owning it) resolve to the lowest id among them, so every client agrees. Without Web Locks (an insecure
  context) every tab counts as holding its lease. The lease also gates the GM's creation of the shared
  documents (5.2) and the migration (4.14).

### 5.7 GM relay (accelerator only)

- Query name `pf2e-artisans-workshop.relay`, registered in `CONFIG.queries` at `init`; called with
  `game.users.activeGM.query(name, data, {timeout})`. It needs the `QUERY_USER` permission (default
  role Player) and an active GM; the target must be connected or the call throws.
- Because the active GM is the fallback responsible user (5.6), a connected GM already applies claims
  for offline owners through the ordinary hooks. The relay only lets a client ask for that immediately
  and wait for the result, for example to show "delivered" in the UI.
- Operations: `applyClaims({actorUuid})`, `expireFor({creatorUuid, cycle})`, `ping()` (version check).
  Each validates the request against stored state (the claim exists, targets that actor, and was made
  by an order or rest the requester was part of) and is idempotent. `applyClaims` declines when an owner
  of the target actor is connected, because that owner's client applies it, so a purse never has two
  writers; the exception is an exposure handed off to Affliction Forge, which only a GM client can
  apply (8.10.11). The handler resolves each claim with the same lock-first batch as an owner client
  (5.5): a GM with two tabs receives the query on both, and only one batch gets past its lock.
- With no GM, or if the query fails or times out, nothing breaks: the claim stays pending until an
  owner client applies it.
- On the GM's own client the handler is called directly, not through the socket (a query to oneself
  is not short-circuited).
- **As built in M2** (`scripts/foundry/relay.mjs`). Only the GM tab holding the lease answers; another tab of
  the same GM leaves the query unanswered, and the server settles a query with its first answer, so a claim
  is applied once and the second tab raises no lock error. The server forwards a query to every socket of
  the target and answers only when one of them does; with no socket it never answers (Foundry 14.368
  `dist/components/activity.mjs`), so the asking client gives up after its own timeout. `expireFor` answers
  "unsupported" until M7; `ping` returns the GM's module version and schema. A shelf item is a party to its
  crafter's side (`shelf.from`): a requester who owns that actor may ask for its delivery; its recipient's
  owners are connected owners, whom the relay leaves it to anyway.

### 5.8 When the module is disabled

- Module flags stay on documents and do nothing. Reading them throws in other code while the scope is
  inactive, so the public API checks that the module is active first.
- The ledger remains an ordinary journal entry; the strongbox remains a loot actor with real coins and
  items, which a GM can distribute by hand.
- Crafted items, delivered tattoos and formulas added to formula books are ordinary pf2e data and keep
  working. Inert items keep their name suffix until deleted.
- On re-enable, derived accrual shows the days that passed while disabled as pending; the owner can
  resolve them or mark them "not downtime".

### 5.9 Purge all data

GM-only, from Settings, behind a typed confirmation (the world name). It never runs from a macro.

1. Shows what will happen, including strongbox balances per actor from the ledger.
2. Offers to return coins and shelf items first: refund claims for every positive balance, delivered
   by owners as usual, or move everything to the pf2e Party stash.
3. Unsets `flags.MOD` on actors, embedded and world items, users, journal entries and (optionally) chat
   messages.
4. Deletes the ledger journal and the strongbox once they are empty, and resets module settings.
5. Leaves crafted items, formula lists and system data untouched. Optionally strips inert suffixes.

As built in M2 (`scripts/foundry/purge.mjs`): the settings menu opens a DialogV2 with each member's balance
(`memberBalances`: what they still have allocated to each order and garden, plus a share of the party fund pro
rata to their net deposits, which are deposits less withdrawals and refunds from the fund; the rest of the fund
belongs to nobody in particular), the strongbox's contents, uncollected claims, the choice of returns, the
chat-message option and the typed world title. The balances shown are for display: the purge reads the ledger
again when it runs, so a pledge or withdrawal made while the GM typed the name counts. "Refunds" issues one
refund claim per member and allocation (each order, each garden, the fund share), keyed
`purge-refund:<order-id | garden-id | fund>:<actor UUID>` so a second run issues none twice, and carrying its
order or garden so the refund row pays that allocation back (a refund for an order's share must not come out
of the fund, or the order would still show the balance and the fund go negative); it says how many are new and
how many still wait, and stops there. The GM purges again once they are collected; with nothing left, that run
goes on. Otherwise the purge first turns the master switch off and waits two seconds (`PURGE_SETTLE_MS`), so
every client stops writing, a move already in flight finishes, and no client's check re-creates the documents
the purge is about to delete (every client receives the switch change before the deletions, since the purge
waits for each request in turn). "Party stash" then moves every strongbox item to `game.actors.party` in one
request, deleted from the strongbox first and then created there (without module flags or a strongbox
container), and checks the result: if it did not apply in full (an item spent by a move still in flight), the
purge stops before deleting anything, turns the switch back on and tells the GM. It takes no lock pages: those
of moves that stopped part-way outlive their batches (5.4), and would refuse the purge for good. Then the flags
go from actors and their items, world items, users, journal entries and their pages, folders and optionally chat
messages; the ledger is deleted; the strongbox is deleted only if empty, otherwise it stays an ordinary loot
actor (5.8); the module-data folder goes if empty; the world settings return to their defaults, except
`dev`. Stripping inert suffixes comes with the inert marks (M7); flags on unlinked tokens' actor deltas are
not reached. As built in M4: "Refunds" issues only what no open refund claim of a cancel or a finish already owes for
the same member and allocation (`unclaimedAllocations`), and waits while any refund claim is open, so a contributor
whose refund was not collected yet is not paid twice.

### 5.10 Trust model and audit

Owners can edit shared rows, so the module relies on cooperation, not enforcement. It makes every
change visible instead: every row and record names its author; nothing is silently overwritten;
reversals are new rows; the Funds tab and the order log show who did what and when; and the user who
made a transition, or a GM, can undo it. Client-side checks (field ownership, deletion guards)
prevent accidents, not determined tampering.

### 5.11 Follow-ups

Low findings from the M2 hardening rounds, left for a later change:

- **Socket lint rule** (`workshop/no-game-socket`, 15.1). A `function` listener that calls `this.emit` and a bare
  `off("disconnect")` are reported (probed): a listener must be an arrow, whose `this` is never the socket. Still not
  caught: a listener variable declared without a value and used before its first assignment is `undefined` at the
  call, so `game.socket.off("disconnect", f)` then removes every "disconnect" listener, core's included; and, as
  before, a computed name the rule cannot read, or a copy of `game` under another name.
- **Untested adjust guards.** No test fails without `bookAdjustment`'s own `canWrite` check ("not-ready"; `postRows`
  still refuses a difference, so only the "balanced" answer differs) or without its de-duplication of marks (a move of
  several rows that needs a hand would name one lock page twice in a request); nor without `postRows`' "already"
  answer when marks are given.
- **A resume that ends "error"** (its apply request could not be built or sent) is not tried again on that client
  until it reloads, and leaves no note on its rows, so every client still reads the move as resumable: a close is
  refused and its author is not told until then. Noting the rows "error", as a failed re-creation does, would make it
  need a hand.
- **A stale author.** A move only its connected but stale author may resume reads as resumable on every client until
  that author reloads, as their client asks them to; until then a GM can neither close it nor book its difference.
- **Fixed after the list was written: an adjust in an in-flight window.** A request that stopped part-way after moving
  strongbox coins is in flight for the grace time after it took its mark, and an adjust booked then credited the party
  fund with coins the move had already moved. `bookAdjustment` now refuses ("in-flight") while any strongbox row in
  flight holds its move's mark (test: "an adjust is refused while a strongbox move that holds its mark is in flight").
- **Fixed in M4: item delivered twice.** A lost delivery's re-creation and the original delivery's late apply request
  shared no lock, and pf2e's client drops a delete of an item that is already gone, so the re-creation could create the
  item a second time. The delivery's apply request now starts with the re-creation's lock page (`recreateLockId`, the
  `mark` of `lockFirstBatch`), the page a close by hand takes too: of the late apply request, the re-creation and a
  close, exactly one lands (`claims.mjs`; test "a delivery's late apply request and the re-creation of the lost
  delivery take the same lock", live behaviour `m4-double-delivery`). The price: a delivery whose apply request reached
  the server and stopped part-way after taking that page is no longer re-created by itself; it needs a hand (its
  author or a GM closes it), as a coin move that stopped part-way does.
- **Two clock reads near the grace boundary.** `pendingPaths` reads the clock inside `decide` and `pendingState` reads
  it again, in `resolvePending` and in the report. Within a millisecond of the 60 s boundary a close can take the mark
  of a move about to resume (no coins move twice). Pass one `now` through.
- **Notice timing for direct moves.** A move a user starts directly that stops schedules no follow-up sweep, so its
  author's notice waits for the next sweep event; the caller does get "stopped" back.
- **Socket lint rule, readable computed names.** `const k = "socket"; game[k]` is not reported, though the name is
  readable.
- **Test hygiene.** The tests that hold a move's apply request at a busy server's door leave it held when an assertion
  fails, so a failing run waits out `ANSWER_LIMIT_MS` (5 minutes) before its file ends.

---

## 6. Rules engine

Everything in this section is pure logic in `scripts/logic/*.mjs`, free of Foundry globals, and unit
tested with `node --test` (15.1). Callers pass in plain data extracted from documents.

### 6.1 Tables

```js
// Level-based DCs, levels -1..25 (index = level + 1). GM Core p.52; identical to pf2e src/module/dc.ts.
const DC_BY_LEVEL = [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30,
                     31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
// Rarity adjustments: hard, very hard, incredibly hard. GM Core pp.52-53.
const RARITY_ADJ = { common: 0, uncommon: 2, rare: 5, unique: 10 };

// Income Earned, Player Core p.228 Table 4-2, in cp. INCOME[row] = [failure, trained, expert, master, legendary].
// Row 21 is the table's extra row for a level-20 critical success. Matches pf2e
// EarnIncomeDialog.REWARDS_BY_LEVEL, which is not reachable from game.pf2e, so the module ships its own copy.
const INCOME = [
  [1, 5, 5, 5, 5],          [2, 20, 20, 20, 20],         [4, 30, 30, 30, 30],          [8, 50, 50, 50, 50],
  [10, 70, 80, 80, 80],     [20, 90, 100, 100, 100],     [30, 150, 200, 200, 200],     [40, 200, 250, 250, 250],
  [50, 250, 300, 300, 300], [60, 300, 400, 400, 400],    [70, 400, 500, 600, 600],     [80, 500, 600, 800, 800],
  [90, 600, 800, 1000, 1000], [100, 700, 1000, 1500, 1500], [150, 800, 1500, 2000, 2000],
  [200, 1000, 2000, 2800, 2800], [250, 1300, 2500, 3600, 4000], [300, 1500, 3000, 4500, 5500],
  [400, 2000, 4500, 7000, 9000], [600, 3000, 6000, 10000, 13000], [800, 4000, 7500, 15000, 20000],
  [0, 5000, 9000, 17500, 30000],
];

// Formula Price by item level 0..20, Player Core p.294 Table 6-13, in cp. Rune formulas use the same table (GM Core p.225).
const FORMULA_PRICE = [50, 100, 200, 300, 500, 800, 1300, 1800, 2500, 3500, 5000,
                       7000, 10000, 15000, 22500, 32500, 50000, 75000, 120000, 200000, 350000];

// Spellcasting services by spell rank 1..9, Player Core p.295, in cp (plus the spell's own cost).
const SPELL_SERVICE = [300, 700, 1800, 4000, 8000, 16000, 36000, 72000, 180000];

const DEGREE = { critFail: 0, fail: 1, success: 2, critSuccess: 3 };
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
```

As built in M1: the tables are frozen data modules in `scripts/data/`, each commented with its book and page:
`dc.mjs` (level DCs and adjustments), `income.mjs`, `formulas.mjs`, `services.mjs` (spellcasting services
and cost of living), plus `settlements.mjs` (GM Core p.53), `aid.mjs` (Player Core p.416), `materials.mjs`
(GM Core p.253), `coins.mjs` (Player Core p.10) and `complex-crafting.mjs` (TV-R p.158). The Income Earned
critical-success row has no failure entry in the book and holds 0. `DEGREE`, the ranks and the shared
helpers are in `scripts/logic/core.mjs`, which also states the folder's conventions: integer copper;
refusals as `{ok: false, reason, data}` with stable codes and no user-facing text; impossible input (a
non-integer level, an unknown rarity) throws.

### 6.2 Craft math

#### 6.2.1 DC and income

```js
function levelDC(level, { pwol = false } = {}) {
  const base = DC_BY_LEVEL[clamp(level, -1, 25) + 1];
  return pwol ? base - Math.max(level, 0) : base;      // Proficiency without Level, as pf2e calculateDC does
}

function craftDC(item, crafter, ctx) {
  let dc = levelDC(item.level, ctx) + RARITY_ADJ[item.rarity ?? "common"];     // GM Core p.53
  // Optional, GM Core p.53: the easy DC for an item the crafter has made before. Keyed on the exact item
  // (same type or grade), not the family: a minor elixir made before does not ease a greater one.
  if (ctx.settings.easyDcForRepeat && ctx.history.hasCrafted(crafter, item.sourceUuid)) dc -= 2;
  return dc + ctx.registry.dcAdjust(crafter, item, ctx.route) +                // registry adjustments, if any
         5 * (ctx.order?.variant?.complex?.rush ?? 0);                         // Complex Crafting rush (6.16.1)
}

// One day of income or cost reduction. rank: 0 untrained .. 4 legendary.
function incomePerDay(level, rank, degree) {
  if (rank < 1) return 0;
  const row = clamp(level, 0, 20);
  if (degree === DEGREE.critSuccess) return INCOME[row + 1][rank];   // level 20 uses row 21
  if (degree === DEGREE.success) return INCOME[row][rank];
  if (degree === DEGREE.fail) return INCOME[row][0];
  return 0;
}
```

As built in M1 (`scripts/logic/dc.mjs`, `income.mjs`): `craftDC` returns the breakdown an order freezes as
`order.dc`: `level` is the item level the DC is for (an upgrade's new level), `rarity` the rarity adjustment
in DC points, `repeat` −2 or 0, `adjust` the registry adjustments plus 5 per rushed setup day, and
`final = levelDC(level) + rarity + repeat + adjust`. The registry's `dcAdjust` and the easy-repeat history
arrive as values (`adjust`, `madeBefore`). `incomePerDay` clamps the rank to 1-4 as well as the level to 0-20.

#### 6.2.2 Planning and starting

```js
function planCraft(item, qty, crafter, recipient, ctx) {
  const max = batchMax(item, crafter, ctx);                     // 6.3
  if (qty < 1 || qty > max) throw new RangeError("split into several orders");
  const per = Math.max(1, item.price.per ?? 1);
  // Price from the *prepared* item at the recipient's size: includes runes, precious material,
  // shoddy and size multipliers (pf2e computePrice). An ephemeral item, never saved.
  const unit = ctx.instantiate(item, { size: ctx.sizeFor(recipient, item) });
  const priceCp = Math.round(unit.price.copperValue * qty / per);
  if (!(priceCp > 0)) throw new Error("items without a Price can't be crafted");
  return {
    priceCp,
    upfrontCp: Math.ceil(priceCp / 2),       // half or more (Player Core p.237). The system floors; we round up.
    setup: setupPlan(item, crafter, ctx),    // {days, hours, complex?}
    dc: craftDC(item, crafter, ctx),
  };
}

function setupPlan(item, crafter, ctx) {
  const override = ctx.registry.setupOverride(crafter, item, ctx.route);   // rune transfer 1; Reverse Engineering feat 1
  if (override != null) return { days: override, hours: 0 };
  if (ctx.order.craftType === "grow") return { days: 4, hours: 0 };        // Grow, TV-R p.165 (6.16.6)
  if (ctx.order.craftType === "deconstruct") return { days: 1, hours: 0 }; // Deconstruct, TV-R p.162 (6.16.5)
  if (ctx.settings.variants.complexCrafting && isComplexCraftSetup(ctx.order)) {   // TV-R p.158 (6.16.1, Scope)
    const c = complexSetup(item, crafter, ctx, ctx.order.variant?.complex?.rush ?? 0);   // rush chosen on the start form
    return { days: c.days, hours: c.hours, complex: { rush: c.rush, band: c.band, quick: !!c.quick } };
  }
  return { days: ["known", "family", "virtual"].includes(ctx.route) ? 1 : 2, hours: 0 };   // Player Core p.237
}

// start: gates pass (6.5), escrow >= upfrontCp (coins plus earmarked items at Price),
// precious-material share satisfied (6.6), checklist confirmed, pledges arranged (6.9).
function start(order, plan) {
  Object.assign(order, { priceCp: plan.priceCp, upfrontCp: plan.upfrontCp, dc: plan.dc,
                         setup: { days: plan.setup.days, hours: plan.setup.hours },
                         attempt: (order.attempt ?? 0) + 1, check: null, status: "setup" });
  if (plan.setup.complex) order.variant = { ...order.variant, complex: plan.setup.complex };   // frozen (6.16.1)
  post("commit", order.upfrontCp);
}

// Work totals are derived from the day records of the current attempt (4.8), never stored. `days` holds
// both the day records and the variant records keyed per order (4.8).
const daysOf = (o, days, kind) =>
  days.filter((d) => d.order === o.id && d.attempt === o.attempt && d.kind === kind);
const setupDone = (o, days) => daysOf(o, days, "setup").length;      // day records and follow-on credits (6.16.5)
const setupHoursDone = (o, days) => daysOf(o, days, "setup-hours").length > 0;   // a sub-day setup (6.16.1)
// `setup` -> `check` when setupDone >= o.setup.days && (o.setup.hours === 0 || setupHoursDone)
```

As built in M1 (`scripts/logic/craft.mjs`, `progress.mjs`):

- `planCraft` takes `batchMax`, the setup plan and the DC breakdown already computed, and the prepared item's
  Price as `item.priceCp` for `item.per` items: preparing the ephemeral item at the recipient's size is the
  Foundry side's job. It returns `{ok: false, reason: "quantity" | "no-price"}` instead of throwing. Under
  free crafting the plan has `priceCp` and `upfrontCp` 0 and keeps `listPriceCp` for display; G12 still
  needs the item's own Price.
- A quantity whose Price rounds to 0 cp (a few pieces of ammunition priced at 1 cp for 10) is refused as
  `no-price`.
- Rune transfer's 1 day is a fixed setup of `craftType: "rune-transfer"`, next to Grow and Deconstruct,
  rather than a registry override: it is the activity's own rule (GM Core p.225). `override` remains for
  registry entries, and the Craft-like formula jobs pass their own days (6.8).
- `planCraft` requires `batchMax` (a missing one would let any quantity through). `startOrder` refuses an
  order that is not `accepted`, refuses a plan that `planCraft` refused with the plan's own reason, and
  throws when the plan's Price or up-front half is not whole copper. `retryOrder` (from `failed`) commits the
  up-front half less what the order has already expended (`expendedFromRows`, a required input): the full
  half after a failure or critical failure, so after a critical failure the escrow must make up the ruined
  10% first, but nothing when an earlier attempt succeeded before a crafter swap (6.2.5).
- `setupDaysDone` and `setupComplete` are `setupDone` and the `setup` to `check` condition.

#### 6.2.3 The check and extra days

```js
// Recording moves no money, so a Hero Point reroll before settlement simply replaces the check (6.12).
function recordCheck(order, degree, crafterAtRoll, message) {
  order.check = { degree, level: crafterAtRoll.level, rank: crafterAtRoll.rank, ...message, settled: false };
  order.status = "rolled";
}

// Settlement: on the crafter's confirmation, or automatically when the order's next day is resolved.
function settleCheck(order) {
  const { degree } = order.check;
  order.check.settled = true;
  if (degree >= DEGREE.success) {
    post("expend", order.upfrontCp);                 // materials are used on any success
    order.status = "finishing";
  } else if (degree === DEGREE.fail) {
    post("release", order.upfrontCp);                // full salvage; start over to retry
    order.status = "failed";
  } else {
    const ruined = Math.ceil(order.upfrontCp / 10);  // 10% ruined, rounded up
    post("ruin", ruined);
    post("release", order.upfrontCp - ruined);
    order.status = "failed";
    if (order.product.snapshot.traits.includes("alchemical")) notice("crit-fail hazard (GM Core p.244)");
  }
}

function crafterRate(order, crafterToday, ctx) {
  const recompute = ctx.settings.recomputeRateOnLevelUp;          // default on (6.2.5)
  const level = ctx.registry.rateLevel(order, recompute ? crafterToday.level : order.check.level);
  const rank = recompute ? crafterToday.rank : order.check.rank;
  return incomePerDay(level, rank, order.check.degree === DEGREE.critSuccess ? DEGREE.critSuccess : DEGREE.success);
}

// The content of the crafter's day record for `day` when their activity is this order. Pure and
// deterministic, so any resolver computes the same record and a day resolved twice is one record.
function extraDayRecord(order, day, ctx) {
  if (!["rolled", "finishing"].includes(order.status)) return null;
  const helpers = presentHelpers(order, day, ctx);   // 6.7
  return {
    order: order.id, attempt: order.attempt, kind: "extra", day,
    crafterCp: crafterRate(order, ctx.crafterOn(day), ctx),
    helpers: Object.fromEntries(helpers.map((h) => [h.id, helperRate(h, ctx.settings)])),
  };
}

// Extra days count only once the check has settled as a success. A helper who left forfeits their
// past contributions when the retroactive setting is on (6.7).
function reductionCp(o, days, ctx) {
  if (!(o.check?.settled && o.check.degree >= DEGREE.success)) return 0;
  return daysOf(o, days, "extra").reduce((sum, d) => sum + d.crafterCp +
    Object.entries(d.helpers).reduce((s, [id, cp]) => s + (ctx.forfeited(o, id) ? 0 : cp), 0), 0);
}

const remainingCp = (o, days, ctx) => Math.max(0, o.priceCp - o.upfrontCp - reductionCp(o, days, ctx));
const daysToZero = (o, days, ctx, perDay) =>
  (perDay > 0 ? Math.ceil(remainingCp(o, days, ctx) / perDay) : Infinity);

function finish(order, days, ctx) {                 // allowed at any point in `finishing`
  post("remainder", remainingCp(order, days, ctx)); // from the order's escrow; more pledges if short
  deliver(order);                                   // 5.5
  order.status = "complete";
}
```

- **Minimums.** The remainder never goes below zero, so the total never drops below the up-front
  half (Player Core p.237 crafting example). Supplying more than half gains nothing unless the crafter
  finishes at once; extra escrow is refunded at completion.
- **Level 20.** A critical success at level 20 uses the table's extra critical-success row (index 21).
- **Untrained.** Rank 0 makes Craft impossible (it is a trained action); a gate, not a zero rate.
- **Free crafting.** If the crafter has the system's free-crafting toggle on (`flags.pf2e.freeCrafting`),
  prices are treated as 0: time, checks and gates still apply, and no coins move.
- **Test vector** (Player Core p.237 crafting example): a 5th-level expert crafts a 4th-level item
  priced 65 gp with its formula. `upfrontCp = 3250`, setup 1 day, DC 19. On a success the rate is
  100 cp/day and after 13 extra days `remainingCp = 6500 − 3250 − 1300 = 1950`; on a critical success
  the rate is 200 cp/day and the remainder after 13 days is 650.
- **As built in M1** (`scripts/logic/craft.mjs`, `progress.mjs`):
  - `recordCheck`, `settleCheck` and `finishOrder` return `{ok, patch, rows}`, each row `{kind, cp}` (4.6),
    instead of writing. Zero-copper rows are left out, so free crafting and a zero remainder post nothing.
    A check that arrives after settlement is refused with `settled` (the conflict of 6.12).
  - `recordCheck` throws unless the degree is 0-3 and the level, rank and attempt are integers, so an
    outcome that did not map (6.12) can never settle as a critical failure. It refuses a roll made for
    another attempt than the order's as `stale-attempt` (checked before `settled`), since a reroll of an old
    message can arrive after a retry or swap brought a new attempt to `check`.
  - `settleCheck` expends, releases or ruins the amount still committed (`committedFromRows`), which is the
    up-front half except after a crafter swap (6.2.5). That amount is a required input: no default can
    charge a swapped order twice. A stored degree outside 0-3 throws. The alchemical hazard is a notice code.
  - An extra-day record written while the check is recorded but not settled carries the amounts at the
    recorded degree; a reroll before settlement does not rewrite it. Settlement normally comes first,
    because it happens when the order's next day is resolved. M6 makes that always so: the day planner never
    writes a day of an order in `rolled` (it stops at `settle`), and the resolver of the crafter's owner settles
    the order before planning its days (9.2, As built in M6).
  - Day records count once per actor, day and kind, on top of their keying, and each order record is one
    day (`toDay` belongs to the empty spans of 4.8).
  - `crafterRate(check, crafterToday, rateLevel, rules)` takes the registry `rateLevel` as a value.

#### 6.2.4 Outcomes and refunds

| Event | Money | Default handling |
|---|---|---|
| Cancel before start | nothing committed | every contributor's allocation becomes a refund claim |
| Failure | committed amount released | kept for a retry; contributors may withdraw their share |
| Critical failure | 10% ruined pro-rata, rest released | as failure |
| Success | up-front expended | not refundable |
| Cancel after success | up-front stays spent | remaining escrow refunded; RAW allows finishing later, so the UI offers "pause" first |
| Finish | remainder paid from escrow | over-funding refunded |
| Contributor actor deleted | | refund goes to the party fund; the ledger notes it |

As built in M1: `cancelOrder` accepts any state but `complete`, `cancelled` and `archived` (4.2.3 lists only
`requested`, `accepted`, `failed` and `finishing`, which would leave an order in `setup`, `check` or
`paused` impossible to cancel), and `rolled`, which it refuses as `unsettled`: a recorded check is settled
first, so a critical failure still ruins its 10% and a success still expends the materials, and cancelling
cannot be used to escape a bad roll. It releases what is still committed and returns each remaining
allocation (`allocationsByContributor`, 4.6) as a refund; both are required inputs, so a missing one cannot
leave a commit open or skip the refunds. Sending a deleted contributor's refund to the party fund is M4.

As built in M4: a cancel writes, in one request, the `release` row (`release:<orderId>:<attempt>:cancel`), the order's
new state and log entry, and one refund claim per contributor (`refund:<orderId>:<actor UUID>:<log seq>`), which each
contributor's responsible client collects (5.5); the share of a contributor whose actor is gone, and the party fund's
own, go back to the fund as two `allocate` rows with `back` (4.6). A finish refunds the over-funding the same way, from
what each contributor has left after the remainder's pro-rata split (`leftAfterSpend`), in the finish's own request.

#### 6.2.5 Interpretation settings

| Setting | Default | Basis |
|---|---|---|
| Interrupted setup days persist | on | RAW covers only interrupted extra days (Player Core p.237); the author decided setup days persist too |
| Recompute the daily rate after a level-up | on | the rate uses the crafter's current level and rank; the degree stays fixed (author decision) |
| A crafter swap restarts setup and the check | on | escrow and earmarked materials carry over (author decision) |

As built in M1: `resumeOrder` with `setupInterruptionPersists` off opens a new attempt without a new
`commit`, because nothing was released. `swapCrafter` posts no rows; with the setting off the new crafter
simply continues the attempt. It refuses an order in `rolled` as `unsettled`, whatever the setting, so a
swap never throws away a recorded check (a critical failure could otherwise be rerolled by a new crafter
for free). A swap that comes after the check settled as a success finds the up-front half already
expended, so the new attempt's settlement expends, releases or ruins only what is still committed (0 in
that case), and a retry after the new attempt fails commits only the part of the half not yet expended (0
again): the materials already worked into the item carry over and are not charged twice.

### 6.3 Batches

```js
function batchMax(item, crafter, ctx, order) {
  const per = Math.max(1, item.price.per ?? 1);
  const consumable = item.traits.has("consumable") || ctx.registry.isConsumableFix(item);  // 4 talismans lack the trait
  let max = consumable ? Math.max(4, per) : per;           // Player Core p.237 sidebar; matches pf2e getFormulas
  if (item.type === "ammo" && !item.isMagical) max = per;  // mundane ammunition: the Ranged Weapons quantity
  if (consumable && item.traits.has("alchemical") && ctx.registry.has(crafter, "efficient-alchemy-alchemist"))
    max *= 2;                                              // Efficient Alchemy (Player Core 2): twice as many
  if (ctx.isScroll(item)) max = Math.min(4, pledgedCastings(order));   // one casting per scroll (GM Core p.262)
  if (ctx.isWand(item)) max = 1;                                       // GM Core p.282
  if (item.traits.has("snare")) max = ctx.settings.snareDowntimeBatch; // default 4 (OQ-14)
  return max;
}
```

- Quantity above one batch splits into sequential orders; one crafter does one downtime activity per
  day (GM Core p.46).
- The 1-minute snare Craft at full Price makes one snare; it is not an order, it is a note on the
  Morning tab (Player Core 2 p.297).
- **As built in M1** (`scripts/logic/batches.mjs`): `batchMax(item, {efficientAlchemy, pledgedCastings},
  rules)` reads the scroll or wand kind (`item.spellcasting`, from `CONFIG.PF2E.spellcastingItems`) and the
  registry's consumable fix (`item.consumableFix`) as plain fields. A scroll order with no castings pledged
  yet has a batch of 0, so its quantity is checked again once pledges arrive. `splitIntoBatches` splits a
  larger request into full batches and one smaller last batch.
- **As built in M3:** the Efficient Alchemy flag became `multiplier`, the registry's `batchMultiplier` for the crafter
  and product (its predicate is the alchemical-consumable test), and `item.consumableFix` is the registry's
  `consumableFix(uuid)`.

### 6.4 Formula families

- **Rule.** A formula for an item covers its other types, except types that are wildly different or of
  higher rarity. GM Core p.223 (Multiple Types) and the Player Core 2 Formula Book describe higher-level
  upgrades; Player Core 2's Quick Alchemy states, as the normal rule, that one formula lets you create
  any level of the item, so coverage of lower grades is on for every route, with the setting
  `rules.familyCoversLowerGrades` to restrict it to higher grades (author decision). An upgrade costs
  the full Price difference and uses the new level's DC.
- **Family key.** The compendium has no family field, so the key is derived from the item name with the
  parenthesised grade removed (Minor, Lesser, Moderate, Greater, Major, True, Type I-IV) plus item type
  and category, overridden by the registry. Families where each type needs its own formula (for example
  aeon stones, marvelous miniatures, and items whose text says so) are flagged `ownFormulaPerType`.
- **Coverage.**
  ```js
  const covers = (known, target) =>
    family(known) === family(target) && !ownFormulaPerType(target) &&
    rarityRank(target) <= rarityRank(known) &&
    (target.level >= known.level || settings.familyCoversLowerGrades);   // default on
  ```
- Coverage applies to all routes, including Quick Alchemy, Advanced Alchemy and downtime Craft. The
  setting can restrict it to higher grades; the Quick Alchemy panel follows the same setting.
- **Writing tiers.** The family is virtual; the module never fills the book with every tier. A tier is
  written into `system.crafting.formulas` (with provenance `family`) only when a system path needs
  that exact UUID: preparing it into a daily-prep slot. Verified: pf2e drops prepared formulas that are
  not in the known list (`CraftingAbility.getPreparedCraftingFormulas`).
- **ABP.** When `game.pf2e.settings.variants.abp !== "noABP"`, the fundamental runes that Automatic
  Bonus Progression replaces (weapon potency, striking, armor potency, resilient) and gear that gives item
  bonuses are hidden from craftable lists (GM Core p.83). Reinforcing runes stay: they raise a shield's
  Hardness, HP and BT, which is not an item bonus. The setting is a string, so a truthiness test is wrong.
- **Renamed items.** Remaster items reuse legacy `_id`s, so a looted formula book with legacy names
  resolves by UUID first; name search goes through a legacy-to-remaster alias list in the registry.
- **As built in M1** (`scripts/logic/families.mjs`):
  - The grades removed from the name are Minor, Lesser, Moderate, Greater, Major, Supreme, True, Type with
    a Roman numeral, and a potency such as (+1). Besides the list above, the pf2e 8.6.1 compendium uses
    Supreme (reinforcing runes), Type V-VIII (spellstrike ammunition, smuggler's sack) and (+1)-(+3)
    (weapon and armor potency, which are GM Core p.223's own example).
  - Spell-rank suffixes ("(3rd-Rank Spell)") are not grades, so scrolls and wands of each rank are separate
    families unless the registry joins them.
  - The key is built from the name it is given; callers pass the untranslated compendium name, so a Babele
    translation cannot split a family.
  - When several known grades cover a target, `formulaCoverage` reports the one closest in level (for
    display; the route is `family` either way).
  - `hiddenByAbp` takes the rune's kind and whether the gear gives an item bonus as inputs; the Foundry side
    works those out.

### 6.5 Eligibility gates

`gates(crafter, item, order, ctx)` returns `[{id, ok, reason, unlock}]`, where `reason` and `unlock` are
i18n keys with data (for example "needs master in Crafting; unlocks at the next skill increase").

| Gate | Passes when | Source |
|---|---|---|
| G1 trained | crafter trained in Crafting, or in the registry substitute skill for this item | Player Core p.237 |
| G2 level | item level ≤ crafter level | Player Core p.237 |
| G3 proficiency | master for item level 9+; legendary at or above the legendary threshold: 17 by default, 16 by setting (`rules.legendaryItemLevel`). The same threshold applies to Deconstruct and Grow (6.16) | Player Core p.237 says 17; GM Core p.223 and Treasure Vault (Remastered) pp.162, 165 say 16 |
| G4 crafting feat | alchemical: Alchemical Crafting; magical (including runes): Magical Crafting; both traits: both; talisman: Magical Crafting or a registry grant (Talisman Dabbler); oil or potion: Magical Crafting or a registry grant (the witch's Cauldron, which lets the witch Craft oils and potions); tattoo: Tattoo Artist (or Magical Crafting with Specialty Crafting in artistry under the Secrets of Magic setting); graft: Graft Technician and expert Medicine; snare: Snare Crafting, plus Magical Crafting for magical snares (setting, OQ-14); gadget: no feat | Player Core, Player Core 2, GM Core, Guns & Gears (R), Howl of the Wild |
| G5 rarity and access | common, or the crafter has access: a known formula for the item or a registry access grant. With `rules.uncommonNeedsFormula` on, only a known formula (OQ-37) | Player Core p.237; Player Core p.294; GM Core p.223 |
| G6 formula route | a route from 4.3 exists for this item | |
| G7 tools | alchemical items in downtime: alchemist's lab; other trades: artisan's toolkit; snares: snare toolkit (treated as an artisan's toolkit, OQ-14); registry substitutions (Scrounger, Improvise Tool, cookware for alchemical food) and gear that functions as a tool (the expanded and cytillesh healer's toolkits, the toolkit of bronze whispers, the philosopher's extractor). A tool counts if it is on the crafter or in the strongbox. Workshops (a smithy) are checklist items. | Player Core p.237 and items |
| G8 materials | escrow covers `upfrontCp`; precious-material rules (6.6) | Player Core p.237; GM Core p.253 |
| G9 Craft Requirements | every parsed requirement is confirmed on the checklist; spell supply is covered by fulfilled pledges (6.9); Craft Anything waives most requirements including spells, but not added costs | GM Core p.223; Craft Anything (Player Core) |
| G10 custody | the target of an upgrade, etching or transfer is on the crafter or earmarked in the strongbox for the whole job; a tattoo or graft subject has consented and is locked | GM Core p.225; Secrets of Magic p.164; Howl of the Wild p.97 |
| G11 availability | the crafter is not locked as a helper or subject on another order | Communal Crafting |
| G12 product rules | no artifacts; no Price means no Craft; specific items take only fundamental runes; shields only reinforcing; staves only fundamentals; property runes ≤ potency (+1 with orichalcum); one rune etched at a time per item | GM Core pp.223-225 |

Reverse-engineering and crafting a copy of a known formula skip G5 and the special Craft Requirements but
keep G1-G4, G7 and G8 (Player Core p.294 covers both in one paragraph: the formula's Price, the item's
Craft DC, and every other requirement to Craft the item); G8 is measured against half the formula's Price.
Inventing keeps the same gates, since the Inventor feat works just like the Craft activity.

As built in M1 (`scripts/logic/gates.mjs`):

- `reason` and `unlock` are stable codes, not i18n keys, with their numbers in `data`: `untrained`/`train`,
  `item-level`/`level`, `rank`/`rank`, `feats`/`feats`, `no-access` or `needs-formula`/`formula`,
  `no-route`/`formula` (with the acquisition routes), `tool`/`tool`, `underfunded`/`fund` or
  `precious`/`materials`, `checklist` or `spells`/`checklist`, `target-not-held`, `no-consent` or
  `subject-not-locked`/`custody`, `locked`/`release`, and for G12 `artifact`, `no-price` or a rune code. The
  interface maps the codes to keys (M4), so pure logic names no key and `tools/check-source.mjs` checks each
  key where it is used.
- Feats are registry slugs; a feat with a choice is `<slug>:<choice>` (`specialty-crafting:artistry`), and
  a registry `craftUnlock` arrives as `crafter.unlocks`, item traits that waive Magical Crafting (`talisman` for
  Talisman Dabbler; `oil` and `potion` for the witch's Cauldron, added in the M3 review). An alchemical
  talisman would also need Alchemical Crafting (none exists in pf2e 8.6.1); a magical gadget needs no feat,
  as G4 says; a graft's expert Medicine is reported in `data.ranks`.
- G5 counts the `known`, `family` and `virtual` routes as having the formula.
- G7 checks for a snare before the alchemical trait (no 8.6.1 item has both). Grafts, like every other
  non-alchemical item, need an artisan's toolkit until the registry substitutes another tool.
- G9 takes requirements as `{key, kind: "narrative" | "cost", confirmed}` and spell supply as
  `{spellsNeeded, spellsSupplied}`; Craft Anything waives the narrative ones and the spells, never a cost.
- G12's rune checks apply to `rune-etch` orders: one rune at a time, shields only reinforcing runes,
  specific items and staves only fundamental runes, property runes up to the potency value (+1 on
  orichalcum).
- G8 takes both amounts as required whole copper and throws on a missing one (a missing up-front amount
  used to pass, as `0 < undefined` is false). The gate sets default a missing escrow to 0, which fails
  safe.
- The gate sets are `craftGates` (G1-G12), `reverseEngineerGates` (G1-G4, G7, G8, possession as G10, G11 and
  G12's artifact and no-Price checks, since the item's own Craft requirements still apply),
  `inventGates` (G1-G4 with Inventor, the rarity rule as G5, G7, G8, G11) and `craftCopyGates` (G1-G4,
  knowing the formula as G6, G7, G8, G11) (6.8).

### 6.6 Precious materials

- One precious material per item, and only an expert crafter can make one.
- Grade needs rank: low grade expert, standard grade master, high grade legendary.
- The crafter's level must be at least the material's level (read from the prepared item).
- Magic item and rune level caps: low grade 8, standard 15, high any.
- The up-front materials must include at least 10% (low), 25% (standard) or 100% (high) of their value
  in the material itself. Satisfied by earmarked material stock items (ingots, chunks, lumber) valued at
  Price. Coin may stand in for common materials (silver, cold iron) when the setting allows (default on);
  uncommon and rarer materials always need stock items, because they cannot usually be bought with
  currency (Player Core p.237).
- Raising the grade later costs the Price difference plus the material.
- Source: GM Core pp.252-253. Grade validity per item type (for example duskwood only for wooden items,
  tower shields only duskwood) comes from the prepared item data where the system enforces it, otherwise
  from the registry.
- **As built in M1** (`scripts/logic/materials.mjs`): the share is computed on the order's frozen up-front
  half (not on any larger amount contributors escrowed) and rounded up to whole copper; for a grade upgrade,
  on the upgrade's up-front half. The grade's level cap applies to magic items and runes only; a mundane
  item is limited by the material's level alone. Coin counts toward the share only for a common material
  with `rules.preciousCoinForCommon` on. Every failed condition is reported, each a code with its numbers.

- **As built in M5:** earmarked stock lines, the coin commit they lower and when they are used up are in 10.11.
- **As built in M5 on M4.1:** stock lowers what "Fund this order" asks for (`shortfallOf`), an unmet G8 for want of
  the material offers "Add precious material stock" beside the requirement, and a finished order's cost counts the
  stock it used up (4.7, 10.11 As built in M5 on M4.1).

### 6.7 Communal Crafting and Aid

Rules (Player Core p.253): with Communal Crafting, other PCs can help. Each helper rolls a skill they
are trained in (Crafting or a skill relevant to the item). The crafter's roll alone decides success.
Each helper's result reduces the cost using the Income Earned table at the helper's rank and their
level minus 1. Helpers must stay with the crafter for the whole activity or the benefit is lost. A PC
with the feat may also help a crafter who accepts.

```js
function helperEligible(helper, order, crafter, ctx) {
  const feat = ctx.has(crafter, "communal-crafting") ||
               (ctx.has(helper, "communal-crafting") && order.crafterAccepted(helper)) ||
               ctx.settings.countHelpersWithoutFeat;                    // GM Core p.46 Cooperation, default off
  return feat && helper.isPC && helper.rank(order.helpers[helper.id].skill) >= 1 &&
         ctx.relevantSkill(order, order.helpers[helper.id].skill) &&
         !ctx.lockedElsewhere(helper, order) &&
         (ctx.settings.helperCap === 0 || Object.keys(order.helpers).length < ctx.settings.helperCap);
}

function helperRate(h, s) {
  const row = Math.max(0, h.level - 1);
  if (h.degree === DEGREE.critSuccess) return incomePerDay(row, h.rank, s.helperCritUsesNextRow ? DEGREE.critSuccess : DEGREE.success);
  if (h.degree === DEGREE.success) return incomePerDay(row, h.rank, DEGREE.success);
  if (h.degree === DEGREE.fail && s.helperFailUsesFailColumn) return incomePerDay(row, h.rank, DEGREE.fail);
  return 0;
}
```

| Setting (RAW gap) | Default | Note |
|---|---|---|
| Helper check DC | the item's Craft DC | RAW does not say; author decision |
| Helper critical success | uses the next row (as Earn Income) | author decision: the helper's degree picks the Income Earned entry as an Earn Income check would, at (helper level − 1) and the helper's rank |
| Helper failure | the failure column at (helper level − 1) | same decision; alternative: contributes nothing |
| When helpers roll | once, when the crafter rolls; kept for the order | interpretation |
| Contribution applies | each extra day the helper is present | interpretation |
| A helper leaves before the Craft ends | forfeits everything they contributed (retroactive) | the feat says the benefit is lost; author decision. Alternative: only future days |
| Helper cap | none | left to the GM |
| Relevant skills | Crafting, plus registry trait mapping (divine → Religion, arcane → Arcana, occult → Occultism, primal → Nature, weapon → Warfare Lore), plus skills the crafter marks relevant on the order | the crafter's choice is recorded on the order |
| Count helpers without the feat | off | GM Core p.46 Cooperation |

- Helpers are locked from start to completion: their downtime activity becomes `help:<orderId>`.
- Example: a 10th-level helper who is expert in Crafting and succeeds adds the level-9 expert amount,
  400 cp per day.
- **Aid without the feat.** One Aid on the crafter's check, entered in the roll dialog as a
  circumstance modifier: +1 on a success, +2/+3/+4 on a critical success by the aider's rank (expert or
  lower/master/legendary), −1 on a critical failure; typical DC 15 (Player Core Aid).
- **As built in M1** (`scripts/logic/communal.mjs`; Aid's numbers in `scripts/data/aid.mjs`, Player Core
  p.416):
  - A helper's amount uses the level, rank and degree stored with the helper's roll on the order
    (`helpers.<id>`); `rules.recomputeRateOnLevelUp` is about the crafter and does not apply to helpers. A
    helper with no degree yet contributes nothing.
  - A helper is present from `joinedDay` to the day before `leftDay`. `leftDay` is written only when a
    helper leaves before the Craft ends; completing the order releases helpers without it, so the
    retroactive forfeit applies only to helpers who left early.
  - The helper cap counts the helpers already on the order other than the one being checked.
  - Warfare Lore is relevant by item type (`weapon`), since weapon is not a trait.
  - Eligibility reports every failed condition as a code: `no-feat`, `not-pc`, `untrained`,
    `irrelevant-skill`, `locked`, `cap`.
  - A helper's entry stays on the order until it is archived: leaving writes `leftDay`, and nothing deletes
    the entry. Should one be deleted anyway, the cost reduction treats the helper as one who left (their
    past days forfeited while leaving is retroactive), rather than counting days nobody can account for.

- **As built in M6** (`scripts/logic/communal.mjs`, `scripts/foundry/communal.mjs`, the helpers section of an order's
  detail, 10.12):
  - *Joining* (`joinOrder`, the helper's owner): an order with a crafter and not over (`accepted` to `paused`); the
    eligibility of `helperEligibility` with the crafter's feats from their roster snapshot (4.10) when this user cannot
    read the crafter; skills offered are the relevant ones the helper is trained in. The entry `helpers.<actorId>` =
    `{actor, skill, rank, level, degree, check, joinedDay, leftDay, accepted}`; `joinedDay` is the first day neither the
    helper nor the crafter has resolved, so a helper's share never lands on a day the crafter already wrote. The
    helper's activity becomes `help:<orderId>` and `lockedBy` the order. A helper who left cannot join again (their
    entry, and what they forfeited, stay).
  - *Acceptance*: when only the helper has the feat (and `countHelpersWithoutFeat` is off) the entry is `accepted:
    false` until the crafter's owner accepts (`acceptHelper`); an unaccepted helper is not present (`helperPresent`), so
    adds nothing.
  - *The helper check* (`rollHelper`, `scripts/foundry/rolls.mjs`): the helper's skill against the order's frozen DC,
    traits `downtime`, linked `<MOD>:help:<orderId>:<actorId>`; recorded by its author's client on the entry
    (`degree`, and `level` and `rank` at the roll); a reroll replaces it, a second roll is refused. It can be rolled from
    the start on (the DC is frozen then).
  - *Leaving* (`leaveOrder`): `leftDay` is the first day neither the helper nor the crafter has resolved; the helper's
    activity and lock are cleared. Locked helpers cannot spend days elsewhere (`planDays` stops `locked`); a helper day is
    a record of its own with no effect, since the share is in the crafter's extra-day record.
  - *Helpers are in downtime while they help* (review fix): helping is how they spend it, and their share is in the
    crafter's days whatever their own say. Joining puts a helper who is not in downtime into it (from the day after
    today, as "Start downtime" does); ending downtime is refused as `helping` until they leave the order; and their days
    cannot be counted as "not downtime" (`planDays` stops `locked` for that too).

### 6.8 Formula acquisition jobs

| Route | Cost | Time | Check | Gates | On success |
|---|---|---|---|---|---|
| Buy, common | `FORMULA_PRICE[level]` | 1 hour to copy | none | none: anyone may own a formula | `{uuid}` appended; provenance `bought`; `purchase` row |
| Buy, uncommon or rare | as above plus the surcharge setting (default 0%) | 1 hour | none | checklist: "a seller is available" (the GM's lever is the fiction) | as above |
| Copy from an NPC | `FORMULA_PRICE[level]` | 1 hour | none | | provenance `copied-npc` |
| Copy from an ally | free (`rules.allyCopyCostCp`, default 0) | 1 hour | none | the ally's roster lists it; the ally's owner confirms | provenance `copied-ally` |
| Invent (Inventor) | formula Price, Craft-like (half up front, extra days reduce) | setup 2 days (`rules.inventorSetupDays`) | Crafting vs the item's Craft DC, which includes the rarity adjustment (+2 uncommon, +5 rare) | Inventor; Alchemical/Magical Crafting for those formulas; G1-G3, G7 and G8 as for a Craft of the item (the feat works just like the Craft activity); uncommon and rare only if the setting allows (default off) | provenance `invented` |
| Reverse-engineer | formula Price, Craft-like | setup 2 days; 1 with the Reverse Engineering feat (+2 circumstance) | the item's Craft DC | item possessed (on the crafter or earmarked); G1-G4, G7, G8; no access or special Craft Requirements needed | provenance `reverse-engineered`; the item is kept (Player Core p.294). There is no disassembly option: that was the legacy rule. Reverse Engineering (Scrounger) still assumes disassembly, so only its setup and bonus apply |
| Schematic scanner | 0 | 10 minutes | none | the crafter holds a schematic scanner and the item | item not destroyed; the scanner also gives +2 to Craft stored formulas (registry `modifier`) |
| Craft a copy of a known formula | formula Price, Craft-like | setup 1 day | Crafting vs the item's Craft DC | the crafter knows the formula; G1-G4, G7, G8 as for reverse-engineering (Player Core p.294 sets both in one paragraph); access and special Craft Requirements are not needed | a formula claim to the recipient (5.5), applied by the recipient's own client; provenance `copied-ally` |
| Feature picks owed | 0 | at level-up | none | count from the registry: Formula Book +2 per level, Alchemical Scholar +1 of the new level, Alchemist Dedication 4, Alchemical Sciences (investigator) +1 elixir or tool per level (2 with Alchemical Discoveries), Alchemical Crafting 4, Magical Crafting 4 (level ≤ 2), Munitions Crafter 4 plus black powder, Snare Crafting 4, Tattoo Artist 4 (≤ 2) and 4 more (≤ 7) at master, Graft Technician 4 (≤ 3), Snarecrafter +3 per rank, Gadget Specialist +3 per rank, Runic Crafter a property rune (of that level or lower) at 4th and every 2 levels after, Cauldron 4 (1st level) on gain, then +1 of that level or lower at 4th and every 2 levels after | provenance `granted` |

- **Virtual lists** (no book needed): Talisman Dabbler (all common talismans of your level or lower,
  Player Core 2), Talisman Esoterica (common GM Core talismans of your level or lower), Runic Crafter
  (the fundamental runes, each once the runesmith's level reaches the rune's; no book for any rune the
  runesmith learns), Witch's Broom (the flying broomstick, as though the formula were known), Practical
  Magic (common spell catalysts), Improvise Tool (basic tools), the Basic Crafter's Book (common level-0
  Player Core items), the formulating aeon stone. Poisoner, Herbalist and Scrounger only remove the need
  for a book; their formulas must still be learned.
- **Fulus** cannot be reverse-engineered (Secrets of Magic), marked in the registry.
- **Writing the formula.** The learner's owner client appends to `_source.system.crafting.formulas`
  (never the prepared array), writes provenance and the ledger row, then fires `formulaAcquired`. When
  the job was done by someone who does not own the learner (a copy crafted for an ally's book), the
  completion creates a formula claim (5.5) and the learner's responsible client applies it, so nothing
  waits for the learner to be online and no client writes an actor it does not own.
- **As built in M1** (`scripts/logic/formula-jobs.mjs`; prices in `scripts/data/formulas.mjs`):
  - Items above level 20 use the level-20 formula Price, the last the table lists.
  - Surcharges round up to whole copper; a unique formula takes the rare surcharge. Copying from an NPC
    costs the table Price with no surcharge, as the table above says, but an uncommon or rarer formula
    needs the same "a seller is available" checklist item as buying.
  - Inventing applies G1-G4 (trained, item level, proficiency, Inventor and the item's crafting feat), the
    rarity rule (common; uncommon and rare with `rules.inventorRarity`; unique never), G7, G8 against half
    the formula Price and G11. The tool gate is an interpretation: the feat "works just like the Craft
    activity", and the only difference it names is that the extra days go to research and design rather
    than making, so the Craft's tool requirement (an alchemist's lab for an alchemical formula) stays.
    Crafting a copy of a known formula applies G1-G4, that the formula is known, G7, G8 against half the
    formula Price and G11: Player Core p.294's requirement sentence follows both crafting a copy and
    reverse-engineering, as the Price and DC sentence before it does.
  - Every Craft-like formula job's DC is the item's `craftDC` without the easy-repeat adjustment. The
    Reverse Engineering feat's +2 comes back as `bonus` for the roll wrapper (M3).
  - The schematic scanner is a route of its own (`scanner`, provenance `reverse-engineered`), offered when
    the crafter holds a scanner and the item.
  - `formulaRoutes` shows only the Craft route when the crafter has the formula (known, family or virtual),
    and otherwise `none` (when open) followed by every acquisition route.
  - Feature picks owed and the virtual lists are registry data (6.11) and arrive with the registry in M3;
    until then callers pass `virtual` to `craftRoute`.
  - As built in M3: the virtual lists and access grants reach `craftRoute` through `routeInputs` (6.11), the picks
    owed come from `formulaPicks`, and `formulaJobPlan` returns the registry's `modifiers` for the job's route (the
    Reverse Engineering feat's +2, applied by the roll wrapper) in place of `bonus`, its 1-day setup from the
    registry too.

- **As built in M5:** instant acquisition, formula jobs on the order machine, picks owed and the formula claim are in
  10.11.

### 6.9 Casting pledges

- **When.** The product is a scroll, wand or staff, or its parsed Craft Requirements ask for castings
  (spellhearts, coda instruments, specialty wands). Detection uses `CONFIG.PF2E.spellcastingItems` for
  scrolls and wands, and the Craft Requirements paragraph for the rest.
- **Pledge.** `{caster, spell, rank, castings, payer, day, status: "offered" | "fulfilled" | "withdrawn"}`,
  created by the caster's owner (only they can read the caster's spells). The caster must be present on
  the day of the casting, so the pledge names a downtime day of the order.
- **Rules.** Scroll: one casting per scroll, all the same spell and rank, batch ≤ 4, the caster pays the
  spell's cost (GM Core p.262). Wand: one casting; the spell's cost is not paid (GM Core p.282). Staff:
  one casting of every listed spell at every listed rank. Cantrips, focus spells and rituals cannot be
  scribed.
- **Fulfilment.** The caster's client expends the slot through the pf2e spellcasting entry where that
  is possible, otherwise the caster confirms it on the checklist (OQ-15). A spell cost becomes a
  `purchase` row on the payer.
- **Alternatives.** Buy a casting at the spellcasting-service price (Player Core p.295; services are
  uncommon, so it is a checklist item). Craft Anything waives the casting but not its added cost.
- **Making the item.** The finished scroll or wand is built from the pf2e base "Scroll/Wand of
  Nth-rank Spell" item and the pledged spell. pf2e's own builder is not exported (OQ-15).

As built in M9: staves and codas, spellhearts, specialty wands and every other item whose Craft Requirements supply castings
read the castings they need from their own description, one entry per listed spell and rank, and a pledge names the entry it
supplies (10.16). As built in M5: pledges, the spell-supply gate and the scroll and wand builder are described in 10.11. As built in M5
on M4.1: a spell's cost and a bought casting are paid from the party fund or a purse (4.6), and the window calls a
pledge a casting "offered" (10.11, As built in M5 on M4.1).

### 6.10 Earn Income jobs

- **Task level.** Chosen by the earner, at most the maximum task level of the party's current
  settlement profile for that skill. The profiles are a world setting maintained by the GM (defaults by
  settlement size: village 0-1, town 2-4, city 5-7, metropolis 8-10, GM Core p.53). Which profile is
  current lives in the ledger as `meta.settlement = {profileId, by, at}`, so any member can change it
  when the party moves, with no GM online, and the Downtime tab shows who set it. Lower levels are
  always allowed. Behaviour when no settlement profile is set: OQ-17.
- **DC.** `levelDC(taskLevel)` plus GM adjustments, plus the "other skill" bump (setting, default +5,
  OQ-17) for skills other than Crafting, Lore and Performance (Player Core p.228).
- **Roll.** `actor.skills[skill].roll({dc, extraRollOptions: ["action:earn-income", "MOD:job:<id>"],
  traits: ["downtime"]})`. Adding `action:earn-income` makes the items' and feats' own rule elements fire:
  Experienced Professional's critical-failure upgrade, Tradecraft Tattoo, Fortune Cord, Inexplicable
  Apparatus. The system dialog adds only `self:action:slug:earn-income`, so those never fire there
  (verified). The module never hard-codes those conversions, to avoid applying them twice.
- **Degrees.** Roll after the first day; later days repeat the same pay. Critical success: task level
  + 1 row (20 uses row 21). Success: task level row. Failure: failure column; the job may be shortened
  (a note; the GM can end it). Critical failure: nothing, and the earner is fired (`status = "fired"`).
- **Experienced Professional, failure pay.** Doubled when the earner has the feat, is expert or better
  in that Lore, and the unadjusted outcome was not a critical failure (`flags.pf2e.context.unadjustedOutcome`).
  The system dialog doubles without checking rank (verified), another reason to own the roll.
- **Resume.** After a pause, a good roll is kept; re-rolling is allowed only if the earner's level or
  rank changed (Player Core p.228).
- **Pay.** One `wage` row per job per day, key `wage:<jobId>:<day>:<seq>` (the correction sequence of
  4.6), with the day in the row's `day`. The earner's responsible client
  mints the coins into the purse; anyone else resolving the day creates a wage claim (5.5). A day
  resolved twice, or by two clients at once, never pays twice: the earner's direct mint and the claim
  share one lock, keyed by the row (5.4).
- **Downtime-check guardrail.** Fortune effects and activated bonuses do not apply to downtime checks
  (GM Core p.46), and a reroll is a fortune effect: a Hero Point reroll, and also pf2e's free chat-menu
  rerolls (keep the new, the higher or the lower result), which spend nothing. The card warns when either
  is detected; a setting can block instead (default warn).
- **Cost of living** (Player Core p.295) can be deducted per week after income (setting, default off;
  GM Core p.50 suggests it only for long stretches).
- **Cooking Lore** jobs are ordinary Lore jobs.
- **As built in M1** (`scripts/logic/earn-income.mjs`; tables in `scripts/data/settlements.mjs` and
  `scripts/data/services.mjs`):
  - A settlement profile is `{size, level, caps: {[skill]: max}}`. A skill's cap is its own entry, else the
    profile's level, and a new profile starts at the top of its size's range (village 1, town 4, city 7,
    metropolis 10).
  - The earner's own level does not cap the task level: neither the book nor this section does, although
    the system dialog stops at the actor's level. With no profile any level from 0 to 20 is allowed and the
    job is marked unconfirmed (OQ-17).
  - A Lore is any skill slug ending in `-lore`.
  - `wagePerDay` takes the degree after the system's rule elements have run (Experienced Professional's and
    the Tradecraft Tattoo's critical failure to failure) and never converts it again; the doubling reads the
    unadjusted degree.
  - Days paid are the distinct `day`s of the job's `wage` rows that have not been reversed (`liveRows`, 4.6).
    `wageKey(jobId, day, seq)` requires the sequence, and `wageSeq` derives it: how many of that job's wages
    for the day have been reversed. A wage day undone and paid again therefore gets a new key and lock page.
  - Cost of living is a table lookup by standard and period; how many weeks a stretch is charged is the
    day resolver's (M6).
- **As built in M3** (`scripts/logic/rolls.mjs`, `scripts/foundry/rolls.mjs`):
  - `rollEarnIncome(jobId)` rolls `actor.skills[job.skill]` (Lore statistics included) with `extraRollOptions:
    ["action:earn-income", "<MOD>:job:<id>"]`, the job's DC and `traits: ["downtime"]`; it rolls an open job once.
    Experienced Professional's and the Tradecraft Tattoo's critical-failure conversions are their own rule elements
    firing on `action:earn-income` (the registry checks their shape, 6.11); Experienced Professional's doubling is
    `wagePerDay` with the flag from the registry's `earnIncome` effect and the unadjusted degree.
  - pf2e's reroll copies the first message's context and updates only `outcome`, so a reroll's
    `unadjustedOutcome` is stale. The recorded `unadjusted` degree is therefore computed from the kept roll's total,
    its d20 and the DC, as pf2e's `DegreeOfSuccess` does (by 10 over or under, then one step for a natural 20 or 1).
  - A recorded check writes `jobs.<id>.check` (with the earner's level and rank), `perDayCp`, `status` (fired on a
    critical failure) and `shortened`. A reroll replaces it until a wage has been paid; after that it is
    kept as `jobs.<id>.conflict`, as for an order (the earner undoes those wages first). A second roll that is not a
    reroll is refused and the roller is told; re-rolling a resumed job after a level or rank change is M6.
  - The guardrail applies to Craft and Earn Income checks alike (both are downtime checks): any reroll (the message's
    `isReroll` or `check:reroll`, whether or not a Hero Point was spent; pf2e does not record which result a
    keep-higher or keep-lower reroll kept, so all are marked) and a keep-higher roll are recorded with `fortune` and,
    under `warn`, `warn: true` for the card; under `block` they are not recorded and the roller is told. Assurance is
    not a reroll and is not marked.
  - `payWage(jobId, day)` posts `wage:<jobId>:<day>:<seq>`: the earner's responsible client mints it, any other
    client files a wage claim with the same key, and a day already paid is `already`. Jobs are created by M6's form;
    the harness writes them with `makeJob`.

- **As built in M6** (`scripts/logic/jobs.mjs`, `scripts/foundry/jobs.mjs`, the Downtime tab, 10.12):
  - *Settlements.* The world setting `settlements` holds the GM's profiles `{id, name, size, level, caps, notes}`
    (`makeProfile`; edited in the Downtime tab, hidden from the settings window); `meta.settlement = {profileId, by, at}`
    is the party's current one, which any member sets (`setSettlement`).
  - *Starting a job* (`startJob`, the earner's owner): a skill the earner is trained in (`untrained` otherwise), a task
    level within the current profile's cap for the skill (`task-level-cap`, with the cap), any level with no settlement
    (`unconfirmed`); the DC is `earnIncomeDC` frozen; the earner's activity becomes the job.
  - *Rolling* is the M3 roll (`rollJob`), linked `<MOD>:job:<id>:<round>`; a link without a round reads as round 1.
    *Rolling again* (`rerollJob`) after a level or rank change opens a new round with no check; a reroll of an earlier
    round's message is refused as `stale-round` (the 6.12 follow-up). The `paid` guard counts open wage claims as paid
    days too (`wageDaysOf`, the other 6.12 follow-up). *Ending* sets `ended` and clears the activity; it is refused as
    `job-days-pending` (with the count) while the earner's days go to the job and some are still to resolve, since an
    ended job pays no day: they are resolved, and paid, first (review fix). *Undo* takes back the last of start (only
    while no day was spent and nothing paid: the job is removed), reroll (only while the new round's check is not
    rolled, so the earner never keeps the better of two rolls; `job-moved-on` otherwise, review fix) and end.
  - *Pay.* Each earn day's record carries its wage (`wageCp`, the job's pay per day then; nothing on the day of a firing
    roll, and no day after it); after the records land, `payWage(job, day, {cp})` mints it (the earner's responsible
    client) or files a wage claim (anyone else). A day record whose wage never landed is paid by the earner's
    responsible client at the sweep (`sweepWages`, a sweep step), once, since the wage is keyed by job and day. Cost of
    living is not built (`rules.costOfLiving` stays off). As built in M12 (performance pass, 15.7): a span's wages go out
    together, `payWages(job, [{day, cp}])` per job: the earner's responsible client mints every unpaid day's row in one
    lock-first batch (one row and one row lock per day, as before; one purse credit for their sum), and anyone else files
    the span's wage claims in one write; the sweep pays a job's owed days the same way. A move that is refused or stops
    pays none of its days then, and the sweep pays them later. `payWage(job, day)` is that for one day.

### 6.11 Rules registry

The registry describes every feat, feature and item that changes crafting maths, gates, formulas,
daily preparation or Earn Income, beyond what the system's own rule elements already do.

- **Format.** `scripts/data/registry.mjs` exports frozen JSON-compatible data (a JS module, so nothing
  is fetched at runtime, which also avoids Forge CDN questions). Entries are keyed by slug, with the
  compendium source UUID alongside, because granted copies keep the slug and renamed Remaster items
  keep legacy `_id`s.
- **Entry shape.**
  ```js
  "efficient-alchemy-alchemist": {
    uuid: "Compendium.pf2e.feats-srd.Item.c7jNms3ZQ8eaMUqv",
    book: "Player Core 2", remaster: true, tier: 1,
    effects: [{ kind: "batchSize", when: { all: ["item:trait:alchemical", "item:trait:consumable"] }, multiply: 2 }],
    verified: "pf2e-8.6.1",
  },
  ```
- **Effect kinds.**

  | Kind | Meaning |
  |---|---|
  | `craftUnlock` | lets the actor craft a category (Talisman Dabbler: talismans; the witch's Cauldron: oils and potions) |
  | `gate` | an extra requirement |
  | `formulaAllowance` | picks owed per level or on gain |
  | `virtualFormulaList` | formulas known without a book (predicate and level cap) |
  | `setupDays` | overrides setup length |
  | `rateLevel` | changes the level used for daily reduction (Monster Crafting: the monster's level; Inexplicable Apparatus) |
  | `degreeShift` | changes the degree (Impeccable Crafting for the specialty) |
  | `batchSize` | changes batch limits |
  | `rollOptions` | options the roll wrapper injects (Specialty Crafting's bare choice, trade tags, `item:tag:food` for food) |
  | `modifier` | a module-applied modifier where no rule element exists (Tattoo Artist +1/+2, bountiful cauldron) |
  | `skillSubstitution` | Monster Crafting → Survival; Herbalist → Nature for healing items; Graft Technician → Medicine; Rune-Singer → Performance for rune items |
  | `toolSubstitution` | Scrounger, Improvise Tool, Wandering Chef cookware, Alchemist's Haversack |
  | `materialSource` | Monster Crafting parts, Junk Tinker |
  | `dcStamp` | Talisman Dabbler, Alchemical Power, Packed with Flavor, Legendary Tattoo Artist |
  | `dailyGap` | daily-prep features with no rule element (7.10) |
  | `vialSource` | vial sources and whether they regain in exploration |
  | `additive` | additive feats and which items they accept |
  | `expiryRule` | potency and expiry exceptions (Enduring Alchemy, Food Preservation, Eternal Elixir, Persistent Mutagen) |
  | `earnIncome` | Earn Income substitutions and modifiers without rule elements |
  | `correction` | known data bugs (four talismans without the consumable trait; Herbalist's −2 outside the wilderness; Lethargy Poisoner dose and rank gate; the alchemist archetype Advanced Alchemy filter missing `consumable`) |
  | `conflict` | hide or warn under ABP or other variants |
  | `variantOnly` | the entry exists only while a Treasure Vault (Remastered) variant is on (Quick Setup needs Complex Crafting, 6.16.1) |
  | `afflictionModifier` | changes a poison's DC, saves, duration or stage effects (Tenacious Toxins, Pernicious Poison, Combustible Poison, Pinpoint Poisoner, Blowgun Poisoner, Double Poison, Sticky Poison, the toxicologist's field benefit; legacy Potent Poisoner), 8.10.6 |
  | `delivery` | changes how a poison is applied (the toxicologist's 1-action injury poison, Poison Weapon, Poison Coat), 8.10.5 |

- **Tiers.** 1: core crafting and the common class and archetype features, fully automated. 2: automated
  where they touch time, cost, DC, batch, gates or formulas, otherwise shown as notes. 3: other classes'
  daily item preparation, as Morning entries. 4: legacy-only content. Legacy content is allowed: a
  tier-4 entry is automated wherever a character or item already has it, always with a legacy badge,
  and the maths around it stays Remaster (P8). The world setting `legacy.show` (default on, because
  legacy content is allowed) only decides whether legacy-only items are offered, badged, in pickers,
  catalogues and formula routes.
- **Validation script** `tools/validate-registry.mjs --pf2e <checkout>`, run in CI against a pinned
  `pf2e-` tag and in the churn watch against the newest tag and the dev head. It fails if a slug or UUID
  no longer resolves, a remaster flag changed, or a rule-element shape the module relies on changed (for
  example the `talisman-dabbler` CraftingAbility fields, the `versatile-vials` SpecialResource, Powerful
  Alchemy's `inline-dc` AdjustModifier, Seasoned's predicate, Experienced Professional's predicate).
- **Completeness.** The registry ships with an ignore list (`scripts/data/registry-ignore.mjs`) in which
  every entry carries a one-line reason. The validation script scans every pack of the pf2e system,
  spells and familiar abilities included, for items whose description mentions crafting, formulas,
  daily preparations or Earn Income. Any such item that is in neither the registry nor the ignore list
  is reported in pull requests and in the churn watch, and fails the stable-release workflow (enforce
  mode, 16.2). This is what makes "every feat, skill, class feature and item that affects crafting is
  accounted for" checkable before listing. The same script runs the affliction parser (8.10.2) over
  every candidate in the system packs (any `Stage` or `Stages` label, or an Onset or Maximum Duration
  paragraph); each must parse fully, have an override in `scripts/data/afflictions.mjs`, or be on the
  ignore list with a reason, and intros that mention further, additional or multiple exposure are
  flagged for review.
- **Seeding.** The research catalogues (feats and gear) seed the registry only after the per-entry
  source check below; their "automated by the system" verdicts are known to be wrong for some entries.
  Only the pf2e system packs are in scope: items that exist only in the PF2e Legacy Data module
  (different UUIDs) are out of scope, and the validation script never reads that module.
- **Catalogues of "what the system automates" are input, not truth.** Two common misreadings, both
  checked against the source: Seasoned and Specialty Crafting do not fire through the system Craft
  macro, and Earn Income gear (Fortune Cord, Inexplicable Apparatus, Tradecraft Tattoo) does not fire in
  the system dialog. Every registry entry is checked against the pf2e source before it is added.
- **As built in M3** (`scripts/data/registry.mjs`, `scripts/data/registry-ignore.mjs`, lookups in
  `scripts/logic/registry.mjs`, `tools/validate-registry.mjs`):
  - 243 entries: tier 1 40, tier 2 108, tier 3 49 (stubs), tier 4 46 (stubs, plus the four talisman corrections and
    the axe of the dwarven lords' options). The M3 review added the gear whose Crafting bonus needs an option only the
    wrapper adds (the rings of maniacal devices, the philosopher's extractor, the axe) and the gear that functions as
    a tool (the expanded and cytillesh healer's toolkits, the flawless celestial shawl), all formerly on the ignore list
    or on neither.
    Seeded from the research catalogues after checking each against the compendium JSON of the pf2e dev head
    (be4ab21b) and the pinned release `pf2e-8.6.1`; two dev-head-only items (the minor and lesser artifex telluria)
    were dropped because the release lacks them. Tiers as built: tier 1 is the core Crafting skill feats, the
    alchemist's crafting and daily-preparation features, Talisman Dabbler and the base tools; tier 2 every other
    Remaster entry that touches the Craft activity's cost, time or check, formulas or Earn Income; tier 3 other
    classes' daily preparation; tier 4 legacy content that touches either. Left out of the registry, onto the
    ignore list with a reason: backgrounds (they matter through the feat they grant), entries whose only effect is
    Repair (M5), combat and item-use riders (M8, M8a), DC stamps (M7), runes, precious-material stock, talismans and
    tattoos as items (M5, M7, M9), gear whose Crafting modifier needs nothing from the module, and the sweep's
    reviewed false positives (1208 UUIDs, 25 reason codes).
  - Keys are pf2e slugs; the one slug two items share (Advanced Alchemy) keys the archetype feat
    `advanced-alchemy@archetype`. Every entry carries `type`, and `relies` lists the rule-element shapes the module
    reads (the ones named above, plus Specialty Crafting's predicate and ChoiceSet, Impeccable Crafting's misspelled
    Note, the expanded lab's bare `alchemical`, the goggles, haversack and Earn Income gear, Graft Technician and the
    inventor's Reverse Engineer; after the M3 review also every carver-cutter, the rings of maniacal devices, the
    philosopher's extractor and the axe of the dwarven lords, and the CraftingAbility of the witch's Cauldron and of
    Gadget Specialist).
  - Predicates are `{all, any, not}` over the product's roll options plus context options (`craft-type:`, `route:`,
    `material:monster`, `specialty:<trade>`, `specialty:own`); `SPECIALTY_DEFAULTS` puts alchemical items under
    alchemy and tattoos under artistry, and an order's `specialty` field names any other trade. pf2e marks alchemical
    tools only with the `alchemical-tool` other tag (category `other`), so the investigator's elixir-or-tool picks read
    `item:tag:alchemical-tool`. Effect kinds built:
    `craftUnlock` (a `category`, an item trait that waives Magical Crafting for G4, or an `access` predicate for G5), `formulaAllowance`, `virtualFormulaList`,
    `setupDays`, `rateLevel`, `degreeShift`, `batchSize`, `rollOptions`, `modifier`, `skillSubstitution`,
    `toolSubstitution` (base tools provide their own id, so G7's `available` is the union over the crafter's and the
    strongbox's items), `earnIncome`, `correction`, `variantOnly`. The rest of the table arrive with their milestones.
  - The M1 inputs the registry now provides: `craftRoute`'s `virtual` and `accessGrant` (`routeInputs`), the gates'
    `unlocks`, substitute skills and tools, `batchMax`'s multiplier (`batchMultiplier`, replacing the
    `efficientAlchemy` flag), `crafterRate`'s `rateLevel`, `wagePerDay`'s Experienced Professional, the talisman
    `consumableFix`, Quick Setup (`holds` with `variantOnly`), and the feature picks owed (`formulaPicks`: on gain,
    per level, per rank). Reverse-engineering's 1-day setup and +2 come from the registry in `formulaJobPlan`, which
    now returns `modifiers` instead of `bonus`. No registry entry changes the Craft DC, so `craftDC`'s `adjust` has no
    registry part. Roster snapshots publish the registry keys of a character's feats and features (`slug:choice`).
  - A character's keys come from its items by compendium source UUID, else by an unshared slug; gear counts for
    modifiers and options only when equipped (and invested if it must be), and for tools wherever it is carried.
  - Validation: `npm run validate:registry -- --pf2e <checkout>` (also `PF2E_SRC=<checkout> npm test`) fails on an
    unresolved UUID, a changed slug, type or remaster flag, a missing `relies` shape, an effect UUID that does not
    resolve, or a stale ignore entry. After the M3 review it also fails on: an ignored item whose Crafting rule
    element predicates a bare option or an `action:craft:<trade>` option that its own RollOption does not set, which
    only the roll wrapper can add, so it needs a registry entry with a `rollOptions` effect (items ignored for Repair
    wait for M5); an `item:slug|trait|tag|category|usage|type|rarity:` option in an entry's effects or in
    `SPECIALTY_DEFAULTS` that no physical item in the checkout has (options the registry's own `rollOptions` add, such
    as Seasoned's `item:tag:food`, count as present; any other `item:` kind fails as uncheckable); a `books` title no
    physical item has; a `correction {consumable}` whose item now has the trait; and a registry entry or ignored UUID
    in a pack the checkout lacks, so a sparse or broken checkout never passes by reading nothing (`--enforce` also
    needs every Item pack of the manifest). The completeness scan reads every Item pack present, after removing the
    Craft Requirements heading, for `craft`, `formula`, `daily preparations` and `Earn Income`; CI's checkout takes
    all 25 Item packs of `pf2e-8.6.1` and reports 760 candidates, and `--enforce` fails on any. The affliction-parser
    part of the scan arrives with M8a.
- **As built in M7** (10.13): the kinds `dcStamp`, `dailyGap`, `vialSource` and `expiryRule`; the entries
  `talismanic-sage` and `munitions-machinist` (off the ignore list, where Talismanic Sage had been put as "combat" and
  M5's affix rule could therefore never see it); 249 entries and 1202 ignored UUIDs, validated against the pf2e dev head
  `be4ab21b` checkout.
- **As built in M8** (10.14): the kinds `additive`, `expiryRule {rule: "enduring" | "uncapped"}`, `brew`, `splash`,
  `fieldVial`, `vialMaterial`, `gather`, `quickVial` and `quickBomber`; 28 new entries (the additives Healing Bomb, Combine
  Elixirs, Debilitating Bomb, Sticky Bomb, Smoke Bomb, Exploitive Bomb, Sour Bomb, Lingering Bomb, Mega Bomb, Unstable
  Concoction, Balm Bomb, Pernicious Poison, Combustible Poison, Invigorating Elixir, Glitter Crystals, Blazing Mutagen and
  Numbing Spice Exhalation; Enduring Alchemy, Eternal Elixir, Expanded Splash, Directional Bombs, Quick Bomber, the bomber's
  field discovery, greater field discovery and Advanced Vials, Double Brew, Alchemical Expertise and Abundant Vials, all off
  the ignore list, where Double Brew had been put as "proficiency" and Alchemical Expertise as "item-dc"); `bomber` gains
  `fieldVial` and `splash {primaryOnly}`, `persistent-mutagen` an `uncapped` rule: 277 entries and 1174 ignored UUIDs,
  validated against the pf2e dev head `be4ab21b` checkout (`PF2E_SRC=<checkout> npm test`).
- **As built in M9** (10.16): the kinds `crafterMark` (Legendary Tattoo Artist), `investitureExempt` (Tattooed Historian) and
  `quickDeploy` (Giant Snare, Broad Snare); the entries `legendary-tattoo-artist` (off the ignore list) and `inventor@class` (uncommon
  gadgets); 286 entries and 1166 ignored UUIDs, validated against the pf2e dev head `be4ab21b` checkout. The class's own key also
  closes, for `inventor`, the slug collision of the follow-up below: the slug is shared, so the slug fallback no longer applies.
- **Follow-ups (M3, low).**
  - The completeness candidates (760 at `pf2e-8.6.1` over all 25 Item packs, mostly equipment and spells mentioning
    daily preparations, and 21 in the packs CI's checkout used to leave out: the Pathfinder Society boons Crafter's
    Workshop, Storied Talent and River Kingdoms Politician, the Shelyn, Brigh and Abadar boons and the Torag curse, the
    Traveling Workshop spell effect and others) are unreviewed: each needs an entry or an ignore reason before the
    stable release enforces the scan.
  - Tier-2 notes that could carry effects later: the schematic scanner's +2 (needs the formulas stored in it), the
    Tattooed Historian's access to orc tattoos (no trait marks them), the artifex telluria's bare option, Junk
    Tinker's and Monster Crafting's material sources (M5), and the flawless celestial shawl's one-degree-better
    Crafting outcome (it counts as a sterling artisan's toolkit now; the degree needs to know the shawl is the
    tennin's own).
  - Tier-4 stubs whose Crafting bonus predicates an option nothing sets, which a `rollOptions` effect would make work
    as the axe's does: the guiding chisel (`stonemasonry`), Torag's silver anvil (`metalworking`), the winder's ring
    (`clockwork`) and the palette of masterstrokes (`action:craft:paint`); and Blessed Blood's `own-blood`. The
    validator's wrapper-option check covers ignored items only; extending it to registry entries would list these.
  - `heldKeys` falls back to a slug match even when the item's source UUID names another compendium item, and never
    compares document types. Five registry slugs collide with other Item-pack documents (`acupuncturist` a
    background, `horn-of-plenty` a backpack, `inventor` the class, `practical-magic` a Kingmaker feature that would
    pick up the entry's virtual formula list, `quick-alchemy` the action), and `heldKeysOf` passes non-physical items
    of every type. Latent until those keys carry effects (M7): fall back to the slug only when `sourceId` is empty or
    not a `Compendium.pf2e.` UUID, pass `type` in `itemFacts` and require it to match, and have the validator report
    slug collisions.
  - Legion's Aim grants access to uncommon firearms as well as alchemical bombs; the access predicate covers bombs
    only. A second `craftUnlock` on `{all: ["item:group:firearm", "item:rarity:uncommon"]}` needs `item:group:` in
    `itemOptions` and in the validator's checked option kinds first.
  - The inexplicable apparatus at level 20: `rateLevel` gives 21 and `incomePerDay` clamps the row to 20, so a
    success pays the plain level-20 row and a critical success the level-20 critical row, where the item gives
    success at level + 1 and a fixed 20th-level critical row (50/100/200/350 gp); it needs a rate-table override.
    Its `setupDays` also shortens a reverse-engineering formula job to 1 day without the Reverse Engineering feat;
    exclude `route:reverse-engineer` from its predicate or say why it applies.
  - Tier-2 notes that touch formulas, time or Earn Income: Craft Philosopher's Stone and Brastlewark Snare
    Engineering grant named formulas but carry no `formulaAllowance uuids`; Celebrity Dedication's +1 Earn Income
    when the task level is above the earner's has no rule element and no effect kind yet; Snarecrafter Dedication's
    rank allowance is granted all at once by `formulaPicks`' `gained` path to a character already expert or better,
    where the feat grants picks only when the rank rises (mark it event-only), and its ranger Survival substitution
    is missing.
  - The heckling tools (a cursed sentient toolkit of any kind) count as no tool: the tool they replace is the GM's
    choice.
  - The order's `specialty` and `material`/`monsterLevel` fields are read by the wrapper and the registry but set by
    nothing until the order form (M4).

### 6.12 The roll wrapper

```js
async function rollCraft(order, crafter, ctx) {
  // An ephemeral copy of the product owned by the crafter, never saved, so roll options are complete.
  const item = await ctx.ephemeralItem(order.product.uuid, crafter);           // OQ-2
  const options = [
    "action:craft",
    ...item.getRollOptions("item"),
    ...ctx.registry.rollOptions(crafter, item, order),   // Specialty Crafting bare choice, trade tags, item:tag:food
    `${MOD}:order:${order.id}:${order.attempt}`,         // survives Hero Point rerolls inside flags.pf2e
  ];
  return crafter.skills[order.skill].roll({
    dc: { value: order.dc.final, label: game.i18n.localize("MOD.Roll.CraftDC") },  // explicit: the macro drops rarity
    extraRollOptions: options,
    modifiers: ctx.registry.modifiers(crafter, item, order),  // only where no system rule element exists
    traits: ["downtime", "manipulate"],
    label: game.i18n.format("MOD.Roll.Craft", { item: item.name }),
    createMessage: true,
    // The callback fires on the rolling client only and is not re-run on rerolls, so it is not used to record.
  });
}

// Recording, first roll and rerolls alike. Fires on every client; the message author records.
Hooks.on("createChatMessage", (message) => {
  const ctx = message.flags?.pf2e?.context;
  const link = ctx?.options?.find((o) => o.startsWith(`${MOD}:order:`));
  if (!link || message.author?.id !== game.user.id) return;
  const [id, attempt] = link.slice(`${MOD}:order:`.length).split(":");
  recordCheck(id, {                       // DEGREE_FROM maps pf2e outcome strings ("criticalFailure".."criticalSuccess") to 0..3
    degree: DEGREE_FROM[ctx.outcome], unadjusted: ctx.unadjustedOutcome, attempt: Number(attempt),
    rerolled: !!ctx.isReroll, messageId: message.id, total: message.rolls[0]?.total,
  });
});
```

- The item is not passed as `item`, because a bomb passed that way becomes the context item for weapon
  targeting (verified in `Statistic.roll`); its options go in `extraRollOptions` instead.
- `action:craft` must be added explicitly: `action: "craft"` would only add `self:action:slug:craft`.
- On a reroll, pf2e deletes the original message and creates a new one carrying only `flags.core` and
  `flags.pf2e`; module flags on the message are lost, which is why the order link is a roll option.
  `pf2e.reroll` is not used: it fires on the rerolling client before the new outcome is computed.
- The link names the attempt as well as the order, because an old message can be rerolled at any time:
  a reroll of attempt N's message that arrives after a retry, a crafter swap or a new-attempt resume has
  brought attempt N + 1 to `check` would otherwise be recorded as the new attempt's check. `recordCheck`
  refuses it as `stale-attempt`. `recordCheck` also throws on an outcome that did not map to a degree, so
  such a message is never recorded and can never settle as a critical failure.
- pf2e lets the message author or a GM reroll (verified, `check.ts`), and a GM reroll is recorded by the
  GM's client, since the new message's author is the rerolling user.
- Recording is separate from settlement (4.2.3). The first record moves the order to `rolled` and posts
  no rows; a reroll before settlement just replaces `check`. The money rows (`expend`, `release`,
  `ruin`) are posted only when the check settles: when the crafter confirms the result, or automatically
  at the order's next day resolution. A reroll that arrives after settlement shows a conflict on the
  card; the crafter undoes the settlement (their own last transition, 4.2.3) and settles again, with no
  GM needed. Nothing is recomputed silently. The reroll behaviour this relies on is still to be
  confirmed in a live world (OQ-3).
- The chat card augment (10.5) is added in `renderChatMessageHTML` and computed from stored state.
- Helper checks and Earn Income checks use the same wrapper with their own roll option
  (`MOD:helper:<orderId>:<actorId>`, `MOD:job:<jobId>`).
- **As built in M3** (`scripts/foundry/rolls.mjs`, its pure parts in `scripts/logic/rolls.mjs`):
  - `rollCraft(orderId)` rolls an order in `check` for an owner of its crafter. The options are `action:craft`, the
    activity's own (`action:reverse-engineer` on that route, `action:implant-graft` for a graft, where the system's own
    rule elements predicate), the unsaved product's `getRollOptions("item")`, the registry's options and the link;
    the registry's modifiers become pf2e modifiers labelled with their compendium item's name. OQ-2 is settled live:
    an unsaved copy built with the crafter as parent returns the full item option set (type, id, slug, traits,
    rarity, level, category).
  - Recording is `createChatMessage` on the message author's tab that holds the lease (the lease is the
    responsible-client guard here, P4). The check stored is `{degree, unadjusted, total, rerolled, fortune, warn,
    messageId, shifted, attempt, level, rank, settled}`: `degree` after the registry's degree shifts that the roll's
    options select (Impeccable Crafting's success to critical success; `shifted` says so), `unadjusted` computed as
    for Earn Income (6.10). A check refused as `settled` is stored as `orders.<id>.conflict`; one for another
    attempt is refused as `stale-attempt` and written nowhere.
  - `settleOrder(orderId)` runs M1's `settleCheck` and writes the order's new state in the same request as its rows:
    `expend` or `ruin` through M2's `spend` (which now takes the other ledger keys of its request), pro rata by
    contributor, with a `release` row riding in that request as an applied bookkeeping row; a failure (or nothing
    committed) is one plain write. Keys are `<kind>:<orderId>:<attempt>:<seq>`.
  - OQ-3 is settled live (harness `craft-hero-reroll`, GM and two players online): the reroll's message keeps the
    link and attempt, its author is the rerolling player, and that player's client alone writes the order's check,
    once.
  - After the M3 review:
    - A second roll for an attempt that already has a check and is not a reroll of it (two of pf2e's check dialogs
      open at once, since they have no fixed id; a double click; a GM and the player both rolling; one user on two
      devices) is refused as `rolled` by `recordCheck`, before the settled test, so it never replaces the first roll
      and is never kept as a conflict the crafter could take by undoing the settlement; the roller is told
      (`Roll.AlreadyRolled`). The same message recorded twice is not a second roll. Earn Income jobs already refused
      it and now tell the roller too.
    - Every reroll is guarded (6.10), not only a Hero Point one.
    - An attempt whose settlement rows (`expend`, `release` or `ruin` keyed for it, pending or applied, not reversed)
      exist counts as settled when a check is recorded, even if its `settled` flag was overwritten: a settlement writes
      its rows and the flag in one request, but a reroll recorded from a copy that had not seen it yet can land after
      it and clear the flag. The reroll is then kept as a conflict instead of replacing the check again.
    - `rollCraft` and `rollEarnIncome` leave `skipDialog` to pf2e unless the caller sets it, so the check dialog
      follows the user's own "show check dialogs" setting (the harness passes `true`).
    - Checked live (harness `craft-second-roll`): a second first roll's message is refused and the order keeps its
      first check, the roller sees the notice, and pf2e's free keep-new reroll of the first message is recorded as a
      reroll with `fortune` and `warn`.
- **Follow-ups (M3, low).**
  - A check whose message arrives while its author's client cannot write (stale, migrating, no OWNER) is not
    recorded and nothing catches it up; the order stays in `check`, so the crafter can roll again. A catch-up over
    recent linked messages at the `ready` sweep would close it.
  - A copy of a check message (a module re-posting it with its flags) would be recorded again as the same check
    under a new message id.
  - A second roll refused as `rolled` leaves its chat message, and a later reroll of that message carries the same
    link and `isReroll`, so it is recorded as a reroll of the attempt (orders and jobs alike). Refusing it needs the
    record to remember refused message ids, or the reroll to name the message it rerolls (pf2e's new message does
    not).
  - **Fixed in M4: a reroll write landing after the settlement.** The settled-rows test read the recording client's own
    copy, so a reroll write that landed on the server after a settlement overwrote the settled check with an unsettled
    one. Now (`scripts/logic/orders.mjs`, `scripts/foundry/orders.mjs`, `rolls.mjs`):
    - a settle writes, in the same request as its rows, the settlement record `orders.<id>.settlement = {attempt,
      check, status, rows, by, at}`, which nothing but a settle and its undo writes; a check recorded for an attempt
      with a settlement record counts as settled, and is kept as the conflict;
    - a reroll writes `check` alone, never `status` (the order is `rolled` already), so a late reroll cannot undo the
      settlement's state;
    - whenever the stored check disagrees with the settlement record of the current attempt, the crafter's responsible
      client (P4) puts the settled check back and keeps the overwriting roll as `conflict` (`settlementRepair`, on every
      ledger change that touches orders, `registerOrderHooks`; deterministic, so two clients write the same keys), and
      the recording client does the same right after its own write;
    - when the settlement landed after the reroll and replaced it, the reroll survives only on the recording client,
      which remembers its own rerolls for five minutes and writes the lost one as the conflict once it sees the
      settlement (`rememberReroll`); a reroll that another roll superseded before any settlement is forgotten;
    - undoing a settlement takes the conflict of the same attempt as the check (`undoPlan`), so the crafter settles the
      reroll with no GM. The check augment on the chat card says "not used" on any roll of a settled attempt that is
      not its settled check, and offers that undo.

    Tests in `test/foundry/orders.test.mjs` and `test/logic/orders.test.mjs`; live behaviour `m4-reroll-race`.
  - After the M4 review: an extra day keeps the rate of the degree settled first (its record stores `crafterCp`), so when
    a settlement is undone to settle a late reroll the days already worked still count at the old rate ("work a day"
    settles and logs an extra day in one click, so this is the common case). Store the crafter's level, rank and rate
    level in the record and compute its share from the settled check's degree, or rewrite the attempt's extra-day
    records when it is settled again.
  - The Earn Income `paid` guard counts wage rows, not open wage claims: a reroll recorded after another client filed
    a wage claim but before the earner's client applied it changes `perDayCp`, and the claim pays that day at the old
    rate (its `cp` was fixed when filed) while later days pay the new one. Count unresolved wage claims for the job
    as paid days, with M6's day resolution. (Fixed in M6: `wageDaysOf`, 6.10 As built in M6.)
  - A job's link carries no roll number (`<MOD>:job:<id>`), unlike an order's attempt. Once M6 allows a fresh roll
    on a resumed job after a level or rank change, a reroll of the message rolled before the pause would match the
    job and replace the new check until a wage is paid. Before M6: link `<MOD>:job:<id>:<n>` with a roll counter on
    the job, and refuse a stale link as orders refuse `stale-attempt`. (Fixed in M6: `<MOD>:job:<id>:<round>`, 6.10 As built in M6.)
  - A product that is a weapon (a bomb) brings its weapon options into the Craft check (`item:type:weapon`,
    `item:ranged`, `item:thrown`, `item:damage:*`; seen live on an imported level-1 bomber crafting a lesser
    alchemist's fire, which was otherwise right: DC 15, Int +4 and Trained +3, every planned option present, no
    context item). Only rule elements on broad selectors (`all`, `check`, `skill-check`) read them; a scan of
    a pf2e 8.6.1 sparse checkout's packs (without the spell-effect pack) found one, the aquatic combat effect's note on
    `item:trait:fire`, harmless. Recheck over every pack before release, or drop the weapon-only options from
    the plan.

### 6.13 Service rules

- **Repair.** Requires a repair toolkit held or worn by the performer, waived by Improvise Tool (4.5).
  DC: the item's level DC, no rarity adjustment (GM Core p.53). Repair is an untrained use of Crafting. HP
  restored: 5 + 5 × rank on a success, 10 + 10 × rank on a critical success (rank 0 included, as pf2e's own
  repair action does); Crafter's Eyepiece raises these to 10 + 10 × rank and
  15 + 15 × rank (the system's repair macro ignores it). Critical failure: 2d6 damage minus Hardness.
  Destroyed items cannot be repaired. Quick Repair and Rapid Affixture change time only.
- **Rune transfer and swap** (GM Core p.225): 1 day, cost 10% of the rune's Price (free from a
  runestone), DC by the rune's level; a swap uses the higher level and Price; fundamental for
  fundamental, property for property; an invalid target is an automatic critical failure; property runes
  left without enough potency go dormant.
- **Etching and upgrades** (GM Core pp.223-225): one rune at a time, the item stays with the crafter;
  etching costs the rune's Price, and upgrading a rune (a stronger fundamental rune, or a stronger grade of
  a property rune, which takes the weaker one's slot) the difference between the two runes' Prices, both
  read from pf2e's rune items in the compendium. Not from the item's prepared Price: pf2e drops a mundane
  item's own Price once it has runes and prices a specific item's runes at nothing (`computePrice`). An
  upgrade to a stronger grade of an item costs the two grades' Price difference. A rune goes only on an item
  its usage allows (melee, thrown, damage types, armor category, metal, holy or unholy), and a low- or
  standard-grade precious item holds runes only up to level 8 or 15 (GM Core p.253). The module never
  re-implements pf2e's rune price table, which disagrees with the compendium on a few runes.
- **Affixing** (7.4) and **Identify Alchemy** (the system action) are as in 4.5.

As built in M5: Repair, affixing, etching, upgrades and transfers with custody are described in 10.11.

### 6.14 Tattoos

| Step | Secrets of Magic process (default) | Simple toggle |
|---|---|---|
| Who | Tattoo Artist, or Magical Crafting plus Specialty Crafting (artistry) | Tattoo Artist |
| Subject | the recipient's owner consents; the subject is present for the whole Craft, so its downtime is occupied and it is locked like a helper (`rules.tattooSubjectLocked`, default on) | consent only |
| One at a time | a tattooist has at most one tattoo order in progress (Secrets of Magic p.164); the subject is present for the whole Craft and locked (G11) | off |
| Craft | normal Craft, with Tattoo Artist's +1 circumstance (+2 at master) applied by the wrapper | same |
| Investiture | each magical tattoo counts against the subject's invested items; the new tattoo is mundane only if the subject's limit is already fully used by tattoos (Secrets of Magic p.164) | not checked |
| Healing | a healing period of up to a month (setting, default 30 days), cut to 1 day if magical or alchemical healing is recorded; the tattoo is delivered uninvested and an invest claim fires when healing ends | none; delivered invested |
| Crafter stamp | Legendary Tattoo Artist: if the tattoo is at least 3 levels below the crafter, its activated attack and DC values and its resistances get +1, edited on the created item before delivery | same |
| Alter or upgrade | an order on an existing tattoo, cost = Price difference | same |

The Secrets of Magic process stands: Archives of Nethys carries tattoo process rules only from Secrets
of Magic, and Treasure Vault (Remastered) adds tattoo items without restating a process, so the
Remaster books give nothing to replace it with. Tattooed Historian investiture exemptions come from the
registry.

**Grafts** (Howl of the Wild p.97) reuse this flow with `craftType: "graft"`: the implanter needs the
formula, expert Medicine and Graft Technician (G4); the implant check uses Medicine with Graft
Technician's circumstance bonus applied by the wrapper; the willing subject is present throughout and
locked; one graft at a time per implanter; the graft is invested and counts against the subject's
investiture, and stays inactive while the subject's limit is used up. Replacing or upgrading a graft is
an upgrade order at the Price difference.

As built in M9 (10.16): the investiture rule is the settled one: each magical tattoo and each graft lowers the subject's invest
limit by one, and a new one fails only when that limit is already zero (a tattoo stays decorative, losing its magic traits and
rule elements, a graft inactive until the limit rises); the subject is locked from its consent, not from the start; the one-at-a-time limit is on the crafter; healing ends
on the day it is recorded, never before the day after the finish; the invest step is the subject's own client's sweep, not a
ledger claim; an upgrade is a tattoo or graft order naming the item it replaces (`variant.replaces`).

### 6.15 System gaps the module fills

| # | Gap in pf2e 8.6.1 | What the module does |
|---|---|---|
| 1 | The Craft macro's default DC ignores rarity (#19993) | explicit DC (6.2) |
| 2 | The Craft macro passes no item roll options, so Alchemist Goggles, the Haversack, the expanded lab (bare `alchemical` predicate), Seasoned, Specialty Crafting, the rings of maniacal devices (bare `snare`), the philosopher's extractor (`action:craft:alchemical`) and the carver-cutters never apply | roll wrapper injects them (6.12) |
| 3 | No setup days, extra days, progress, interruption or resume | orders (4.2) |
| 4 | The card's "pay half" button assumes every day was worked, and its buttons bypass any ledger | never used for orders |
| 5 | No feat or proficiency gating in Craft (a TODO in the source) | gates (6.5) |
| 6 | Communal Crafting, Inventor, Magical/Alchemical/Snare Crafting, Monster Crafting, Junk Tinker, Reverse Engineering and Tattoo Artist have no rule elements | registry (6.11) |
| 7 | No formula buying, copying, inventing or reverse-engineering | jobs (6.8) |
| 8 | No formula families (#17796) | families (6.4) |
| 9 | Efficient Alchemy's doubled downtime batch | batches (6.3) |
| 10 | Four talismans lack the consumable trait and batch at 1 | registry correction |
| 11 | Earn Income never pays (#7328); its roll lacks `action:earn-income`; failure doubling ignores rank | jobs (6.10) |
| 12 | Repair ignores Crafter's Eyepiece HP | service rules (6.13) |
| 13 | Talisman Dabbler's knowledge of every common talisman formula, and its DC rule | 7.4 |
| 14 | Infused items given to allies survive the creator's next daily preparations | party-wide expiry (7.7) |
| 15 | Quick Alchemy potency and the 10-minute cap untracked; no quick vial; no Double Brew; additives unenforced; the chat path crafts for free at 0 vials | combat (8) |
| 16 | No exploration vial regain; Improvise Admixture, Haversack and Extra Vial manual | 8.7 |
| 17 | Advanced Vials material is one global toggle, not per vial | per-vial material counts (7.3) |
| 18 | No talisman affix model | affix records (7.4) |
| 19 | Alchemical Power (archetype) has no rule element | `dcStamp` |
| 20 | Scroll and wand crafting only from the crafter's own spells | casting pledges (6.9) |
| 21 | Crafted items sized to the crafter's ancestry (#6981) | sized for the recipient (6.2) |
| 22 | Impeccable Crafting's note predicates a misspelled option; Specialty Crafting's bonus predicates an option nothing sets | wrapper options and `degreeShift` |
| 23 | Snares cannot be crafted through `CraftingAbility.craft()` | downtime snare orders |
| 24 | The Income Earned and DC tables are not exposed | shipped tables (6.1) |
| 25 | Remaster items reuse legacy `_id`s under new names | UUID matching and an alias list (6.4) |
| 26 | Experienced Professional's and Tradecraft Tattoo's rule elements are predicated on `action:earn-income`, which the dialog never sets | own roll (6.10) |
| 27 | The `affliction` item type is development-only: release builds remove it at `init` and its constructor throws, so nothing in a released system tracks a poison's stages | the affliction tracker on `effect` items with the same schema (8.10.1) |
| 28 | Where the affliction type exists, `rollRecovery` ignores critical degrees and virulent, and nothing handles the initial save, onset, maximum duration or multiple exposures | own affliction rules (8.10.6) |
| 29 | No way to coat a weapon with an injury poison or to expose a creature from a Strike | coatings and Strike handling (8.10.5) |
| 30 | Powerful Alchemy's inline DC upgrade reads the holder's modifiers, so an infused poison handed to an ally shows its printed DC | DC stamp at creation (8.10.4) |
| 31 | The Treasure Vault (Remastered) variants (Complex Crafting, Deconstruct, Grow and the rest) are compendium actions and a feat with no rule elements | variants (6.16) |

### 6.16 Treasure Vault (Remastered) crafting variants

Treasure Vault (Remastered) chapter "Secrets of Crafting" (pp.157-175) defines three groups of
variants: crafting alternate rules (Complex Crafting with the Quick Setup feat, crafting items with
adjustments, crafting downtime events, Critical Crafting, converting magic items through Deconstruct),
nature crafting (the Grow activity, its skill adjustment, Bestowed Gifts, Gardens of Wonder) and
story-based crafting (crafting quests). The module builds all of them. Each is a world setting that is
off by default, because they are variant rules (14.4); P10's "features default on" does not apply.
As built in M9a: all of them (10.17).

- **One group at a time.** The book advises adding one subsection at a time, and warns that the
  alternate rules, especially Complex Crafting, can interact badly with nature or story-based crafting
  (TV-R p.157). Settings shows a notice when variants from more than one group are on. Nothing is
  blocked: that is the table's call.
- **Compendium items used.** The Deconstruct and Grow actions and the Quick Setup feat (all rare in
  the book) are in the pf2e packs with `publication.remaster: true` and no rule elements (verified). They
  are referenced by UUID for names and chat links; their text is never copied.
- **What the module ships.** Numbers only: Table 5-1 setup days, the rush steps, the Deconstruct
  percentages, the GM Core p.133 permanent item price maxima used for gardens and the Table 5-3
  treasure by encounter values (6.1 conventions). Event names, critical examples and quest text stay in
  the book.
- **No GM gate.** Wherever the book says "the GM decides" (similarity of a deconstructed item, a quirk,
  a curse), the crafter records the call on the order and the GM can undo it (P1, 4.2.3).
- The chapter's material guidance (bone, stone and ooze materials, TV-R p.169) changes no numbers: an
  order's notes carry it. Bestowed gifts and gardens as the campaign baseline (TV-R pp.166, 168) are
  table choices that need nothing beyond 6.16.7 and 6.16.8.

| Variant | Setting | Changes | Section |
|---|---|---|---|
| Complex Crafting, Quick Setup | `variants.complexCrafting` | setup days by relative level, rushing setup or finishing for DC or risk | 6.16.1 |
| Crafting items with adjustments | `variants.adjustments` | one Craft for an item and its adjustments | 6.16.2 |
| Crafting downtime events | `variants.events` | a d20 event per stretch of crafting | 6.16.3 |
| Critical Crafting | `variants.criticalCrafting` | story effects on criticals | 6.16.4 |
| Converting magic items (Deconstruct) | `variants.deconstruct` | break an item into credit for another | 6.16.5 |
| Nature crafting (Grow) | `variants.grow` | grow items over 4 days, untended growth by season | 6.16.6 |
| Gardens of Wonder | `variants.gardens` | a party resource making one perishable consumable a day | 6.16.7 |
| Bestowed Gifts | `variants.gifts` | items bound to their recipient | 6.16.8 |
| Crafting quests | `variants.quests` | items earned through component encounters | 6.16.9 |

#### 6.16.1 Complex Crafting (TV-R p.158) and Quick Setup (TV-R p.159)

Rules, paraphrased:

- The Craft requirements are unchanged. Setup length comes from Table 5-1, by the item's level
  relative to the crafter and whether it is a consumable; knowing the formula takes a day off (minimum
  1 day).
- The crafter may rush the setup at the start: expert or better takes 1 day off for +5 DC, master or
  better up to 2 days for +10, legendary up to 3 days for +15. If that brings the setup to 0 or less, a
  consumable still takes 4 hours and a permanent item 1 day.
- Quick Setup (rare skill feat 7, master in Crafting; only available under this variant, TV-R p.159):
  a batch of consumables at least 6 levels below the crafter, rushed below 1 day, takes 2 hours, and
  only that setup can happen during an adventuring day; a permanent item at least 6 levels below, rushed
  below 1 day, takes 4 hours (the feat says nothing of an adventuring day for it).
- After setup the check is rolled. On a success the crafter can finish at once or spend extra days,
  each reducing the remainder by the Income Earned amount for the crafter's level and rank; interrupted
  work resumes where it stopped.
- An expert or better may rush the finishing: each rushed day reduces the remainder by twice the table
  amount, and once the item is finished the crafter attempts a flat check against 10 + the item's
  level − the crafter's Crafting proficiency bonus. Success or critical success: the item is fine.
  Failure: it is finished with a minor quirk the GM chooses. Critical failure: it is ruined, or becomes
  a cursed item attached to the crafter, at the GM's discretion.
- The variant does not restate the critical success, failure or critical failure of the check itself,
  so those follow the Craft activity (6.2.3) (interpretation, OQ-42).

```js
// TV-R Table 5-1, Days of Setup. Index: item level equal to yours, 1-2 below, 3 or more below.
const COMPLEX_SETUP = { consumable: [2, 1, 1], permanent: [4, 3, 2] };

function complexSetup(item, crafter, ctx, rushDays = 0) {
  const delta = crafter.level - item.level;                 // >= 0, G2 has already passed
  const band = delta <= 0 ? 0 : delta <= 2 ? 1 : 2;
  const consumable = isConsumableForBatch(item, ctx);       // the same test as batchMax (6.3)
  let days = COMPLEX_SETUP[consumable ? "consumable" : "permanent"][band];
  if (["known", "family", "virtual"].includes(ctx.route)) days = Math.max(1, days - 1);
  const quick = ctx.registry.has(crafter, "quick-setup") && delta >= 6;     // variantOnly entry (6.11)
  // Rush: one day per rank above trained, and never more than can still shorten the setup: a permanent
  // item without Quick Setup cannot go below 1 day, so a further rushed day would only add DC.
  const floor = consumable || quick ? 0 : 1;
  const rush = clamp(rushDays, 0, Math.min(Math.max(0, crafter.rank - 1), days - floor));
  days -= rush;
  if (days >= 1) return { days, hours: 0, rush, band };
  return { days: 0, hours: consumable && !quick ? 4 : consumable ? 2 : 4, rush, band, quick };
}

// Rushed finishing (expert or better). The proficiency bonus is the `proficiency` modifier of the
// crafter's Crafting statistic (pf2e createProficiencyModifier). The book's DC assumes that bonus includes
// the crafter's level, so the two levels roughly cancel. Under Proficiency without Level the bonus is the
// rank's alone, so the item-level term is dropped too, as GM Core p.85 does for level-based DCs
// (interpretation, OQ-42). A flat check DC of 1 or lower succeeds automatically.
function rushedFinishDC(item, crafter, { pwol = false } = {}) {
  const prof = crafter.skills.crafting.modifiers.find((m) => m.slug === "proficiency").modifier;
  return 10 + (pwol ? 0 : item.level) - prof;
}

function complexExtraDay(order, day, ctx) {               // wraps extraDayRecord (6.2.3)
  const rec = extraDayRecord(order, day, ctx);
  if (rec && ctx.dayChoice(order, day).rushFinish && ctx.crafterOn(day).rank >= 2) {
    rec.rushed = true;
    rec.crafterCp *= 2;                                   // helpers are not doubled (interpretation, OQ-42)
  }
  return rec;
}
```

- **Fields.** `order.variant.complex = {rush, band, quick}` and `order.setup = {days, hours}` are frozen
  at start with the rest of the plan (`setupPlan` and `start`, 6.2.2); `dc.adjust` carries the +5 per
  rushed day. The rush choice is made on the start form, which shows the days saved against the DC added
  for every legal value.
- **Sub-day setups.** Quick Setup's 2-hour setup of a batch of consumables takes no downtime day. The
  crafter's owner records it with "Set up now", which writes a `setup-hours` record keyed
  `days.<actorId>-<day>-<orderId>` (4.8), stamped with world time, so it never collides with the day
  record of an adventuring day or of the crafter's other activity that day. That record completes the
  setup, and the order moves to `check` (4.2.3). A crafter records at most 8 hours of such setups on one
  day, over every order (`SETUP_HOURS_PER_DAY`; the book gives no number, interpretation, OQ-42), behind
  the day's slot `setup-day:<actorId>:<day>:<n>`. Any other setup of hours (a consumable's 4 hours,
  Quick Setup's 4 hours for a permanent item) takes the crafter's downtime day on the order: the day
  planner writes that day record as the `setup-hours` record. The module never moves the clock; a GM may
  advance it by the hours. (Review fix of M9a; the first build let any setup of hours be recorded on any
  day.)
- **Rushed finishing** is a per-day choice in the day resolver and the wizard ("rush this day"), kept on
  the day record (`rushed`), so a mixed run is possible and the totals stay derived (4.2.1). When the
  order finishes and any rushed day exists in the current attempt, `finish` first rolls the flat check
  (`check.rushFlat = {dc, degree, total}`), whatever the setting says by then: the rushed days are in
  the ledger at twice the reduction. Likewise a frozen setup of hours is still recorded with the
  variant off; only new choices need it on.
  - failure: the item is delivered with `flags.MOD.quirk = {from: "rushed-finish", note}`; the
    crafter's card asks for the quirk to be described;
  - critical failure: by `variants.complex.rushCritFail`, `ruined` (default: no item, the money
    already spent stays spent) or `cursed` (the item is delivered with a curse note naming the
    crafter). The crafter records which one applies; a GM can undo it.
- **Scope** (`isComplexCraftSetup`). The table replaces only the Craft setup of `item`, `upgrade` (at
  the new level), `rune-etch`, `tattoo`, `graft` and `spell-item` orders whose product is an item, not
  a formula. Registry setup overrides (rune transfer 1 day,
  the Reverse Engineering feat, the Inventor setting) and Grow's 4 days are not Craft setups and stay
  as they are (interpretation, OQ-42).
- **Edge cases.** A level-up during setup does not change a frozen setup. A crafter swap restarts with
  a fresh computation for the new crafter (6.2.5). A batch uses the consumable column. Quick Setup
  shows as "needs Complex Crafting" while the variant is off.
- **Tests.** Every band for both columns, with and without a formula; rush capped by rank and by days;
  the 4-hour and 1-day floors; Quick Setup's 2-hour consumable setup stays in `setup` until its
  `setup-hours` record exists, including one recorded on a day the crafter spent on another activity, and
  a fifth one on the same day is refused; a 4-hour setup is refused by Set up now and takes a downtime
  day; Quick Setup at exactly 6 levels below and at 5; the flat-check DC with and without Proficiency without Level (a legendary 15th-level
  crafter rushing a 15th-level item: DC 2 either way, not 17 under Proficiency without Level); a run of
  mixed rushed and normal days.
- **As built in M1.** `complexSetup` (Table 5-1, the formula day, the rush caps, the sub-day hours and
  Quick Setup) is in `scripts/logic/complex.mjs`, with its numbers in `scripts/data/complex-crafting.mjs`,
  because `setupPlan` (6.2.2) calls it. It returns the rush actually applied after the caps, and `quick` is
  true only when Quick Setup set the hours: a Quick Setup crafter whose setup stays at a day or more gets
  `quick: false`. `rushedFinishDC`, `complexExtraDay` and the flat check remain M9a.
- **As built in M9a** (10.17): `rushedFinishDC`, the flat check (`rushFlatCheck`, once per attempt), Set up now and the rush
  choice; the rushed finish is an order toggle each day record captures (`rushDay`), not a per-day choice in the resolver.

#### 6.16.2 Crafting items with adjustments (TV-R p.159)

- An item order can include adjustment items (the `adjustment` trait, whose usage fits the base item,
  for example an armor adjustment on armor). The Price is the sum of the base item and its adjustments,
  and the whole is one Craft: one check, one up-front half, one finishing.
- The level used for G2, G3 and the DC is the highest level among the parts, and every part's own
  gates (feat, rarity, formula route) must pass (interpretation, OQ-45).
- On completion the base item and the adjustments are created together, and each adjustment carries
  `flags.MOD.appliedTo = {host: itemId}` on the same actor, the same pattern as affix records (7.4).
  Whether the plan priced them in is frozen at the start with the Price (`variant.adjusted`), so the finish
  makes what was paid for whatever the setting says by then (review fix of M9a).
- **Delivery.** A host and its adjustments travel as one delivery claim (5.5): the recipient's client
  deletes all their shelf items and creates them on the recipient in one lock-first batch, with ids it
  generates and `keepId`, so every `appliedTo.host` is written with the host's new id in the same batch
  and never points at a deleted shelf item.
- Without the variant, adjustments are ordinary separate orders.
- **Tests.** Price sum, highest-level DC, delivery of linked items to a recipient through the shelf with
  `appliedTo.host` pointing at the recipient's copy of the host.

#### 6.16.3 Crafting downtime events (TV-R pp.159-161)

- **When.** GM Core suggests a single event when a stretch of downtime lasts a week or a month, and
  around four when it lasts a year or more (GM Core p.46). While the variant is on, each active Craft-like order rolls
  its first event when its crafter resolves the attempt's `variants.events.firstDay`-th downtime day
  (default 7), and one more every `variants.events.everyDays` downtime days after that (default 91), so
  a week or a month of crafting gets one event and a year gets four; or at once from the order's "Roll
  event" button. The roll is keyed `event:<orderId>:<attempt>:<k>`, so a day resolved twice rolls nothing
  new.
- **Roll.** A d20 posted as an ordinary roll card by the crafter's responsible client. On 1-3 the card
  points to the GM Core crafting events through the system GM Screen journal's "Downtime Events" page,
  linked by UUID. On 4-20 it names the result number on Treasure Vault (Remastered) Table 5-2, p.159.
  The module ships no event names or text; if the world setting `variants.events.table` holds the UUID
  of a world RollTable (one the GM built from the book), the result is drawn from it instead.
- **Record.** `orders.<id>.events.<k> = {day, roll, tableResult?, note, status: "open" | "resolved",
  by}`. Events are narrative; the module does not adjudicate them. With `variants.events.pauses` on
  (default off), an open event pauses the order (no reductions accrue) until any member marks it
  resolved; there is no GM gate.
- **Visibility.** Whispered to the GMs and the crafter under `chat.visibility: involved`. Foundry 14's
  `Roll#toMessage` and `RollTable#toMessage` apply the user's own chat mode when given none, and the
  public mode clears the whisper list, so the cards pass `messageMode: "gm"` with their whisper list (or
  `public` with none) (review fix of M9a).
- **Tests.** Cadence (one event in 30 days, four in 365) and its keys across a pause and a retry, a
  world table draw, pause and resume.

#### 6.16.4 Critical Crafting (TV-R pp.161-162)

- **Trigger.** By `variants.critical.trigger`: `natural` (default, the book's suggested limit: a natural
  20 or 1 on the Craft check) or `any` (every critical success or failure). With
  `variants.critical.specialOnly` on (default), only orders flagged `variant.special` count; the
  requester or crafter sets the flag before start.
- **Effect.** When a triggering check settles (6.2.3), the check card opens a Critical Crafting panel:
  a category list written by the author in `lang/en.json` (no book text) and a note field. The result is
  stored as `check.critical = {kind: "success" | "failure", natural, category?, note, mode, made?, by, at}`.
  `mode` is copied from the world setting `variants.critical.mode` when the result is recorded; the
  crafter does not choose it. `alongside` (default) keeps the ordinary money effect of the critical;
  `replace` drops it (a critical success then uses the success rate, a critical failure ruins nothing).
- **Made anyway** (review fix of M9a). Most of the book's critical failure examples still make the item
  (TV-R pp.161-162: secretly cursed, draining the crafter, completed by a malevolent mind, failing when
  used). A critical failure's record carries `made`, on by default for those four categories
  (`MADE_DESPITE`); the crafter's owner or a GM may say otherwise. A made critical failure settles as a
  success would (`finishing`, the committed materials expended, extra days at the success rate,
  `settledAsSuccess`); recorded after a settlement that failed the order, it moves the order on by an
  undoable `made` transition (4.2.3: what the settlement released is committed and expended again, a
  ruin stays spent). The finished item carries `flags.MOD.curse = {from: "critical-crafting", category,
  note, crafter, order}`. A record may be written before the settlement on a check that triggers, which
  is how a GM who sees a secret roll keeps it secret: settled, a secret critical failure that made the
  item reads as a success to players (`shownDegree`), and the Queue shows them nothing of the record,
  until a GM reveals it.
- **Optional automation for one example.** The crafter's curse (a penalty to future Crafting checks
  until a critical success or a 4th-rank *cleanse affliction*) can be applied as an effect item on the
  crafter with a status penalty to Crafting checks of the size the table enters (default 1,
  interpretation). The roll wrapper removes it when the crafter next critically succeeds at a Craft
  check; anyone who owns the crafter can remove it after the spell. Every other example is a note.
- **Secret rolls.** With `variants.critical.secret` on and a GM connected, Craft checks for special
  orders are rolled blind (pf2e's `Statistic#roll` with `messageMode: "blind"`, a key of
  `CONFIG.ChatMessage.modes`; pf2e reads no `rollMode`). Recording still works, because the outcome is in the message flags (6.12),
  but while the check is unsettled players see the order as "rolled (secret)" in the Queue and on the
  card augment, and only GMs see the degree. Settling reveals it: a GM's "Reveal", the crafter's "Reveal
  and settle", or the automatic settlement at the order's next day resolution (4.2.3), whichever comes
  first, so nothing waits on a GM. As with the roster snapshots (4.10), this is a display rule in a
  cooperative trust model: the degree is in the shared document. With no GM connected the setting has
  no effect (P2).
- **Tests.** Natural and any-critical triggers, the special-only filter, replace versus alongside in the
  reduction totals, the curse effect's removal on a later critical success, a secret roll shown to
  players as "rolled (secret)" until it settles.

#### 6.16.5 Converting magic items: Deconstruct (TV-R pp.162-163)

An order with `craftType: "deconstruct"` and `target` set to the item being broken down, which is on
the crafter or earmarked in the strongbox (G10).

- **Fields.** `variant.deconstruct = {purpose: "similar" | "raw", similarTo?: {family, category,
  note}, damaged: bool, lossPct, followOn?: orderId}` (`followOn` only with purpose `similar`). The
  purpose is chosen at start and frozen.
- **Gates.** D1: the item's level is at most the crafter's. D2: master for 9+, legendary from
  `rules.legendaryItemLevel` (the book's own text says 16). D3: not cursed, not an artifact, not
  otherwise hard to destroy (traits plus a registry list). D4: not a consumable (the consumable trait or
  the registry fix of 6.3). D5: it has a Price. D6: tools as G7, and the workshop as a checklist item
  (an alchemist's lab for alchemical items). D7: Alchemical Crafting for alchemical items, Magical
  Crafting for magic items. G10 and G11 as usual. No formula or access is needed.
- **Time and check.** One downtime day (the order's single setup day), then a Crafting check against
  the item's level DC plus its rarity adjustment; the easy-repeat adjustment does not apply. No money
  moves, so the order takes none: pledges and party-fund earmarks are refused (`moneyless`), as for a
  quest (review fix of M9a).
- **Outcomes.**

  ```js
  // Share of the deconstructed item's Price, TV-R p.162, by degree (success, critical success).
  const DECONSTRUCT_PCT = { similar: { 2: 75, 3: 80 }, raw: { 2: 50, 3: 55 } };

  // `lossPct` lowers the item's value; the share then applies to the reduced value.
  function deconstructCredit(item, degree, d) {
    if (degree < DEGREE.success) return 0;
    const valueCp = item.priceCp * Math.max(0, 100 - d.lossPct) / 100;
    return Math.floor(valueCp * DECONSTRUCT_PCT[d.purpose][degree] / 100);
  }
  ```

  - Success or critical success: the item becomes components. The item document is kept, so its Bulk
    stays the original's (TV-R p.162); it gets `flags.MOD.components = {valueCp, purpose, similarTo,
    from: sourceUuid, order, at, expiresDay?}`, is unequipped and uninvested, and is marked inert with a
    "(components)" suffix through the inert guard (7.7). The order completes.
  - Failure: the day is wasted; the crafter may retry (`attempt` + 1).
  - Critical failure: the item is damaged (`damaged = true`). A retry needs a Repair service on it
    first (4.5), which clears the flag, or the crafter accepts losing 5% of its value, which adds 5 to
    `lossPct` for each such retry (per retry rather than once is an interpretation, OQ-45). The damage
    and the loss accepted so far are written on the item too (`flags.MOD.deconstructDamage = {damaged,
    at, lossPct, order}`), so a new Deconstruct of the item inherits them and starts only after a repair
    or with the loss accepted, as a retry does (review fix of M9a). The loss
    lowers the value the share applies to: after one unrepaired retry, a 100 gp item deconstructed for a
    similar item with a success credits 75% of 95 gp, 71 gp 2 sp 5 cp.
- **Using components.** On a later order, a components item is earmarked as a material line `{kind:
  "components", itemUuid, valueCp}`. At most one components item per order, because components from
  different deconstructed items cannot be combined. Credit with purpose `similar` counts only toward an
  order whose product the crafter confirms as similar in ability or theme (a checklist item, P1);
  otherwise the raw percentage is used. The confirmation is made before an attempt commits (the start
  or a retry) and frozen with it, since the coins committed were reckoned against it (review fix of
  M9a). The credit covers the up-front half first, then the remainder
  at finish; anything above the new item's Price is lost and never refunded. On a failed Craft the line
  is released like coins; a critical failure ruins 10% of its value with the rest of the materials, and
  the same amount comes off the components item's own credit in the same request, so the item given
  back by a cancel counts for less (review fix of M9a).
  Ledger rows are `material-in` and `material-out` with the credit value; no coins move.
- **The deconstruct day as a crafting day.** Only a Deconstruct with purpose `similar` can name a
  `followOn`, and only an order whose product the crafter has confirmed as similar (the same checklist
  item as for the credit). Its deconstruct day then also counts as one setup day of that order (TV-R
  p.162). Requiring the Deconstruct to succeed first is an interpretation (OQ-45): the book does not say.
  The credit is written when the Deconstruct check settles as a success, not when the day is resolved,
  since the check is rolled after the day: the settling client writes a `setup` record keyed
  `days.<actorId>-<day>-<followOnId>` (4.8) for the deconstruct day, carrying the follow-on's current
  attempt, or the attempt its start will create when it has not started yet. A crafter swap or retry of
  the follow-on starts a new attempt and drops the credit, as for any setup day (6.2.5).
- **Expiry.** `variants.deconstruct.expiryDays` (default 0, none) gives components an `expiresDay`; the
  book leaves expiry to the GM.
- **Tests.** Credit for both purposes and degrees, the loss after unrepaired retries applied to the
  value (the 71 gp 2 sp 5 cp vector), the one-components rule, the excess lost at finish, the follow-on
  setup day written at settlement and refused for purpose `raw`.

#### 6.16.6 Nature crafting: Grow (TV-R pp.164-165)

An order with `craftType: "grow"` runs on the Craft machine with these differences:

| Aspect | Craft (6.2) | Grow |
|---|---|---|
| Feats | G4 | the same: Alchemical, Magical or Snare Crafting by item type |
| Formula | optional for common items | required: only the `known`, `family` and `virtual` routes; other routes must finish first |
| Tools | G7 | cultivation tools, or another set the table picks (for example an instrument): a checklist item |
| Materials | raw materials worth half the Price | fertilisers and nutrients worth half the Price; the same escrow rules, and rarer precious materials still need stock items |
| Setup | 1 or 2 days, or Table 5-1 under Complex Crafting | 4 days, with or without a formula, and never rushed |
| Skill | Crafting | `variants.natureCrafting.skills` (below) |
| After a success | extra days | extra days, or untended growth |
| Outcomes | 6.2.3 | the same, including the 10% ruin on a critical failure |

- **Untended growth.** After a success, the crafter can set `variant.grow.mode = "untended"`: the order
  no longer occupies their downtime. At the end of each season in which the crafter spent at least one
  downtime day growing it, a season check is due (the same skill and DC); its degree reduces the
  remainder by one day of Income at the crafter's level and rank (critical success: level + 1), once per
  season (interpretation of "the corresponding amount", OQ-43). Seasons come from the core calendar's
  seasons when the world's calendar defines them, otherwise every `variants.natureCrafting.seasonDays`
  workshop days (default 91) from the order's start. The check is prompted on the crafter's
  responsible client and keyed `season:<orderId>:<n>`; its record is a `season` record keyed
  `days.<actorId>-<day>-<orderId>` (4.8), so it never overwrites the crafter's own day record for the
  downtime they are spending on something else.
- **Foraging.** Gathering fertilisers with Herbalism Lore is an Earn Income job (6.10); the earner
  pledges the wages to the order like any other coins.
- **Skills.** `variants.natureCrafting.skills`: `crafting` (default); `nature`, where Grow uses Nature
  instead of Crafting for G1, G3 and the roll; or `nature-arcana`, the book's hybrid, where Grow uses
  Nature and every other Craft uses Arcana in place of Crafting. The book advises against letting a
  player choose between Crafting and Nature item by item (TV-R p.165), so there is no per-order choice.
- **Tests.** The 4-day setup with and without Complex Crafting on, the formula requirement, season
  boundaries from a calendar and from the day count, one season check per season.

#### 6.16.7 Gardens of Wonder (TV-R pp.167-169)

A garden is a shared party resource that makes one perishable consumable a day.

- **Record.** `gardens.<id> = {party, name, kind, product: {uuid, level}, perDay: 1, seedCostCp,
  plantedDay?, by}` in the Workshop ledger. `kind` is free text (an orchard, a bakery, an ooze farm);
  the book's other kinds of garden (TV-R p.168) are the same rules with different Earn Income skills.
- **Seed cost.** The top of the permanent magic item price range for a level 2 higher than the
  product's (GM Core p.133, Table 2-19). Test vector from the book: a greater antidote (level 10) costs
  2,000 gp to plant, the maximum for a 12th-level permanent item.

  ```js
  // GM Core p.133 Table 2-19, top of each level's range, levels 1..20, in cp.
  const PERMANENT_PRICE_MAX = [2000, 3500, 6000, 10000, 16000, 25000, 36000, 50000, 70000, 100000,
    140000, 200000, 300000, 450000, 650000, 1000000, 1500000, 2400000, 4000000, 7000000];
  const gardenSeedCost = (productLevel) =>
    PERMANENT_PRICE_MAX[clamp(productLevel + 2, 1, 20) - 1];   // levels 19-20 cap at 20 (interpretation, OQ-43)
  ```

- **Funding.** Members pledge to the garden as to an order (`pledge` rows with `garden` set and `alloc`
  on the garden, 4.6). Earn Income with a suitable Lore can defray the cost; the earner pledges the
  wages. With Grow on, a Grow order whose product is the garden plants it, priced at the seed cost.
  Funding stops at the seed cost (`over-seed`), and the money comes back (review fix of M9a): a member
  takes back their own remaining allocation (a `withdraw` with `garden` set), and any member gives the
  party fund's share back (an `unearmark` pair), before the planting or of what it left, with gardens
  off too. Every take-back and the planting take the garden's slot (`garden-slot:<id>:<n>`, the number of
  rows that took money off it), so of two planned from the same copy only the first lands.
- **Planting** is derived: when a ledger update brings the garden's allocation to the seed cost, the
  responsible client for that change (`responsibleUserForShared` of the user who wrote it, 5.6) plants
  it in one lock-first batch (5.4): the lock page for the row keyed `plant:<gardenId>`, the `plant` rows
  (pro rata per contributor), the strongbox coin deletions, and `plantedDay`. Two pledges that complete
  the cost together may both trigger it; the second batch stops at the lock.
- **Limit.** At most half the party's PCs, rounded down, in gardens (TV-R p.167). The add button shows
  the reason when the party is at the limit; it is a rule, not a GM gate.
- **Harvest.** Each workshop day, one item per garden can be harvested by a member who marks "at the
  garden" that day. The harvester's own client creates the item on their actor, temporary, with a
  `world` expiry stamp ending that day (4.12). No preservation applies: registry `expiryRule` exceptions
  (Food Preservation and the like) are ignored for garden produce. A harvest is a lock-first batch
  (5.4, 5.5): the lock page keyed `harvest:<gardenId>:<day>` first, then the item creation, so a day's
  produce is created once even when two members harvest at the same moment.
- **Tests.** The seed-cost vector, the garden limit, one planting when two pledges complete the cost at
  once, one harvest per garden per day across two clients, expiry at the end of the day.

#### 6.16.8 Bestowed Gifts (TV-R p.166)

- An item can be recorded as a bestowed gift: `flags.MOD.gift = {bound: actorUuid, heirs: [actorUuid],
  giver (free text), at, by}`, written by its holder's owner, or set on delivery when a quest (6.16.9)
  or an order is marked as a gift.
- Held by its bound recipient or an heir, the item works normally. Held by anyone else, it is shown as
  dormant through the inert guard (7.7) on the holder's client. Naming an heir, as a true inheritance,
  is the current holder's action. Selling is not part of the module.
- The module keeps no treasure budget; gifts are listed with their Price in the Funds tab so a GM can
  count them against party treasure (TV-R p.166).
- **Tests.** Dormant on a non-bound holder, active again for an heir.

#### 6.16.9 Story-based crafting: crafting quests (TV-R pp.170-175)

An order with `craftType: "quest"`, normally for a permanent item (the book discourages quests for
plain consumables; the form says so but allows it).

- **Fields.** `variant.quest = {encounters, components: {[id]: {label, threat: "low" | "moderate" |
  "severe", found?: {by, day}}}, assemblyCheck, assemblySkill}`.
- **Cost.** No coins. The item's equivalent cost, counted against party treasure, drops by 10% of its
  Price per required encounter, never below half; the rest is spread across those encounters by
  reducing each one's treasure (TV-R p.172). The Queue shows both numbers, with the per-encounter
  budget from Table 5-3 (TV-R p.171, reprinting GM Core p.81) and a warning when the reduction exceeds
  an encounter's budget.

  ```js
  function questCost(priceCp, encounters) {
    const equivalentCp = Math.max(Math.ceil(priceCp / 2), Math.round(priceCp * (1 - 0.1 * encounters)));
    return { equivalentCp, perEncounterCp: Math.round(equivalentCp / Math.max(1, encounters)) };
  }
  // TV-R Table 5-3 treasure per encounter, levels 1..20, in cp: [low, moderate, severe, extreme].
  const TREASURE_BY_ENCOUNTER = [[1300, 1800, 2600, 3500], [2300, 3000, 4500, 6000],
    [3800, 5000, 7500, 10000], [6500, 8500, 13000, 17000], [10000, 13500, 20000, 27000],
    [15000, 20000, 30000, 40000], [22000, 29000, 44000, 58000], [30000, 40000, 60000, 80000],
    [43000, 57000, 86000, 114000], [60000, 80000, 120000, 160000], [86500, 115000, 172500, 230000],
    [125000, 165000, 247500, 330000], [187500, 250000, 375000, 500000],
    [275000, 365000, 550000, 730000], [410000, 545000, 820000, 1090000],
    [620000, 825000, 1240000, 1650000], [960000, 1280000, 1920000, 2560000],
    [1560000, 2080000, 3120000, 4160000], [2660000, 3550000, 5325000, 7100000],
    [3680000, 4900000, 7350000, 9800000]];
  ```

- **Flow.** `accepted` → `gathering` → (`check`) → `complete` (4.2.3). A quest under way keeps going once
  the variant is off: its components are still marked, it is still moved on and assembled; a new quest and
  its configuration need the variant on (review fix of M9a). Any member marks a component
  found, and writes only that component's `found` key; every mark names its author (5.10). Leaving
  `gathering` is a derived transition: the crafter's responsible client moves the order on when it sees
  every component found, so two members marking the last two components at the same moment cannot
  leave it stuck. Encounters should be low to severe threat (TV-R p.172); the form offers only those.
- **Assembly.** A quest of at least three encounters in different locations needs no check
  (`assemblyCheck: false` by default for those); otherwise the crafter rolls the chosen skill against
  the item's level DC plus rarity through the roll wrapper. Success: delivered. Failure: delivered with a
  quirk note. Critical failure: by `variants.quests.critFail`, `destroyed` (default, the order fails) or
  `cursed` (delivered with a curse note). The check settles through the quest row of 4.2.3, never the
  generic `finishing` path, and posts no money rows. Delivery uses the shelf and claims as usual (5.5).
- **Tests.** Cost floor at half, the per-encounter split, the assembly rule, two players marking
  components at once.

---

## 7. Daily preparations

### 7.1 What the Morning tab shows

The tab lists every daily source of the selected character, read from the system, plus the gap
registry. It never re-implements what the system does at rest.

| Source | System representation | Module adds |
|---|---|---|
| `advanced-alchemy` pool | one `CraftingAbility` merged from the alchemist class feature, the alchemist archetype's Advanced Alchemy, Herbalist, Poisoner, Morning Side Dishes and Munitions Crafter. Same-slug entries take the highest slot count and the union of item types, which Player Core 2 p.173 confirms is RAW | one pool view, loadouts, family grades, corrections (Herbalist −2) |
| `talisman-dabbler` | daily-prep `CraftingAbility` (2 slots, level ≤ half; Deeper Dabbler adds slots) | virtual formula list, DC stamp, affix planner (7.4) |
| `talisman-esoterica` | daily-prep `CraftingAbility` (2 slots, level ≤ half; Elaborate Talisman Esoterica adds slots) | virtual formula list (common GM Core talismans of your level or lower), affix planner; no DC stamp |
| `gadget-specialist`, `cauldron`, `horn-of-plenty`, `lethargy-poisoner` | daily-prep `CraftingAbility` | loadouts; Lethargy Poisoner correction |
| `snarecrafter`, `snare-genius`, `snare-specialist` | prepared slot ledgers (not daily), nothing is placed | shown read-only with slot costs (giant and broad snares cost 2) |
| `quick-alchemy`, `quick-tincture` | resource-based (`versatile-vials`) | combat (8) |
| `versatile-vials` | `SpecialResource`: highest source wins (class 2 + Int; Alchemist Dedication 4; Voluminous Vials; Firework Technician; Munitions Machinist; Wandering Chef) | per-vial material counts, regain (8.7) |
| Frequencies | Improvise Admixture, Fermenting Liquors, Persistent Mutagen, Alchemist's Haversack, Extra Vial | buttons that use the system frequency |
| Gap registry | features with no rule element (7.10) | entries with their own small flows |

Items are created only through `ability.setFormulaQuantity()` followed by
`actor.crafting.performDailyCrafting()`, on the character's owner client.

**Finding what a run created.** `performDailyCrafting()` returns nothing, and it adds items with
`inventory.add(..., {stack: true})`, whose stack test compares only `system` data, never flags
(verified). New output can therefore merge into an existing identical stack, for example a temporary
item delivered from another creator, and would then inherit that stack's expiry stamp. So:

1. Before the call, snapshot the actor's physical items (id → quantity).
2. Afterwards, new ids and quantity increases are this run's output.
3. If output merged into a stack that carries a different stamp, split the new quantity into its own
   item before stamping (create a copy with the new quantity, reduce the original).
4. Stamp (4.12), then apply the DC stamp where one applies (7.4).

The same rule applies to the item returned by `CraftingAbility.craft()`, which returns an existing
stack when it merges.

Save DCs: pf2e applies Powerful Alchemy itself, as an upgrade of inline `@Check` DCs on items with the
infused trait. The tab therefore shows the class DC only for prepared items that carry an inline check,
and the item's own DC otherwise. That upgrade is computed from the modifiers of whoever holds the item
(verified, `getCheckDC` in `system/text-editor.ts` uses `item.actor`), so an infused item handed to an
ally would fall back to its printed DC; the DC stamp written in step 4 above keeps the higher of the
printed DC and the creator's class DC with the item, and is written only when the class DC is higher
(8.10.4). Downtime-crafted alchemical items are not infused, so Powerful Alchemy never applies to them
and the Queue shows the item DC (or a badged legacy Potent Poisoner stamp, 8.10.4).

### 7.2 Daily preparation is optional on downtime days

GM Core p.46: characters may make their daily preparations if they want, and a standing routine can
repeat unless the player says otherwise. Each PC has a `standingRoutine` toggle (default off). Days
without preparation keep yesterday's infused items expiring on their own clock and create nothing new.

### 7.3 Versatile vials

- Refill and re-tiering happen in the system's Rest for the Night (the vial item is re-levelled only
  when the resource renews). The module never deletes or recreates the vial item.
- **Advanced Vials** (bomber, 11th): RAW chooses the material when each vial is created; the system has
  one global toggle. The module keeps `flags.MOD.vialMaterials = {plain: n, "cold-iron": n, ...}` on the
  vial item, set at preparation and when vials regain, and on each throw takes one from the chosen bucket
  and sets the system toggle for that Strike (OQ-22).
- The Quick Alchemy action uses the resource; the module gates on the vial count itself (8.3).

### 7.4 Talismans

- **Virtual formula list.** The talisman picker lists all common talismans of the actor's level or
  lower (Talisman Dabbler) or the common GM Core ones (Talisman Esoterica) from the compendium index, up to the pool's
  own item level (half the character's level) for daily preparation. Nothing is written into the formula book
  (DECISIONS 2026-10-26: Talisman Dabbler needs no formula book for talismans, Player Core 2). pf2e drops prepared
  formulas that are not in the known list (verified), so a virtual talisman cannot sit in the pool's prepared list: it is
  made with `CraftingAbility#craft(uuid, {consume: false})`, which checks neither the book nor the predicate (verified),
  after `performDailyCrafting()`, and the module counts it against the pool's slots and checks the pool's predicate and
  item level itself. A talisman the book does hold is prepared through the pool's list as before.
- **Setup for permanent talismans.** A Talisman Dabbler's knowledge of these formulas counts as having
  the formula, so a downtime talisman order uses the 1-day setup (the `virtual` route, 4.3).
- **DC stamp.** After `performDailyCrafting()`, the owner client rewrites inline saving throw checks
  (`@Check[fortitude|reflex|will|...|dc:N]`; a flat or skill check keeps its DC) on the new temporary talismans from
  Talisman Dabbler (found as in 7.1) to the highest of class DC, spell DC and the talisman's DC (Player Core 2: "any
  saving throw DC"). Talisman Esoterica has no such rule, so its
  talismans keep their own DC.
- **Affix records.** `flags.MOD.affix = {host: itemId, at, by}` on the talisman or spellheart, on the
  same actor as the host. Spellhearts share the records and the limit: one talisman or one spellheart
  per host. Hosts come from the item's usage (armor, shield, weapon variants) plus registry exceptions
  (bands of force and assassin's bracers count as light armor; handwraps count as a weapon; the hardlight
  buckler takes none). Bombs are excluded by design, because they are consumed (setting). More than one
  talisman on a host deactivates all of them (GM Core), except two on an item treated with Talismanic
  Sage. Affixing needs a repair toolkit (4.5). Time: 10 minutes per talisman; 1 minute with Rapid
  Affixture (3 actions at legendary); a Talisman Dabbler affixes up to 4 per 10 minutes, or 4 per minute with Quick Fix, which also allows a
  3-action affix from 12th level. The panel shows the time used within the 30-60 minutes of daily
  preparation (GM Core p.35).
- **Activation gate.** A talisman is usable only while its host is wielded or worn; the card warns.
- **Talisman Manager.** When it is active, the module does not record affixes (13).

### 7.5 Loadouts by family

A loadout stores, per pool, a list of families and quantities. Applying it resolves each family to the
highest grade that the pool's `maxItemLevel`, the actor's level and the family rule allow, writes that
tier into the book if needed (6.4), calls `setFormulaQuantity` for each, then `performDailyCrafting()`.
The tab shows a diff against the previous preparation (new formulas, new grades, party requests).

### 7.6 Standing orders

Standing orders and requests routed to "next preparation" pre-fill the crafter's Morning tab as chips.
After preparation, items for others are delivered: directly to the crafter's own other actors, through
the system trade when the user owns both, otherwise to the shelf (5.5). Expiry stamps travel with them.

### 7.7 Party-wide infused expiry

- The infused trait ends non-permanent effects at the creator's next daily preparations, but the system
  deletes temporary items only on the actor that rests, so infused items handed to allies survive.
- Every infused item from the creator's preparations or Quick Alchemy gets an expiry stamp with the
  creator's current `prepCycle` (4.12), on its own item document (7.1).
- Items from Advanced Alchemy and the merged advanced-alchemy pool also get `at: createdAt + 86,400 s`
  (world time) and `atDay: createdDay + 1`, and become inert at whichever comes first: one of those or
  the creator's next `prepCycle` (Player Core 2 Advanced Alchemy). A day without preparations therefore still ends them on time.
  Versatile vials and Quick Alchemy items keep their own rules (7.3, 8.8).
- After the creator actually makes daily preparations (7.8; on a downtime day only with preparation,
  7.2), the creator's responsible client increments `prepCycle` and writes one expiry claim. Each
  holder's responsible client (and the creator's client for the strongbox and shelf) marks matching
  items inert. A rest without preparation increments nothing. The `at` and `atDay` deadlines are
  checked on `updateWorldTime` and when the workshop day moves, by each holder's responsible client.
- **Inert.** Default: `flags.MOD.inert = true`, a localized "(inert)" name suffix, and a
  `preCreateChatMessage` guard that cancels use or Strike messages for that item with a notice (OQ-19).
  The holder's next rest deletes it anyway, because it is temporary. The alternative setting deletes it
  outright.
- **Exceptions** from the registry: Food Preservation's designated foods (designated from that cycle's Advanced Alchemy
  output, at most the cap a preparation and at once, the designations kept on the creator so a food given away still
  counts; a designated food stops being temporary so the holder's rest keeps it, and one pushed past the cap spoils at
  once, wherever it is, and is temporary again), Eternal Elixir, effects that
  are already afflictions in progress (an affliction started by an infused poison runs its course after
  the poison expires, 8.10.10), and anything a feat explicitly extends. Coatings made from an infused
  poison are not an exception: the coating is removed with it, while the coated weapon itself is never
  marked inert (4.12, 8.10.5).
- Effect items applied from an infused item should end with it; linking an effect to its origin item
  needs testing (OQ-19).

### 7.8 Rest ordering and pf2e-dailies

What happens at Rest for the Night (pf2e source, verified):

1. pf2e makes three separate writes: it deletes temporary items; it recharges frequencies and
   special resources (vials refill and re-level) and clears `dailyCraftingComplete` in one batched
   update; then it un-expends prepared formulas. Handlers must tolerate a phase having failed.
2. It fires `pf2e.restForTheNight` on the client that ran the rest only, then creates a chat message
   with the creation option `restForTheNight`, which every client sees.
3. If pf2e-dailies is active, it wraps the whole rest. After the system returns, it runs its own cleanup
   (deletes its own temporary items, removes its rule elements, re-creates items it had removed) and
   sets `flags["pf2e-dailies"].rested = true` in one batched update. Both system signals in step 2 fire
   before this cleanup.

The module's post-rest pipeline (increment `prepCycle`, expiry claim, one Morning prompt; for a PC in
downtime who chose not to prepare that day, only the prompt) therefore starts:

- without pf2e-dailies: on `createChatMessage` with `options.restForTheNight`, on the rested actor's
  responsible client, after a short settle (debounced until the actor's updates stop);
- with pf2e-dailies: on `updateActor` where `flags["pf2e-dailies"].rested` becomes true, with a timeout
  fallback (default 5 seconds after the rest signal).

When a GM rests the whole party from the party sheet, each character's prompt goes to that character's
responsible user, not to the GM.

### 7.9 pf2e-dailies integration

- Registered after `init` through `game.dailies.api.registerCustomDailies([...])` (the API lives at
  `game.dailies.api`, not on the module object).
- One custom daily, key `pf2e-artisans-workshop.morning`, shown when the actor has a daily-prep crafting
  ability or versatile vials. Its rows: a select per pool ("keep current preparation", which for a talisman pool
  makes the last preparation's virtual talismans again; each saved loadout; "prepare everything in the Workshop later",
  which makes nothing now) and a notify row listing standing orders.
- Its `process` only records the choices. It never creates items inside the pf2e-dailies flow, so the
  two modules' item bookkeeping never mixes. When pf2e-dailies finishes (its `rested` flag goes back to
  false), the owner client applies the chosen loadouts through the system methods (OQ-20).
- Features pf2e-dailies already covers (Flexible Studies, scroll caches, Scroll Adept, Scroll Esoterica,
  staff preparation, Root Magic and others) are never duplicated. Without pf2e-dailies, the Morning tab
  shows them as "not automated".

### 7.10 Gap registry entries

Daily features with no system rule element that the module handles as small Morning entries:
Food Preservation (designate foods exempt from expiry), Alter Admixture (10-minute swap keeping expiry),
Natural Mutagen, Herbal Forager, Chrysanthemum Leshy antidote tea, Imperial Dragon Potion, Practical
Magic, Contingency Gadgets (slots chosen when drawn), Witch's Bottle, Poisoned Sticks and Stones,
Prepare Elemental Medicine, Repurposed Parts, Magical Scrounger (Cobble Together a temporary common
magic item of half the actor's level or lower, once per day), Library Robes (re-inscribe the held
spell at daily preparations for the minimum scroll materials). Each entry creates temporary items with
an expiry stamp or records a choice; none touches system resources directly.

As built in M7 (10.13): sections 7.1-7.10 are built as written except where 10.13 says otherwise: virtual talismans are
made with `CraftingAbility#craft` and never written to the book (7.4, DECISIONS 2026-10-26); the cycle goes up only for a
character with a daily pool or versatile vials (7.7); `atDay` is read against the days logged ahead of the clock; a
standing order that does not fit is left out for the day (7.6); the gap entries record a tick per cycle and Food
Preservation's designations, and their item-making flows are follow-ups (10.13, Follow-ups (M7, low)).
As built in M9 (10.16): the prepared snare pools (`snarecrafter`, `snare-genius`, `snare-specialist`) carry a quick-deploy ledger
on the Morning tab: each prepared snare ready or deployed, giant and broad marks at two slots each (Giant Snare, Broad Snare), the
slots used against pf2e's count, and "Deploy" through pf2e's own `CraftingAbility#toggleFormulaExpended` (its `craft` expends
the slot and then makes nothing for a snare, gap 23; M9 review).

---

## 8. Combat

Everything in 8.1-8.8 runs only while the combat feature is enabled (on by default once the
master switch is on, P10). If PF2e Alchemist Remaster Duct Tape (`pf2e-alchemist-remaster-ducttape`)
is active, the whole section steps aside: no Bandolier, no HUD palette, no Quick Alchemy panel, no turn
expiry, no vial gathering. Settings shows why. Party-wide infused expiry at rest (7.7), "Use best
consumable" (8.9) and the affliction tracker (8.10) are not Duct Tape's territory and stay; they have
their own feature toggles and do not depend on `features.combat`.

### 8.1 Bandolier

A compact ApplicationV2 window with a minimal frame, docked above the hotbar, draggable, position
remembered per user. It can open automatically on combat start for the responsible user of an
alchemist combatant (user setting). Contents: vial pips and tier, field-vial damage type, Advanced Vials
material bucket, Quick Alchemy, quick vial, Healing Bomb, Double Brew state, ready bombs and elixirs with
their potency countdown, and "additive this round". Every Strike button runs the system Strike for that
item, so the multiple attack penalty, modifiers and damage cards are the system's.

### 8.2 Token HUD palette

One `control-icon` button (flask) injected into the token HUD's left column in `renderTokenHUD`
(HTMLElement), with a `.palette[data-palette="MOD-alchemy"]` next to it. Core's `togglePalette` action
opens and closes it. Shown only to owners of an actor with Quick Alchemy. It is the fallback when the
Bandolier is closed.

### 8.3 Quick Alchemy panel

- Searchable list of formulas the actor can make with Quick Alchemy: in the book or covered by family
  (any level of a known item), level ≤ actor level, matching the `quick-alchemy` ability's predicate.
- Creation calls `actor.crafting.abilities.get("quick-alchemy").craft(uuid, {consume: true, destination:
  "hand"})`. `craft()` itself checks neither the formula nor the predicate (verified), so the panel
  gates both, and it refuses at 0 vials (the system chat path crafts for free at 0).
- **Double Brew** (9th): two picks, one vial per consumable; the two may be the same item (two bombs of one kind,
  two elixirs of life: its most common use).
- **Combine Elixirs** (additive): one extra vial; it is the item's one additive (8.6). The combined elixir carries
  both: their healing summed in its `system.damage`, which pf2e's own `consume()` rolls from any sheet, and the second's
  description (its effect link) after the first's.
- **Balm Bomb** (additive): one extra vial for a common alchemical healing elixir the alchemist could make, picked with
  the bomb and named on it and its card.
- **Healing Bomb** (additive): offered when the pick is an elixir of life (8.6).
- A pick that ends in a throw (Quick Bomber, "throw it at the target") asks which of pf2e's Strike variants (the
  multiple attack penalty), which pf2e does not track.
- **Potency** stamps: start of the creator's next turn; end of the next turn for tools and elixirs with
  Enduring Alchemy; effects capped at 10 minutes (8.8).
- Keyboard: type to filter, arrows to move, Space to pick, Enter to create, Esc to close.

### 8.4 Quick Bomber

One action: draw a bomb or vial, or Quick Alchemy a bomb, then Strike. The panel picks the best ready
bomb of the chosen family (held, then worn, then stowed; soonest-expiring infused first) or creates one,
then runs the system Strike against the current target, with the multiple attack penalty variant the user picks (pf2e
does not track it). Only one bomb, even with Double Brew.

### 8.5 Quick vials

Free; usable only as a bomb or for the field-vial option; potent until the end of the current turn.
The system cannot craft its own resource item, so the module creates the quick vial itself: a temporary,
infused copy of the current vial tier with a different source identity, because pf2e reads the vial
resource from the first item whose source matches the Versatile Vial (verified) and a matching copy would
corrupt the count. Abundant Vials (17th): the quickened action may only make one quick vial per turn,
tracked per turn.

### 8.6 Healing Bomb and additives

- **Healing Bomb** (additive, Player Core 2): only when the alchemist creates an elixir of life with
  Quick Alchemy (one vial; not a quick vial, and never an elixir from Advanced Alchemy, downtime
  crafting or purchase). It uses that item's one additive and the actor's one additive this round, so
  it cannot be combined with Combine Elixirs on the same item. The elixir is then thrown as an Interact
  within 20 feet; the target gets the elixir's effect as if it had drunk it, and each adjacent living
  creature regains HP equal to the elixir's number of damage dice (read from the item's own healing
  formula, never hard-coded). The card offers per-creature "apply" buttons; each creature's owner, or a GM,
  applies it, and the card is whispered to every one of those owners. Without a canvas (or a target with no token on
  it) the creature is picked from the party and the encounter, and the card lists the party's living members other
  than the target, since who stands next to it is not known (As built in M8, second review).
- **Additives** (Player Core 2 additive trait): only on Quick Alchemy consumables, never quick vials; one
  per item; at most one per round per actor in an encounter (outside one there are no rounds, and the limit is not
  enforced: DECISIONS 2026-10-27). The picker lists only additives the registry says fit the
  item. The chosen additive is a flag on the created item; per-Strike effects use the system's own toggles
  where they exist (OQ-27), set only for the Strike that needs them and put back as the player had them.

### 8.7 Vial gathering

- On `updateWorldTime` outside combat, the alchemist's responsible client adds 2 vials per full 10
  minutes of elapsed time (3 with Alchemical Expertise), carrying the remainder in
  `flags.MOD.vialClock`. Skipped while the actor is in an active combat or flagged in downtime.
- **Cap re-check.** The value is re-read at write time and written with `actor.updateResource`, which
  also clamps to the maximum. A second click or a second client can never push past the cap.
- Only sources the registry marks as regaining do so: the alchemist class and Firework Technician.
  Other vial sources do not regain during the day (Player Core 2 p.173).
- Buttons: "Gather reagents (10 minutes)", logged to chat; Improvise Admixture (Crafting vs the level
  DC: 3/2/1/0 vials, once per day through the feat's frequency); the Alchemist's Haversack daily vial;
  the familiar's Extra Vial (where present in the data, OQ-28).

### 8.8 Expiry on turn hooks

- `pf2e.startTurn` and `pf2e.endTurn` fire only on the active GM. The module uses core
  `combatTurnChange(combat, previous, current)`, which fires on every client (verified), guarded by the
  responsible client of the creator. (As built in M8: of each holder, as 7.7's expiry is, so an item handed to an ally
  ends on the ally's client; 10.14.)
- Quick Alchemy consumables: inert at the start of the creator's next turn; tools and elixirs with
  Enduring Alchemy at the end of the next turn; quick vials at the end of the current turn. The stamp records whether it
  was the creator's own turn and, if not, whether the creator was still to act that round, never a turn index to compare
  later: Foundry renumbers the turns when a combatant is added, removed or re-sorted (second M8 review).
- Outside combat, Quick Alchemy items expire once world time advances by one round (6 seconds), and at
  combat end (setting).
- The 10-minute cap: effect items whose origin is a Quick Alchemy item get their duration clamped to 10
  minutes unless a registry `expiryRule` allows more (OQ-19): Eternal Elixir (elixir level at most half
  the creator's level; indefinite; a new indefinite elixir ends the previous one) or Persistent Mutagen
  (once per day, an infused mutagen, until the next daily preparations). Extend Elixir doubles
  durations of 1 minute or more but stays capped at 10 minutes for Quick Alchemy items.
- Splash: the panel and the card show splash numbers (Int with field discovery, minimum 1; twice Int
  with Expanded Splash; radius 5, 10 or 15 feet; Directional Bombs' cone; the primary-target-only
  option). Template placement with v14 Regions is OQ-29.

### 8.9 Use best consumable

A family-aware picker that replaces PF2e Convenient Consumables (which has no licence, so its code is
not reused). It is not combat-specific and does not step aside for Duct Tape. Feature toggle
`features.consumables`.

- **Call.** `api.consumables.useBest({family*, actor, target})`, for example the elixir of life, healing
  potion or antidote family. Families come from compendium data (6.4), not hard-coded slug lists, so
  Remaster items, quick vials and versatile vials are included.
- **Choice.** Within the family: held, then worn, then stowed; among equals, the soonest-expiring
  infused item first; inert items (7.7) are skipped. The picker shows quantity and expiry, and asks
  only when two choices are equally good.
- **Use.** Through the system: `game.pf2e.rollItemMacro` and `item.consume()`; weapons such as bombs
  go through the system Strike (8.4).
- **Party view** (optional): who holds one, from the roster snapshots' `consumables` counts (4.10).
  Handing one over is the system trade or the strongbox; the module never moves another player's item.

As built in M8 (10.14): sections 8.1-8.9 are built as written except where 10.14 says otherwise: turn expiry is marked by
each holder's responsible client, as party-wide expiry is (7.7), not by the creator's (DECISIONS 2026-10-26); what pf2e's own
Quick Alchemy action makes is stamped too; vial-gathering buttons live in the Bandolier and work whenever the combat
features do (`features.vialGathering` governs the clock only); Extra Vial (OQ-28) has no button yet; the party view of
8.9 is the API's `consumables.holders` only.

### 8.10 Affliction tracker

A stage tracker for poisons and other affliction-bearing consumables the module crafts or uses. Like
8.9 it is not combat-specific and does not step aside for Duct Tape; its feature toggle is
`features.afflictions` (on once the master switch is on, P10; nothing happens until someone exposes a
creature). It needs no GM for afflictions on player-owned actors (P2); the one carve-out is a
hand-off to Affliction Forge (8.10.11).

Rules, paraphrased (Player Core pp.430-431; GM Core p.248):

- **Initial save** on exposure. Success or critical success: unaffected by that exposure. Failure:
  stage 1. Critical failure: stage 2. Either one waits for the onset, if there is one.
- **Onset**: the first stage's effects wait until the onset time has passed.
- **Maximum duration**: once it has passed, the affliction ends; without one it lasts until saves end it.
- **Stages**: each lists effects and an interval. At the end of the interval the creature saves again:
  success −1 stage, critical success −2, failure +1, critical failure +2, and then takes the new
  stage's effects. Below stage 1 the affliction ends. Past the highest stage, the highest stage's
  effects repeat.
- **Damage and conditions**: a stage's damage happens when the stage is reached. Its conditions last
  their normal duration (drained outlives the affliction; frightened still decreases); conditions and
  penalties with no duration of their own last while the creature is at that stage.
- **Multiple exposures**: none for a curse or disease already affecting the creature. For a poison, a
  failed initial save against a new exposure adds 1 stage (2 on a critical failure) without changing
  the maximum duration, even during the onset (whose length does not change); if there is no onset or
  it has passed, the new stage's effects apply at once. An item's own text can override this:
  Lethargy Poison and Stupor Poison say that further exposure calls for no new save and only the saves
  of the ongoing exposure move the stage (the `reExposure: "none"` override, 8.10.2).
- **Virulent**: two consecutive successful saves reduce the stage by 1; a critical success reduces it
  by only 1.
- **Level**: an affliction with no level listed has the level of the item that causes it.
- **Incapacitation** (Player Core p.457): a creature of higher level than the item behind an
  incapacitation affliction (Lethargy Poison, Stupor Poison, Curare) treats each of its saves against
  it, initial, stage and re-exposure alike, as one degree better. The system applies this itself when
  the save is given the item (8.10.8).
- **Method of exposure** (GM Core p.248): contact, ingested, inhaled and injury, as in 8.10.3.

#### 8.10.1 Built on the system's affliction item

The pf2e `affliction` item type (`AfflictionPF2e`, `src/module/item/affliction/`: `data.ts`,
`document.ts`, `sheet.ts`) is the model. Verified at the dev head checked:

- **Data** (`AfflictionSystemData`): `level`, `traits`, `save {type, value}`, `status {onset, stage,
  progress}` (`progress` is documented as relevant only to virulent afflictions), `onset {value, unit}`
  or null, `stages[] {damage[] {formula, damageType, category}, conditions[] {slug, value, linked},
  effects[] {uuid}, duration {value, unit}}`, `duration` (the maximum duration, with `expiry`), `start
  {value, initiative}`, `fromSpell` and `context` (origin, target, roll). The stage is clamped to
  1..number of stages.
- **Behaviour.** A counter badge reading "Onset" or "Stage N". `increase()` ends an onset or adds a
  stage; `decrease()` removes one and deletes the item below stage 1. On creation and on every stage
  change, `handleStageChange()` runs on `actor.primaryUpdater` only: it deletes the conditions it had
  linked, except frightened, sickened, drained, doomed, stunned and unconscious; creates or updates the
  new stage's conditions; and posts the stage damage as a pf2e damage roll. `rollRecovery()` rolls the
  save with the item's roll options, then calls `decrease()` on any success and `increase()` otherwise.
  `remainingStageDuration` uses the effect duration helper with `turn-end` expiry, and `_preCreate`
  records `start = worldTime + onset` with the initiative of the origin's combatant (or the current
  combatant). Only the chat card's "affliction-save" button calls `rollRecovery()` (verified,
  `chat-message/listeners/cards.ts`). The effects panel calls `increase()` on a left-click and
  `decrease()` on a right-click of any effect-like item, afflictions included (verified,
  `apps/effects-panel.ts`); on an `effect` item those change `system.badge.value`, and a decrement below
  the minimum deletes the effect (`EffectPF2e._preUpdate`). The sheet edits stages, onset, damage and
  conditions, and accepts effect items dropped on a stage.
- **Availability.** Release builds delete the type from `game.system.documentTypes.Item` at `init`,
  register no data model for it, drop it from the item-create dialog, and its constructor throws ("not
  available in production builds"). Verified in the source and in a released 8.3.0 bundle. No rule
  element, macro or sheet in the system creates one. In a released world today, no affliction item can
  exist.

So the tracker has one data shape and two backends, picked by feature detection at `ready` (3.1;
see OQ-47):

| Backend | When | Document on the victim | Shown by |
|---|---|---|---|
| `native` | `CONFIG.Item.dataModels.affliction` exists and `game.system.documentTypes.Item` lists `affliction` | an `affliction` item with the schema above, created once the first stage takes effect (Native constraints, below) | the system's sheet, badge and effects panel |
| `effect` | otherwise (every pf2e release to date) | an `effect` item: the source's traits and image; `duration.unit: "unlimited"`, so the system's effect tracker never removes it; a counter badge whose labels are the stage names (from `PF2E.Item.Affliction.Stage`), so the effects panel shows "Stage N"; identification as in 8.10.8 (Hidden information); and the affliction data in `flags.MOD.affliction.system`, in exactly the `AfflictionSystemSource` layout | the system's effects panel and badge |

- In both backends the module's run state is `flags.MOD.affliction.run` (8.10.6), and the module drives
  `status` itself. It never calls `increase()`, `decrease()` or `rollRecovery()`, which depart from
  the rules: an increase ends the onset early, neither knows critical degrees or virulent, and nothing
  handles the initial save, the maximum duration or multiple exposures (6.15).
- A migration (4.14) converts effect-backed afflictions into native items the first time a GM loads a
  world where the type is available, within the native constraints below. The churn watch (3.3)
  reports the release that enables it. Whether the schema still matches then is OQ-44.
- **Stage changes** follow `handleStageChange` in both backends. Stage conditions are created through
  the system's ConditionManager and granted by the tracker item, with `flags.pf2e.grantedBy.onDelete`
  chosen so that ending the tracker removes exactly what the native code removes. pf2e's grant clean-up
  (`processGrantDeletions`, verified) deletes every grantee listed in the deleted item's
  `flags.pf2e.itemGrants` whose `grantedBy.onDelete` is `"cascade"`, while the native type removes only
  its linked conditions and spares frightened, sickened, drained, doomed, stunned and unconscious
  (`EXPIRING_CONDITIONS`, through `getLinkedItems`). So:
  - those six expiring conditions, and any stage condition marked `linked: false`, get `onDelete:
    "detach"`: they outlast the affliction, which matches Player Core p.430 (conditions last their
    normal duration; drained outliving a poison's maximum duration is its own example);
  - every other stage condition and every stage `effect` gets `onDelete: "cascade"`;
  - the tracker's own `itemGrants` entries always get `onDelete: "detach"`, so frightened decaying to 0,
    or a hand-deleted condition, never deletes the tracker.
  Linked conditions are removed at the next stage change. In the native backend the system already
  applies stages on `actor.primaryUpdater`, which can be an offline player when no GM is connected
  (5.6); the module does it itself, on the victim's responsible client, only when `actor.primaryUpdater`
  is not connected, so exactly one client applies each stage.
- **Native constraints.** The native type's `handleStageChange` does not do everything the tracker
  needs (verified, `item/affliction/document.ts`): `_onCreate` runs it as soon as the item exists, so a
  native item created at exposure would apply stage conditions during the onset; stage damage is posted
  only while `system.onset` (the onset definition, not `status.onset`) is absent; and `_onUpdate` reacts
  only to a change of `system.status.stage`, so the end of an onset, a repeated highest stage and a
  virulent success that changes nothing trigger nothing. The native backend therefore creates the
  native item only when the first stage takes effect, holds the onset in the run state (as an
  effect-backed item with the "Onset" badge until then) and never writes `system.onset`, and for a
  repeated stage re-applies its conditions and posts its damage itself (the item's own
  `createStageMessage()`). The migration deletes each effect-backed item together with the conditions it
  granted that are not expiring, then creates the native item; `_onCreate` re-applies the stage's
  conditions under the new item and posts the current stage's damage once more, a card that is either
  suppressed or marked as a migration re-post (OQ-44).
- **The tracker owns its stage.** A `preUpdateItem` and `preDeleteItem` guard, on the client that makes
  the change, catches any change to a tracker item the module did not make (its own writes carry a
  module operation option): an effects-panel click, `increase()` or `decrease()` from a macro or another
  module, a sheet edit of the stage, the badge or the onset. An update is cancelled and replayed as a
  module "manual adjust" to the stage it asked for (in the native backend, `increase()` deleting
  `system.onset` becomes an "end onset" adjust): author recorded, conditions re-applied from the run
  state, undoable as in 8.10.9. A deletion the module did not make (a right-click at stage 1, or a hand
  deletion) is allowed and recorded as a manual end (8.10.9), and the grant rules above decide which
  conditions go with it.
- **Damage** is posted as a pf2e damage roll card with the system's apply buttons and is not applied
  automatically. `afflictions.autoApplyDamage` (default off) applies it on the victim's responsible
  client through `actor.applyDamage`.

#### 8.10.2 Definitions from the installed compendium

- Compendium items carry their afflictions only as description text. At the dev head checked, 133 of
  the 163 consumables with the poison trait have a `Stage 1` paragraph and one more (Unending Itch)
  writes its stages as a single "Stages 1–5" paragraph; about twenty other items have stage paragraphs
  too (drugs, bombs such as the Blightburn Bomb, an ampoule, a talisman, a few weapons). The other poison
  consumables (wands, some elixirs and snares) have no stages and are not afflictions.
- The parser runs at runtime, on the client that needs a definition, over the description of the item's
  compendium source (`sourceId`), falling back to the item's own description. Results are cached in
  memory per source UUID and pf2e version. No text is stored. A definition whose source is not a
  compendium document (a homebrew poison made on a sheet, a world item) cannot be read again once its
  item is gone, so the exposure claim, the coating or cloud and the tracker keep it (numbers, slugs and
  UUIDs only, P9), and a coating or cloud exposes after its last dose is spent (second M8a review).

  | Part | Read from |
  |---|---|
  | Save type and DC | the first inline `@Check[<save>\|dc:<n>...]` (language-independent) |
  | Onset | the Onset paragraph: value and unit, or a dice formula such as "1d6 minutes" or "1d4 days" (an inline `[[/r ...]]` roll), rolled once at exposure |
  | Maximum duration | the Maximum Duration paragraph |
  | Stages | the `<strong>Stage N</strong>` paragraphs in order, and range labels such as `<strong>Stages 1–5</strong>`, which give every stage in the range the same effects and interval; the label is also matched in the system's localized `PF2E.Item.Affliction.StageLabel` |
  | Interval | the stage's last parenthesised duration: rounds, minutes, hours, days, or a dice formula such as "1d4 hours", rolled once each time the stage starts |
  | Damage | `@Damage[...]` terms with type and category (persistent, splash) |
  | Conditions | `@UUID[Compendium.pf2e.conditionitems.Item.<name or id>]{<label> n}` links (pf2e's source packs link by name, its build writes the condition item's id, which is what the installed compendium carries at runtime: M8a live pass), and bare condition names with a value, mapped to pf2e condition slugs |
  | Effects | `@UUID` links to effect items |
  | Delivery, virulent, level | the item's traits (contact, ingested, inhaled, injury, virulent) and its level |
  | "as stage N" | a copy of that stage's parsed effects |

- **Output** is an `AfflictionSystemSource`-shaped object (numbers, slugs and UUIDs only) with
  `confidence: "full" | "partial" | "none"`, and `unparsed: true` on stages whose text the grammar
  could not map. A partial definition still runs: timing, saves and stage changes are automated, and
  the unparsed part of the current stage is shown by rendering that stage's paragraph from the source
  item at display time, for the table to apply by hand. A stage whose text qualifies its mapped parts
  applies none of them: a choice between them ("clumsy 1, enfeebled 1, or stupefied 1", "cold or fire
  damage"), a condition on them ("if", "unless", damage "for lying", "for each action", "each time",
  "once every"), a duration of their own ("doomed 1 for 1 round", "paralyzed for 2d4 hours",
  "permanently"), or acting "as if" under one; an override may name the parts that do apply (Curare's
  stage 3, Reaper's Shadow's damage). "As stage N, but ..." replaces the parts of stage N that it names
  ("but also" adds to them), and a copy of a stage that applies nothing applies nothing (second M8a
  review).
- **Overrides.** `scripts/data/afflictions.mjs`, keyed by slug with the source UUID alongside (as the
  registry, 6.11), holds structured definitions for items that do not parse or parse wrongly: stages
  with damage formulas, condition slugs and values, intervals; onset; maximum duration; save type; and
  flags for rules an item's intro changes outside its stage paragraphs, such as `voluntaryFail` for
  drugs and `reExposure: "none"` for Lethargy Poison and Stupor Poison (further exposure calls for no
  new save, 8.10). Numbers and slugs only (P9). CI finds candidates by any `Stage` or `Stages` label, or
  an Onset or Maximum Duration paragraph, not by `Stage 1` alone, runs the parser over every candidate
  in the system packs, and fails on any that neither parses fully, nor has an override, nor is on the
  ignore list (6.11, 15.2). Because an intro can change the general rules while the stages still parse
  fully, CI also flags for human review every candidate whose intro mentions further, additional or
  multiple exposure, until it has an override or an ignore-list entry saying it changes nothing, and
  likewise every candidate whose intro names one of its stage conditions with "cumulative", "can't be
  removed" (reduced, ended), "lasts for", "ends when" or "while the poison lasts". The override flags
  for those: `cumulative` (the value adds the stage's on each failed save and never goes down while the
  affliction lasts: King's Sleep's drained), `detach` (the condition outlasts its stage and the
  affliction, its own duration the table's: Nethershade's enfeebled) and `intro: "table"` (reviewed: the
  intro's rule is the table's to apply: Fearweed, Daylight Vapor, Arsenic). A pf2e release that changes
  a parse result opens a churn issue (3.3).
- **World definitions.** When nothing parses (a translated description, OQ-46, or homebrew), Expose
  opens a small form: stages, intervals, save, onset, maximum duration, and each stage's conditions and
  damage. Any member can fill it in; it is stored as `afflictionDefs.<hash of source UUID>` in the
  ledger with its author, and the whole party reuses it. Precedence: world definition, then override, then parse.

#### 8.10.3 Exposure and delivery

| Delivery | Exposed when | Created by | Notes |
|---|---|---|---|
| Injury | a Strike with a coated weapon or piece of ammunition succeeds and deals piercing or slashing damage (8.10.5) | the attacker's client, the author of the damage roll | GM Core p.248 |
| Bomb or other Strike item with stages | its Strike hits the target, as the item's own text says | the attacker's client | for example the Blightburn Bomb, which exposes only its primary target; the card offers Expose for splash targets only when the item's text says they are exposed |
| Contact | the first creature touches an item coated with it, or it is put straight on a creature's skin | the applier, or the toucher's owner through the coated item's "touched" button, with a coating-spend claim when someone else owns the item (8.10.5) | cannot be delivered by a weapon attack; onsets are usually 1 minute |
| Ingested | the creature consumes it, or food or drink treated with it | the consumer's client, from the system's use card, or the treated item's "eaten" button (a coating with `delivery: "ingested"`, 8.10.5) | onsets from 1 minute to 1 day |
| Inhaled | it is unleashed: a cloud filling a 10-foot cube for 1 minute, or until a strong wind; every creature that enters | the user who unleashed it; later entrants from the cloud card | a creature aware of the cloud can hold its breath (one action) for +2 circumstance to that save for 1 round |
| Expose (manual) | any user picks an item with stage text and a target | that user | traps, creature abilities, spells, anything the table wants tracked |

- Applying a poison is an Interact: one hand to pour it into food or scatter it in the air, two hands to
  coat a weapon or an item (GM Core p.248). The module spends the dose through the system (the owner's
  `item.consume()` or a quantity update) and does not count actions; the card names the action cost,
  which registry `delivery` entries change (the toxicologist's single action, Poison Weapon).
- Using a poison through the system's own use button posts the system's card. The module's
  `renderChatMessageHTML` augment adds Expose with the delivery its traits imply (ingested: the user;
  contact: a target in reach; inhaled: the cloud). Nothing happens without that click, so the system
  flow is never changed.
- **Exposure claim** (5.5): `{kind: "exposure", target, source: {uuid, itemUuid?, name, level, traits},
  def, dc: {value, source, creator?}, delivery, mods: [{slug, value}], combat?: {id, round,
  initiative}, by, at}`, keyed `expose:<messageId>:<targetUuid>` (or a nonce fixed when a manual Expose
  is confirmed), so a hook seen twice exposes once. For an unlinked token the target is the token
  actor's UUID.
- The target's responsible client applies the claim: the initial save (8.10.8), then, on a failure, the
  tracker item (8.10.6), in one lock-first batch (5.5). Claims for one target are processed in `at`
  order. A later claim from the same source (or the same world definition) waits until the earlier one
  is resolved, and is then applied as a re-exposure if the earlier one left an active affliction, or as
  a new initial exposure if it did not.
- A target immune to the affliction's type (a pf2e immunity such as poison) is unaffected: the claim
  resolves with a note and no save. The toxicologist's field benefit (its infused poisons affect
  poison-immune creatures and deal acid instead) is a registry `afflictionModifier`: the save happens
  and the stage damage type becomes acid.

#### 8.10.4 Which DC applies

The first match wins:

1. a world definition or override DC (for an item whose printed DC is wrong);
2. a DC typed on a manual Expose (a trap, a creature, a spell DC);
3. the item's DC stamp, `flags.MOD.dcStamp = {value, rule, creator, at}`, written by the creator's client
   when the item is created (7.1, step 4), and only when it raises the item's DC:
   - Powerful Alchemy, for an infused item that allows a save, stamps the higher of the printed DC and
     the creator's class DC. Player Core 2 lets the creator change such an item's DC to their class DC,
     which they would do only when it helps, and pf2e applies it as an upgrade (an `AdjustModifier`
     with mode `upgrade` on `inline-dc`, verified). A same-level poison often prints a higher DC than
     the class DC, and then no stamp is written. With Intelligence +4 (+5 from 10th level), Arsenic
     prints 18 against a 1st-level alchemist's 17, Curare 25 against an 8th-level alchemist's 24, and
     Wolfsbane 30 against a 10th-level alchemist's 29 (expert from Alchemical Expertise at 9th);
   - legacy Potent Poisoner, for a poison crafted by any means (downtime included), adds up to 4, at
     most the class DC, badged;
4. the inline `@Check` DC as pf2e resolves it for the item's current holder, which already includes
   Powerful Alchemy when the holder is the creator: the check of the item's own Saving Throw paragraph
   (else its first saving throw check), never another check's, such as an addiction's save printed
   before it or a stage's basic save; the stamps in rung 3 compare against the same DC;
5. the parsed printed DC.

- **Why the stamp.** pf2e computes Powerful Alchemy's upgrade from the holder's modifiers (7.1), so an
  infused poison handed to an ally, or coated onto an ally's weapon, would otherwise drop to its printed
  DC. Downtime-crafted alchemical items are not infused, so Powerful Alchemy never applies to them; only
  a legacy Potent Poisoner stamp can raise their DC.
- **Frozen.** The DC is frozen at exposure, in the claim and in the tracker item (`system.save.value`);
  a coating freezes it when the poison is applied. A later level-up or hand-over changes nothing already
  in flight.
- Double Poison uses the lower of its two DCs. Exposure modifiers (Pinpoint Poisoner, Combustible
  Poison, holding breath) are modifiers on the initial save, never changes to the DC.

#### 8.10.5 Coatings and Strikes

- **Record.** `flags.MOD.coating = {id, source, def, dc, delivery: "injury" | "contact" | "ingested",
  stamp?, creator, by, at, sticky?: {untilTurn}, parts?: [coating, coating]}` on the weapon, ammunition
  or item (food or drink for `ingested`), written by its owner. One injury poison per weapon or piece of
  ammunition: applying another replaces it after a confirmation (GM Core p.248).
- **Spending someone else's coating.** The "touched" and "eaten" buttons are pressed by the toucher's
  or consumer's owner, who usually cannot write the coated item. That client writes one lock-first batch
  (5.4): a lock page keyed `coating:<coatingId>`, so only the first creature is exposed; the exposure
  claim; and a coating-spend claim (5.5) that the coated item's responsible client applies by removing
  the coating. Until then the coating shows as spent wherever the lock page exists. An item whose text
  keeps it potent across victims (Forgetful Ink) gets an override (8.10.2) and is not spent.
- **Double Poison** (Player Core 2): two different infused injury poisons, each at least 2 levels below
  the level of the alchemist applying them, on a weapon but not on ammunition, applied one at a time and
  then merged into one coating with the lower DC and the lower number of stages, virulent only if both
  are, the save type chosen by the applier when they differ, each stage's effects combined, and each
  stage's interval the longer of the two poisons' intervals for that stage.
- **Expiry.** An infused poison's coating copies its expiry stamp (4.12) into `coating.stamp` and is
  voided with it: the expiry claim's handler (7.7) removes `flags.MOD.coating` from the host on the
  holder's responsible client, and never sets the host's `flags.MOD.inert`, so the weapon's own Strikes
  are never blocked.
- **Strikes**, handled on the attacker's responsible client from pf2e's own message flags (verified,
  `chat-message/data.ts`):
  1. The attack roll (`flags.pf2e.context.type === "attack-roll"`, origin the coated item). Critical
     failure: the coating is spent with no exposure. Failure: it stays. Success or critical success: it
     is armed for that Strike's damage roll.
  2. That Strike's damage roll (`context.type === "damage-roll"`, same origin, with `context.target`).
     If its damage rolls' instances (pf2e 8.6.1 writes no `flags.pf2e.damageRoll` on a Strike's damage message; that
     legacy flag's `types` is read too) hold piercing or slashing damage, an exposure claim is created for
     the target and the coating is spent; with Sticky Poison a DC 17 flat check keeps it until the end
     of the attacker's next turn (`sticky.untilTurn`). Otherwise the coating is spent with no exposure.
  3. Resistance that cuts the piercing or slashing damage to 0 also spends it with no save. The
     damage-taken message records HP and shield changes, not damage by type (verified,
     `flags.pf2e.appliedDamage`), so the target's save prompt carries "no piercing or slashing damage
     got through", which voids the exposure. Blowgun Poisoner lifts that requirement for blowgun
     Strikes, and its critical-success clause makes the initial save one degree worse (a misfortune
     effect), carried in the claim's `mods`.
  4. **Sticky Poison's DC 5 flat check** covers every path that spends the coating with no initial
     save: the critical failure of step 1, a hit with no piercing or slashing damage in step 2, and the
     voided exposure of step 3. On a success the coating stays (Player Core 2 Sticky Poison names
     resistance and a critical failure as examples). For step 3 the check is rolled by the attacker's
     responsible client when the void is recorded, and the coating is restored if it was already spent.
- **Ammunition.** A coating sits on one piece: coating a stack first splits one piece off, and the
  coating is spent or kept with that piece. The launchers that had the stack selected as their
  ammunition (pf2e's `selectedAmmoId`) select the coated piece instead; a launcher that loads its
  ammunition (pf2e's subitems) needs it loaded, which the coating card says. A launcher's Strike uses
  the coating of the piece it fired (its `item:ammo:id` roll option, else `weapon.ammo`): the piece
  leaves with the shot (pf2e consumes it after the attack roll), so a hit arms its coating on the
  launcher (`flags.MOD.ammoStrike`) for that Strike's damage roll, which exposes or spends it, and a
  miss takes it away with the piece; Sticky Poison has nothing to keep it on.
- **Not afflictions, so not tracked:** Poison Weapon's simple poisons (damage with no save), a
  toxicologist's versatile vial used as an injury poison (extra damage), Poisoner's Twist.
- **Poison Coat** (Poisoner): the poison suffused into clothing is a coating on the worn clothing item;
  the Once Bitten reaction exposes its target through Expose.

#### 8.10.6 Rules engine

Pure functions in `scripts/logic/affliction.mjs`, unit tested (15.1).

```text
flags.MOD.affliction.run = {
  v, id, source: {uuid, name, level, traits}, defKey, dc: {value, type, source, creator?},
  phase: "onset" | "active" | "ended",
  stage, streak,                 // streak mirrors system.status.progress: consecutive successes (virulent)
  onsetEndsAt, maxEndsAt,        // world seconds; maxEndsAt is set when the first stage takes effect
  nextDueAt, anchor: {combatId, initiative} | null, interval: {seconds, formula?},
  exposures: {[claimId]: {at, degree}},
  saves: {[seq]: {kind, dueAt, degree, fromStage, toStage, messageId, before}},
                                 // before: the run fields this save changed (phase, stage, streak, interval,
                                 // nextDueAt, onsetEndsAt, maxEndsAt), restored before a reroll (8.10.8)
  pending: {seq, kind, dueAt} | null, by, at
}
```

```js
// One step of an affliction. Pure: returns the new run state and the stage effects to apply.
function applyDegree(run, def, degree, kind, now, ctx) {
  const max = def.stages.length || 1;
  const virulent = def.traits.includes("virulent");
  const mods = ctx.registry.afflictionModifiers(run, def);      // Tenacious Toxins, Pernicious Poison, ...
  if (kind === "initial") {                                      // Player Core p.430
    if (degree >= DEGREE.success) return { run: ended(run), effects: mods.onInitialSuccess(degree) };
    const stage = Math.min(max, degree === DEGREE.critFail ? 2 : 1);   // a single-stage affliction stays at 1
    return def.onset ? startOnset(run, def, stage, now) : enterStage(run, def, stage, now, mods);
  }
  if (kind === "re-exposure") {                                  // a curse or disease: no effect
    if (def.reExposure === "none") return { run, effects: [] };  // the item's own rule (8.10.2); no save is rolled
    if (!def.traits.includes("poison") || degree >= DEGREE.success) return { run, effects: [] };
    const stage = Math.min(max, run.stage + (degree === DEGREE.critFail ? 2 : 1));
    if (run.phase === "onset") return { run: { ...run, stage }, effects: [] };   // onset length unchanged
    return enterStage(run, def, stage, now, mods, { keepMax: true });
  }
  // kind === "stage": the save at the end of an interval
  let { stage, streak } = run;
  if (degree === DEGREE.critSuccess) {
    stage -= virulent ? 1 : 2; streak = 0;                       // virulent: a critical success reduces by 1 only
  } else if (degree === DEGREE.success) {
    if (virulent) { streak += 1; if (streak >= 2) { stage -= 1; streak = 0; } }   // two in a row
    else stage -= 1;
  } else {
    stage += degree === DEGREE.critFail ? 2 : 1; streak = 0;
  }
  if (stage < 1) return { run: ended(run), effects: [] };
  // Past the highest stage, or a virulent success that changed nothing: that stage's effects repeat and
  // its interval restarts (Player Core p.430; the virulent case is an interpretation, OQ-39).
  return enterStage({ ...run, streak }, def, Math.min(stage, max), now, mods, { keepMax: true });
}

function enterStage(run, def, stage, now, mods, { keepMax = false } = {}) {
  const first = run.phase !== "active";
  const maxSeconds = def.duration.unit === "unlimited" ? Infinity : mods.maxDuration(toSeconds(def.duration));
  const interval = rollInterval(def.stages[stage - 1].duration);   // dice intervals rolled once per entry
  return {
    run: { ...run, phase: "active", stage, interval, nextDueAt: now + interval.seconds,
           maxEndsAt: keepMax && !first ? run.maxEndsAt : now + maxSeconds },
    effects: stageEffects(def, stage),                               // conditions, effects, damage (8.10.1)
  };
}
```

- **Maximum duration** starts when the first stage takes effect, after any onset, and never moves:
  re-exposures do not change it (Player Core p.430). Starting it after the onset is an interpretation
  the data supports: some poisons list an onset longer than their maximum duration (Wolfsbane: a
  10-minute onset and a 6-minute maximum), and would end before acting if the clock started at exposure
  (OQ-39). When `maxEndsAt` passes, the affliction ends, even if a save falls due at the same moment.
- **Ending** deletes the tracker item. Granted conditions go with it, except the six that end on their
  own and any unlinked ones, which are granted with `onDelete: "detach"` (8.10.1) and stay as the rules
  say: a poison whose maximum duration runs out while the victim is drained 1 leaves drained 1 on the
  actor.
- **Re-exposure without a save.** With `reExposure: "none"` (Lethargy Poison, Stupor Poison), a new
  exposure from the same source records the exposure, rolls no save and changes nothing.
- **A re-exposure's save** is the initial save against a new exposure (Player Core p.431): that
  exposure's own modifiers apply as for an initial save (Pinpoint Poisoner, holding one's breath,
  Combustible Poison's −1, Blowgun Poisoner's degree, Pernicious Poison's and Combustible Poison's
  damage), not the first exposure's (second M8a review).
- **Same affliction twice.** An exposure whose source matches an active affliction on the target (the
  same source UUID, or the same world definition) is a re-exposure, not a second item. Different
  afflictions coexist, each on its own item; a Double Poison is one affliction.
- **Drugs** (`voluntaryFail` in the definition) offer "fail voluntarily" on the initial save
  (Gamemastery Guide p.120, legacy, badged). Addiction is not tracked (1.2).
- **Registry modifiers** (`afflictionModifier`, 6.11) apply to the poisons of the character who has
  the feat: as their creator (Tenacious Toxins, the additives, Potent Poisoner; read from the
  crafted-by stamp or the DC stamp's creator) or as the one delivering them (Pinpoint Poisoner, Blowgun
  Poisoner, Sticky Poison, Double Poison; read from the actor behind the exposure or coating):

  | Feat | Effect |
  |---|---|
  | Tenacious Toxins (Player Core 2) | maximum duration plus the stage-1 interval, at most twice the maximum |
  | Pernicious Poison (additive, Player Core 2) | on a successful initial save, poison damage equal to the poison's level; nothing on a critical success |
  | Combustible Poison (additive, Lost Omens Cheliax) | on a failed initial save, 1d4 persistent fire; a target already taking persistent fire instead takes −1 circumstance to the initial save |
  | Pinpoint Poisoner (Player Core 2) | −2 circumstance to the initial save of an off-guard creature hit with a poisoned weapon or exposed to an inhaled poison |
  | Double Poison, Sticky Poison, Blowgun Poisoner | 8.10.5 |
  | Acquired Tolerance (Poisoner) | a fortune reroll of a failed save against a poison, recorded like a Hero Point reroll (8.10.8) |
  | Potent Poisoner (legacy, badged) | the DC stamp (8.10.4) |

#### 8.10.7 Timing in and out of combat

- **One clock.** Afflictions run on world time. In combat, Foundry advances world time by the round
  time each round, which pf2e sets to 6 seconds (verified, `init.ts`), so round and minute intervals
  share one clock.
- **Out of combat.** On `updateWorldTime` (every client), the victim's responsible client processes the
  due events in time order up to `afflictionNow` (`worldTime` unless days have been logged, below):
  onset ends, maximum durations, stage saves. A long advance
  can make several saves due. By `afflictions.catchUp`: `roll-each` (default) prompts or rolls them one
  at a time, each from the state the previous one left, and pauses to ask after
  `afflictions.catchUpLimit` saves (default 20); `pause` stops at the first due save. Nothing is
  skipped or averaged.
- **In combat** (an active combat with the victim's token as a combatant), on core `combatTurnChange`
  (every client, verified), guarded by the victim's responsible client. A stage interval in rounds ends,
  by the pf2e effect convention, at the end of the turn of the initiative recorded when the stage
  started (`anchor`, taken as `AfflictionPF2e._preCreate` takes `start.initiative`: the origin's
  combatant, else the current one), one interval later. `afflictions.combatAnchor: "victim-turn"` moves
  it to the end of the victim's own turn instead (OQ-40). Longer intervals fall due when world time
  passes them and resolve at the next turn change.
- **Initial saves** are rolled at once on exposure, in or out of combat (GM Core p.248).
- **Days logged without the clock.** The tracker's clock is world seconds (`onsetEndsAt`, `maxEndsAt`,
  `nextDueAt`), so logged days need a mapping, the same max rule as the workshop day (4.8). Every due
  check, and every time the run records, uses `afflictionNow = worldTime + max(0, manualDay − clockDay) ×
  secondsPerDay` (the second term only once days have been logged): while the log runs ahead of the
  clock's day, the clock reads the workshop day at the world's time of day, so rounds, minutes and hours
  still move it; once the clock's day reaches the log ("advance clock to match" moves world time by whole
  days and keeps the time of day) it is world time, with no jump. A midnight the world clock crosses while
  the log is still ahead lands inside the logged days and adds nothing, as for the workshop day: the
  clock reads a day less and, as for a clock set back (below), due times wait. No high-water mark is
  kept: it would hold new exposures back as well as running ones (second M8a review). When either term moves
  (`updateWorldTime`, or a new `meta.manual` record), the victim's responsible client processes what
  fell due up to `afflictionNow`, as in catch-up above, whether or not the actor is a PC in downtime,
  for NPCs too (with a GM, 8.10.8). For a PC in downtime the saves due on logged days appear in its day
  resolver (9.1, 9.2) and are listed on the day record (`afflictionSaves`); for anyone else they are
  ordinary due-save prompts. Each resolved save sets the next due time from its own due time, not from
  the moment it was rolled, and writes it to the run, so a GM's later "advance clock to match" (4.8)
  through the same span finds nothing due and rolls nothing twice.
- **Clock set back.** Nothing is undone, as for downtime (4.8); due times wait in the future.
- **Responsible client.** Every write to a tracker item and every save prompt happens on the victim's
  responsible client (5.6), exposure claims on the target's (on the active GM's for a hand-off to
  Affliction Forge, 8.10.11), coatings on the weapon owner's. A GM with an assistant GM, or one user in
  two tabs, acts once (5.6).

#### 8.10.8 Who rolls the saves (GM optional)

The table is keyed on ownership, not actor type: a familiar, eidolon, animal companion or summoned
creature with a player owner is rolled like a PC, by that owner (the user 5.6 elects).

| Victim | Rolled by | Default | Alternative |
|---|---|---|---|
| An actor with a player owner, owner connected | the owner, from a card and a notification on their responsible client | `afflictions.pcSaves: prompt` | `auto`: the responsible client rolls without a dialog |
| An actor with a player owner, owner offline | nobody: the save waits until the owner connects; a connected GM sees "roll for them" | `afflictions.gmRollsForOfflinePCs: off` | on: the GM's client rolls it |
| An actor with no player owner (NPCs) | the active GM's client, secret when pf2e's metagame settings hide NPC results | `afflictions.npcSaves: auto` | `prompt`: the GM gets the card |
| An actor with no player owner, no GM connected | nobody: the save waits until a GM connects | | |

- **Pending.** `run.pending = {seq, kind, dueAt}`. The stage stays where it is, and later due events
  wait behind the pending save, so their order is kept: a re-exposure that arrives while a stage save is
  pending or already due waits until that save is recorded, and a stage save that falls due while a
  re-exposure's save is pending waits for it; each save takes a number past every recorded and reserved
  one (second M8a review). A pending initial save has no tracker item yet
  (the item is created only after a failed initial save, 8.10.3): the unresolved exposure claim (5.5)
  is that pending save, and the header count, the Afflictions drawer and the cards read the claims as
  well as `run.pending`. The `ready` sweep and the user-connected hook (5.5) resolve pending saves and
  claims for every actor the local user is responsible for. In combat the card, and the token's effect
  once there is one, show "save pending"; nothing else waits on it. Afflictions on actors with no
  player owner progress only with a GM connected, because only a GM can write them; afflictions on
  player-owned actors never need one.
- **The roll.** `actor.saves[type].roll({dc: {value}, item, extraRollOptions: [...item.getRollOptions(
  "item"), "MOD:affliction:<itemId>:<seq>"], origin, traits: def.traits, modifiers})`, the pattern of
  the Craft wrapper (6.12), on every initial, stage and re-exposure save. By then the dose has usually
  been consumed (8.10.3) or sits on another actor, so `item` is an ephemeral item built from
  `run.source.uuid` (or the claim's `source`), as the Craft wrapper builds one (6.12, OQ-2), at the
  affliction's level; `getRollOptions` reads the item's own traits and needs no actor (verified,
  `item/base/document.ts`). A weapon-type source such as a bomb is passed as an ephemeral consumable
  with its traits and level, so it never becomes the check's weapon context item (6.12). The options
  include `item:trait:poison`, so the system's own bonuses against poisons apply: Effect: Treat Poison
  and the antidotes are FlatModifiers predicated on it (verified). Passing `item` also makes the system
  apply incapacitation at the item's level (`Statistic#roll` takes the effect level from a physical
  `item`, else from the origin actor, else from the roller itself, verified): a 9th-level creature
  saving against Lethargy Poison (2nd level) gets the one-degree improvement whoever applied it.
- **Recording** happens in `createChatMessage` by the message author, keyed by the roll option (6.12).
  The first result recorded for a `seq` stands; a later message for the same `seq` without
  `flags.pf2e.context.isReroll` (a second device's prompt, a double click, a GM's "roll for them" racing
  the owner's reconnect sweep) is shown as "already rolled" and changes nothing. A Hero Point reroll, or
  a fortune reroll such as Acquired Tolerance, replaces the result only when `isReroll` is set and the
  message recorded for that `seq` is gone: pf2e deletes the original before posting the reroll
  (verified, `Check.rerollFromMessage`). The replacement restores the run from `saves.<seq>.before`,
  then recomputes the transition; it deletes the conditions the superseded result granted, the
  expiring ones included, since that outcome never happened, applies the new stage's, and marks the
  superseded damage card as such. Only the latest recorded save of an affliction can be replaced; a
  reroll of an earlier one shows a conflict on the card and changes nothing, as a Craft reroll after
  settlement does (6.12). Damage already applied is not reversed automatically; the damage-taken
  message keeps the system's own undo button.
- **A save rolled elsewhere** (the inline check link on the item's card, or another module's save
  button) is recorded as the pending initial save only when that is unambiguous: one pending exposure
  from that source item on that actor. Otherwise it is ignored, and the module says so on the card.
- **Hidden information.** DCs and names follow pf2e's metagame settings and the source item's
  identification, and the victim's cards say "an affliction" until it is identified. pf2e hides
  unidentified effects from non-GM users entirely: the effects panel skips them and the token shows no
  icon (verified, `effects/panel.hbs`, `ActorPF2e.appliedEffects`, `TokenPF2e.showFloatyText`). So on an
  actor with a player owner the effect-backed tracker is never marked unidentified; while its source is
  unidentified it takes a generic localized name ("an affliction") and a generic image, and keeps the
  stage badge, so the victim's player still sees their stage. On an actor with no player owner
  `unidentified` mirrors the source item's identification, as the system does for any effect.

#### 8.10.9 Interface

- The pf2e effects panel shows each affliction with its stage badge, in both backends; on a
  player-owned actor exposed to an unidentified source it shows a generic name and image until the
  source is identified (8.10.8). Clicking it does not change the stage directly: the stage guard turns
  a click into a manual adjust, and a right-click at stage 1 into a manual end (8.10.1).
- The Workshop header shows a pending-saves count for the user's characters (10.2), including exposure
  claims whose initial save is still pending (8.10.8). It opens the Afflictions drawer: per affliction,
  the stage list (parsed values, with the source paragraph rendered for unparsed parts), the next save
  time, the pending state, and "reduce stage" and "end" for the owners and GMs. Every manual change
  records its author and can be undone like an order transition (4.2.3). GMs see every actor's
  afflictions and pending saves there, with a repair action (8.10.10).
- Chat cards (10.5): exposure and save prompt, stage change, pending save, coating applied or spent,
  inhaled cloud.
- "Apply poison" is offered on injury, contact and ingested poisons (food or drink for ingested,
  8.10.5) in the Bandolier (8.1), on the item's chat card augment and through macros (11.1). With Duct
  Tape active the Bandolier is absent; the other two remain.

#### 8.10.10 Ending, removal and edge cases

- Treat Poison, antidotes and similar bonuses flow through the save roll (8.10.8). Removal by spells
  (*cleanse affliction*, counteracts such as *sound body*) is a manual end or stage reduction (Player
  Core p.431); the module does not roll counteract checks.
- An affliction in progress outlives the infused item that caused it (7.7).
- **Unlinked tokens.** The tracker item lives on the token's synthetic actor and is deleted with the
  token. Claims for a deleted target resolve with a note.
- **Death, or leaving combat.** Nothing special: saves still fall due on world time; an owner or GM
  ends the affliction.
- **Repair.** A stage whose conditions are missing (a failed write, a hand deletion) can be re-applied
  from the run state, without rolling damage again.
- **Module disabled.** Effect-backed afflictions stay as ordinary effects with a badge and do nothing
  (5.8). Purge (5.9) lists tracker items and removes them only after confirmation.
- **Tests.** Every degree for the initial, stage and re-exposure saves, a critical failure on a
  single-stage affliction (Forgetful Ink), virulent streaks, the highest stage repeating, onset with
  re-exposure, re-exposure with `reExposure: "none"`, incapacitation against a higher-level target, the
  maximum duration anchor and Tenacious Toxins, drained 1 left in place when the maximum duration ends
  it, the DC order including a stamped poison held by an ally and a printed DC above the class DC (no
  stamp), coating outcomes for every attack degree and damage type with and without Sticky Poison,
  Double Poison's merged intervals, a duplicate save message versus a reroll, catch-up over a long
  advance, logged days then a clock advance over the same span, both combat anchors, effects-panel
  clicks, the parser over the whole corpus (15.1, 15.2, scenario 12 in 15.3). Settings are in 14.5.

#### 8.10.11 Affliction Forge

PF2E Affliction Forge (`pf2e-affliction-forge`, MIT) is a GM-side affliction runtime with its own
template library, controller items, weapon charges and a public API. What follows is from its 0.1.74
README, its `docs/API.md` and `docs/DATA_CONTRACT.md`, and its source; none of it has been run yet
(OQ-41).

- **Coexistence: one engine per affliction.** While it is active, the Workshop never applies an
  exposure to an actor that already has an Affliction Forge controller for the same source
  (`api.instances.listAll()`), never touches its controller items or coatings
  (`flags["pf2e-affliction-forge"].afflictionReferences`), refuses "Apply poison" on a weapon it
  already coats, and ignores Strikes from weapons that carry its references.
- **Hand-off.** With `afflictions.handOffToForge` on (the default while it is active), an exposure whose
  source item has an Affliction Forge template linked (a reference on the item, or a template whose
  `definition.metadata.sourceUuid`, the provenance its importer writes, is the item's source UUID) goes
  to `api.application.apply({templateUuid, targets, context: {saveDc}})` instead of being tracked here.
  `saveDc` carries the DC chosen by 8.10.4: a template whose check uses `dcMode: "source"` refuses to
  apply without one, and a `fixed` template keeps its own. Exposures with no linked template are
  tracked by the Workshop. Settings shows which engine owns what.
- **A hand-off needs a GM.** Affliction Forge applies and progresses afflictions only on a GM client:
  `api.application.apply` calls its engine's `applyTemplate`, which throws on any non-GM client, and its
  scheduler treats `game.users.activeGM` as the sole authority (verified, 0.1.74
  `affliction-engine.js` `assertGm`, `affliction-application-service.js`, `docs/API.md`). So the
  responsible user for a handed-off exposure claim is the active GM, whoever the target is, with the
  relay (5.7) as accelerator; the target's owner never calls Affliction Forge. While no GM is connected,
  `afflictions.forgeWithoutGm` decides: `workshop` (default) tracks that exposure with the Workshop
  tracker instead, so P2 holds; `wait` keeps the claim pending, shown as "waiting for a GM (Affliction
  Forge)". Either way an affliction has one engine for its whole life.
- **Why the module has its own tracker.**

  | | Affliction Forge (from its README) | Workshop tracker |
  |---|---|---|
  | GM online | its scheduler uses `game.users.activeGM` as the sole authority, and applying a template throws on a non-GM client; player saves are requests the GM's client accepts | runs on the victim's responsible client; afflictions on player-owned actors need no GM (P2) |
  | Incapacitation | its own save-degree adjustment (`DATA_CONTRACT.md`) | the system's own adjustment, by passing the source item to every save (8.10.8) |
  | Turn timing | round durations run on world seconds; start- and end-of-turn scheduling is outside its model | `combatTurnChange` with the pf2e initiative convention (8.10.7) |
  | Item poisons | the GM authors or imports a template; its importer reads creature passive abilities | every consumable's own description, parsed at runtime, with overrides checked in CI against each pf2e release (8.10.2) |
  | Dependencies | requires PF2E Critical Forge | none: pf2e's own affliction schema, conditions and effects panel (8.10.1) |
  | Crafting link | none | the creator's Powerful Alchemy DC survives a hand-over (8.10.4), feat modifiers, coatings that expire with infused poisons, Apply poison from the Bandolier |
  | Rerolls | not described | Hero Point and fortune rerolls replace the save they reroll (8.10.8) |

  Its strengths (multi-save gates, identification states, a template editor, per-stage reactions) are
  not copied; a table that needs them hands off.

As built in M8a (10.15): 8.10.1-8.10.11 are built as written except where 10.15 says otherwise: the Afflictions "drawer" is a
window of its own (`AfflictionsApp`); the parser also reads a spell's save from its defense and an affliction's own Level
paragraph; overrides may mark stages whose remaining text is for the table (`prose`), and `reExposure` also takes `reset-max`
(Toiler's Gruel) and `table` (Grolna); saves on logged days are ordinary due-save prompts, not listed in the day resolver; a save
rolled elsewhere (8.10.8: pf2e's own inline check link, another module's button) is neither recorded nor answered with a notice; the
native backend is written behind feature detection and has not run.

---

## 9. Time

### 9.1 World-clock accrual

- When world time advances (core time controls, the pf2e world clock, or a calendar module, all through
  `updateWorldTime`), nothing is written. Pending days are derived (4.8).
- When a day boundary is crossed, each PC in downtime with pending days gets one prompt on its
  responsible client: a notification and a badge on the Downtime tab, not a modal dialog. An owner who
  was offline sees it at their next login.
- Resolving opens the day resolver for that PC only: confirm the activity for each pending day, roll
  any check that has come due (including affliction saves with day-long intervals, 8.10.7, and the
  variant checks of 6.16: season checks, downtime events), then commit.
- Only GMs and assistant GMs can move the clock (`core.time`).

### 9.2 Advance days wizard

For tables that do not use the clock. Any user can run it; there is no GM-only option, because
players cannot move the clock either (9.1) and a table without a GM would otherwise stall.

1. **Span.** Number of days, or "since last resolved"; the wizard shows the resulting workshop day
   before commit. A GM may tick "also advance the world clock". Otherwise the wizard writes a
   `meta.manual.<runId> = {fromDay, toDay, by, at}` record, and the workshop day becomes the highest
   logged day (4.8).
2. **Who.** PCs in downtime, with their activity per day. Defaults to "continue current activity".
   Helpers and tattoo or graft subjects show as locked. Conflicts (two activities on one day, a helper elsewhere)
   are outlined.
3. **Checks due.** Orders reaching their check, helper checks, first-day Earn Income rolls, affliction
   saves falling on the logged days (8.10.7), Grow season checks and crafting downtime events (6.16).
   The wizard runner can roll only for actors they own; the rest are marked "check pending" for their
   owners.
4. **Daily preparations.** Per PC with a standing routine: expiry of the previous cycle; optional
   re-preparation (7.2). The runner only records that the routine runs on those days; the PC's own
   responsible client applies it (`prepCycle`, expiry claim, `performDailyCrafting()`), at once or at its
   next `ready`.
5. **Days.** Setup days, extra-day reductions (crafter and helpers), Earn Income pay,
   `downtimeDayStart`/`downtimeDayEnd` hooks for extension activities, optional cost of living. All of
   it is written as day records (4.8); the runner never writes an order's `setup`, `check` or `status`
   (4.2.4). An order in `rolled` stays there until its crafter's client settles it.
6. **Review.** Per PC: days, results, ledger rows and claims to be written, each with its idempotency key.
7. **Commit.** Writes in one lock-first `modifyBatch` per PC where possible (5.4). Writes to actors the
   runner does not own (wages, deliveries) become claims. One summary card.

Re-running a span that is already logged changes nothing: day records, wage rows and their locks are
keyed by actor and day, every resolver writes the same content for a day, and the logged-day mark takes
the maximum, never a sum. Running "advance 3 days" a second time is a new span (days 4-6), which the
wizard shows before commit.

As built in M6 (`scripts/ui/advance.mjs`, `scripts/foundry/downtime.mjs`; 10.12):

- **The day resolver** (9.1) is the wizard's window for one PC (`mode: "resolve"`, titled "Resolve days for X"), opened
  from the PC's row in the Downtime tab: its pending days with one activity (its current one by default; "not downtime"
  too; a PC with none is asked to choose one before Next, since leaving the days is what closing the window does), the
  checks due, the review and the commit (`resolveDays`). An order's "Work a day" is `resolveDays` for one day of the crafter's with that
  order as the activity (no card).
- **The wizard** (9.2) has five steps: *how many days* (a number, or only the days already passed; the resulting day;
  for a GM, "also move the world calendar"); *who does what* (every PC in downtime with days in the span, one activity
  each for the whole span, "leave for the owner" and "not downtime" among the choices, a preview of what it writes and
  where it stops; review and done say which PCs' days were left); *checks due* (Craft, Earn Income and helper checks due now, with Roll for this user's characters and
  "waiting for its player" for the others; checks that come due inside the span); *review* (per PC, the days in words
  and each wage, "paid into X's purse" or "collected by their player's client"); *done* (what was written, where each
  PC stopped, and "Resolve the rest", which resolves through the day the first commit reached and never advances
  again). Daily preparations (step 4), affliction saves and the variants' checks are M7, M8a and M9a.
- **The span is fixed** when the user leaves the first step (review fix): the later steps show it and the commit writes
  it (`advanceDays({through, base})`, `resolveDays({through})`), whatever the clock does meanwhile. If the workshop day
  moved before the commit (another user's run, the clock), `advanceDays` writes nothing and refuses as `moved`; the
  wizard goes back to its first step and says the day it is now, so two people advancing one day at once advance one.
- **The commit** (`advanceDays`) plans and writes each PC's days in turn (`writePlan`, behind the PC's day lock), then
  writes `meta.manual.<runId> = {id, v, fromDay, toDay, by, at}` when the span advances, then, for a GM who asked, moves
  the clock so its day is the span's last (`game.time.advance`). Records go first so nobody is prompted for days the
  wizard resolved. A PC with no activity, or "leave for the owner", is skipped and its days stay pending for its owner.
  The planner stops at the first day an activity cannot go on (a check due, an order that takes no days, a job that
  ended, a helper's lock); those days stay pending. An order in `rolled` is settled first when the runner owns its
  crafter (the preview shows the days as that settlement leaves them); for anyone else the planner stops at `settle`
  and the days wait for the crafter's player, so no day is written at a degree a reroll could still replace (review
  fix). The runner writes day records only; an order whose setup the runner's records completed is moved to `check` by
  its crafter's responsible client (`setupRepair`, on day records' changes, and the sweep's "orders" step for a client
  that was not responsible then); until it is, the planner stops at `check` rather than write a setup day past the
  count (review fix). `downtimeDayStart` and `downtimeDayEnd` (12.3) fire for each day of the span, on the client that
  writes. One day card (10.5) sums it up. "Move the calendar to match" (a GM, the Downtime tab) advances the clock by
  the days logged ahead.

---

## 10. User interface

### 10.1 The Workshop window

One ApplicationV2 window built with `HandlebarsApplicationMixin`, split into small PARTS so that a store
change re-renders only the affected part. Detached-window safe: `element.ownerDocument`, no cross-window
`instanceof` (use `foundry.utils.isElementInstanceOf`), delegated listeners. Re-renders are debounced
with `foundry.utils.debounce`, never `requestAnimationFrame`. As built in M12 (15.7): a live refresh renders the header,
the status bar and the shown tab only; a hidden tab is marked stale and renders when it is shown.

| Tab | Players see | GMs additionally see |
|---|---|---|
| Queue | all party orders, shown to every member whatever pf2e's metagame settings (per-order privacy is the `gift` visibility, 4.2.1); own orders highlighted; request, pledge, accept, start, roll, settle, finish; undo own last transition; pickup shelf | undo the last transition of any order |
| Funds | strongbox balance, party fund, own contributions and claims, the ledger with authors; pledge, deposit, withdraw, reverse own rows; gardens and their funding, bestowed gifts with their Price (6.16.7, 6.16.8) | reconciliation, `adjust` rows, reverse any row |
| Morning | owned characters' daily sources (7.1), loadouts, standing orders, talisman affix planner | any character |
| Formulas | owned characters' codex: families, provenance, picks owed, routes for unknown formulas; the party roster's known families | any character |
| Downtime | own PCs' status and pending days, the day resolver, the Advance days wizard, Earn Income jobs (undo own last transition), the current settlement (any member may change it), garden harvests, extension activities | all PCs; clock option in the wizard and "advance clock to match" (4.8); settlement profiles |
| Settings | user and client settings | world settings (including the variants, 6.16), integrations, conflicts, data tools (migrations, reconciliation, active afflictions and pending saves, purge), "view as player" |

Afflictions have no tab: they show in the pf2e effects panel and in the Afflictions drawer opened from
the header (8.10.9). As built in M8a: the drawer is a window of its own, the Afflictions window (10.15).

There is no inbox: nothing waits for approval.

### 10.2 Header and status bar

- Header: party selector (when an actor is in several parties), workshop day and world date, strongbox
  balance, pickup-shelf count for the user's characters, pending affliction saves for the user's
  characters (opens the Afflictions drawer, 8.10.9), "acting as" character selector.
- Status bar: an `aria-live="polite"` region for queue events, the macro shelf, and a banner when the
  shared documents are missing or newer than the module.

### 10.3 Queue tab wireframe

```text
+-- Workshop ----------------------------------------------------- [detach][?][x] -+
| Party [Main party v]   Day 214   Strongbox 1,045 gp 3 sp   Shelf: 1 for you [Take] |
| Acting as [Alchemist (L10) v]                                                     |
+----------+------------------------------------------------------------------------+
| QUEUE    | [All v] [Status v] [Crafter v] [For v] [search..........] [+ Request]  |
| FUNDS    | ---------------------------------------------------------------------- |
| MORNING  | #12 Striking rune -> Fighter's longsword          crafter: Alchemist   |
| FORMULAS |     FINISHING [##########=======------] 78%   day 3 of <=6          |
| DOWNTIME |     14 gp 5 sp left   [Finish: pay 14 gp 5 sp] [Pause] [Open]       |
| SETTINGS | #14 Elixir of Life (Moderate) x4 -> strongbox    crafter: Alchemist   |
|          |     ACCEPTED  funding [######---------] 180 / 300 gp up front       |
|          |     formula: family (lesser known)  DC 26  lab: yes  [Pledge] [Open]|
|          |     helpers: Cleric (Crafting, expert) +4 gp/day                    |
|          | #15 Emerald Grasshopper x4 -> Rogue               crafter: none      |
|          |     REQUESTED  can make it: Alchemist (talisman, feature)           |
|          |     est. 120 gp, 60 up front, 1 setup day   [Offer to craft]        |
|          | #16 Tradecraft Tattoo -> Cleric                   crafter: Alchemist |
|          |     ACCEPTED  BLOCKED: needs Tattoo Artist; subject not confirmed    |
|          | #17 Formula: Comprehension Elixir (Greater)       reverse-engineer   |
|          |     SETUP 1/2   18 gp   DC 23   item earmarked in strongbox          |
|          | Drop any item here to request it.                                    |
+----------+------------------------------------------------------------------------+
| Rogue pledged 20 gp to #14.                             [Macros] [Ledger]       |
+----------------------------------------------------------------------------------+
```

Numbers in the wireframe follow 6.2: a 4th-level 65 gp rune crafted by a 10th-level master at 600 cp
per day; three extra days leave 1,450 cp, and (3,250 + 1,800) / 6,500 = 78%.

- **Progress bar.** One bar per order measured against the Price: up-front paid (solid), reduction
  earned (hatched, so it is not colour-only), remaining (empty). Before start the bar shows escrow
  against the up-front half. `role="progressbar"` with `aria-valuetext` as a sentence.
- **Status badges** are an icon plus a word, never colour alone.
- **Rows** are focusable with a roving tabindex; Enter opens the detail (drawer at wide sizes,
  slide-over at medium, full view at narrow); a context menu (`ContextMenu` with `jQuery: false`) holds
  secondary actions.

### 10.4 Entry points into sheets

Thin, append-only and null-guarded; when pf2e moves a sheet to ApplicationV2 and an anchor disappears,
the module falls back to the header button and macros.

| Surface | Hook | What |
|---|---|---|
| Character sheet header | `getCharacterSheetPF2eHeaderButtons` (AppV1 today) and `getHeaderControlsCharacterSheetPF2e` (AppV2, future, OQ-30) | "Workshop" button |
| Crafting tab | `renderCharacterSheetPF2e` | one strip at the top of `.tab.crafting.crafting-pane`: jobs for this character, Morning status, buttons; never changes `li.formula-item` markup (Toolbelt and Workbench style it) |
| Party sheet | `renderPartySheetPF2e`, `getPartySheetPF2eHeaderButtons` | summary card in the overview region and a header button |
| Actors directory | `getActorContextOptions` | "Open Workshop" on party actors |
| Item chat cards | `renderChatMessageHTML` | optional "Request craft" button; on items with stage text, "Expose" and, for injury, contact and ingested poisons, "Apply poison" (8.10.3) |
| Keybindings | `game.keybindings.register` | Open Workshop, Open Bandolier, Quick Alchemy; unbound by default |

Render hooks receive jQuery from AppV1 and an HTMLElement from AppV2; the module normalizes with an
element-instance check. As built in M11: every row of this table (10.18); the Party sheet's card is put back by an observer when pf2e renders
its Overview region again without a hook, and "Open Workshop" is in the context menu of the party and of the user's own
members.

### 10.5 Chat cards

Rules for every card: our own template inside a `.pf2e.chat-card.MOD-card` wrapper; buttons use
`data-MOD-op`, never `data-action` (pf2e binds every `data-action` button in every message, with a
global debounce); behaviour added in `renderChatMessageHTML` (not the removed `renderChatMessage`); state
computed at render time from stored data, re-rendered locally with `ui.chat.updateMessage`; nobody edits
another user's message. Default visibility whispers to the people involved (setting); the pf2e message
mode is respected.

| Card | When | Content and buttons |
|---|---|---|
| Request | order filed | item and quantity, for whom, routes and crafters who can make it, estimated cost; Pledge, Offer to craft, Open |
| Accepted / Started | accept, start | crafter, setup days, committed amount, custody and subject locks |
| Craft check augment | under the system check card | order, degree; success: reduction per day and days to zero; failure: salvage; critical failure: amount ruined and the alchemical hazard reminder; reroll and fortune warnings; Settle while the order is `rolled`, a conflict notice for a reroll after settlement (6.12) |
| Day summary | day resolution or wizard | per order and job: reductions, helpers, wages, claims created |
| Completion | finish | total paid against Price, days worked, contributors, delivery or shelf, refunds |
| Pickup | shelf item created | recipient, item; Take it |
| Formula learned | job done or grant | formula, family, provenance, cost |
| Morning summary | after preparation | pools, DC stamps, affix plan, expiry |
| Quick Alchemy augment | under the system Quick Alchemy card | additive, potency countdown, splash numbers |
| Healing Bomb | throw | target and adjacent creatures with apply buttons |
| Earn Income | roll and pay | task level, DC (hidden if pf2e hides DCs), degree, per-day pay, days paid |
| Vials | regain | +n vials, new count |
| Expiry | batched per cycle | items marked inert, by holder |
| Exposure | an exposure claim is applied | source, delivery, DC (hidden if pf2e hides DCs); Roll save, Fail voluntarily (drugs), No piercing or slashing damage got through (injury), Held breath (inhaled); "waiting for a GM (Affliction Forge)" for a pending hand-off (8.10.11) |
| Affliction stage | onset end, stage change, end | new stage, conditions applied, damage roll (the system's card), next save time; Roll save when one is due; "pending: owner offline" with Roll for them for a GM; "already rolled" on a duplicate save message, a conflict notice on a reroll of an older save (8.10.8) |
| Coating | poison applied, spent or kept | weapon, poison, DC, Sticky Poison flat checks |
| Cloud | inhaled poison unleashed | remaining time; Expose for each creature that enters |
| Variant cards | 6.16 | downtime event (d20, table result, Resolve), Critical Crafting panel on the check augment, rushed-finish flat check, Deconstruct result and credit, garden harvest, quest component found and assembly |

### 10.6 Drag and drop

- Drop a physical item (from a sheet, the compendium browser, the sidebar or a chat link) on the Queue
  to open the request form prefilled.
- Drop a material item on an order to earmark it (the item moves to the strongbox).
- Drop a formula book item from loot on the Formulas tab to import its formulas, resolving legacy names.
- Drag macro tiles from the shelf to the hotbar (11.1).

All drag handlers use core `foundry.applications.ux.DragDrop`; behaviour after a window detach is tested
(OQ-31).

### 10.7 Notifications

Toasts and whispers go only to the users involved (requester, crafter, contributors, recipient), once per
state change. Users choose all, mine or none (user setting). No sounds by default.

### 10.8 Layout breakpoints

Breakpoints are container queries on the window content, because the window is resizable and can be
detached.

| Tier | Window width | Typical case | Layout |
|---|---|---|---|
| Wide | ≥ 1040 px | 1440 px screens, or detached | left rail, list, detail drawer docked right |
| Medium | 720-1039 px | 1280 px laptops, or 1024 px with the sidebar collapsed | rail, detail as a slide-over, low-priority columns dropped |
| Narrow | < 720 px | 1024 px with the Foundry sidebar open | icon tab strip, stacked cards, detail replaces the list |

Default size: width `clamp(720, innerWidth − 380, 1180)`, height `clamp(600, innerHeight − 120, 860)`,
remembered per client. v14 gives buttons a fixed height, so multi-line buttons set `height: auto;
min-height: 0`.

### 10.9 Theming and accessibility

- Follows Foundry's application colour scheme (light and dark) through pf2e's colour tokens with
  fallbacks; an optional "Parchment" client setting matches the pf2e sheet look in either scheme.
- Reuses pf2e's global classes for rarity, trait and damage-type chips and `{{actionGlyph}}`, wrapped in
  fallback classes.
- Fonts: pf2e's serif for titles, condensed sans with tabular numbers for money and DCs, core body font;
  rem units so Foundry's font-scale setting works.
- Degree-of-success colours are darker than pf2e's text colours where those fail contrast; every status
  is icon plus word; hatched fills; at least 32 px hit targets on the HUD and Bandolier.
- Real `<button type="button">` everywhere; roving tabindex in lists; drawers trap focus and return it
  on Esc; every drag action has a keyboard or menu alternative; the Quick Alchemy panel works entirely
  from the keyboard.
- No flashing; progress transitions off under `prefers-reduced-motion`; live updates never steal focus.
- Information hiding follows pf2e's metagame settings (`dcs`, `results`, `breakdowns`, `partyStats`).
  pf2e has no separate restricted-party option: its party sheet's restriction is just `partyStats`
  turned off (verified). When `partyStats` is off, other members' ranks, helper ranks and roster skill
  data are not rendered (4.10); orders, funding and progress bars are always shown to every member.
  GM-only numbers are not rendered for players at all, rather than hidden with CSS.

### 10.10 As built in M4

M4 builds the window shell with the Queue and Funds tabs; Morning, Formulas, Downtime and Settings come with M5-M7 and
M11 (Formulas: 10.11) (`scripts/ui/`, `templates/`, `styles/workshop.css`; view models in `scripts/logic/views.mjs`).

- **The window** (`WorkshopApp`, `scripts/ui/workshop.mjs`): one ApplicationV2 with `HandlebarsApplicationMixin`, parts
  `header`, `nav`, `queue`, `funds`, `status`; one window per client (`WorkshopApp.instance`). Store changes (the
  ledger, the strongbox and its items, members and their items, the module's status, `pf2e-artisans-workshop.status`)
  re-render the header, the tabs and the status bar through `foundry.utils.debounce` (150 ms). The tab is remembered per
  user (`ui.lastTab`). Listeners are delegated from the window's own element; DragDrop is core's, rebound on each render.
- **Header**: the active party's name, the strongbox's coins, the pickup shelf for the user's characters with "Take it",
  and "acting as" (the user's member characters; every member for a GM), which accept, pledge, deposit and requests
  use. Not built: the party selector (orders are tagged with `party`, the window shows every order) and the workshop day
  and world date (M6).
- **Queue** (10.3): filters (all, mine, open, blocked; state; crafter; recipient; a name search), the party summary,
  and one row per order: number (by filing time), image, name, quantity, recipient, rarity chip (pf2e's own classes),
  crafter; the status chip (icon and word; setup shows `n/m` days); the multi-segment progress bar (`orderProgress`:
  escrow against the up-front half before start; after it, up-front paid solid, reduction earned hatched, the rest
  empty; `role="progressbar"` with a sentence as `aria-valuetext`); the funding or what is left; "Day n of at most m"
  from the day records and the rate; facts (formula route, DC, reduction per day, the check, a conflict); the blockers
  of an accepted order, each a sentence from its gate's reason (6.5; the crafter's gates computed from the actor and
  the strongbox's tools, `scripts/foundry/products.mjs`); and the viewer's actions (offer to craft, start, work a day,
  roll, settle, "Finish: pay X", resume, retry, pledge, open). The detail drawer adds every fact, each requirement with
  its gate, the contributors, the history (log entries with author and time), the order's ledger rows with authors,
  and every action including release, pause, withdraw, undo and cancel (confirmed). Dropping an item from a sheet, the
  compendium browser, the sidebar or a chat link on the Queue opens the request form with it (its compendium source
  when it has one).
- **Request form** (`RequestForm`, `scripts/ui/request.mjs`): the item (dropped, or found by name in
  `pf2e.equipment-srd`'s index, so the drag has a keyboard alternative), quantity, requester, recipient (a member or the
  strongbox), an optional crafter of the user's own, a gift flag (hides the product from the recipient's owners in the
  window and on cards) and a note; it shows the estimate and, for every member trained in Crafting, the route, setup
  days, DC, batch split and days to zero at a success, or the gates that block them.
- **Funds** (10.1): the strongbox's coins (and for a GM the difference from the ledger's expectation), the party fund,
  the escrow held for open orders; deposit, withdraw (up to the character's net deposits) and collect; member balances
  (`memberBalances`: in orders, fund share, total); the ledger newest first (time, kind, amount, counterparty, order,
  author, pending and reversed marks, and Reverse where `canReverse` allows). A GM also sees reconciliation (expected
  and counted coins, rows in flight, resumable and locked stacks), closes rows that need a hand (`resolvePending`) and
  books the difference (`bookAdjustment`).
- **Status bar**: an `aria-live="polite"` region that says what the user's last action did and what other users changed,
  and the banner while the shared documents are disabled, missing, newer, migrating or stale.
- **Chat cards** (10.5, `scripts/ui/chat.mjs`): request, accepted, started, complete (with "on the shelf" or
  "delivered", and "Take it" for the recipient's owners) and cancelled. The message holds a one-line summary its author
  wrote inside `.pf2e.chat-card.pf2e-artisans-workshop-card` (`flags.MOD.card = {kind, order}`); the live part is
  rendered in `renderChatMessageHTML` from the ledger and rendered again with `ui.chat.updateMessage` when the order
  changes, so a card of an order that is gone keeps its summary. The Craft check augment goes under pf2e's check card:
  the degree, the reduction per day and days to zero, the salvage or the ruined amount with the alchemical hazard
  reminder, the fortune warning, Settle while the order is `rolled`, and the "not used" or conflict notice with undo
  (6.12). Buttons carry `data-pf2e-artisans-workshop-op`. Cards are whispered to the involved users and GMs (a request
  to every member's owners); the world setting `chat.visibility` (`involved`, `public`) posts them to everyone.
- **Notifications** (10.7, `scripts/ui/notify.mjs`): every client watches the ledger and tells its own user, once per
  state change made by someone else, by the user setting `notify.level` (`all`, `mine` default, `none`), as a toast and
  in the status bar.
- **Entry points** (10.4, 11.1, `scripts/ui/entry.mjs`): a "Workshop" button in the Actors directory's header (core's
  ApplicationV2 directory, which pf2e 8.6.1 extends without changing its header; shown while the master switch is on),
  a "Workshop" header button on the pf2e Party sheet (Application V1 in pf2e 8.6.1, `getPartySheetPF2eHeaderButtons`),
  and `game.modules.get("pf2e-artisans-workshop").api.ui.open({tab, order, actor, filter})`. The character-sheet
  buttons, the Crafting tab strip, macros, the shelf and keybindings stay in M11.
- **API** (11.2, `scripts/foundry/api.mjs`), published at `ready` with the `pf2e-artisans-workshop.ready` hook:
  `version`, `apiVersion` 1, `isReady`; `ui.open`, `ui.openOrder`, `ui.requestForm`; `orders.list`, `get`, `request`,
  `accept`, `release`, `start`, `workDay`, `rollCheck`, `settle`, `pause`, `resume`, `retry`, `finish`, `cancel`,
  `undo`; `funds.balance`, `pledge`, `deposit`, `withdraw`, `reverse`, `rows`, `claims`, `claimAll`. Actors resolve as
  11.1 says; amounts take copper, "20 gp" or `{gp: 20}`.
- **Layout and theming** (10.8, 10.9): container queries on the window (`container: workshop`), wide >= 1040 px (rail,
  list, detail docked right), medium (detail as a slide-over, low-priority ledger columns dropped), narrow < 720 px
  (icon tab strip, the detail in place of the list). Default size `clamp(720, innerWidth - 380, 1180)` by
  `clamp(600, innerHeight - 120, 860)` from the main window. Colours are Foundry's application tokens and pf2e's, with
  the module's own `--paw-*` tokens for the bar, degrees and panels in both schemes (degree colours darker than pf2e's
  on light and lighter on dark); rem units; `prefers-reduced-motion` turns the bar's transition off. DCs are hidden from
  players when pf2e's "show DCs" metagame setting is off.
- **Keyboard** (10.9): every control is a `<button type="button">`; the tabs are a `tablist` with arrow keys; the order
  rows use a roving tabindex (Up, Down, Home, End; Enter or Space opens the detail); Escape in the detail closes it and
  returns focus to its row.
- **Live harness** (15.3): scenario `m4` (`tools/harness/order-scenarios.mjs`) and the behaviours `m4-lifecycle`
  (GM and two players), `m4-no-gm` (two players, no GM, the recipient offline at the finish and collecting at login),
  `m4-cancel`, `m4-double-delivery` (5.11), `m4-reroll-race` (6.12: the late write repaired once by the crafter's client,
  then three real settle-against-reroll races) and `m4-shots` (seeded orders; Queue, Funds and the detail as the GM and
  as a player at 1440x900 and 1024x768 in both schemes, `--shots <dir>`). The driver adds the module's stylesheet to a
  page whose world was launched before `module.json` named it (the server links `styles` from the manifest it read at
  launch) and reports that it did (`styleAdded`); it also records every HTTP error a page gets. First live run
  (2026-10-26, Foundry 14.368, pf2e 8.6.1, no canvas): the six M4 behaviours pass, and so do scenarios 2 and 7b and
  `craft-hero-reroll` and `craft-second-roll`, rerun for the changes to deliveries and reroll recording. In all three
  settle-against-reroll races the settlement landed first and the GM's reroll was kept as the conflict; the late
  delivery apply request was refused at the server's dry run.
- **After the M4 review** (2026-10-26):
  - *Transitions planned from the same copy of an order.* Every transition (accept, release, start, settle, pause,
    resume, retry, finish, cancel, undo) takes the lock page of its log slot, `log:<order>:<seq>` (`logLockId`), in the
    request that writes its log entry: a plain write goes through `lockedWrite` (bookkeeping rows and ledger keys behind
    lock pages, `money.mjs`), a coin move adds the page to its lock request (`spend` and `reverseRows` take `locks`).
    The server refuses a page that exists, so of two transitions planned from the same copy (a cancel and a finish, two
    offers to craft, an undo and a finish) only the first lands, and one planned from a copy that missed a transition is
    refused ("taken" or "conflict"). Before this a cancel planned from a stale copy could land after a finish: the item
    was delivered and the contributors refunded, out of other members' coins, with reconciliation still balanced. A work
    day and a first roll write `status` without a log entry, so neither takes a slot; one planned before a close and
    landing after it moves the closed order's status. The log still says it is closed (`closedAs`: its last entry is a
    finish or a cancel), so every transition, the roll wrapper and a check's recording refuse it ("state"), and the
    crafter's responsible client writes the status back (`closedRepair`, with the settlement repair). Tests: the four
    orderings in `test/foundry/orders.test.mjs`.
  - *Purge refunds.* "Refunds" leaves out what an open refund claim of a cancel or a finish already owes for the same
    member and allocation (`unclaimedAllocations`, `reconcile.mjs`), and goes on waiting while any refund claim is open,
    so nobody is paid one allocation twice out of other members' coins.
  - *The window.* The tab nav carries core's `tabs` class, which `ApplicationV2#changeTab` looks the buttons up by (tab
    clicks and arrow keys threw before; its row layout and borders are undone in the stylesheet), and each tab button has
    an `aria-label`, since the narrow tier hides its word. A re-render gives focus back to the control that had it, found
    by its data attributes inside its order or ledger row, with its caret and selection (`scripts/ui/focus.mjs`, in
    `_preSyncPartState` and `_syncPartState` of the window and the request form): typing on in the Queue's search or the
    request form's search continues where it was, and a store refresh no longer drops focus from a filter, an order row
    or a detail button. The order list's tab stop stays on the row the user was on (`activeRow`). The detail drawer
    carries its order's id, so its buttons (release, pause, withdraw, undo, cancel) act on it. From the Workshop, the
    request form is its child (`renderChild`) and the dialogs take its `windowId`, so a detached Workshop asks in its own
    window. "Finish now for" shows only once crafting; before it the amount is "Still needed up front". The progress bar
    has a name. In the request form Enter in the search picks the first match, and its element ids carry the form's id.
  - *Chat cards.* The log's first messages render before `ready` reads the ledger, so every shown card and check augment
    is rendered again when this client's status turns "ready"; and only messages the log (or its popout) shows are
    rendered again, since core posts one it does not show at the bottom of the log. The check augment's "Undo
    settlement" shows, and acts, only while the settlement is the order's last transition (`undo(id, {event})`).
  - Live behaviour `m4-ui` drives the window as Player One with real clicks and keys: the tabs by mouse and arrows, both
    searches typed across their re-renders, focus on a row, a filter and a detail button through a store refresh, the
    narrow tier's tab names, a detached Workshop opening the request form and a dialog in its own window, the cards and
    the Settle button after a reload, the log kept in time order, and the detail's Settle button. Run 2026-10-26 with
    `m4-lifecycle`, `m4-no-gm`, `m4-cancel`, `m4-reroll-race` and `m4-shots`: all pass.
- **M4 live pass** (2026-10-26, Foundry 14.368, pf2e 8.6.1, no canvas): the eight sync scenarios and all 27
  behaviours, once each, pass; the screenshots (Queue, Funds and the detail as the GM and as Player One, 1440x900 and
  1024x768, dark and light) were checked by eye: no overflow, no raw keys, readable. Then one lifecycle as a real
  imported real character (a level-1 alchemist with his own formula book and Alchemist's Lab, made Player One's
  character for the run and put back after it), driven through the window with clicks: the Actors directory and Party
  sheet buttons, the request form (four Alchemist's Fire (Lesser) for the strongbox), pledges from the imported character's purse and
  Player Two's, the offer to craft, start, a setup day, the Craft check in pf2e's own dialog, settle, the rest pledged
  from both purses, and "Finish: pay 6 gp": one stack of four in the strongbox flagged as crafted by the imported character, the
  ledger's pledge, commit, materials-used, remainder and shelved rows, the strongbox reconciled at zero, the four
  cards, no page errors. Rolling through pf2e's dialog first threw in the dev world (15.1, fixed); an earlier try
  rolled a critical failure, and the retry asked for the 6 sp the ruined materials cost ("6 sp more is needed in
  escrow") before it would start.

#### As built in M4.1 (2026-10-26, the first hands-on session)

The author's first real use found that money added to the party fund could not be moved onto an order, that one amount
field read "18" as copper, that "pledge" and "deposit" were not understood, that the requirements showed gate codes, that
the work days and the finish cost were unexplained, and that a finished item seemed to vanish. M4.1 reworks those
(DECISIONS.md 2026-10-26), with unit tests for the pure parts (`test/logic/funds.test.mjs`, `views.test.mjs`) and stub
tests for the Foundry and window parts (`test/foundry/funds.test.mjs`, `ui.test.mjs`); the live harness was not rerun.

- **A. Fund accounting** (4.6, 4.7 As built in M4.1). The Funds tab opens with the identity line, then three cards:
  the strongbox's coins; "Party fund: unallocated" with "Add to party fund" (a deposit) and "Take out" (up to the
  character's net deposits); and "Earmarked". A "By order" table lists each order's earmarked money by source, its total
  and what it spent. "Fund this order" (Queue row, detail, request card) asks for the source, the party fund (with what
  is unallocated; chosen first while it covers what is needed, since the second review) or a character's purse, and the
  amount. The detail lists the money earmarked by source and spent by source, and "Give back to the party fund (up to
  X)". Finish (and, since the second review, Retry) with too little earmarked asks where the rest comes from, the
  shortfall filled in and required.
- **B. Money input** (`askMoney`, `templates/prompts/amount.hbs`): every amount is four whole-number fields, pp, gp, sp
  and cp (`fieldsToCp`); "Fill the shortfall (X)" fills them with what the order needs next (`shortfallOf`: the up-front
  half before start, a retry's commit, or what finishing now costs), "Fill in all of it" for a withdrawal or a give-back;
  the confirm button stays disabled, with the reason beside it, while the amount is not whole coins, is zero, or is
  outside its limits (`checkAmount`).
- **C. Requirements** (`requirementsView`, `REQUIREMENT` keys): each gate has a short name ("Trained in Crafting",
  "Item level within the crafter's level", "Formula", "Tools", "Up-front materials funded"); unmet ones come first with
  their reason and, for an underfunded G8, "Fund it" with the shortfall filled in; met ones fold into "11 of 12 met".
- **D. Work days** (`workDaysView`, `costSummary`): the detail explains the rule in its own words (one Craft check per
  order after setup; each further day takes the crafter's Income Earned rate off, one level higher after a critical
  success; no more checks; Player Core p.237), lists "Setup day 1 of 2" and "Day 3: −8 gp 7 sp" (a day counts once the
  check settles as a success, and never below nothing left), and for a finished order "Paid X up front; N work days
  covered Y; paid Z to finish; T spent in all", with ruined materials of earlier attempts on their own line. The
  completion card carries the same summary.
- **E. Completion** (5.5 As built in M4.1): where the item went, on the card and in the detail and Queue row; Collect
  stays until delivery; the header's shelf count is the Collect button.
- **F. Item search**: the Queue's search box is an order filter ("Filter orders"); a magnifying-glass button beside it
  opens the request form with its item search focused, and the form's "Browse" opens pf2e's Compendium Browser on its
  equipment tab (`game.pf2e.compendiumBrowser.openTab("equipment")`) to drag an item from. No new search was built.
- **Review** (one pass, high): fixed: an earmark that lands after its order closed (planned before a cancel or a finish)
  stranded the fund's money on the closed order, since giving back refused closed orders (now `fundReturnableCp` gives
  all of it back); players were shown the reconciliation difference (now a GM's only); the API's finish with an
  unresolvable purse answered "underfunded" instead of "no-actor"; the Funds view kept an unused escrow figure.
- API (11.2): `funds.fund({order, amount, source, from})`, `funds.returnToFund({order, amount})`, and
  `orders.finish({order, draw: {source, from, amount}})`.
- **Second review** (one pass; fixed, each with a test that fails without it):
  - *Give-backs and take-backs against transitions* (4.6): a give-back of the fund's share planned from the same copy as
    a cancel or a finish returned the share twice (the unallocated fund then showed more than the strongbox held); with
    a start it left the order committing more than it held, stuck in `rolled`; with a settlement the spend was split
    over stale allocations and a source's share went below zero; a member's take-back or a pledge's reversal racing a
    cancel paid the member twice. All of them, and every transition that moves the order's money, now take the order's
    return slot (`returnSlotLockId`). Tests: the race tests in `test/foundry/funds.test.mjs`.
  - *Give back from the window*: the detail offered all of a closed order's late earmark back, but the dialog capped it
    at `withdrawableCp`, 0 for a closed order, so it refused every amount. Both now use `returnableFor`.
  - *The money prompt's source*: it started on the party fund whenever the fund held anything, even less than the
    shortfall a Finish requires, and its hint then went back and forth between "At most" and "At least". It now starts on
    the party fund only while the fund covers what is needed (`firstSource`), else on a purse; with the fund chosen,
    an amount it cannot cover says so and points at a purse (`Prompt.Problem.FundShort`, `FundShortNeed`), and "Fill the
    shortfall" fills no more than the fund holds. With one character, the purse option names them ("Bo's purse") and
    the "From Bo" line is shown only when there is no source to choose. The gold field has focus when the dialog opens
    (DialogV2's own autofocus lands on the disabled confirm button).
  - *Member balances*: a member's party fund share was one figure that still counted money the fund had earmarked; the
    table now splits it into unallocated and earmarked for orders as the cards do (pro rata by share, members' shares
    unallocated first), next to what their own purse put into orders.
  - *Live updates*: the expanded "N of M met" list stays expanded (`metOpen`, a capture-phase `toggle` listener), its
    summary carries `data-toggle` so focus comes back to it, and the requirement's "Fund it" carries `data-op="fund-short"`
    so focus on it and on "Fund this order" are told apart.
  - *The pickup shelf*: only a user who can collect is told to ("Waiting on the pickup shelf for Bo: collect it."), next
    to Collect, which the Queue row now has too; everyone else reads whom it waits for.
  - *Retry*: the refusal said "more is needed in escrow"; it now reads "This order needs X more. Fund this order first."
    and Retry with too little earmarked asks for a source and amount as Finish does (`retryOrder`).

#### Follow-ups (M4, low)

- No context menu (10.3): secondary actions are in the detail drawer. The slide-over and narrow detail do not trap focus. (Fixed in M11, 10.18.)
- The window's size is not remembered per client (`ui.windowSize`), and the Parchment client setting is not built. (Fixed in M11, 10.18.)
- The party selector and the workshop day and world date in the header (10.2) wait for M6's day and multi-party use.
  (M6 shows the workshop day and pf2e's World Clock date; the party selector still waits for multi-party use.)
- The Party-stash strongbox (4.7, `strongbox: party`) is not built.
- A product's Price is the compendium item's, not the prepared item at the recipient's size (6.2.2).
- Fixed after the M4 review: a cancel and a finish planned from the same copy both landed (the item delivered and the
  allocation refunded, paid from other members' coins with reconciliation balanced), and a late work day or first roll
  could reopen a cancelled order for a second refund. See "After the M4 review" above.
- Fixed in the M4.1 second review: a withdrawal racing a start could leave the escrow below the commit, the order stuck in
  `rolled`; and settle and finish, which read the pro-rata allocations before the coin mutex, could split a spend over
  allocations a withdrawal queued ahead had changed. A withdrawal, a start, a settlement and a finish all take the
  order's return slot now (4.6), so the later of two planned from the same copy is refused ("taken") and tried again.
  Allowing pledges in `rolled` (4.2.2 does) would still give a way out of `rolled` for any other cause.
- One user on two devices working two orders in the same instant writes the same day key twice, and one of the two days
  is lost. (Fixed in M6: a PC's days are written behind the lock `days:<actorId>:<first day>`, 4.8 As built in M6.)
- A transition's request that stops between its log slot's page and its ledger update (the server stops at an error
  after its dry run passed) leaves the slot taken with no entry, and every later transition of that order is refused
  until the page goes; not seen, and there is no tool to release it yet (M11's data tools).
- A work day or first roll written late onto an order that was paused (not closed) moves its status; only a closed
  order's status is repaired.
- Undo does not cover finish, cancel or work days.
- Fixed in M4.1: the detail's Requirements list showed each gate by its code; each now has a short name (C).
- With the applications in the dark scheme and the interface in the light one, chat cards take the dark `--paw-*`
  tokens (`body.theme-dark`) on the light chat background, and the degree colours lose their contrast. Scope the dark
  card tokens to the nearest themed ancestor. (Fixed in M11, 10.18.)
- "Funded by" listed each contributor's remaining allocation, not what they put in. M4.1 labels it "Earmarked for this
  order" and adds "Spent, by source"; what each source put in over the order's life is still not shown.
- A cancelled order still shows its funding bar and text, and the Funds ledger lists item rows (delivered, shelved) as
  "0 gp"; show the refunds instead, and no amount for an item row.
- The purge dialog shows each member's whole balance, including what an open refund claim already owes them.
- Dropping a material item on an order to earmark it (10.6) waits for M5's materials.
- `ui.lastTab` is written on every tab change (one user-document write each).
- The request card's summary hides a gift's product from everyone, not only the recipient (the live part hides it only
  from the recipient's owners).
- Found in the M4 live pass (2026-10-26):
  - The check augment of a complete order still shows the success sentence ("0 more days to pay nothing more, or
    finish now for 0 gp"). Show it only while the order is `rolled` or `finishing`. (Fixed in M11, 10.18.)
  - Fixed in M4.1: an order for the strongbox booked its `shelved` row as "Put on the pickup shelf"; it now reads "Put
    in the strongbox", and item rows show no amount.
  - Counts are not made singular: "1 days at 8 gp" in the request form's candidates, "1 of 1 days" for the detail's
    setup. Give each a key for one. (Fixed in M11, 10.18.)
  - The request form's candidates keep the DC column, empty, for a player who may not see DCs. Leave the column out. (Fixed in M11, 10.18.)
  - "Acting as" cuts long character names short at every width, with no tooltip holding the whole name. (Fixed in M11, 10.18.)
  - Every live plan rolls the Craft check with `skipDialog`; only the imported-character pass clicked "Roll Craft check" through
    pf2e's dialog, which is how the dev-world throw (15.1) went unseen. Add that click to `m4-ui`.
  - The driver's closing world reset throws, and the run exits non-zero, when a session it did not open is connected
    (an Assistant GM was, at the end of that run, after every plan had passed). Name the stray session in the results
    and leave the exit code to the plans.
- Found in the M4.1 review (low):
  - A GM's negative `adjust` and the purge's refunds from the fund take money out of the unallocated fund without taking
    the fund slot, so one can land together with an earmark of the same money and leave the fund below zero until money
    comes in. Take the slot in `bookAdjustment` and the purge's fund refunds.
  - An earmark or a pledge planned before a cancel or a finish can land after it (neither takes the order's log slot):
    the fund's share can be given back (M4.1), but a member's pledge on a closed order stays there with no way back but
    a GM's adjustment. Refund a closed order's leftover allocations from the claim sweep.
  - The fund slot's number is a count of rows; archiving (5.3.3) must carry the count forward in its `carry` rows, or a
    later slot number repeats a page that still exists and every fund debit is refused until the page goes.
  - A GM sees Collect (card, detail, header) for every recipient, but the claim sweep delivers only for actors the GM's
    tab is responsible for, so while the recipient's owner is connected the click does nothing.
  - "Browse" opens pf2e's Compendium Browser in the main window even from a detached request form, where an item cannot
    be dragged across windows; the form's own search still works there.
  - The Funds tab's "By order" table hides a gift's product name from everyone, the giver included; the Queue hides it
    only from the recipient's owners.
  - Each complete order's context scans the strongbox's items for its shelf count on every render; build one map per
    render.
  - The work-day rule and per-day lines are in the order detail only; the M6 day resolver and the Downtime tab should
    reuse `workDaysView`.
- Found in the M4.1 second review (low):
  - A coin field the browser cannot parse (`<input type="number">` with "5O" or "1e") reads as "", so it counts as 0 and
    the amount from the other fields passes with less than was typed. Treat `validity.badInput` as `bad-number`, or use
    `type="text" inputmode="numeric"`, and show "You are moving X" beside the button.
  - The API's `funds.fund` from a purse (and `orders.finish` drawing from one) throws for an amount that is not whole
    copper (`{cp: 0.5}`), where the party-fund path refuses "nothing"; no money moves either way. `amountCp` should
    return null unless the result is a safe integer.
  - The magnifying glass beside "Filter orders" opens the request form with an empty item search; pass the filter's
    text on as the form's search.
  - "Queue.ProgressFunding" still says "pledged"; "Give back" (releasing the order) sits beside "Give back to the party
    fund"; the requirement's button says "Fund it" where everything else says "Fund this order". Reword together. (M5
    on M4.1: the funding line says "earmarked", and M5's custody button reads "Give the item back"; the rest stands.)
  - Unmet requirements read as met to a screen reader: the names are positive statements and the only fail marker is an
    inert icon. Label the unmet list ("Not met") or add a visually hidden prefix. (Fixed in M11, 10.18.)
  - A met G1 always reads "Trained in Crafting", also for an item whose registry entry substitutes another skill; pass
    the skill in G1's pass data.
  - Take back and Take out cap the amount and "Fill in all of it" at the largest across the user's characters, not the
    one selected; a GM or a player with several characters can confirm an amount that is then refused.
  - "Fund this order" from a chat card has no intro sentence and is not prefilled when the order is short, unlike the
    window's; share one fund-prompt helper.

### 10.11 As built in M5

M5 builds formulas, formula jobs, casting pledges, precious-material stock, service orders, rune etching, upgrades and
transfers, and the Formulas tab (pure parts in `scripts/logic/codex.mjs`, `pledges.mjs`, `runes.mjs`, `services.mjs` and
additions to `formula-jobs.mjs`, `materials.mjs`, `orders.mjs`, `lock-first.mjs`; Foundry parts in
`scripts/foundry/catalogue.mjs`, `formulas.mjs`, `custody.mjs`, `pledges.mjs`, `services.mjs`, `outputs.mjs` and
additions to `products.mjs`, `orders.mjs`; the window in `scripts/ui/formulas.mjs`, `extras.mjs`,
`templates/workshop/formulas.hbs`). Unit and stub tests cover each part; the live plans first ran in the M5 live pass
below.

- **The equipment catalogue** (`catalogue.mjs`): facts about every item of `pf2e.equipment-srd` read once per session
  from the pack's index (name, image, type, level, rarity, traits, category, slug, usage, book, Price, material), with
  their item options (`itemOptions`), so families, virtual lists, picks and the searches never load documents.
- **Provenance** (4.13) is `formulas.<actorId>.<hash of the UUID>` = `{id, v, uuid, route, source, pickLevel, day, row,
  order, service, by, at}`; a formula in the book without a record reads as `unrecorded`. `family` and `virtual`
  records are not written yet (M7 writes them when a tier is prepared).
- **The formula claim** (5.5). Every acquisition files a claim of kind `formula` (`{uuid, route, source, pickLevel,
  order, service, row}`, keyed `formula:<cause>:<learner UUID>:<formula UUID>`), with whatever paid for it in the same
  write: a `purchase` row's lock-first move, a finish's move, a service's close. The learner's responsible client applies
  it (`registerClaimKind`, so the claims sweep and the GM relay apply it too; the acting client applies it at once when
  it is the responsible one): a request takes the claim's own lock page with `resolved` and the provenance, then the
  book is appended to as pf2e's crafting tab does (`actor.update({"system.crafting.formulas": [..._source, {uuid}]})`,
  never the prepared array; a formula already there is not added again), then `applied`, the `formulaAcquired` hook
  (12.3; payload `{actor, uuid, route, provenance, added}`) and the "Formula learned" card. A claim resolved but not
  applied, or locked but not resolved, past the grace time is finished by the learner's responsible client at the sweep
  (`resumeFormulaClaims`, a new sweep step). A claim filed but not applied yet (`pendingFormulas`) counts as known
  (`knownState`): buying, copying, a pick or a formula job for that book is refused as `pending`, the picks owed count
  it (`withPending`), and the Formulas tab shows the formula "on its way" with no route; a result applied elsewhere
  (`claimed`) is told to the user.
- **Acquiring at once** (`acquire`, `instantPlan`): `buy` (the formula's Price plus the rarity surcharge; an uncommon
  or rarer one needs "a seller is available" confirmed), `copy-npc`, `scanner` (the learner carries a schematic scanner
  and an item made from the formula), and `grant` for an owed pick. The cost is a `purchase` row from the payer's purse
  (a character the user owns). Copying from an ally is a `formula-copy` service: the requester files it naming the
  ally; the ally's owner performs it once they confirm the ally knows the formula (`rules.allyCopyCostCp`, default 0,
  is paid at the request as a purchase row when it is more).
- **Formula jobs** (`productType: "formula"`, `route` one of `invent`, `reverse-engineer`, `craft-copy` given at
  filing; one per order, for one actor's book): planned by `formulaJobPlan` and gated by `formulaOrderGates`; the roll
  wrapper adds `action:reverse-engineer` and the registry's modifiers for the route, as in M3. Reverse-engineering needs
  the item on the crafter (made from the formula's UUID) or handed over for the order (`possession`); the item is kept
  and goes back to whoever handed it over. The finish writes no item: its move files the formula claim for the
  recipient (invented, reverse-engineered, or copied-ally for a copy) and pays the remainder; a finish that moves
  nothing is one write behind the log slot's lock.
- **Picks owed** (`picksSchedule`, `picksOwed`): every `formulaAllowance` of the held keys from the level each key was
  gained (`gainedAtOf`: a feat's level taken, a feature's level; 1 when unknown): `gain` at that level, `level` at each
  later level (only its `levels`, when listed), `rank` at that level for every rank held now. Granted provenance with
  that key as `source` fills its `pickLevel` entry first, then the earliest; `pickFits` checks the named UUIDs, rarity,
  level bounds and filter.
- **The Formulas tab** (10.1): the character (own characters; every member for a GM), the count and badges by
  provenance (icon and word), the book by family (`familiesOf`: each known grade with its badge, the catalogue's
  grades the family covers by 6.4's rule), the virtual lists (`virtualLists`, each list's items), the picks owed by
  level with "Choose" (the learn panel then lists the catalogue items that fit), the party's families from the roster
  snapshots, and "Learn a formula": a search over the catalogue or an item dropped on the tab, the route to craft it now,
  every acquisition route with its cost and time, the break-even of buying (`breakEven`: the formula's Price against the
  setup day it saves, at the crafter's success rate; "needed" without access), and a button per route (Buy, Copy, Scan,
  Ask <ally>, Invent, Reverse-engineer, Take as this pick, Craft a copy for <member>). The tab is built only while it is
  shown (it scans the catalogue). `features.formulas` (W, on) turns it off.
- **Casting pledges** (6.9): `orders.<id>.pledges.<id>` = `{caster, spell: {uuid, source, name, rank, traits,
  category}, rank, castings, payer, day, status, service, costCp, paidFrom}` (`paidFrom` and a null `payer` for the party
  fund since M5 on M4.1), written by the caster's owner. Scrolls and wands are
  pf2e's base items by rank (`CONFIG.PF2E.spellcastingItems`, `productFacts().spellcasting`), staves and spellhearts by
  trait; an order for one is `craftType: "spell-item"`. Rules (`pledgeProblem`): no cantrips, focus spells or rituals,
  a spell no higher than the item's rank, one spell for a scroll batch, at most 4 scroll castings, one wand casting.
  G9 counts fulfilled castings (one per scroll, one otherwise). "Mark cast" is the caster's owner's confirmation
  (OQ-15 stays open: pf2e has no public call that spends a slot without casting); a spell cost given then is a purchase
  row from the payer. "Buy a casting" makes a fulfilled pledge with no caster and a purchase row at the service price.
  The finished scroll or wand is pf2e's base item with the pledged spell as `system.spell` at the item's rank, pf2e's
  name template, the spell's traits (no `magical` beside a tradition) and rarity, and a link to the spell
  (`spellItemSource`, as pf2e's unexported builder does).
- **Custody and stock** (G10, 6.6): a member hands over an item from a character they own (`handOver`): one coin move
  with no coins, a `custody-in` row (or `material-in` for stock; both new or reused kinds with no amount, the value on
  the line), the item deleted from its owner and created in the strongbox with its own id and `flags.MOD.earmark =
  {order | service, line, purpose, from, by}`, and a line `orders.<id>.custody.<line>` (purposes `target`, `source`,
  `possession`) or `orders.<id>.materials.<line>` (precious stock: an item with the `precious` trait whose slug ends in
  ingot, chunk, lumber or branch; `stockMaterial`). Items are given back by a shelf flag for their former owner
  (`givingBack`, `giveBack`: once per line), whose client collects them; deliveries drop the earmark.
  `lockFirstBatch` takes `itemUpdates` (nested updates, after the debits) and `createItems` keeps given ids. Part of
  a stack can be handed over (`quantity`; the owner's stack is reduced by a quantity update): stock goes whole unless
  a number is given (the Stock prompt asks how many), any other item one at a time, so an etching, a transfer or a
  repair never holds a stack. A resumable move names, as the actor its resumer must own, any character it updates or
  creates items on as well as a purse (`purseOf`), so a finish that changes the crafter's item in place while its
  coins come from the strongbox is resumed only by a user who can write that item.
- **Precious materials** (6.6): `orderPrecious` checks the product's material and grade against the crafter and the
  stock lines (coin stands in for cold iron and silver while `rules.preciousCoinForCommon` is on). Stock counts toward
  G8's up-front half at its Price; the start's coin commit is the half less the stock, so a stock-funded order may
  commit nothing; the funding bar counts the stock too. Stock is taken only while the next step will count it
  (`STOCK_STATUSES`: requested, accepted, failed; the Stock button shows then only): once an attempt has committed, a
  hand-over is refused as `state`. G8's precious failure is told problem by problem with its numbers (the share of
  the material needed and what the order has, "only stock counts" for an uncommon material, the rank, level or grade
  cap), not as one sentence. The stock is used up at the finish (a `material-out` row and the
  item deleted), or at a cancel once an attempt settled as a success; otherwise a cancel gives it back.
- **Etching, upgrades and transfers** (6.13; `craftType` `rune-etch`, `upgrade`, `rune-transfer`; `target` the item's
  UUID; a transfer's source in `variant.transfer.source`): the item must be in custody (on the crafter, or handed over
  and earmarked to the order), one item, never a stack (`target-stack`: a stack on the crafter must be split; a
  hand-over takes one). `runeOf` reads a rune item's slug and usage; `usageFits` checks the usage against the item
  (`wrong-item`), `runeLevelProblem` the grade cap of a precious item (`grade-rune-level`); an etching costs the rune's
  Price (`etchPriceCp`), or the difference to the rune it upgrades, whose Price is read from the catalogue by its slug
  (`runeSlug`), at the rune's level and DC; a property rune pf2e has no key for is refused (`rune-unsupported`,
  `pf2eKnowsProperty`: an unsaved non-specific copy of the item is no dearer with it); a stronger grade of a property
  rune replaces the weaker in its slot, by etching or transfer (`propertyGrade`, `replaces`); an upgrade costs the
  stronger grade's Price less the item's, at the new level's DC, and must be the same family and a higher level; a
  transfer costs 10% of the rune's Price (nothing from the rune's own item, pf2e's rune on a runestone such as `Striking`:
  an item made from the order's rune, or with its slug and an etched-onto usage, `isRuneItemOf`; it is used up; a blank
  `Runestone` holds nothing and is refused as `not-there`) with one setup day; G12's rune rules (`runeProblem`) apply to etchings and transfers. At the finish the item is
  changed in place on the crafter when the crafter is the recipient; changed in the strongbox and put on the shelf for
  the recipient; or moved from the crafter to the shelf. An upgrade replaces the item with the compendium's stronger
  grade.
- **Service orders** (4.5): `services.<id>` = `{kind, party, requester, performer, target, host, uuid, status, result,
  note, created, custody, closed, by, at}`; kinds `repair`, `affix`, `unaffix`, `identify-alchemy`, `formula-copy`.
  Anyone with a character offers; the performer's owners perform; the requester's or performer's owners or a GM cancel
  (items handed over go back). Closing takes the lock page `service:<id>:close`, so a service closes once. Repair rolls
  Crafting with `action:repair` and the item's traits as `target:trait:` options against the item's level DC with no
  rarity adjustment, restores Player Core's Hit Points or the Crafter's Eyepiece's (registry kind `repairHp`, worn and
  invested; an untrained performer restores the base), and on a critical failure deals 2d6 less Hardness; the
  performer must carry a repair toolkit (registry
  `repair-toolkit`, `repair-toolkit-superb`; Improvise Tool waives it for Repair only). The item is on the performer or
  handed over for the service. Affixing writes `flags.MOD.affix = {host, at, by}` on a talisman or spellheart on the
  performer, with one per host (two with Talismanic Sage), the host types the talisman's usage names
  (`affixHostKinds`: `affixed-to-armor-or-a-weapon` is armor or a weapon; none named, any armor, shield or weapon),
  bombs left out by
  `rules.talismanHostsExcludeBombs` (W, on); it steps aside while PF2e Talisman Manager is active. Identify Alchemy runs
  pf2e's own action. A rune transfer is an order, not a service.
- **The Queue and the request form**: rows show the order's kind and the item it works on; the detail shows the spell
  supply and pledges (pledge a casting, mark cast, withdraw, buy a casting), the items held for the order and those
  still to hand over (hand over, give back, add precious stock); a Services list follows the orders (offer, hand over,
  perform, cancel). The request form asks what the request is (a Craft, an upgrade, an etching, a transfer, a service)
  and offers the requester's items that fit (`itemChoices`), the source of a transfer, the host of an affix and the
  performer of a service; its search uses the catalogue.
- **API** (11.2): `formulas.{knows, routes, family, provenance, codex, acquire}` (`acquire` covers every route of macro
  11), `pledges.{pledge, fulfil, withdraw, buy}`, `custody.handOver`, `services.{list, get, request, offer, perform,
  cancel}`.
- **Registry**: entries `crafters-eyepiece`, `crafters-eyepiece-greater` (`repairHp {success, critSuccess}`, a new
  kind), `repair-toolkit`, `repair-toolkit-superb`, and Improvise Tool's repair-toolkit substitution under
  `action:repair`; the four items left the ignore list (247 entries, 1204 ignored, validated against the pf2e checkout).
- **Live plans** (15.3; first run in the M5 live pass below): `m5-buy` (GM, P2), `m5-ally-copy` (P1, P2, no GM; the learner offline at the
  copy and applying it at login), `m5-pick` (GM, P1), `m5-jobs` (all three: invent, reverse-engineer, craft a copy),
  `m5-etch` (custody of P1's sword, crafted by P2, collected by P1), `m5-upgrade-transfer`, `m5-precious` (coin turned
  off for common materials; an ingot handed over), `m5-scroll` (the wizard fixture's pledge by the GM; a bought
  casting), `m5-services` (Repair with custody, affix and its refusal, unaffix, Identify Alchemy, with no GM), `m5-ui`
  (the tab driven with clicks) and `m5-shots` (the Formulas tab as GM and P1 at 1440x900 and 1024x768, dark and light,
  plus the Queue with custody and a service); since the merge onto M4.1, `m5-fund` (P1, P2, no GM: a formula and a
  casting bought from the party fund, the server's strongbox the unallocated fund plus what is earmarked).
- **After the M5 review**: the fixes above (transfer sources, multi-host talismans, etching prices, rune usages and
  grade caps, property-rune grades, untrained Repair, stock only before an attempt and part of a stack, single items for
  changes, pending formula claims, the resume actor of an item update, G8's texts, Runic Crafter's picks over every
  weapon and armor property rune usage). The Formulas tab's controls are found again after a re-render (10.9): the
  search field has a name (`codexSearch`), and its buttons carry `data-op` like the Queue's.

#### As built in M5 on M4.1 (2026-10-26, the merge of M5 onto fund accounting)

M5 was built on M4 and merged onto M4.1 (DECISIONS.md 2026-10-26, "M5 on fund accounting"). Where the two meet, M5's
money now goes through M4.1's funding model and its words follow M4.1's; the unit and stub tests cover each point
(`test/logic/funds.test.mjs`, `views.test.mjs`, `test/foundry/m5.test.mjs`, `ui-m5.test.mjs`), and the live harness was
not run.

- **Purchases from a source** (4.6 As built in M5 on M4.1): a formula bought (Buy, Copy from an NPC), a casting bought, a
  spell's cost when a casting is marked done and a formula copy's cost are paid from the party fund or a character's
  purse (`payPurchase`, `scripts/foundry/purchases.mjs`), behind the fund slot when from the fund; an order's purchase from
  the fund is earmarked and spent in one move, behind the order's return slot too, and shows as spent by the party fund.
  The casting record keeps `paidFrom` and `payer`; a service its `payment = {row, source, cp}`.
- **The amount prompt** (B of M4.1) asks for these: a price (`fixedCp`) shows "Price: X" and the choice of source with
  no fields to type (hidden fields carry it, so a party fund that cannot cover it says so and points at a purse); a
  spell's cost (`optional`) is four coin fields where nothing typed is no cost, starting on the caster's purse. The
  purse options read "Bo's purse" (paying takes the coins out of it, not into the strongbox) and the fund option "(N
  unallocated; paid out of the strongbox)". The casting dialogs no longer ask for a payer or a typed amount.
- **Material stock** (4.7, 6.6 As built in M5 on M4.1): "Fill the shortfall" and the requirement's "Fund it" ask for the
  up-front half less the stock; stock is listed by source beside the money; a finished order's cost says what stock
  went into it and what was bought for it (`costSummary`: `stockCp`, `purchasesCp`, both in the total).
- **Requirements in plain words** (C of M4.1): G9 for a scroll, wand, staff or spellheart reads "Spells cast for it",
  G10 "Item to work on with the crafter" (an etching, an upgrade, a transfer) or "Item to reverse-engineer at hand"
  (a formula job), G12 "A rune this item can take" or "A stronger grade of this item" (`requirementVariant`). The unmet
  ones offer their fix beside the reason: precious stock "Add precious material stock", G9's spells "Offer a casting"
  and "Buy a casting", G10 "Hand over <item>" (`REQUIREMENT_ACTIONS`); each carries `data-fix="requirement"`, so focus
  comes back to it and not to the same button lower in the detail (10.9; `focus.mjs` reads `fix` and `item`).
- **Words** (M4.1's conventions): a casting is offered ("Offer a casting", "Withdraw the offer", "That casting offer is
  gone") rather than pledged, since "pledge" meant money in M4; the casting buttons announce "Castings updated"
  (`Event.Pledge` is "Order funded from a purse" since M4.1); an item handed over is given back with "Give the item
  back"; the Queue's funding line says "earmarked" (it counts stock now) where M4 said "pledged". The duplicate
  `no-actor` refusal left by the merge reads M4.1's "You have no character to do that with."
- **The item picker** (F of M4.1): the Formulas tab's "Learn a formula" has "Browse" beside its search, which opens pf2e's
  Compendium Browser on its equipment tab to drag an item onto the tab; the request form keeps M4.1's Browse and the
  Queue's magnifying glass next to M5's request kinds.
- **API** (11.2): `formulas.acquire({..., pay})`, `pledges.fulfil(order, pledge, {cost, pay})`, `pledges.buy(order,
  {spell, castings, from, pay})` and `services.request({..., pay})`, `pay` being `{source: "fund"}` or `{source: "purse",
  from}` (the acting character's purse by default).
- **Live plan** `m5-fund` (15.3), run with the other `m5-*` plans in the M5 live pass below.
- **Review fixes of the merge.** Before start, what an order still needs, the Queue's funding bar and "Fill the
  shortfall" are judged against the plan it would freeze now, as G8 judges it (`planEstimate`, `estimateOf`'s `plan`),
  not the snapshot's Price: a formula job costs the formula's Price, an upgrade or a rune upgraded in its slot the
  difference, a transfer a tenth of the rune's Price or nothing, a free crafter nothing. With no crafter yet, an item
  change is estimated at its list Price; a plain Craft keeps its snapshot. A finished formula job and an item changed
  in place say where they went (5.5 As built in M5 on M4.1) instead of "On its way" for ever, and M5's item rows
  (handed over, given back, stock in and out) show no amount in the ledger, as M4.1's item rows do.

#### M5 live pass (2026-10-26, Foundry 14.368, pf2e 8.6.1, no canvas)

One pass of every plan, once each, at `7504433` (M0-M5 with M4.1's fund accounting):

- **M4**: `m4-lifecycle`, `m4-no-gm`, `m4-cancel`, `m4-double-delivery`, `m4-reroll-race` and `m4-ui` pass. There is no
  separate M4.1 plan; `m5-fund` covers fund accounting under purchases, and the hands-on pass below the window.
- **M5**: `m5-buy`, `m5-pick`, `m5-jobs`, `m5-precious`, `m5-fund`, `m5-services` and `m5-ui` pass at the first run;
  `m5-ally-copy`, `m5-etch`, `m5-upgrade-transfer` and (in the sync run) `m5-shots` failed, and `m5-scroll` passed
  without crafting anything. Every one was the plan's fault, not the module's; each is fixed with a test and passed when
  run once more:
  - *A step acting on another client's write before it arrived.* `m5-ally-copy`: Player One performed the formula copy
    7 ms after Player Two filed it, so Player One's copy had no such service and the module answered `no-service` (as
    it should: the window shows "Perform" only once the record is there). `m5-scroll`: Player Two ran the order 8 ms
    after the GM marked the castings cast, so Player Two's copy still held them offered, the start was refused on G9,
    and the plan, which checked the scroll only `if` the order completed, passed. The new step `m5.seen` (`seen()` in
    `formula-scenarios.mjs`) waits until this client's copy has a path (and a value); both plans use it, and
    `m5-scroll` now checks that the order completes or fails its check. Test: `test/foundry/harness-m5.test.mjs`.
  - *pf2e derives a runed weapon's name.* `m5-etch` and `m5-upgrade-transfer` looked for their swords by the name
    "Longsword", but pf2e prepares an armor's, shield's or weapon's name from its runes and material
    (`generateItemName`: "+1 Striking Longsword") and keeps "Longsword" in its source; the swords had come back with
    their runes as the plans meant. The `state` step finds an item by either name (`named()`). Test: the same file.
  - *A grade the family covers has no route to learn it.* `m5-shots` opened Elixir of Life (Lesser) for Player One
    after buying the (Minor) formula and expected acquisition routes; 6.4 makes the (Minor) formula cover it ("Crafting
    it now: another grade is known"), so there are none. The shots open Alchemist's Fire (Lesser) instead. Test: the
    covered-grade case in `test/foundry/ui-m5.test.mjs`.
- **Sync scenarios and the other behaviours** (`--runs 1`): scenarios 1, 2, 3, 3b, 3c, 7, 7b and 9 and the behaviours
  `lost-lock`, `dry-run-replay`, `pf2e-drop`, `modified-time`, `server-time`, `sweep-stagger`, `purge-party`,
  `assistant-switch`, `observer-strongbox`, `migration-lock`, `relaunch-stamp`, `cleric-fixture`, `slow-answer`,
  `resume`, `relay-race`, `craft-gear-bonus`, `craft-rarity-dc`, `craft-hero-reroll`, `craft-second-roll`, `wage-once`
  and `m4-shots` pass (with `m5-shots` above: 39 of 39 behaviours over the three runs). The screenshots were looked at:
  no overflow, no raw keys.
- **Console errors per page**: none in any M5 plan or the hands-on pass. The rest are the classes 5.4 and 15.3 expect:
  core's "The _id [...] already exists" toast for the loser of a lock race (3b, 7, `lost-lock`, `dry-run-replay`,
  `resume`, and `m4-double-delivery`'s late apply request, with "A parent Document provided to the database operation
  must be a Document instance" from the same refused request), "Item ... does not exist" for scenario 7's injected
  deletion, `cycleTokens` page errors on a player's client without a canvas when an actor's ownership changes (7b,
  `observer-strongbox`), and the dropped connection of `resume`.
- **Hands-on pass as Player One** (a scratch Playwright script with real clicks and typing, GM online; no module calls):
  the Actors directory's Workshop button; Funds, "Add to party fund" 40 gp (the gold field has focus); the request
  form (search "Elixir of Life (Minor)", pick, quantity 4, crafter Player One's alchemist, submit); "Fund this order"
  from the party fund with "Fill the shortfall" (6 gp; the fund chosen first since it covers it); Start, two setup days,
  Roll through pf2e's own check dialog ("Roll (+22)"), Settle (a critical success); "Finish: pay 6 gp", choosing
  Player One's purse for the 6 gp short; the four elixirs delivered to Player One; then the Formulas tab, a search for
  Antidote (Lesser), Buy, paid from the party fund (1 gp; the purse untouched), the formula in the book. After every
  step the Funds tab's identity line held and matched the server: 40 = 40 + 0; 40 = 34 + 6 after the earmark (no
  coins moved); 34 = 34 + 0 after the finish (12 gp spent, 6 of it drawn from the purse); 33 = 33 + 0 after the
  purchase; reconciliation balanced and nothing pending throughout.

#### Follow-ups (M5 on M4.1, low)

- A purchase for an order is paid from the party fund or a purse, never from what the order already holds: the order's
  earmarked money stays for its up-front half and its finish.
- A formula copy's cost is refunded on a cancel only when the user cancelling may move it back (anyone for the party
  fund, the purse's owner for a purse); otherwise its payer reverses the row in the Funds ledger.
- Purchases stay reversible by their author in the Funds ledger (4.6), and reversing a formula's purchase leaves the
  formula in the book; a bought casting's reversal leaves the casting fulfilled.
- More castings can be bought for a scroll order than it has scrolls (`pledgeProblem` checks the batch's limit of 4,
  not the quantity).
- `allyCopyCostCp` is a setting typed in copper ("(cp)" in its name), unlike every amount the windows ask for.

- From the merge review (low, not yet fixed):
  - The Compendium Browser opener exists twice (`browse()` in `scripts/ui/formulas.mjs` and the request form's);
    export one helper. `payPurchase` should use the viewer's `hasCharacter` rather than its own check.
  - Reversing a party-fund purchase made for an order in the Funds ledger reverses only the `purchase` row; the
    order's earmark pair stays. Reverse the pair with it, or document that the money stays earmarked to the order.
  - `payPurchase` does not re-check inside the coin mutex that the order is still open, and a purse-paid purchase
    for an order takes neither the order's log slot nor its return slot.
  - `pledges.fulfil(order, pledge, {cost, pay: {source: "purse"}})` without `from` refuses "no-actor"; default the
    payer to the pledge's payer or caster.
  - The Buy / Copy from an NPC dialog shows the price from the rendered button, while `acquire()` recomputes it; a
    stale render can show a different price. Recompute before asking, or refuse when the confirmed amount differs.
  - G9 reports "checklist" whenever another checklist key is open, which hides the spells fix buttons; key the
    actions on the missing spells instead.
  - A scroll order accepts more bought castings than it has scrolls.

- Found in the M5 live pass (2026-10-26, low):
  - Other plans still act on another client's write the moment it resolves (`m5-etch`: Player Two accepts 129 ms after
    Player One files; `m5-services`: Player Two performs the Repair 54 ms after Player One hands the shield over); they
    passed, but by timing. Put `m5.seen` before each step that reads a record another client just wrote.
  - Plans that accept a failed Craft check (`m5-jobs`, `m5-etch`, `m5-upgrade-transfer`, `m5-precious`) check the
    finish only `if` the order completed, so an order that never started passes as `m5-scroll` did; check that each
    reached its check (complete or failed), as `m5-scroll` now does.
  - The Funds ledger's row for a formula bought outside an order has an empty "For": name the formula and whose book.
  - The Buy dialog says the price twice ("The formula for Antidote (Lesser) costs 1 gp." and "Price: 1 gp").
  - The break-even reads "pays for itself after 1 Crafts" (the counts not made singular, M4 live pass follow-up). (Fixed in M11, 10.18.)
  - 17.1's README screenshots fall due with this pass, and `npm run screenshots` (`tools/harness/screenshots.mjs`, a
    demo party with generic names) is not built yet; `m4-shots` and `m5-shots` show the fixture names.

#### Follow-ups (M5, low)

- Stock is at risk only once an attempt succeeds: a critical failure ruins 10% of the committed coins and nothing of
  the stock (with stock covering the half, nothing at all), and stock handed over beyond what the up-front half needs
  is used up at the finish (part of a stack can be handed over, so a member need not hand over more). Ruin a share of
  the stock's value, and count only what the half needs.
- `gainedAtOf` falls back to a feat's own level when it has no level taken (granted or unslotted feats), which shifts
  the picks it schedules; rank-based picks all fall at the level the feature was gained.
- Provenance is written only when none exists: a formula deleted on the sheet and learned again another way keeps its
  old route and source.
- PF2e Talisman Manager's module id (`pf2e-talisman-manager`) was not checked against its manifest.
- Dropping a formula book on the Formulas tab to import it, and a material item on an order to earmark it (10.6), are
  not built; the Codex does not hide what Automatic Bonus Progression replaces (6.4 ABP), nor legacy-only items
  (`legacy.show`); swaps of runes have no field in the request form (`transferRunes` supports them); affixing works only
  on the performer's own actor (an affix made in the strongbox would name a host id that changes on delivery).
- A Repair, an affix and an Identify Alchemy are recorded from the roll's result on the performer's client, not from
  its chat message, so a Hero Point reroll of the Repair check is not applied (6.12 records orders and jobs only).
- A finish for a scroll or wand with no pledged spell (Craft Anything waived G9) is refused as `no-spell`; offer a
  plain base item or a spell choice there.
- The narrative Craft Requirements checklist (G9's other half) is still not parsed; spellhearts and staves rely on the
  caster's castings count.
- Upgrading a grade rebuilds the item from the compendium, so customisations of the old item (runes, a material, a
  name) are not carried over; raising a precious material's grade is not offered.
- Material lines are counted toward the funding bar but not shown in "Funded by", and withdrawals ignore them. (As
  built in M5 on M4.1 they are listed under "Earmarked for this order" and in the Funds tab's "By order", by who handed
  them over; withdrawals still ignore them.)

From the M5 review (low; the medium and high findings were fixed, 10.11 "After the M5 review"):

- Material stock counts toward G8 and lowers the coin commit whatever its material and whatever the product (a silver
  ingot funds a potion's up-front half), and the finish uses up every material line. Count and use up only lines of
  the product's precious material (or the target's, for a grade upgrade); give the others back.
- Some stock never matches its product's material: `djezet-mass` and `throneglass-shard` match no suffix (add `-mass`,
  `-shard`); sisterstone chunks and ingots strip to `sisterstone` while items use `sisterstone-dusk` and
  `sisterstone-scarlet`; dragonhide has no stock item, so Dragonplate (and the throneglass Destiny Blade and Azlanti
  Diamond) can never pass G8. Let a confirmed checklist line or a GM-confirmed value count as stock for those.
- Identify Alchemy is a trained action that needs an alchemist's toolkit held or worn; the service checks neither (nor
  does pf2e's action). Refuse `untrained` and `tool` before running it.
- Buying a casting for a 10th-rank scroll throws a RangeError (the spellcasting-service table stops at rank 9); refuse
  `no-service` and hide "Buy a casting" there. (Fixed in M5 on M4.1: `castingPrice` refuses `no-casting-service`
  before any money is asked for; the button still shows.)
- 17 compendium runes have no pf2e property-rune key (Energy-Resistant and its greater grade, Vitalizing, Spell
  Reservoir, Quickstrike, Animated, Called, the mythic runes and others). Since etchings are priced from the rune items,
  an etching of one is refused as `rune-unsupported` (naming the rune: pf2e values only the keys it knows,
  `pf2eKnowsProperty`) rather than charged for a key with no effect; offering Energy-Resistant's energy choice as
  pf2e's `acidResistant`, `coldResistant` and so on is not built.
- Talismanic Sage lets every host take two talismans; the feat treats one item at a time. Record the treated host on
  the performer and allow two there only.
- Snarecrafter Dedication's and Gadget Specialist's rank picks count every listed rank held now, including ranks held
  before the feat was taken; Snarecrafter grants them only when the rank rises afterwards (an `onIncrease` flag).
- `handOver` does not check that a target, source or possession is the item the order names, nor that the order has no
  such line yet (only the Queue prevents a second target line); a second target line is never placed or given back.
  A target handed over by someone other than the recipient goes to the recipient at the finish, which the hand-over
  prompt does not say.
- `giveBack` and `start` take different locks, so stock given back while the order starts can be counted toward the
  up-front half and still go back. Have `giveBack` on an order take its log slot too.
- Offering to perform a service is an unlocked write (two offers at once both believe they hold it) and overwrites the
  record's `by`; take a lock page `service:<id>:offer` and write the offerer to `offeredBy`.
- Withdrawing a pledge is an unlocked write and can overwrite a concurrent "mark cast" that paid a spell cost; have
  fulfil and withdraw take one per-pledge lock page.

Left by the fixes (low):

- Talisman hosts are read by kind only (armor, shield, weapon, worn equipment for headgear): the narrower words of a
  usage (metal, melee, ranged, firearm, two-handed, a magical staff) are not checked, and the request form offers only
  armor, shields and weapons as hosts, so a headgear talisman is affixed through the API.
- Metal armor is told by its group (chain, composite, plate) or a `metal` trait; a precious material is not read. A
  property-rune swap does not check the rune going back against the source's usage.
- A transfer to an item that cannot take the rune is refused rather than rolled as an automatic critical failure
  (GM Core p.225).
- A blank runestone is never a transfer source: etching a rune onto a runestone (which would record the rune it holds)
  is not built, and a stack of rune items must be split before a transfer from one.

### 10.12 As built in M6

M6 builds downtime: per-PC status, clock accrual and its prompt, the day resolver, the Advance days wizard, Communal
Crafting helpers, Earn Income jobs and settlement profiles (pure parts in `scripts/logic/downtime.mjs`, `jobs.mjs` and
additions to `communal.mjs`, `orders.mjs`, `rolls.mjs`; Foundry parts in `scripts/foundry/downtime.mjs`, `jobs.mjs`,
`communal.mjs` and additions to `orders.mjs`, `rolls.mjs`, `sync.mjs`, `settings.mjs`, `api.mjs`; the window in
`scripts/ui/downtime.mjs`, `advance.mjs`, `days.mjs`, `templates/workshop/downtime.hbs`, `templates/advance/wizard.hbs`,
`templates/chat/days.hbs`). The rules are in 4.8, 4.9, 6.7, 6.10 and 9 (As built in M6). Unit tests cover the pure parts
(`test/logic/downtime.test.mjs`, `jobs.test.mjs`), stub tests the Foundry and window parts (`test/foundry/downtime.test.mjs`,
`ui-m6.test.mjs`); the live plans passed their first live pass (M6 live pass, below).

- **The Downtime tab** (10.1): the workshop day with pf2e's World Clock date (`dateAsString`; none while a calendar
  module shows the date, review fix), the days logged ahead of the calendar
  (with "Move the calendar to match" for a GM) and a calendar set back; one row per character (a player's own, every
  member for a GM): in downtime or not ("Start downtime" / "End downtime", the owner's), since when, the activity its
  days go to (the owner chooses among the orders it crafts that take days, the orders it helps with, its open Earn Income
  jobs, subsisting, retraining or something else; locked while it helps), the days to resolve, the last day resolved and
  the next, and "Resolve days" (with "no activity chosen yet" beside it when that is so); "Advance days" for any member
  with a character. The settlement section: where the party
  is (any member chooses), its cap and exceptions, who set it; for a GM, the settlement profiles (name, size, highest
  task level, exceptions by skill, notes), added, edited and deleted in place. Earn Income jobs (own for a player, all
  for a GM): skill and task level, status (icon and word), "no settlement set", the settlement, the DC (when pf2e shows
  DCs), the check, pay per day, days paid and the total, "may be cut short", a kept-out reroll; Roll, Roll again, End,
  Undo; and "Take an Earn Income job" (character, a trained skill, task level, the cap, DC and pay per degree). Text and
  number fields keep what is typed across live updates (review fix). `features.downtime` and `features.income` (14.1)
  turn the tab and the jobs off.
- **The header and the tab button** (10.2): "Day N" and the World Clock's date; the Downtime button carries a badge with
  the number of the user's characters with days to resolve (described to screen readers by `aria-description`), and the
  nav renders again only when that number changes. The clock moving renders the header and the Downtime tab only when
  its day changes (review fix): combat rounds and a calendar module's running clock move it far more often.
- **The wizard and the resolver** (9.1, 9.2 As built in M6): one window (`AdvanceDaysApp`, a child of the Workshop so a
  detached Workshop opens it in its own browser window; one at a time, the old one closed before the new one renders,
  review fix), step by step with a numbered stepper (`aria-current="step"`), Roll buttons for the checks due, and a
  summary of what was written. Focus stays on the control that had it across live updates (the Workshop's `focus.mjs`,
  which tells per-character controls apart by `data-actor`, and jobs, settlements and skills by theirs), moves to the
  new step's first control when the step changes, and live updates wait while a field has focus; typing the number of
  days updates the day it leads to in place, and Enter goes on (review fix).
- **Helpers on an order's detail** (6.7 As built in M6): each helper with their skill and rank (when pf2e's party stats
  show), their check, what they take off a day, since when and until when (and whether they forfeited), "waiting for the
  crafter to accept"; Roll helper check, Stop helping (confirmed, saying whether they lose what they gave), Accept
  helper; and "Help with this order" (a character of the user's and a skill, with why a choice cannot help). The rule
  and the DC in a hint.
- **The day card** (10.5): "Downtime days": per PC, the span ("3 days (days 4 to 6)") and one line per activity ("2 setup
  days on X", "3 days of work on X: up to Y off what is left to pay", "2 days of Earn Income ...: Z earned", "1 day not
  in downtime"), and where its days stopped with what to do. Every count has a key for one.
- **Refusals** in plain words: `days-pending`, `no-activity`, `no-days`, `paid-off`, `helper-locked`, `not-eligible`
  (with the reasons), `not-helping`, `left`, `crafter`, `untrained`, `task-level-range`, `task-level-cap` (with the cap),
  `no-profile`, `bad-profile`, `not-gm`, `same`, `no-job`, `stale-round`, `unrolled`; and from the review fixes
  `helping`, `job-days-pending` (with the count), `job-moved-on`, `moved` (with the day). The day stops add `settle`.
- **API** (11.2): `downtime.{today, status, pending, setDowntime, setActivity, resolve, advance, advanceClockToMatch,
  setSettlement, settlement, profiles}`, `income.{list, start, roll, reroll, end, undo}`, `communal.{join, leave, roll,
  accept}`; an activity is `{kind, ref}` or its key (`"craft:<orderId>"`, `"earn:<jobId>"`, `"subsist"`), and the wizard's
  assignments may say `"skip"` or `"not-downtime"`.
- **Hooks** (12.3): `downtimeDayStart` `{day, mode: "wizard" | "resolver" | "work", actors, assignments}` and
  `downtimeDayEnd` `{day, results: {[actorId]: {activity, rows, notes}}}`, once per resolved day on the writing client.
  `mode` "clock" is not used: the clock never writes; its days are resolved by the resolver.
- **Settings** (14.1, 14.2): `features.downtime` (W, on), `features.income` (W, on), `settlements` (W, hidden; the
  profiles). `rules.costOfLiving` stays registered and is not read yet.
- **Sync**: the sweep gains a "wages" step (`sweepWages`) and an "orders" step (`sweepOrderRepairs`: the order repairs
  of the crafters this client is responsible for, review fix); a ledger change to `meta` re-checks the shared documents only
  when it touches `meta.migration` (M6 keeps the logged days, the settlement, the day offset and the clock's high-water
  mark in `meta`).
- **Live plans** (15.3; `tools/harness/downtime-scenarios.mjs`, scenario `m6`; `live-plans.mjs`; run in the M6 live pass below):
  - `m6-clock` (GM, P1, P2): P1's alchemist in downtime; the GM moves the clock a day: one pending day and one prompt on
    P1's client only; an hour more prompts nothing; resolving leaves nothing pending; with P1 away the GM's client is
    prompted; at P1's login P1's client prompts for the day that accrued; the tab shows the pending day and the badge.
  - `m6-wizard-gm` (GM, P1, P2): both PCs in downtime (P1 subsisting, P2 on a rolled Earn Income job); the GM drives the
    window (two days, "also move the world calendar", next, next, next, commit): the steps in order, the clock offered,
    both PCs listed; both resolved two days; P2's wages are claims P2's client collects once each; the clock's day is
    the logged day; nobody prompted; "since last resolved" again writes nothing; reconciliation balances.
  - `m6-wizard-players` (P1, P2, no GM): P1 drives the window for three days: no clock offered; three days each, logged
    ahead of the calendar; P2's three wages collected with no GM; then the GM logs in, the tab says three days ahead and
    "Move the calendar to match" lands the clock inside the logged days with no new prompt.
  - `m6-communal` (GM, P1, P2): the GM gives P1's alchemist Communal Crafting; P1 crafts two Elixirs of Life (Lesser) to
    finishing (`COMMUNAL_ORDER`: 30 gp left after the up-front half, so both work days fall before it is paid off); P2's fighter crafter joins with Crafting (accepted, locked, check recorded); two work days carry P2's
    share; P2 leaves and forfeits it (the reduction drops by exactly the share); rejoining is refused.
  - `m6-income` (GM, P2 on two devices): a rolled job; the clock moves two days; both devices resolve at once: one lands,
    the other is refused or finds nothing; the GM's wizard adds a day (a claim both devices race to collect); repeated
    advances and resolutions write nothing; three wage rows, one a day; the purse grew by three days' pay.
  - `m6-settlement` (GM, then P1 alone): the GM keeps a village (highest task level 1, Crafting up to 2); P1 with no GM
    online puts the party there (set by P1); a job at 3 is refused with the cap 2, one at 2 starts confirmed; with no
    settlement a job at 9 starts, unconfirmed.
- **After the M6 review** (one pass, fixed with a test each where a test can show it):
  - "Resolve the rest" after a wizard commit advanced the span again (a second N days); it now resolves through the day
    the first commit reached.
  - Opening the wizard while one was open could render a second window under the same id before the first closed; the
    old one is now closed first.
  - A helper leaving while the crafter had already resolved days ahead got a `leftDay` inside those days; it is now the
    first day neither has resolved.
  - Text and number fields of the Downtime tab (a settlement's name and notes, levels, a job's task level) lost what was
    being typed when a live update rendered the tab; they are kept in the tab's state as they are typed.
  - The job form lowered a task level typed above the settlement's cap to the cap without saying so; it now keeps what
    was typed and Start refuses it with the cap.
  - Undoing a job's start left the earner's activity naming the removed job; it is cleared.
- **After the second M6 review** (one pass, medium findings fixed, each with a test that fails without it):
  - A runner who did not own the crafter wrote extra days of an order in `rolled` at the recorded degree, which a reroll
    before settlement could then make wrong (a crit's 200 cp a day kept after a reroll to a success), and wrote them for a
    recorded failure, and past the paid-off day. The planner now stops at `settle` for everyone but the crafter's owner,
    whose resolver settles first; the owner's preview shows the days as that settlement leaves them.
  - A setup a runner's records completed stayed in `setup` while the crafter's client was away, and each later run wrote
    one more setup day. The planner stops at `check` once the records complete the setup, and the sweep repairs the order
    at the crafter's player's next login.
  - Undoing a job's roll-again after the new round's check was rolled brought the earlier check back: the better of two
    rolls. It is refused (`job-moved-on`) once the new check is rolled.
  - A helper's share counted while the helper was out of downtime or had the same days counted as "not downtime". Joining
    puts the helper in downtime, ending it waits for leaving (`helping`), and "not downtime" stops `locked`.
  - Ending a job made the earner's unresolved past days pay nothing. End waits until they are resolved
    (`job-days-pending`).
  - The wizard committed a span recomputed at commit time: two players advancing a day at once advanced two, and a clock
    move during review wrote more than the review showed. The span is fixed when leaving the first step, and a commit
    after the day moved writes nothing and goes back to it (`moved`). The wizard also renders again when the clock's day
    changes.
  - Focus after a live update went to the first character's select or button in the Downtime tab and the wizard; the
    wizard lost focus on every step and update, and typing a number of days and clicking Next could lose the click.
  - The resolver for a PC with no activity defaulted to "leave these days" and wrote nothing without saying why; it now
    asks for an activity, is titled with the PC's name, and the wizard's review and done steps name the PCs it leaves.
  - The World Clock's date never showed (`worldClock.date` does not exist; `dateAsString` does).
  - Every world-time change rendered every Workshop part and put off the day prompt, which a running clock could starve.

#### M6 live pass (2026-10-26, Foundry 14.368, pf2e 8.6.1, no canvas)

One pass at `9da0312` (M0-M6), then once more after the fixes below:

- **M6 plans** (`--runs 1`): `m6-clock`, `m6-income` and `m6-settlement` pass at the first run; `m6-wizard-gm`,
  `m6-wizard-players` and `m6-communal` failed, and pass after the fixes.
- **Regression** (`--runs 1`): scenarios 1, 3c and 7, and `m4-lifecycle`, `m4-no-gm`, `m5-fund` pass; `m5-buy` failed on
  the plan's card count (below) and passes once fixed. Console errors: only scenario 7's expected ones (the lock race's
  "already exists" toast and its injected "does not exist", 15.3).
- **Found and fixed** (each with a test that fails without it):
  - *Every string showed as its raw key in a live world* (high). `lang/en.json` held `Settlement.Size` ("Size") beside
    `Settlement.Size.Village` and the other sizes; Foundry expands the dotted keys into nested objects
    (`Localization#loadTranslationFile`, `expandObject`), the conflict threw, and Foundry dropped the whole file ("Unable
    to parse localization file", on every client). The label is `Settlement.Size.Label` now, and `npm run lint`
    (`tools/check-source.mjs`, `nestingConflicts`) rejects a key that is both a string and the group of another. The
    plans passed meanwhile because they read state, not text; the captures' raw-key check (17.1) would have caught it.
  - *Advance days and Resolve days never opened* (high). `AdvanceDaysApp` assigned `this.state` in its constructor;
    in Foundry 14 `ApplicationV2#state` is the render state, a getter with no setter, so the constructor threw "Cannot set
    property state ... which has only a getter". The wizard keeps its state as `wizard`; the stub `ApplicationV2` in
    `ui-m6.test.mjs` has the getter now, as core does.
  - *Typing a job's task level and clicking "Take this job" lost the click* (medium, the hands-on pass). The field's
    change event as it lost focus rendered the tab, replacing the button between the press and the release; the same for a
    settlement's level and "Save settlement". Both fields now update the form in place (the job's DC and pay, the
    exception's level while none was typed) and render nothing, as the wizard's number of days does.
  - *Plan faults*: the `wizard` step did not await `openAdvance` (async since the M6 review closes the old window first)
    and drove the promise; `m6-communal` crafted one Elixir of Life (Minor), which the first work day (crafter and helper
    together) paid off, so the second day was refused as `paid-off`, as it should be; `m5-buy` counted every Formula
    learned card in the dev world's chat log, which keeps the cards of earlier runs (24), not the one it posted
    (`pageCards` counts from its own start now). Tests: `test/foundry/harness-m6.test.mjs`, `harness-m5.test.mjs`.
- **Hands-on pass as Player One** (a scratch Playwright script with real clicks and typing, GM online; no module calls
  for the steps): request four Elixirs of Life (Lesser) crafted by Player One's alchemist from the request form, fund the
  60 gp up front from the purse ("Fill the shortfall"), Start; on the Downtime tab "Start downtime" and choose the order;
  Advance days 3 (typed): the two setup days written and a stop at the Craft check, "Resolve the rest", Roll in the
  wizard through pf2e's dialog ("Roll (+22)"), the check settled first and the third day worked (10 gp after a critical
  success); Advance days 3 again: three extra days at 10 gp, the Queue at "20 gp left" (120 - 60 up front - 40), no coins
  moved. Then Earn Income: task level 5 typed and "Take this job" clicked at once (the fix above), the job made the
  activity, Advance days 2, its check rolled on the wizard's checks step, the review saying "2 gp paid into ...'s purse"
  for each day: two wage rows (days 16 and 17), applied once, the purse up by 4 gp, the order's days untouched; Advance
  "since last resolved" wrote and paid nothing more. No raw keys in the windows and no console errors on Player One's
  client. A first attempt worked the setup days with the Queue's "Work a day" and found them on the crafter's own days
  ahead of the workshop day (follow-up below).

#### Follow-ups (M6, low)

- From the M6 live pass:
  - An order's "Work a day" writes the crafter's next day after their last record, ahead of the workshop day (as built,
    9.1), but those days are not logged days (`meta.manual`): the header stays on the workshop day while the crafter's
    record runs ahead ("Resolved through day 11" on day 9), and a later "Advance days 3" or a clock move gives that PC
    fewer days, or none until the workshop day passes them. The wizard's Who step says so ("1 day (day 12)"), the
    Downtime tab does not: say "N days ahead" on the PC's row. (`npm run screenshots` moves the clock past them first.)
  - `RequestForm` keeps its state in a `state` class field, which shadows `ApplicationV2#state` (the render state): core's
    check for a second instance of the same id still rendering (`existing.state === RENDERING`) never sees a request
    form. It works; rename it as the wizard's was.
  - The stub `ApplicationV2` of `ui.test.mjs` and `ui-m5.test.mjs` lacks core's getter-only `state`, `rendered` and
    `element`, which is how the wizard's constructor passed every stub test; one faithful stub in `stubs.mjs` would do.
  - No M6 plan reads what a user sees: add an `m6-ui` (raw keys and overflow in the Downtime tab and the wizard, as
    `m4-ui` and `m5-ui` do), so a dropped language file fails a plan and not only the captures.
  - The dev world's chat log keeps every run's cards (only the screenshots delete theirs); a plan that counts messages
    counts from its own start, as `m5-buy` now does.
  - "Set by Player One, 10/26/26, 9:55 PM": the settlement's "set by" line shows the real date and time, so every
    capture of the Downtime tab differs; the game date may read better at the table.

- One activity per PC for the whole span in the wizard and the resolver (9.2 says per day); a change of activity inside
  a span takes two runs. Conflicts are shown as a stop (a helper's lock), not outlined per day.
- Daily preparations (the wizard's step 4, 7.2), cost of living (`rules.costOfLiving`), extension activities (`ext`,
  M10) and the variants' checks (6.16) are not in the resolver yet; the `formula` and `prep-only` activities are not
  offered.
- The day offset is frozen at the first ready of a client that may write; in a brand-new world that can come before pf2e
  sets `worldCreatedOn` (when the GM's World Clock first opens), freezing the core calendar's offset instead.
- `meta.clockHigh` is written by the elected client when it sees a higher clock day; a clock set back before any client
  saw the higher day shows no warning.
- A helper joining while the crafter's resolution of the same day is in flight misses that day's share (the crafter's
  record was planned before the join).
- After leaving, a helper's own unresolved days before `leftDay` cannot be resolved as help (the activity list offers help
  only on orders they still help with); they go to another activity, with no money effect.
- A helper's reroll after extra days were written does not change those days' recorded shares (the crafter's rate no
  longer has this problem: days wait for the settlement, review fix). The fuller fix stores each day's level, rank and
  degree and derives the amounts from the settled check and the helper's entry.
- (Closed by the second review's fixes: undoing a job's roll-again is refused once the new check is rolled, so no wage
  is ever paid at a rate an undo then drops.)
- A long span writes one record per PC per day in one request (a year is 365 records per PC), and the day lock pages
  (`days:<actorId>:<day>`) are never pruned: group long spans, and prune the pages with archived day records (5.3.3).
- The wizard's live updates wait while a field has focus (review fix); the Downtime tab still renders on every store
  change, even while hidden, and closes a select menu someone has open on it while another user writes.
- The settlement exceptions offer pf2e's skills and the Lores on members' roster snapshots only; a GM's DC adjustment per
  settlement (6.10 "plus GM adjustments") and a job's planned length (`lengthDays`) are not offered, and a failed check's
  "may be cut short" is a note only.
- The Earn Income chat card (10.5) is not built: pf2e's check card and the day card stand in. The resolver shows per
  activity sums; the order detail's day-by-day lines (`workDaysView`) are still the detail's only (M4.1 follow-up).
- On two devices of the same owner both prompt for the same pending days (5.6 accepts a duplicate prompt on a second
  device).
- From the second review (low, logged, not fixed):
  - Leaving has no order-state guard in the API (`leaveOrder`): leaving a complete or cancelled order sets `leftDay` and
    forfeits the share after the fact. The UI offers Leave only on open orders. Refuse `state` on a closed order.
  - The world setting `rules.costOfLiving` is shown to the GM with a hint that suggests it works, and nothing reads it.
    Hide it (`config: false`) until cost of living is built, or say in the hint that it is not active yet.
  - A helper waiting for the crafter's acceptance is locked, and their days are recorded as help while adding nothing.
    Stop with "waiting for the crafter" while `accepted` is false.
  - `resolveDays({count})` is not capped at the workshop day: the API's `downtime.resolve` for a PC in downtime can write
    (and pay) days ahead of today without moving the day. Cap `to` at today for a PC in downtime.
  - Days resolved late use the crafter's level and rank on the day they are resolved, not on the day itself (6.2.3 says
    "on that day"); with `recomputeRateOnLevelUp` on, a level-up before resolving raises earlier days' rate. Say "rate at
    today's level" in the review, or keep level history.
  - The badge on a GM's client leaves out player-owned PCs while the GM is their responsible client and gets their
    prompt. Count a PC when this client is responsible for it, as the prompt does.
  - The GM's "Settlements (GM)" disclosure closes on every live render while no draft is open (no `data-sync`).
  - Screen readers: the per-PC "N days to resolve" and "calendar was set back" are `role="status"` regions made again on
    every render; each PC's activity select is labelled only "Spending days on" with no name; the Start/End downtime
    button has `aria-pressed` and a label that changes. Announce once through `announce()`, name the PC in an
    `aria-label`, drop `aria-pressed`. (Fixed in M11 but the single announcement: the regions are plain text now, the select names its PC, the button has no `aria-pressed`; 10.18.)
  - Saving or deleting a settlement profile does not render other clients' open Workshop windows (no `onChange` on the
    `settlements`, `features.downtime` and `features.income` settings).
  - `Job.Conflict` tells the player to "undo the paid days first", which no UI or API can do (wage rows are not
    reversible, and the sweep would mint them again). Reword it.
  - `meta.dayOffset` is frozen by every client that turns ready first, not one elected client (N identical writes). Gate
    it on `isElected()`; the follow-up above on freezing before `worldCreatedOn` still stands.
  - Plain words: `Wizard.WageClaim` says "collected by their player's client"; `Downtime.Rule` tells every player to move
    the calendar, which only a GM can; "Next day: N." shows for characters not in downtime with no explanation.

### 10.13 As built in M7

M7 builds daily preparations: the Morning tab, loadouts, standing orders, the talisman lists and the Dabbler DC stamp, affix
records, party-wide expiry, rest ordering and the pf2e-dailies custom daily (pure parts in `scripts/logic/morning.mjs`,
`expiry.mjs`, `talismans.mjs`; Foundry parts in `scripts/foundry/morning.mjs`, `expiry.mjs`, `rest.mjs`, `dailies.mjs` and
additions to `services.mjs`, `formulas.mjs`, `settings.mjs`, `sync.mjs`, `api.mjs`; the window in `scripts/ui/morning.mjs`,
`templates/workshop/morning.hbs`, the cards in `scripts/ui/chat.mjs` and `templates/chat/morning.hbs`). Unit tests cover the
pure parts (`test/logic/morning.test.mjs`, `expiry.test.mjs`, `talismans.test.mjs`); stub tests the Foundry and window parts
over a fake of pf2e's crafting model (`test/foundry/pf2e-crafting.mjs`: `CraftingAbility` and `performDailyCrafting` as the
pf2e source runs them, including stacking by `system` data only, the unawaited stack update of `craft`, and the refusal of a
pool beyond its slots; `test/foundry/morning.test.mjs`, `ui-m7.test.mjs`). The live plans passed their first run (M7 live pass, below). pf2e
read: the dev head `be4ab21b` (`src/module/actor/character/crafting/`, `rule-element/crafting-ability.ts`,
`special-resource.ts`, `scripts/macros/rest-for-the-night.ts`), pf2e-dailies 4.23.1 from its source map.

- **Sources** (7.1, `morningFacts`): every pf2e `CraftingAbility` of the character with `isDailyPrep` is a pool, with its
  merged slots, item level and batch as pf2e computes them, its prepared formulas (`getPreparedCraftingFormulas`) counted
  by level, and each source's own numbers from its `CraftingAbility` rule element (`sourcesOf`: the item, its resolved
  `maxSlots` and `maxItemLevel`), with the source that wins marked (`mergeSources`, the same rule, by max). Prepared
  abilities that are not daily (snares) are listed read-only. Versatile vials come from the `versatile-vials` resource,
  which counts (pf2e reads it from the first vial item's quantity); the vial items' total is compared with it and a
  difference (a second stack, a vial moved by hand) is pointed out; the vial sources the character holds, and whether they
  regain, come from the registry's `vialSource`. Talisman pools offer their virtual list (`virtualLists` of the registry's
  `virtualFormulaList`) up to the pool's item level and through its predicate, best first. Frequencies of Improvise
  Admixture, Fermenting Liquors, Persistent Mutagen and the Alchemist's Haversack are shown read-only; the gap registry's
  entries (7.10) with their flow.
- **Preparing** (`planMorning`, `applyMorning`, on the owner's client): each pool keeps its preparation (`keep`: pf2e makes
  its prepared list as it is), takes a loadout's families (`loadout`) or explicit entries (`set`); the standing orders due
  are added, and a kept pool with orders or talismans added keeps its current lines pinned to their grades. Each family
  resolves to the highest grade the pool may make (`resolveEntry`: level at most the pool's `maxItemLevel`, which pf2e
  caps at the character's level, the pool's own predicate, and a formula: in the book, covered by its family per 6.4, or
  virtual in a talisman pool; between equal grades the book's first); grades of one family add up, and the batches are
  counted against the slots (`resolvePools`). A plan the pools cannot hold is refused before anything moves (`plan`, with
  the problems), so a refused plan changes nothing, not even the cycle. Then: a grade the book lacks but its family covers
  is appended to the book as the crafting tab does, with provenance `family`; each pool's prepared list is set through
  `CraftingAbility#setFormulaQuantity` (formulas not in the plan set to 0 first); `CharacterCrafting#performDailyCrafting`
  makes everything; virtual talismans are made one batch a call with `CraftingAbility#craft(uuid, {consume: false})`.
  pf2e's `craft` adds to an existing stack without awaiting the update, so the run waits (up to 2 s) until the quantities
  have landed. When pf2e refuses its daily crafting (a pool beyond its own slots or resource: `dailyCraftingComplete` stays
  false), nothing is recorded (`system`) and the player may prepare again in the same cycle. Refusals: `not-ready`, `off`,
  `no-actor`, `not-owner`, `busy`, `prepared` (this cycle's preparations are made), `sheet` (pf2e's own daily crafting ran
  this cycle from the sheet), `plan`, `system`.
- **What a run made** (7.1 steps 1-4): the actor's physical items before and after; new ids and quantity increases are
  the output, matched to their pool and compendium item by pf2e slug (or name) against the pools' unexpended prepared
  formulas read just before (pf2e's own `calculateDailyCrafting` order); talismans made with `craft` carry theirs from the
  call. An output that merged into a stack with another stamp (another creator's delivery, an unstamped stack) is split
  off in one request (the copy created with its own id carrying only this run's flags, the stack set back to its earlier
  quantity); the rest is stamped in place. Outputs with no known origin are left alone.
- **Stamps** (4.12, 7.7): `flags.MOD.expiry = {creator, cycle, rule: "prep", pool}`; Advanced Alchemy's also `at`
  (world time + 86,400 s) and `atDay` (the workshop day + 1). `atDay` is read against the days logged ahead of the clock
  (`today().manualDay`), not the workshop day: a clock crossing midnight is not 24 hours, and `at` covers the clock.
- **The preparation cycle** (7.7): `pcs.<actorId>.prepCycle` goes up (`beginCycle`) behind the lock page
  `cycle:<actorId>:<from>` (hashed), so two devices raise it once, with `cycleKey` (a rest's message id, or
  `again:<nonce>`) so the same rest raises it once, and one expiry claim (`kind: "expiry"`, keyed
  `expiry:<creator UUID>:<cycle>`). Only characters with a daily pool or versatile vials get a cycle: nothing else is ever
  stamped, so a fighter's rest writes nothing. A preparation belongs to the current cycle when a rest began it (state
  `fresh`); "Prepare for a new day" (`again`) begins a cycle itself and un-expends the pools with
  `CraftingAbility#updateFormulas` (a downtime day without a rest, 7.2).
- **Party-wide expiry** (7.7, `expirySweep`): each client marks what expired among the world actors it is responsible for
  (5.6), and the strongbox's items whose creator it is responsible for (the elected client for a creator that is gone);
  the expiry claim's applier, on the creator's responsible client, covers the strongbox and the shelf too and resolves the
  claim. The sweep runs as a step of the catch-up sweep, when the ledger's `pcs`, `claims` or logged days change, when
  world time moves (debounced 1 s), and when a stamped item arrives. Inert (`expiry.action` `inert`): `flags.MOD.inert =
  true`, the localized "(inert)" name, the original name and why in `flags.MOD.inertFrom`; under `delete` the item is
  deleted. One Expiry card per holder per sweep. The `preCreateChatMessage` guard cancels a message whose pf2e origin is an
  inert item, with a notice (OQ-19: pf2e takes a consumable's quantity before it posts the message, so the guard stops the
  effect card, not the count). pf2e's own daily crafting from the sheet is stamped too (`stampSheetCrafting`, on the
  responsible client 1.5 s after `dailyCraftingComplete` turns true): unstamped temporary items whose slug is a daily
  pool's prepared formula, with the current cycle; the state is then `sheet`.
- **Food Preservation** (7.7 exception, `expiryRule {rule: "designate"}`): the alchemical foods the holder's own Advanced
  Alchemy made this cycle can be preserved from the tab, at most as many at a preparation, and preserved at once, as its
  rank allows (1; 2 expert, 3 master, 5 legendary in Crafting or Cooking Lore, `preservationCap`), counting the creator's
  designations wherever the foods have gone (`flags.MOD.morning.preserved`); a preserved food is no longer temporary
  (pf2e's rest deletes temporary items); past the cap the oldest spoils: inert at once wherever it is, and temporary
  again. `exempt = {key, id, n, at}` (as built after the second M7 review).
- **Rest ordering** (7.8, `rest.mjs`): the rest's chat message (`options.restForTheNight`, every client) starts a wait on
  the rested character's responsible client: without pf2e-dailies `SETTLE_MS` (750 ms) after the actor's last update,
  `SETTLE_LIMIT_MS` (5 s) at most; with it, until its `rested` flag turns true, `DAILIES_FALLBACK_MS` (5 s) at most. Then
  the pipeline (`afterRestFor`): a new cycle (none for a character in downtime without a standing routine, 7.2) and one
  Morning prompt (a notification and the tab's badge, `waitingToPrepare`) for a character with daily sources. A GM resting
  the party from the party sheet prompts each character's own player. pf2e-dailies' `rested` turning false applies the
  choice its interface recorded, on the responsible client, one timer per character.
- **pf2e-dailies** (7.9, `dailies.mjs`): registered at `ready` with `game.dailies.api.registerCustomDailies`, key
  `pf2e-artisans-workshop.morning` (pf2e-dailies stores it as `module.<key>`); `condition`: the Morning is on and the
  character has a daily pool or vials; rows: a select per pool (keep, each loadout naming the pool, "prepare in the
  Workshop later") and a notify row with the standing orders due; the select rows leave pf2e-dailies' `save` at its default,
  so pf2e-dailies remembers each row's last selection under its own flags and preselects it (see Follow-ups); a kept
  talisman pool makes the last preparation's virtual talismans again (after the second M7 review). `process` only writes `flags.MOD.morning.choice = {pools, standing, cycle, at,
  applied: null}`; nothing is made inside pf2e-dailies' flow. A pool left for later applies nothing (the prompt stands).
- **Talismans** (7.4): the DC stamp (`dcStamp {pool: "talisman-dabbler", dcs: ["class", "spell"]}`) raises inline
  saving throw `@Check[...|dc:N]` DCs (fortitude, reflex, will; a flat or skill check keeps its DC) below the higher of the creator's class DC (`actor.classDC`) and spell DCs to it, and records
  `flags.MOD.dcStamp = {dc, printed, pool, by}`; resolved DCs and higher printed ones are left alone; Talisman Esoterica gets
  no stamp. The affix board (`affixBoardOf`, macro 18): armor, shields and weapons (bombs out while
  `talismanHostsExcludeBombs`) with what is affixed, `active`, `suppressed` (more than one; more than two on the treated
  item) or `empty`, a warning for a host neither worn nor wielded, the loose talismans with "Affix" to a chosen host, and
  the minutes affixing them takes (`affixMinutes`: 10 each; 1 with Rapid Affixture; four per 10 minutes for a Dabbler;
  four per minute with Quick Fix). Affixing from the tab and the M5 service share `affixTalisman` (a repair toolkit, the
  M5 rule). Talismanic Sage: a sage putting a second talisman on an untreated host treats it (`flags.MOD.sage = {by,
  token}` on the host, `flags.MOD.sageToken` on the sage); treating a new item gives the sage a new token, which ends the
  old item's treatment wherever it is (`sageTreated`). PF2e Talisman Manager active: the module records no affixes.
- **Loadouts** (4.11, 7.5): `flags.MOD.loadouts.<id> = {id, v, name, pools: {<slug>: [{family, qty, uuid?, name?}]},
  talismans: {<slug>: [uuid]}, talismanHosts, vialMaterials}` (`talismans` added to 4.11's shape for the talisman pools),
  written whole (`_replace`), deleted with `_del`. "Save current as a loadout" captures each pool's prepared formulas by
  family and the talismans of the last preparation; a loadout's `vialMaterials` (else the vial item's own buckets) are
  normalized to the resource at each preparation (`syncVials`, 7.3).
- **Standing orders** (4.11, 7.6): `standing.<id> = {id, v, requester, crafter, recipient, pool, family, uuid, name, qty,
  fromDay, untilDay, active, last, by, at}`, placed by the requester's owner (the tab asks for an item a member's daily pool
  prepares now; the API takes any), ended by the requester's or crafter's owners or a GM. A preparation fills the ones due
  (`standingDue`), each once a cycle (`last.cycle`), at the best grade the pool allows; one that would take the pool past its
  slots is left out for the day (`standing-slots`), so it never blocks the crafter's own preparation. Its items go behind
  the lock page `standing:<id>:<crafter id>:<cycle>` in one request with `last`: created on the recipient when this user
  owns it, else on the pickup shelf in the strongbox for the recipient's client to collect
  (5.5); only this run's output is handed out, never what a stack held before; the stamp travels with them; a crafter
  who is its own recipient keeps them. The shelf item's own `claimKey` is `deliver:standing:<id>:<crafter id>:<cycle>`
  (after the second M7 review), never the lock's key.
- **The Morning tab** (10.1): the character (own; every member for a GM), the cycle's state (icon and word: ready to
  prepare, prepared, prepared from the sheet), "Make daily preparations", "Prepare for a new day" (confirmed), "Prepare on
  downtime days" for a character in downtime (`standingRoutine`, 7.2); the standing orders due as chips the crafter may
  leave out; each pool with its slots, item level, batch, sources, prepared items by level, its plan (keep or a loadout),
  a talisman pool's picker and DC, and what the plan will make with each line's route; the plan's problems and the diff
  against the last preparation; vials, other prepared slots, daily uses, other daily features ("done today", handled by
  PF2e Dailies, or not automated), Food Preservation, loadouts, standing orders, the affix board, what will expire and
  what is inert. Built only while shown (it reads the catalogue). The tab button's badge counts the user's characters a
  rest has left waiting (singular key for one). Controls are found again after a render by `pool`, `standing`,
  `loadout`, `talisman`, `gap` and `morning` (`focus.mjs`).
- **Cards** (10.5): the Morning summary (what was made, by item; the DC stamp; deliveries; when it all expires), from the
  client that prepared; the Expiry card (the items a holder lost, with whose and why), from the client that marked them.
  Both whispered to the actor's owners and GMs (or public by `chat.visibility`).
- **Settings** (14.1, 14.2): `features.morning` (W, on), `features.expiry` (W, on), `expiry.action` (W, `inert` or
  `delete`).
- **API** (11.2): `prep.{open, sources, plan, apply, loadouts, saveLoadout, captureLoadout, deleteLoadout, applyLoadout,
  standing: {list, place, end}, affixBoard, affix, unaffix, preserve}` and `expiry.{sweep, beginCycle}`. Hooks (12.3):
  `preparationCompleted` `{actor, cycle, created}` on the client that prepared; `morningSummary`, `itemsExpired` and
  `morningPrompt` are internal (cards and the window), not public API.
- **Registry** (6.11): effect kinds `dcStamp`, `dailyGap {flow: note | designate | dailies}`, `vialSource {regain}`,
  `expiryRule {rule: "designate", when}`, and (after the second M7 review) `correction {pool, slots | craftable | gate,
  bug}` on Herbalist Dedication, Lethargy Poisoner and the alchemist archetype's Advanced Alchemy; `dailyGap` on Alter Admixture, Natural Mutagen, Herbal Forager, Chrysanthemum
  Leshy, Imperial Dragon Potion, Practical Magic, Contingency Gadgets, Witch's Bottle, Poisoned Sticks and Stones, Prepare
  Elemental Medicine and Repurposed Parts (`note`), Food Preservation (`designate`), Ceremonial Knife, Root Magic, Scroll
  Adept, Scroll Esoterica and Elaborate Scroll Esoterica (`dailies`); `vialSource` on the class's Versatile Vials and
  Firework Technician (regain), the alchemist archetype, Wandering Chef and Munitions Machinist (no regain); new entries
  `talismanic-sage` and `munitions-machinist` (off the ignore list): 249 entries, 1202 ignored, validated against the pf2e
  checkout (`PF2E_SRC=<checkout> npm test`, `validate:registry`).
- **Live plans** (15.3; `tools/harness/morning-scenarios.mjs`, scenario `m7`; `live-plans.mjs`), run in the M7 live pass:
  - `m7-morning` (GM, P1): the bomber's pools from pf2e (Advanced Alchemy with its sources, Talisman Dabbler offering common
    talismans up to level 5), vials; a loadout of Elixir of Life by family prepares Elixir of Life (Moderate) ×2 at level
    11, infused, stamped with the cycle and 24 hours, written into the book by family; two virtual talismans, none in the
    book, with the DC stamp only where an inline save exists; a second preparation refused; the GM reads the same.
  - `m7-expiry` (GM, P1, P2): one infused elixir handed to Player Two; Player One rests (pf2e's own Rest for the Night):
    the cycle goes up once, keyed by the rest message; Player Two's client marks the elixir inert; the expiry claim is
    resolved; Player One prepares again, and 24 hours on the clock later those items are inert by time.
  - `m7-rest` (GM, P1, P2; pf2e-dailies off, the pages reloaded): the GM rests both characters: one Morning prompt, on
    Player One's client; the alchemist's cycle up once, the fighter's none; with Player One away the GM's client is prompted.
  - `m7-dailies` (GM, P1; pf2e-dailies and lib-wrapper on in `core.moduleConfiguration`, every page reloaded, put back
    after): Player One rests: the pipeline waits for `rested`, the cycle goes up once, one prompt; Player One's pf2e-dailies
    window shows the Workshop's rows, the loadout is chosen and accepted: the choice recorded, applied after `rested`
    turns false, Elixir of Life (Moderate) made and stamped.
  - `m7-standing` (P1, P2, no GM): Player Two's standing order for two elixirs; Player One prepares: two on the shelf for
    Player Two, collected by Player Two's client with Player One's stamp; a new day fills it again, and the first two are
    inert.
  - `m7-affix` (GM, P1): leather armor and a repair toolkit; two armor talismans made at preparation; the first affixes,
    the second is refused; with Talismanic Sage given, the second affixes and treats the armor; a third is refused; the
    board says the two work.
  - `m7-shots` (GM, P1, P2): the Morning tab as Player One and the GM, 1440x900 and 1024x768, dark and light, after a
    standing order and with two talismans picked (`--shots`).
- **After the M7 review** (one pass; medium findings fixed, each with a test that fails without it):
  - Talismanic Sage was never recognised by the M5 affix rule: its feat was on the registry's ignore list, so
    `heldKeysOf` never held it and a sage could not put a second talisman on an item. It is a registry entry now, and the
    rule allows two on the treated item only.
  - A standing order that did not fit its pool refused the crafter's whole preparation (`plan`); it is left out for the
    day instead.
  - An output split off another creator's stack copied that stack's module flags (a delivery row, an inert mark) onto the
    new item; the copy carries only this run's.
  - pf2e refusing its daily crafting (a pool beyond its slots) was recorded as a preparation that made nothing, which then
    refused the next try as `prepared`; it is refused as `system` and nothing is recorded.
  - Two characters' pf2e-dailies choices landing within the settle shared one timer, and the first was never applied; one
    timer per character.
  - The tab's "Affix" read the host from the button itself (which carries the talisman's id), so it never found the
    host's select; it reads the talisman's row.
    - Every Rest for the Night raised a cycle and wrote an expiry claim for every character, fighters included; only
    characters with daily sources get one.
- **After the second M7 review** (one pass; high and medium findings fixed, each with a stub or unit test that fails
  without it):
  - Standing-order items on the pickup shelf could never be collected: the shelf item's `claimKey` was the lock page's
    own key, and `claims.deliver` locks the hash of its key as the delivered row, so every collection was refused
    `locked`. The shelf item now carries its own key, `deliver:standing:<id>:<crafter id>:<cycle>`.
  - Switching loadouts in a full pool dropped entries silently: quantities were set in line order, and pf2e refuses a new
    formula once the slots are spent (and clamps an increase to the slots left). The plan's dropped formulas are
    unprepared first, then every decrease, then the increases and new formulas; a line already at its batches is left
    alone (pf2e refuses even a same-batch increase in a full pool). pf2e's prepared list is then compared with the plan
    (`preparedDifferences`, in whole batches): any difference is refused as `system` with `data.differences` before
    `performDailyCrafting` runs. The stub of pf2e's `setFormulaQuantity` now clamps and checks `canCraft` as pf2e does.
  - Food Preservation did nothing in practice: pf2e's Rest for the Night deletes every `system.temporary` item, preserved
    foods included, and foods given away never counted toward the cap. Preserving writes `system.temporary: false` and an
    `exempt` with a designation id; the designations are kept on the creator (`flags.MOD.morning.preserved = [{id, n,
    cycle, at}]`); a food whose designation the creator no longer holds has `spoiled` (`expiryReason`), so every holder's
    sweep marks it inert at once and makes it temporary again; a change to the creator's designations runs the sweep on
    every client. Designation is limited to the current cycle's own Advanced Alchemy output, and the cap applies per
    preparation as well as at once (which also answers the low finding that designation was looser than the feat).
  - Two clients could prepare one character at once (the GM's tab and the player's, or two devices) and make everything
    twice: the per-client `applying` set was the only guard. A cycle's preparation now runs behind the lock page
    `prep:<actorId>:<cycle>:<attempt>`; a client refused there gets `busy`. A `system` refusal, or a throw before pf2e's
    daily crafting was asked, moves on to the next attempt (`flags.MOD.morning.attempt = {cycle, n}`), so the player can
    try again; once pf2e was asked, the lock stands ("Prepare for a new day" begins a new cycle).
  - The Talisman Dabbler DC stamp raised every inline check's DC, flat checks included (Mummified Bat's flat DC 5 became
    DC 41 for a 20th-level Dabbler). Only `fortitude`, `reflex` and `will` checks (by the first parameter or `type:`)
    are stamped.
  - pf2e's data for three daily sources disagrees with the feats' text, and these notes claimed the 7.1 corrections were
    built when none were: the registry now carries `correction {pool, slots | craftable | gate, bug}` effects (6.11),
    applied per source in `morningFacts` (`correctPool`). Herbalist Dedication gives two fewer unless the preparations
    are made in the wilderness (the Morning tab asks; the answer is remembered for pf2e-dailies' choice). Lethargy
    Poisoner gives one dose, two at master and three at legendary in Crafting (pf2e: three from master), and Stupor
    Poison from expert (pf2e's Stupor rule carries a master-rank predicate that `CraftingAbility` never tests, so pf2e
    offers it at any rank; the review had read it as never allowed). The alchemist archetype's Advanced Alchemy makes
    alchemical consumables only (pf2e: any alchemical item). A pool's count is lowered by as much as the correction
    lowers the merge, so a count pf2e adds on top of its sources stays; the tab shows pf2e's count beside the rules'; a
    kept pool beyond the corrected count is refused as `plan` (pf2e would make it all). `bug` is the pf2e rule each
    correction answers: the validation script reports a correction once pf2e's rule no longer reads that way, and a
    `PF2E_SRC` test checks the three rules as they read now.
  - Two of one virtual talisman (two Potency Crystals) could not be prepared from the tab or a loadout: the picker was a
    checkbox set and loadouts and captures de-duplicated. The picker has a count per talisman, loadouts keep one UUID per
    talisman, and a preparation records the virtual talismans it made (`flags.MOD.morning.talismans = [{pool, uuid,
    qty}]`), which a captured loadout reads.
  - With pf2e-dailies, a talisman pool's "keep" made nothing (virtual talismans are never in pf2e's prepared list) and
    still recorded the cycle as prepared, locking the Workshop out. Keep on a talisman pool makes the last preparation's
    virtual talismans again (its row says so); "prepare everything in the Workshop later" says that it makes nothing now.
  - One client could run overlapping expiry passes (the timer, the catch-up sweep and the expiry claim, all started by
    one cycle raise), each seeing an item as live until the server answered: duplicate Expiry cards, and under
    `delete` a second delete of an item already gone. `expirySweep` is single-flight (a sweep asked for meanwhile runs
    once more after it), and the expiry claim's applier runs that sweep instead of marking on its own.

#### M7 live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, pf2e-dailies 4.23.1, no canvas)

One pass at `1130d98` (M0-M7), then once more after the fix below:

- **M7 plans** (`--runs 1`): all seven pass at the first run with pf2e-dailies active in the world (`m7-rest` turns it off
  for its own run and back, `m7-dailies` needs it on); `m7-morning`, `m7-expiry`, `m7-standing` and `m7-affix` pass again
  with pf2e-dailies off for the world. No console errors or warnings on any client, no slow server answers. After the fix,
  all seven, `m4-ui` and `m6-wizard-players` pass once more.
- **Regression** (`--runs 1`, pf2e-dailies on): scenarios 1 and 7, `m6-wizard-players`, `m6-income`, `m4-lifecycle` and
  `m5-fund` pass. Console errors: scenario 7's expected ones (15.3), and on `m6-income`'s second device core's "already
  exists" for the lock page the first device took (the lock-first race the plan provokes, 5.4).
- **Found and fixed** (with a test that fails without it):
  - *Typing a talisman count and clicking "Make daily preparations" at once lost the click* (medium, the hands-on pass,
    with a click held 120 ms as a hand does). The count's change event fires as the field loses focus, which is on the
    button's press; it rendered the Morning tab and replaced the button before the release. M6 fixed its two fields by
    rendering nothing, which the Morning cannot do (the plan's lines follow the counts). The window now holds a render
    asked for while a pointer is pressed in it (`renderParts`: a capture-phase `pointerdown`, released on the document's
    `pointerup` or `pointercancel`, `PRESS_HOLD_MS` 1.5 s at most) and renders after the release's click; every render a
    field's change asks for, and the live refreshes, go through it (`ui-m7.test.mjs`).
- **Hands-on pass** (a scratch Playwright script, real clicks and typing, the GM, Player One and Player Two online; setup
  through the harness: the bomber's pools and book put back, a "Healer" loadout of Elixir of Life by family through the
  API, as there is no loadout editor, a wielded longsword and a repair toolkit from the GM). With pf2e-dailies off: Player
  One opens the Workshop from the Actors directory, the Morning tab, picks "Healer" in Advanced Alchemy's select, types 1
  for Eye of Enlightenment (Tab) and 1 for Copper Penny and clicks "Make daily preparations" at once: Elixir of Life
  (Moderate) ×2 and both talismans made, stamped cycle 0, the Morning card posted (after the fix; before it the click was
  lost). On the affix board, "Longsword" chosen for Eye of Enlightenment and "Affix": the board says the longsword's
  talisman works. The GM hands one elixir to Player Two's fighter and one to the party stash, then rests the party from
  the party sheet (Exploration, the bed button, pf2e's "Rest for the night?" Yes): pf2e deletes the rested characters'
  temporary items (the alchemist's own and the fighter's elixir, the affixed talisman), the stash's elixir becomes
  "Elixir of Life (Moderate) (inert)", the alchemist's cycle goes to 1, one Morning prompt on Player One's client and the
  tab's badge reads 1; preparing again from the tab makes new items stamped cycle 1. With pf2e-dailies on (every page
  reloaded) the same party rest: its `rested` flag set, the cycle at 2, the cycle-1 elixir in the stash inert, one prompt;
  Player One opens the character sheet from the directory, clicks pf2e-dailies' icon, picks "Healer" in the Workshop's
  Advanced Alchemy row (the talisman row on "keep"), Accept: "Morning applied", Elixir of Life (Moderate) ×2 and the two
  talismans again, stamped cycle 2. No raw keys in the Workshop, pf2e-dailies' window or the cards posted, and no console
  errors on any client. The dev world's chat log keeps cards and roll flavours posted while the language file failed
  (before the M6 live pass fix) with raw keys: their text is stored when posted, so they stay so.

#### Follow-ups (M7, low)

- No loadout editor in the window: loadouts are saved from the current preparation (with the last talisman picks) or
  through `api.prep.saveLoadout`; families and quantities are edited only there.
- The gap entries record a tick per cycle (`note`); the item-making flows of 7.10 (Alter Admixture's swap keeping expiry,
  Natural Mutagen, Herbal Forager, Chrysanthemum Leshy's tea, Imperial Dragon Potion, Contingency Gadgets, Witch's
  Bottle, Poisoned Sticks and Stones, Prepare Elemental Medicine, Repurposed Parts) are not built, and Magical Scrounger
  and Library Robes have no registry entries yet.
- The Dabbler DC stamp rewrites inline `@Check` DCs only. At pf2e 8.6.1 none of the 41 common talismans of level 5 or
  lower has an inline save, and Peacemaker (level 6) prints "DC 20" as plain text, which is not rewritten: the stamp starts
  to matter with the higher talismans a 12th-level or higher Dabbler makes. Show the creator's DC on the card for any
  talisman with a save.
- The plan counts batches by the pool's craftable definitions; pf2e's field-discovery and signature-item batch sizes
  (`#batchSizeFor`) are not read, so the plan can count a field-discovery item's batches differently from pf2e (pf2e's own
  count applies when it prepares).
- An output is matched to its pool by pf2e slug or name: the same item prepared in two pools is stamped as the first
  pool's, so an Advanced Alchemy item could miss its 24 hours or another pool's item gain them.
- The expiry sweep reads world actors: an unlinked token's items are not swept.
- A rest waits on the client responsible when its message arrives; if that client leaves before the settle ends, that
  rest raises no cycle (the next rest or "Prepare for a new day" does).
- Lock pages `cycle:<actorId>:<n>`, `prep:<actorId>:<cycle>:<attempt>` and `standing:<id>:<crafter>:<cycle>` and resolved
  expiry claims accumulate; archive them with old rows (5.3.3).
- The Morning prompt is a notification and a badge, with no card; the wizard's daily-preparation step (9.2 step 4) is
  still not built: a downtime day's preparation is made from the tab ("Prepare for a new day").
- A second stack of vial items is pointed out, not merged (the resource reads the first stack only).
- Frequencies are shown read-only (their buttons are M8's, with vials).
- The pf2e-dailies daily is offered to a character with vials and no pool, with no rows to choose.
- Asking for a standing order from the tab offers only items a member's pool prepares now; the API takes any item.
- The Morning tab renders on every store change while it is shown, as the Downtime tab does.
- `stampSheetCrafting` could stamp an unstamped temporary item another character handed over when it shares a slug with
  one of the holder's daily formulas.
- From the second M7 review (low, not fixed in that pass):
  - Talisman host exceptions of 7.4 are not built: bands of force and assassin's bracers (pf2e type `equipment`) count as
    light armor, but `hostsOf` keeps only armor, shields and weapons and M5's `affixProblem` refuses `equipment` as
    `not-host`. Add a registry or host exception (`hostAs: "armor"`) read by both.
  - The Dabbler DC reads only the primary class DC (`actor.classDC`); RAW takes the highest class DC, and pf2e's
    `getStatistic("class-spell")` already gives the highest of all `classDCs` and spell DCs.
  - The investigator's Alchemical Sciences Methodology grants versatile vials (a `versatile-vials` SpecialResource) but has
    no `vialSource` (PC2 p.173: no regain unless stated), so the tab lists no vial source for an investigator.
  - "Prepare for a new day" begins a cycle but does not renew versatile vials: pf2e refills the resource only in Rest for
    the Night. Set the resource to its max with `actor.updateResource` there, with the wizard's daily-preparation step.
  - The affix board turns a suppressed host back to active once the count drops to its limit; GM Core says the talismans
    must be removed and re-affixed first. Record the suppression on the talismans and clear it only on a re-affix.
  - Lethargy Poisoner's "only you can use these poisons" is not enforced: standing orders and deliveries from the
    `lethargy-poisoner` pool to another actor are accepted (a registry `selfOnly` flag would refuse them).
  - Advanced Alchemy's `at` deadline is measured on the world clock even when the workshop day is ahead of it: advancing
    the clock to catch up with logged days ends items made "today". Stamp only `atDay` while `today().ahead > 0`.
  - A pf2e-dailies choice that fails to apply (a plan problem, a pf2e refusal, a stale choice) fails silently:
    `applyChoiceSoon` notifies on success only. Warn on the responsible client with the plan's problems.
  - First-time prompts disagree: with pf2e-dailies active the rest prompt still says to use the Morning tab (whose hint
    says to use pf2e-dailies' window, and whose button stays enabled); a downtime rest without a standing routine shows
    the same prompt, while the tab offers only "Prepare for a new day". Word both prompts for their case.
  - pf2e's own trade and drag-and-drop merge a stamped item into an identical stack (`isStackableWith` compares `system`
    only), so an elixir from one creator handed to a holder of another creator's stack follows the other stamp. Wrap the
    stack test so differently stamped stacks never merge (this would also cover `performDailyCrafting` and `craft`).
  - On the "again" path pf2e's refusal goes unnoticed when `dailyCraftingComplete` was already true from the previous
    preparation (pf2e returns before touching it); kept pools are slot-checked only where a registry correction lowers
    their count. Compare the expended state before and after, and slot-check every kept pool.
  - A preparation made within the settle window just after a rest (before the pipeline raises the cycle) is stamped with
    the old cycle and goes inert when the pipeline runs. Refuse or defer `applyMorning` and `applyChoice` while a rest is
    pending for the actor on this client.
  - The pf2e-dailies select rows leave its `save` at the default, so pf2e-dailies remembers each pool's last selection
    (under its own flags) and preselects it, which can be a deleted loadout's id (applied as `no-loadout`). Set
    `save: false`, or drop deleted loadouts from the remembered value.
- New with the second M7 review's fixes:
  - pf2e-dailies' window does not ask whether the preparations are made in the wilderness: a Herbalist's choice applies
    with the Workshop's last answer (`flags.MOD.morning.wilderness`).
  - A preserved food whose creator can no longer be read (an actor deleted) stays preserved; Eternal Elixir and the other
    `expiryRule` exceptions of 7.7 are still to come.
- From the M7 live pass:
  - The affix board offers every host to each loose talisman: Copper Penny (affixed to an unarmored defense item) was
    offered the longsword, and "Affix" then refuses it (`wrong-host`). Offer only the hosts `affixHostKinds` allows.
  - "Affixing the loose talismans takes about 1 minutes" (`Morning.Affix.Minutes` has no singular). (Fixed in M11, 10.18.)
  - pf2e-dailies' window cuts the talisman pool's "Keep the current preparation and the last talismans made" to "... and
    the la" in its narrow select; shorten `Dailies.KeepTalismans`.
  - A standing order's chip names the grade asked for ("1 Elixir of Life (Minor) for Doran Vell") while the pool makes
    the best grade it allows (the plan's line says Moderate), and names the requester twice when they are the recipient
    ("(asked by Doran Vell)"). Word it by family, and leave out the requester when it is the recipient.
  - The Dabbler's picker lists every talisman the pool can make (41 for the 11th-level fixture) in one long column, and
    the Advanced Alchemy card beside it stretches to its height with empty space (`morning.png`). A filter, or the picked
    ones first with the rest collapsed.
  - A tab button's tooltip repeats its visible word in the wide tier (it is for the narrow tier, where the word is
    hidden); after a click, "Morning" covers the Formulas button below it until the pointer moves. (Fixed in M11, 10.18.)
  - A party rest from the party sheet deletes the temporary items of every rested holder (pf2e), so an infused item handed
    to a member who rests too is gone rather than inert; only holders that do not rest (the party stash, an NPC) show the
    module's inert mark. As the rules want; noted because the Expiry card then has nothing to say for those holders.

### 10.14 As built in M8

M8 builds combat (section 8.1-8.9): the Bandolier, the token HUD palette, the Quick Alchemy panel, quick vials, Quick
Bomber, Healing Bomb and additives, vial gathering, turn expiry, the Duct Tape step-aside and "Use best consumable" (pure
parts in `scripts/logic/alchemy.mjs`, `vials.mjs`, `consumables.mjs` and the turn rules of `expiry.mjs`; Foundry parts in
`scripts/foundry/combat.mjs`, `alchemy.mjs`, `vials.mjs`, `consumables.mjs`, `item-facts.mjs` and additions to `expiry.mjs`,
`roster.mjs`, `morning.mjs`, `settings.mjs`, `api.mjs`; the windows in `scripts/ui/bandolier.mjs`, `alchemy-panel.mjs`, the
palette in `hud.mjs`, the cards in `combat-cards.mjs`, the keybindings and the settings note in `combat-entry.mjs`, templates
in `templates/combat/` and `templates/chat/alchemy.hbs`). Unit tests cover the pure parts (`test/logic/alchemy.test.mjs`,
`vials-consumables.test.mjs`); stub tests the Foundry and window parts over a fake pf2e alchemist (`test/foundry/alchemist.mjs`:
versatile vials as pf2e's `SpecialResource` with an `itemUUID` keeps them, read from the first item whose `sourceId` is the
Versatile Vial and clamped on write; the `quick-alchemy` `CraftingAbility` with its resource, which makes nothing at 0 when
it consumes, and pf2e's rule that a held item stacks only with a held stack of quantity 0; a Strike per weapon with pf2e's
three multiple attack penalty variants; `toggleRollOption`; `createItem` fired by the creating client;
`test/foundry/combat.test.mjs`, `ui-m8.test.mjs` with an ApplicationV2 fake whose read-only properties are getters,
`harness-m8.test.mjs`). The live plans had their first run in the M8 live pass (below). pf2e read: the dev head `be4ab21b`
(`actor/character/crafting/ability.ts`, `chat-message/helpers.ts` `createUseActionMessage`, `rule-element/special-resource.ts`,
the character's Strike variants, `item/physical/document.ts` `isStackableWith`, `item/consumable/document.ts` `consume`,
`actor/base.ts` `applyDamage` and `toggleRollOption`, `scripts/hooks/render-token-hud.ts`); Foundry 14.368
(`applications/hud/placeable-hud.mjs` `togglePalette` and `_postRender`, `templates/hud/token-hud.hbs`, `documents/combat.mjs`
`combatTurnChange` and `_getCurrentState`, `documents/combatant.mjs`'s actor of a token-less combatant).

- **The switch** (8, 13): `combatOffReason()` is `disabled` (master switch), `off` (`features.combat`) or `duct-tape`; every
  combat action refuses with `combat-off` or `duct-tape`, the Bandolier and the panel say why, turn expiry, vial gathering
  and the effect cap stop. With Duct Tape active, the settings window adds a note under `features.combat`
  (`renderSettingsConfig`). "Use best consumable" has its own toggle (`features.consumables`) and stays.
- **What Quick Alchemy makes** (8.3, `quickChoices`): every catalogue item pf2e's `quick-alchemy` ability's predicates accept
  (alchemical consumables), at most its `maxItemLevel` (the character's level), with a formula in the book or covering it by
  family (6.4, the same setting as every route), sorted by name, each with its route.
- **Making it** (8.3): `CraftingAbility#craft(uuid, {consume: true, destination: "hand"})`, which takes one vial through the
  resource. pf2e's own chat path (`createUseActionMessage`) crafts with `consume: !!resource.value`, so for free at 0 vials; the
  module refuses first (`brewPlan`: `no-vials`, `vials` with how many it takes and has, `double-brew`, `nothing-picked`,
  `cannot-make`, the additive's `additive-unknown`, `additive-fit`, `additive-round`, `combine-pick`, `combine-fit`). pf2e is
  handed the compendium item already carrying `flags.MOD.expiry` (below) and `flags.MOD.quick = {source: "quick-alchemy",
  additive, combine, at, by}` (a `clone`, whose `toObject` `craft` makes the item from), so the item is created stamped
  (second M8 review), and the stamp's tag in pf2e's `system.traits.otherTags` (`quickTag`: one per stamp), so pf2e's stack
  test, which compares `system` data only, never merges it with another stamp's stack, at the craft or in an ally's
  inventory after a trade; an item that still merged (a held stack of quantity 0 of the same stamp) is split off into its
  own in one request. The additive spends the character's additive of the round (`flags.MOD.combat.additive = {combat,
  round, at}`, counted in an encounter only); the additive's extra vial (Combine Elixirs, Balm Bomb) is taken after the
  craft, the resource read again. An additive's second item (`additive {combine: {when, level?, merge?}}`, `combineFits`):
  Combine Elixirs' elixir no higher than the first goes into it (`merge`: `combinedDamage` sums the healing in
  `system.damage`, and the second's description follows the first's); Balm Bomb's common healing elixir is kept in
  `quick.combine` and named with the bomb. Double Brew (`brew {count: 2}`) makes two, one vial each, the same item twice
  included.
- **pf2e's own Quick Alchemy action** (After the M8 review): what its chat path makes (a new, unstamped, temporary, infused,
  held item its Quick Alchemy can make) is stamped on the creating client like the panel's, `quick.source` "system"; the
  panel's own items are skipped while it makes them.
- **Quick vials** (8.5): a copy of the vial item with `_stats.compendiumSource` and `duplicateSource` cleared (pf2e's
  `sourceId` is `duplicateSource ?? compendiumSource`, and the vial count is read from the first item whose source is the
  Versatile Vial), one, temporary, infused, held; free; `quick = {source: "quick-vial", damageType, material, quickened}`.
  Abundant Vials (`quickVial {quickened}`): one a turn in an encounter (`flags.MOD.combat.quickened = {combat, round, turn}`).
- **Strikes** (8.1, 8.4, OQ-27): `strikeWith` finds pf2e's Strike of the item (`actor.system.actions`) and rolls its variant
  `map` (0, 1 or 2), so the multiple attack penalty, modifiers and cards are pf2e's. First it sets the system toggles the
  module has a value of its own for (second M8 review): the bomber's `bomber-field-vials` (domain `all`, the damage type as
  its suboption) for a versatile vial with a type chosen (the Bandolier's, the quick vial's own), Advanced Vials'
  `bomber-advanced-vials` with a material chosen or taken from a recorded bucket (`takeFromBucket`, 7.3), and the toggle of
  the additive the item carries. A toggle the module has no value for is the player's, left as pf2e's sheet set it. One the
  module changes is recorded as the player had it (`flags.MOD.combat.toggled.<domain|option> = {domain, option, on, sub}`)
  and put back at the next Strike through the module with no value for it; not at once, since pf2e reads the toggles again
  for the damage roll from the card. While the combat features are off (Duct Tape) nothing is set: "Use best consumable" and
  `api.alchemy.strike` are a plain pf2e Strike.
- **Quick Bomber** (8.4, `quickBomber`): with the feat, the best ready bomb of the family (held, then worn, then stowed; the
  soonest-expiring infused first, `chooseBest`), else the best grade it can make, made and thrown; one bomb. A family given by
  UUID is read from the catalogue's facts (After the M8 review).
- **Healing Bomb** (8.6): the additive's `when` is the elixir of life grades by slug. `healingBomb` makes the best grade with
  it; `throwHealingBomb` takes the target (a token, actor or UUID, else the user's one target, else one the user picks from
  the party and the encounter, `throwCandidates`: the Bandolier's and the card's Throw work without a canvas), refuses beyond
  20 feet when both tokens are on the canvas, uses the elixir through pf2e (`item.consume()`, whose healing card the target's
  owner applies), and posts the module's card: the living creatures adjacent to the target on the canvas (within the grid
  distance, pf2e's `modeOfBeing`), or, without the target's token on a canvas, the party's living members other than the
  target (`known: false`), each regaining the elixir's number of damage dice (`damageDiceCount` of its
  `system.damage.formula`), with an Apply button. `applyHealingBomb`: the creature's owner or a GM, through pf2e's
  `applyDamage` with negative damage and a token found without the canvas (the card's, the viewed scene's, a linked one on
  any scene, else the prototype token; pf2e requires one), once per card and creature (`flags.MOD.healed.<messageId>` on the
  healed actor, written first and taken back if pf2e fails: `apply-failed`).
- **Turn expiry** (8.8): a stamp `{creator, cycle, rule: "turn-start" | "turn-end", when: "current" | "next", quick,
  combat: {id, combatant, round, turn, own, ahead} | null, at?}`: `own`, the creator's own turn; `ahead`, not, and the creator
  still to act that round (second M8 review: the deadline is read from these and the creator's turn index now, never from
  the index recorded, which Foundry renumbers when a combatant is added, removed or re-sorted). In an encounter the creator
  is a combatant of, the deadline is a position
  read from the encounter now (`turnDeadline`, `turnExpired`): the start of the creator's next turn (`turn-start`), the end of
  the current turn (quick vials) or of the next (`turn-end` `next`: tools and elixirs with Enduring Alchemy, `expiryRule
  {rule: "enduring"}`); so skipped turns, several at once or a client that missed the change give the same answer. Outside
  one, a round of world time (`at` = now + 6 s). It runs in M7's sweep (`expirySweep`, single-flight), started by core's
  `combatTurnChange` and `deleteCombat` on every client, each holder's responsible client marking what its actors hold (7.7):
  an item handed to an ally ends on the ally's client (DECISIONS 2026-10-26). An ended encounter's items end with it
  (`combat-end`), or with `expiry.quickAlchemyAtCombatEnd` off get one round of world time from then (the stamp rewritten
  once). Turn stamps run with the combat features, the others with `features.expiry`. Quick Alchemy items are left off the
  Expiry card (they run out every turn; the Bandolier shows them).
- **The 10-minute cap** (8.8, OQ-19): `preCreateItem` on the creating client clamps an effect whose pf2e origin
  (`system.context.origin.item`) is a Quick Alchemy item that still exists to 10 minutes (an unlimited one too, an
  encounter-long one not); `expiryRule {rule: "uncapped"}` leaves the creator's own effect alone: Eternal Elixir's elixirs of
  half the creator's level or lower, Persistent Mutagen's mutagens.
- **Splash** (8.8, OQ-29: numbers only): `splashNumbers` from the bomb's own splash (a versatile vial's by its level), the
  bomber's field discovery (`splash {intDamage}`: Intelligence, minimum 1), Expanded Splash (`bonusInt`: Intelligence again,
  10 feet), the greater field discovery (10 feet, 15 with Expanded Splash), Directional Bombs (a 15- or 20-foot cone), the
  bomber's primary-target option; on the Bandolier and the Quick Alchemy card.
- **Vial gathering** (8.7): with `features.vialGathering` on, `updateWorldTime` on each character's responsible client adds 2
  vials per full 10 minutes (3 with Alchemical Expertise, `gather {per10}`) through `actor.updateResource` (which clamps),
  carrying the remainder in `flags.MOD.vialClock` (none for a full character), never in a started encounter or downtime, only
  for a source that regains (`vialSource {regain}`); a user's second device sees the same move of the clock, so the gathering
  of a moment runs behind the lock page `gather:<actorId>:<worldTime>`. The buttons, in the Bandolier: Gather reagents (10
  minutes), Improvise Admixture (pf2e's Crafting check against the level DC, 3/2/1/0 vials, the feat's frequency used), the
  Alchemist's Haversack's vial (once a preparation cycle, worn and invested); they work whenever the combat features do.
  Advanced Vials' buckets follow the new count (`syncVials`, plain vials). Extra Vial (OQ-28) has no button: the checkout read
  lacks the familiar abilities pack.
- **Use best consumable** (8.9): candidates are the character's consumables (and weapons with the consumable trait) of the
  family (`familyOfItem`: the compendium source's name, else its own, the inert suffix aside), `chooseBest` picks; two equally
  good ask which (`askChoice`, quantities shown); a weapon goes through pf2e's Strike, anything else through `item.consume()`.
  `partyWide` with none returns who holds one (`holders`, from the roster's `consumables`, 4.10).
- **The Bandolier** (8.1): `BandolierApp`, one per client: the vial pips and tier, the buckets, Quick Alchemy (the panel), quick
  vial and Abundant Vials' extra one, Healing Bomb, Quick Bomber (the panel's bombs, thrown when made), the field-vial and
  material choices for the next throw, Double Brew, the additive of this round, the ready bombs and elixirs (Quick Alchemy's
  first) with their potency in words, splash and pf2e's own Strike variant labels as buttons, Throw for a Healing Bomb, Use
  for an elixir, and the vial buttons. Docked above the hotbar the first time; dragged, its position is saved per user
  (`bandolier.position`, from `_onPosition`). It opens by itself on an encounter's first `combatTurnChange` (round 0 to 1) for
  the responsible user of an alchemist combatant that user owns (`bandolier.autoOpen`). Controls carry `data-bandolier`.
- **The token HUD palette** (8.2, OQ-33): added in `renderTokenHUD` at once, not after an await: core's `_postRender` runs
  right after the hook and reopens the palette that was open, and does not check that it is there. Only for an owner of an
  actor with Quick Alchemy, only when core's `.col.left` is there (PF2e HUD or Token Action HUD may replace it) and only once
  per render; a Strike entry for each of pf2e's variants of each ready bomb, with pf2e's label (second M8 review); entries
  carry `data-pf2e-artisans-workshop-hud`, never `data-action`, and there is no input for the HUD's
  submit-on-change. When the palette was open and is no longer offered (the combat features turned off), an empty hidden pair
  stands in so core's toggle finds what it looks for.
- **The Quick Alchemy panel** (8.3, 10.9): `QuickAlchemyPanel` with three parts (search, list, plan), so typing renders the
  list and the plan and the search keeps its focus and caret. The list is a listbox of at most 60 matches with a roving tab
  stop; the arrows go from the search into the list and through it, Space picks the focused row (in the search field it types
  a space), Enter creates (the first match when nothing is picked) and closes, Esc closes. With Double Brew a picked row is
  added again while there is room (a count on the row; the plan's chips take one off each). Additives listed are those that
  fit the first pick, the select disabled once the round's is spent; Combine Elixirs and Balm Bomb ask for their second
  item; a bomb picked offers "throw it at the target", and a throw asks which of pf2e's Strike variants. Its state is its
  own fields, never ApplicationV2's read-only `state`.
- **Cards** (10.5, `combat-cards.mjs`): Quick Alchemy (and quick vial): what was made with its potency, the additive and its
  second item, a bomb's splash, a Strike button per variant (Throw for a Healing Bomb); Healing Bomb: the target and an Apply
  button per creature listed; Vials: +n vials and the new count. Posted from the client that did it, whispered to GMs and the
  owners of every actor involved (`whisperFor`: the character; for a Healing Bomb also the target and each creature listed,
  second M8 review), or public by `chat.visibility`; buttons a user may not use are hidden on that user's client.
- **Keybindings** (10.4): `openBandolier` and `quickAlchemy` (the controlled token's actor, else the user's character), unbound.
- **Settings** (14.1-14.3): `features.combat`, `features.consumables`, `features.vialGathering` (off), `expiry.quickAlchemyAtCombatEnd`,
  `bandolier.autoOpen` (U) and `bandolier.position` (U, hidden).
- **API** (11.2) `alchemy.*` and `consumables.*`; internal hooks (12.3) `quickAlchemy`, `healingBomb`, `vialsRegained`,
  `consumableUsed`.
- **Registry** (6.11): the kinds `additive`, `expiryRule {enduring | uncapped}`, `brew`, `splash`, `fieldVial`, `vialMaterial`,
  `gather`, `quickVial`, `quickBomber`; 28 new entries, 277 in all, 1174 ignored.
- **Live plans** (15.3; `tools/harness/combat-scenarios.mjs`, scenario `m8`; `live-plans.mjs`), first run in the M8 live pass:
  - `m8-panel` (GM, P1; no canvas): the bomber's list from pf2e's Quick Alchemy (Elixir of Life to Moderate by family, no
    Greater); Quick Alchemy takes one vial, the bomb held, infused and stamped for a round; at 0 vials refused, nothing made;
    Double Brew two for two; then the panel by keys: typing keeps focus, the arrow enters the list, Space picks, Enter creates
    and closes; the GM reads the same.
  - `m8-bandolier` (GM, P1; no canvas): the pips; a quick vial from its button, free, its source cleared, the count unchanged;
    its Strike is pf2e's (an attack card from the quick vial, the field-vial toggle on); dragged, it reopens where it was.
  - `m8-turn` (GM, P1, P2; token-less encounter): the fighter then the bomber; a bomb, an Enduring elixir and a quick vial made
    on the bomber's turn, a second bomb handed to the fighter; the quick vial ends with that turn (Player One's client), the
    bombs at the bomber's next turn (each on its holder's client), the elixir after it; a bomb of the third round ends with the
    encounter.
  - `m8-vials` (GM, P1, P2): gathering on; 25 minutes give 6 (Alchemical Expertise) and carry 5; Player One and the GM click
    Gather at once one short of the maximum: the maximum; nothing in an encounter; Improvise Admixture by its degree.
  - `m8-healing-bomb` (GM, P1, P2): the feat given; the best elixir of life with the additive, used through pf2e, the card's
    5 HP; the card reaches Player Two (the target's owner); Player Two applies it once; outside an encounter a second
    additive is allowed, in one a second the same round is refused.
  - `m8-duct-tape` (GM, P1, P2): Duct Tape on every client (a stand-in when not installed): Quick Alchemy and the Bandolier
    refuse and say why, no turn expiry, Use best consumable works.
  - `m8-use-best` (P1, P2, no GM): the held potion, then the stowed one, then the party view names who holds one.
  - `m8-hud` (GM, P1; `--canvas`; it stages a marked scene with Player One's token, `arena`): the flask in the left column, its palette opened by core's
    togglePalette, the token moved with it open (one button, still open, no error), its Quick Alchemy entry opens the panel;
    skipped without a canvas.
  - `m8-shots` (GM, P1): the Bandolier and the panel at 1440x900 and 1024x768, dark and light (`--shots`).
- **After the M8 review** (one pass; medium findings fixed, each with a stub test that fails without it):
  - What pf2e's own Quick Alchemy action makes (its chat path, the action on the sheet) carried no stamp, so it never ran out:
    it is stamped on the creating client now (above).
  - Quick Bomber by UUID (`api.alchemy.quickBomb({uuid})`, macro 13) read the family from `fromUuidSync`, whose compendium index
    entry keeps the category under `system`, so no held bomb ever matched and every call made a new one with a vial: the
    family comes from the catalogue's facts.
- **After the second M8 review** (2026-10-27, one pass; the high and medium findings fixed, each with a stub test that fails
  on the code before it, `test/foundry/combat.test.mjs`, `ui-m8.test.mjs`, `test/logic/alchemy.test.mjs`; DECISIONS
  2026-10-27):
  - The Healing Bomb card went to the thrower's owners only, so the owner of a creature next to the target never saw its
    Apply button: it is whispered to the owners of the thrower, the target and every creature listed (`whisperFor`).
  - Healing Bomb had no way to work without a canvas: Throw needed a canvas target, "Apply to my selected tokens" needed
    selected tokens, and `applyHealingBomb` gave pf2e no token, so pf2e threw after writing the Hit Points while the record
    said applied. Throw now asks which creature (the party and the encounter), the card lists the party's living members
    when who is adjacent is not known (the "selected tokens" button is gone), pf2e is given a token found without the
    canvas, and a pf2e failure takes the record back.
  - Combine Elixirs and Balm Bomb charged their extra vial but the second elixir never did anything: Combine Elixirs' elixir
    carries both healings in `system.damage` (pf2e's own `consume()` rolls it from any sheet, an ally's included) and both
    descriptions; Balm Bomb asks for a common healing elixir and names it; the card and the Bandolier name the second item.
  - The panel could not pick the same item twice with Double Brew (a picked row was unpicked): picks repeat, with a count.
  - Turn expiry compared the turn index recorded with the creator's index now, which Foundry renumbers when a combatant is
    added, removed or re-sorted (a deleted enemy kept a quick vial a round too long; a summon ended bombs a turn early): the
    stamp records `own` and `ahead`.
  - A Quick Alchemy item handed to an ally merged into the ally's identical stack of another stamp (pf2e's stack test ignores
    flags): items carry their stamp's tag in `system.traits.otherTags`.
  - `setStrikeToggles` switched off the field vials, Advanced Vials and additive toggles the player set on pf2e's sheet on
    every Strike without a module value, Duct Tape included: only the module's own values are set, the player's put back.
  - Strikes from the panel and the HUD palette always rolled pf2e's first variant: the panel asks which, the palette has one
    entry per variant.
  - A second tab of the same user stamped the panel's item as pf2e's own action's (no additive) when its write landed last:
    pf2e is handed the item with the module's flags already on it.
  - Outside an encounter one additive a round was measured in world time, so a second Healing Bomb after a fight waited for a
    GM to move the clock: not enforced outside an encounter.

#### M8 live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, pf2e-dailies 4.23.1, with and without a canvas)

One pass at `9b23b9a` (M0-M8), then once more after the fixes below:

- **M8 plans** (`--runs 1`): with `--canvas`, `m8-hud`, `m8-panel`, `m8-bandolier`, `m8-turn`, `m8-vials`, `m8-healing-bomb`,
  `m8-duct-tape` and `m8-use-best` pass; without a canvas the same and `m8-shots` pass (`m8-hud` says it was skipped). The
  first runs failed in the steps, not the module, and the harness was fixed (15.3): every Strike step waited on pf2e's roll
  dialog (the dev world's users keep pf2e's default, dialogs on); pf2e's encounter takes no combatants without a canvas; the
  encounter step set initiative by the order the created combatants came back in, which is not the order asked for (with a
  canvas the fighter and the bomber swapped); the panel step read the element of a window it had closed; the HUD step looked
  for the panel before it had read the catalogue (4.7 s on a fresh client, headless, with a canvas). Console: the headless
  browser's own warnings (no hardware acceleration), Duct Tape's notice, and without a canvas pf2e's page error on every
  player client at each encounter's deletion (below). No slow server answers.
- **Regression** (`--runs 1`, no canvas, pf2e-dailies on): scenario 7, `m7-morning`, `m7-expiry`, `m6-income` and
  `m4-lifecycle` pass. Console errors: scenario 7's expected ones (15.3) and `m6-income`'s second device's "already exists"
  (the lock-first race the plan provokes, 5.4).
- **Found and fixed** (each with a test that fails without it):
  - *Without a canvas an encounter's end left what Quick Alchemy made in it potent* (medium; `m8-turn` without a canvas).
    pf2e's `EncounterPF2e#_onDelete` calls `game.user.clearTargets()`, whose core `_onUpdateTokenTargets` reads
    `canvas.scene.id` and throws on a client without a canvas, before core calls `deleteCombat` there, so no holder's client
    without a canvas ran the sweep. Core has asked the combat tracker to render the deleted encounter away by then: on a
    client without a canvas `renderCombatTracker` schedules the sweep too (`registerExpiryHooks`; `combat.test.mjs`).
  - *A thrown bomb stayed ready* (medium; the hands-on pass). pf2e's Strike takes a bomb as its own ammunition and leaves the
    item on the sheet at quantity 0; the Bandolier and the HUD palette listed it, "× 0", with Strike buttons pf2e refuses.
    `readyFacts` leaves out items at quantity 0 (`ui-m8.test.mjs`).
  - *The Bandolier ran off the bottom of the screen* (medium; the hands-on pass at 1440x900): ApplicationV2 does not hold an
    "auto" height to the viewport, so with a turn's Double Brew, quick vials and prepared items the vial buttons at its foot
    were out of reach. It stops at the viewport and its content scrolls (`styles/workshop.css`; `ui-m8.test.mjs` holds the
    rule).
- **Hands-on pass** (a scratch Playwright script, real clicks and keys, canvas on; the GM, Player One and Player Two online;
  setup through the harness: the bomber's vials refilled, Quick Bomber and Healing Bomb given, a marked scene with the bomber,
  the GM's cleric fixture as the ally at 10 feet, Player Two's fighter next to the cleric and the goblin warrior 20 feet off,
  an encounter of the four with the bomber first). The GM starts the encounter and the Bandolier opens by itself on Player
  One's client. Player One hovers the goblin and presses T, clicks the Bandolier's Quick Bomber, types "alchemist's fire" in
  the panel, clicks Alchemist's Fire (Moderate) and "Create and Strike", and Rolls in pf2e's dialog: pf2e's attack card at the
  goblin, 7 vials to 6 in pf2e's resource and the pips. Picks Cold for the field vial, clicks Quick vial (6 vials still) and
  the quick vial's second Strike button: pf2e's attack card with the MAP -5 variant, `bomber-field-vials:cold` and cold
  damage. Targets the cleric, clicks Healing Bomb (6 to 5) and Throw: pf2e's own healing card for the cleric, and the
  module's card whispered to the GMs, Player One and Player Two (the adjacent fighter's player), whose client shows it with
  one Apply button, "Fixture 6: Fighter crafter: +5 HP"; Player Two opens the chat log and clicks it, the fighter 20 to 25.
  Opens the panel, clicks Alchemist's Fire (Lesser) twice ("× 2", two chips, "Costs 2 vials.") and Create: 5 to 3; a second
  quick vial, kept. Clicks the combat tracker's End Turn: at once both quick vials are "(inert)" (turn) and the two bombs
  potent "until the start of your next turn"; the GM moves through the goblin, the fighter and the cleric, and at the
  bomber's turn in round 2 the bombs (and the thrown one) are inert, the Bandolier lists no Quick Alchemy item, "Additive
  this round: free.", 3 of 7 vials. Before the fixes the thrown bomb and quick vial stayed in Ready "× 0" and the Bandolier
  ran past the bottom of the screen; after them it lists neither and ends at the screen's foot (top 16, bottom 900, its
  content scrolling). No raw keys in the Bandolier, the panel or the cards on
  either player's client (only the fixtures' own names), and no console error on any client.

#### Follow-ups (M8, low)

- Persistent Mutagen's once a day is not counted: every mutagen the creator drinks outlasts the cap.
- The cap needs the origin item when the effect is made (OQ-19): an effect dragged from a card after the elixir was used up,
  or one with no `system.context.origin.item`, is not capped.
- A combat set back to round 0 keeps its Quick Alchemy items potent until it is deleted; a creator re-sorted past the current
  turn after making an item (initiative changed mid-round) keeps the `ahead` it had then.
- A creator whose token is unlinked (a synthetic actor) is not found as a combatant: its items get a round of world time.
- Advanced Vials' bucket is taken before pf2e's Strike rolls: a Strike cancelled in pf2e's dialog still uses a bucket's vial
  (the next preparation puts the buckets right).
- A toggle the module set (an additive's, a chosen field-vial type or material) stays set after its Strike (pf2e reads it again
  for the damage roll) and is put back only at the next Strike through the module: a Strike from pf2e's sheet before then
  uses it. A toggle the module turned off is restored on, but a toggle that was off keeps the suboption the module chose.
- Gathering's lock pages (`gather:<actorId>:<worldTime>`) accumulate with M7's (5.3.3 archive).
- The roster's `consumables` change with every Quick Alchemy item, so an encounter writes a snapshot (debounced) most turns.
- The panel's list shows no splash numbers (8.8 names the panel and the card; the card and the Bandolier have them).
- The tie question of "Use best consumable" shows quantities, not when each runs out (8.9), and there is no party-view window
  (`api.consumables.holders` only).
- Extra Vial (OQ-28) is unchecked: the familiar abilities pack was not in the checkout read.
- The Morning tab's frequencies stay read-only (M7 follow-up); their buttons are the Bandolier's.
- pf2e's own Quick Alchemy action still crafts for free at 0 vials: the module stamps what it makes but cannot gate its button.
- Healing Bomb's 20 feet is checked only with both tokens on the canvas; without a canvas no neighbours are known, so the card
  lists the party's living members (an adjacent creature outside the party, a summon or an NPC ally, gets no button: a GM
  applies pf2e's own healing to it). Without a canvas pf2e may be given the healed actor's prototype token, so its message's
  speaker is the applying user's character.
- Two devices of one user can each make a Quick Alchemy item at the same moment (the busy guard is per client); each spends
  its own vial.
- `api.alchemy.strike` with an item the character does not have refuses `no-actor`, not `item-gone`.
- Esc in the panel may also reach core's dismiss key (the panel closes twice, harmlessly).
- Outside an encounter every Quick Alchemy item lasts one round of world time, Enduring Alchemy's included (8.8's "one round").
- From the second M8 review (low, not fixed in that pass):
  - Splash numbers show Expanded Splash's Intelligence and 10 feet, and Directional Bombs' cone, as always on, though both are
    pf2e toggles the module never sets; with the field discovery the splash shows Intelligence even when the bomb's own is
    higher (pf2e's `AdjustModifier` upgrade takes the higher). Show them "if chosen" (or set the toggles with the throw) and
    use `max(base, max(1, Int))`.
  - The `uncapped` rule exempts every Eternal Elixir elixir the creator drinks (the feat makes one indefinite at a time: a new
    one ends the previous), and Persistent Mutagen is read only for mutagens the creator made (the feat covers any infused
    mutagen it drinks) and is not counted once a day.
  - A quick vial copies the vial item's `system.containerId`: with the vials in a container that stows (an Alchemist's
    Toolkit), pf2e makes the "held" quick vial stowed, last in `chooseBest`. Set `containerId: null` on the copy.
  - Advanced Vials offers only adamantine, cold iron and dawnsilver; the feat also allows another precious material the
    alchemist wears or wields (pf2e's toggle lists them), refused as `bad-choice`.
  - "Use best" and Quick Bomber rank every turn stamp in an encounter alike (`expirySortKey` -1): a quick vial ending this turn
    ties with a bomb potent until the next turn's start, and the user is asked. Order turn-end current, turn-start, turn-end
    next.
  - Quick Bomber cannot use the free quick vial: with family "vial" and none held it refuses `none`, and the Bandolier's Quick
    Bomber opens the panel, refused at 0 vials. Fall back to `quickVial(actor, {then: "strike"})` and offer a quick-vial row.
  - The Bandolier's Quick Bomber always makes a new bomb through the panel (a vial) though 8.4 draws a held one first; route it
    through `alchemy.quickBomb({uuid, createIfNone: true, map})`.
  - A quick vial ends at the end of the turn it was thrown in: a damage roll from pf2e's attack card after the turn moved on
    is cancelled by the inert guard (its origin is the inert vial; under `expiry.action` delete pf2e finds no Strike). Let the
    guard pass damage rolls (`context.type` "damage-roll") of a Quick Alchemy item of the same encounter.
  - The Healing Bomb card's Apply shows to the creature's owner and every GM; two near-simultaneous clicks on two clients can
    both pass the healed check. Show it to the creature's responsible user only, or take a lock page first.
  - `strikeWith` takes pf2e's Strike variant before setting the toggles and rolls that earlier variant, whose closure (traits,
    title) may still show the old damage type on the attack card. Set the toggles first, then find the Strike.
  - If anything in the HUD palette's injection throws after the duplicate check while ours is the open palette, nothing stands
    in for it and core's `_postRender` throws. Call `keepPaletteSafe` from the hook's catch.
  - `adjacentLiving` lists hidden tokens and tokens the thrower cannot see; their names are in the card's button labels. Skip
    hidden tokens (or name them generically for non-owners).
  - Balm Bomb's elixir is named with the bomb, not applied: the ally's healing on a hit is the table's (pf2e's own elixir).
    A card button that uses the elixir through pf2e on a hit would complete it.
  - Combine Elixirs sums the two elixirs' healing only when they are of one type and kind; otherwise the second's healing is
    only its inline roll in the description.
  - Pf2e's sheet may drop the stamp tag from `system.traits.otherTags` when a player edits a Quick Alchemy item's other tags
    there (the tag is not one of pf2e's options); the item may then stack with another stamp's again.
- From the M8 live pass (low, not fixed in that pass):
  - pf2e 8.6.1 throws on every client without a canvas when an encounter is deleted (`EncounterPF2e#_onDelete` calls
    `game.user.clearTargets()`, and core reads `canvas.scene.id`), so `deleteCombat`, pf2e's `resetActors` and core's
    collection update never run there, with a page error each time; to report upstream. The module's sweep runs from the
    tracker's render instead; if the deleted encounter was not the one that client's tracker showed, it waits for the next
    trigger (a turn, a clock move, a stamped item).
  - The first Quick Alchemy panel (or Quick Bomber) on a client waits for the catalogue before the window appears: 4.7 s
    from the HUD entry on a fresh headless client with a canvas, a click with no visible answer. Read the catalogue when the
    Bandolier opens, or open the window at once with a line saying it is loading.
  - pf2e leaves a thrown bomb and a thrown quick vial on the sheet at quantity 0; turn expiry then renames them "(inert)", so
    an encounter leaves "× 0 (inert)" items in the inventory. Delete Quick Alchemy items at quantity 0 when they expire.
  - Without a canvas the Healing Bomb card's Throw asks which creature; the hands-on pass used the canvas only (the plan
    `m8-healing-bomb` covers the card without one, through the API).
  - The Bandolier's saved position is clamped to the screen when it renders taller than the space below it, so it can jump
    up and stay there (the clamped position is saved).
  - The Quick Alchemy panel shows its Additive select, with only "None", for a character with no additive that fits the
    first pick (`panelContext` offers it whenever something is picked). Leave it out when `fitting` is empty.

### 10.15 As built in M8a

M8a builds the affliction tracker (section 8.10): the rules engine (`scripts/logic/affliction.mjs`), the runtime stage parser
(`scripts/logic/affliction-parse.mjs`) with its overrides and ignore list (`scripts/data/afflictions.mjs`) and the corpus check
(`tools/validate-registry.mjs` `checkAfflictions`); definitions, the backend and the DCs (`scripts/foundry/affliction-defs.mjs`);
exposure claims, saves, recording, pending state, timing, manual changes and the stage guard (`scripts/foundry/afflictions.mjs`);
coatings, Strikes and the other deliveries (`scripts/foundry/coatings.mjs`); Affliction Forge (`scripts/foundry/forge.mjs`); the
Afflictions window, its cards and the item-card augment (`scripts/ui/afflictions.mjs`, `templates/afflictions/`,
`templates/chat/affliction.hbs`); the DC stamp at creation in `morning.mjs`, `alchemy.mjs` and `outputs.mjs`; coatings voided with
their poison in `expiry.mjs`; the Bandolier's "Apply poison"; the Workshop header's pending count. Unit tests cover the pure parts
(`test/logic/affliction.test.mjs`, `affliction-parse.test.mjs`, the corpus check in `test/validate-registry.test.mjs`); stub tests the
Foundry and window parts over a fake of pf2e's saves, conditions and damage rolls (`test/foundry/pf2e-afflictions.mjs`:
`actor.saves[type].roll` records the item and options it is given and makes the message pf2e would, with `flags.pf2e.context`;
the ephemeral item is physical with a level, as `Statistic#roll`'s incapacitation reads it; `ConditionManager.getCondition`;
`DamageRoll`; core's `preUpdateItem` and `preDeleteItem`; `test/foundry/afflictions.test.mjs`, `ui-m8a.test.mjs`,
`harness-m8a.test.mjs`). The live plans passed their first live pass, with and without a canvas (M8a live pass, below). pf2e read: the dev head `be4ab21b`
(`item/affliction/data.ts`, `document.ts` (`handleStageChange`, `EXPIRING_CONDITIONS`, `getLinkedItems`, `_onCreate`, `_onUpdate`,
`rollRecovery`), `item/effect/document.ts` (`increase`, `decrease`, the badge clamp and deletion in `_preUpdate`),
`item/abstract-effect/values.ts` and `helpers.ts` (`DURATION_UNITS`, `calculateRemainingDuration`), `system/statistic/statistic.ts`
(the incapacitation adjustment from a physical `item`'s level), `chat-message/data.ts` and `document.ts` (`flags.pf2e.context`,
`damageRoll.types`, `isDamageRoll`), `item/condition/values.ts`, the poisons, spells and creature abilities of the packs);
Affliction Forge 0.1.74's `README.md`, `docs/API.md`, `docs/DATA_CONTRACT.md` and `docs/REFERENCES_AND_DND.md` (it is not installed
in the dev world).

- **The rules engine** (8.10.6) is as specified: `applyDegree` for the initial, stage and re-exposure saves (`kind`), `enterStage`
  and `startOnset`, and `advance`, which applies the onset's end and the maximum duration each at its own moment, in time order, and
  stops at the first stage save that is due (the maximum wins a tie). `recordSave` keeps each save's `before` and replaces a result
  only for a reroll once pf2e has deleted the original, and only the latest save. The run state is the specified one plus
  `enteredAt`, `onset` (the rolled onset), `manual` (the undo log of manual changes) and `mods` (the modifiers that held for the
  target); a dice interval or onset is rolled once, when it starts (`rollDuration`).
- **The modifiers** (8.10.6) are registry `afflictionModifier {mod, as}` effects (6.11, the new kind): Tenacious Toxins and the
  toxicologist's acid (kept only against a poison-immune target) as the creator; Pinpoint Poisoner (kept only against an
  off-guard target, for a Strike read from its attack roll's options at the hit, so flanking counts, and for a cloud from the
  creature's condition when the claim is applied; second M8a review), Blowgun Poisoner (a critical hit makes the initial save one degree worse; a blowgun
  exposes without piercing or slashing damage), Sticky Poison and Double Poison as the deliverer; Pernicious Poison and Combustible
  Poison carried as the poison's Quick Alchemy additive; Acquired Tolerance as the victim (pf2e's own reroll menu, recorded as a
  reroll); legacy Potent Poisoner as the creator (its DC stamp). Seven feats left the ignore list for the registry (284 entries,
  1167 ignored).
- **The parser** (8.10.2) reads the specified parts, and also: a spell's save from its defense (`system.defense.save`, against its
  caster's spell DC), a "Level" paragraph (the affliction's own level), a blank `dc:` (a creature's DC), a plain-text save ("DC
  32 Fortitude"), pf2e's options after an `@Damage` formula, "carrier with no ill effect", an interval followed by a comma. Weeks,
  months and years become days (7, 30, 365); pf2e's effect units stop at days. A stage is `unparsed` when any text is left after
  its mapped parts and connectors; a definition is `full` only when the save, onset, maximum duration and every stage with an
  interval read cleanly.
- **Coverage** (the corpus check, every Item pack of pf2e at `pf2e-8.6.1` and at the dev head `be4ab21b`, the same both ways):
  201 candidates; 76 read fully, 120 have an
  override, 5 are ignored, none fails (after the second review; before it 86 and 110). The poisons (the poison trait): 149, of which
  69 read fully and 80 have an override; of the equipment pack's 139 poison items, 61 read fully and 78 have an override. Of the
  120 overrides, 40 carry data (a missing interval, a maximum duration "(but see stage 3)", a save the text gives no type or DC for,
  a kind the traits leave out, `reExposure` for Lethargy Poison, Stupor Poison, Toiler's Gruel and Grolna, `keepsCoating` for
  Forgetful Ink, the parts of Curare's stage 3 and Reaper's Shadow's damage, and an intro's rule for ten items: `cumulative` for
  King's Sleep, `detach` for Nethershade, `intro: "table"` for eight) and 80 mark stages
  whose remaining text is for the table (`prose`: item bonuses, choices, death, "can't recover"). An interval an item leaves out is
  one round where its maximum duration is in rounds (one day for Mosquito Blight's stage 4): an interpretation. The ignore list
  holds Shrinking Potion (an onset, not an affliction) and the four boon items whose stages have no save (Elder Seed, Heartblood
  Ring, Phoenix Cinder, Void Fragment). `--affliction-baseline` reports a changed reading between two pf2e tags (3.3).
- **Definitions at runtime**: the parse of the compendium source's description, cached per source and pf2e version; an override by
  source UUID (else by slug); a world definition (`afflictionDefs.<hash>` in the ledger) first. The world-definition form, opened by
  Expose when nothing reads, takes a save and DC, onset, maximum duration and up to six stages written in plain words ("1d6 poison,
  sickened 1", "1 round"), read by the same grammar (`defineFlow`).
- **The backend** (8.10.1): `backend()` by feature detection; every pf2e release is `effect`. The effect backend's tracker is an
  `effect` with unlimited duration, the source's effect traits, a counter badge whose labels are pf2e's stage names (all "Onset"
  during an onset, so the badge's value is always the run's stage), `flags.MOD.affliction = {v, run, system, def?}` (`def` for a
  Double Poison or a world definition), and the hidden-information rule of 8.10.8 (a generic name and image on a player's creature,
  `unidentified` on others). The native backend's paths are written (an `affliction` item created only when a stage is active,
  `system.onset` never written, a repeated stage's conditions and `createStageMessage()` the module's, the migration at a GM's
  `ready`) and tested only through the pure parts: no pf2e build here has the type.
- **Stage conditions** (8.10.1) come from `game.pf2e.ConditionManager.getCondition`, granted by the tracker with `grantedBy.onDelete`
  `detach` for the six expiring conditions and unlinked ones and `cascade` for the rest, linked ones with `references.parent` as pf2e
  links them; the tracker's own `itemGrants` are all `detach`. A stage change follows `handleStageChange` (`stageConditionPlan`):
  the tracker's linked, non-expiring conditions and stage effects go, the new stage's are created or have their value updated.
  Ending a tracker deletes it and its `cascade` grantees in one request; drained and the other expiring ones stay.
- **Exposure** (8.10.3): `expose()` writes one claim per target, keyed `expose:<message or nonce>:<hash of the target>`, with the
  source snapshot, the definition key (or the definition itself for a Double Poison or a coating's), the frozen DC, the delivery,
  the modifiers, the deliverer's encounter, the run id the tracker will take, and `exposedAt` (the affliction clock). The claims
  sweep (5.5) applies it on the target's responsible client, or the active GM's for an Affliction Forge hand-off
  (`registerClaimKind`'s new `responsible` option), whatever the user's auto-claim setting (exposure and coating-spend claims are
  never deliveries). A claim waits behind an earlier open one of the same definition on the same target. It resolves with an
  outcome (`afflicted`, `unaffected`, `immune`, `no-effect`, `no-save`, `forge`, `forge-owns`, `voided`, `no-definition`) or stays
  open with `pending = {kind, runId, seq}` while its save waits; a re-exposure whose affliction ended before its save was recorded
  starts it again as an initial exposure (review fix).
- **Saves** (8.10.8): `rollSave` uses `actor.saves[type].roll` with the frozen DC, the ephemeral source item at the affliction's level
  (a weapon or ammunition source as a consumable), its roll options and the link `<MOD>:affliction:<runId>:<seq>`, the initial
  save's circumstance modifiers (Pinpoint Poisoner, Combustible Poison, held breath), and the affliction's kind traits. Who rolls is
  `rollerFor` (the table of 8.10.8); a prompt is a card (one per save and state, so a "waiting for the player" card is followed by
  the player's own when they connect) and a notification by `afflictions.notify`. Recording (`onAfflictionMessage`) happens on the
  message author's tab: `recordResult` takes the lock page `afflict:<runId>:<seq>:<results so far>`, resolves the claim and writes
  the tracker and its conditions in one lock-first request, then posts the damage as a pf2e damage roll (applied by pf2e's buttons;
  `afflictions.autoApplyDamage` applies it). A drug's "fail on purpose" records a failure without a roll.
- **Timing** (8.10.7): `processAfflictions` (single-flight) on `updateWorldTime`, `combatTurnChange`, `deleteCombat`, a logged day
  (`meta.manual`), a user connecting, `ready` and after each record; it writes only the pending key, never the whole run, and clears
  a pending save another client already recorded (review fix: an older copy of the run must not overwrite a result). The clock is
  `afflictionNow` over the workshop day's logged days. In an encounter `isDue` is pf2e's convention against the run's anchor
  (`afflictions.combatAnchor`). Catch-up: automatic stage saves of one affliction in a chain stop at `afflictions.catchUpLimit`
  (`pause`: after the first) with a Continue button; a save rolled by hand starts the count again.
- **Manual changes** (8.10.9): `adjust` (a stage, the onset's end, an end, undo of the last manual change, each recorded in
  `run.manual` with its author), `undoEnd` (a manual end, from the snapshot kept on the actor in `flags.MOD.afflictionEnded`), and
  `repair` (the stage's conditions again, no damage). The stage guard cancels a change of a tracker's badge, status or onset the
  module did not make (its own writes carry `{[MOD]: {affliction: true}}`, passed by `toOperations`'s new `options`) and replays it
  as an adjust; a deletion it did not make is allowed and recorded as a manual end.
- **The DC** (8.10.4): `exposureDc` follows the order (a world definition's DC or an override's `save.value`, a typed DC, the stamp,
  the inline DC as pf2e upgrades it for the holder, the printed DC). `dcStampFor` writes `flags.MOD.dcStamp = {value, rule, creator,
  printed, at}`: Powerful Alchemy for an infused item that allows a save (the morning's outputs, Quick Alchemy's items from the panel
  and from pf2e's own action) only when the class DC beats the printed DC; legacy Potent Poisoner (`legacy: true`) for a poison
  crafted by any means, downtime orders included. A Talisman Dabbler stamp's `dc` is read the same way.
- **Coatings** (8.10.5): `applyPoison` (owner of both; the host by delivery; refused on a weapon Affliction Forge coats), the dose
  spent by a quantity update, the DC frozen, the infused poison's stamp copied (`voidCoatings` in the expiry sweep removes the
  coating with it, never marking the weapon); a second injury poison replaces after a confirmation, or merges with Double Poison
  (`mergeDoublePoison`: the longer maximum duration and onset, an interpretation). Ammunition: one piece split off the stack. Strikes
  (`onStrikeMessage`, on the attacker's responsible client): the attack roll arms, keeps or spends; the hit's damage roll exposes
  through `expose` (the deliverer's modifiers added to the coating's) and spends; Sticky Poison's flat checks (DC 17, DC 5) keep it,
  until the end of the attacker's next turn (a round of world time outside an encounter). A voided exposure ("no piercing or
  slashing damage got through" on the target's prompt) lets the attacker's client roll the DC 5 check and give the coating back.
  Contact and ingested coatings: Touched or Eaten (`touchCoating`) behind the lock page `coating:<id>` (per toucher for an item that
  keeps its potency) with a coating-spend claim. Inhaled poisons: `unleash` spends the dose and posts a cloud card whose button
  exposes the creatures picked while it lasts (a minute of world time).
- **Affliction Forge** (8.10.11) as specified; its controllers are found by `api.instances.listForActor` (origin or definition
  metadata source), its templates by a reference on the item or `api.templates.list` (the importer's `sourceUuid`). Not run against
  the real module (OQ-41): the live plan uses a stand-in that throws on a player's client, as its engine does.
- **The interface** (8.10.9, 10.5): the Afflictions window is a window of its own (`AfflictionsApp`), not a drawer inside the
  Workshop, so it stays open beside an encounter and opens from the Workshop header ("Saves: n"), the Bandolier, the API and the
  cards. Cards: the save prompt, the stage change (none for a successful initial save), the coating, the cloud; the item-card
  augment offers Expose, Apply poison, and Touched or Eaten. Settings 14.5 are registered as listed (`features.afflictions` W on).
- **API** (11.2): `afflictions.{definition, define, expose, applyPoison, unleash, touch, active, pending, rollPending, roll, adjust,
  repair, process, backend, open}` and `rules.afflictionStep`; internal hooks `afflictionPrompt`, `afflictionCoating`,
  `afflictionCloud`, `afflictionNotice`; the public `afflictionChanged` (12.3) with `reason` initial, re-exposure, stage, onset,
  max-duration or manual.
- **Live plans** (15.3 scenario 12; `tools/harness/affliction-scenarios.mjs`, scenario `m8a`; `live-plans.mjs`), first run in the
  M8a live pass (below). A plan that needs a running affliction types a DC no fixture makes (`M8A.failDc`, 45; a stamped dose for
  a Strike or a cloud), so its checks run every time instead of being skipped when the dice say so.
  - `m8a-strike` (12a; GM, P1; `--canvas`, the NPC fixture 17a placed on a marked scene, its token unlinked as at a table): a
    dagger coated with Black Adder Venom, Sticky Poison given;
    pf2e's Strike and damage expose the NPC once; its initial save rolled once, on the GM's client; stage saves at the turn ends of
    the round after; the 3-round maximum ends it; the coating kept exactly when the flat check succeeded. Skipped without a canvas.
  - `m8a-cloud` (12b; P1, P2, the GM only to move the clock): an inhaled poison at both characters; one prompt each, each rolled by
    its owner; Player Two's Hero Point reroll replaces the result; Player Two away with a save due: pending, nothing rolled for them;
    back online, they roll it.
  - `m8a-once` (12c; GM, assistant GM, P1 in two tabs, P2): `pcSaves: auto`; one claim and one roll per creature.
  - `m8a-powerful` (12d; GM, P1, P2): the bomber prepares Black Adder Venom with Advanced Alchemy (stamped with its class DC), hands
    it to the fighter, who coats a dagger with it (the coating keeps the stamped DC); the bomber's next preparations remove the
    coating; an affliction already running from the poison continues.
  - `m8a-timing` (12e; GM, P1, P2): re-exposure during Arsenic's onset; an hour of world time with `catchUpLimit` 2; King's Sleep
    on the fighter (in downtime) and the bomber, two days logged, then "advance the clock to match": no save rolled twice.
  - `m8a-forge` (12f; GM, P1, P2): Affliction Forge's stand-in on every client; a template-linked poison handed off on the GM's
    client with the Workshop's DC, no player client calling it; with only players connected, tracked by the Workshop.
  - `m8a-backends` (12g): every client reads one backend; the effect backend's tracker is an `effect` whose badge is the stage (the
    native half needs a development build of pf2e).
  - `m8a-panel` (12h): pf2e's own `increase()` and `decrease()` on the fighter's tracker: a recorded manual adjust, then a recorded
    manual end.
  - `m8a-familiar` (12i; P1, P2): an unidentified poison on the fighter shows Player Two a stage badge under a generic name. (A
    familiar fixture does not exist yet; the familiar half waits for one.)
  - `m8a-shots`: the Afflictions window as Player Two at 1440x900 and 1024x768, dark and light (`--shots`).
- **After the M8a review** (one pass; the medium findings fixed, each with a stub test that fails on the code before it,
  `test/foundry/afflictions.test.mjs`, "After the M8a review"):
  - A re-exposure whose affliction ended (a manual end, the maximum duration) before its save was recorded made a tracker stuck in
    an onset with no end: it now starts the affliction again as an initial exposure.
  - The clock's processing wrote the whole run back with its pending save, so a result another client recorded at the same moment
    could be overwritten by the older copy, and a pending save already recorded stayed pending for ever: only the pending key is
    written, a stale one is cleared, and a transition is skipped when the run moved meanwhile.
  - The corpus check ran only over the packs of the sparse checkout used during development; over every Item pack it found 26
    spells and creature abilities that did not read (a spell's save is its defense; creature abilities leave `dc:` blank): the
    grammar reads those, and the rest have overrides.
- **After the second M8a review** (one pass; every high and medium finding fixed, each with a test that fails on the code before
  it, shown by running the new tests against the earlier commit with that one fix missing: `test/logic/affliction.test.mjs`,
  `affliction-parse.test.mjs`, `test/validate-registry.test.mjs` and `test/foundry/afflictions.test.mjs`, each under "After the
  second M8a review"):
  - The module's own tracker writes passed one frozen operation object to `Document#update`, which writes `parent` and `pack`
    into it (14.368): in Foundry no stage save ever fell due and a re-exposure that rolls no save never resolved its claim.
    `ownWrite()` gives a fresh one each time; the stubs now write into the operation as Foundry does, so the stage-save tests
    fail on the frozen object.
  - Logged days pinned the clock to the end of the last logged day, so round, minute and hour afflictions froze until world time
    passed it, even after "advance clock to match": the clock is world time moved on by the whole days the log runs ahead
    (8.10.7), with no stored high-water mark (DECISIONS 2026-10-27).
  - Stage text the grammar mapped out of a choice, a conditional clause or a short duration of its own was applied as it stood
    (Curare's paralysis on entering stage 3, all three of Divine Plagues' conditions, Reaper's Shadow's doomed outliving the
    poison, Sloughing Toxin's damage added twice): such a stage applies none of its parts; Curare's and Reaper's Shadow's
    overrides name the parts that do; "as stage N, but" replaces (8.10.2).
  - Intros that change a stage condition went unreviewed (King's Sleep's cumulative drained was set, not added, and lowered on a
    success; Nethershade's enfeebled went at the next stage): the corpus check flags them; the overrides `cumulative`, `detach`
    and `intro: "table"` cover the ten pf2e-8.6.1 items it found (8.10.2).
  - A re-exposure during a pending stage save took the stage save's number, so one roll was recorded as the other and the stage
    save was lost: the re-exposure waits behind a pending or due stage save, and save numbers skip reserved ones (8.10.8).
  - Pinpoint Poisoner applied to every creature in a cloud and never to a flanked target: off-guard is required for every
    delivery, read for a Strike from its attack roll's options at the hit (8.10.6).
  - The inline and stamp DCs took the highest save check in the whole description (an addiction's DC, a stage's basic save):
    they use the item's own Saving Throw check (`ownSaveDc`, 8.10.4).
  - A re-exposure's save lost the initial save's modifiers (Pinpoint Poisoner, held breath, Combustible Poison, Blowgun Poisoner's
    degree, Pernicious Poison): it counts that exposure's own (8.10.6).
  - A homebrew poison's definition was re-read from its item, so its tracker stopped once the dose was gone and its coating or
    cloud could not expose: the claim, coating, cloud and tracker keep it (8.10.2).
  - A coated piece of ammunition was never used by a Strike (pf2e's origin is the launcher): the launchers that had the stack
    selected take the coated piece, and a launcher's Strike arms and spends the coating of the piece it fired (8.10.5).
  - In passing (a low finding, in the same lines): a Double Poison exposure is keyed as the double (`coating.defKey`), not as its
    second poison.

#### M8a live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, with and without a canvas)

One pass at `1a444c0` (M0-M8a), then once more after the fixes below:

- **M8a plans** (`--runs 1`): with `--canvas`, `m8a-strike`; without a canvas, `m8a-cloud`, `m8a-once`, `m8a-powerful`,
  `m8a-timing`, `m8a-forge`, `m8a-backends`, `m8a-panel`, `m8a-familiar` and `m8a-shots` pass. The first run passed every plan
  without a canvas, but most of its checks had run on nothing: the fixture NPCs were never found (the step looked for "Fixture
  17a: ordinary NPC"; the builder names them "... (Goblin Warrior)"), `m8a-strike` skipped itself, and where the fighter
  (Fortitude +19) made its save against DC 18 (`m8a-panel`, `m8a-backends`, `m8a-familiar`, the onset half of `m8a-timing`,
  the reroll and away halves of `m8a-cloud`) the plan passed on its "nothing to check" branch. The harness was fixed (15.3):
  the NPC found by its fixture name; `M8A.failDc` (above); the roll step waits until the target's client has applied the
  exposure claim (the save is listed as soon as the claim is written but can be rolled only once the claims sweep has applied
  it, so the step refused `no-save` and timed out); `m8a-strike` places the bomber and the goblin on a marked scene (M8's
  `arena`) and targets the token's own actor, gives pf2e's Strike a click instead of `skipDialog` (pf2e's Strike reads the
  dialog from the event, `CheckPF2e.roll`, so the step waited on its dialog), targets through the token placeable, reads
  Sticky Poison's check from the coating card's text, and counts three turn changes to the end of the anchor's turn in round
  2 (8.10.7); `m8a-cloud` gives the fighter a Hero Point first (an earlier run had spent it). Console: the headless browser's
  warnings, and with a canvas a pf2e page error on the GM's client while the marked scene is created and activated (`reading
  'addChild'`, during the scene's first draw). No slow server answers.
- **Regression** (`--runs 1`, no canvas): scenario 7, `m8-turn`, `m8-healing-bomb`, `m7-expiry` and `m4-lifecycle` pass.
  Console errors: scenario 7's expected ones (15.3) and pf2e's page error at each encounter's deletion without a canvas (M8
  live pass).
- **Found and fixed** (each with a test that fails without it; `afflictions.test.mjs`, `affliction-parse.test.mjs` and
  `ui-m8a.test.mjs`, "After the M8a live pass"):
  - *A coated Strike never exposed its target* (high; `m8a-strike`). The damage roll's types were read from
    `flags.pf2e.damageRoll.types`, which pf2e 8.6.1 does not write on a Strike's damage message (the types are in its
    `DamageRoll`'s instances), so every hit read as "no piercing or slashing damage": the coating was spent (or kept by
    Sticky Poison's DC 5 check) and nothing was exposed. `damageTypesOf` reads the damage rolls' instances, and the flag too.
  - *Stages read at runtime were partial where the corpus check read them fully* (medium; found preparing the hands-on pass,
    Spider Venom read `partial`). pf2e's source packs link a condition by name (`conditionitems.Item.Sickened`), but its build
    writes the item's id, and the installed compendium is what the parser reads at runtime: every condition link was left
    over, so each stage with one was `unparsed`, the window showed its paragraph instead of its parts, and a condition with no
    bare name the grammar knows (wounded, dying, persistent damage) was lost. Over every Item pack of the installed pf2e 8.6.1:
    16 of 201 candidates read fully before, 80 after (`CONDITION_IDS`, the condition items' ids, 8.10.2).
  - *A pending save's prompt card said "Rolled." after a reload* (medium; the hands-on pass). The chat log renders before the
    module finds the ledger, so a pending initial save, read from its claim, looked rolled: the card hid its buttons, nothing
    rendered it again, and no new card is posted for a state that has one, so the player could roll only from the Afflictions
    window (seen on Player Two's client at login, on the GM's waiting card, and on both clients after a reload). A card is not
    called rolled until the ledger is known, and prompt cards whose shown state is wrong are rendered again when the module's
    status changes or a save is recorded.
  - *A successful initial save was recorded as a move stopped after its lock* (medium; every plan's console). With nothing to
    write on the creature the apply request was empty: `runLockFirst` sent it, read "the client sent nothing" as stopped and
    warned, and `recordResult` refused, so `afflictionChanged` (reason initial) never fired for an unaffected creature. A move
    with nothing to apply is complete once its lock request is (`batch.mjs`).
- **Hands-on pass** (a scratch Playwright script; the goblin half went through in three runs, the whole in two, the last after
  every fix; real clicks and keys, canvas on; the GM and Player One online, Player Two
  offline until the second half; setup through the harness: Player One made owner of the toxicologist fixture (5), which
  learns Spider Venom and holds a dagger; `npcSaves: prompt`, so the GM's card can be clicked; a marked scene with the
  toxicologist, the goblin warrior (17a, unlinked) next to it and the fighter; the toxicologist's daily preparations make two
  Spider Venom (Advanced Alchemy, infused; its class DC 20 does not beat the printed 22, so no stamp); an encounter of the
  toxicologist (30) and the goblin (10), not started). The GM clicks Begin Encounter in the combat tracker, and Player One's
  Bandolier opens by itself with "Spider Venom 2 Apply poison". Player One clicks Apply poison, picks Dagger in the dialog
  and Applies: the coating card "coated Dagger with Spider Venom", DC 22 (inline) frozen. Player One hovers the goblin and
  presses T, double-clicks their token, opens the sheet's Actions tab, clicks the dagger's Strike and Roll in pf2e's dialog,
  then Damage on the attack card and Roll: the coating card says it is spent, and the save prompt appears on the GM's client
  only (whispered to the GM and the assistant GM; Player One's client has none), "Initial save DC 22 Fortitude" with Roll save
  and "No piercing or slashing damage got through". The GM clicks Roll save and Roll: Spider Venom at its stage with its
  conditions (a critical failure: stage 2, clumsy 1 granted `cascade`, sickened 2 granted `detach`; in the last run the goblin
  made its save, unaffected, no tracker and no stage card). The GM opens the Workshop
  from the Actors directory and clicks the header's "Saves: 1": the Afflictions window lists the goblin's Spider Venom, "Stage
  2 of 3", "Next save in 1 rounds.", "Ends in 6 rounds at most.", the three stages with their parts and intervals, Reduce
  stage, End, Re-apply conditions. The GM clicks Next Turn: at the goblin's turn of round 2 (the end of the toxicologist's
  turn, the anchor) the stage save's card appears; Roll save, Roll: stage 3, clumsy 2 and sickened 3; then one stage save a
  round, each one card, each clicked, the conditions following the stage; the affliction ends (one run: the 6-round maximum
  runs out in round 7, its stage card says so; another: a critical success at stage 2 in round 6, "has ended"), and the
  goblin keeps its sickened (expiring, detached) while clumsy (cascade) has gone with the tracker. Player versus player:
  Player One closes the
  sheet, clicks Apply poison again (the second dose; no replace question, the first coating was spent), targets the fighter,
  Strikes: a hit, Damage. With Player Two offline the fighter's save waits, nothing rolled: the GM's client posts "Waiting for
  the player to connect." with Roll for them (the GM's button), to the GMs and Player Two. Player Two logs in: their own
  prompt card and a notification "a save against Spider Venom is due."; on their client the waiting card says "Rolled." with
  no buttons before the prompt-card fix, and after it shows only "No piercing or slashing damage got through" (Roll for them
  is the GM's). They click Roll save and Roll: the save is recorded (a success each time: unaffected). No raw keys in the
  Bandolier, the dialog, the cards or the Afflictions window on any client; the only console errors are pf2e's while the
  marked scene is created (above).
- **Screenshots**: `afflictions.png` (the Afflictions window as Player One: Ilsa with Spider Venom at its first stage and Giant
  Wasp Venom's save to roll; `stageAfflictions`, her save rolled with the die one short of the DC) is linked from the README
  (17.1); every capture taken again.

#### Follow-ups (M8a, low)

- Purge (5.9) strips the trackers' module flags and leaves them as plain effects with their badge; it neither lists them nor
  offers to remove them (8.10.10).
- Saves due on logged days are ordinary due-save prompts; the day resolver and the wizard's checks step do not list them, and day
  records carry no `afflictionSaves` (8.10.7, 9.1, 9.2).
- Native backend: the module does not apply a stage itself when `actor.primaryUpdater` is not connected, and the migration's
  re-posted damage card is not marked (OQ-44); none of it has run (no pf2e build has the type).
- The world-definition form has six stage rows and reads English words only (OQ-46).
- A spell's or creature ability's DC (`against`) is typed on a manual Expose; nothing reads the caster's or creature's DC.
- Blowgun Poisoner's critical makes the initial save one degree worse by the module, not as pf2e's misfortune.
- Effects-panel clicks during an onset change the target stage (effect backend) rather than end the onset.
- A stage's linked effect items are deleted and created again when the stage repeats.
- A reroll that ends an affliction leaves a pre-existing expiring condition at the value the superseded result raised it to.
- A coated piece of ammunition is a stack of one with a coating; pf2e's stack test ignores flags and may merge it back on a later
  stack operation.
- The inhaled cloud is a card with a button for a minute of world time; no region or template (OQ-29), and a strong wind is the
  table's.
- `reExposure: "table"` (Grolna) rolls nothing and says the item's own text decides.
- The time words are drafts with plural trouble ("in 1 rounds"), as M4's "Setup 1 of 1 days". (Fixed in M11, 10.18.)
- A tracker on an unlinked token's actor is processed only while its scene's tokens are loaded (`game.scenes`).
- Affliction Forge's controller and template matching is read from its documentation, not run (OQ-41).
- The Bandolier's "Apply poison" is gone with the Bandolier while Duct Tape is active; the item card and the API remain (8.10.9
  says so).
- From the second M8a review:
  - Overrides with prose stages still lack an interval where the text has one the grammar does not read: Mythotoxin stage 3 ("1
    round; doomed condition value has normal duration"), Succubus Kiss stage 1 (an interval mid-sentence) and Midnight Milk
    (Pure) stage 1 (none, and no maximum duration), so the run waits at that stage; the corpus check could flag a non-final stage
    with no interval in an override that gives none.
  - A failed attack keeps an earlier hit's `armed` state on the coating, so a damage roll after a miss (a hit whose damage was
    never rolled, then a missed Strike's Damage button) can expose: clear `armed` on a failure, or match the damage roll to the
    attack it armed.
  - Tenacious Toxins reads its creator from a DC or expiry stamp only; a downtime-crafted poison has neither, so its creator's feat
    never extends its maximum duration (no crafted-by stamp on module-crafted poisons yet, 8.10.6).
  - Sticky Poison's hold always runs to the attacker's turn in the next round, a round too long when a reaction hit before the
    attacker's own turn this round.
  - A save rolled elsewhere (8.10.8: pf2e's inline check link, another module's button) is not recorded as the pending initial
    save when that is unambiguous, and nothing says it was ignored.
  - Affliction Forge's "waiting for a GM" prompt carries no run and save, so only one such card is ever posted and the hook fires
    on every claims change; a refused hand-off leaves its claim open with no fallback, blocking later exposures of that definition
    on that target.
  - An exposure claim whose target is gone (a deleted unlinked token) stays open and listed; the elected client should resolve it
    (`no-target`, 8.10.10).
  - Coatings are voided only while party-wide expiry is on and only on world actors: a coating from a Quick Alchemy poison (a turn
    stamp) is not voided with expiry off, nor one on an unlinked token's weapon.
  - NPC saves post in the default message mode, not secretly when pf2e's metagame settings hide NPC results (8.10.8).
  - Intro rules marked `intro: "table"` (Fearweed's frightened and Daylight Vapor's sickened that can't be removed, Arsenic, Taster's
    Folly, Sweet Hag's Eye, Slumber Wine, Blister Bomb, Mycological Malady) are not enforced, and the window does not show the
    intro; King's Sleep's drained still drops with pf2e's rest; Nethershade's detached enfeebled is the table's to remove after 24
    hours.
  - A stage that applies none of its parts (a qualified stage) loses the parts that were right too (Blinding Bottle's damage,
    Blaze's stupefied) until an override names them.
  - A coated piece loaded into a launcher's subitems may stack with uncoated ammunition (pf2e's `attach` stacks by
    `isStackableWith`, which ignores flags); a fired piece pf2e keeps at quantity 0 keeps its coating flag.
  - An exposure claim that waits (behind an earlier claim of the same definition, or now behind a pending stage save) is listed by
    `pendingOf` as a pending initial save whose Roll does nothing until the claim is applied.
- From the M8a live pass (low, not fixed in that pass):
  - The due-save notification is shown again on the owner's client each time any user connects or disconnects (`asked` is
    cleared on `userConnected`), though the card is not posted again: a player with a pending save sees "a save against ... is
    due." whenever someone else joins or leaves.
  - Apply poison offers a bomb (the toxicologist's Versatile Vial) as a host for an injury poison; a bomb deals no piercing or
    slashing damage, so its coating is spent unexposed. Leave thrown bombs out of `hostsFor` for injury poisons.
  - The GM's "waiting for the player" card stays on the player's client beside their own once they connect, both offering "No
    piercing or slashing damage got through".
  - An unidentified poison's notification reads "a save against An affliction is due." (the generic name capitalised
    mid-sentence; a draft string).
  - The corpus check reads pf2e's source packs, whose links the build rewrites (condition names to ids): it could also read the
    built packs, so a reading that differs at runtime is caught there.
  - M8's `arena` step, switched off, left the dev world with no active scene after `m8a-strike` and the hands-on pass (the
    scene it activates again is not active afterwards); the world's own scene was activated again by hand.

### 10.16 As built in M9

M9 builds tattoos and grafts with their subject, the spells an item's description asks a Craft to supply (staves, codas,
spellhearts, specialty wands and other items), fulus, missives, the quick-deploy snare ledger and the inventor's access to
gadgets (pure parts in `scripts/logic/crafts.mjs` and `spell-lists.mjs`, with additions to `pledges.mjs`, `gates.mjs`,
`downtime.mjs`, `orders.mjs`, `formula-jobs.mjs`, `expiry.mjs`, `batches.mjs`, `registry.mjs`, `views.mjs` and `defaults.mjs`;
Foundry parts in `scripts/foundry/crafts.mjs`, with additions to `products.mjs`, `orders.mjs`, `outputs.mjs`, `pledges.mjs`,
`downtime.mjs`, `communal.mjs`, `morning.mjs`, `settings.mjs`, `sync.mjs` and `api.mjs`; the window in `scripts/ui/crafts.mjs`
and additions to `extras.mjs`, `request.mjs`, `morning.mjs`, `downtime.mjs`, `templates/workshop/queue.hbs`, `morning.hbs` and
`templates/request/form.hbs`). Unit tests cover the pure parts (`test/logic/crafts.test.mjs`, `spell-lists.test.mjs`), stub
tests the Foundry and window parts (`test/foundry/m9.test.mjs`, `ui-m9.test.mjs`, `harness-m9.test.mjs`); the live plans passed
their first live pass (below, M9 live pass). DECISIONS.md 2026-10-27 "Tattoos, grafts and the remaining crafts" records the rules settled here.

- **Tattoo and graft orders** (6.14, 4.2.1): `craftType` "tattoo" or "graft", read from the product's trait when the request
  names none (`subjectTypeOf`; off with `features.tattoos`, which then crafts them as plain items). `target` is the subject (an
  actor UUID: the one named, else the recipient named, else the requester), who is also the recipient; one at a time
  (`makeOrder` refuses anything else). The request form asks for the subject ("Made on") and, optionally, a tattoo or graft
  of the same family and a lower level the subject has, which this one upgrades (`variant.replaces`: the Price difference at
  the new level's DC, `replacePlan`).
- **Consent and presence** (G10): the subject's owner agrees from the Queue (`consent`): `orders.<id>.subject = {actor,
  consented, presence, process, by, at}`, a key only they write. Where the process needs the subject present (the Secrets of
  Magic process with `rules.tattooSubjectLocked`, every graft) the subject goes into downtime from the day after today and
  sits for the order (`pcs.<id>.activity = {kind: "subject", ref}`, `lockedBy`), locked to it like a Communal Crafting
  helper (`subjectLockOf`, derived from the orders: consented, present, not closed, crafted by someone else): its day records
  are `{order, result: "subject"}`, any other activity stops at `sitting` (a helper's stop stays `locked`), a day plan with no
  activity is refused, and it
  cannot leave downtime (`subject`) or help elsewhere until the order closes or it withdraws, which it may before the start or
  after a failure (`withdrawConsent`). A subject in downtime with days still to resolve resolves them first (`days-pending`,
  as for leaving downtime: the lock has no start day), and "Agree" asks first, naming the activity it replaces (M9 review). G10 passes once the subject has consented and, where presence is needed, is in
  downtime sitting for this order (`subjectCustody`); a subject who left the chair agrees again from the same button. A crafter
  on themself needs neither. The simple toggle needs consent only and locks nothing.
- **One at a time** (G11): a tattooist under the Secrets of Magic process, and every implanter, has at most one tattoo (graft)
  order in progress (`busyWith`: setup, check, rolled, finishing or paused), reason `one-at-a-time`. G11 also reads the
  crafter's own lock now (`lockOf`: a helper's or a subject's), which M6 left out (`lockedBy: null`).
- **The process at start**: `variant.process` (a tattoo's) and a fulu's `variant.tradition` are frozen with the plan, so a
  settings change mid-Craft changes nothing; a graft rolls Medicine (`skillFor`, Howl of the Wild p.97), its G1 and G3 read
  Medicine, its G6 wants the formula (`needs-formula`: no `none` route), and the wrapper's `action:implant-graft` lets
  pf2e's own Graft Technician rule element add its bonus. Tattoo Artist's +1 (+2 at master Crafting) is the registry
  `modifier` the wrapper already applied (M3). A retry needs the subject's consent still.
- **What a finish makes** (`subjectSource`): the item on the shelf for its subject, `system.equipped` worn (a tattoo) or
  implanted (a graft), and `flags.MOD.subject = {kind, order, subject, crafter, process, magical, from, until, healed,
  state, replaces}`: under the Secrets of Magic process it heals until `from + rules.tattooHealingDays` (30) and is
  uninvested; under the simple toggle it is invested at once and not checked; a graft has no healing period. A magical
  tattoo at least 3 levels below a crafter holding Legendary Tattoo Artist (registry `crafterMark`) gets +1 on every
  `@Check[...|dc:N]`, plain "DC N" and "attack modifier of +N" from its first "Activate" on, and on every numeric `Resistance`
  rule element; `flags.MOD.mark = {key, mark, by, raised}` says so.
- **Healing and investiture** (the subject sweep, a step of the catch-up sweep, and when the workshop day moves, a subject's
  item arrives or what it invests changes): on the subject's responsible client (5.6), a tattoo whose healing ended, or an
  inactive graft, is invested if the subject's invest limit allows, else stays decorative for good (a tattoo) or inactive
  until the limit rises (a graft) (`investitureCheck`: the limit is pf2e's `system.resources.investiture.max` less one for
  each magical tattoo and each graft that works, Tattooed Historian's exemptions aside (registry `investitureExempt`, one per
  two of pf2e's `flags.system.tattooedHistorian.archetypeFeatCount`); the new one fails only when that limit is already zero).
  Two healed on the same day are counted against each other. A decorative tattoo loses its `magical`, `invested` and
  tradition traits and its rule elements ("becomes a non-magical tattoo"), so pf2e neither offers to invest it nor applies it;
  one still healing, decorative or inactive that was invested on pf2e's sheet is uninvested again and its owner told (M9
  review). An upgrade removes the item it replaces when the new one arrives. The subject's player is told what each became, and when it now invests more than its lowered limit allows. No
  ledger claim is needed: the item is on the subject, whose own client writes it. "Record healing" (the item's owner) ends the
  healing on that day, never before the day after the finish, and notes it on the order (`orders.<id>.healing`).
- **Spell-supplied items beyond scrolls and wands** (6.9, `spellNeedsOf`, from the item's description in the installed
  compendium): a staff or coda (the staff trait) needs one casting of every listed rank of every listed spell, cantrips
  included; a spellheart the spells it casts ("You cast [Nth-rank] @UUID[...]"); a specialty wand (the wand trait, not one of
  pf2e's base wands) one casting of a spell of the rank its name gives; any other item the spells its Craft Requirements link
  (at a written "(Nth rank)", else the spell's own), or one casting of any spell when they ask for castings without a link.
  Each listed casting is an entry (`<uuid>@<rank>`); a pledge names its entry (`entry`, the first open one the spell matches
  when none is named), one casting of that spell by its compendium source, at no lower base rank (`not-on-list`, `covered`,
  `spell-rank`); G9 needs every entry covered by a fulfilled pledge and `any` more castings. Buying one is priced at the
  entry's rank (a cantrip has no service price). The Queue lists the entries with their state, and the offer and buy dialogs
  list the open entries. A specialty wand that holds no spell of its own gets a link to the one cast into it and
  `flags.MOD.spell`. Such items are `spell-item` orders, as M5's staves were.
- **Fulus** (Secrets of Magic p.158): they batch in fours as consumables; the fulu takes its crafter's tradition: the
  crafter's only spellcasting tradition, else one the crafter chooses from the Queue (G12 `fulu-tradition` until then;
  `chooseTradition`), set as the item's trait with `magical` dropped beside it (`fuluTraits`); each carries a `world` expiry
  stamp of 365 days of world time and logged days (`fuluStamp`, 4.12; the `world` rule now also reads `atDay`), which
  party-wide expiry marks inert. Reverse Engineering is refused for them (`acquisitionRoutes`, `reverseEngineerGates`). The
  rapid option is not built (DECISIONS.md).
- **Missives** (Treasure Vault (Remastered) p.84): made blank (`flags.MOD.missive = {composed: null}`); "Compose" (the Queue
  on a finished order, the API) splits one off a stack, names it "(composed)" and records `{actor, by, at, note}`.
- **Snares** (7.1): a prepared snare pool's quick-deploy ledger on the Morning tab (`quickDeployLedger`, `snareLedger`): each
  prepared snare ready or deployed (pf2e's own `expended`), a giant or broad mark where the character holds Giant Snare or
  Broad Snare (registry `quickDeploy`; `flags.MOD.quickDeploy.<pool>.<hash>`), each costing two slots, the slots used and any
  excess; "Deploy" expends the entry through pf2e's own `CraftingAbility#toggleFormulaExpended(index, true)`, the call its
  sheet's expend toggle makes, and makes no item (M9 review: pf2e's `craft` returns nothing for a snare). The toolkit stays M1's
  G7 (`snareToolkitIsArtisans`).
- **Gadgets**: the inventor class has access to uncommon gadgets (registry `inventor@class`, `craftUnlock access`); keyed
  apart from the Inventor skill feat, whose slug it shares, so a class item no longer reads as that feat. Gadget Specialist's
  daily gadgets were M7's pool already; no feat is needed (G4).
- **Settings** (14.1, 14.2): `features.tattoos` (W, on), `rules.tattooSubjectLocked` (W, on), `rules.tattooHealingDays` (W, 30).
- **Registry** (6.11): effect kinds `crafterMark`, `investitureExempt` and `quickDeploy`; entries `legendary-tattoo-artist` (off
  the ignore list, where it was "combat") and `inventor@class`; `tattooed-historian-dedication`, `giant-snare` and `broad-snare`
  gain effects: 286 entries, 1166 ignored UUIDs, validated against the pf2e dev head `be4ab21b` checkout.
- **API** (11.2): `crafts.{consent, withdrawConsent, tradition, recordHealing, compose, sweep, snareMark, deploy}`;
  `orders.request({..., subject, replaces})`; `pledges.pledge` and `pledges.buy` take `entry`.
- **Review fixes made in the pass**: `batchMax` compared `productFacts`' spellcasting object with a string, so a scroll batch was
  never held to its castings (now read either way; a plan before any pledge counts the order's own quantity); a consent refusal
  named `locked`, which the coin moves also use as a transport reason and would have been worded as a subject's lock
  (`subject-locked`); `RequestForm` kept its fields in a class field named `state`, shadowing ApplicationV2's own render state
  (now `draft`; the screenshots tool follows); a crafter with no single tradition was listed as blocked for every fulu in the
  request form and the Queue's "can make it" (the tradition is chosen after accepting).
- **After the M9 review** (one pass; every high and medium finding fixed, each with a test that fails on the code before it,
  shown by running the new tests with that one fix taken out: `test/logic/spell-lists.test.mjs`, `test/foundry/m9.test.mjs` and
  `ui-m9.test.mjs`):
  - No spellheart could pass G9: the cantrip each one casts ("You cast @UUID[gale blast]") is an entry at the spell's own rank,
    which refused any cantrip. Such an entry takes the spell as it is; a cantrip's casting is recorded at rank 0 (`castingRank`)
    and has no service price (`cantrip-service`).
  - "Deploy" always failed after expending the slot: pf2e 8.6.1's `craft` returns null for a snare (gap 23). It uses pf2e's
    `toggleFormulaExpended` and makes nothing; the stubs now return null for a snare as pf2e does.
  - Specialty wands named "(9th-rank)" or "(2nd-Rank)" (98 in pf2e) had no rank, so took any spell at its own rank's price:
    the name reads any "(Nth-rank)" with or without "Spell".
  - Staff lists written `<li><p><strong>…</p></li>` or as bare `<p><strong>1st</strong> …</p>` lines (33 staves) were not read,
    so G9 asked for one casting of anything: both are read.
  - Craft Requirements that put the rank before the link ("8th-rank @UUID[harm]") took the spell's own rank: read as
    `parseCastSpells` does. A corpus test (with `PF2E_SRC`) now reads every spell-supplied item in pf2e and pledges each listed
    casting with its own spell.
  - A decorative or healing tattoo stayed magical and investable on pf2e's sheet, which applied it and counted it while the
    module did not (above).
  - A subject's sitting days read "Sitting for {item}" on the day card and in the wizard: `Days.Subject`.
  - Agreeing replaced the subject's activity without a word and claimed its unresolved days (above).
- **Live plans** (15.3 scenario 14; `tools/harness/craft-scenarios.mjs`, scenario `m9`; `live-plans.mjs`; every Craft check rolls
  a fixed 15, `M9_FACE`, so each plan checks what the finish makes):
  - `m9-tattoo` (GM, P2): the rogue tattoo-artist fixture tattoos Player Two's character (Eye Slash); G10 waits; Player Two
    agrees and sits for it in downtime, and cannot leave it; the Craft runs, the process frozen; Player Two's client collects it healing and
    uninvested, records healing, and invests it once a logged day passes; the GM reads the same.
  - `m9-simple` (GM, P2): the simple toggle: consent with no lock, delivered invested.
  - `m9-graft` (GM, P2): the cleric fixture, given Graft Technician and expert Medicine, implants Bioluminescent Stripes: G6
    wants the formula; Medicine; with Player Two's invest limit at zero it is inactive, and invested once the limit rises.
  - `m9-fulu-missive` (GM): the fighter crafter's fulus wait for a tradition, take divine, come four to a batch with a year's
    stamp; its two missives are made blank, and one is composed on its own.
  - `m9-staff` (GM): Staff of Fire by the fighter crafter; the wizard fixture's Electric Arc, which the staff does not list, is
    refused; it offers Ignition (once: a second offer is refused) and Breathe Fire, each naming its entry; G9 passes once both
    are cast.
  - `m9-snares` (GM): the ranger fixture prepares two Alarm Snares, both ready, in its snarecrafter pool; with Giant Snare one is marked
    giant (three slots used); one is deployed through pf2e's expend toggle, once.
  - `m9-gadget` (GM): the inventor fixture may craft an uncommon gadget (G4, G5); the fighter crafter, without the class, is
    held back by G5 alone.
  - `m9-shots` (GM, P2): the Queue's tattoo detail as Player Two, 1440x900 and 1024x768, dark and light (`--shots`).

#### M9 live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, regression with and without a canvas)

One pass at `d420496` (M0-M9), then once more after the fixes below:

- **Audit first.** Before the first run, every plan was read for a branch that passes on nothing. Five did: `m9-tattoo`,
  `m9-simple`, `m9-graft` and `m9-fulu-missive` checked what the finish made only `if` the Craft check succeeded (the tattoo's
  check even accepted "failed"), so a failed roll passed them with every later check skipped; `m9-staff`'s "both entries are
  named and cast" was an `every` over pledges read through M5's brief, which carries no entry (true on none, false on two);
  and `m9-gadget` would pass for any common item, since nothing showed that a crafter without the class is held back. The
  harness was fixed (15.3): `run` rolls at a fixed die (`withDie`, `M9_FACE` 15) and each crafting plan checks that its
  order completed; `m9-staff` reads the pledges through M9's brief (`order`), wants two distinct entries (Ignition's cantrip
  entry and Breathe Fire's `@1`), and checks that Electric Arc, which the staff does not list, is refused (`not-on-list`)
  and that Ignition cannot be offered twice; `m9-gadget` files the same gadget for the fighter crafter and checks that G5,
  and not G4, holds it back; `m9-tattoo` checks that Player Two cannot leave downtime while sitting (`subject`), and
  `m9-fulu-missive` composes one of the two missives. The new tests (`harness-m9.test.mjs`, "After the M9 live pass") run the
  plans over a fake harness and fail on the plans as they were.
- **M9 plans** (`--runs 1`, no canvas): `m9-tattoo`, `m9-simple`, `m9-graft`, `m9-fulu-missive`, `m9-staff`, `m9-snares`,
  `m9-gadget` and `m9-shots` pass, 58 checks, every Craft check a critical success at the fixed die. The first run failed `m9-tattoo`'s healing (the `heal` step was called
  without the order and picked the first item whose missing subject record "matched" an undefined order: the character's
  ancestry; the plan now passes the order and the step refuses without one) and `m9-simple`'s new "no healing" check (it
  wanted `until` null; the simple toggle's record has `until` equal to `from`). The second run found `m9-snares` would fail
  on any run after the first: pf2e keeps `expended` on a prepared entry, the reset does not touch pf2e's pool, so a slot an
  earlier run deployed came back spent; `snares` now takes the snare out of the pool before preparing it, and the plan
  checks both slots are ready. Console: no error or warning on any client; the notifications are the subject's
  (`Subject.Settled.Invested`, `Subject.Settled.Inactive`, with their item and name) and Player Two's day prompt after the
  logged day. No slow server answers, no dry-run replays.
- **Regression** (`--runs 1`): with `--canvas`, `m8a-strike`; without a canvas, scenario 7, `m8-turn`, `m7-morning`,
  `m6-income` and `m4-lifecycle` pass. Console errors: scenario 7's expected ones (15.3), pf2e's page error at the encounter's
  deletion without a canvas (`m8-turn`) and `m6-income`'s second device's "already exists" (M8 live pass). The first
  regression run was stopped and run again: the hands-on pass's first clean-up had failed (core 14 refuses `ownership.-=id`)
  and left four fixtures in the party, owned by Player One; `m8a-strike` passed on both worlds.
- **Found and fixed** (with a test that fails without it; `ui-m9.test.mjs`, "after the M9 live pass"):
  - *A finished tattoo's subject still read as sitting for it* (medium; the hands-on pass). The Queue's Subject section said
    "has agreed and spends their downtime sitting for it" on a complete (or cancelled) order, after the lock had ended. It
    says "has agreed." once the order is closed.
- **Hands-on pass** (a scratch Playwright script, no canvas, the GM and both players online; real clicks, selects and keys
  in the windows; setup through the harness: Player One made owner of the tattoo-artist, cleric, wizard and ranger fixtures
  and the four put in the party for the pass, so "Acting as" offers them (taken out and the ownership removed after); the
  cleric given Graft Technician, expert Medicine and Bioluminescent Stripes' formula, the artist Eye Slash's; the die fixed
  at 15 on Player One's client for the Craft checks; Player Two's character is the fighter-crafter fixture):
  - *Tattoo.* Player One opens the Workshop from the Actors directory, acts as the tattoo artist, clicks Request, types
    "Eye Slash" and picks it: the form asks "Made on" ("The character who receives it. They agree from the Queue before the
    work starts."), with no quantity; Player One picks Player Two's character, the artist as requester and crafter, and
    files it ("1 orders filed."); naming the crafter accepted it. Player Two opens the order: "Subject has agreed and is
    present: The subject has not agreed yet." with Agree among the requirements, and in the Subject section "Waiting for
    ... to agree.", "Process: Full process. One at a time per crafter.", "invests 0 of 10 items". Agree asks "Agree and sit
    for it?" (the sitting, no other activity, no leaving downtime, withdrawing only before the start or after a failure);
    Yes: the Downtime tab shows the character in downtime "Sitting for Eye Slash until it is finished", the activity chosen;
    End downtime is refused ("This character is sitting for a tattoo or graft. Withdraw before it starts, or wait until it
    is done."). Player One clicks Fund this order (pays 10 gp from their own character's purse, Fill the shortfall), Start,
    Work a day, Roll (pf2e's check dialog: a critical success), Work a day and Finish (7 gp more). On Player Two's client the
    tattoo is on the character, worn, uninvested, "healing · healing until day 109" with Record healing; the click ends it
    the next day. The GM clicks Advance days on the Downtime tab and goes through the wizard (1 day, Resolve these days);
    Player Two's client invests the tattoo: "Eye Slash: invested · healing recorded on day 79", "invests 1 of 10 items".
    The Subject section still said the subject "spends their downtime sitting for it" on the complete order (fixed above;
    after the fix, "has agreed."), and the wizard's day for the subject said "This character is no longer the subject of that
    order" (Follow-ups).
  - *Graft.* Player One acts as the cleric and requests Bioluminescent Stripes the same way, made on Player Two's
    character; Player Two agrees (the same dialog); Player One funds 5 gp, works, rolls (a critical success) and finishes. On Player
    Two's client the graft is implanted and invested at once ("Bioluminescent Stripes on ... now works: it is invested."),
    "Process: Graft.".
  - *Staff.* Player Two requests "Staff of Fire" for their own character, which crafts it (the search's first match is the
    Greater staff, level 8: six listed castings). Player One, acting as the wizard, opens it: "Spell item: 0 of 6 castings
    done." and each listed casting with its rank, "Needed". "Offer a casting" lists only the wizard's spells the staff lists
    (Ignition as a cantrip, Breathe Fire at ranks 1 and 2); Player One offers Ignition, and the next dialog no longer offers
    it; then Breathe Fire at rank 1; marks both cast ("Mark the casting done", no cost). Both entries read "cast", "2 of 6
    castings done", on Player Two's client too, with the staff's G9 still unmet.
  - *Snare.* The ranger's snarecrafter pool holds two prepared Alarm Snares (setup, pf2e's own `setFormulaQuantity`). Player
    One picks the ranger on the Morning tab: "Other prepared slots: Snarecrafter", "2 of 4 slots used", "0 deployed, 2
    ready", each snare Ready with Normal or Giant and Deploy; Giant on the first makes it "3 of 4 slots used"; Deploy: "1
    deployed, 1 ready", that snare "Deployed · costs 2", expended in pf2e's pool. The tab first showed the previous acting
    character, not the ranger (Follow-ups).
  No raw key, unfilled placeholder, `undefined` or `NaN` in any window, dialog or notification the script read on any
  client; no console error from the module (core's no-canvas `cycleTokens` page error when the clean-up changed the
  fixtures' ownership with the players online).
- **Screenshots**: `tattoo.png` (the Queue as Player One, whose Ilsa is asked to agree to Doran's Eye Slash: the order's
  row and its detail scrolled to the requirements and the Subject section with Agree; `stageTattoo`, which gives Doran
  Tattoo Artist and the formula) is linked from the README after `queue-light.png` (17.1); every capture taken again (the
  tattoo order is a sixth order in the Queue's list, below the fold in `queue.png`).

#### Follow-ups (M9, low)

- The rapid fulu option is not offered (DECISIONS.md); a table that wants its one-month fulus marks them by hand.
- Unlinked spell names in Craft Requirements ("Supply one casting of dispel magic", "plus one casting of shillelagh" after a
  staff's list) become one casting of any spell, not that spell; resolving the names against the spells pack would name them.
- A specialty wand that holds its own spell (an arboreal wand's heal) takes any casting of its rank, not that spell.
- Narrative Craft Requirements (a staff's "You're holy", a missive's "trained in Performance to compose") are still not a
  checklist (G9's parse is a follow-up since M4); composing a missive checks nothing.
- The Accepted and Started cards (10.5) do not name the subject or its lock.
- A subject is locked from its consent, so the days before the start are spent sitting too; it may withdraw meanwhile.
- A cancelled or finished order leaves its subject's activity pointing at it; the subject's next days stop at `not-subject`
  until the activity is changed, as a helper's do.
- An upgraded tattoo or graft removes the old one when the new one arrives, though the new one may still be healing.
- Investiture reads `system.equipped.invested`, not pf2e's full `isInvested` (equipped, identified, not stowed).
- Quick-deploy marks are kept by `<uuid>#<n>` of pf2e's prepared list; reordering the list moves a mark to another copy of the
  same snare. Ranger's Survival for snarecrafter feats (6.11 follow-up) is unchanged.
- "Regions with access to inventors" (Guns & Gears) is not a setting: an uncommon gadget needs the formula or the inventor class.
- From the M9 review:
  - A fulu crafter may choose any tradition, even with one of their own, and a choice survives the order passing to another
    crafter (`chooseTradition`, the Queue's dialog, `fuluTradition` prefers the choice): refuse traditions outside the crafter's
    own when they have any.
  - Replacing a tattoo or graft with a different one (Howl of the Wild; altering a tattoo, Secrets of Magic) is not possible:
    `replacePlan` refuses `not-upgrade` outside the same family at a higher level, so the old one keeps counting.
  - G4 skips everything for a gadget, so the eight magical gadgets (Portable Seal, Vanishing Shocker, Nap Gas Dispenser) need no
    Magical Crafting.
  - Craft Requirements offering alternatives ("@UUID[ancestral memories] or @UUID[mindlink]") read as both; the corpus test lists
    the Genealogy Mask (whose first choice is a focus spell) and the Staff of the Ruling Beast (Concordant Choir on its cantrip
    line, not a cantrip in pf2e) as known quirks.
  - `IN_PROGRESS` (logic/crafts.mjs) leaves out `gathering`, which `STARTED` has; a subject order in it would not count for G11.
  - A started tattoo or graft its crafter pauses keeps the subject locked: no withdrawing, leaving downtime or cancelling.
  - Withdrawing consent is a plain write, so it can land beside the crafter's locked start: the order in `setup` with consent
    false. Write it behind the order's log-slot lock.
  - The inactive graft's words say to free an invested item, but only tattoos, grafts and the invest maximum matter
    (`Subject.State.Inactive`, `Subject.Settled.Inactive`).
  - A graft's G6 `needs-formula` has no rarity: "This  item needs its formula."
  - A tattoo or graft request with `features.tattoos` off is refused as `off`, worded as daily preparations being off.
  - The request form's "who can make it" for a graft filters and rates by Crafting, not Medicine (`skillFor`).
  - Once a tattoo or graft order closes, the subject's unresolved sitting days stop at `not-subject` (no day bound on
    `CLOSED`), and the released lock lets them be resolved as another activity.
  - An uninvested or decorative notice is shown on the subject's responsible client, which is the GM's when the player is
    offline; nothing tells the player on their next login.
- From the M9 live pass:
  - A cantrip's offered casting reads "rank 0" in the Queue's list of offers (`Pledge.Line`, with `castingRank` 0), while the
    staff's list of castings above it says "cantrip"; and "1 castings". ("1 castings" fixed in M11, 10.18; "rank 0" stands.)
  - Once a tattoo or graft is finished the subject stays in downtime with its activity on the closed order (above): the GM's
    Advance days wizard then shows "This character is no longer the subject of that order. Choose another activity." for it
    and resolves nothing for that day.
  - The subject's "End downtime" button stays enabled while it sits for a tattoo or graft; a click is refused with a warning.
  - Seen in passing, from earlier milestones: "1 orders filed." (`Request.Filed` has no singular); a finishing order with
    nothing left to take off still offers "Work a day", which is refused (`Refusal.PaidOff`); changing "Acting as" redraws
    the header, Queue and Funds but not the Morning tab, which keeps showing the previous acting character (when none was
    picked on the tab) until it is drawn again; a complete order's row says "Paid 20 gp" where its cost summary says 17 gp
    were spent (a work day covered 3 gp). ("1 orders filed." fixed in M11, 10.18; the rest stands.)

### 10.17 As built in M9a

M9a builds every Treasure Vault (Remastered) crafting variant of 6.16, each behind its own world setting of 14.4, all off
by default (pure parts in `scripts/logic/variants.mjs` with its numbers in `scripts/data/variants.mjs`, and additions to
`complex.mjs`, `materials.mjs`, `progress.mjs`, `craft.mjs`, `orders.mjs`, `downtime.mjs`, `gates.mjs`, `rolls.mjs` and
`defaults.mjs`; Foundry parts in `scripts/foundry/variants.mjs`, `deconstruct.mjs`, `nature.mjs` and `quests.mjs`, with
additions to `products.mjs`, `orders.mjs`, `rolls.mjs`, `outputs.mjs`, `claims.mjs`, `custody.mjs`, `expiry.mjs`,
`settings.mjs`, `sync.mjs`, `api.mjs` and `module.mjs`; the window in `scripts/ui/variants.mjs` and additions to `extras.mjs`,
`request.mjs`, `workshop.mjs`, `downtime.mjs`, `context.mjs`, `chat.mjs`, `labels.mjs`, the Queue, Funds, Downtime, request
and check-card templates and `styles/workshop.css`). Unit tests cover the variant math (`test/logic/variants.test.mjs`, with
the book's vectors), stub tests the Foundry and window parts (`test/foundry/m9a.test.mjs`, `ui-m9a.test.mjs`,
`harness-m9a.test.mjs`); the live plans passed their first live pass (M9a live pass, below). Every number was checked against TV-R pp.157-175 on AoN and
the pf2e 8.6.1 compendium (Deconstruct, Grow, Quick Setup, the GM Screen's "Downtime Events" page).

- **Off costs nothing.** While a variant is off its kinds are refused (`variant-off`), the request drops its fields, its
  catch-up returns at once and schedules nothing (`anyVariantOn`: a sub-setting's default such as `critical.specialOnly` is
  no variant), the window shows nothing of it and nothing is written. `variantsNow`/`variantOn` read the settings each call.
- **One group at a time.** Turning a setting on that mixes groups warns the user who changed it
  (`Settings.Variants.Mixed`), and Settings shows the notice in the module's tab (`renderSettingsConfig`); nothing is blocked.
- **Complex Crafting** (6.16.1): the start form's rush is the crafter's choice before the start (`variant.rushRequest`,
  `chooseRush`), frozen with the plan (`variant.complex = {rush, band, quick}`, `dc.adjust`); the Queue says the setup in words
  ("Setup: 1 day, rushed 1 day (DC +5)"). "Set up now" writes Quick Setup's 2-hour consumable setup as the `setup-hours`
  record behind the lock pages `setup-hours:<id>:<attempt>` and `setup-day:<actorId>:<day>:<n>`, so it is recorded once, beside
  the crafter's own day record, at most 8 hours a day; any other setup of hours is the crafter's day record on the order,
  written by the day planner (review fix). The rushed finish is an
  order toggle (`variant.rushFinish`) that each finishing day captures (`rushed`, twice the crafter's reduction, helpers not
  doubled); the finish rolls the flat check once per attempt (`check.rushFlat = {attempt, dc, die, degree, outcome}`, a d20
  card; DC 1 or lower is no roll, DC 21 or higher can at best fail), so a finish refused for money rolls nothing again. A
  failure delivers with `flags.MOD.quirk`, a critical failure ruins (no item, `make` false) or curses by
  `variants.complex.rushCritFail`.
- **Adjustments** (6.16.2): the request form lists the adjustments that fit the base item (by usage: armor, shields,
  weapons); one plan for the whole (`adjustedPlan`: the summed Price, the highest level, the highest rarity of the parts), each
  part's feats, access and formula folded into G4-G6 by name, G12 `adjustment-fit` for a part that does not fit. The finish
  makes the host and its parts together, each part's `flags.MOD.appliedTo.host` naming the host; delivery moves the group as one
  shelf entry and remaps the host id on the recipient.
- **Events** (6.16.3): due by worked downtime days (first on day `events.firstDay`, then every `events.everyDays`), rolled on
  the crafter's responsible client (or by "Roll event") behind the lock page `event:<id>:<attempt>:<k>`, recorded at
  `orders.<id>.events.<attempt>-<k>` before its card is posted; a d20 on Table 5-2 (1-3 link the GM Screen's "Downtime Events"
  page), or a draw from the world table named by `events.table`. With `events.pauses` the day planner stops at `event-due` and
  `event` until a member resolves it.
- **Critical Crafting** (6.16.4): settlement stamps `check.critical = {kind, natural, mode, category, note}` when the trigger
  fires (natural or any; special items only by default; "Special" is the requester's or crafter's toggle before the start);
  `replace` mode settles a critical with the money of a plain success or failure (`moneyDegree`: no 10% ruin, no higher
  rate). The crafter records a category and note; the crafter's curse is an effect (`artisans-workshop-crafter-curse`, a status
  penalty to Crafting) that the next critical success at a Craft check lifts, or its owner deletes after a 4th-rank cleanse
  affliction. Secret rolls are pf2e blind rolls (`messageMode: "blind"`, review fix) while a GM is
  connected: players read "rolled (secret)" in the Queue and on the card until it settles or a GM reveals it.
- **Deconstruct** (6.16.5): `craftType: "deconstruct"`, quantity 1, its target a physical item whose holder is the recipient;
  its gates (6.16.5: level, rank, feats, the workshop checklist, no consumables, artifacts or cursed items); 1 day, no Price, the check
  through `action:deconstruct`. A success turns the item into components (renamed, inert, unequipped and uninvested,
  `flags.MOD.components = {valueCp, rawCp, purpose, ...}`, expiring after `deconstruct.expiryDays` when set); a similar
  purpose's day becomes the named follow-on's first setup day when the check settles (a non-undoable `deconstruct` event). A
  critical failure damages the item: a retry needs a repair since, or accepts another 5% loss. Components go into an order as
  materials (one per order) at the similar share when the follow-on is confirmed similar, else raw; their excess over the
  up-front half reduces the remainder; a Craft's money critical failure ruins 10% of them.
- **Grow** (6.16.6): `craftType: "grow"`, the formula required, the grow-tools checklist (G7), 4 days, the skill by
  `natureCrafting.skills` (Crafting, Nature, or Nature with every other Craft on Arcana). Untended after a success; season
  checks come from the core calendar's seasons when it defines them, else every `natureCrafting.seasonDays` days, prompted on
  the crafter's responsible client, rolled by the crafter's owner, recorded once a season (`season:<id>:<n>` lock) as a
  `season` record whose day of Income reduces the remainder.
- **Gardens** (6.16.7): `gardens.<id>` in the ledger; the add button refuses past half the party's PCs; members pledge from
  their purse or earmark from the fund; the change that completes the seed cost plants it on that writer's responsible client
  (pro rata `plant` rows behind `plant:<id>`); one harvest a day per garden (`harvest:<id>:<day>` lock), created by the
  harvester's own client, temporary, with a `world` stamp ending that day. The Downtime tab lists today's harvests, the Funds
  tab the gardens with their funding.
- **Gifts** (6.16.8): "Bestow" on a held item (or `variant.bestow` on an order, set at delivery) writes `flags.MOD.gift`; held
  by anyone but the bound actor or an heir, its use is cancelled with a notice (the inert guard's `preCreateChatMessage`).
  The Funds tab lists the party's gifts with their Price.
- **Quests** (6.16.9): `craftType: "quest"`, quantity 1, no coins and no downtime activity; it starts in `gathering`; any member
  marks a component found; the crafter's responsible client moves it on once all are found, to `check` when an assembly check
  is needed, else delivered behind the order's log slot and `assemble:<id>:<attempt>`, so it leaves `gathering` once. The
  assembly's failure delivers with a quirk, its critical failure destroys it or curses it by `quests.critFail`. The Queue
  shows the equivalent cost against treasure, the per-encounter reduction and the Table 5-3 budget.
- **Settings** (14.4): every key of the table, registered with its default; the public API's `variants` namespace (11.2).
- **After the M9a review** (one pass; each fix with a test that fails without it): the catch-up was scheduled after every
  ledger change while every variant was off, and an order's variant note still showed, because `critical.specialOnly`'s
  default counted as a variant on (`anyVariantOn` now); "rushed 1 days" (`Variant.Rush.RushedOne`).
- **After the second M9a review** (one pass; each fix with a test that fails without it, proven by reverting it):
  - Secret checks were never blind on pf2e 8.6.1: its `Statistic#roll` reads `messageMode` only, so `rollMode: "blindroll"`
    fell back to the user's own chat mode; now `messageMode: "blind"` (6.16.4).
  - Event and rushed-finish cards and world-table draws were public on Foundry 14, whose `Roll#toMessage` and
    `RollTable#toMessage` apply the user's chat mode when given none; now `messageMode: "gm"` with the whisper list (6.16.3).
  - A critical failure always failed the order; now its record can make the item anyway (`made`, by default for the
    categories whose example makes it), before the settlement (as a success) or after it (the undoable `made` transition),
    with the record on the item as `flags.MOD.curse`; a secret one reads as a success to players (6.16.4).
  - Any setup of hours could be recorded on any day, any number a day; now only Quick Setup's 2-hour consumable setup, 8 hours
    a day at most, and a 4-hour setup takes the crafter's downtime day (6.16.1).
  - Coins funded to a Deconstruct or a quest were stranded once it completed; both now refuse funding (`moneyless`).
  - Garden money could not be taken back and could overfund the seed cost; now `withdrawGarden` (Funds tab and API) and the
    `over-seed` cap, behind the garden's slot (6.16.7).
  - Taking back the "similar" confirmation after the start left the up-front half underpaid; it is frozen with the commit (6.16.5).
  - Switching a variant off mid-order stranded a setup of hours and a quest under way, and dropped the rushed finish's flat
    check; the frozen order now decides (6.16.1, 6.16.9).
  - Adjustments were made by the setting at the finish, not the Price at the start; now `variant.adjusted` (6.16.2).
  - A Deconstruct's damage lived on the order only, so cancelling and filing again shed it; now on the item too (6.16.5).
  - The 10% a critical failure ruins of a components line stayed on the item, so it came back whole on a cancel; now taken off
    the item's credit in the same request (6.16.5).
- **Live plans** (15.3 scenario 13; `tools/harness/variant-scenarios.mjs`, scenario `m9a`, with M9's `m9` steps; `live-plans.mjs`),
  first run in the M9a live pass (below):
  - `m9a-notice` (GM, P1): Complex Crafting then Grow: the GM is told once, Player One is not, Settings shows the notice.
  - `m9a-complex` (GM, P2): Player Two's fighter rushes a Cloak of Feline Rest without its formula to 1 day at +5 DC and rushes a
    finishing day (flat DC at most 1: no die); the legacy alchemist fixture rushes Alchemist's Fire (Lesser) to 4 hours (Set up
    now refused, Work a day records it), rushes a finishing day and rolls the DC 4 flat check once (at a natural 1 since the M9a
    live pass: ruined, the order complete with nothing made, the Queue saying so).
  - `m9a-quick-setup` (GM, P2): with Quick Setup the cloak takes 4 hours, which Set up now refuses (no adventuring-day setup);
    Player Two's fighter subsists in downtime; a batch of Alchemist's Fire (Lesser) takes 2 hours; the day is resolved as
    subsistence and Set up now records the hours on the same day under their own key.
  - `m9a-deconstruct` (GM, P2): the fighter breaks a Cloak of Feline Rest down for a similar follow-on: G9 waits for the
    workshop; components worth 15 gp; the day is the follow-on's first setup day; handed over, they let it start with no coins.
  - `m9a-grow` (GM, P1, P2): the druid fixture, lent to Player One, grows a Versatile Tinderbox with Nature, untended; with the
    GM gone Player One logs 100 days: one season check, prompted on Player One's client only, rolled once, not by Player Two.
  - `m9a-garden` (GM, P1, P2): a 60 gp garden, the second refused; 40 gp and 20 gp plant it once; both harvest at the same moment,
    one wins; produce temporary with a day's stamp; the next day's harvest.
  - `m9a-quest` (GM, P1, P2): a three-encounter quest; the last two components marked by both players at once; it leaves
    `gathering` exactly once and one cloak is delivered.
  - `m9a-adjust` (GM, P1, P2): a Breastplate with Armor Latches from Player Two's fighter for Player One's alchemist: 12 gp, both
    collected by Player One's client, the latches applied to the breastplate there.
  - `m9a-secret` (GM, P1, P2): a special Elixir of Life (Minor) rolled blind: both players read "rolled (secret)", the GM the
    degree; revealed, the players read it too.
  - `m9a-shots` (GM, P2): the Queue's Complex Crafting detail and the Funds tab's garden, 1440x900 and 1024x768, dark and light.
  - `m9a-off` (GM, P1, P2; added in the M9a live pass): every variant off, M4's lifecycle at a fixed die under a write audit on
    the GM's client: no variant data written; no variant button, section, field or words in the Queue, Funds and Downtime tabs,
    the request form (nor a variant kind) or the lifecycle's chat cards, on any of the three clients; no notice in Settings.

#### M9a live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, no canvas)

One pass at `1b26ae3` (M0-M9a), then once more after the fixes below:

- **Audit first.** Before the first run, every plan was read for a branch that passes on nothing. Five did: `m9a-complex`
  checked the fighter's rushed finishing only `if` the cloak's check succeeded and the alchemist's only `if` the fire's did;
  `m9a-deconstruct` passed a failed check ("a failure leaves the cloak as it was") and skipped every components check;
  `m9a-grow` returned before the season checks on a failed check; `m9a-adjust` returned before the delivery on one; and
  `m9a-secret` never checked that the players cannot read the blind card. Each crafting plan now rolls at a fixed die (`M9_FACE`,
  or `degree: 2` for the Deconstruct, whose components are worth 75% on a success and 80% on a critical success) and checks the
  order got where its later checks look; `m9a-secret` checks the card's content is hidden from both players (the roller too) and
  shown to the GM. A new plan, `m9a-off`, answers "nothing of a variant while every variant is off": M4's lifecycle at a fixed
  die under a write audit on the GM's client (which sees every client's writes), then the Queue, Funds and Downtime tabs, the
  request form and the lifecycle's chat cards on all three clients searched for variant markers and words (15.3). The new tests
  (`harness-m9a.test.mjs`, "After the M9a live pass") run the plans over a fake harness and fail on the plans as they were.
- **First run** (`--runs 1`): `m9a-notice`, `-deconstruct`, `-grow`, `-garden`, `-secret` and `-shots` passed. The rest failed on
  the harness and on one module bug: `m9a-complex`'s alchemist and `m9a-quick-setup`'s batch were held back by G7 (no
  alchemist's lab; the plans now put one in the strongbox); `m9a-adjust` was refused `not-owner` (Player One named Player Two's
  fighter as the crafter, which only the crafter's owner may; the fighter now accepts it in `run`); `m9a-off`'s audit flagged an
  order's own empty `checklist` record and "Something else" (a variant string an activity shares), and read earlier plans'
  cards in the chat log (the audit now flags only the variant checklist keys, drops strings another key shares, and reads only
  the cards posted since it began); and `m9a-quest` found the quest's cloak still on the pickup shelf after Player One's
  collect (fixed below).
- **Final run** (`--runs 1`, after the fixes): all eleven M9a plans pass, 94 checks: `m9a-notice` 5, `-complex` 15, `-quick-setup`
  6, `-deconstruct` 11 (components worth 15 gp at a plain success), `-grow` 10, `-garden` 7, `-quest` 5 (one cloak on Player One's
  alchemist), `-adjust` 5, `-secret` 7, `-shots` 2 and `-off` 21 (46 writes audited, none a variant's; no marker or variant word
  on any client). `m9a-complex` failed once in that run on its own check (a natural 1 on the alchemist's flat check: below) and
  passed when run again with the fixed plan. The notifications are the GM's one `Settings.Variants.Mixed`, Player One's one
  `Variant.Grow.SeasonDue` with its actor and item, and the order cards' status notes.
- **Regression** (`--runs 1`, no canvas): scenario 7, `m4-lifecycle`, `m9-tattoo`, `m8-turn`, `m7-morning` and `m6-income` pass,
  before and after the fixes (in the final run `m7-morning` and `m6-income` could not start: an "Assistant GM" session the
  harness had not opened was connected, so `only` never saw the users it wanted; both passed when run again with no one else
  on). Console errors are the classes 5.4 and 15.3 expect: core's "The _id [...] already exists" toast for the loser of a lock
  race (scenario 7, `m6-income`'s second device, and `m9a-garden`'s two harvests at the same moment, with
  "A parent Document provided to the database operation must be a Document instance" from the same refused request), scenario
  7's injected "does not exist", and pf2e's page error at an encounter's deletion without a canvas (`m8-turn`). No slow server
  answers.
- **Found and fixed** (each with a test that fails without it):
  - *A crafting quest's item never reached its recipient* (high; `m9a-quest`). The assembly's lock-first move took the page of
    `deliver:<id>:<attempt>`, which is also the shelf item's claim key, whose page the recipient's delivery takes: every
    delivery lost its lock (`conflict`, `locked`) and the cloak stayed on the shelf for good. The assembly now takes
    `assemble:<id>:<attempt>` (4.2.3, 6.16.9; `m9a.test.mjs`).
  - *"Work a day" warned after doing its job* (medium; the hands-on pass). The day that settles a Deconstruct (straight to
    `complete`) or a failed Craft check (`failed`) wrote no day record, so `workDay` answered "The order is Complete, so that
    cannot be done now."; it now reports the settlement for any outcome (`m9a.test.mjs`).
  - *A ruined rushed finish read "On its way to ...'s inventory."* for good (medium; `m9a-complex` rolled a natural 1). Under
    `rushCritFail` "ruined" the order completes and makes nothing (as built), but `deliveryOf` waited for a shelf item; it now
    says "Ruined in the rushed finish: nothing was made." (`views.test.mjs`). The plan wanted `failed` there, against 10.17; it
    now checks the order completes with nothing made, and fixes that flat check's die at 1 so the path is taken every run.
  - *"Rushed finish, flat check DC -5: -."* (medium; the hands-on pass): a flat check of DC 1 or lower rolls no die, and the
    detail printed the negative DC and a dash; it now reads "Rushed finish: no flat check needed (its DC was 1 or lower)."
    (`ui-m9a.test.mjs`).
  - *The request form offered coin stacks to deconstruct* (medium; the hands-on pass): Gold, Silver and Copper Pieces were
    listed beside the cloak. pf2e's coins (`isCoinage`, a treasure of the coin category) are left out (`ui-m9a.test.mjs`); the
    gate is a follow-up.
- **Hands-on pass** (a scratch Playwright script, no canvas, the GM and both players online; real clicks, selects and keys in
  the windows; setup through the harness: the fighter given a Cloak of Feline Rest without its formula, an alchemist's lab in
  the strongbox, the die fixed on the roller's page):
  - *Settings.* The GM opens Game Settings, Configure Settings, the module's category, ticks "Variant: Complex Crafting" and
    saves (later "Variant: Deconstruct", then "Variant: Critical Crafting" and "Critical Crafting: secret checks"); each reads
    back on.
  - *Complex Crafting: file and rush.* Player Two opens the Workshop from the Actors directory, clicks Request, types "Cloak of
    Feline Rest", picks it and names their fighter as the crafter ("Who can make it": "no formula (2 setup days)"), and files
    it. The detail's Complex Crafting section says "Setup: 2 days" with "Rush the setup"; the dialog offers "Setup: 2 days" and
    "Setup: 1 day, rushed 1 day (DC +5)" ("Each day rushed raises the DC by 5."); after the choice the section says the rushed
    setup. Fund this order (Fill the shortfall, 10 gp), Start: "SETUP 0/1", the DC frozen at 20 (+5). Work a day, Roll (pf2e's
    check dialog, Roll (+19): a critical success), Work a day (finishing, "8 gp per day", 2 gp left), "Rush the finishing" ("The
    crafter is rushing the finishing: each day takes twice as much off, and a flat check follows the finish.", Stop rushing),
    Work a day, Finish: complete, "Delivered to Fixture 6: Fighter crafter's inventory.", "What it cost: Paid 10 gp up front; 2
    work days covered 10 gp; paid 0 gp to finish; 10 gp spent in all." The flat check line read "Rushed finish, flat check DC
    -5: -." (fixed above).
  - *Deconstruct.* Player Two's request form now offers "Deconstruct"; its item list held the cloak, an Artisan's Toolkit and
    Gold, Silver and Copper Pieces (coins fixed above); purpose "raw materials for any item" or "a new, similar item". Filed with
    the fighter as crafter; the detail asks for the workshop ("The crafter has not confirmed the workshop.", 8 of 9 met);
    "Confirm the workshop", Start (1 day, Price 0 gp, DC 15), Work a day, Roll (a success), Work a day: the order complete, the
    cloak on the fighter renamed "Cloak of Feline Rest (components)", inert, worth 10 gp raw; the Deconstruct card "Cloak of
    Feline Rest is now components: ...", whispered to the GMs and Player Two. The settling Work a day warned "The order is
    Complete, so that cannot be done now." (fixed above).
  - *Secret roll.* Player Two requests an Elixir of Life (Minor) with "Special item" ticked in the request form and funds it;
    Player One accepts, starts, works and rolls (pf2e's dialog). Player One, the roller, and Player Two read in chat "Player One
    privately rolled some dice", "???", and the Workshop's line "rolled (secret)"; the Queue says "Check: rolled (secret)" and the
    detail "rolled (secret)" (Player One also has "Reveal and settle"); the GM reads "Craft DC 15, Result: Critical Success by
    +19", "Check: Critical Success" and "Rolled in secret: the players see the result once it is settled or revealed." The GM
    clicks Reveal: both players' Queue and augment line say "Critical Success"; pf2e's card stays "???" to them (Follow-ups).
  No raw key, unfilled placeholder, `undefined` or `NaN` in any window, dialog, card or notification the script read on any
  client, but core's no-canvas toast below. Saving Configure Settings without a canvas also saves core's performance mode
  (and Workbench's damage-roll setting), whose `onChange` throws without a canvas ("Cannot read properties of undefined
  (reading 'renderer')") and asks to reload; none of the module's settings needs a reload, and the script answered No.

#### Follow-ups (M9a, low)

- A Grow order whose product is the garden (6.16.7, "with Grow on, a Grow order ... plants it") is not built: gardens are
  planted by pledges only.
- The rushed finish is an order toggle the crafter sets, not a per-day choice in the day resolver and the wizard (6.16.1); a
  mixed run is still possible by switching it between days.
- Legendary proficiency for Deconstruct and Grow follows `rules.legendaryItemLevel` (default 17, Player Core p.237); the TV-R
  text says 16 for both.
- A components item's `material-in` row carries 0 cp, as custody's other hand-overs do; its value lives on the order line.
- A damaged item's repair is found only by a Repair service order targeting the same item UUID.
- "Too hard to destroy" (D3) is the `artifact` and `cursed` traits only; the registry has no list for other items.
- The request form still shows a quantity for a Deconstruct or quest (both are refused above 1).
- The pf2e compendium's Deconstruct and Grow actions carry no `rare` trait, though the book calls them rare.
- A precious material stock line is not ruined by a critical failure (since M5); components are.
- Event and rushed-finish cards are plain roll cards with a flavour line; the GM Screen link is in the Queue only.
- The author of a blind roll records its check from a message whose content they cannot see (confirmed live: `m9a-secret`
  and the hands-on pass, M9a live pass).
- From the second review (low, logged, not fixed):
  - The crafter's curse is lifted only by a Craft order's critical success (not Deconstruct, quest assembly or season checks, which
    it also penalises), and by one rolled with Nature or Arcana (not a Crafting check); lift it on any critical success of a check
    rolled with the Crafting statistic instead. With Critical Crafting off, `liftCurse` lifts nothing, so an existing curse stays
    until its owner deletes it.
  - Components deconstructed for a similar item count at the similar share on any later order confirmed similar; the book's
    similar rate is for the named follow-on, and saved components are generic (TV-R p.162). Use `valueCp` only for the follow-on.
  - `CLOSING` lacks `deconstruct` and `assemble`, so `closedAs` and `closedRepair` do not guard a completed Deconstruct or a
    delivered quest against a late status write.
  - Work a day on an order the planner stops at `event`, `event-due` or `setup-hours` says only "cannot be done now"
    (`WORK_STOPS` lacks them), and the Work button still shows for Quick Setup's 2-hour setup.
  - `variantSweep` runs `eventSweep` outside its per-step try/catch, and `rollEvent` does not catch a table draw that throws (a
    player who does not own a table without replacement).
  - A blind Craft roll is marked `secret` with Critical Crafting off (a user whose own chat mode is blind); set it only when
    `secretRoll` applied.
  - A secret check's rate shows through `perDayCp` before it settles (the critical success's higher rate).
  - "Use components" lists components in the strongbox, which `handOver` refuses (`in-strongbox`).
  - Under `nature-arcana` a Deconstruct rolls Arcana while its gates check Crafting; `skillFor` should keep Crafting for it.
  - A deconstructed item stowed in a container is marked worn; only a held or worn item's carry type should change.
  - The Deconstruct card and detail name a similar credit for raw-purpose components too.
  - `seasonOfFor` recounts calendar seasons from the start for each day (days x days calls); `setUntended` resets `since` each
    time it is switched, dropping seasons due and not yet rolled.
  - Undoing a Deconstruct's critical-failure settlement leaves the damage on the item (`flags.MOD.deconstructDamage`), so a new
    order for it inherits damage the undone check no longer says it took.
- From the M9a live pass (low, logged, not fixed):
  - The Deconstruct gates (`deconstructGates`) do not refuse a coin stack; only the request form's list leaves coins out now, so
    `api.orders.request` can still file one. Carry `coin` in the item facts and refuse it as D3.
  - A Deconstruct's detail and the request form's "Who can make it" carry Craft-only text: "Per extra day 6 gp", the Work days
    rule about extra days, "0 days at 8 gp", and "What it cost: ... 0 work days covered 0 gp".
  - Counts not made singular: the check augment's "1 more days to pay nothing more" and the Funds tab's "1 of 1 gardens" (the
    class of "1 orders filed.", M9 live pass). (Fixed in M11, 10.18.)
  - Before a secret check settles, the players' Queue shows the rate it implies ("10 gp per day" for an alchemist whose plain
    rate is 8 gp), so a critical success shows through (the second review's `perDayCp` item, seen live).
  - After a GM reveals a secret check, pf2e's own card stays "???" to the players; only the Workshop's augment line and the Queue
    say the degree.
  - "Rush the finishing" is offered from the start, during the setup days, before there is a check; it is harmless (the toggle
    only counts in finishing days) but reads as if the finish could be rushed now.

### 10.18 As built in M11

M11 builds the integration surface of 10.4, 11.1 and 10.9: the sheet and party entry points, the macro catalogue and its shelf,
the keybinding, the theming pass and the accessibility pass, and fixes the UI lows of M4-M9a that were cheap and safe. Unit
tests over pure parts (`test/logic/macros.test.mjs`), stub tests over a small DOM and a faithful ApplicationV2
(`test/foundry/dom.mjs`, `test/foundry/ui-m11.test.mjs`), the stylesheet's contrast (`test/theme.test.mjs`) and the
copy-paste macros (`test/macros.test.mjs`); live plans `m11-*`, which passed their first live pass (M11 live pass, below).

- **Character sheet** (`scripts/ui/entry.mjs`): a "Workshop" header button through `getCharacterSheetPF2eHeaderButtons`
  (pf2e 8.6.1's sheets are Application V1) and the same control through `getHeaderControlsCharacterSheetPF2e` (the hook an
  ApplicationV2 sheet will fire, OQ-30); it opens the Workshop acting as that character. In `renderCharacterSheetPF2e` (the
  html normalised from jQuery or an element, `elementOf`), for a member the user owns, one `section` is prepended to
  `.tab.crafting.crafting-pane`: the character's orders being crafted, how many wait on its roll or settlement, open orders
  filed for it (a gift hidden from it is not counted), its items on the pickup shelf, its downtime days to resolve, and whether
  a rest left it waiting to prepare (`stripView`, `scripts/logic/entry.mjs`), with Workshop, Request and Morning buttons. The
  strip holds no `li`, no `.formula-item`, no `data-item-*` and no `data-action` (its buttons carry
  `data-pf2e-artisans-workshop-entry`), so pf2e's sheet listeners, PF2e Toolbelt's sort buttons (prepended to the formula
  headers) and PF2e Workbench's rarity classes (`h4` inside `.crafting-pane .formula-item`) never reach it. A sheet without the
  tab, a character the user does not own or one outside the party gets no strip; the header button stays.
- **Party sheet**: the M4 header button, and a card in the Overview region after pf2e's summary: open orders, those waiting for
  a crafter, those being crafted, the finished ones, the shelf for the user's characters and the strongbox (`partyCardView`).
  pf2e renders the members' regions again on its own when a member changes (`render(false, {actors: true})`, no render hook),
  so a `MutationObserver` on the region puts the card back. A player for whom pf2e hides the Overview (its `partyStats` off)
  has the header button only. The strip and the card are filled again in place, debounced, when the ledger, the strongbox or
  its items change, the day moves or a preparation lands; those of closed sheets are let go.
- **Actors directory**: "Open Workshop" in the context menu (`getActorContextOptions`) of the party and of each member the user
  owns, the latter acting as that member; it follows the master switch, as the header button does.
- **Keybinding**: "Open the Workshop" (`openWorkshop`), unbound by default, beside M8's Open Bandolier and Quick Alchemy.
- **Setting** `features.sheetEntryPoints` (W, on): the sheet header buttons, the strip and the card; off renders the open
  sheets again without them.
- **Macros** (11.1 As built in M11): the catalogue `scripts/logic/macros.mjs` holds the 23 macros of 11.1, each with its API
  call, its arguments and their defaults, the arguments it needs, its feature and its icons. Every macro is the one line
  `game.modules.get("pf2e-artisans-workshop")?.api?.macros.run(id, {args})` (`macroCommand`), which stops quietly while the
  module or its API is missing. `api.macros.run` (`scripts/ui/macros.mjs`) calls the member with the arguments over the
  defaults and reports the result: a refusal as its sentence, a step already taken (`outcome: "already"`) as "Already done.",
  nothing for an opened window. A run without an argument the macro needs asks for it instead (11.1's "opens the form unless
  every field is given"): the request form, the order's funding prompt (or the open orders), the crafter's one finishable
  order (or the Queue on "mine"), the Downtime or Formulas tab, the Quick Alchemy panel on bombs, or a question (which family,
  which poison, which item). "Advance days" opens the wizard with its days (`openAdvance({count, advanceClock})`; moving the
  clock stays a GM's), "Affix talismans" opens the Morning tab on the affix board. A macro whose feature is off refuses
  `macro-off`. The copy-paste files `macros/<id>.js` hold the same line under a comment naming the call (`npm run macros`
  writes them; `test/macros.test.mjs` holds them to the catalogue).
- **The shelf** (`MacroShelf`): every macro whose feature is on (combat's leave while Duct Tape is active), by group, with who
  it is for, what it does and the call it stands for; Run, and Add to hotbar (the first free slot: the drag's keyboard
  alternative). It opens from the status bar's Macros button (in the window the Workshop is in) and `api.ui.macros()`. A tile
  dragged onto the hotbar (`hotbarDrop`, drag type `pf2e-artisans-workshop.macro`) becomes a world script macro with the
  catalogue's line, the catalogue's name and a Foundry core icon, flagged `flags.MOD.macro = id`; the user's own macro of that
  id is reused, and two drops at once make one. Without core's `MACRO_SCRIPT` (Player by default) the shelf says so, the tiles
  are not draggable and only Run is offered; a drop is refused `no-script`.
- **API** (11.2): `ui.macros()`, `macros.{list(), command(id, args), run(id, args), toHotbar(id, slot), open()}`,
  `orders.postSummary({whisper})` (the open orders as a card: whispered to the poster, a gift named only to those who may see
  it in the Queue, and to nobody on a card for everyone), and `orders.rollCheck({order, actor, skipDialog})`, which without an
  order rolls the actor's oldest order waiting for its check (`nextCheckOrder`).
- **Theming** (10.9, `scripts/ui/theme.mjs`): the client setting `ui.parchment` (Parchment, off) gives the module's windows
  core's `themed theme-light` classes and `paw-parchment`, which lays pf2e's sheet background (`systems/pf2e/assets/sheet/
  background.webp`) under them in either scheme; a change applies to open windows at once. Chat cards take the light tokens
  under a light-themed interface whose body is dark (`.themed.theme-light X` outranks `.theme-dark X`: the M4 follow-up). The
  sheet entries keep the light tokens in either scheme (pf2e's sheets are light). The light focus ring is the module's own
  `#9e3d00` (core's highlight is 2.5:1 on the light panel); `test/theme.test.mjs` holds every text token at 4.5:1 and the
  focus ring and bar segments at 3:1 against the light panel, a dark parchment, the dark panel and a lighter dark ground.
  Labels set no text shadow.
- **Window size** (10.8, `ui.windowSize`, C, hidden): a resize (not a move, not while detached) is saved, debounced, and the
  next window opens at that size, clamped to the screen (`openingSize`).
- **Accessibility** (10.9): the order rows have a context menu (core's, `jQuery: false`) with Open, Fund this order, Pause,
  Resume, Release, Undo and Cancel, each where the row's actions allow it; every one is also in the detail drawer, its
  keyboard path. While the detail covers the list (the medium tier's slide-over, the narrow tier's full view) Tab and
  Shift+Tab stay inside it (`trapStep`, `focusablesIn`, `tierOf`); Escape closes it and gives focus back to its row, as
  before. A tab's tooltip shows only in the narrow tier, where its word is hidden. "Acting as" stays on one line and its
  select holds the whole "Name (level n)" as its tooltip. Unmet requirements carry a hidden "Not met:" and their list a name.
  The Downtime tab's per-PC lines are no longer `role="status"` regions made again on every render, each PC's activity
  select names the PC, and the Start/End downtime button has no `aria-pressed` beside its changing label.
- **Lows fixed** (each marked in its follow-up list): counts of one ("1 day at 8 gp", "Setup 1 of 1 day", "1 casting", "after 1
  Craft", "about 1 minute", "1 of 1 garden", "1 order filed.", "1 more day to pay nothing more", "in 1 round", "1 round"); the
  check augment's days only while the order is `rolled` or `finishing`; the request form's DC column only for those who may
  see DCs; the Formulas routes table's Route column keeps a readable width; "Spent, by source" in a fixed order (the party fund
  first, then by name); the quantity in the detail's heading in the sans font.
- **Not built** in M11, though 10.1 lists them with it: the Workshop's own Settings tab (user and client settings, world
  settings, integrations and conflicts, data tools, "view as player"); the module's settings stay in Foundry's settings
  window. The Party-stash strongbox and the party selector are unchanged (10.10 Follow-ups).
- **Live plans** (15.3 scenarios 8 and 10, `tools/harness/integration-scenarios.mjs`, scenario `m11`): `m11-sheet` (the header
  button, the strip and its buttons, Player Two's own strip, without companions), `m11-companions` (the same with PF2e
  Toolbelt's crafting sort and PF2e Workbench's formula rarity colours on, the module configuration put back afterwards),
  `m11-party` (the card as the GM and Player One, after pf2e renders the region again), `m11-context` (the directory's
  context menu with real right-clicks), `m11-shelf` (real drag and drop onto the hotbar twice making one macro, Add to hotbar,
  the slot running the macro), `m11-macros` (every catalogue macro once: none errors or shows a raw key, the ones that ask
  open what asks, Roll Craft check with no order rolls the waiting one), `m11-keys` (the keybinding bound for the plan opens
  the Workshop), `m11-keyboard` (a keyboard-only walkthrough: the keybinding, the tabs by arrows, the row's tab stop, the detail
  by Enter, Tab trapped in the medium tier, Escape back to the row, the Macros button and Add to hotbar by Tab and Enter, and an
  audit of names, tab indexes and tab lists), `m11-themes` (no text below its contrast in the dark and light schemes and with
  Parchment) and `m11-shots` (the strip, the card and the shelf, dark and light). The M11 live pass added `m11-keyboard-gm` and
  made `m11-context` need `--canvas` (below).
- **Screenshots** (17.1): `macro-shelf.png` and `sheet-strip.png` (`screenshots.mjs` opens the shelf from the status bar and the
  demo alchemist's sheet on its Crafting tab) were checked by eye and linked from the README in the M11 live pass.
- **After the M11 review** (each with a test in `test/foundry/ui-m11.test.mjs` or `ui-m8.test.mjs` that fails without it):
  - *Keys stop at the module's windows.* Core's `KeyboardManager` listens on the browser window and runs a keybinding
    whenever focus is not in a field (`hasFocus`: an input, a select, a text area, editable content or a button inside a
    form). An order row (`li`), a tab or a button of a formless window is none of these, so Space on a focused row also
    paused the game for a GM (and broadcast it), an arrow panned the canvas, and Tab (core's `cycleView`) cycled the
    controlled token, recentred the view and cancelled the browser's own focus move, which also changed the actor that
    `actorFor` resolves for macros. Every key the Workshop answers (the rows' arrows, Home, End, Enter and Space, the trapped
    Tab, the tabs' arrows, Escape) is now consumed (`consumeKey`: no default and no propagation), and so are the Quick Alchemy
    panel's list keys. Tab, Space and Enter on any control of a formless module window (the Workshop, the shelf, the Advance
    days wizard, the Afflictions window, the Bandolier, the Quick Alchemy panel) stop at the window (`keepControlKeys`),
    unless Ctrl, Alt or Meta is held; other keys stay core's. The request form is a `form`, which core already treats as a
    field, and the HUD palette already stopped its Enter and Space (`onEntry`).
  - *The master switch renders the open sheets again.* `renderEntrySheets` (`settings.mjs`) renders every open character
    and party sheet in `ui.windows`, for `features.sheetEntryPoints` as before and now when the Workshop's status crosses
    "disabled" either way, so a sheet open at the switch loses (or gains) its header button, strip and card at once instead
    of keeping live buttons and a strip saying "No Workshop jobs right now".
  - *Windows opened from the keyboard take focus.* `openWorkshop({focus: true})` (and `WorkshopApp#show`) focuses the open
    order's detail, else the active tab, after the render; the keybinding, the strip's and the card's buttons and the
    directory's context menu use it. `openShelf({focus: true})` focuses the first tile's Run; the status bar's Macros button
    uses it. Core focuses only an `[autofocus]` element on a first render, and a raised window not at all.
  - *Focus survives the shelf's and the sheet entries' refreshes.* The shelf keeps the focused control across a render
    (`_preSyncPartState`/`_syncPartState` with `focusState`/`restoreFocus`, a tile's buttons told apart by its `data-macro`,
    now one of `focus.mjs`'s scope attributes), so Add to hotbar leaves focus on that tile's button. The strip and the card
    note which of their buttons had focus before a refill and give it back to the new one (the first of theirs if it is
    gone); focus elsewhere is left alone (10.9: live updates never steal focus).
  - *Macro refusals that fit.* Roll Craft check without an order, when the actor has none waiting for its check, refuses
    `no-check-order` ("{actor} has no order waiting for its Craft check.") and Finish order without an order and nothing
    finishable `nothing-to-finish` ("{actor} has no order ready to finish."), not `no-order` ("That order no longer
    exists."), since the user named no order. `refusalText` passes `data.actor` (a name).
  - *Label in name* (WCAG 2.5.3): each PC's activity select in the Downtime tab is named by `aria-labelledby` from its
    visible label and the PC's visible name ("Spending days on Bo"), not by an `aria-label` sentence that did not contain the
    label ("What Bo spends the days on", now gone).
  - *The window's words for money.* The shelf shows macro 3 as "Fund an order" and macro 6 as "Collect waiting items", the
    Workshop's own "Fund this order" and "Collect waiting items", not "Pledge" (the money word M4.1 retired) and "Take
    deliveries"; ids, API names and the copy-paste files are unchanged (11.1).
  - *Parchment on every window.* The request form, the Advance days wizard, the Afflictions window, the Bandolier and the
    Quick Alchemy panel take Parchment's classes in their constructors (`withTheme`), as the Workshop and the shelf did, so a
    window opened while Parchment is on has it, not only one open when the setting changed. The prompts (DialogV2) carry
    no module class and keep the application scheme (Follow-ups).
  - The live plan `m11-keyboard` checks that the keybinding lands on the active tab and the Macros button on the first
    tile's Run with no Tab press, and that focus stays on the tile's Add to hotbar after it; the audit reads a several-id
    `aria-labelledby`.

#### M11 live pass (2026-10-27, Foundry 14.368, pf2e 8.6.1, PF2e Toolbelt 3.59.2, PF2e Workbench 7.7.5, with and without a canvas)

One pass at `a6ccd82` (M0-M11), then again after the fixes below:

- **Audit first.** Before the first run every M11 plan was read for a check that passes on nothing; eight did. `m11-macros`
  counted every rendered ApplicationV2 as a window a macro opened, and core's interface (the hotbar, the sidebar, the players
  list: eighteen instances on a page without a canvas) is ApplicationV2, so "opened what asks" and "the windows that ask"
  could not fail; only the module's windows and core's dialogs count now (`moduleWindows`), and the notifications are also
  searched for an unfilled `{placeholder}`, `undefined` or `NaN`. `m11-party` skipped every card check when the GM had no
  Overview (pf2e hides it only from players). `m11-companions` read Workbench's rarity classes and never checked them, and
  passed a missing card; it now checks both, the card on the GM's sheet. `m11-sheet` took "Orders for this character: 1" as
  "nothing waiting". `m11-keys` could pass on a Workshop already open, and its click at (5, 300) lands on the scene controls;
  it closes the window and blurs focus first. `m11-themes` never opened the shelf it said it audited, nor checked the scheme
  took; `m11-shots` passed a capture with no card. The keyboard walkthrough ran only as Player One without a canvas: it now
  runs as the GM too (`m11-keyboard-gm`, Space on the row instead of Enter) and checks that the pause, the view, the
  controlled tokens and their places are as before (`table`); with `--canvas` it stages `m8`'s marked arena with both
  characters' tokens and, once the Workshop is closed, shows the same Tab and Space do reach core (a token controlled, the
  game paused and unpaused), so "unchanged" can fail. The tests (`harness-m11.test.mjs`, "the M11 live pass") run the plans
  over a fake harness and fail on the plans as they were.
- **First run** (no canvas, Toolbelt and Workbench active): `m11-sheet`, `-party` and `-keys` passed. The rest failed on the
  plans and on one module bug, each found by an audited check: Workbench never coloured a formula (below, a Workbench bug;
  the plan now turns its feats colours on too and puts the companions' settings back); `m11-context`'s right-click landed off
  the screen (the sidebar starts collapsed, 48 px wide, and the party's entry is pf2e's folder of its members: the plan
  expands the sidebar and right-clicks the party's header); `m11-shelf`'s drop on slot 5 hit the Workshop (1060 x 780 at
  1440 x 900 covers the hotbar's middle; the plan moves both windows up first); `m11-macros` found "Advance days" opened no
  window, which then showed up under the next macro's run (fixed below); both keyboard walkthroughs assumed the window opens
  on the Queue, but it opens on the last tab (`ui.lastTab`), so ArrowDown named the wrong tab and every later check failed
  in a cascade (the plan arrows its way to the Queue); `m11-themes` flagged every light-scheme text at 1.1:1 to 2.8:1
  against black: core's light theme lays `ui/parchment.jpg` under a transparent colour, so the audit's walk went on to the
  body, black without a canvas (the audit now takes an image background's mean colour, `imageColours`).
- **Second run** (no canvas): ten of eleven pass, 103 checks; `m11-context` opened no menu at all. pf2e 8.6.1's Request Trade
  entry reads `canvas.tokens.controlled` while core decides which entries to show, throws (a page error), and core renders
  no directory menu for any actor at a table without a canvas. The plan needs `--canvas` now and says it was skipped
  without one (follow-up: pf2e's).
- **Final runs**, all eleven M11 plans each: with `--canvas` (Toolbelt and Workbench active) all pass, 109 checks;
  without a canvas, Toolbelt and Workbench disabled in the world's module configuration (and turned back on afterwards),
  all pass, 102 checks (`m11-context` skipped). With the canvas, Player One's and the GM's walkthroughs left the pause, the
  view (pivot 800, 600), the controlled tokens (none) and the tokens' places as they were; outside the Workshop the same
  Tab controlled a token and moved the view to it, and the GM's Space paused and unpaused. The context menu read "Edit,
  Item Piles: Request Trade, Open Workshop" on the party and "Edit, Export Data, Import Data, Item Piles: Request Trade, Open
  Workshop" on Player One's alchemist, each opening the Workshop. Notifications: "X is on your hotbar in slot n." for each
  drop or Add to hotbar, and the refusals of the catalogue run in words ("There are no days to resolve.", "That character
  does not have the feat for it." twice, "The vials are full." with a canvas). No raw key, unfilled placeholder or page
  error of the module's; no slow server answer.
- **Regression** (`--runs 1`, no canvas, after the fixes): scenario 7, `m9a-off`, `m8-turn`, `m7-morning`, `m6-income`,
  `m5-fund` and `m4-lifecycle` pass, 82 checks. Console errors are the classes 5.4 and 15.3 expect: core's "The _id [...]
  already exists" for the loser of a lock race (scenario 7, `m6-income`'s second device), scenario 7's injected "does not
  exist", and pf2e's page error at an encounter's deletion without a canvas (`m8-turn`).
- **Found and fixed** (each with a test that fails without it):
  - *"Advance days" answered before its wizard existed* (medium; `m11-macros`). `openAdvance` rendered the wizard without
    waiting, so `api.macros.run("advance-days")` resolved with an unrendered window, a caller closing windows after it
    missed it, and a second quick run found no instance to close and rendered another window under the same id. It awaits
    the render now (`ui-m11.test.mjs`, a render that takes a turn of the event loop).
  - *The shelf's call line ran out of its tile* (medium; the shots and the hands-on pass). Core's `code` is an inline block
    with `white-space: nowrap` (and `word-break: keep-all`), so `overflow-wrap: anywhere` never applied and a long call ran
    under the buttons or past the tile's edge. The line is a block that wraps (`theme.test.mjs`).
  - *The driver gave every page the stylesheet twice* (harness). Foundry 14.368 loads system and module styles as `@import`
    rules in a `<style>` element (`templates/views/layouts/main.hbs`), not `<link>`s, so `ensureStyles` found no link and added
    one, and every run reported `styleAdded` for every client (10.10's "world launched before `module.json` named it" was this
    misreading). It reads the page's style sheets and their imports now (`styleLoaded`); the last runs added nothing.
- **Hands-on pass** (a scratch Playwright script, `--canvas`, the GM and Player One online, real clicks and keys as Player One;
  setup through the harness: an alchemist's lab in the strongbox, the alchemist's Elixir of Life (Minor) at its Craft check):
  a click on the Actors tab expands the sidebar; a click on the alchemist's name opens its sheet, whose header holds one
  "Workshop" button, which opens the Workshop acting as the alchemist on the Queue; the Crafting tab shows the strip first
  ("Crafting: 1", "Waiting on your roll or settlement: 1", "Orders for this character: 1", Workshop, Request, Morning): its
  Workshop opens the window acting as the alchemist with focus inside, Request opens the request form with the alchemist as
  requester, Morning opens the Morning tab; the party's sheet (pf2e's file button in the directory) has one header button and
  the card after the summary ("Open orders 1, Waiting for a crafter 0, Being crafted 1, Complete 0, On the shelf for you 0,
  Strongbox 1 gp 5 sp"), whose Workshop opens the window; right-clicks on the party's header and the alchemist's name show
  "Open Workshop", each opening the window; Alt+Shift+W (bound for the pass) opens it with focus inside; the status bar's
  Macros opens the shelf, the Workshop minimised by a double click on its title, the "Post queue summary" tile dragged onto
  the first slot the windows leave visible (slot 1) makes the flagged world script macro, and a click on the slot whispers
  the queue card to Player One ("Open orders: 1 ... #1 Elixir of Life (Minor) x 1 ... Ready to roll"). No raw key,
  placeholder, `undefined` or `NaN` in any window, strip, card or menu; the module's stylesheet came from Foundry, not the
  harness. Only core's no-GPU warnings in the console.
- **Screenshots** (`npm run screenshots`): all thirteen captures taken again and opened; the shelf's call lines wrap, and
  `macro-shelf.png` and `sheet-strip.png` moved from `NEXT_CAPTURES` to `CAPTURES` and the README.

#### Follow-ups (M11, low)

- The rows' context menu is core's, which has no keyboard navigation of its own; keyboard users take the detail's buttons.
  With `fixed: true` it is placed in the main window, so a detached Workshop's right-click menu may open in the wrong window.
- The strip and the card count; they do not list the orders, nor say which order waits on the character (the Workshop does).
- `macros.run` with `uuid` given files the request at once with the other fields' defaults (the API's behaviour since M4); 11.1
  says the form opens unless every field is given. A macro that wants the form prefilled calls `api.ui.requestForm(uuid)`.
- `income.start` takes no `settlement` or `lengthDays` (M6 follow-up) and `consumables.useBest` no `target`, so the catalogue
  leaves them out of macros 10 and 20; "Advance days" takes no `actors` (the wizard's Who step chooses).
- A macro run reports refusals; a run whose API call throws reports `macro-error` and logs the error, so a bug behind a macro
  shows as one notice.
- Parchment's background and colours are fixed light: a dark sheet look (pf2e has none) is not offered.
- The Settings tab of 10.1 (with its data tools, among them releasing a stuck log slot, 10.10 Follow-ups) is not built.
- `ui.lastTab` is still written on every tab change, one user-document write each (M4 follow-up).
- From the M11 review (low, logged, not fixed; the mediums are fixed above):
  - Every party actor gets the card, the context-menu entry and the header button, not only the Workshop's party
    (`game.actors.party`): pf2e 8.6.1 supports several parties, and an inactive party's sheet shows the active party's
    orders, shelf and strongbox as if they were its own. With the members setting "party", add them only for
    `actor === game.actors.party`.
  - The strip's facts are `li.strip-fact` in `ul.strip-facts`, though 10.18, the `entry.mjs` header and the M11 commit say
    the strip holds no `li`. Harmless with today's selectors (pf2e's `li.formula-item`, `li[data-item-id]`, `li[data-uuid]`,
    `ul[data-loot] li[data-item-id]`, `.item-list .item`; Toolbelt 3.59.2's `.known-formulas > header`; Workbench 7.7.5's
    `.formula-item`), but the claim should read "no `li.formula-item`, no `data-item-*` or `data-uuid`", or the facts be
    `span`s. The list's `aria-label` repeats the section's heading; drop it.
  - The party card's heading id is fixed (`pf2e-artisans-workshop-party-card-heading`), so two open party sheets repeat an id
    and `aria-labelledby` may name the other card: add the party's id. The shelf's rules (`.macro-tiles`, `.macro-tile`,
    `.macro-shelf`) are global class names; scope them under `.macro-shelf-window`.
  - "Add to hotbar" and `api.macros.toHotbar` write to a locked hotbar; core's drop refuses with `HOTBAR.IsLocked`. Refuse
    `hotbar-locked` while `ui.hotbar?.locked`.
  - After a tile is dragged onto the hotbar the open shelf is not rendered again, so its "On your hotbar" badge waits for the
    next render; Add to hotbar on a tile already on the hotbar puts the same macro in another free slot instead of saying
    which slot holds it (`outcome: "already"`).
  - The fund prompt's refusals are reported twice when the Fund an order macro runs it (`fundPrompt`'s `#run` reports, then
    `reportRun`): mark the result reported or return null from that branch.
  - Hints and tiles that say more than happens: Healing Bomb's hint says it throws the bomb, which it does only with
    `target`; Request item's says the form opens unless everything is given, but a `uuid` alone files the order (the 11.1
    follow-up above); the Advance days tile and `macros/advance-days.js` say "Runs api.downtime.advance(...)" while Run opens
    the wizard; Collect waiting items documents an `actor` that `funds.claimAll` ignores.
  - Macro arguments are shown without their types or allowed values ("null means not given"); `order` is the internal id the
    Workshop never shows (its rows say "#12"); `amount`, `route`, `damageType`, `then`, `tab` and `filter` take values only 11.1
    lists; every tile shows its raw `api.x.y({...})` line to every player. Note each argument in the catalogue and the file
    comment, accept "#12" or 12 for `order`, and fold the code line into a `<details>`.
  - With the Workshop switched off, a macro refuses `not-ready` ("The Workshop's shared data is not available right now.")
    rather than saying it is switched off (`Window.Banner.Disabled`'s wording); `macroCommand` writes
    `?.api?.macros.run(`, which throws a TypeError against an API without `macros`: write `?.api?.macros?.run(` and
    regenerate `macros/`.
  - A detached Workshop never updates its tab tooltips on a resize: `_onPosition` returns before `#syncTooltips` while
    `this.window.windowId` is set. Only the size saving should skip.
  - Counts of one still missed: "1 Workshop deliveries or payments are waiting" (`Claims.Waiting`), "regained 1 vials"
    (`Card.Summary.Vials`), "1 formulas" (`Formulas.Total`), "1 batches" and "of 1 batches" (`Morning.SourceSlots`, `Slots`,
    `Planned`). Add the One keys and the counts-of-one test.
  - Unmet requirements are read as "Not met" twice (the list's `aria-label` and each item's hidden prefix): keep one. The
    Queue's order list opens `<ol class="order-list">` and closes `</ul>` (`queue.hbs`, since M4).
  - The prompts (`prompts.mjs`, core's DialogV2) carry no module class, so Parchment never reaches them; they keep the
    application scheme even when opened from a Parchment window.
  - Not verified: PF2e HUD and Token Action HUD are not installed in the dev world and no source is on disk, so whether their
    hotbar or HUD replacements take the shelf's drop or show its macros is untested (13). (The keyboard walkthrough with
    `--canvas` as the GM, checking the pause, the view and the tokens: done in the M11 live pass, `m11-keyboard-gm`.)
  - A refill of the strip or the card gives focus back by its button's `data-pf2e-artisans-workshop-entry`; pf2e's own
    refocus after a sheet render (`_render`, by `data-property` or `data-refocus`) cannot, so a full sheet render still drops
    focus from our buttons to the sheet.
  - The shelf's Run disables its button while the macro runs; a focused button that becomes disabled loses focus in current
    browsers (the focus fix-up rule), so a keyboard user who runs a tile lands on the page. Keep focus there (mark it busy
    with `aria-disabled` instead, or focus it again once enabled). Tab, Space and Enter stopping at the module's windows also
    means a GM cannot pause with Space while focus is inside one (core's own windows behave the same only when they are forms).
- From the M11 live pass (low, logged, not fixed):
  - Without a canvas, pf2e 8.6.1's Actors directory shows no context menu for any actor: its Request Trade entry's visibility
    reads `canvas.tokens.controlled` (undefined without a canvas) and throws, so core renders nothing, "Open Workshop"
    included. The directory's header button and the sheets' buttons still open the Workshop. pf2e's to fix; `m11-context`
    runs with `--canvas` only.
  - PF2e Workbench 7.7.5's "player crafting rarity colour" does nothing on its own: its `renderActorSheet` hook is registered
    only while one of its other sheet settings is on (the condition leaves `playerCraftingRarityColour` out). Workbench's to
    fix; `m11-companions` turns the feats' colours on with it.
  - At 1440 x 900 the Workshop at its default size (1060 x 780) covers the hotbar's middle slots, so a shelf tile cannot be
    dropped there without moving or minimising the window first (Add to hotbar needs neither). Open the shelf beside the
    hotbar's free slots, or say in the shelf's intro that the window can be minimised.
  - The alchemist's own order shows three times in its strip ("Crafting: 1", "Waiting on your roll or settlement: 1",
    "Orders for this character: 1"), all the same order filed for itself; "for this character" could leave out orders the
    character also crafts.
  - The character sheet's "Workshop" header button is core's V1 `<a class="header-button">` with no `href`, so the keyboard
    never reaches it; the strip's Workshop button is the keyboard's way in.
  - The screenshot check's overflow test skips an element whose overflow is visible (`overflowX !== "visible"`), which is
    how a call line running out of its shelf tile looks; compare each text element's right edge with its tile's instead.
  - `sheet-strip.png` crops to the whole Crafting pane, so a third of it is the sheet's empty parchment; crop to the strip
    and the first formula list.

---

## 11. Macros and public API

### 11.1 Macros

Every macro is a one-line call into the API. The API resolves the actor in this order: explicit
`actor` (document or UUID), the single controlled token, `game.user.character`, otherwise a warning.
Delivery: tiles in the macro shelf that a `hotbarDrop` handler turns into world script macros (needs
`MACRO_SCRIPT`, default role Player); copy-paste files in `macros/*.js`; keybindings. No compendium pack.

| # | Macro | Who | Call and arguments (all optional unless marked) |
|---|---|---|---|
| 1 | Open Workshop | anyone | `api.ui.open({tab: "queue" \| "funds" \| "morning" \| "formulas" \| "downtime" \| "settings", actor, filter: "mine" \| "open" \| "blocked"})` |
| 2 | Request item | anyone | `api.orders.request({uuid*, quantity, recipient, crafter, note})`; opens the form unless every field is given |
| 3 | Pledge | anyone | `api.funds.pledge({order*, amount* ("20 gp" or {gp: 20}), from})` |
| 4 | Roll Craft check | crafter | `api.orders.rollCheck({order, actor})`; default: the actor's next order in `check` |
| 5 | Finish order | crafter | `api.orders.finish({order*})` |
| 6 | Take deliveries | anyone | `api.funds.claimAll({actor})` |
| 7 | Morning preparations | owner | `api.prep.open({actor, loadout, apply: false})` |
| 8 | Resolve my downtime | owner | `api.downtime.resolve({actor})` |
| 9 | Advance days | anyone | `api.downtime.advance({days*, actors: "party", advanceClock: false})`; opens the wizard; `advanceClock` needs a GM |
| 10 | Earn Income | owner | `api.income.start({actor, skill*, taskLevel, settlement, lengthDays})` |
| 11 | Learn formula | owner | `api.formulas.acquire({uuid*, route*: "buy" \| "copy-npc" \| "copy-ally" \| "invent" \| "reverse-engineer" \| "grant", actor, from})` |
| 12 | Quick Alchemy | alchemist | `api.alchemy.quickAlchemy({actor, uuid, second, additive, then: "strike" \| "hand" \| "give"})` |
| 13 | Quick Bomb | alchemist | `api.alchemy.quickBomb({actor, family*, damageType, createIfNone: true})` |
| 14 | Quick Vial | alchemist | `api.alchemy.quickVial({actor, damageType: "acid" \| "cold" \| "electricity" \| "fire", material})` |
| 15 | Healing Bomb | alchemist | `api.alchemy.healingBomb({actor, grade: "best", target})`; `"best"` is the highest grade of elixir of life the actor can make with Quick Alchemy (8.6) |
| 16 | Gather reagents | alchemist | `api.alchemy.gatherReagents({actor, minutes: 10})` |
| 17 | Improvise Admixture | alchemist | `api.alchemy.improviseAdmixture({actor})` |
| 18 | Affix talismans | owner | `api.prep.affixBoard({actor})` |
| 19 | Post queue summary | anyone | `api.orders.postSummary({whisper: true})` |
| 20 | Use best consumable | anyone | `api.consumables.useBest({family*, actor, target, partyWide: false})` (8.9) |
| 21 | Apply poison | owner | `api.afflictions.applyPoison({poison*, weapon*, actor})`; injury, contact or ingested poisons; `weapon` is the weapon, ammunition or item to coat, food or drink for an ingested poison (8.10.5) |
| 22 | Expose | anyone | `api.afflictions.expose({item*, targets: "targeted", delivery, dc})`; opens the confirm card (8.10.3) |
| 23 | Roll pending saves | owner | `api.afflictions.rollPending({actor})`; rolls every due save the user may roll, in order (8.10.8) |

All macros are idempotent: a double click returns "already done".

As built in M11 (10.18): every macro is `game.modules.get("pf2e-artisans-workshop")?.api?.macros.run(id, args)`, the line the
shelf's hotbar macro and the copy-paste file `macros/<id>.js` hold; `macros.run` calls the member below with `args` over the
defaults shown, reports a refusal or "Already done.", and without a required argument (*) does what the last column says.

| # | Id | Call and arguments as built (defaults) | Without a required argument |
|---|---|---|---|
| 1 | `open-workshop` | `ui.open({tab: "queue", actor: null, filter: null})` | |
| 2 | `request-item` | `orders.request({uuid*: null, quantity: 1, recipient: null, crafter: null, note: ""})` | the request form |
| 3 | `pledge` | `funds.pledge({order*: null, amount*: null, from: null})` | the order's funding prompt, or the Queue on open orders |
| 4 | `roll-craft` | `orders.rollCheck({order: null, actor: null})`; without `order`, the actor's oldest order in `check` | |
| 5 | `finish-order` | `orders.finish({order*: null})` | the crafter's one finishable order's detail, else the Queue on "mine" |
| 6 | `take-deliveries` | `funds.claimAll({actor: null})` | |
| 7 | `morning` | `prep.open({actor: null, loadout: null, apply: false})` | |
| 8 | `resolve-downtime` | `downtime.resolve({actor: null})` | |
| 9 | `advance-days` | the wizard, `openAdvance({count: days, advanceClock})`; arguments `{days: 1, advanceClock: false}` | |
| 10 | `earn-income` | `income.start({actor: null, skill*: null, taskLevel: null})` | the Downtime tab |
| 11 | `learn-formula` | `formulas.acquire({uuid*: null, route*: null, actor: null, from: null})` | the Formulas tab |
| 12 | `quick-alchemy` | `alchemy.quickAlchemy({actor: null, uuid: null, second: null, additive: null, then: "hand"})`; no `uuid`: the panel | |
| 13 | `quick-bomb` | `alchemy.quickBomb({actor: null, family*: null, damageType: null, createIfNone: true})` | the panel on bombs |
| 14 | `quick-vial` | `alchemy.quickVial({actor: null, damageType: null, material: null})` | |
| 15 | `healing-bomb` | `alchemy.healingBomb({actor: null, grade: "best", target: null})` | |
| 16 | `gather-reagents` | `alchemy.gatherReagents({actor: null, minutes: 10})` | |
| 17 | `improvise-admixture` | `alchemy.improviseAdmixture({actor: null})` | |
| 18 | `affix-talismans` | `prep.affixBoard({actor: null})`, then the Morning tab on the affix board | |
| 19 | `post-summary` | `orders.postSummary({whisper: true})` | |
| 20 | `use-best` | `consumables.useBest({family*: null, actor: null, partyWide: false})` | asks which family the actor holds |
| 21 | `apply-poison` | `afflictions.applyPoison({poison*: null, weapon*: null, actor: null})` | asks which poison, then which item to coat |
| 22 | `expose` | `afflictions.expose({item*: null, targets: "targeted", delivery: null, dc: null})` | asks which of the actor's items |
| 23 | `roll-pending` | `afflictions.rollPending({actor: null})` | |

After the M11 review the shelf shows macro 3 as "Fund an order" and macro 6 as "Collect waiting items", the Workshop's own
words (DECISIONS, M4.1: "pledge" was retired as a money word); the ids and calls above are unchanged. Roll Craft check without
an order and nothing waiting refuses `no-check-order`, Finish order with nothing finishable `nothing-to-finish` (10.18).

Arguments a member takes beyond these pass through (`skipDialog`, `map`). A macro whose feature is off (14.1; combat's also
while Duct Tape is active) refuses `macro-off`; the shelf leaves it out.

### 11.2 API surface

Published at `game.modules.get("pf2e-artisans-workshop").api` in `ready`; the
`pf2e-artisans-workshop.ready` hook fires right after with the same object.

| Namespace | Members |
|---|---|
| (root) | `version` (module version), `apiVersion` (integer), `isReady()` |
| `ui` | `open(opts)`, `openOrder(id)`, `requestForm(uuidOrItem, opts)` |
| `orders` | `list(filter)`, `get(id)`, `request(opts)`, `accept(id, {crafter})`, `release(id)`, `start(id)`, `rollCheck(opts)`, `settle(id)`, `pause(id)`, `resume(id)`, `finish(opts)`, `cancel(id)`, `undo(id)`, `postSummary(opts)` |
| `services` | `request(opts)`, `perform(id)`; `request`'s `pay` (M5 on M4.1) |
| `funds` | `balance({actor, order})`, `pledge(opts)`, `deposit(opts)`, `withdraw(opts)`, `rows(filter)`, `claims(actor)`, `claimAll(opts)`, `post(row)` (extensions, 12.4) |
| `formulas` | `knows(actor, uuid)`, `routes(actor, uuid)`, `family(uuid)`, `acquire(opts)`, `provenance(actor)`; a cost is paid as `acquire`'s `pay` says, `{source: "fund"}` or `{source: "purse", from}` (M5 on M4.1) |
| `prep` | `open(opts)`, `loadouts(actor)`, `applyLoadout(actor, id)`, `affixBoard(opts)` |
| `alchemy` | `quickAlchemy`, `quickBomb`, `quickVial`, `healingBomb`, `gatherReagents`, `improviseAdmixture` |
| `consumables` | `useBest(opts)`, `holders(family)` (8.9) |
| `afflictions` | `definition(uuidOrItem)` (parse, override or world definition, 8.10.2), `expose(opts)`, `applyPoison(opts)`, `active(actor)`, `pending(actor)`, `rollPending(opts)`, `adjust(itemId, {stage \| end})`, `backend()` (`"native"` or `"effect"`) |
| `downtime` | `status(actor)`, `setActivity(actor, activity)`, `pending(actor)`, `resolve(opts)`, `advance(opts)`, `today()`, `setSettlement(profileId)` |
| `income` | `start(opts)`, `roll(jobId)`, `end(jobId)` |
| `rules` | pure functions: `levelDC`, `craftDC`, `incomePerDay`, `formulaPrice`, `planCraft`, `batchMax`, `familyKey`, `gates`, `helperRate`, `complexSetup`, `rushedFinishDC`, `deconstructCredit`, `gardenSeedCost`, `questCost`, `afflictionStep` (the `applyDegree` of 8.10.6) |
| `ext` | read-only lists of registered extension objects; `store(moduleId)` for namespaced data (12.4) |

As built in M6: `downtime` as listed plus `status(actor)` with its pending days, `setDowntime(on, {actor, notDowntime})`,
`advanceClockToMatch()`, `settlement()` and `profiles()`; `income.{list, start, roll, reroll, end, undo}`; and a
`communal` namespace, `{join, leave, roll, accept}` (10.12).

As built in M7: `prep.{open({actor, loadout, apply}), sources(actor), plan(actor, plan), apply(actor, plan), loadouts(actor),
saveLoadout(actor, loadout), captureLoadout(actor, name), deleteLoadout(actor, id), applyLoadout(actor, id), standing:
{list(actor), place(opts), end(id)}, affixBoard({actor}), affix({actor, talisman, host}), unaffix({actor, talisman}),
preserve({actor, items})}` and an `expiry` namespace, `{sweep(), beginCycle(actor)}` (10.13).

As built in M8a: `afflictions.{definition(uuidOrItem), define(uuid, def) (a world definition), expose({item, targets, delivery, dc,
actor}), applyPoison({poison, weapon, actor, replace, double, saveType}), unleash({poison, actor, targets}), touch({host, actor}),
active(actor), pending(actor), rollPending({actor, skipDialog}), roll({actor, runId, seq, skipDialog, voluntaryFail}),
adjust(itemOrUuid, {stage, end, endOnset, undo}), repair(itemOrUuid), process(), backend(), open()}` and `rules.afflictionStep`
(10.15).

As built in M10: `ext.{apiVersion, activities, incomeSources, sinks, modifierSources, modules, store, partyLevel, roll, runs,
run, openAids, income, incomePaid, spend, sinkItems, spends, modifiers}`, `funds.post(row)`, `funds.posted({source, key})` and
`rules.levelDC(level)` (12.6; `incomePaid` and `funds.posted` from the M10 review).

As built in M11: `ui.macros()`, `macros.{list(), command(id, args), run(id, args), toHotbar(id, slot), open()}`,
`orders.postSummary({whisper})` and `orders.rollCheck({order, actor, skipDialog})` with the actor's next order in `check` when
none is named (10.18).

As built in M8: `alchemy.{facts(actor), quickAlchemy({actor, uuid, second, additive, combine, then, map}) (the panel without a
uuid), quickBomb({actor, family, uuid, damageType, material, createIfNone, map}), quickVial({actor, damageType, material,
quickened, then}), healingBomb({actor, grade, target}) (made, and thrown when `target` is given), throwHealingBomb({actor,
item, target}), strike({actor, item, map, damageType, material}), gatherReagents({actor, minutes}), improviseAdmixture({actor,
skipDialog}), haversackVial({actor}), openBandolier({actor}), openPanel({actor, bombs})}` and `consumables.{useBest({family,
actor, partyWide, map}), holders(family), candidates({family, actor})}` (10.14).

### 11.3 Stability promise

- Semantic versioning from 1.0.0. Documented `api` members keep their signature and meaning within a
  major version; `rules.*` functions stay deterministic.
- Deprecations are announced in the changelog and warn through `foundry.utils.logCompatibilityWarning`
  for at least one minor release before removal.
- Stored data (flag layouts) is not public API; read it through the API.
- `apiVersion` is an integer that increases only when an extension interface or a hook payload changes
  incompatibly.
- Members starting with `_` are internal.

---

## 12. Extension API for other modules

### 12.1 Registration

```js
// In the extension module's init hook:
Hooks.once("pf2e-artisans-workshop.register", (registry) => {
  if (registry.apiVersion !== 1) return console.warn("unsupported Workshop API");
  registry.downtimeActivity({ /* 12.2 */ });
  registry.incomeSource({ /* ... */ });
  registry.consumableSink({ /* ... */ });
  registry.checkModifierSource({ /* ... */ });
});
```

- The registration hook fires once during the Workshop's `setup` hook: after every module's `init`, before
  `ready`. Extensions subscribe in their `init`.
- Registration closes at `ready`; later calls warn and are ignored.
- Ids are `<moduleId>.<slug>`; duplicates are rejected with a warning.
- Every label is an i18n key in the extension's own language file.
- An extension can declare `requiresApi: 1`; on a major mismatch the Workshop shows a GM-visible warning
  and ignores that extension.

### 12.2 Interfaces

```ts
interface DowntimeActivity {
  id: string; label: string; icon?: string;              // icon: Font Awesome class
  days: number; consecutive?: boolean;                   // block length, e.g. 2 consecutive days
  eligible?(actor): { ok: boolean; reason?: string };
  check?: { statistic: string | ((actor) => string); dc: number | "partyLevel" | "actorLevel" | ((ctx) => number);
            traits?: string[]; rollOptions?: string[] };
  aid?: { days: number; statistic: string; dc: number; bonus: number };
  compendiumUuid?: string;                               // link to the system's action item, if any
  resolve(ctx): ActivityResult;                          // pure: returns the writes, the Workshop applies them
}
type ActivityResult = { ledger?: LedgerRowInput[]; ext?: Record<string, unknown>; notes?: string[] };

interface IncomeSource {
  id: string; label: string; cadence: "perDay" | "perEvent" | "perWeek";
  compute(ctx): { cp: number; breakdown: { label: string; cp: number }[] };
  distribute: "strongbox" | "actor" | "split";
}

interface ConsumableSink {                                // spend an item as part of a check or activity
  id: string; label: string;
  accepts(item): boolean;                                 // e.g. any alchemical consumable
  spend(ctx): { modifiers?: ModifierData[]; notes?: string[] };   // the Workshop decrements, logs, refuses inert items
}

interface CheckModifierSource {
  id: string; selectors: string[];                        // pf2e selectors, e.g. "crafting", "skill-check"
  modifiers(ctx): ModifierData[];                         // pf2e Modifier data, applied by the Workshop's rolls
}
```

These four interfaces and the hooks in 12.3 are the whole extension surface named in the decision log.
There is no adventure-path adapter: an extension keeps its own tracks, calendars and purchases in its
extension store (12.4) and shows them in its own window, so no adventure-path state or UI lives in the
Workshop.

Every `ctx` gives read access to the order, PC, day, party and the extension's own store, plus
`rules.*`. Extension writes go through the returned results, `api.funds.post` and the extension store, so
they follow the same key-path, idempotency and responsible-client rules as the Workshop's own writes.

### 12.3 Hooks

All names are prefixed `pf2e-artisans-workshop.`. Except `register`, they fire once per event, on the
client that performed the write, after it resolved. Payloads are frozen snapshots, except the `result` of
`incomeComputed`, which listeners may adjust before it is posted.

| Hook | Payload | When |
|---|---|---|
| `register` | `registry` | during `setup` |
| `ready` | `api` | after the API is published |
| `downtimeDayStart` | `{day, actors, assignments, mode: "clock" \| "wizard"}` | before a day is resolved |
| `downtimeDayEnd` | `{day, results: {[actorId]: {activity, rows, notes}}}` | after a day is committed |
| `incomeComputed` | `{source, actor, day, result: {cp, breakdown}}` | before an income row is posted |
| `itemCrafted` | `{order, items, crafter, recipient, delivery: "direct" \| "shelf"}` | order completed |
| `formulaAcquired` | `{actor, uuid, route, provenance}` | formula added |
| `ledgerPosted` | `{rows}` | rows written |
| `orderStatusChanged` | `{order, from, to}` | any order transition |
| `preparationCompleted` | `{actor, cycle, created}` | Morning applied |
| `afflictionChanged` | `{actor, affliction, from, to, reason: "initial" \| "re-exposure" \| "stage" \| "onset" \| "max-duration" \| "manual"}` | a tracker item's stage or phase changed (8.10) |

`orderStatusChanged`, `preparationCompleted` and `afflictionChanged` go beyond the hooks named in the
decision log; they are proposed because extension modules will need them.

As built in M6: `downtimeDayStart` and `downtimeDayEnd` fire once per resolved day on the client that writes it, with
`mode` "wizard", "resolver" or "work" (an order's "Work a day"); the clock writes nothing, so "clock" is not used (10.12).

As built in M7: `preparationCompleted` `{actor, cycle, created}` fires once per preparation on the client that prepared,
`created` the outputs `[{id, uuid, pool, qty, name}]` (10.13). `morningSummary`, `itemsExpired` and `morningPrompt` also
fire, for the module's own cards and window; they are internal (prefixed like the public ones, not documented as API).

As built in M8a: `afflictionChanged` `{actor, affliction, from, to, reason, run, ...}` fires on the client that wrote the change
(`reason` initial, re-exposure, stage, onset, max-duration or manual); `afflictionPrompt`, `afflictionCoating`, `afflictionCloud`
and `afflictionNotice` fire for the module's own cards and are internal (10.15).

As built in M8: `quickAlchemy` `{actor, items, additive, kind}`, `healingBomb` `{actor, card}`, `vialsRegained` `{actor, from, to,
gained, why}` and `consumableUsed` `{actor, item, family}` fire on the client that did it, for the combat cards (10.14); they
are internal too.

### 12.4 Extension data and versioning

- `api.ext.store(moduleId)` returns `get(key)`, `set(key, value)`, `delete(key)` over
  `ext.<moduleId>.<key>` in the Workshop ledger, using key-path updates. Extensions version their own
  data. As built in M10 the store is the extension's own flag scope on the ledger, `flags.<moduleId>.<key>`, not a key
  under the Workshop's flags (DECISIONS.md 2026-10-27, the extension API as built): the Workshop's migrations rewrite
  its own flags and never an extension's, and its purge removes the ledger with both (12.6).
- Extension ledger rows use `kind: "income" | "expense"` with `source: "<moduleId>:<sourceId>"`.
- Interfaces and hook payloads are covered by `apiVersion` (11.3).

### 12.5 First consumer: the circus module

The circus module is the API's acceptance test: it must be buildable without changing
Workshop internals. It would register:

- its own state in its extension store: a persistent Prestige track, per-show Anticipation and
  Excitement, and its seven-day cycle, shown in its own window;
- upgrade purchases as `expense` rows through `api.funds.post`;
- `DowntimeActivity` entries for promoting the circus (two consecutive days, a Society check, linked to
  the system's compendium action) and show preparation;
- an `IncomeSource` for show payouts, per event, into the strongbox;
- a `ConsumableSink` for tricks that spend an alchemical item for a bonus;
- `CheckModifierSource` entries for roles, upgrades and trick traits.

All circus numbers, rules and names ship only in that module; nothing in the shipped Workshop refers to them.

### 12.6 As built in M10

M10 builds the extension API (pure parts in `scripts/logic/extensions.mjs` and the `ext` branch of the day planner in
`scripts/logic/downtime.mjs`; the Foundry side in `scripts/foundry/extensions.mjs`, the ledger hooks in
`scripts/foundry/events.mjs`, and additions to `downtime.mjs`, `rolls.mjs`, `claims.mjs`, `store.mjs`, `batch.mjs`,
`orders.mjs`, `nature.mjs`, `services.mjs`, `sync.mjs`, `api.mjs` and `module.mjs`; the window's parts in
`scripts/ui/downtime.mjs`, `days.mjs`, `advance.mjs`, `bandolier.mjs`, `morning.mjs` and their templates). Unit tests in
`test/logic/extensions.test.mjs`; stub tests in `test/foundry/extensions.test.mjs`, `ui-m10.test.mjs` and the lifecycle
hooks test of `orders.test.mjs`, all against a test extension of every interface (`test/foundry/ext-fixture.mjs`, module
`workshop-test-ext`). The first real consumer is the separate circus module (12.5), built in its own repository against
this API with the Workshop checkout as a development dependency; no live plan has run yet.

**Registration (12.1).** The Workshop's `setup` hook opens the registry and fires `pf2e-artisans-workshop.register` with it
(`openRegistration`); its `ready` hook closes it (`closeRegistration`) before the API is published. The registry hands
out `apiVersion` (1), `downtimeActivity(def)`, `incomeSource(def)`, `consumableSink(def)`, `checkModifierSource(def)` (each
returns `{ok, id}` or `{ok: false, reason}`) and `extension(moduleId, {requiresApi})`, which declares the extension and
returns those four methods restricted to its own ids (`foreign-id` otherwise), or null when it is ignored. Every id is
`<moduleId>.<slug>` (a Foundry package id, not `core`, `world`, `pf2e` or the Workshop's, then a lowercase slug), the module
must be active, and a duplicate is refused. `requiresApi` comes from the first declaration or the extension's manifest
(`flags["pf2e-artisans-workshop"].requiresApi`); another major ignores everything the module registers, and at `ready` a GM
is warned once (`Ext.ApiMismatch`). Every refusal is logged to the console. A call before `setup` (`not-open`) or after
`ready` (`closed`) is refused.

**Interfaces as built (12.2).** Definitions are checked and frozen (`normaliseActivity`, `normaliseIncomeSource`,
`normaliseSink`, `normaliseModifierSource`); callbacks get a frozen `ctx` with `store` (a read-only view of the extension's
own store, `get(path)` returning a copy), `rules` (`levelDC`) and what is listed below. A callback that throws counts as
"nothing" (an activity resolves nothing, a source adds no modifier, an income is refused `bad-result`, a spend `sink-error`).
- *DowntimeActivity*: `{id, label, icon?, days, consecutive?, eligible?(actor), check?: {statistic: slug | (actor) => slug,
  dc: number | "partyLevel" | "actorLevel" | (ctx) => number, traits?, rollOptions?}, aid?: {days, statistic, dc, bonus},
  compendiumUuid?, resolve(ctx)}`. A PC's activity is `{kind: "ext", ref: <activity id>}`, or `{kind: "ext", ref, aid:
  <actor id>}` to aid that PC (keys `ext:<id>` and `ext:<id>:<actorId>`). Its days form *runs* of `days` days (an Aid's
  `aid.days`): a day continues the PC's last unfinished run of the same activity (and aided PC), for a `consecutive`
  activity only from the day before, so a break starts again and the broken run counts for nothing; each day record says
  `ext: {run, n, of, from}`. The run's id hashes the actor, the activity, its first day and whom it aids (`extRunId`). The
  planner stops (4.8) with `ext-unknown` (no active module provides it, or it has no Aid), `ext-ineligible` (`eligible`
  refuses as a run would start; `why` its reason), `ext-check` and `ext-aid-check` (the run's last day waits for the
  check; every Aid has one). The check may be rolled any time before the last day is written (`api.ext.roll({actor,
  activity, from, aid})`, the wizard's checks step, the resolver): the run's record `extRuns.<id> = {id, v, actor, actorId,
  activity, aidFor, from, dc, aids, check, by, at}` is written first, then the roll goes through the statistic (pf2e's
  `getStatistic`) with an explicit DC (the party level is the members' levels averaged and rounded, GM Core p.75), the
  link option `pf2e-artisans-workshop:ext:<runId>`, `pf2e-artisans-workshop:activity:<id>`, the activity's roll options and
  traits (and `downtime`), the registered modifier sources' modifiers and, for the activity's own check, an Aid modifier
  for each open Aid run aiding this PC in it (`aidModifier`: the activity's bonus on a success or better, -1 on a critical
  failure, circumstance, so pf2e keeps the highest). The message's author records the check (`recordExtCheck`): a reroll
  replaces it until the run's last day is written and is kept as `conflict` after; a second roll that is no reroll is kept
  nowhere; the Aid runs it counted are marked `usedBy`, so one Aid helps one check. The run's last day calls
  `resolve(ctx)` (`ctx`: `actor, actorId, activity, run, check, degree, from, to, day, aids, partyLevel, store, rules`) on
  the resolving client; its `ActivityResult` is checked (`activityResult`): `ext` store writes go into the same request as
  the day records, behind the PC's day lock (so a day resolved twice writes them once); `ledger` rows (income or expense,
  keyed `run.<runId>.<n>` unless they give a key) are kept on that day record (`extRows`) and posted after the write;
  `notes` are kept as `extNotes` and are the day's notes in `downtimeDayEnd`. An Aid's last day resolves nothing. After the
  M10 review, a result's store path that is a prefix of another path of the same result (`tally` beside `tally.b`) is dropped
  (counted, the deeper one kept), and so is a path of a later run of the same span inside or around an earlier run's (a later
  run's same path wins): the two in one update would refuse the day's whole write, so the PC's days would never be written.
- *IncomeSource*: `{id, label, cadence, distribute, compute(ctx)}`. `perEvent` sources pay through `api.ext.income(id, {key,
  actor, day, data, recipients, note})`; `perDay` sources are asked for every day record of a PC in downtime with an
  activity, `perWeek` sources on the last day of each week of seven workshop days (`day % 7 === 6`), each with `ctx.record`
  (`cadenceKey` keys them by actor and day or week), their rows kept on the record like an activity's. Each computed
  payment fires `incomeComputed` before it is posted. `strongbox` mints `income` into the party fund (box +n, fund
  allocation +n), `actor` into `ctx.actor`'s purse, `split` evenly among `recipients` (the members by default; largest
  remainder, the first ones get the odd copper). The `key` makes a payment idempotent: rows are keyed
  `ext:<moduleId>:<slug>:<key>` (`.<recipient UUID>` for a split). After the M10 review a `perEvent` payment is idempotent
  per payment, not per row: before its rows are posted it is recorded once, `incomes.<id> = {id, v, source, key, cp,
  breakdown, distribute, rows, by, at}` (its id hashes the source and the key; written behind a lock page of the same id),
  and paying the key again computes nothing and posts exactly the recorded rows (each once), whatever the members or
  `recipients` are now (`outcome` "already"); of two clients paying at once, the one whose record lands pays and the other
  posts its rows. `api.ext.incomePaid(sourceId, key)` says whether a payment is made: recorded, and each of its rows in the
  ledger or claimed for its purse's owner.
- *ConsumableSink*: `{id, label, accepts(item), spend(ctx)}`. `api.ext.spend(id, {actor, item, key, data})` refuses an item
  that is inert or expired by the Morning's and the Bandolier's own expiry (`isInert`, `expiredWhy`), one the sink does not
  accept, or one the user does not own; otherwise it calls `spend(ctx)` (`actor, item, sink, key, data, store, rules`),
  takes one off the item (or deletes the last) in one request behind a lock page named by the spend and the stack's lock page
  at the version its quantity was read from (as the Workshop's own item moves lock it, M10 review: two spends with different
  keys planned from the same copy of the stack take two items, or the second is refused `conflict`), with the log record
  `spends.<id> = {id, v, sink, key, actor, item: {id, uuid, name, img, sourceId}, modifiers, notes, source, by, at}` (its id
  hashes the sink and the extension's `key`, so a spend sent twice spends one item), returns `{modifiers, notes, record}` and
  fires `consumableSpent`. The Bandolier offers "Spend on <sink>" beside each ready item a sink accepts (a fresh key each
  click, `source: "bandolier"`); the Morning tab lists what each sink would take of what the character carries.
- *CheckModifierSource*: `{id, selectors, modifiers(ctx)}`. A roll answers the selectors `rollSelectors` gives its
  statistic (`<slug>`, `skill-check` or `saving-throw`, `check`, `all`); `ctx` has `actor, statistic, selectors, kind,
  rollOptions` and the roll's own ids (`order`, `job`, `activity`, `service`). Modifier data `{slug, label, modifier, type,
  predicate?}` is checked (`modifierData`: a lowercase slug, a whole non-zero modifier, one of pf2e's types) and becomes
  pf2e `Modifier`s with the label localized. The Workshop's own rolls take them: a Craft check (`kind` "craft"), an Earn
  Income check ("earn-income"), a helper's ("help"), a Grow season check ("season"), a Repair ("service"), an extension
  activity's check ("activity") and an Aid's ("aid"); extensions get them for their own rolls from `api.ext.modifiers`
  ("extension"). Affliction saves, Quick Alchemy and the rest of combat do not.
- No adventure-path adapter (12.2): an extension's tracks, calendars and purchases live in its store and its own window.

**Rows (12.4).** `api.funds.post({kind, cp | amount, key, source: "<moduleId>:<slug>", via, actor, note, day})` posts an
extension's `income` (minted into the strongbox's party fund, `via` "box", the default without an actor; or into a purse,
`via` "purse", minted when this user owns it and an `income` claim for the owner's client otherwise, like a wage) or
`expense` (out of the unallocated party fund behind the fund slot, refused `fund-short` with `maxCp`). Only a module that
registered something (and is not ignored) may post (`unknown-extension`). The same key posts once (`already`).
`api.funds.posted({source, key})` (M10 review) finds an extension's row by its key, `{id, kind, cp, state, reversed}` or null:
any member may reverse an `expense` row in the Funds tab (its author, 10.10), so an extension that sells something for one
treats it as bought only while its row stands and buys it again under a new key (the circus module's purchases do). The sweep
gains "extension rows": the rows day records owe (`extRows`) that are not in the ledger, posted on the PC's responsible
client. Claims gain the `income` kind.

**Hooks as built (12.3).** `register` (the registry, in `setup`); `ready`; `downtimeDayStart` and `downtimeDayEnd` as M6
built them, the end's payload made after the write, with an extension run's rows among `rows`, its `extNotes` as `notes`
and the record's `ext` place (after the M10 review the wizard's `downtimeDayEnd` names only the PCs whose days its own write
landed: a PC refused as `taken`, because another client resolved those days first and announced them, or whose write failed
is left out, and a day nobody's write landed for has no end hook); `incomeComputed` `{source, actor, day, key, result}` (frozen but `result`, which listeners may
change; what they leave is posted); `itemCrafted` `{order, items: [{uuid, name, qty}], crafter, recipient, delivery}` once
on the finishing client, `delivery` "shelf" for a character (every finished item goes through the pickup shelf, 4.7) or
"strongbox" (not "direct"); `formulaAcquired`, `preparationCompleted` and `afflictionChanged` as built before;
`ledgerPosted` `{rows}` and `orderStatusChanged` `{order, from, to}` announced by the write path itself (`announceAfter`,
called by `store.write` and for each ledger operation of a batch request that landed): the rows that write made `applied`
(a lock request's pending rows are announced when their apply request settles them) and each order whose `status` changed
(`from` null for a new order), on the writing client only. M10 adds `consumableSpent` `{sink, actor, item, key, modifiers,
notes, record}`. Payloads are deep-frozen copies (`frozenCopy`).

**API (11.2).** `ext.{apiVersion, activities(), incomeSources(), sinks(), modifierSources(), modules(), store(moduleId),
partyLevel(), roll(opts), runs(filter), run(id), openAids({actor, activity}), income(id, opts), incomePaid(id, key),
spend(id, opts), sinkItems(id, actor), spends(filter), modifiers({actor, statistic, rollOptions, data, extra})}`,
`funds.post(row)`, `funds.posted({source, key})` and `rules.levelDC(level)`. `store(moduleId)` is `{get(path), set(path, value), delete(path), write({set, replace, del}),
exclusive(lockKey, change)}`; `exclusive` writes only if no earlier write took the same lock key (a lock page), for a
once-only step two clients could take at the same moment (a show resolved once).

**The window.** The Downtime tab and the wizard offer each registered activity by its own label, and "Aiding <PC>: <label>"
for a member whose days go to an activity with an Aid; extension days and stops read "N days: <label>", "N days aiding
<PC>: <label>", "Day N: <label> needs its check before its last day...". The wizard's checks step lists an extension run's
check (or Aid check) with Roll for the PC's owner and "waiting for its player" for others. Refusals and stops have keys
(`Refusal.Ext*`, `DayStop.Ext*`).

**Stability promise for extensions.** `apiVersion` is 1. Within it, the registry's methods, the four interfaces' fields
and callbacks with the `ctx` fields listed here, the ids and key formats (`<moduleId>.<slug>`, `ext:<moduleId>:<slug>:
<key>`, run ids, `ext:<id>[:<actorId>]` activity keys), `api.ext`, `api.funds.post` and the payloads of the public hooks
above keep their names and meaning; fields may be added. A change that breaks any of them raises `apiVersion`, and the
Workshop then ignores extensions that declare the old one rather than calling them with what they do not expect.
Deprecations follow 11.3. The extension's own store layout is the extension's to version; the Workshop's flags, `extRuns`
and `spends` are not API (read them through `api.ext`). Internal hooks (11.2, 12.3 "internal") are not covered.

**Live pass (the circus module's plan, 2026-10-27).** The circus module's live driver (its `tools/harness/run-live.mjs`,
over this repository's `Harness`, `prepareWorld`, `resetWorld` and `finishWorld` through the checkout it has as a development
dependency) enabled the module in the dev world, ran its plan with a GM and both players, and disabled it again (129
checks): registration on every client and no raw key, placeholder or adventure name in any window, the wizard, pf2e's
dialogs or the chat log; Promote the Circus with an Aid through the Advance days wizard (the Aid rolled from one player's
checks step, the promoter's check from the other's with the Aid's +2 in pf2e's dialog, two days written for both, the
result in the extension's store); advertising and an upgrade as `expense` rows from the party fund with no GM online, the
upgrade reversed in the Funds tab and bought again as the next purchase; a trick rolled from the extension's window through
pf2e, spending one alchemical item through the sink with its modifier applied; the show's payout as one `income` row,
paid once (`outcome` "already" after); two members ending one show at once (one result, one payout; the loser's lock page
is refused by the server, which core logs as an error on that page); a split payout whose other share the other player's
client collected; the Bandolier's Spend on; reconciliation. The die is fixed at 20 for the checks whose outcome later checks
need (the fixtures are untrained in Society and Performance, so a random roll left the show with no payout to check).
Fixed: the Funds tab now shows a row's `note` beside its kind; an extension's rows read "Expense 50 gp" with nothing to say
what they were for, though members reverse them there (the circus module now posts a note with each). With the module
disabled again, `m4-lifecycle`, `m6-income`, `m9a-off`, `m8-turn`, `m7-morning` and scenario 7 passed without it (75
checks; their console errors are the known ones: scenario 7's injected failure, `m6-income`'s two devices racing for a lock
page, and pf2e's at a token-less encounter's end on a client with no canvas).

#### Follow-ups (M10, low)

- The circus module's live plan is the only one that exercises the API live; the Workshop has no live plan of its own
  extension fixture (`test/foundry/ext-fixture.mjs` runs over the stubs only).
- `store.exclusive` (and every lock page) losing a race logs core's "The _id ... already exists" error in the losing
  client's console: the refusal is the design, but a player with the console open sees an error. Check the lock page in the
  client's copy first (it narrows the window; the race itself stays), or note it in the README's troubleshooting.
- A claim for an extension's income share (a split payout) carries the row's note, but the claim's own wording in the Funds
  tab was not checked live; the row it becomes shows the note.
- One activity per PC per span in the wizard (M6), so a run of a two-day activity and a day of something else in one span
  take two runs of the wizard.
- `perWeek` weeks are fixed seven-day blocks of the workshop day (`day % 7`), not seven days from when a PC's downtime began.
- An Aid can be rolled before the PC it aids has started a run, and is used by that PC's next check of the activity whatever
  run it is for; an Aid whose PC never rolls stays open.
- `spends` and `extRuns` are never archived (5.3.3 is not built).
- The Bandolier's "Spend on" gives the sink's modifiers to nobody but the `consumableSpent` listener; an extension that wants
  them on a roll listens for the hook.
- Check-modifier sources do not reach affliction saves, Quick Alchemy, vial checks or pf2e's own sheet rolls.
- `eligible(actor)` is asked on every preview, for every registered activity and PC.
- The day planner asks `resolve(ctx)` on the client that writes the day: a resolution refused as `taken` has called it for
  nothing (it is pure, so nothing is lost).
- From the review pass (low, logged, not fixed):
  - A per-day or per-week income is computed, and `incomeComputed` fires, before the day records are written; a resolution
    then refused as `taken` has announced a payment that the other client's resolution makes instead.
  - `perDay` sources are also asked for the day an order's "Work a day" writes for a crafter who is not in downtime.
  - The Downtime tab offers an Aid only while the aided PC's activity is that activity; a PC whose aided PC has moved on shows
    its Aid as no option selected until it chooses again.
  - An extension store's `exclusive` lock pages are never pruned, like the day lock pages (M6 follow-up).
  - `downtimeDayEnd`'s `notes` is an array for an extension run's last day and the day's result code (a string or null)
    otherwise.
- From the M10 review against the circus module (low, logged, not fixed; the mediums are fixed above):
  - `api.ext.roll`, `setActivity` and the day planner never check whom an Aid aids or whether its run has days: a PC can Aid
    itself (the Downtime tab excludes it, the API does not), an Aid can be rolled for any `from` with no day spent and still
    count, and a second Roll after a run's check is recorded makes a new chat roll and rewrites the run's `aids` with what is
    still open (none), so `ctx.aids` is empty when the run resolves. Refuse `aid === actor.id` in the three, refuse a second
    roll with `rolled` (a reroll goes through pf2e's reroll path), and do not rewrite `aids` or `dc` on an existing run.
  - `api.ext.runs()`, `api.ext.spends()` and `api.funds.rows()` hand out the ledger's own objects (a mutation changes what
    this client's Workshop reads, `run(id)` copies); `downtimeDayStart` and `downtimeDayEnd` payloads are frozen only at the
    top, though 12.6 promises deep-frozen copies. Use `structuredClone` or `frozenCopy`.
  - The registry has two registration paths with different guarantees: the top-level methods accept any active module's
    ids with no own-id check, and fix that module's `requiresApi` at the first call, so a later `extension(id, {requiresApi:
    2})` is accepted rather than ignored. Make `extension(moduleId, {requiresApi})` the only path (and 12.1's example use
    it), or read `requiresApi` only from the manifest there. The store's `set`, `delete` and `write` resolve to booleans,
    `exclusive` to `{ok, outcome, reason}`: one shape.
  - An `expense` row a `resolve(ctx)` returns that the party fund cannot cover stays owed on the day record: every sweep
    retries it, nobody is told, and it is paid silently when the fund later has the money. Either refuse expense rows in an
    `ActivityResult` (extensions pay through `api.funds.post` with their own window) or mark the refusal on the record and
    tell the PC's owner.
  - A DowntimeActivity cannot say how many PCs may Aid it (Promote the Circus allows one): every open Aid run counts, and
    each extra aider who critically fails adds another -1. Add `aid.max` (default unlimited), using the earliest runs.
  - A recorded income payment whose rows did not all post (the client went away between the record and its rows) is
    completed by the next call with its key (`api.ext.incomePaid` says it is not paid), not by the sweep; `incomes` is
    never archived, like `spends` and `extRuns`.
  - Before this repository is public: DESIGN 12.5 (the circus module's line) and the DECISIONS entry of 2026-10-25 ("Circus
    management is a separate module") name the adventure path, and the M4 live-pass notes (10.10) name a player's character:
    replace them with "the circus module" and "a fixture alchemist". The M10 commits add no such name.

**Acceptance (12.5).** The circus module was built in its own repository (`pf2e-big-top`, local, branch `main`) against
this API with this checkout as a development dependency by path, and its first build needed no change to the Workshop
(its review then asked for `api.ext.incomePaid` and `api.funds.posted`, added within API version 1, and found the medium
defects fixed above: overlapping result paths, split payments per recipient, the wizard's end hook, stack locks on spends): its stub tests run
it against this branch's real registry, day resolver, ledger, sink and modifier sources over `test/foundry/stubs.mjs`
(Promote the Circus with an Aid through the resolver, show preparation, purchases as `expense` rows, a trick rolled with
the Workshop's modifiers and an alchemical item spent through its sink, payouts into the party fund and split with claims,
two members ending a show at once). Its live harness plan is written and has not run.

---

## 13. Integrations and conflicts

| Module | Detection | Behaviour |
|---|---|---|
| pf2e-dailies | `game.modules.get("pf2e-dailies")?.active`; API `game.dailies.api` | custom daily (7.9); post-rest pipeline waits for its `rested` flag (7.8); its built-in dailies are never duplicated. As built in M7: registered at `ready` (pf2e-dailies 4.23.1 keeps `registerCustomDailies` at `game.dailies.api`, the module's global name being its id without `pf2e-`), its rows without pf2e-dailies' `save` (10.13) |
| PF2e Toolbelt | active flag | coexist: its Better Sheet adds sort buttons to the crafting tab, so the strip is appended above without touching formula rows; its Better Merchant services are an ordinary way to buy materials; no API use. As built in M11: Toolbelt 3.59.2 prepends its sort buttons to each crafting entry's header and `.known-formulas > header`; the strip is the tab's first child and holds no header of theirs; live plan `m11-companions` turns its `sortList` setting on (10.18) |
| PF2e Workbench | active flag | coexist: keep `li.formula-item` markup so its rarity colouring works; respect its chat-card collapse setting. As built in M11: Workbench 7.7.5 adds `xdy-pf2e-workbench-rarity-<rarity>` to the `h4` of each `.crafting-pane .formula-item` it can read; the strip has no `.formula-item` and leaves pf2e's rows alone; live plan `m11-companions` turns `playerCraftingRarityColour` on (10.18) |
| Item Piles | `game.itempiles` | no dependency; materials bought from an Item Piles merchant are ordinary items that can be earmarked; reading merchant prices is OQ-32 |
| Calendar modules (Calendaria, Simple Calendar Reborn) | none needed | time is read only from `game.time.worldTime` and `updateWorldTime`; dates display through `game.time.calendar` or the pf2e world clock; that these modules drive core world time is to be tested (OQ-18). Seasons & Stars is not verified for v14. |
| PF2e Convenient Consumables | active flag | "Use best consumable" (8.9) covers the same ground; both are user-triggered, so nothing competes; Settings notes the overlap |
| PF2e Talisman Manager | active flag | it owns affixing: the module records no affixes and shows its state where readable; daily talisman creation is still the system's and ours |
| PF2e Alchemist Remaster Duct Tape | `game.modules.get("pf2e-alchemist-remaster-ducttape")?.active` | 8.1-8.8 step aside entirely (8); the affliction tracker (8.10) stays; its Level Up feature (writes every tier into the book) is compatible with families. As built in M8: every combat action refuses with `duct-tape`, the Bandolier says why, turn expiry and the effect cap stop, and the settings window notes it under `features.combat` (10.14) |
| PF2E Affliction Forge | `game.modules.get("pf2e-affliction-forge")?.active`; API on its module object | one engine per affliction: the Workshop never tracks an affliction or a coating that Affliction Forge owns, and hands off exposures whose source item has a linked Affliction Forge template (8.10.11, OQ-41). As built in M8a: the hand-off is
the active GM's; refused coating of a weapon it coats; not run against the real module, the live plan uses a stand-in (10.15) |
| pf2e-downtime-scaling, Simplified Crafting, Heroic Crafting Automation | active flags | they replace or extend the Craft button or use a different ruleset: Settings and a GM notice warn about overlapping crafting; no `conflicts` entry in the manifest |
| SpazzMods PF2e Earn Income | active flag | warning against paying the same job in both modules |
| PF2e Downtime Tracker, Rutz's PF2e Days | active flags | coexist; Rutz's Days moves the world clock, which our accrual simply sees |
| pf2e-kingmaker-tools | none | no integration; camping and cooking are out of scope |
| PF2e HUD, Token Action HUD | none | must not collide with the token HUD palette (OQ-33). As built in M8: the palette is added only when core's left column is there and only once, never with `data-action` entries or inputs (10.14); live check `m8-hud` (with `--canvas`). Not verified in M11: neither is installed in the dev world, so whether their hotbar or HUD replacements take the macro shelf's drop or show its macros is untested (10.18 Follow-ups) |

---

## 14. Settings

Scopes: W = world (GM and assistant GMs), C = client, U = user. Defaults follow P10: the master switch
is off; once it is on, the features are on except vial gathering. The Treasure Vault (Remastered)
variants (14.4) are variant rules and are all off until a GM turns them on.

### 14.1 Master switch and features

| Key | Scope | Default | Meaning |
|---|---|---|---|
| `enabled` | W | off | master switch; turning it on creates the shared documents (5.2); no reload needed |
| `features.queue` | W | on | orders, Queue tab, pickup shelf |
| `features.funds` | W | on | escrow, ledger, Funds tab |
| `features.formulas` | W | on | codex, acquisition jobs, families |
| `features.downtime` | W | on | per-PC status, clock accrual, wizard |
| `features.income` | W | on | Earn Income jobs |
| `features.morning` | W | on | Morning tab, loadouts, standing orders, dailies integration |
| `features.expiry` | W | on | party-wide infused expiry |
| `features.combat` | W | on | section 8; steps aside by itself while Duct Tape is active |
| `features.consumables` | W | on | "Use best consumable" (8.9) |
| `features.afflictions` | W | on | the affliction tracker (8.10); independent of `features.combat` and of Duct Tape |
| `features.vialGathering` | W | off | 8.7; writes to actors as world time passes |
| `features.tattoos` | W | on | tattoo and graft orders (process per `rules.tattooProcess`) |
| `features.sheetEntryPoints` | W | on | sheet strips and header buttons (as built in M11: the character and Party sheet header buttons, the Crafting tab strip and the Party card, 10.18) |
| `members` | W | `party` | Workshop members: active pf2e party, or all player characters |
| `strongbox` | W | `module` | `module` or `party` (requires players to own the Party actor) |
| `chat.visibility` | W | `involved` | whisper to involved users, or public |
| `legacy.show` | W | on | offer legacy-only items, badged, in pickers, catalogues and formula routes; off hides them there. Legacy content a character already has is always automated and badged (6.11); there is no legacy rules toggle (P8) |

There is no setting that limits the Advance days wizard to GMs (9.2), and no combat-provider choice:
Duct Tape's presence decides it (section 8), and `features.combat` turns ours off.

### 14.2 Rules-gap and interpretation settings

The Basis column is an internal note for reviewers. It never goes into `lang/en.json`; setting hints
are written by the author without rules prose (P9).

| Key | Default | Basis |
|---|---|---|
| `rules.legendaryItemLevel` | 17 | Player Core p.237; 16 is the setting's other value, as GM Core p.223 and TV-R pp.162, 165 say (author decision) |
| `rules.uncommonNeedsFormula` | off | Player Core p.237 needs only access; GM Core p.223 needs the formula (OQ-37) |
| `rules.easyDcForRepeat` | off | optional −2 for the exact item made before, GM Core p.53 |
| `rules.setupInterruptionPersists` | on | 6.2.5 |
| `rules.recomputeRateOnLevelUp` | on | 6.2.5 |
| `rules.crafterSwapRestarts` | on | 6.2.5 |
| `rules.familyCoversLowerGrades` | on | PC2 Quick Alchemy treats one formula for any level as the normal rule; on for every route, off restricts coverage to higher grades (6.4, author decision) |
| `rules.preciousCoinForCommon` | on | 6.6 |
| `rules.allyCopyCostCp` | 0 | Player Core p.294 sets no fee between allies; copying from an ally is free and takes 1 hour (author decision) |
| `rules.formulaSurchargeUncommon`, `...Rare` | 0% | GM Core p.48 suggests 10-100% and 25-500% |
| `rules.inventorRarity` | off | Inventor: uncommon or rare only if the GM allows, at the item's Craft DC with its rarity adjustment (author decision) |
| `rules.inventorSetupDays` | 2 | unstated in the feat; author decision |
| `rules.communal.*` | see 6.7 | RAW gaps; defaults are author decisions (6.7) |
| `rules.snareDowntimeBatch` | 4 | consumable trait implies 4 (OQ-14) |
| `rules.magicalSnaresNeedMagicalCrafting` | on | OQ-14 |
| `rules.snareToolkitIsArtisans` | on | no snare toolkit item exists (OQ-14) |
| `rules.tattooProcess` | `secrets-of-magic` | decision log; `simple` is the toggle |
| `rules.tattooHealingDays` | 30 | Secrets of Magic p.164: a healing period of up to about a month |
| `rules.tattooSubjectLocked` | on | the subject's downtime is occupied (author decision, 6.14) |
| `rules.talismanHostsExcludeBombs` | on | design choice (7.4) |
| `rules.downtimeRerolls` | `warn` | GM Core p.46; `block` is the alternative |
| `rules.earnIncomeOtherSkillDc` | +5 | Player Core p.228: a higher DC for other skills (OQ-17) |
| `rules.costOfLiving` | off | GM Core p.50 |
| `expiry.action` | `inert` | decision log; `delete` is the alternative |
| `expiry.quickAlchemyAtCombatEnd` | on | 8.8 |
| `archive.ageDays` | 30 | 5.3.3 |
| `settlements` | (empty) | settlement profiles: name, level, task-level caps by skill, market notes |

The party's current settlement is not a setting: players cannot write world settings (`SETTINGS_MODIFY`
defaults to Assistant), so it lives in the ledger as `meta.settlement = {profileId, by, at}`, which any
member may change (6.10).

Settings with values that are interpretations show a small "interpretation" badge wherever they change
a number, linking to the setting.

As built in M1: the defaults the rules engine reads are `DEFAULT_RULES` in `scripts/logic/defaults.mjs`, keyed
without the `rules.` prefix (`rules.communal.helperCap` is `communal.helperCap`) and with the variant switches
of 14.4 under `variants`; settings registration (M2) takes its defaults from there. `rules.communal.*` is
`helperDc` (`"item"`, its only value so far), `helperCritUsesNextRow` (on), `helperFailUsesFailColumn` (on),
`helperLeaveRetroactive` (on), `helperCap` (0: none) and `countHelpersWithoutFeat` (off). Surcharges are whole
percents.

### 14.3 Client and user settings

| Key | Scope | Default |
|---|---|---|
| `ui.parchment` | C | off |
| `ui.windowSize` | C | (computed) |
| `notify.level` | U | `mine` |
| `claims.auto` | U | on |
| `bandolier.autoOpen` | U | on |
| `ui.lastTab` | U | `queue` |

Internal (not shown): `docs` (W, ids of the shared documents, written by the GM client that creates
them); `dev` (W, default off, set from the console in a test world only): development runs (15.1) and
the local harness's fixture tools (15.3). The schema version is not a setting; it lives in
`flags.MOD.schema` on the shared documents (4.14).

As built in M2 (`scripts/foundry/settings.mjs`): registered are `enabled`, `docs`, `members`, `claims.auto`,
every rule of `DEFAULT_RULES` as `rules.<key>` (`rules.communal.<key>`; `rules.communal.helperDc` hidden while
it has one value) and `variants.complexCrafting`, with their defaults read from `DEFAULT_RULES`, and the
GM-only purge menu (5.9). As built in M4: `chat.visibility` (W), `notify.level` (U) and `ui.lastTab` (U, hidden);
`features.queue`, `features.funds`, `ui.windowSize` and `ui.parchment` are not registered yet. The other settings of 14.1 and 14.3-14.5 are registered by the milestones that
read them, with the defaults listed here; `strongbox: party` comes with the Funds tab (M4, 4.7). As built in M6: `features.downtime`, `features.income` and the hidden
`settlements` (the GM's profiles, edited in the Downtime tab); `rules.costOfLiving` is not read yet (10.12). As built in M7:
`features.morning`, `features.expiry` and `expiry.action` (10.13). As built in M8: `features.combat` (W, on),
`features.consumables` (W, on), `features.vialGathering` (W, off), `expiry.quickAlchemyAtCombatEnd` (W, on; off gives an
encounter's items one round of world time from its end), `bandolier.autoOpen` (U, on) and the hidden `bandolier.position`
(U, `{left, top}`) (10.14). As built in M8a: `features.afflictions` (W, on) and every setting of 14.5 with its default (10.15). As
built in M9: `features.tattoos` (W, on; off, a tattoo or graft is crafted as a plain item), `rules.tattooSubjectLocked` (W, on) and
`rules.tattooHealingDays` (W, 30) (10.16). As built in M9a: every setting of 14.4 with its default, all off (10.17). As built in M11:
`features.sheetEntryPoints` (W, on), `ui.parchment` (C, off; a change applies to open windows at once) and the hidden
`ui.windowSize` (C, `{}` until the user resizes the Workshop; then `{width, height}`) (10.18).

### 14.4 Treasure Vault (Remastered) variants

All world settings, all off by default because they are variant rules (6.16). Sub-settings matter
only while their variant is on.

| Key | Default | Basis |
|---|---|---|
| `variants.complexCrafting` | off | TV-R p.158 (6.16.1); also enables the Quick Setup registry entry |
| `variants.complex.rushCritFail` | `ruined` | TV-R p.158 leaves ruined or cursed to the GM; `cursed` is the alternative |
| `variants.adjustments` | off | TV-R p.159 (6.16.2) |
| `variants.events` | off | TV-R pp.159-161 (6.16.3) |
| `variants.events.firstDay` | 7 | GM Core p.46: a single event for a week or a month of downtime; the first event falls on the attempt's 7th downtime day (6.16.3) |
| `variants.events.everyDays` | 91 | GM Core p.46: around four events for a year or more; one more event every 91 downtime days after the first |
| `variants.events.table` | (none) | UUID of a world RollTable the GM built from TV-R Table 5-2 |
| `variants.events.pauses` | off | an open event pauses the order until a member resolves it |
| `variants.criticalCrafting` | off | TV-R pp.161-162 (6.16.4) |
| `variants.critical.trigger` | `natural` | TV-R p.161 suggests natural 20s and 1s; `any` is the alternative |
| `variants.critical.specialOnly` | on | TV-R p.161: only special items |
| `variants.critical.mode` | `alongside` | TV-R p.161 presents the special effects as outcomes beyond the money effects, so they come on top of them; `replace` drops the money effect of the critical (interpretation, 6.16.4) |
| `variants.critical.secret` | off | TV-R p.161 suggests secret rolls; applies only while a GM is connected, and hides the degree from players until the check settles (6.16.4) |
| `variants.deconstruct` | off | TV-R pp.162-163 (6.16.5) |
| `variants.deconstruct.expiryDays` | 0 | TV-R p.162 leaves expiry to the GM; 0 means none |
| `variants.grow` | off | TV-R pp.164-165 (6.16.6) |
| `variants.natureCrafting.skills` | `crafting` | TV-R p.165: `nature` (Grow uses Nature) or `nature-arcana` (Grow uses Nature, Craft uses Arcana) |
| `variants.natureCrafting.seasonDays` | 91 | used when the world calendar defines no seasons |
| `variants.gardens` | off | TV-R pp.167-169 (6.16.7) |
| `variants.gifts` | off | TV-R p.166 (6.16.8) |
| `variants.quests` | off | TV-R pp.170-175 (6.16.9) |
| `variants.quests.critFail` | `destroyed` | TV-R p.172: destroyed or cursed; `cursed` is the alternative |

### 14.5 Afflictions

World settings unless marked U.

| Key | Default | Basis |
|---|---|---|
| `afflictions.pcSaves` | `prompt` | the owner of a player-owned victim (a PC, familiar, companion or summon) rolls from a card; `auto` rolls without a dialog (8.10.8) |
| `afflictions.npcSaves` | `auto` | the active GM's client rolls saves for victims with no player owner, secret per pf2e's metagame settings; `prompt` is the alternative |
| `afflictions.gmRollsForOfflinePCs` | off | a save for a player-owned victim waits for its owner; on lets the GM's client roll it |
| `afflictions.autoApplyDamage` | off | stage damage is posted with the system's apply buttons (8.10.1) |
| `afflictions.catchUp` | `roll-each` | every due save is rolled in order after a long time advance; `pause` stops at the first (8.10.7) |
| `afflictions.catchUpLimit` | 20 | saves rolled before the catch-up stops to ask |
| `afflictions.combatAnchor` | `exposure-turn` | the pf2e effect convention; `victim-turn` is the alternative (OQ-40) |
| `afflictions.handOffToForge` | on | only while Affliction Forge is active (8.10.11) |
| `afflictions.forgeWithoutGm` | `workshop` | Affliction Forge runs only on a GM client; with no GM connected a handed-off exposure is tracked by the Workshop, so P2 holds; `wait` keeps it pending until a GM connects (8.10.11) |
| `afflictions.notify` (U) | `mine` | save prompts and stage notices: all, mine or none |

---

## 15. Testing

### 15.1 Pure-logic unit tests

- `node --test` on Node 24 over `scripts/logic/*.mjs`; no Foundry globals in those files.
- Covered: tables (every row of 6.1 against the pf2e source values), Craft math including the Player
  Core p.237 example vector, batches, families, gates, precious materials, Communal Crafting rates, Earn
  Income degrees and Experienced Professional doubling, coin planner (change-making cases, including the
  "remove 1 cp from 1 gp" case, and create-only strongbox plans), pro-rata splitting and rounding,
  idempotency keys and lock ordering, responsible-user selection (including `String#compare` order),
  workshop-day arithmetic (the maximum of clock and logged days, the World Clock offset), totals derived
  from day records (a day resolved twice counts once), migrations.
- Variants (6.16): Complex Crafting setup for every band, column, formula and rush value, the sub-day
  floors and Quick Setup, `setupPlan` freezing `{days, hours}` and `variant.complex` at start, the
  setup-to-check condition with a pending `setup-hours` record, the rushed-finish flat-check DC with and
  without Proficiency without Level (the legendary 15th-level vector, DC 2 both ways); Deconstruct
  credit for both purposes and degrees, and the loss applied to the value (a 100 gp item after one
  unrepaired retry, similar purpose, success: 7,125 cp); variant day records keyed per order never
  overwriting the day record; the garden seed-cost vector (greater antidote, 2,000 gp); quest cost and
  per-encounter split; event cadence (first on day 7, four in 365 days), event and season keys.
- Afflictions (8.10.6): every degree of the initial, stage and re-exposure saves, a critical failure on
  a single-stage affliction (stays at stage 1), `reExposure: "none"`, virulent streaks, the highest
  stage repeating, onset and maximum-duration timing (including an onset longer than the maximum),
  Tenacious Toxins, the grant flags (an affliction ended at drained 1 leaves drained 1; frightened
  decaying to 0 leaves the tracker), the DC order (a stamped infused poison held by an ally; a printed
  DC above the creator's class DC, Wolfsbane at a 10th-level alchemist, writes no stamp), coating
  outcomes for each attack degree and damage type, Sticky Poison's DC 5 check on every no-save spend,
  Double Poison's merge (lower DC and stage count, longer interval per stage), incapacitation (the item
  passed to every save; a higher-level target against Lethargy Poison), recording (a second non-reroll
  message for a `seq` changes nothing; a reroll restores `before` and drops the superseded stage's
  conditions), the affliction time function over logged days followed by a clock advance through the
  same span, catch-up ordering and its limit, both combat anchors against a scripted initiative order,
  and the parser against a fixture corpus of stage paragraphs (dice intervals and dice onsets, "Stages
  1–5" ranges, "as stage N", bare condition names, persistent damage).
- Lint (ESLint flat config): bans the v15-removed globals (`renderTemplate`, `loadTemplates`,
  `getTemplate`, `ActorSheet`, `ItemSheet`, `Dialog`, `Application`, `FormApplication`, `FilePicker`,
  `ContextMenu`, `DragDrop`, `duplicate`, `$`, `jQuery`), `instanceof HTML*`, `requestAnimationFrame`, the
  `-=`/`==` update keys (regex ``["'`\.][=-]=``), `data-action` in chat templates, and string literals in
  templates and notifications.
  - As built in M0: code that runs in Foundry (`scripts/`, `macros/`, `tools/harness/`) may use only the
    globals `eslint.config.mjs` lists (the browser globals it needs, and the Foundry globals that Foundry
    14.368's `client/client.mjs` assigns without a deprecation warning), so every v15-removed alias, the
    AppV1 classes, `MeasuredTemplateDocument`, jQuery, `libWrapper`, `socketlib` and
    `requestAnimationFrame` fail `no-undef`. On top of that: `foundry.appv1`, and `game.socket` wherever the
    code says so (a local rule, `workshop/no-game-socket`: dot access, computed access with a name it can read,
    destructuring, `Reflect.get(game, "socket")`, through `globalThis`; a computed name it cannot read, or a copy of
    `game` under another name, it cannot follow), where only watching the connection is allowed (`connected`, and
    `on`/`off` of "disconnect" with one arrow listener, as a statement of its own, 5.4: they return the socket, so
    `game.socket.on("disconnect", f).emit("x")` is reported; socket.io's emitter calls a listener with `this` bound to
    the socket, so a listener must be an arrow function, written there or held in a variable of the file only ever
    given arrows, and `function () { this.emit("x"); }` is reported; and `off("disconnect")` without a listener, which
    would remove core's listeners too, is reported); the live driver's page functions, which the module never loads,
    are exempt, since one drops a page's connection on purpose;
    monkey-patching (`X.prototype.y = ...`, `X.prototype = ...`, and `Object.assign`, `defineProperty`,
    `defineProperties`, `setPrototypeOf` or `Reflect.set` on `X.prototype`); and in shipped code and
    macros the `document`, `window` and `globalThis` globals (detached windows, and no reaching a banned
    global through them). Notification messages (the first argument) must be an i18n key passed with
    `{localize: true}` or `{format}`, or text already localized; the `hint`, `label`, `title`,
    `placeholder`, `content` and `tooltip` properties, however the key is written, must hold an i18n key
    (`pf2e-artisans-workshop.*`, or an upper-case namespace such as `PF2E.*` or core's `COMMON.*`), and
    `name` must not hold a capitalised word or one with a space. i18n keys are written out in full:
    `` `${MODULE_ID}.Xxx` `` is rejected so that the key check below can see every key. Files under
    `scripts/logic/` and `scripts/data/` get no Foundry or browser globals. Macros are parsed as modules
    (top-level `await` works, a top-level `return` does not) with Foundry's macro arguments defined.
  - What ESLint cannot see is in `tools/check-source.mjs`, run by `npm run lint`: no literal text in
    `.hbs` templates (text nodes, user-facing attributes, and partial arguments), no `data-action` in
    `templates/chat/`, and every quoted `MOD.Xxx` i18n key in `scripts/`, `macros/` and `templates/`
    defined in `lang/en.json`, and no `lang/en.json` key that is also the group of another (`A.B` beside `A.B.C`:
    Foundry expands the keys into nested objects and drops the whole file when one is both; M6 live pass). The
    strings gate (16.4) rejects a `lang/en.json` key whose first segment after `MOD.` is not capitalised, which is
    what tells keys apart from hook and query names.
- As built in M1: the rules core is `scripts/logic/` (`core`, `defaults`, `dc`, `income`, `craft`, `complex`,
  `progress`, `batches`, `families`, `gates`, `materials`, `communal`, `formula-jobs`, `earn-income`, `coins`,
  `split`) over the tables in `scripts/data/`, tested by `test/logic/*.test.mjs`. Every table row is checked
  against the book, transcribed a second time in its own units; with `PF2E_SRC` set, the DC and Income Earned
  tables are also compared with pf2e's `dc.ts`, `EarnIncomeDialog.REWARDS_BY_LEVEL` and the Earn Income
  compendium text. The coin planner is checked against a line-for-line transcription of pf2e's
  `removeCurrency` on 5,000 seeded random purses, and strongbox plans for value conservation and no updates
  on 1,000 random boxes. A purity test checks that `scripts/logic/` imports only itself and `scripts/data/`,
  that `scripts/data/` imports nothing, and that every module loads in Node.
- As built in M2: the storage-and-sync rules are pure too (`ids`, `keypath`, `migrations`, `responsible`, `rows`,
  `claims`, `lock-first`, `roster` and `reconcile` in `scripts/logic/`, tests in `test/logic/`). The Foundry side
  (`scripts/foundry/`) is tested in `test/foundry/` against a small fake of the Foundry globals
  (`test/foundry/stubs.mjs`) whose client and batch server behave as 14.368's and pf2e's do: the client's own
  dry run first (pf2e dropping deletions of items the actor no longer holds, core throwing for an update of a
  missing document, empty operations not sent), then the server's dry run of every operation that refuses the
  whole batch (replaying the passing dry-run results with `options.dryRun`, updates without committing), then
  the operations in order, stopping at the first error; item and journal writes bump `_stats.modifiedTime`.
  Hooks let a test land a change on the client before it sends, on the server before its dry run, and between
  the server's operations; `test/foundry/races.test.mjs` holds one device's request in flight while another's
  lands. Node 24 has `navigator.locks`, so the lease runs on the real API.
- As built in M11: `test/theme.test.mjs` reads the stylesheet's `--paw-*` tokens and holds the text colours at 4.5:1 and the
  focus ring and bar segments at 3:1 against the light panel, a dark parchment, the dark panel and a lighter dark ground;
  `test/foundry/dom.mjs` is a small DOM (selectors, `isConnected`, a `MutationObserver` that hears `replaceChildren`) with an
  ApplicationV2 whose read-only properties are getters, for the sheet entries, the shelf and the window's size and focus
  trap (`test/foundry/ui-m11.test.mjs`).
- Development runs set `CONFIG.compatibility.mode` to FAILURE with `includePatterns` for this module. A
  development run is a world with the hidden `dev` setting on (14.3). Core matches the patterns against
  the whole stack, so any deprecation warning whose stack passes through this module's files throws,
  including one raised inside pf2e, core or another module that this module (or the fixture builder in
  `tools/harness/`) called; and other packages' warnings whose stacks do not pass through it are not
  reported at all in that world. One warning is excluded (`excludePatterns`): Application V1's own, raised by
  its constructor. pf2e 8.6.1's check dialog is still V1, so a Craft check rolled from the Workshop with pf2e's
  dialog threw at the dialog's constructor in a dev world and never rolled (found in the M4 live pass, where every
  plan had rolled with `skipDialog`); this module's own code cannot use V1, which the lint rules above check.

### 15.2 Registry validation

`tools/validate-registry.mjs` against a sparse checkout of a pinned `pf2e-` tag (packs and the source
paths in 3.3) in CI, and against the newest tag and the dev head in the churn watch (6.11). It also
runs the affliction parser over every candidate pack item (any `Stage` or `Stages` label, or an Onset
or Maximum Duration paragraph): each parses fully, has an override, or is on the ignore list (8.10.2);
intros that mention further, additional or multiple exposure are flagged for review; and a changed
parse result between tags is reported.

As built in M3: CI's `registry` job checks out the module into `module/` and pf2e at `pf2e-8.6.1` (pinned by commit)
beside it, sparse (all 25 Item packs of the manifest, `system.pf2e.json`, and the two source files the table tests
read), and runs `npm run validate:registry -- --pf2e ../pf2e` and `PF2E_SRC=../pf2e npm test`. Both fail when a
registry entry or ignored UUID is in a pack the checkout lacks, so a sparse-checkout path that drifts fails the job
instead of checking nothing. The affliction parser part and the
churn watch come with M8a and the release workflow.

As built in M8a: `checkAfflictions` runs the parser over every candidate of every Item pack in the checkout and fails on one that
neither reads fully, nor has an override, nor is on the affliction ignore list; on an intro that mentions further, additional or
multiple exposure, and on a candidate with no affliction kind, without an entry; and on an override or ignored UUID that does not
resolve, whose slug changed, or that is both. An override whose item now reads fully is noted. `--json` writes each candidate's
definition digest, and `--affliction-baseline <json>` lists the candidates whose reading changed since (the churn watch's input).
Against the pinned `pf2e-8.6.1` and the dev head `be4ab21b`, with every Item pack (CI's checkout takes all 25): 201 candidates, 86
read fully, 110 overridden, 5 ignored, none failing (10.15); `spells` and `bestiary-family-ability-glossary` hold 37 of them.

### 15.3 Local Foundry harness

- Foundry Node build under Node 24 with its own data path and port, not reachable by anyone but the
  developer (Foundry's licence allows a private development server next to a live one, provided nobody
  else can get past its login). The developer installs Foundry and enters the licence key.
- pf2e pinned by release manifest (`releases/download/pf2e-<version>/system.json`); the module symlinked
  in (no packs).
- Fixture tools live in `tools/harness/`, which is not in the release zip. With the `dev` setting on
  (14.3), the GM's client imports them at `ready` and publishes them as
  `game.modules.get(MOD).dev.fixtures` (`create`, `create({reset: true})`, `list`, `remove`) for the
  console and for Playwright.
- Users: GM, assistant GM, Player 1, Player 2, each in its own browser profile, driven by Playwright.
- Companion modules toggled per scenario: pf2e-dailies with libWrapper, Toolbelt, Workbench, Item Piles
  with socketlib, Duct Tape, one calendar module.
- Scenarios:
  1. Two players, no GM: request, pledge, accept, start, roll with a Hero Point reroll before
     settlement, settle, resolve days, finish, deliver to the offline player, claim at their login; undo
     a mistaken settlement without a GM.
  2. GM and players: the same, with the GM as fallback responsible user; relay "deliver now".
  3. GM and assistant GM online: every hook-driven write happens exactly once.
     3b. The same GM in two tabs, and a player in two tabs: every hook-driven write and every claim
     happens exactly once.
     3c. Two players pledge to the same order at the same moment, and one client fires two pledges
     before the first resolves: the strongbox balance equals the sum of the rows.
  4. Rest for the Night from the party sheet, with pf2e-dailies on and off: one Morning prompt per
     character, on the right client; expiry claims applied on other holders.
  5. Combat: Quick Alchemy with Double Brew and an additive, quick vial expiry at end of turn, Quick
     Alchemy expiry at start of next turn, vial gathering cap with two clients clicking.
  6. Duct Tape on: section 8 absent except "Use best consumable" (8.9); nothing else changes.
  7. `modifyBatch` with an injected failure, and two clients resolving the same claim or wage day at
     once: the loser stops at its lock and moves nothing; a batch stopped part-way leaves a pending row
     that reconciliation shows (5.4).
  7b. Strongbox creation and re-creation: `ownership.default` is OWNER afterwards, and a player can
     pledge, earmark, shelve and claim (5.2).
  8. Detached windows: drag and drop, keyboard, re-render.
  9. Module disabled and re-enabled; purge; migration from a fixture of an older schema.
  10. Accessibility: keyboard-only pass through Queue, request form, Morning and Quick Alchemy; screen
      reader smoke test; contrast check.
  11. Performance: Queue re-render time with 30 orders and 6 members. As built in M12: `npm run harness:perf`, at 30 and at 200
      orders with five members (15.7).
  12. Afflictions:
      a. GM and players: a toxicologist coats a weapon (single action) and Strikes an NPC; the
         initial save is rolled once on the GM's client; stage saves fall at the right turn ends;
         the maximum duration ends it; Sticky Poison keeps the coating on a flat-check success.
      b. Two players, no GM: an inhaled poison catches both PCs; each owner gets one prompt and rolls
         their own save; a Hero Point reroll replaces the result; one owner disconnects with a save
         due and it stays pending until they log in, while the other's affliction progresses.
      c. The same player in two tabs, and a GM with an assistant GM: every exposure, save prompt and
         stage change happens exactly once.
      d. An infused poison crafted by an alchemist with Powerful Alchemy, handed to an ally and coated
         on the ally's weapon: the exposure uses the creator's class DC; the coating goes inert at the
         creator's next daily preparations; an affliction already running continues.
      e. Re-exposure during onset; a virulent poison; a one-hour world-time advance with a
         one-minute interval poison (catch-up and its limit); days logged by the wizard with a
         day-interval poison on a PC in downtime and on one who is not, then "advance clock to match"
         over the same days, which rolls nothing twice.
      f. Affliction Forge active: no double tracking; a template-linked poison is handed off on the
         GM's client, including for a PC target; with only players connected, the same exposure is
         tracked by the Workshop under `afflictions.forgeWithoutGm: workshop` and stays pending under
         `wait`, and no player client calls Affliction Forge.
      g. Effect backend in a release build, and the native backend in a development build of pf2e:
         the same scenario gives the same stages and conditions within the native constraints of
         8.10.1 (no conditions during the onset; damage for a repeated stage); the migration converts
         one to the other with no duplicate conditions and at most one re-posted damage card.
      h. Effects-panel clicks on a tracker in both backends: a left-click becomes a recorded manual
         adjust with the stage's conditions re-applied, a right-click at stage 1 a recorded manual end,
         and the run state always matches the badge.
      i. A familiar exposed while its owner is connected and no GM is: the owner rolls; an unidentified
         poison on a PC still shows a stage badge to its player under a generic name.
  13. Variants: a Complex Crafting order rushed in setup and in finishing, with the flat check; a
      Quick Setup 2-hour batch of consumables recorded on a day the crafter spends on another activity,
      and its 4 hours for a permanent item refused there; a Deconstruct whose
      components fund a follow-on order, with the day counted when the check settles; a Grow order left
      untended across a season boundary with no GM online; a garden funded by two players and
      harvested once per day; a quest whose last two components two players mark at the same moment
      leaves `gathering` exactly once; a host with adjustments delivered to another PC; a secret
      Critical Crafting roll shown as "rolled (secret)" to players.
  14. Tattoos and remaining crafts: a tattoo for a player's character by a GM-owned tattooist, consented to and sat for by
      that player, healed and invested by the player's own client; the simple toggle; a graft with Medicine, inactive while
      the invest limit is used up; a fulu's tradition and year; missives made blank; a staff's listed castings offered by a
      wizard; quick-deploy snares marked and deployed; an inventor's uncommon gadget.
- As built in M2: `tools/harness/sync-scenarios.mjs` scripts the parts of scenarios 1, 2, 3 (with 3b), 3c, 7,
  7b and 9 that storage and sync cover, as steps each client runs from the console or from Playwright
  (`game.modules.get(MOD).dev.scenarios.run(id, step, params)`), with check steps that read the shared
  state. In a dev world the scenarios load on every client and the fixture tools on a GM's. Scenario 7's
  injected failure is two deletions of the same strongbox item at the start of the apply request: both pass
  the dry run and the second fails in the real pass, so the move stops after its lock. Its race step reports
  where the loser lost (`reason`: before sending, at the dry run, or in the real pass), and its refund steps
  have two players collect refunds written in one go. Scenario 3b's purse steps have one player's two devices
  mint a wage and pledge from one purse at the same moment, and check the purse against the applied rows.
- The live driver (`tools/harness/run-live.mjs`, `npm run harness:live`) runs those steps with Playwright: one
  browser context per user and device (a second tab of a user is a second page in its context, sharing its Web
  Locks), logged in through `POST /join`. Its plans (`tools/harness/live-plans.mjs`) prepare the world through the
  Foundry API, start each scenario from fresh shared documents, start simultaneous steps together, check the
  steps' results against what the server holds (read back with `get` requests), and add checks of single
  behaviours the stubs cannot settle (lost locks, the dry-run replay, pf2e's dropped deletions, stack versions,
  server time and a stamp from before a relaunch, sweep stagger, purge returns, the assistant GM's switch, an
  OBSERVER player, a dead migration lock, relay against sweep, late answers from the server, the cleric fixture's
  nested choice, a move stranded between its two requests and resumed). The migration-lock checks take their lock
  through the module's own `stampNow`, as of minutes ago, from a client whose clock runs three hours fast, and
  for `relaunch-stamp` in an earlier, longer launch (`Date.now`, `game.time.serverTime` and
  `game.world.lastPlayed` set for that one call), so a stamp that lost its launch, or took it from the client's
  clock, would keep the lock from being broken. The fixture actors and their folder are marked outside the
  module's flags (`flags.world.pf2e-artisans-workshop-fixture`, and `-fixtures` on the folder, `fixtures.mjs`), so
  the purge of scenario 9, which removes every module flag, leaves them; scenario 9 checks that they survive.
  Preparing the world gives actors built before the marks moved their new mark, by the names the fixture tools
  give them.
- As built in M3: scenario `m3` (`tools/harness/roll-scenarios.mjs`) writes an order in `check` or an open Earn Income
  job straight into the ledger and rolls, rerolls, pays and reads back; the live driver's behaviour checks
  `craft-gear-bonus` (Alchemist Goggles worn and invested: the wrapper's roll gets their +1, the system Craft path
  does not), `craft-rarity-dc` (an uncommon item: the roll's DC is the order's frozen DC with +2), `craft-hero-reroll`
  (OQ-3, above) and `wage-once` (both players resolve day 1 at once and the earner once more: one wage row, the purse
  up once, the other player's claim resolved) run it.
- As built in M4: scenario `m4` (`tools/harness/order-scenarios.mjs`) and the behaviours `m4-lifecycle`, `m4-no-gm`,
  `m4-cancel`, `m4-double-delivery`, `m4-reroll-race`, `m4-shots` (screenshots with `--shots <dir>`) and `m4-ui` (the
  window driven with real clicks and keys), described in 10.10.
- As built in M5: scenario `m5` (`tools/harness/formula-scenarios.mjs`) and the behaviours `m5-buy`, `m5-ally-copy`,
  `m5-pick`, `m5-jobs`, `m5-etch`, `m5-upgrade-transfer`, `m5-precious`, `m5-scroll`, `m5-services`, `m5-ui` and
  `m5-shots`, described in 10.11; first run in the M5 live pass (10.11), which added the step `seen` (wait until this
  client's copy has a record another client wrote) and finds items by their source name too (`named`). As built in M5
  on M4.1: `m5-fund`, and the `acquire`, `fulfil`,
  `buyCasting` and `service` steps take `paidFrom`; the server view adds each row's `alloc` and `order`, and the
  unallocated and earmarked totals.
- As built in M6: scenario `m6` (`tools/harness/downtime-scenarios.mjs`) and the behaviours `m6-clock`, `m6-wizard-gm`,
  `m6-wizard-players`, `m6-communal`, `m6-income` and `m6-settlement`, described in 10.12; first run in the M6 live pass (10.12). They move the world
  clock forward only; the prompts are read from the pages' notification log by their keys.
- As built in M7: scenario `m7` (`tools/harness/morning-scenarios.mjs`) and the behaviours `m7-morning`, `m7-expiry`,
  `m7-rest`, `m7-dailies`, `m7-standing`, `m7-affix` and `m7-shots`, described in 10.13; first run in the M7 live pass (10.13). They are scenario 4
  of the list above: `m7-rest` with pf2e-dailies off and `m7-dailies` with it on, which the plans switch in the world's
  `core.moduleConfiguration` (with lib-wrapper) and load by reloading every page, putting it back afterwards. Rest for the
  Night is pf2e's own action (`game.pf2e.actions.restForTheNight` with `skipDialog`), and pf2e-dailies' window is driven
  by its own controls.
- As built in M8: scenario `m8` (`tools/harness/combat-scenarios.mjs`) and the behaviours `m8-panel`, `m8-bandolier`,
  `m8-turn`, `m8-vials`, `m8-healing-bomb`, `m8-duct-tape`, `m8-use-best`, `m8-hud` and `m8-shots`, described in 10.14; first
  run in the M8 live pass (10.14). They are scenarios 5 and 6 of the list above. `m8-panel` and `m8-bandolier` drive the
  windows without a canvas; `m8-hud` needs `--canvas`, stages its own scene (`arena`: a marked scene with Player One's token,
  active while it runs, the world's own scene active again afterwards) and says it was skipped without one. Encounters are
  made of token-less combatants, so the turn plans need no scene either; Duct Tape is a stand-in package entry on each client
  when it is not installed. As built in the M8 live pass: the steps that Strike pass pf2e a shift-click when the user's
  `showCheckDialogs` is on (pf2e's own default), so no roll dialog waits for a click; `encounter` creates its combatants
  through the Combatant class, since pf2e's `EncounterPF2e#createEmbeddedDocuments` reads `canvas.tokens.placeables` and
  throws without a canvas; `reset` and `end` take pf2e's throw after an encounter's deletion without a canvas
  (`deleteFight`: the encounter is gone, the promise rejects); and the driver records a step that does not answer in
  150 s as failed instead of waiting for ever.
- As built in M8a: scenario `m8a` (`tools/harness/affliction-scenarios.mjs`) and the behaviours `m8a-strike`, `m8a-cloud`,
  `m8a-once`, `m8a-powerful`, `m8a-timing`, `m8a-forge`, `m8a-backends`, `m8a-panel`, `m8a-familiar` and `m8a-shots`, described in
  10.15; first run in the M8a live pass (10.15). They are scenario 12 of the list above. `m8a-strike` needs `--canvas` (a
  Strike's target is a token) and says it was skipped without one; it places its tokens on M8's marked scene and Strikes with
  a click that skips pf2e's dialog, as M8's steps do. Affliction Forge is a stand-in package entry on each client when it is
  not installed, which throws on a player's client as its engine does. The `roll` step waits until the target's client has
  applied the exposure claim; a plan that needs a running affliction types a DC no fixture makes (`M8A.failDc`).
- As built in M9: scenario `m9` (`tools/harness/craft-scenarios.mjs`) and the behaviours `m9-tattoo`, `m9-simple`, `m9-graft`,
  `m9-fulu-missive`, `m9-staff`, `m9-snares`, `m9-gadget` and `m9-shots`, described in 10.16; first run in the M9 live pass
  (10.16). They are scenario 14 of the list above. They use the fixtures (12, 13, 6, 7, 8, 9 of 15.4), owned by the GM, with
  the GM's steps paying from Player One's purse; `m9-graft` gives the cleric Graft Technician and an effect that makes it
  expert in Medicine. As built in the M9 live pass: `run` rolls the Craft check with the die at `params.face` (`withDie`), and
  every plan that crafts passes `M9_FACE` and checks that the order completed, since a failed check skipped every check
  after the finish and the plan passed; `snares` takes the snare out of the pool before preparing it, since pf2e keeps
  `expended` on an entry and a slot an earlier run deployed came back spent.
- As built in M9a: scenario `m9a` (`tools/harness/variant-scenarios.mjs`, using M9's `m9` steps to file and work orders) and the
  behaviours `m9a-notice`, `m9a-complex`, `m9a-quick-setup`, `m9a-deconstruct`, `m9a-grow`, `m9a-garden`, `m9a-quest`,
  `m9a-adjust`, `m9a-secret`, `m9a-shots` and (from the M9a live pass) `m9a-off`, described in 10.17; first run in the M9a live
  pass (10.17). They are scenario 13 of the list above. The two
  player characters are fixtures 3 and 6; the legacy alchemist (14) rolls the rushed finish's flat check, which the master
  fighter cannot fail, and the druid (15) is lent to Player One for the Grow plan, so its season check has an owner online
  with no GM; `reset` turns every variant setting back to its default and gives the druid back. As built in the M9a live pass:
  `roll` takes `params.face`, or `params.degree` (`faceFor`: the face that aims the total 4 above the DC for a success, from the
  crafter's statistic, off the natural 1 and 20), and every plan that crafts, deconstructs or grows fixes the die and checks
  the order reached the state its later checks need; M4's `roll` takes `params.face` too. `audit` hooks every create and
  update of journal entries and pages, actors, items, chat messages and settings on one client (the GM's, which sees every
  client's writes) and flags the key paths only a variant writes (`VARIANT_WRITE`), a variant setting and a variant card;
  `markers` opens each tab of the Workshop and the request form and reads the variant markers (buttons, sections, fields) and
  any variant string that no other key shares, there and in the chat cards posted since the audit began.
- As built in M11: scenario `m11` (`tools/harness/integration-scenarios.mjs`) and the behaviours `m11-sheet`, `m11-companions`,
  `m11-party`, `m11-context`, `m11-shelf`, `m11-macros`, `m11-keys`, `m11-keyboard`, `m11-themes` and `m11-shots`, described in
  10.18. They are scenarios 8 (keyboard) and 10 (accessibility) of the list above, and the Toolbelt and Workbench rows of the
  companions axis (15.5). `m11-companions` switches the two modules in the world's `core.moduleConfiguration` (with lib-wrapper)
  and reloads every page, as `m7-dailies` does, and puts the configuration back; `m11-shelf` drags with Playwright's
  `dragAndDrop`, which dispatches the HTML drag events the hotbar reads; `m11-keyboard` binds Open Workshop for the plan only.
  The steps `audit` (names, tab indexes, images, tab lists and the contrast of every text node against what is behind it) and
  `focus` read the page as a user meets it. Not run yet.
- As built after the first live runs: the scenario steps were fixed where they, not the module, failed. `purseAfter`
  counts the rows that are new since `purseBefore` by id, not by a server-time cut-off (two devices' estimates of
  the server's time differ by milliseconds, and one real row was left out); the `claim` step reports its own rows
  as `claimRows` (the snapshot's row total used to overwrite them); a GM's refund steps fill the strongbox from the
  claim's own character (a GM has none), and `7/refunds` writes its claims in one write; `7/race` waits until the
  claim it races on has reached its client, and the plans race it with Player One's auto-claim off, since Player
  One's own sweep applies the claim half a second after it appears and, with the canvas on, could win the race.

### 15.4 Fixture actors

Generic builds created by a script from compendium items (`tools/harness/fixtures.mjs`, built by
`fixture-actors.mjs`). Every build is a human with no heritage or background and directly entered
attribute modifiers; its choice-set answers are part of the definition, so building it raises no
prompts. The class features are added one feature level at a time, the way levelling up adds them. The
NPC targets of row 17 are the Monster Core Goblin Warrior, Skeleton Guard and Frost Giant.

As built: the builder fills in the choice sets of the items it creates and gives their GrantItem rules the
fixture's answers as `preselectChoices`, which pf2e applies to the item each grants and no further
(`#applyChoicePreselections`, pf2e `src/module/rules/rule-element/grant-item/rule-element.ts`). An item two or more
grants deep is cloned by the inner grant from the compendium itself, so the cleric's Domain Initiate (First Doctrine
grants First Doctrine (Cloistered Cleric), which grants Domain Initiate) opened pf2e's prompt live. A fixture lists
such items as `nested`; the builder sets their choice sets' selections on the compendium copies pf2e loads (the
pack's cached documents, which `fromUuid` returns) for the length of the build and puts them back afterwards.
`PF2E_SRC=<checkout> npm test` models how far preselections reach and fails on a deep choice set left unanswered.

| # | Build | Exercises |
|---|---|---|
| 1 | Toxicologist alchemist, level 1 | base pools, formula picks, Quick Alchemy, poison field vials |
| 2 | Mutagenist alchemist, level 5, Efficient Alchemy, Improvise Admixture | batch of 8, Powerful Alchemy DCs, vial regain, field vials |
| 3 | Bomber alchemist, level 11, Talisman Dabbler via Free Archetype, Quick Fix | Double Brew, Advanced Vials buckets, virtual talisman list, DC stamp, affix time |
| 4 | Chirurgeon alchemist, level 9, Healing Bomb, Communal Crafting, Enduring Alchemy | Healing Bomb (Quick Alchemy only, one additive), helpers, expiry exceptions |
| 5 | Toxicologist alchemist with Poisoner Dedication, level 8 | merged advanced-alchemy pool, poison vials with the Poisoner pool, 24-hour expiry |
| 5b | Mutagenist alchemist, level 16, Extend Elixir, Eternal Elixir, Persistent Mutagen | the 10-minute cap and its exceptions (8.8) |
| 6 | Fighter, level 10, master Crafting, Magical Crafting, Specialty Crafting (blacksmithing), Inventor | runes, upgrades, precious materials, invent, specialty roll option |
| 7 | Wizard, level 9 | casting pledges for scrolls and a wand |
| 8 | Ranger, level 8, Snare Crafting, Snarecrafter Dedication | prepared snare slots, downtime snares |
| 9 | Inventor, level 6, Gadget Specialist, Reverse Engineer | gadgets and access, reverse-engineering |
| 10 | Thaumaturge, level 8, Talisman Esoterica | GM Core-only virtual list |
| 11 | Witch, level 10, Cauldron, Double, Double | daily oils and potions |
| 12 | Rogue, level 7, master Crafting, Tattoo Artist, Experienced Professional (expert Cooking Lore) | tattoo process, Earn Income with Lore |
| 13 | Cleric, level 5, trained Crafting, no crafting feats | helper (Religion), Aid, roster without feats |
| 14 | Legacy alchemist (infused reagents) | graceful degradation |
| 15 | Druid, level 8, expert Crafting, Magical Crafting, trained Herbalism Lore | Grow, untended growth, gardens, the nature skill settings |
| 16 | Rogue, level 6, Poison Weapon, Poisoner Dedication | coatings, Poison Weapon's untracked simple poisons, Acquired Tolerance |
| 17 | NPC targets from the system bestiary packs: one ordinary creature, one immune to poison, and one of 9th level or higher | NPC saves, immunity, the toxicologist's acid conversion, incapacitation against Lethargy Poison |

### 15.5 Compatibility matrix

| Axis | Values |
|---|---|
| Foundry | the manifest minimum, the Forge's current build, the latest stable |
| pf2e | the manifest minimum minor, the latest release, the dev head (registry only) |
| Companions | none; each of section 13 alone; all together |
| Users | 2 players without a GM; GM and players; GM and assistant GM |
| Host | self-hosted Node; the Forge, covered by the first pre-release table run (15.6) |
| Presentation | light, dark, Parchment; widths 1024 (sidebar open), 1280, 1440+, detached |

### 15.6 What only the Forge can test

Installation and updates from the Bazaar and the listing lag; module templates, language files and CSS
served from the Forge CDN through relative paths; behaviour with the Forge's replaced FilePicker (the
module uses none) and its asset handling; `CONFIG.queries` relay behaviour there; load time with a large
module list; which build the Forge's default channel runs.

There is no dedicated Forge test world. The first pre-release run at a real table hosted on the Forge
(M12) is the Forge smoke test: before that session the GM installs the pre-release by manifest URL, and
the items above are checked off during and after it. Anything that fails there blocks M13.

### 15.7 As built in M12: the companions matrix and the performance pass

Run 2026-10-27 on the dev server (Foundry 14.368, pf2e 8.6.1, no canvas), from the M12 branch with main's M11 live pass merged.

**Companions matrix.** The core plans, once with pf2e-dailies, PF2e Toolbelt, PF2e Workbench and Item Piles all off in the
world's `core.moduleConfiguration` (lib-wrapper and socketlib left on) and once with all four on, every page reloaded after each
switch; the world had all four on before and was put back exactly. With all four on, a player's page had pf2e-dailies' API
(with the Workshop's custom daily), Item Piles' API and libWrapper.

| Plan | All four off | All four on |
|---|---|---|
| scenario 7 (`modifyBatch` failure, lock races) | pass (11 checks) | pass (11) |
| `m4-lifecycle` | pass (14) | pass (14) |
| `m5-fund` | pass (8) | pass (8) |
| `m6-income` | pass (7) | pass (7) |
| `m7-morning` | pass (14) | pass (14) |
| `m8-turn` | pass (7) | pass (7) |
| `m9a-off` | pass (21) | pass (21) |

The console errors were the same in both runs and the same as the M11 regression run's: the lock collisions scenario 7 and
`m6-income` cause on purpose, and pf2e's own `Cannot read properties of null (reading 'id')` in `m8-turn` without a canvas.
Not covered: each companion alone (15.5's middle row), Duct Tape (stand-ins only, as in M8) and a calendar module.

**Performance pass** (`npm run harness:perf`, `tools/harness/perf.mjs`; scenario 11 of 15.3, grown to the size asked of M12).
Five members (the players' two characters and three copies of fixture actors), then three stages: S0, the world as every plan
starts it; S1, 30 orders in every state, their money and rolls through the module's own functions, every member in downtime
(three on Earn Income jobs) and one Advance days run of 60 days; S2, S1's records copied to 200 orders and 2000 rows, with the
lock pages of the copied rows and the coins they hold. Medians of five runs, in ms; the GM's client unless a player is named.
"Before" is main at `a447c9b`, "after" the fixes below (served from main's working tree for the run, then taken back out).

| | S0 | S1 before | S1 after | S2 before | S2 after |
|---|---|---|---|---|---|
| Ledger: orders, rows, day records, lock pages | 0, 0, 0, 0 | 30, 248, 300, 826 | 30, 248, 300, 474 | 200, 2000, 504, 2600 | 200, 2007, 504, 2209 |
| Ledger size (JSON; flags alone) | 4 KiB | 893 KiB (277 KiB) | 614 KiB (277 KiB) | 3.8 MiB (1.5 MiB) | 3.1 MiB (1.5 MiB) |
| Workshop open: first in the page, then | 100, 7 | 100, 39 | 116, 22 | 273, 184 | 173, 88 |
| Queue part | 1.4 | 17 | 11 | 148 | 57 |
| Funds part | 1.4 | 23 | 14 | 39 | 27 |
| Downtime part | 4 | 6 | 8 | 10 | 10 |
| A live refresh on the Queue tab | 4 | 34 | 19 | 182 | 82 |
| What one ledger change costs each open window (Player One) | 6 | 46 | 13 | 175 | 62 |
| Reconciliation (`reconciliationReport`) | 0.0 | 0.2 | 0.2 | 1.6 | 1.0 |
| A plain ledger write, to its answer | 4 | 90 | 59 | 240 | 202 |
| A deposit (a lock-first move), to its answer | 45 | 500 | 361 | 1625 | 1329 |
| Advance days through the wizard, 7 days, 5 PCs, 3 earners: the commit | | 12.0 s | 1.6 s | 39.7 s | 9.5 s |
| Renders of each open window during that commit | | 39 | 9 to 10 | 55 | 18 to 19 |
| Advance days of 60 days for the five (S1's staging) | | 62 s | 1.5 s | | |

The wizard's own steps (span to who, who to checks, checks to review) took 53 to 97 ms at every size. Player One's numbers
match the GM's within a few ms, except that a player's Funds tab has no reconciliation block.

- **Budget.** DESIGN set no number for a re-render; this pass judges by 50 ms (about three frames), as the M12 brief asked.
  After the fixes S1 is inside it everywhere; at S2 the Funds and Downtime tabs are, the Queue is not (57 ms alone, 82 ms for a
  refresh with the header), nor is what a change costs a window showing the Queue (62 ms).
- **Hotspots** (CPU profiles of the GM's page, self time). Before the fixes, at S2: `liveRecords` 31% of a Queue render (each
  order read every row and day record of the ledger: `orderRows`, `orderDays`), Foundry's `_syncPartState` 26%, `money` and
  `number` 13% (a new `Intl.NumberFormat` for every amount; `when` made an `Intl.DateTimeFormat` for every row). After them: the
  Queue render is Foundry's (`_syncPartState` 55%, `#parsePartHTML` 9%: the DOM of 200 order rows, about 8800 elements), and a
  ledger change costs every client Foundry's re-initialisation of the whole ledger (`_deepClone`, `_initialize`, 15 to 20% of a
  deposit's CPU on each client) before any of the module's code runs. Opening the window forces a layout in `#syncTooltips`
  (`clientWidth`), about half of an open's CPU at S2. Reconciliation is never more than 2 ms.
- **What a write costs is decided by the lock pages.** A throwaway journal entry, one small flag written eight times: 3 ms with
  nothing else in it, 40 ms with 1.3 MB of flags (4000 row-sized records) and no pages, 177 ms with small flags and 2600 pages
  shaped like lock pages. The ledger's lock pages (5.4) are never pruned until archiving (5.3.3), which is not built, so every
  write, on the server and on every client, gets slower for the life of the world: at S1 (60 workshop days of five characters)
  a write took 25 times what it took on a fresh ledger, 15 times after the fixes. The batched wages (below) took S1's pages
  from 826 to 474.
- **OQ-36.** The archive ages (30 and 60 workshop days) cannot be tuned before archiving exists. What the pass shows is that
  the bound has to be on the lock pages: as long as they live on the ledger, a plain write took 59 ms with 474 of them, 90 ms
  with 826, 202 ms with 2209 and 240 ms with 2600, whatever the age of the orders. Either archiving prunes lock pages by count as well as by age, or the lock
  pages move to a journal entry of their own, so that the ledger's updates do not carry them (both are design changes; the
  author decides).

Fixed in this pass (each with a test that fails without it):

- **The wages of a span** were paid one move per day (`payWage` in a loop): a week of three earners was 21 lock-first batches,
  each slower as the ledger grew, each re-rendering every open window. Now each job's span is one move (`payWages`, 6.10),
  and the sweep pays a job's owed days the same way (`test/foundry/downtime.test.mjs`).
- **A live refresh rendered every tab**, the hidden Queue, Funds and Downtime parts included, on every client after every
  ledger change. It now renders the header, the status bar and the shown tab; a hidden tab renders when it is shown (10.1;
  `test/foundry/ui-m6.test.mjs`).
- **The Queue read the ledger per order**: it now groups the rows and day records by order once per render and reads the rules
  once (`orderContext` takes them; `test/foundry/ui.test.mjs`).
- **A formatter per amount**: `number` and `when` keep one `Intl` formatter per interface language (`test/foundry/format.test.mjs`).

**Follow-ups** (low, except the first two, which are the archiving work 5.3.3 already describes):

- Archiving (5.3.3) and with it the pruning of lock pages (5.4) are built in no milestone; until they are, a long campaign's
  ledger only grows, and every write with it (above). Medium for 1.0: worth a milestone of its own before the listing.
- The Queue lists every order ever made, the closed ones until archiving: at 200 orders its render is over budget, and most of
  it is Foundry's work on the DOM. Archiving answers it; a collapsed "Closed" group or paging would until then.
- An Advance days commit writes each PC's days in its own request, then each earner's wages, then the logged-day mark and the
  card: 10 requests for five PCs, each a ledger update every client re-initialises. One request for all the PCs' days would
  shorten it further.
- Opening the Workshop reads `clientWidth` right after rendering (`#syncTooltips`), which forces a layout of the new DOM in the
  open's own time.
- The performance pass cannot profile the server (the dev server runs without an inspector and the pass does not restart it);
  the probe journal above stands in for it. Its copies of S1's records repeat S1's orders (the same items, crafters and
  states), and a copied order's work days get ids that are not day records (`-p<n>`), so they count for the order only.

---

## 16. Release and compliance

### 16.1 No release before the full scope

Internal milestones (section 17) are tested privately and on a test table through a pre-release manifest
URL. Nothing is listed on foundryvtt.com until the whole scope in section 1 is done.

### 16.2 GitHub Actions

- **On pull request:** Node 24; `npm ci` (dev dependencies only: ESLint); lint; `node --test`; manifest
  checks (valid JSON, `id` matches, no "v" in `version`, `download` points at `/releases/download/`);
  registry validation against the pinned tag; strings gate in report mode; asset policy check.
- **On release published** (GitHub fires this for pre-releases too): the same checks. The strings gate
  and the registry completeness check (6.11) run in enforce mode only when
  `github.event.release.prerelease` is false; pre-releases run them in report mode, are never
  registered with the Package Release API, and keep their version-specific manifest URL, so the
  test-table build of M12 can ship before the author's rewrite in M13. Then stamp `version`,
  `manifest` and `download` into `module.json`; zip only the shipped files (`module.json`, `scripts/`,
  `templates/`, `styles/`, `lang/`, `LICENSE`, `README.md`, `CHANGELOG.md`), never `docs/` (the package description
  and the README screenshots of 17.1); upload `module.json` and
  `module.zip`; then, for stable releases only, register the release with the Package Release API.
  Actions are pinned by commit SHA.

### 16.3 Manifest URLs and the Package Release API

- `manifest`: `https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/latest/download/module.json`
  (GitHub "latest" skips pre-releases, which makes it the stable channel). Pre-releases set their own
  `manifest` to their version-specific URL, so testers stay on the pre-release channel.
- `download`: `https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/download/<tag>/module.zip`.
- The tag is the bare version (`0.3.0`, no "v"), so both URLs follow from `version`. Until the first
  pre-release, `module.json` has version `0.0.0`, `flags.MOD.unreleased: true` and placeholder URLs of
  this form; `tools/check-manifest.mjs` checks all of this.
- Package Release API: `POST https://foundryvtt.com/_api/packages/release_version/` with the package
  release token from a repository secret; the body carries `id` and `release: {version, manifest, notes,
  compatibility}`, where `manifest` is the version-specific URL, never `/latest`. The first run uses
  `"dry-run": true`. At most one release per 60 seconds.

### 16.4 Strings sign-off gate

Foundry's AI Content Policy requires listed packages to have human-authored UI text, descriptions and
journal text, and no AI-generated images. During development, strings in `lang/en.json` are
machine-drafted placeholders; the author rewrites all of them before listing.

- `lang/en.json` has flat, stable keys. Code and templates reference keys only; pf2e's own `PF2E.*`
  keys are reused for skills, traits, rarities and coins.
- `lang/review/en.signoff.json` maps each key to the SHA-256 of its normalised value (trimmed, Unicode
  NFC, whitespace collapsed) at the time the author signed it off.
- `tools/signoff-strings.mjs --keys ...` is run by the author to record hashes for strings they have
  rewritten; the commit is the author's. Keys may end in `*` to match a prefix; `--all` signs off every
  current string, for use only after the full rewrite. Entries for keys that no longer exist are
  dropped.
- `tools/check-strings.mjs` fails when any key is missing from the sign-off file or its hash differs;
  it prints the offending keys. Report mode in pull requests and pre-releases (`npm run check:strings`),
  enforce mode on stable releases (16.2; `npm run check:strings:enforce`). A malformed language or
  sign-off file fails in both modes, and a usage error (an unknown argument, or `--mode` missing its
  value or given twice) exits 2 rather than falling back to report mode.
- The same mechanism covers `README.md` and the package description file (`docs/package-description.md`),
  hashed whole under the keys `file:README.md` and `file:docs/package-description.md`, and the
  `module.json` `title` and `description` that Foundry shows, under `module.json:title` and
  `module.json:description`.
- The gate proves sign-off, not authorship; the rewrite itself is the author's process.

### 16.5 No AI assets

The repository contains no images, audio or fonts, except the README's screenshots of the module's own window
(17.1), which never ship. Icons are Font Awesome classes (bundled with Foundry
v14), Foundry core icons or pf2e system icon paths; item images come from the compendium. A CI check
fails if any image, audio or font file appears outside an empty allowlist and the screenshots' folder.

`tools/check-assets.mjs` looks at every file git would track: media by extension (images including SVG
and SVGZ, audio, video, fonts), media under another name by its leading bytes, and any file that is not
UTF-8 text at all. In the files that ship or are published (the release zip of 16.2, the package
description and `macros/`) it also fails media embedded as a `data:` URI of a media type, any base64
`data:` URI (a font or image declared as `application/*`), or inline `<svg>`; files that never ship, such
as this one and the tests, may name those patterns. The allowlist is a constant in that script; adding a
path to it needs a `DECISIONS.md` entry. In `docs/screenshots/` it allows a `.png` file directly in the folder whose
leading bytes are a PNG and that weighs at most 400 KiB (`SCREENSHOT_MAX_BYTES`); any other file there, and an image
anywhere else, fails as before (`test/check-assets.test.mjs`).

### 16.6 Licences and notices

- Code: MIT (`LICENSE`).
- The module ships no Paizo text. It does ship numeric mechanics (the tables in 6.1 and 6.16, rarity
  adjustments, thresholds and caps, the affliction overrides of 8.10.2), which come from ORC-licensed
  Remaster books (Player Core, Player Core 2, GM Core, Treasure Vault (Remastered)), plus the Secrets of
  Magic tattoo process and the numbers of badged legacy registry entries (OGL 1.0a). The README carries
  an ORC notice (licence location, attribution of the upstream works, reserved material) and an OGL 1.0a
  section 15 entry for each OGL source used.
- The package title is "PF2e Artisan's Workshop". The README and the package description carry Paizo's
  Community Use Policy notice, copied exactly from paizo.com, alongside the ORC and OGL notices above.
- The title uses "PF2e", never "Pathfinder", "Paizo" or an adventure path name. The README states that
  the module is unofficial and not endorsed by Paizo.

### 16.7 Internationalisation

All strings go through `game.i18n.localize` and `format` with named placeholders; no sentence is built
by concatenation. Item, feat and spell names come from the compendium at runtime, so Babele-based pf2e
translations apply. Translations are accepted as language-file pull requests only when reviewed by a
fluent speaker (the AI policy allows machine translation only with fluent review); a Weblate project can
follow once the English strings are signed off.

### 16.8 Support files

Issue forms (bug report requiring Foundry build, pf2e version, host, module version, other active
modules and console errors; blank issues disabled), a Keep-a-Changelog `CHANGELOG.md`, and a "For GMs"
README section: what the module changes, every setting, how to turn it off, how to remove its data.

---

## 17. Build order

Milestones in dependency order. No public release until M13. M8a and M9a were added after the first
draft; the letters keep the existing milestone numbers stable.

| # | Milestone | Contents | Depends on |
|---|---|---|---|
| M0 | Scaffold | `module.json` (unreleased), folder layout, ESLint rules, `node --test` harness, strings gate and asset check scripts, PR workflow, local Foundry harness with fixture-actor script | |
| M1 | Rules core | 6.1-6.8 and 6.10 as pure modules with tests; coin planner; pro-rata splitter | M0 |
| M2 | Storage and sync | shared documents and bootstrap, schema and migrations, key-path store, responsible-client resolver, claims, `modifyBatch` coin moves, roster snapshots, deletion guards, purge, reconciliation | M1 |
| M3 | Registry and roll wrapper | registry tiers 1-2, validation script, roll wrapper with reroll recording, Earn Income roll | M1, M2 |
| M4 | Queue and Funds | Workshop shell, Queue and Funds tabs, order lifecycle, escrow and refunds, pickup shelf, chat cards, request drag and drop; built, with the 5.11 and 6.12 follow-ups (10.10) | M2, M3 |
| M5 | Formulas | codex, families, provenance, acquisition jobs, picks owed, casting pledges, precious materials, service orders, rune etching, upgrades and transfers; built, live plans run (10.11, M5 live pass) | M4 |
| M6 | Downtime | per-PC status, clock accrual and prompts, day resolver, Advance days wizard, Communal Crafting helpers, Earn Income jobs, settlement profiles; built, first live pass run (10.12) | M4 |
| M7 | Morning | daily sources panel, loadouts, standing orders, Talisman Dabbler and Esoterica lists, the Dabbler DC stamp, affix records, party-wide expiry, rest ordering, pf2e-dailies custom daily; built, first live pass run (10.13) | M5 |
| M8 | Combat | Bandolier, HUD palette, Quick Alchemy panel, quick vials, Quick Bomber, Healing Bomb, additives, vial gathering, turn expiry, Duct Tape step-aside, Use best consumable; built, first live pass run (10.14) | M7 |
| M8a | Afflictions | 8.10: the affliction rules engine with tests; the parser, `scripts/data/afflictions.mjs` overrides and the corpus check in the validation script; backend detection, the effect backend and the native backend with its constraints and migration; grant flags and the stage guard; exposure and coating-spend claims; coatings and Strike handling; saves (with the source item, for incapacitation), recording and pending state; turn and world-time timing, catch-up and the affliction time function for logged days; the DC stamp at creation; Afflictions drawer and cards; Affliction Forge coexistence and the GM-routed hand-off; harness scenario 12; built, first live pass run (10.15) | M3 (validation script, roll recording), M6 (day resolver for logged days), M7 (creation stamps, infused expiry), M8 (Bandolier entry point) |
| M9 | Tattoos and remaining crafts | tattoo process and toggle, grafts, spellhearts, fulus, missives, snares and gadgets specifics, spell-supplied items beyond scrolls and wands; harness scenario 14; built, first live pass run (10.16) | M5, M6 |
| M9a | Treasure Vault (Remastered) variants | 6.16 behind their settings: Complex Crafting and Quick Setup (setup, rush, sub-day setups, rushed finishing), crafting with adjustments, downtime events, Critical Crafting, Deconstruct and components, Grow with untended growth and seasons, gardens, bestowed gifts, crafting quests; the one-group-at-a-time notice; harness scenario 13; built, live plans passed (10.17, M9a live pass) | M5 (service orders, materials, Repair), M6 (day resolver, seasons, events), M7 (expiry stamps and the inert guard for produce, components and gifts) |
| M10 | Extension API | registration, interfaces, hooks, extension store; the separate circus module built against it as acceptance test; built, live plans not yet run (12.6) | M6 |
| M11 | Integration surface | sheet and party entry points, macros and shelf, keybindings, theming, accessibility pass; built, live plans not yet run (10.18) | M4-M9a |
| M12 | Hardening | full section 15 matrix, performance, pre-release to a test table by manifest URL; the first pre-release run at a real table hosted on the Forge is the Forge smoke test (15.6) | M10, M11 |
| M13 | Listing | author rewrites every string, README and description; sign-off gate passes; notices final; release workflow dry run; listing submission; 1.0.0 | M12 |

### 17.1 Scheduled task: README screenshots

- **When:** a first pass right after M5's live pass; refreshed whenever a milestone adds a tab, and a mandatory
  refresh at M13 after the author's strings rewrite (until then the captures show draft wording).
- **How:** `npm run screenshots` (`tools/harness/screenshots.mjs`, reusing `run-live.mjs`) stages a demo party
  with generic character names (no fixture labels, no real player's character), orders in several states and
  some funds, then captures the Workshop window cropped to its frame: Queue, an order's detail, the request form,
  Funds, and Formulas once M5 lands. Dark theme at 1440x900, plus one light capture.
- **Where:** `docs/screenshots/`, which the release zip leaves out; the asset check (16.5) allows that folder
  only. README gets a Screenshots section that links them.
- **Policy:** captures of the module's own UI are not AI-generated images, so Foundry's AI Content Policy
  permits them.
- **Open question for the author:** pf2e item icons appear in the captures. They come from the pf2e system,
  which uses Paizo material under its own agreement; other pf2e modules show them in their READMEs. Accept that,
  or stage the demo orders with items whose icons are generic.

**As built (first pass, 2026-10-26).** `npm run screenshots` (`tools/harness/screenshots.mjs`) uses the live driver
(`run-live.mjs`, its `screenshot` now able to crop to an element) and `live-plans.mjs`'s preparation and reset. The demo
party is four copies of fixture actors (the bomber alchemist, the fighter crafter, the wizard, the druid grower) named
Ilsa Marrow, Doran Vell, Wren Ashdown and Tamsin Reed, marked `flags.world.pf2e-artisans-workshop-demo`, with their own
purses and empty formula books. For the run they are the party's members and Player One's and Player Two's characters;
what the party and the users had is kept on the party's `flags.world`, so a run that stops half-way is undone by the
next. Each staging step runs on the client of the user who would take it at a table (Player One crafts as Ilsa, Player
Two pays as Doran, the GM plays the other two), through the module's own functions, and the demo's Craft checks roll a
fixed 12, so every run stages the same: an order requested and unfunded; one accepted and part-funded from a purse and
the party fund; one in setup; one finishing after its check and two days of work on the rest; one complete and
delivered; 100 gp added to the party fund, 39 gp of it still unallocated; three formulas, bought from the fund, taken for
an owed pick and copied from an NPC. It captures as Player One at 1440x900, cropped to the window's element with
everything beside it hidden: `queue.png` (the finishing order's detail), `request-form.png`, `funds.png` and
`formulas.png` in the dark theme, `queue-light.png` (the complete order's cost summary) in the light one. Each capture is
checked for raw i18n keys, the fixture actors' and the imported character's names, and boxes that overflow, then
compressed with ImageMagick when it is installed (the light theme's parchment needs 256 colours to stay under 400 KiB).
At the end the module is switched off, the party and the users get their own back, the demo actors and the run's chat
messages are deleted, and the shared documents are reset as `harness:live` leaves them. README's Screenshots section
links the five with draft captions (the same text as `CAPTURES`, which a test holds them to); tests in
`test/screenshots.test.mjs` and `test/check-assets.test.mjs`. No release workflow exists yet; 16.2's zip list leaves
`docs/` out. The first captures were taken from the checkout the dev server runs (main at a87dd5c: M5 on M4.1), so
they show no Downtime tab; refresh them once M6's live plans have run. The icon question above stands: the alchemical
items show pf2e system icons, Healing Potion (Lesser) and Mistform Elixir (Moderate) Foundry core ones; `ITEMS` in the
script is the one place to change for generic icons.

**Refresh after M6's live pass (2026-10-26).** `downtime.png` (the Downtime tab as Player One) joins the five, after
`formulas.png`. The staging adds downtime, each step on the client of whoever would take it: the GM saves a settlement
profile (Millbrook, a town, task levels up to 4, Crafting up to 6, `SETTLEMENT`) and moves the world clock; Player One
puts the party there, Ilsa in downtime, takes an Earn Income job at Crafting 6 (its check a fixed 12, like the Craft
checks) and, once the clock has passed the days her order work already took, resolves two days of it (two wages paid);
then Ilsa's days go to the finishing order and the clock moves one more day, which she has still to resolve (the tab's
badge reads 1 in every capture). The world clock only moves forward, so the script is for the dev world only, as the
M6 plans are. At the end the settlement profile is deleted with the rest. All six captures were looked at: no raw keys,
no overflow, no fixture names; the follow-ups above still show.

**Follow-ups seen in the first captures** (all low, all in the window's layout or wording):

- Formulas tab, "Learn a formula": at the default window width the routes table squeezes its Route column to a word per
  line ("no formula (2 setup days)") while the Cost column's hint takes the room (`formulas.png`). (Fixed in M11, 10.18.)
- Header: "Acting as" wraps onto two lines beside a character name with its level, "Ilsa Marrow (level 11)" (every
  capture). (Fixed in M11, 10.18.)
- Order detail: "Setup 1 of 1 days" (a plural with one; `queue.png`, `queue-light.png`). (Fixed in M11, 10.18.)
- Light theme: the order detail's labels (`.detail-facts dt`) carry a 1px black text shadow (computed
  `rgb(0, 0, 0) 1px 1px 0px`, from outside the module's stylesheet) that reads as smudged on the parchment
  (`queue-light.png`); `text-shadow: none` on them would fix it. (Fixed in M11, 10.18.)
- "Spent, by source" lists its sources in no fixed order: two runs of the same staging showed the party fund and Wren
  Ashdown in either order. (Fixed in M11, 10.18.)
- Order detail heading: the quantity sits inside the `<h3>` (`templates/workshop/queue.hbs`, the detail's title), so
  "× 2" is set in pf2e's `--serif` (Eczar) and its "×" reads as an asterisk, "Antidote (Moderate) ⁎ 2" (`queue.png`,
  `queue-light.png`); in the list, where the quantity is outside the title, it reads as "× 2". Setting `.order-qty` in
  the heading in the sans font would fix it. (Fixed in M11, 10.18.)
- Request form, "Who can make it": a player in a world where pf2e hides DCs (its metagame "show DCs" off, as in the dev
  world) gets the DC column's header over empty cells (`request.mjs` blanks `dc` when `showDcs()` is false, the
  template always draws the column; `request-form.png`). Leave the column out when DCs are hidden. (Fixed in M11, 10.18.)

The README puts each caption after its image with a hard line break (a trailing `\`): with a plain newline GitHub
renders the caption on the image's line, beside the 560 px request form (`test/screenshots.test.mjs` holds it).

**As built in M7.** M7 adds a tab, so the captures are due for a refresh: `npm run screenshots` also takes `morning.png`
(`NEXT_CAPTURES` in the script: the demo alchemist's Morning tab with two talismans of the Dabbler's picker chosen, dark,
1440x900), checked and compressed like the rest but not yet linked from the README. After the next run, check it by eye,
move its entry into `CAPTURES` and add its caption to the README's Screenshots section, which the test then holds. The
live plan `m7-shots` takes the tab at both sizes and schemes as Player One and the GM into `--shots`.

**Refresh after M7's live pass (2026-10-27).** `morning.png` (the Morning tab as Player One) joins the README after
`downtime.png`, from `CAPTURES`; `NEXT_CAPTURES` is empty again, for the next new tab. The staging adds the Morning
(`stageMorning`), each step on the client of whoever would take it: Player One saves Ilsa's "Field kit" loadout for
Advanced Alchemy through the public API (`api.prep.saveLoadout`, families from `api.formulas.family`: two elixirs of life,
three alchemist's fires, an antidote, from the formulas staged before), and Player Two places Doran's standing order for an
elixir of life each morning; the capture opens the tab with the loadout as the pool's plan and two talismans picked, so it
shows the standing order due, the plan's lines (each at the best grade the pool makes, Elixir of Life (Moderate) ×3 with
the request) and the Dabbler's picker. All seven captures were looked at: no raw keys, no overflow, no fixture names;
the follow-ups above still show, and the Morning tab's own are in 10.13 (Follow-ups, from the M7 live pass).

**Refresh after M8's live pass (2026-10-27).** `bandolier.png` and `quick-alchemy.png` join the README after `morning.png`,
straight into `CAPTURES` (looked at after the run). They are the first captures of a window other than the Workshop and the
request form: each view names the element it is cropped to (`SELECTORS`: the Bandolier's and the panel's ids). The staging
adds an encounter (`stageCombat`, after the Morning): Player One fills Ilsa's vials (the copy carries the fixture's count),
the GM starts an encounter of Ilsa then Doran (token-less combatants, M8's `encounter` step), and on Ilsa's turn Player One
uses Quick Alchemy with Double Brew, an Alchemist's Fire (Moderate) by family and an Elixir of Life (Minor), and makes a
quick vial; `restore` deletes the encounter with the module off, before the demo actors go. The captures open the Bandolier
for Ilsa (round 1, five of seven vials, the three Quick Alchemy items with their potency, splash and pf2e's Strike buttons)
and the panel with "elixir" typed and the first match picked from the keyboard. The capture's text check now leaves out a
select's options other than the chosen one (a closed select shows only that one): the Bandolier's character select offers
every alchemist Player One owns, the dev world's bomber fixture among them. All nine captures were looked at: no raw keys,
no overflow, no fixture names in what shows. The fixture the demo alchemist is copied from carries two separate Elixir of
Life (Lesser) stacks and they show in the Bandolier; the panel's Additive select shows with only "None" for a character
with no additive (10.14, Follow-ups).

**Refresh after M9's live pass (2026-10-27).** `tattoo.png` joins the README after `queue-light.png`, straight into
`CAPTURES` (looked at after the run). The staging adds a tattoo (`stageTattoo`, after the afflictions): the GM gives Doran
Tattoo Artist and Eye Slash's formula, and Player Two files Eye Slash made on Ilsa with Doran crafting, which waits for
her agreement (G10). A capture may name a part of the order's detail (`scroll`): the detail is scrolled to it and the list
to the order's row (`pageScrollDetail`). All eleven captures were looked at: no raw keys, no overflow, no fixture names.

**Staged in M11 (2026-10-27).** `macro-shelf.png` (the shelf from the status bar) and `sheet-strip.png` (the demo alchemist's
Crafting tab with the strip at its top, the captured element `.tab.crafting.crafting-pane`) wait in `NEXT_CAPTURES`: after the
next run, check them by eye, move them into `CAPTURES` and add their captions to the README. The live plan `m11-shots` takes the
strip, the Party card and the shelf in both schemes into `--shots`.

---

## 18. Open questions

| # | Question | Interim default | How to settle |
|---|---|---|---|
| OQ-1 | Is `foundry.documents.modifyBatch` applied transactionally on the server, and do per-document hooks fire for batched operations? | **Settled** from the Foundry 14.368 source: not transactional (dry run of every operation, then applied in order, stopping at the first error without rollback); per-document hooks fire for batched results. Design: lock-first batches (5.4). As built in M2: a refused dry run's results are replayed on the requesting client, which then reloads (5.4) | harness scenario 7 confirms in a live world |
| OQ-2 | Does `getRollOptions("item")` on an ephemeral, unsaved item owned by the crafter return the full option set? | **Settled** live (M3): yes, type, id, slug, traits, rarity, level and category (6.12) | harness |
| OQ-3 | Do the order roll option and `context.isReroll` reliably survive Hero Point rerolls, and does the reroll message's author equal the rerolling user? | **Settled** live (M3, harness `craft-hero-reroll`): yes to both; the rerolling player's client records it once (6.12) | harness scenario 1 |
| OQ-4 | Default ownership OWNER on a module journal and a loot actor: any side effects in pf2e (for example the loot sheet's merchant mode or token behaviour)? | strongbox never placed on a scene | harness |
| OQ-5 | Roster snapshots make every member's formulas, relevant feats and skill ranks readable by all players (the UI hides ranks when pf2e's `partyStats` is off, but the data sits in a shared document). Acceptable, or publish less? | **Resolved:** publish the snapshots as designed (4.10) | author decision, 2026-10-25 |
| OQ-6 | Communal Crafting RAW gaps: helper DC, degree mapping, timing of helper rolls, leaving | **Resolved:** the helper rolls against the item's Craft DC; the helper's degree picks the Income Earned entry at (helper level − 1) and the helper's rank, as an Earn Income check would (critical success the next row, failure the failure column); a helper who leaves before the Craft ends forfeits the benefit, as a setting (6.7) | author decision, 2026-10-25 |
| OQ-7 | Legendary threshold: Player Core 17 or GM Core 16? | **Resolved:** 17, with a setting for 16 (`rules.legendaryItemLevel`, G3) | author decision, 2026-10-25 |
| OQ-8 | Does Talisman Dabbler's knowledge of talisman formulas count as having the formula, giving the 1-day setup for permanent talismans? | **Resolved:** yes (7.4) | author decision, 2026-10-25 |
| OQ-9 | Do interrupted setup days persist? | **Resolved:** yes (6.2.5) | author decision, 2026-10-25 |
| OQ-10 | Level-up mid-project: recompute the rate? Crafter swap: restart setup and check? | **Resolved:** a level-up recomputes the rate; swapping the crafter restarts setup and the check, and materials carry over (6.2.5) | author decision, 2026-10-25 |
| OQ-11 | Does a family formula also cover lower grades? PC2 Quick Alchemy states, as the normal rule, that one formula covers any level of the item; GM Core p.223 mentions only higher-level types | **Resolved:** yes for every route, with a setting to restrict coverage to higher grades (6.4) | author decision, 2026-10-25 |
| OQ-12 | Inventor setup days and uncommon/rare DC; DC for crafting a copy of a formula; reverse-engineering destroying the item (Player Core p.294 has no disassembly; PC2 Reverse Engineering still assumes the legacy one); cost of copying from an ally | **Resolved:** Inventor takes 2 setup days, with the rarity DC adjustment; a formula copy is crafted at the item's DC; reverse-engineering keeps the item (no disassembly setting); copying from an ally is free and takes 1 hour (4.3, 6.8) | author decision, 2026-10-25 |
| OQ-13 | Do Impossible Magic or Treasure Vault (Remastered) restate or change the Secrets of Magic tattoo process? Is the subject's downtime occupied? | **Resolved:** the Secrets of Magic process stands (Archives of Nethys carries tattoo process rules only from Secrets of Magic; Treasure Vault (Remastered) adds items); the subject's downtime is occupied (6.14) | author decision, 2026-10-25 |
| OQ-14 | Snares: downtime batch size, which toolkit counts, whether magical snares also need Magical Crafting | 4; artisan's toolkit; yes | rules reading |
| OQ-15 | Casting pledges: can a slot be expended through a public pf2e API; how to build a scroll or wand without pf2e's unexported builder | checklist confirmation; build from base items | pf2e source and harness |
| OQ-16 | Are downtime-crafted alchemical items infused (so Powerful Alchemy applies)? | **Resolved:** no (7.1, 8.10.4) | author decision, 2026-10-25 |
| OQ-17 | Earn Income without a settlement profile: may the player pick any task level? Size of the "other skill" DC bump | the player picks, badged "unconfirmed"; +5 | author decision |
| OQ-18 | Do Calendaria and Simple Calendar Reborn always move core `worldTime`? (The second half is settled from the pf2e source: the World Clock's day boundary does not match `floor(worldTime / 86400)`, because its date starts at `worldCreatedOn`, captured at an arbitrary time of day; 4.8 applies an offset.) | assumed yes | harness |
| OQ-19 | Mechanism for inert items: is cancelling use and Strike messages in `preCreateChatMessage` reliable? How do effect items record their origin item, for ending effects and the 10-minute cap? | as in 7.7 and 8.8 | pf2e source and harness |
| OQ-20 | Exact pf2e-dailies signal that its interface has finished, for applying loadouts afterwards | its `rested` flag returning to false | pf2e-dailies source and harness |
| OQ-21 | Worlds with several pf2e parties: one Workshop per world with orders tagged by party, or one per party? | **Resolved:** one Workshop per world, orders tagged by party (4.2.1) | author decision, 2026-10-25 |
| OQ-22 | Should Advanced Vials material choice be per vial at creation (as designed) or per throw for simplicity? | per vial buckets | playtest |
| OQ-23 | Ship a legacy rules toggle (formula always required, 4-day setup, legacy Inventor)? | **Resolved:** no legacy rules toggle; the maths is always Remaster. Legacy content is allowed and badged (P8, 6.11, 1.2) | author decision, 2026-10-25 |
| OQ-24 | Treasure Vault (Remastered) crafting variants (Complex Crafting, Critical Crafting, Deconstruct, crafting events) in scope? | **Resolved:** built, together with every other crafting variant the book defines, each as a world setting that is off by default (6.16, 14.4) | author decision, 2026-10-25 |
| OQ-25 | Track staged afflictions for crafted poisons, or treat them as ordinary items? | **Resolved:** a built-in affliction tracker on the pf2e affliction schema (8.10, 14.5); backend in OQ-47 | author decision, 2026-10-25 |
| OQ-26 | Snare placement on the map (Stealth DC from the creator's Crafting DC, 24-hour inertness) in scope? | **Resolved:** a non-goal; snares are craftable items only (1.2) | author decision, 2026-10-25 |
| OQ-27 | Can additives use per-Strike roll options instead of the system's actor-wide toggles? | system toggles | harness |
| OQ-28 | Is the Extra Vial familiar ability in the pf2e familiar pack, and how is it represented? | manual button | pf2e source |
| OQ-29 | Bomb splash templates with v14 Regions | numbers only, no placement | pf2e source and harness |
| OQ-30 | Final AppV2 class names for pf2e sheets (`getHeaderControls<Class>`) | both hook families | upstream watch |
| OQ-31 | Do DragDrop listeners survive moving an ApplicationV2 window to a detached window? | rebind on `openDetachedWindow` if needed | harness scenario 8 |
| OQ-32 | Item Piles API method names for reading merchant prices, and whether that is worth doing | no integration | Item Piles source |
| OQ-33 | Do PF2e HUD or Token Action HUD alter the core token HUD's left column? | inject anyway, null-guarded | harness |
| OQ-34 | How the Forge test will be run (trial world or a Forge-hosted test table) | **Resolved:** no dedicated Forge test; the first pre-release run at a real table hosted on the Forge is the Forge smoke test (15.6, M12) | author decision, 2026-10-25 |
| OQ-35 | Does the module rely on Paizo's Community Use Policy at all, given it ships only ORC/OGL mechanics and references by UUID? Is "PF2e" in the title acceptable to Paizo? | **Resolved:** the title is "PF2e Artisan's Workshop", with the Community Use Policy notice plus the ORC and OGL notices (16.6) | author decision, 2026-10-25 |
| OQ-36 | Archive thresholds and the ledger document size at which performance suffers | 30 and 60 workshop days; M12 measured that the lock pages, not the flags, set the cost of every write (59 ms with 474 pages, 202 ms with 2209), so the bound must be on them (15.7) | archiving (5.3.3), then `npm run harness:perf` |
| OQ-37 | Uncommon or rarer items without a formula: Player Core p.237 allows any access; GM Core p.223 requires the formula | Player Core reading: access from a known formula or a registry grant; `rules.uncommonNeedsFormula` off | Paizo errata or author decision |
| OQ-38 | Does tier-4 legacy content include items that exist only in the PF2e Legacy Data module (different UUIDs)? | **Resolved:** system packs only; items that exist only in the PF2e Legacy Data module are out of scope (1.2, 6.11) | author decision, 2026-10-25 |
| OQ-39 | Affliction rules gaps: does a virulent critical success reduce the stage at once (as designed) or count as one of the two consecutive successes; does a virulent success that changes nothing repeat the stage's effects (as designed); does the maximum duration start after the onset (as designed, supported by poisons whose onset exceeds their maximum duration)? Affliction Forge reads the virulent critical success the same way | as in 8.10.6 | rules reading by the author |
| OQ-40 | In combat, does a stage save fall at the end of the turn on which the stage began (pf2e's effect convention) or at the end of the victim's turn? | the pf2e convention, `afflictions.combatAnchor` | author decision or playtest |
| OQ-41 | Affliction Forge's data contract: how a template names the consumable it models, and how an external DC is passed | **Settled** from its `docs/API.md` and `docs/DATA_CONTRACT.md`: provenance in `definition.metadata.sourceUuid`; the DC as `saveDc` (or `saveDcs`) in the application context, required by `dcMode: "source"` checks (8.10.11) | harness scenario 12f confirms in a live world |
| OQ-42 | Complex Crafting gaps: the check's critical success, failure and critical failure follow the Craft activity; helpers are not doubled by a rushed finish; registry setup overrides (rune transfer, Inventor, Reverse Engineering) are not replaced by Table 5-1; under Proficiency without Level the rushed-finish flat check drops the item-level term along with the crafter's level | as in 6.16.1 | rules reading by the author |
| OQ-43 | Grow and gardens: is "the corresponding amount" of an untended season check one day of Income at its degree; what does a garden for a 19th- or 20th-level consumable cost (Table 2-19 stops at 20)? | one day; capped at level 20 | rules reading by the author |
| OQ-44 | When pf2e enables the affliction type in release builds, will its schema still match 8.10.1, so the migration from the effect backend copies `flags.MOD.affliction.system`? The native `handleStageChange` is not a straight fit: it applies conditions on creation (so the item is created only when the first stage takes effect), posts damage only without `system.onset`, reacts only to `status.stage` changes, and re-runs on the migration's creation, re-applying conditions and posting the current stage's damage once more. Suppress that card, or mark it as a migration re-post? | copy the schema; create native items only once a stage is active; delete the effect's non-expiring conditions before creating; mark the re-posted card | churn watch (3.3) and harness scenario 12g |
| OQ-45 | Variant details the book leaves open: the level used for an item crafted with adjustments (highest part, as designed); whether Deconstruct's 5% loss of value applies per unrepaired retry (as designed) or once; whether the deconstruct day counts toward the follow-on only when the Deconstruct succeeds (as designed) | as in 6.16.2 and 6.16.5 | rules reading by the author |
| OQ-46 | Do translated pf2e compendiums (Babele) keep the stage paragraph structure the parser reads, so only the English labels need localising? | non-English descriptions fall back to overrides and world definitions | harness with a translation module |
| OQ-47 | Affliction backend while pf2e release builds remove the `affliction` item type (8.10.1) | **Resolved:** the type's schema lives in an `effect` item on the victim; migrate to native `affliction` items if pf2e enables the type in release builds. The author asked for a built-in tracker, not a specific item type | technical, 2026-10-25 |
