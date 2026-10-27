// Artisan's Workshop macro 15: healing-bomb (DESIGN.md 11.1). Runs api.alchemy.healingBomb({ actor: null, grade: "best", target: null }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("healing-bomb", { actor: null, grade: "best", target: null });
