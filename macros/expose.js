// Artisan's Workshop macro 22: expose (DESIGN.md 11.1). Runs api.afflictions.expose({ item: null, targets: "targeted", delivery: null, dc: null }). Without item it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("expose", { item: null, targets: "targeted", delivery: null, dc: null });
