// Artisan's Workshop macro 23: roll-pending (DESIGN.md 11.1). Runs api.afflictions.rollPending({ actor: null }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("roll-pending", { actor: null });
