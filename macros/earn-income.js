// Artisan's Workshop macro 10: earn-income (DESIGN.md 11.1). Runs api.income.start({ actor: null, skill: null, taskLevel: null }). Without skill it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("earn-income", { actor: null, skill: null, taskLevel: null });
