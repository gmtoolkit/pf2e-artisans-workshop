// Artisan's Workshop macro 16: gather-reagents (DESIGN.md 11.1). Runs api.alchemy.gatherReagents({ actor: null, minutes: 10 }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("gather-reagents", { actor: null, minutes: 10 });
