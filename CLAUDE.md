# pf2e-artisans-workshop

Foundry VTT module for the PF2e system: a crafting manager for alchemists and
crafters and the party around them (request queue, materials and gold
contributions, crafting time incl. Communal Crafting, progress tracking, daily
preparations, GM Earn Income). Public, MIT, `gmtoolkit/pf2e-artisans-workshop`.

## Status

Design phase (started 2026-10-25). No code yet. `DECISIONS.md` holds every decision
made so far, newest first; read it before proposing a design change.

## Ground rules

- Build on the PF2e system's own crafting model (`CraftingAbility` rule element,
  the actor's crafting data, the Craft action) instead of re-implementing it. Read
  the system source rather than recalling its API; it changes between releases.
- Target the latest Foundry generation and latest PF2e release. Application V2 only.
- Coexist with pf2e-dailies, PF2e Toolbelt, PF2e Workbench and Item Piles. Never ship
  a second implementation of something they already automate.
- Any write triggered by a hook that fires on every client goes through exactly one
  responsible user (the acting user if connected, otherwise the active GM). Duplicate
  prompts across owners are the bug class this module exists to avoid.
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
