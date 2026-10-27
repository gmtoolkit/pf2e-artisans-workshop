# pf2e-artisans-workshop

Foundry VTT module for the PF2e system: a crafting manager for alchemists and
crafters and the party around them (request queue, materials and gold
contributions, crafting time incl. Communal Crafting, progress tracking, daily
preparations, GM Earn Income). Public, MIT, `gmtoolkit/pf2e-artisans-workshop`.

## Status

M0 scaffold in place (manifest, lint rules, tests, strings gate, asset and manifest
checks, CI, harness fixtures). The M1 rules core is in place as pure functions with
tests (`scripts/logic/`, its tables in `scripts/data/`, tests in `test/logic/`). M2
storage and sync is in place: the Foundry-facing code in `scripts/foundry/` (shared
documents, key-path store, migrations, responsible client and lease, lock-first coin
batches, claims and the GM relay, roster snapshots, guards, purge, reconciliation),
its pure parts in `scripts/logic/`, tests over Foundry stubs in `test/foundry/`, and
live-harness scenarios in `tools/harness/sync-scenarios.mjs`, which the live driver
(`npm run harness:live`: `tools/harness/run-live.mjs`, plans and behaviour checks in
`live-plans.mjs`) runs in a dev world with every user at once, with and without a canvas.
M3 is in place: the rules registry (`scripts/data/registry.mjs`, its ignore list, the
lookups in `scripts/logic/registry.mjs`, `tools/validate-registry.mjs`) and the roll wrapper
and Earn Income roll (`scripts/foundry/rolls.mjs`, pure parts in `scripts/logic/rolls.mjs`;
live checks in `tools/harness/roll-scenarios.mjs`). The registry stores slugs, UUIDs,
numbers and predicates only; check a new entry with `npm run validate:registry`.
M4 is in place: the Workshop window with its Queue and Funds tabs (`scripts/ui/`,
`templates/`, `styles/workshop.css`; view models in `scripts/logic/views.mjs`), the order
lifecycle (`scripts/logic/orders.mjs`, `scripts/foundry/orders.mjs`), funds actions, chat
cards, notifications, the request form with drag and drop, the entry points (Actors
directory header, Party sheet header, `api.ui.open`) and the public API's first part
(`scripts/foundry/api.mjs`); DESIGN 10.10 says what was built. M4.1 added fund accounting (unallocated party
fund and money earmarked per order by source, `scripts/logic/funds.mjs`, `scripts/foundry/funds.mjs`), money typed as
pp/gp/sp/cp, plain-language requirements, work-day and cost summaries and where a finished item went (DESIGN 10.10).
M5 is in place: formulas (the Formulas tab, `scripts/ui/formulas.mjs`, the
Codex's pure parts in `scripts/logic/codex.mjs`, acquisition and the formula claim in `scripts/foundry/formulas.mjs`),
casting pledges (`scripts/logic/pledges.mjs`, `scripts/foundry/pledges.mjs`), runes (`scripts/logic/runes.mjs`),
service orders (`scripts/logic/services.mjs`, `scripts/foundry/services.mjs`), custody and material stock
(`scripts/foundry/custody.mjs`), what a finish makes (`scripts/foundry/outputs.mjs`) and the equipment catalogue
(`scripts/foundry/catalogue.mjs`), with its purchases paid from M4.1's sources (DESIGN 10.11, As built in M5 on M4.1);
DESIGN 10.11 says what was built, and the live plans `m5-*` (`tools/harness/formula-scenarios.mjs`) passed their first live pass (10.11, M5 live pass).
M6 is in place: downtime (the Downtime tab, `scripts/ui/downtime.mjs`; the Advance days wizard and day resolver,
`scripts/ui/advance.mjs`; the workshop day, per-PC status, the day planner and the prompt, `scripts/logic/downtime.mjs`,
`scripts/foundry/downtime.mjs`), Communal Crafting helpers (`scripts/foundry/communal.mjs`), Earn Income jobs and
settlement profiles (`scripts/logic/jobs.mjs`, `scripts/foundry/jobs.mjs`); DESIGN 10.12 says what was built, and the
live plans `m6-*` (`tools/harness/downtime-scenarios.mjs`) passed their first live pass (10.12, M6 live pass).
M7 is in place: daily preparations (the Morning tab, `scripts/ui/morning.mjs`; sources, loadouts, standing orders, the
affix board and preparing through pf2e's `CraftingAbility` methods, `scripts/foundry/morning.mjs`; party-wide expiry by
preparation cycle, `scripts/foundry/expiry.mjs`; rest ordering with and without pf2e-dailies, `scripts/foundry/rest.mjs`;
the pf2e-dailies custom daily, `scripts/foundry/dailies.mjs`; pure parts in `scripts/logic/morning.mjs`, `expiry.mjs`,
`talismans.mjs`); DESIGN 10.13 says what was built, and the live plans `m7-*` (`tools/harness/morning-scenarios.mjs`) passed
their first live pass (10.13, M7 live pass).
M8 is in place: combat (the Bandolier, `scripts/ui/bandolier.mjs`; the Quick Alchemy panel, `scripts/ui/alchemy-panel.mjs`;
the token HUD palette, `scripts/ui/hud.mjs`; the combat cards and keybindings, `scripts/ui/combat-cards.mjs`,
`combat-entry.mjs`; Quick Alchemy, quick vials, Quick Bomber and Healing Bomb through pf2e's `CraftingAbility#craft` and its
Strike, `scripts/foundry/alchemy.mjs`, `combat.mjs`; vial gathering, `scripts/foundry/vials.mjs`; "Use best consumable",
`scripts/foundry/consumables.mjs`; turn expiry in `scripts/foundry/expiry.mjs`; the Duct Tape step-aside; pure parts in
`scripts/logic/alchemy.mjs`, `vials.mjs`, `consumables.mjs`); DESIGN 10.14 says what was built, and the live plans `m8-*`
(`tools/harness/combat-scenarios.mjs`) passed their first live pass, with and without a canvas (10.14, M8 live pass).
M8a is in place: the affliction tracker (the rules engine, `scripts/logic/affliction.mjs`; the runtime stage parser,
`scripts/logic/affliction-parse.mjs`, with its overrides and ignore list in `scripts/data/afflictions.mjs` and the corpus check
in `tools/validate-registry.mjs`; definitions, the backend and DCs, `scripts/foundry/affliction-defs.mjs`; exposure claims,
saves, recording, timing and the stage guard, `scripts/foundry/afflictions.mjs`; coatings and Strikes, `scripts/foundry/coatings.mjs`;
Affliction Forge, `scripts/foundry/forge.mjs`; the Afflictions window, cards and item-card augment, `scripts/ui/afflictions.mjs`);
DESIGN 10.15 says what was built, and the live plans `m8a-*` (`tools/harness/affliction-scenarios.mjs`) passed their first live
pass, with and without a canvas (10.15, M8a live pass).
M9 is in place: tattoos and grafts with their subject (consent, presence in downtime, one at a time, healing, investiture, the
simple toggle, Legendary Tattoo Artist's mark), the castings an item's description asks for (staves, codas, spellhearts,
specialty wands), fulus, missives, quick-deploy snares and gadget access (pure parts in `scripts/logic/crafts.mjs`,
`spell-lists.mjs`; `scripts/foundry/crafts.mjs`; the Queue's parts in `scripts/ui/crafts.mjs`); DESIGN 10.16 says what was
built, and the live plans `m9-*` (`tools/harness/craft-scenarios.mjs`) passed their first live pass (10.16, M9 live pass).
M9a is in place: every Treasure Vault (Remastered) crafting variant behind its own world setting, off by default (Complex
Crafting and Quick Setup, adjustments, downtime events, Critical Crafting, Deconstruct, Grow, gardens, bestowed gifts, crafting
quests; pure parts in `scripts/logic/variants.mjs` and `scripts/data/variants.mjs`; `scripts/foundry/variants.mjs`,
`deconstruct.mjs`, `nature.mjs`, `quests.mjs`; the window's parts in `scripts/ui/variants.mjs`); DESIGN 10.17 says what was
built, and the live plans `m9a-*` (`tools/harness/variant-scenarios.mjs`) passed their first live pass (10.17, M9a live pass).
M10 is in place: the extension API (registration at `setup`, the four interfaces, the hooks, each extension's store in its own
flag scope on the ledger, extension activity runs in the day planner and resolver, rows, income sources and consumable sinks;
pure parts in `scripts/logic/extensions.mjs`; `scripts/foundry/extensions.mjs`, `events.mjs`; a test extension of every
interface in `test/foundry/ext-fixture.mjs`); DESIGN 12.6 says what was built. The circus module is a separate repository
built against it; no live plan has run yet.
README screenshots: `npm run screenshots` (`tools/harness/screenshots.mjs`, DESIGN 17.1) stages a demo party in the dev
world and writes `docs/screenshots/`, the only folder where the asset check allows images.
`DECISIONS.md` holds every
decision made so far, newest first; read it before proposing a design change.

Development commands and layout are in the README's Development section. Use Node 24
(`DESIGN.md` 3.2); `npm run lint` and `npm test` must pass before a PR.

`DESIGN.md` is the specification (domain model, storage and sync, rules engine,
UI, extension API, build order M0-M13, open questions). Change it in the same PR as
any code that departs from it.

## Ground rules

- Build on the PF2e system's own crafting model (`CraftingAbility` methods, the
  formula list, special resources, coin items, Rest for the Night, Statistic rolls)
  instead of re-implementing it. Orders roll their own checks through the Crafting
  statistic with the item's roll options and an explicit DC; never route orders
  through the system Craft macro, and never replace its button. Read the system
  source rather than recalling its API; it changes between releases.
- Target the latest Foundry generation and latest PF2e release. Application V2 only.
- Coexist with pf2e-dailies, PF2e Toolbelt, PF2e Workbench and Item Piles. Never ship
  a second implementation of something they already automate.
- Any write triggered by a hook that fires on every client runs on exactly one
  responsible client (`DESIGN.md` 5.6: connected owner, else active GM, else first
  connected user; one tab per user via a Web Locks lease). Duplicate prompts across
  owners are the bug class this module exists to avoid.
- If PF2e Alchemist Remaster Duct Tape is active, the combat features step aside.
- Nothing waits on a GM. Shared state lives in module-created documents every player
  owns (ledger, strongbox); otherwise a client writes only documents its user owns.
  The GM relay (core `CONFIG.queries`) is an accelerator, never a requirement.
- No approval gates. Rules requirements (formula, materials, gold, gates) decide
  whether a Craft can start.
- Circus and other adventure-path subsystems are separate modules that use the
  public extension API. Do not add them here.
- Every user-facing string goes through `lang/en.json`; the author rewrites them
  before release, and a release gate checks the sign-off hashes.
- Do not embed Paizo rules text. Reference system compendium items by UUID.
