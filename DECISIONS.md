# Decision log: pf2e-artisans-workshop

Newest first.

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
