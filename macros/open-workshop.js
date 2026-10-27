// Artisan's Workshop macro 1: open-workshop (DESIGN.md 11.1). Runs api.ui.open({ tab: "queue", actor: null, filter: null }).
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("open-workshop", { tab: "queue", actor: null, filter: null });
