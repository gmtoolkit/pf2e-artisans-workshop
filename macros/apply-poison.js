// Artisan's Workshop macro 21: apply-poison (DESIGN.md 11.1). Runs api.afflictions.applyPoison({ poison: null, weapon: null, actor: null }). Without poison and weapon it asks for them.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("apply-poison", { poison: null, weapon: null, actor: null });
