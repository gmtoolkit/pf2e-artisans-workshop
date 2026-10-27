// Artisan's Workshop macro 11: learn-formula (DESIGN.md 11.1). Runs api.formulas.acquire({ uuid: null, route: null, actor: null, from: null }). Without uuid and route it asks for them.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("learn-formula", { uuid: null, route: null, actor: null, from: null });
