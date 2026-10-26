# pf2e-artisans-workshop

Foundry VTT module for the PF2e system: a crafting manager for alchemists and
crafters and the party around them (request queue, materials and gold
contributions, crafting time incl. Communal Crafting, progress tracking, daily
preparations, GM Earn Income). Public, MIT, `gmtoolkit/pf2e-artisans-workshop`.

## Status

M0 scaffold in place (manifest, lint rules, tests, strings gate, asset and manifest
checks, CI, harness fixtures). The M1 rules core is in place as pure functions with
tests (`scripts/logic/`, its tables in `scripts/data/`, tests in `test/logic/`), not yet
wired into Foundry; nothing user-facing exists yet. `DECISIONS.md` holds every decision
made so far, newest first; read it before proposing a design change.

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
