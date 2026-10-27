// Artisan's Workshop macro 8: resolve-downtime (DESIGN.md 11.1). Runs api.downtime.resolve({ actor: null }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("resolve-downtime", { actor: null });
