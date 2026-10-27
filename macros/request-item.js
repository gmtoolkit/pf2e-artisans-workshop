// Artisan's Workshop macro 2: request-item (DESIGN.md 11.1). Runs api.orders.request({ uuid: null, quantity: 1, recipient: null, crafter: null, note: "" }). Without uuid it asks for it.
// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.
game.modules.get("pf2e-artisans-workshop")?.api?.macros.run("request-item", { uuid: null, quantity: 1, recipient: null, crafter: null, note: "" });
