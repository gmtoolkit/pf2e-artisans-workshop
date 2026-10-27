// Artisan's Workshop macro 20: use-best (DESIGN.md 11.1). Runs api.consumables.useBest({ family: null, actor: null, partyWide: false }). Without family it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("use-best", { family: null, actor: null, partyWide: false });
