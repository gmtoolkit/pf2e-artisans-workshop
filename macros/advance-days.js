// Artisan's Workshop macro 9: advance-days (DESIGN.md 11.1). Runs api.downtime.advance({ days: 1, advanceClock: false }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("advance-days", { days: 1, advanceClock: false });
