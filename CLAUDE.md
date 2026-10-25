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
- Players do not own each other's actors or the shared queue: writes they need go
  through the GM over the module socket.
- Do not embed Paizo rules text. Reference system compendium items by UUID.
