// Artisan's Workshop macro 13: quick-bomb (DESIGN.md 11.1). Runs api.alchemy.quickBomb({ actor: null, family: null, damageType: null, createIfNone: true }). Without family it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("quick-bomb", { actor: null, family: null, damageType: null, createIfNone: true });
