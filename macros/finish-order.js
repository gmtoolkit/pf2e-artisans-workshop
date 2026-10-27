// Artisan's Workshop macro 5: finish-order (DESIGN.md 11.1). Runs api.orders.finish({ order: null }). Without order it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("finish-order", { order: null });
