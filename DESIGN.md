# Artisan's Workshop: design specification

Status: draft specification for the first release (2026-10-25). Module id `pf2e-artisans-workshop`.

This file says what the module does and how. `DECISIONS.md` says why, and it wins: if the two
disagree, this file is wrong and gets corrected. Unresolved points are listed in section 18 and
referenced inline as (OQ-n).

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
| Fulus | Craft orders in batches of 4; an expiry stamp `rule: "world"` one year after creation; a rapid option (up to 4 at full Price in 1 day, expiring after one month); the crafter's tradition trait set on the created item | Secrets of Magic p.158 (fulu trait, Crafting a Fulu) |
| Missives | Craft orders for the blank missive, then a "compose" step on the created item (Compose Missive, 10 minutes) that records it as composed | Treasure Vault (Remastered) p.84 |
| Grafts | Graft orders (`craftType: "graft"`): G4 is Graft Technician with expert Medicine; the implant uses Medicine and reuses the tattoo subject flow (consent, subject present and locked, one at a time per implanter, invest claim) | Howl of the Wild p.97 |
| Tattoos | Tattoo orders using the Secrets of Magic process by default, with a toggle for a plain Craft | Secrets of Magic p.164; Tattoo Artist (Treasure Vault (Remastered) p.118, Impossible Magic p.241) |
| Snares | Downtime Craft orders; daily quick-deploy slot ledgers shown on the Morning tab | Player Core 2 p.297 |
| Gadgets | Access-gated Craft orders; Gadget Specialist daily slots | Guns & Gears (Remastered) p.66 |
| Scrolls, wands, staves and other spell-supplied items | Craft orders with casting pledges from party casters | GM Core pp.262, 282; staff Craft Requirements |
| Repair | Service orders | Player Core p.236 (Repair) |
| Formula acquisition | Buy, copy, Inventor, reverse-engineer, feature grants and per-level picks, formula families | Player Core p.294; Inventor (Player Core p.257) |
| Earn Income | Jobs for Crafting, any Lore (including Cooking Lore), Performance and other skills; wages paid idempotently | Player Core p.228; GM Core p.53 |
| Cooking | Flavour plus Cooking Lore Earn Income only. Alchemical foods are ordinary alchemical items; Seasoned applies through the roll wrapper | Seasoned (Player Core) |

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

Scope items not yet decided either way are open questions: Treasure Vault (Remastered) crafting
variants (OQ-24), staged poison afflictions (OQ-25), snare placement on the map (OQ-26) and a legacy
rules toggle (OQ-23).

---

## 2. Design principles

Each principle is a rule a reviewer can check a pull request against.

| # | Rule | Check |
|---|---|---|
| P1 | **Requirements are the only gate.** A Craft starts when the gates in 6.5 pass, the up-front materials are funded, and the crafter has confirmed the narrative Craft Requirements checklist. | No code path waits on a GM decision. GM levers are settings and data tools only. |
| P2 | **No GM needed.** Every feature works with only players connected. | Each operation lists which documents it writes; all are owned by the acting user, or the change is a claim (5.5). |
| P3 | **Write only what you own, by key.** Shared state lives in the two module documents every player owns. Collections are objects keyed by id. | No update rewrites a whole collection or array; updates use dotted key paths; deletions use `_del`. |
| P4 | **One responsible client.** A write triggered by a hook that fires on several clients runs on exactly one client (5.6). Prompts appear only on that client. | Every all-client hook handler starts with a responsible-client guard. |
| P5 | **Idempotent effects.** Every effect has a deterministic key; repeating it is a no-op. | A catch-up sweep at `ready` can always be run safely. |
| P6 | **The system is the engine.** Use pf2e crafting abilities, the formula list, special resources, coin items, Rest for the Night and Statistic rolls. | No writes to `system.crafting.entries` or rule-element `prepared` arrays except through `CraftingAbility` methods. No libWrapper, no monkey-patching. |
| P7 | **Own the roll, not the button** (6.12). | The system Craft macro and its pay buttons are never used for orders. |
| P8 | **Remaster first.** Player Core, Player Core 2, GM Core and Treasure Vault (Remastered) are the baseline. Legacy content is allowed but badged. | Rules that differ in legacy books follow the Remaster text unless a setting says otherwise. |
| P9 | **Ship numbers, not text.** Numeric tables only. Names, descriptions and images are read from the compendium by UUID at runtime. Items are matched by compendium source UUID, never by name or slug alone. | No rules prose in `lang/en.json` or code. |
| P10 | **Inert until switched on.** The master switch defaults to off, and turning it on is what creates the shared documents (5.2). Once it is on, the feature toggles default to on, so the decided defaults (escrow into the strongbox, automatic inert marking, downtime, the Secrets of Magic tattoo process) are what a table gets; vial gathering, which writes to actors as time passes, stays off. Enabling a feature changes nothing until someone uses it. | Fresh install in an existing world makes no document writes until a GM turns on the master switch. |
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

Behaviour that differs between pf2e versions is handled by feature detection, not version checks.
Example: Quick Alchemy ammunition gets the infused trait only after pf2e #23495 (merged after 8.6.1),
so expiry stamping checks the created item's traits rather than assuming either behaviour.

### 3.2 Node for local development

Foundry v14 declares Node `>=24.13.1 <25` and refuses to start below 24. Local Foundry, lint and unit
tests all run on Node 24 (CI uses the same major). Newer Node majors pass Foundry's start-up check but
are outside its declared range and are not used.

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
| Downtime-day record | Workshop ledger `days` | the resolving client: the PC's owner or the wizard runner (9.2) | `<actorId>-<day>` |
| Manual day log | Workshop ledger `meta.manual.<runId>` | the wizard runner (9.2) | random id |
| Lock page | JournalEntryPage in the Workshop ledger | created first in every batch that moves coins, items or formulas (5.4); pruned when its row is archived | id of the row it locks |
| Earn Income job | Workshop ledger `jobs` | the earner's owner | random id |
| Roster snapshot | Workshop ledger `roster.<actorId>` | the PC's responsible client | actor id |
| Standing order | Workshop ledger `standing` | requester, crafter | random id |
| Daily loadout | PC actor flags `MOD.loadouts` | the PC's owner | random id |
| Expiry stamp | flags on the created item | the creator's client | item |
| Affix record | flags on the talisman or spellheart item | the item's owner | item |
| Extension data | Workshop ledger `ext.<moduleId>` | the extension, same rules | extension-defined |

Every record carries `by` (user id) and `at` (`{world: worldTime seconds, real: Date.now()}`) for the
last write. Ids are random (16 lowercase alphanumerics, so they are safe inside roll options) or
16-character hashes of an idempotency key; flag keys never contain dots.

### 4.2 Order: one Craft activity

An order is one Craft by one crafter: one item, or one batch of one item. Larger requests split into
several orders. The same record type covers items, upgrades, rune etching, rune transfers, tattoos,
grafts, spell-supplied items and Craft-like formula jobs; `product.type` and `craftType` tell them apart.

#### 4.2.1 Fields

| Field | Type | Notes |
|---|---|---|
| `id`, `v` | string, int | `v` is the row schema version |
| `party` | actor id or null | the pf2e Party actor the order belongs to (OQ-21) |
| `requester` | actor UUID | who asked |
| `recipient` | `{kind: "actor" \| "strongbox", uuid?}` | where the finished item goes; selling finished items is not part of the first release |
| `product` | `{type: "item" \| "formula", uuid, family, snapshot: {name, img, level, rarity, traits, priceCp, per}}` | `uuid` is the compendium source UUID; the snapshot is for display and frozen pricing |
| `craftType` | `"item" \| "upgrade" \| "rune-etch" \| "rune-transfer" \| "tattoo" \| "graft" \| "spell-item"` | selects rules in 6.2-6.9 and 6.14 |
| `attempt` | int | increases at each start, retry and crafter swap; day records and the check belong to one attempt |
| `quantity` | int | within `batchMax` (6.3) |
| `target` | item UUID or actor UUID | the item being upgraded or etched, or the tattoo or graft subject |
| `crafter` | actor UUID or null | null until someone accepts |
| `skill` | skill slug | normally `crafting`; registry substitutions (6.11) |
| `route` | formula route (4.3) | evaluated live until start, frozen at start |
| `priceCp`, `upfrontCp` | int | frozen at start (6.2) |
| `dc` | `{level, rarity, repeat, adjust, final, pwol}` | frozen at start |
| `setup` | `{days}` | setup days needed, frozen at start; days done are derived (below) |
| `check` | `{degree, unadjusted, total, messageId, level, rank, rerolled, settled}` | written from the chat message (6.12); `settled` once the money rows are posted (4.2.3) |
| `helpers` | `{[actorId]: {skill, rank, level, degree, joinedDay, leftDay}}` | Communal Crafting (6.7) |
| `pledges` | `{[id]: {caster, spell, rank, castings, payer, day, status}}` | casting pledges (6.9) |
| `checklist` | `{[key]: {confirmedBy, at}}` | narrative Craft Requirements; text read at runtime |
| `materials` | `{[lineId]: {kind: "coin" \| "item", itemUuid?, valueCp, material?: {type, grade}}}` | coin funding is derived from ledger rows; item lines point at earmarked strongbox items |
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
| `setup` | setup day resolved | `setup` | resolving client (9.2) | a setup-day record (4.8) |
| `setup` | derived setup days done reach `setup.days` | `check` | the crafter's responsible client | status only; writing it twice is harmless |
| `setup`, `finishing` | crafter's activity changes, or pause | `paused` | the crafter's owner | `resumeTo` set |
| `paused` | resume | `resumeTo` | the crafter's owner | setup days kept, or a new attempt by setting (6.2.5) |
| `check` | roll recorded | `rolled` | the rolling user (6.12) | `check` written; no rows |
| `rolled` | reroll recorded | `rolled` | the rolling user | `check` replaced; no rows |
| `rolled` | settle | `finishing` or `failed` | the crafter's owner, or automatically by the crafter's responsible client when the order's next day is resolved or at its `ready` sweep; extra-day records written in the meantime count once it settles as a success | `check.settled`; `expend` on success; `release` on failure; `ruin` and `release` on critical failure |
| `finishing` | extra day resolved | `finishing` | resolving client | an extra-day record with the day's reductions (4.8) |
| `finishing` | finish | `complete` | the crafter's owner | `remainder` row; items created; delivery or shelf |
| `failed` | retry | `setup` | the crafter's owner | `attempt` + 1; new `commit`; setup days and the check start again |
| `failed`, `finishing` | cancel | `cancelled` | requester or crafter | escrow not yet spent becomes refund claims |
| any active state | crafter swap | `setup` | the new crafter's owner | `attempt` + 1: restart setup and check; escrow and earmarked materials carry over (6.2.5) |
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
| `crafter`, `route`, `setup`, `attempt`, `status`, `checklist`, `materials` | crafter |
| `check` | the rolling user (6.12); settlement by the crafter |
| `helpers.<self>` | that helper |
| `pledges.<id>` | that caster |
| `priority` (after start) | crafter |
| day records `days.<actorId>-<day>` | whoever resolves that day: the PC's owner or the wizard runner (9.2) |

The wizard runner writes day records only, never an order's `setup`, `check` or `status`. Every
resolver computes the same deterministic content for a given day (6.2.3), so a day resolved twice
leaves one record.

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
| `craft-copy` | formula Price, Craft-like | Craft-like | Craft | craft a copy of a formula the crafter knows, for someone else's book (OQ-12) |

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

### 4.6 Ledger rows

Every movement of value is a row. Rows are append-only; corrections are new rows.

```text
rows.<id> = {
  id,              // 16-char hash of idem
  kind,            // table below
  idem,            // deterministic idempotency key
  box,             // signed int cp: change to the strongbox coin balance
  purse,           // signed int cp: change to `actor`'s purse
  alloc,           // signed int cp: change to the allocation of `order` (or of the party fund when order is null)
  actor,           // actor UUID: the counterparty
  order, job,      // optional links
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
| `pledge` | purse to strongbox | +n | −n | +n (order) | a member funds an order (escrow) |
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
| `purchase` | purse or strongbox out | 0 or −n | −n or 0 | 0 | formula buying, spellcasting services, spell costs |
| `wage` | minted into purse | 0 | +n | 0 | Earn Income day (6.10) |
| `income` | minted | +n or 0 | 0 or +n | +n fund | extension `IncomeSource` (12.2) |
| `expense` | strongbox out | −n | 0 | −n fund | extension purchases |
| `delivered` | items: shelf to recipient | 0 | 0 | 0 | delivery claim resolved (5.5) |
| `carry` | none | net | net | net | archive summary per actor that replaces archived rows (5.3.3) |
| `adjust` | GM correction | ± | ± | ± | GM only |
| `reversal` | inverse of the target row | −target | −target | −target | see below |

- **Pro-rata splitting.** When an order spends money (`expend`, `ruin`, `remainder`), the module
  writes one row per contributor in proportion to their remaining allocation. Rounding uses the
  largest-remainder method in whole copper; ties go to the earliest contribution.
- **Idempotency keys** are built from the operation, never from wall-clock time. Examples:
  `pledge:<orderId>:<actorId>:<nonce>` (the nonce is generated once when the user confirms),
  `expend:<orderId>:<attempt>`, `day:<orderId>:<day>`, `wage:<jobId>:<day>`,
  `refund:<orderId>:<actorId>:<transitionSeq>`. The row id is a hash of the key, so writing the same
  row twice is harmless; the coin movement is skipped when the row already exists (5.4). That check is
  only a fast path: two clients can both see the row missing, so every batch that moves coins starts
  with a lock operation (5.4).
- **Author stamp.** `author` is the user who wrote the row. The UI shows "by <user>" on every row,
  and on behalf of which actor.
- **Reversal.** The author of a row, or a GM, can reverse purely financial rows (`pledge`, `deposit`,
  `allocate`, `withdraw`, `purchase`, `income`, `expense`, `adjust`). A reversal moves the coins back
  when that is still possible and writes a `reversal` row that points at the original; the original is
  marked `reversedBy`. State-coupled rows (`commit`, `expend`, `release`, `ruin`, `remainder`, `wage`)
  are reversed by undoing the transition that wrote them (4.2.3): the user who made it can undo their
  own last transition, and a GM can undo any.

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
- **Day records** (`days.<actorId>-<day>`, keyed by the record's first day):
  `{actor, day, toDay, activity, order?, attempt?, kind?: "setup" | "extra", crafterCp?, helpers?:
  {[actorId]: cp}, result, rows: [rowIds], by, at}`. One per PC per resolved day; a span with nothing
  to record (for example "not downtime") is one record with `toDay` set. Order totals (setup days done,
  extra days, reductions, last day worked) are sums and maxima over these records for the order's
  current attempt (4.2.1). Old records are archived (5.3.3).

### 4.9 Earn Income jobs

`jobs.<id> = {actor, skill, taskLevel, settlement, dc, startDay, lengthDays?, check: {degree, unadjusted,
messageId, level, rank}, perDayCp, status: "open" | "ended" | "fired"}`. Days paid are derived from the
job's `wage` rows, never stored as a counter. `settlement` is the settlement profile the job was taken
in. Rules in 6.10.

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
cooperative trust model, OQ-5). Orders, funding and progress bars are always shown to every member.

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
7.7 and 8.8.

### 4.13 Formula provenance

`formulas.<actorId>.<hash> = {uuid, route, source, day, rowId?, orderId?, by}`. Routes: `granted`
(feature or level-up pick), `bought`, `copied-npc`, `copied-ally`, `invented`, `reverse-engineered`,
`looted`, `family` (written on demand, 6.4), `virtual` (written on demand, 7.4), `unrecorded` (already
in the book when the module was enabled). The system list itself only ever receives plain `{uuid}`
entries.

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

---

## 5. Storage, permissions and sync

### 5.1 Which document holds what

| Store | Scope | Holds | Who can write |
|---|---|---|---|
| World settings | world | feature toggles, rules-gap settings, settlement profiles, ids of the shared documents | GM and assistant GMs (`SETTINGS_MODIFY`) |
| **Workshop ledger** | a JournalEntry created by the module, default ownership OWNER, in a "module data" folder | `meta` (current settlement, manual day log, day offset, archive and migration locks), `orders`, `services`, `rows`, `claims`, `pcs`, `days`, `jobs`, `roster`, `formulas`, `standing`, `ext` | every player |
| Ledger archive pages | JournalEntryPages inside the ledger | archived orders, rows and day records as flags | every player (page creation needs OWNER of the parent journal, which players have) |
| Lock pages | JournalEntryPages inside the ledger, `_id` = the id of the row they lock | nothing; their existence is the lock (5.4) | every player |
| **Strongbox** | a pf2e `loot` Actor created by the module, then updated to default ownership OWNER (5.2) | escrowed coins, earmarked materials, shelf items | every player |
| PC actor flags | each character | loadouts, per-character preferences | the PC's owner |
| Item flags | items | expiry stamps, inert marks, affix records, crafted-by stamp | the item's owner |
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
  override runs only at creation, so the update stands. On every GM `ready` the module checks that the
  default is still OWNER and repairs it if not. Until then, a non-OWNER strongbox counts as "shared
  documents missing" (the read-only banner below). Re-creation follows the same steps, and a harness
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
- Lock pages (5.4) whose rows are archived are deleted in the same batch.

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
   On the purse, an actor written only by its owner's clients, ordinary quantity updates are used.
2. **Fast path.** The acting client checks that the row's idempotency key is not already present.
3. **Lock first.** One `foundry.documents.modifyBatch` call holds, in this order:
   1. the lock operation: create a lock page in the ledger whose `_id` is the id of the coin-moving row
      the batch writes, with `keepId` (the server refuses a second page with the same id, under the
      collection's semaphore). The row id is the hash of its idempotency key, so a claim and a direct
      move for the same key (a wage day resolved by the earner and by a wizard runner) share one lock. A
      delivery deletes its shelf item instead, and strongbox coin deletions lock as well, since an item
      cannot be deleted twice;
   2. the ledger rows, with `state: "pending"`;
   3. the item and coin operations on the purse and the strongbox, and other ledger keys.
   A losing duplicate fails at its first operation, in the dry run or in the real pass, before any coins
   move. A batch that stops part-way leaves a pending row whose lock is already held; its author's
   client completes the remaining operations, or a GM books an `adjust`.
4. **Settle.** When the batch resolves, the rows are set to `"applied"`. Reconciliation (4.7) lists
   rows still pending and balance mismatches, for the author to retry or a GM to `adjust`.
5. **One at a time per user.** Each client runs coin operations behind a local mutex, shared across
   the user's tabs in the same browser through the Web Locks API (`navigator.locks`), so one client
   never sends a second plan before the first resolves. A failed lock re-plans from fresh data.

### 5.5 Claims: effects on documents the actor's user does not own

A player cannot write another player's character. Anything that must land on someone else's actor
becomes a claim that the target's owner client applies.

| Claim | Created by | Content | Applied by | Application |
|---|---|---|---|---|
| Delivery | crafter's client at completion | a shelf item in the strongbox | recipient's responsible client | one `modifyBatch`: delete the shelf item (the lock), write the `delivered` row with the item's source snapshot, create the item on the recipient. If the batch stops after the delete, reconciliation re-creates the item from the snapshot (4.7). |
| Refund | whoever cancels or completes | a `claims.<id>` entry `{actor, cp, order}` | the contributor's responsible client | `refund` row and coin move strongbox to purse |
| Wage | wizard runner for a PC they don't own | `claims.<id>` `{actor, cp, job, day}` | the earner's responsible client | coins minted into the purse, `wage` row |
| Formula | the crafter's client when a formula job for someone else's book completes (6.8), or a `formula-copy` service (4.5) | `claims.<id>` `{actor, uuid, provenance, order}` | the learner's responsible client | appends `{uuid}` to its own `_source.system.crafting.formulas`, writes provenance (4.13), fires `formulaAcquired` |
| Expiry | the creator's client after daily preparations | `claims.<id>` `{creator, cycle}` | each holder's responsible client | marks matching items inert (7.7); idempotent by itself and moves nothing, so it takes no lock |
| Invest | tattoo or graft completion | `claims.<id>` `{item, healUntil}` | subject's responsible client | invests the tattoo or graft once healed (6.14) |

- Auto-claim is a user setting (default on). With it off, the user gets one notice with a "Take it"
  button.
- Every claim that moves coins, items or formulas is resolved by one lock-first batch (5.4): a lock
  page for the row it writes (or, for a delivery, deleting the shelf item). A second resolver, for
  example the GM fallback and the owner's `ready` sweep at the same moment, or the same user in two
  places, fails at that first operation before anything moves. `claims.<id>.resolved = {by, at}` is
  written in the same batch and serves as the fast-path check.
- The sweep at `ready`, and when a user connects, applies every claim for actors the local user is
  responsible for. Nothing is lost while a player is away.

### 5.6 The responsible client

```js
// Writes to (or prompts about) an actor.
function responsibleUserFor(actor) {
  const active = game.users.filter((u) => u.active);
  return (
    active.find((u) => !u.isGM && u.character?.id === actor.id) ??                   // the assigned player
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
  harmless; a duplicate prompt on a second device is accepted.
- This replaces the earlier rule ("the acting user if connected, otherwise the active GM"), which
  names nobody when neither is connected (`DECISIONS.md`, derived rules).
- A user's own action runs on that user's client; no guard is needed.
- An all-client hook (`updateWorldTime`, `createChatMessage`, `combatTurnChange`, `createItem`,
  `updateActor`) acts only when the guard returns the local user.
- Hooks that fire on one client only (`pf2e.restForTheNight`, render hooks) do not need the guard, but
  any prompt they raise must still go to the responsible user of the affected actor.

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
  writers. The handler resolves each claim with the same lock-first batch as an owner client (5.5): a GM
  with two tabs receives the query on both, and only one batch gets past its lock.
- With no GM, or if the query fails or times out, nothing breaks: the claim stays pending until an
  owner client applies it.
- On the GM's own client the handler is called directly, not through the socket (a query to oneself
  is not short-circuited).

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

### 5.10 Trust model and audit

Owners can edit shared rows, so the module relies on cooperation, not enforcement. It makes every
change visible instead: every row and record names its author; nothing is silently overwritten;
reversals are new rows; the Funds tab and the order log show who did what and when; and the user who
made a transition, or a GM, can undo it. Client-side checks (field ownership, deletion guards)
prevent accidents, not determined tampering.

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
  return dc + ctx.registry.dcAdjust(crafter, item, ctx.route);                 // e.g. Inventor rarity setting
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
    setupDays: setupDays(item, crafter, ctx),
    dc: craftDC(item, crafter, ctx),
  };
}

function setupDays(item, crafter, ctx) {
  const override = ctx.registry.setupOverride(crafter, item, ctx.route);   // rune transfer 1; Reverse Engineering feat 1
  if (override != null) return override;
  return ["known", "family", "virtual"].includes(ctx.route) ? 1 : 2;       // Player Core p.237
}

// start: gates pass (6.5), escrow >= upfrontCp (coins plus earmarked items at Price),
// precious-material share satisfied (6.6), checklist confirmed, pledges arranged (6.9).
function start(order, plan) {
  Object.assign(order, { priceCp: plan.priceCp, upfrontCp: plan.upfrontCp, dc: plan.dc,
                         setup: { days: plan.setupDays }, attempt: (order.attempt ?? 0) + 1,
                         check: null, status: "setup" });
  post("commit", order.upfrontCp);
}

// Work totals are derived from the day records of the current attempt (4.8), never stored.
const daysOf = (o, days, kind) =>
  days.filter((d) => d.order === o.id && d.attempt === o.attempt && d.kind === kind);
const setupDone = (o, days) => daysOf(o, days, "setup").length;      // `setup` -> `check` when >= o.setup.days
```

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
  const recompute = ctx.settings.recomputeRateOnLevelUp;          // default on (OQ-10)
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

#### 6.2.5 Interpretation settings

| Setting | Default | Basis |
|---|---|---|
| Interrupted setup days persist | on | RAW covers only interrupted extra days (Player Core p.237) (OQ-9) |
| Recompute the daily rate after a level-up | on | the rate uses the crafter's current level; the degree stays fixed (OQ-10) |
| A crafter swap restarts setup and the check | on | escrow and earmarked materials carry over (OQ-10) |

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

### 6.4 Formula families

- **Rule.** A formula for an item covers its other types, except types that are wildly different or of
  higher rarity. GM Core p.223 (Multiple Types) and the Player Core 2 Formula Book describe higher-level
  upgrades; Player Core 2's Quick Alchemy states, as the normal rule, that one formula lets you create
  any level of the item, so coverage of lower grades is on by default for every route
  (`rules.familyCoversLowerGrades`, OQ-11). An upgrade costs the full Price difference and uses the new
  level's DC.
- **Family key.** The compendium has no family field, so the key is derived from the item name with the
  parenthesised grade removed (Minor, Lesser, Moderate, Greater, Major, True, Type I-IV) plus item type
  and category, overridden by the registry. Families where each type needs its own formula (for example
  aeon stones, marvelous miniatures, and items whose text says so) are flagged `ownFormulaPerType`.
- **Coverage.**
  ```js
  const covers = (known, target) =>
    family(known) === family(target) && !ownFormulaPerType(target) &&
    rarityRank(target) <= rarityRank(known) &&
    (target.level >= known.level || settings.familyCoversLowerGrades);   // default on (OQ-11)
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

### 6.5 Eligibility gates

`gates(crafter, item, order, ctx)` returns `[{id, ok, reason, unlock}]`, where `reason` and `unlock` are
i18n keys with data (for example "needs master in Crafting; unlocks at the next skill increase").

| Gate | Passes when | Source |
|---|---|---|
| G1 trained | crafter trained in Crafting, or in the registry substitute skill for this item | Player Core p.237 |
| G2 level | item level ≤ crafter level | Player Core p.237 |
| G3 proficiency | master for item level 9+; legendary at or above the legendary threshold (setting, default 17) | Player Core p.237; GM Core p.223 says 16 (OQ-7) |
| G4 crafting feat | alchemical: Alchemical Crafting; magical (including runes): Magical Crafting; both traits: both; talisman: Magical Crafting or a registry grant (Talisman Dabbler); tattoo: Tattoo Artist (or Magical Crafting with Specialty Crafting in artistry under the Secrets of Magic setting); graft: Graft Technician and expert Medicine; snare: Snare Crafting, plus Magical Crafting for magical snares (setting, OQ-14); gadget: no feat | Player Core, Player Core 2, GM Core, Guns & Gears (R), Howl of the Wild |
| G5 rarity and access | common, or the crafter has access: a known formula for the item or a registry access grant. With `rules.uncommonNeedsFormula` on, only a known formula (OQ-37) | Player Core p.237; Player Core p.294; GM Core p.223 |
| G6 formula route | a route from 4.3 exists for this item | |
| G7 tools | alchemical items in downtime: alchemist's lab; other trades: artisan's toolkit; snares: snare toolkit (treated as an artisan's toolkit, OQ-14); registry substitutions (Scrounger, Improvise Tool, cookware for alchemical food). A tool counts if it is on the crafter or in the strongbox. Workshops (a smithy) are checklist items. | Player Core p.237 and items |
| G8 materials | escrow covers `upfrontCp`; precious-material rules (6.6) | Player Core p.237; GM Core p.253 |
| G9 Craft Requirements | every parsed requirement is confirmed on the checklist; spell supply is covered by fulfilled pledges (6.9); Craft Anything waives most requirements including spells, but not added costs | GM Core p.223; Craft Anything (Player Core) |
| G10 custody | the target of an upgrade, etching or transfer is on the crafter or earmarked in the strongbox for the whole job; a tattoo or graft subject has consented and is locked | GM Core p.225; Secrets of Magic p.164; Howl of the Wild p.97 |
| G11 availability | the crafter is not locked as a helper or subject on another order | Communal Crafting |
| G12 product rules | no artifacts; no Price means no Craft; specific items take only fundamental runes; shields only reinforcing; staves only fundamentals; property runes ≤ potency (+1 with orichalcum); one rune etched at a time per item | GM Core pp.223-225 |

Reverse-engineering skips G5 and the special Craft Requirements but keeps G1-G4, G7 and G8 (Player
Core p.294: every other requirement to Craft the item still applies); G8 is measured against half the
formula's Price.

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
| Helper check DC | the item's Craft DC | RAW does not say (OQ-6) |
| Helper critical success | uses the next row | interpretation |
| Helper failure | contributes nothing | alternative: the failure column |
| When helpers roll | once, when the crafter rolls; kept for the order | interpretation |
| Contribution applies | each extra day the helper is present | interpretation |
| A helper leaves | forfeits everything they contributed (retroactive) | literal reading; alternative: only future days |
| Helper cap | none | left to the GM |
| Relevant skills | Crafting, plus registry trait mapping (divine → Religion, arcane → Arcana, occult → Occultism, primal → Nature, weapon → Warfare Lore), plus skills the crafter marks relevant on the order | the crafter's choice is recorded on the order |
| Count helpers without the feat | off | GM Core p.46 Cooperation |

- Helpers are locked from start to completion: their downtime activity becomes `help:<orderId>`.
- Example: a 10th-level helper who is expert in Crafting and succeeds adds the level-9 expert amount,
  400 cp per day.
- **Aid without the feat.** One Aid on the crafter's check, entered in the roll dialog as a
  circumstance modifier: +1 on a success, +2/+3/+4 on a critical success by the aider's rank (expert or
  lower/master/legendary), −1 on a critical failure; typical DC 15 (Player Core Aid).

### 6.8 Formula acquisition jobs

| Route | Cost | Time | Check | Gates | On success |
|---|---|---|---|---|---|
| Buy, common | `FORMULA_PRICE[level]` | 1 hour to copy | none | none: anyone may own a formula | `{uuid}` appended; provenance `bought`; `purchase` row |
| Buy, uncommon or rare | as above plus the surcharge setting (default 0%) | 1 hour | none | checklist: "a seller is available" (the GM's lever is the fiction) | as above |
| Copy from an NPC | `FORMULA_PRICE[level]` | 1 hour | none | | provenance `copied-npc` |
| Copy from an ally | setting, default 0 | 1 hour | none | the ally's roster lists it; the ally's owner confirms | provenance `copied-ally` |
| Invent (Inventor) | formula Price, Craft-like (half up front, extra days reduce) | setup 2 days (setting, OQ-12) | Crafting vs the item's Craft DC | Inventor; Alchemical/Magical Crafting for those formulas; uncommon and rare only if the setting allows (default off) with its DC adjustment | provenance `invented` |
| Reverse-engineer | formula Price, Craft-like | setup 2 days; 1 with the Reverse Engineering feat (+2 circumstance) | the item's Craft DC | item possessed (on the crafter or earmarked); G1-G4, G7, G8; no access or special Craft Requirements needed | provenance `reverse-engineered`; the item is kept (Player Core p.294). With the legacy-disassembly setting on (`rules.reverseEngineerDestroys`, default off), the item becomes earmarked raw materials worth half its Price, and a Reverse Engineering (Scrounger) critical success may keep the item instead |
| Schematic scanner | 0 | 10 minutes | none | the crafter holds a schematic scanner and the item | item not destroyed; the scanner also gives +2 to Craft stored formulas (registry `modifier`) |
| Craft a copy of a known formula | formula Price, Craft-like | setup 1 day | Crafting vs the item's Craft DC (OQ-12) | the crafter knows the formula | a formula claim to the recipient (5.5), applied by the recipient's own client; provenance `copied-ally` |
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
- **Pay.** One `wage` row per job per day, key `wage:<jobId>:<day>`. The earner's responsible client
  mints the coins into the purse; anyone else resolving the day creates a wage claim (5.5). A day
  resolved twice, or by two clients at once, never pays twice: the earner's direct mint and the claim
  share one lock, keyed by the row (5.4).
- **Downtime-check guardrail.** Fortune effects and activated bonuses do not apply to downtime checks
  (GM Core p.46), and a Hero Point reroll is a fortune effect. The card warns when either is detected;
  a setting can block instead (default warn).
- **Cost of living** (Player Core p.295) can be deducted per week after income (setting, default off;
  GM Core p.50 suggests it only for long stretches).
- **Cooking Lore** jobs are ordinary Lore jobs.

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
  | `craftUnlock` | lets the actor craft a category (Talisman Dabbler: talismans) |
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

- **Tiers.** 1: core crafting and the common class and archetype features, fully automated. 2: automated
  where they touch time, cost, DC, batch, gates or formulas, otherwise shown as notes. 3: other classes'
  daily item preparation, as Morning entries. 4: legacy-only content, hidden unless the world setting
  shows legacy content.
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
  accounted for" checkable before listing.
- **Seeding.** The research catalogues (feats and gear) seed the registry only after the per-entry
  source check below; their "automated by the system" verdicts are known to be wrong for some entries.
  Items that exist only in the PF2e Legacy Data module (different UUIDs) are excluded from the first
  release (OQ-38).
- **Catalogues of "what the system automates" are input, not truth.** Two common misreadings, both
  checked against the source: Seasoned and Specialty Crafting do not fire through the system Craft
  macro, and Earn Income gear (Fortune Cord, Inexplicable Apparatus, Tradecraft Tattoo) does not fire in
  the system dialog. Every registry entry is checked against the pf2e source before it is added.

### 6.12 The roll wrapper

```js
async function rollCraft(order, crafter, ctx) {
  // An ephemeral copy of the product owned by the crafter, never saved, so roll options are complete.
  const item = await ctx.ephemeralItem(order.product.uuid, crafter);           // OQ-2
  const options = [
    "action:craft",
    ...item.getRollOptions("item"),
    ...ctx.registry.rollOptions(crafter, item, order),   // Specialty Crafting bare choice, trade tags, item:tag:food
    `${MOD}:order:${order.id}`,                          // survives Hero Point rerolls inside flags.pf2e
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
  const id = ctx?.options?.find((o) => o.startsWith(`${MOD}:order:`))?.split(":").pop();
  if (!id || message.author?.id !== game.user.id) return;
  recordCheck(id, {                       // DEGREE_FROM maps pf2e outcome strings ("criticalFailure".."criticalSuccess") to 0..3
    degree: DEGREE_FROM[ctx.outcome], unadjusted: ctx.unadjustedOutcome,
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

### 6.13 Service rules

- **Repair.** Requires a repair toolkit held or worn by the performer, waived by Improvise Tool (4.5).
  DC: the item's level DC, no rarity adjustment (GM Core p.53). HP restored: 5 + 5 × rank on
  a success, 10 + 10 × rank on a critical success; Crafter's Eyepiece raises these to 10 + 10 × rank and
  15 + 15 × rank (the system's repair macro ignores it). Critical failure: 2d6 damage minus Hardness.
  Destroyed items cannot be repaired. Quick Repair and Rapid Affixture change time only.
- **Rune transfer and swap** (GM Core p.225): 1 day, cost 10% of the rune's Price (free from a
  runestone), DC by the rune's level; a swap uses the higher level and Price; fundamental for
  fundamental, property for property; an invalid target is an automatic critical failure; property runes
  left without enough potency go dormant.
- **Etching and upgrades** (GM Core pp.223-225): one rune at a time, the item stays with the crafter;
  cost is the Price difference, computed by preparing an ephemeral clone with the new runes or material
  and reading its `price`, `level` and `rarity`. The module never re-implements pf2e's rune price table,
  which disagrees with the compendium on a few runes.
- **Affixing** (7.4) and **Identify Alchemy** (the system action) are as in 4.5.

### 6.14 Tattoos

| Step | Secrets of Magic process (default) | Simple toggle |
|---|---|---|
| Who | Tattoo Artist, or Magical Crafting plus Specialty Crafting (artistry) | Tattoo Artist |
| Subject | the recipient's owner consents; the subject is present for the whole Craft and locked like a helper (setting, OQ-13) | consent only |
| One at a time | a tattooist has at most one tattoo order in progress (Secrets of Magic p.164); the subject is present for the whole Craft and locked (G11) | off |
| Craft | normal Craft, with Tattoo Artist's +1 circumstance (+2 at master) applied by the wrapper | same |
| Investiture | each magical tattoo counts against the subject's invested items; the new tattoo is mundane only if the subject's limit is already fully used by tattoos (Secrets of Magic p.164) | not checked |
| Healing | a healing period of up to a month (setting, default 30 days), cut to 1 day if magical or alchemical healing is recorded; the tattoo is delivered uninvested and an invest claim fires when healing ends | none; delivered invested |
| Crafter stamp | Legendary Tattoo Artist: if the tattoo is at least 3 levels below the crafter, its activated attack and DC values and its resistances get +1, edited on the created item before delivery | same |
| Alter or upgrade | an order on an existing tattoo, cost = Price difference | same |

Whether the Remaster books restate this process is unconfirmed (OQ-13). Tattooed Historian investiture
exemptions come from the registry.

**Grafts** (Howl of the Wild p.97) reuse this flow with `craftType: "graft"`: the implanter needs the
formula, expert Medicine and Graft Technician (G4); the implant check uses Medicine with Graft
Technician's circumstance bonus applied by the wrapper; the willing subject is present throughout and
locked; one graft at a time per implanter; the graft is invested and counts against the subject's
investiture, and stays inactive while the subject's limit is used up. Replacing or upgrading a graft is
an upgrade order at the Price difference.

### 6.15 System gaps the module fills

| # | Gap in pf2e 8.6.1 | What the module does |
|---|---|---|
| 1 | The Craft macro's default DC ignores rarity (#19993) | explicit DC (6.2) |
| 2 | The Craft macro passes no item roll options, so Alchemist Goggles, the Haversack, the expanded lab (bare `alchemical` predicate), Seasoned, Specialty Crafting and the ring of maniacal devices never apply | roll wrapper injects them (6.12) |
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
and the item's own DC otherwise. Downtime-crafted alchemical items are not infused (OQ-16), so the
Queue always shows the item DC for them.

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
  lower (Talisman Dabbler) or the common GM Core ones (Talisman Esoterica) from the compendium index.
  Because pf2e drops prepared formulas that are not in the known list (verified), choosing a talisman
  writes its UUID into the formula book first, with provenance `virtual`. Only the talismans actually
  used are written.
- **Setup for permanent talismans.** A Talisman Dabbler knows these formulas, so a downtime talisman
  order uses the 1-day setup (OQ-8).
- **DC stamp.** After `performDailyCrafting()`, the owner client rewrites inline `@Check[...|dc:N]`
  values on the new temporary talismans from Talisman Dabbler (found as in 7.1) to the highest of class
  DC, spell DC and the talisman's DC (Player Core 2). Talisman Esoterica has no such rule, so its
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
- **Exceptions** from the registry: Food Preservation's designated foods, Eternal Elixir, effects that
  are already afflictions in progress, and anything a feat explicitly extends.
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
  ability or versatile vials. Its rows: a select per pool ("keep current preparation", each saved loadout,
  "prepare in the Workshop later") and a notify row listing standing orders.
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

---

## 8. Combat

Everything in this section runs only while the combat feature is enabled (on by default once the
master switch is on, P10). If PF2e Alchemist Remaster Duct Tape (`pf2e-alchemist-remaster-ducttape`)
is active, the whole section steps aside: no Bandolier, no HUD palette, no Quick Alchemy panel, no turn
expiry, no vial gathering. Settings shows why. Party-wide infused expiry at rest (7.7) and "Use best
consumable" (8.9) are not Duct Tape's territory and stay.

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
- **Double Brew** (9th): two picks, one vial per consumable.
- **Combine Elixirs** (additive): one extra vial; it is the item's one additive (8.6).
- **Healing Bomb** (additive): offered when the pick is an elixir of life (8.6).
- **Potency** stamps: start of the creator's next turn; end of the next turn for tools and elixirs with
  Enduring Alchemy; effects capped at 10 minutes (8.8).
- Keyboard: type to filter, arrows to move, Space to pick, Enter to create, Esc to close.

### 8.4 Quick Bomber

One action: draw a bomb or vial, or Quick Alchemy a bomb, then Strike. The panel picks the best ready
bomb of the chosen family (held, then worn, then stowed; soonest-expiring infused first) or creates one,
then runs the system Strike against the current target. Only one bomb, even with Double Brew.

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
  applies it.
- **Additives** (Player Core 2 additive trait): only on Quick Alchemy consumables, never quick vials; one
  per item; at most one per round per actor. The picker lists only additives the registry says fit the
  item. The chosen additive is a flag on the created item; per-Strike effects use the system's own toggles
  where they exist (OQ-27).

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
  responsible client of the creator.
- Quick Alchemy consumables: inert at the start of the creator's next turn; tools and elixirs with
  Enduring Alchemy at the end of the next turn; quick vials at the end of the current turn.
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

---

## 9. Time

### 9.1 World-clock accrual

- When world time advances (core time controls, the pf2e world clock, or a calendar module, all through
  `updateWorldTime`), nothing is written. Pending days are derived (4.8).
- When a day boundary is crossed, each PC in downtime with pending days gets one prompt on its
  responsible client: a notification and a badge on the Downtime tab, not a modal dialog. An owner who
  was offline sees it at their next login.
- Resolving opens the day resolver for that PC only: confirm the activity for each pending day, roll
  any check that has come due, then commit.
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
3. **Checks due.** Orders reaching their check, helper checks, first-day Earn Income rolls. The wizard
   runner can roll only for actors they own; the rest are marked "check pending" for their owners.
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

---

## 10. User interface

### 10.1 The Workshop window

One ApplicationV2 window built with `HandlebarsApplicationMixin`, split into small PARTS so that a store
change re-renders only the affected part. Detached-window safe: `element.ownerDocument`, no cross-window
`instanceof` (use `foundry.utils.isElementInstanceOf`), delegated listeners. Re-renders are debounced
with `foundry.utils.debounce`, never `requestAnimationFrame`.

| Tab | Players see | GMs additionally see |
|---|---|---|
| Queue | all party orders, shown to every member whatever pf2e's metagame settings (per-order privacy is the `gift` visibility, 4.2.1); own orders highlighted; request, pledge, accept, start, roll, settle, finish; undo own last transition; pickup shelf | undo the last transition of any order |
| Funds | strongbox balance, party fund, own contributions and claims, the ledger with authors; pledge, deposit, withdraw, reverse own rows | reconciliation, `adjust` rows, reverse any row |
| Morning | owned characters' daily sources (7.1), loadouts, standing orders, talisman affix planner | any character |
| Formulas | owned characters' codex: families, provenance, picks owed, routes for unknown formulas; the party roster's known families | any character |
| Downtime | own PCs' status and pending days, the day resolver, the Advance days wizard, Earn Income jobs (undo own last transition), the current settlement (any member may change it), extension activities | all PCs; clock option in the wizard and "advance clock to match" (4.8); settlement profiles |
| Settings | user and client settings | world settings, integrations, conflicts, data tools (migrations, reconciliation, purge), "view as player" |

There is no inbox: nothing waits for approval.

### 10.2 Header and status bar

- Header: party selector (when an actor is in several parties), workshop day and world date, strongbox
  balance, pickup-shelf count for the user's characters, "acting as" character selector.
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
| Item chat cards | `renderChatMessageHTML` | optional "Request craft" button |
| Keybindings | `game.keybindings.register` | Open Workshop, Open Bandolier, Quick Alchemy; unbound by default |

Render hooks receive jQuery from AppV1 and an HTMLElement from AppV2; the module normalizes with an
element-instance check.

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

All macros are idempotent: a double click returns "already done".

### 11.2 API surface

Published at `game.modules.get("pf2e-artisans-workshop").api` in `ready`; the
`pf2e-artisans-workshop.ready` hook fires right after with the same object.

| Namespace | Members |
|---|---|
| (root) | `version` (module version), `apiVersion` (integer), `isReady()` |
| `ui` | `open(opts)`, `openOrder(id)`, `requestForm(uuidOrItem, opts)` |
| `orders` | `list(filter)`, `get(id)`, `request(opts)`, `accept(id, {crafter})`, `release(id)`, `start(id)`, `rollCheck(opts)`, `settle(id)`, `pause(id)`, `resume(id)`, `finish(opts)`, `cancel(id)`, `undo(id)`, `postSummary(opts)` |
| `services` | `request(opts)`, `perform(id)` |
| `funds` | `balance({actor, order})`, `pledge(opts)`, `deposit(opts)`, `withdraw(opts)`, `rows(filter)`, `claims(actor)`, `claimAll(opts)`, `post(row)` (extensions, 12.4) |
| `formulas` | `knows(actor, uuid)`, `routes(actor, uuid)`, `family(uuid)`, `acquire(opts)`, `provenance(actor)` |
| `prep` | `open(opts)`, `loadouts(actor)`, `applyLoadout(actor, id)`, `affixBoard(opts)` |
| `alchemy` | `quickAlchemy`, `quickBomb`, `quickVial`, `healingBomb`, `gatherReagents`, `improviseAdmixture` |
| `consumables` | `useBest(opts)`, `holders(family)` (8.9) |
| `downtime` | `status(actor)`, `setActivity(actor, activity)`, `pending(actor)`, `resolve(opts)`, `advance(opts)`, `today()`, `setSettlement(profileId)` |
| `income` | `start(opts)`, `roll(jobId)`, `end(jobId)` |
| `rules` | pure functions: `levelDC`, `craftDC`, `incomePerDay`, `formulaPrice`, `planCraft`, `batchMax`, `familyKey`, `gates`, `helperRate` |
| `ext` | read-only lists of registered extension objects; `store(moduleId)` for namespaced data (12.4) |

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

`orderStatusChanged` and `preparationCompleted` go beyond the hooks named in the decision log; they are
proposed because extension modules will need them.

### 12.4 Extension data and versioning

- `api.ext.store(moduleId)` returns `get(key)`, `set(key, value)`, `delete(key)` over
  `ext.<moduleId>.<key>` in the Workshop ledger, using key-path updates. Extensions version their own
  data.
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

---

## 13. Integrations and conflicts

| Module | Detection | Behaviour |
|---|---|---|
| pf2e-dailies | `game.modules.get("pf2e-dailies")?.active`; API `game.dailies.api` | custom daily (7.9); post-rest pipeline waits for its `rested` flag (7.8); its built-in dailies are never duplicated |
| PF2e Toolbelt | active flag | coexist: its Better Sheet adds sort buttons to the crafting tab, so the strip is appended above without touching formula rows; its Better Merchant services are an ordinary way to buy materials; no API use |
| PF2e Workbench | active flag | coexist: keep `li.formula-item` markup so its rarity colouring works; respect its chat-card collapse setting |
| Item Piles | `game.itempiles` | no dependency; materials bought from an Item Piles merchant are ordinary items that can be earmarked; reading merchant prices is OQ-32 |
| Calendar modules (Calendaria, Simple Calendar Reborn) | none needed | time is read only from `game.time.worldTime` and `updateWorldTime`; dates display through `game.time.calendar` or the pf2e world clock; that these modules drive core world time is to be tested (OQ-18). Seasons & Stars is not verified for v14. |
| PF2e Convenient Consumables | active flag | "Use best consumable" (8.9) covers the same ground; both are user-triggered, so nothing competes; Settings notes the overlap |
| PF2e Talisman Manager | active flag | it owns affixing: the module records no affixes and shows its state where readable; daily talisman creation is still the system's and ours |
| PF2e Alchemist Remaster Duct Tape | `game.modules.get("pf2e-alchemist-remaster-ducttape")?.active` | section 8 steps aside entirely (8); its Level Up feature (writes every tier into the book) is compatible with families |
| pf2e-downtime-scaling, Simplified Crafting, Heroic Crafting Automation | active flags | they replace or extend the Craft button or use a different ruleset: Settings and a GM notice warn about overlapping crafting; no `conflicts` entry in the manifest |
| SpazzMods PF2e Earn Income | active flag | warning against paying the same job in both modules |
| PF2e Downtime Tracker, Rutz's PF2e Days | active flags | coexist; Rutz's Days moves the world clock, which our accrual simply sees |
| pf2e-kingmaker-tools | none | no integration; camping and cooking are out of scope |
| PF2e HUD, Token Action HUD | none | must not collide with the token HUD palette (OQ-33) |

---

## 14. Settings

Scopes: W = world (GM and assistant GMs), C = client, U = user. Defaults follow P10: the master switch
is off; once it is on, the features are on except vial gathering.

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
| `features.vialGathering` | W | off | 8.7; writes to actors as world time passes |
| `features.tattoos` | W | on | tattoo and graft orders (process per `rules.tattooProcess`) |
| `features.sheetEntryPoints` | W | on | sheet strips and header buttons |
| `members` | W | `party` | Workshop members: active pf2e party, or all player characters |
| `strongbox` | W | `module` | `module` or `party` (requires players to own the Party actor) |
| `chat.visibility` | W | `involved` | whisper to involved users, or public |
| `legacy.show` | W | off | show legacy content and tier-4 registry entries |

There is no setting that limits the Advance days wizard to GMs (9.2), and no combat-provider choice:
Duct Tape's presence decides it (section 8), and `features.combat` turns ours off.

### 14.2 Rules-gap and interpretation settings

The Basis column is an internal note for reviewers. It never goes into `lang/en.json`; setting hints
are written by the author without rules prose (P9).

| Key | Default | Basis |
|---|---|---|
| `rules.legendaryItemLevel` | 17 | Player Core p.237; GM Core p.223 says 16 (OQ-7) |
| `rules.uncommonNeedsFormula` | off | Player Core p.237 needs only access; GM Core p.223 needs the formula (OQ-37) |
| `rules.easyDcForRepeat` | off | optional −2 for the exact item made before, GM Core p.53 |
| `rules.setupInterruptionPersists` | on | 6.2.5 |
| `rules.recomputeRateOnLevelUp` | on | 6.2.5 |
| `rules.crafterSwapRestarts` | on | 6.2.5 |
| `rules.familyCoversLowerGrades` | on | PC2 Quick Alchemy treats one formula for any level as the normal rule; Remaster first (6.4, OQ-11) |
| `rules.preciousCoinForCommon` | on | 6.6 |
| `rules.reverseEngineerDestroys` | off | Player Core p.294: no disassembly; legacy Core Rulebook p.293 disassembled (OQ-12) |
| `rules.allyCopyCostCp` | 0 | Remaster is silent; legacy allowed copying (OQ-12) |
| `rules.formulaSurchargeUncommon`, `...Rare` | 0% | GM Core p.48 suggests 10-100% and 25-500% |
| `rules.inventorRarity` | off | Inventor: uncommon or rare only if the GM allows |
| `rules.inventorRarityDcAdjust` | +2 / +5 | Inventor: with a higher DC (OQ-12) |
| `rules.inventorSetupDays` | 2 | unstated (OQ-12) |
| `rules.communal.*` | see 6.7 | RAW gaps (OQ-6) |
| `rules.snareDowntimeBatch` | 4 | consumable trait implies 4 (OQ-14) |
| `rules.magicalSnaresNeedMagicalCrafting` | on | OQ-14 |
| `rules.snareToolkitIsArtisans` | on | no snare toolkit item exists (OQ-14) |
| `rules.tattooProcess` | `secrets-of-magic` | decision log; `simple` is the toggle |
| `rules.tattooHealingDays` | 30 | Secrets of Magic p.164: a healing period of up to about a month |
| `rules.tattooSubjectLocked` | on | OQ-13 |
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
them). The schema version is not a setting; it lives in `flags.MOD.schema` on the shared documents
(4.14).

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
- Lint (ESLint flat config): bans the v15-removed globals (`renderTemplate`, `loadTemplates`,
  `getTemplate`, `ActorSheet`, `ItemSheet`, `Dialog`, `Application`, `FormApplication`, `FilePicker`,
  `ContextMenu`, `DragDrop`, `duplicate`, `$`, `jQuery`), `instanceof HTML*`, `requestAnimationFrame`, the
  `-=`/`==` update keys (regex ``["'`\.][=-]=``), `data-action` in chat templates, and string literals in
  templates and notifications.
- Development runs set `CONFIG.compatibility.mode` to FAILURE with `includePatterns` for this module, so
  any deprecated call throws.

### 15.2 Registry validation

`tools/validate-registry.mjs` against a sparse checkout of a pinned `pf2e-` tag (packs and the source
paths in 3.3) in CI, and against the newest tag and the dev head in the churn watch (6.11).

### 15.3 Local Foundry harness

- Foundry Node build under Node 24 with its own data path and port, not reachable by anyone but the
  developer (Foundry's licence allows a private development server next to a live one, provided nobody
  else can get past its login). The developer installs Foundry and enters the licence key.
- pf2e pinned by release manifest (`releases/download/pf2e-<version>/system.json`); the module symlinked
  in (no packs).
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
  11. Performance: Queue re-render time with 30 orders and 6 members.

### 15.4 Fixture actors

Generic builds created by a script from compendium items:

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

### 15.5 Compatibility matrix

| Axis | Values |
|---|---|
| Foundry | the manifest minimum, the Forge's current build, the latest stable |
| pf2e | the manifest minimum minor, the latest release, the dev head (registry only) |
| Companions | none; each of section 13 alone; all together |
| Users | 2 players without a GM; GM and players; GM and assistant GM |
| Host | self-hosted Node; the Forge |
| Presentation | light, dark, Parchment; widths 1024 (sidebar open), 1280, 1440+, detached |

### 15.6 What only the Forge can test

Installation and updates from the Bazaar and the listing lag; module templates, language files and CSS
served from the Forge CDN through relative paths; behaviour with the Forge's replaced FilePicker (the
module uses none) and its asset handling; `CONFIG.queries` relay behaviour there; load time with a large
module list; which build the Forge's default channel runs. This needs a Forge-hosted test world (OQ-34).

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
  `templates/`, `styles/`, `lang/`, `LICENSE`, `README.md`, `CHANGELOG.md`); upload `module.json` and
  `module.zip`; then, for stable releases only, register the release with the Package Release API.
  Actions are pinned by commit SHA.

### 16.3 Manifest URLs and the Package Release API

- `manifest`: `https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/latest/download/module.json`
  (GitHub "latest" skips pre-releases, which makes it the stable channel). Pre-releases set their own
  `manifest` to their version-specific URL, so testers stay on the pre-release channel.
- `download`: `https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/download/<tag>/module.zip`.
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
  rewritten; the commit is the author's.
- `tools/check-strings.mjs` fails when any key is missing from the sign-off file or its hash differs;
  it prints the offending keys. Report mode in pull requests and pre-releases, enforce mode on stable
  releases (16.2).
- The same mechanism covers `README.md` and the package description file (`docs/package-description.md`),
  hashed whole.
- The gate proves sign-off, not authorship; the rewrite itself is the author's process.

### 16.5 No AI assets

The repository contains no images, audio or fonts. Icons are Font Awesome classes (bundled with Foundry
v14), Foundry core icons or pf2e system icon paths; item images come from the compendium. A CI check
fails if any image, audio or font file appears outside an empty allowlist.

### 16.6 Licences and notices

- Code: MIT (`LICENSE`).
- The module ships no Paizo text. It does ship numeric mechanics (the tables in 6.1, rarity adjustments,
  thresholds and caps), which come from ORC-licensed Remaster books (Player Core, Player Core 2, GM Core,
  Treasure Vault (Remastered)), plus the Secrets of Magic tattoo process (OGL 1.0a). The README carries
  an ORC notice (licence location, attribution of the upstream works, reserved material) and an OGL 1.0a
  section 15 entry for the OGL sources used.
- Paizo's Community Use Policy notice, copied exactly from paizo.com, goes in the README and the package
  description if the module relies on that policy for trademark references (OQ-35).
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

Milestones in dependency order. No public release until M13.

| # | Milestone | Contents | Depends on |
|---|---|---|---|
| M0 | Scaffold | `module.json` (unreleased), folder layout, ESLint rules, `node --test` harness, strings gate and asset check scripts, PR workflow, local Foundry harness with fixture-actor script | |
| M1 | Rules core | 6.1-6.8 and 6.10 as pure modules with tests; coin planner; pro-rata splitter | M0 |
| M2 | Storage and sync | shared documents and bootstrap, schema and migrations, key-path store, responsible-client resolver, claims, `modifyBatch` coin moves, roster snapshots, deletion guards, purge, reconciliation | M1 |
| M3 | Registry and roll wrapper | registry tiers 1-2, validation script, roll wrapper with reroll recording, Earn Income roll | M1, M2 |
| M4 | Queue and Funds | Workshop shell, Queue and Funds tabs, order lifecycle, escrow and refunds, pickup shelf, chat cards, request drag and drop | M2, M3 |
| M5 | Formulas | codex, families, provenance, acquisition jobs, picks owed, casting pledges, precious materials, service orders, rune etching, upgrades and transfers | M4 |
| M6 | Downtime | per-PC status, clock accrual and prompts, day resolver, Advance days wizard, Communal Crafting helpers, Earn Income jobs, settlement profiles | M4 |
| M7 | Morning | daily sources panel, loadouts, standing orders, Talisman Dabbler and Esoterica lists, the Dabbler DC stamp, affix records, party-wide expiry, rest ordering, pf2e-dailies custom daily | M5 |
| M8 | Combat | Bandolier, HUD palette, Quick Alchemy panel, quick vials, Quick Bomber, Healing Bomb, additives, vial gathering, turn expiry, Duct Tape step-aside, Use best consumable | M7 |
| M9 | Tattoos and remaining crafts | tattoo process and toggle, grafts, spellhearts, fulus, missives, snares and gadgets specifics, spell-supplied items beyond scrolls and wands | M5, M6 |
| M10 | Extension API | registration, interfaces, hooks, extension store; the separate circus module built against it as acceptance test | M6 |
| M11 | Integration surface | sheet and party entry points, macros and shelf, keybindings, theming, accessibility pass | M4-M9 |
| M12 | Hardening | full section 15 matrix, performance, Forge test, pre-release to a test table by manifest URL | M10, M11 |
| M13 | Listing | author rewrites every string, README and description; sign-off gate passes; notices final; release workflow dry run; listing submission; 1.0.0 | M12 |

---

## 18. Open questions

| # | Question | Interim default | How to settle |
|---|---|---|---|
| OQ-1 | Is `foundry.documents.modifyBatch` applied transactionally on the server, and do per-document hooks fire for batched operations? | **Settled** from the Foundry 14.368 source: not transactional (dry run of every operation, then applied in order, stopping at the first error without rollback); per-document hooks fire for batched results. Design: lock-first batches (5.4) | harness scenario 7 confirms in a live world |
| OQ-2 | Does `getRollOptions("item")` on an ephemeral, unsaved item owned by the crafter return the full option set? | ephemeral item with the crafter as parent | harness |
| OQ-3 | Do the order roll option and `context.isReroll` reliably survive Hero Point rerolls, and does the reroll message's author equal the rerolling user? | as designed in 6.12 | harness scenario 1 |
| OQ-4 | Default ownership OWNER on a module journal and a loot actor: any side effects in pf2e (for example the loot sheet's merchant mode or token behaviour)? | strongbox never placed on a scene | harness |
| OQ-5 | Roster snapshots make every member's formulas, relevant feats and skill ranks readable by all players (the UI hides ranks when pf2e's `partyStats` is off, but the data sits in a shared document). Acceptable, or publish less? | publish as in 4.10 | author decision |
| OQ-6 | Communal Crafting RAW gaps: helper DC, degree mapping, timing of helper rolls, leaving | settings in 6.7 | author decision on defaults |
| OQ-7 | Legendary threshold: Player Core 17 or GM Core 16? | 17 | Paizo errata or author decision |
| OQ-8 | Does Talisman Dabbler's knowledge of talisman formulas count as having the formula, giving the 1-day setup for permanent talismans? | yes | rules reading by the author |
| OQ-9 | Do interrupted setup days persist? | yes | author decision |
| OQ-10 | Level-up mid-project: recompute the rate? Crafter swap: restart setup and check? | recompute; restart | author decision |
| OQ-11 | Does a family formula also cover lower grades? PC2 Quick Alchemy states, as the normal rule, that one formula covers any level of the item; GM Core p.223 mentions only higher-level types | yes for every route, with a setting to restrict coverage to higher grades | rules reading |
| OQ-12 | Inventor setup days and uncommon/rare DC; DC for crafting a copy of a formula; reverse-engineering destroying the item (Player Core p.294 has no disassembly; PC2 Reverse Engineering still assumes the legacy one); cost of copying from an ally | 2 days, +2/+5; item DC; kept; free | rules reading and author decision |
| OQ-13 | Do Impossible Magic or Treasure Vault (Remastered) restate or change the Secrets of Magic tattoo process? Is the subject's downtime occupied? | Secrets of Magic process; subject locked | the author checks both books |
| OQ-14 | Snares: downtime batch size, which toolkit counts, whether magical snares also need Magical Crafting | 4; artisan's toolkit; yes | rules reading |
| OQ-15 | Casting pledges: can a slot be expended through a public pf2e API; how to build a scroll or wand without pf2e's unexported builder | checklist confirmation; build from base items | pf2e source and harness |
| OQ-16 | Are downtime-crafted alchemical items infused (so Powerful Alchemy applies)? | not infused | rules reading |
| OQ-17 | Earn Income without a settlement profile: may the player pick any task level? Size of the "other skill" DC bump | the player picks, badged "unconfirmed"; +5 | author decision |
| OQ-18 | Do Calendaria and Simple Calendar Reborn always move core `worldTime`? (The second half is settled from the pf2e source: the World Clock's day boundary does not match `floor(worldTime / 86400)`, because its date starts at `worldCreatedOn`, captured at an arbitrary time of day; 4.8 applies an offset.) | assumed yes | harness |
| OQ-19 | Mechanism for inert items: is cancelling use and Strike messages in `preCreateChatMessage` reliable? How do effect items record their origin item, for ending effects and the 10-minute cap? | as in 7.7 and 8.8 | pf2e source and harness |
| OQ-20 | Exact pf2e-dailies signal that its interface has finished, for applying loadouts afterwards | its `rested` flag returning to false | pf2e-dailies source and harness |
| OQ-21 | Worlds with several pf2e parties: one Workshop per world with orders tagged by party, or one per party? | one per world, tagged | author decision |
| OQ-22 | Should Advanced Vials material choice be per vial at creation (as designed) or per throw for simplicity? | per vial buckets | playtest |
| OQ-23 | Ship a legacy rules toggle (formula always required, 4-day setup, legacy Inventor)? | no; legacy content only, badged | author decision |
| OQ-24 | Treasure Vault (Remastered) crafting variants (Complex Crafting, Critical Crafting, Deconstruct, crafting events) in scope? | out of scope for the first release | author decision |
| OQ-25 | Track staged afflictions for crafted poisons, or treat them as ordinary items? | ordinary items | author decision |
| OQ-26 | Snare placement on the map (Stealth DC from the creator's Crafting DC, 24-hour inertness) in scope? | out of scope | author decision |
| OQ-27 | Can additives use per-Strike roll options instead of the system's actor-wide toggles? | system toggles | harness |
| OQ-28 | Is the Extra Vial familiar ability in the pf2e familiar pack, and how is it represented? | manual button | pf2e source |
| OQ-29 | Bomb splash templates with v14 Regions | numbers only, no placement | pf2e source and harness |
| OQ-30 | Final AppV2 class names for pf2e sheets (`getHeaderControls<Class>`) | both hook families | upstream watch |
| OQ-31 | Do DragDrop listeners survive moving an ApplicationV2 window to a detached window? | rebind on `openDetachedWindow` if needed | harness scenario 8 |
| OQ-32 | Item Piles API method names for reading merchant prices, and whether that is worth doing | no integration | Item Piles source |
| OQ-33 | Do PF2e HUD or Token Action HUD alter the core token HUD's left column? | inject anyway, null-guarded | harness |
| OQ-34 | How the Forge test will be run (trial world or a Forge-hosted test table) | before M12 | author decision |
| OQ-35 | Does the module rely on Paizo's Community Use Policy at all, given it ships only ORC/OGL mechanics and references by UUID? Is "PF2e" in the title acceptable to Paizo? | include the CUP notice; keep "PF2e" in the title as other pf2e modules do | licence review by the author |
| OQ-36 | Archive thresholds and the ledger document size at which performance suffers | 30 and 60 workshop days | harness scenario 11 |
| OQ-37 | Uncommon or rarer items without a formula: Player Core p.237 allows any access; GM Core p.223 requires the formula | Player Core reading: access from a known formula or a registry grant; `rules.uncommonNeedsFormula` off | Paizo errata or author decision |
| OQ-38 | Does tier-4 legacy content include items that exist only in the PF2e Legacy Data module (different UUIDs)? | excluded from the first release; only items in the pf2e system packs | author decision |
