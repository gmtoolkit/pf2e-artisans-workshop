// Artisan's Workshop macro 3: pledge (DESIGN.md 11.1). Runs api.funds.pledge({ order: null, amount: null, from: null }). Without order and amount it asks for them.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("pledge", { order: null, amount: null, from: null });
