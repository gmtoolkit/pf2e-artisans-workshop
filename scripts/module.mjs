import { MODULE_ID } from "./constants.mjs";
import { registerAfflictionHooks, readyAfflictions } from "./foundry/afflictions.mjs";
import { registerAlchemyHooks } from "./foundry/alchemy.mjs";
import { registerCoatingHooks } from "./foundry/coatings.mjs";
import { publishApi } from "./foundry/api.mjs";
import { registerFormulaClaims } from "./foundry/formulas.mjs";
import { registerDowntimeHooks } from "./foundry/downtime.mjs";
import { registerCraftHooks } from "./foundry/crafts.mjs";
import { registerDailies } from "./foundry/dailies.mjs";
import { registerExpiryHooks } from "./foundry/expiry.mjs";
import { registerRestHooks } from "./foundry/rest.mjs";
import { registerOrderHooks } from "./foundry/orders.mjs";
import { initSync, readySync } from "./foundry/sync.mjs";
import { registerVialHooks } from "./foundry/vials.mjs";
import { registerAfflictionUi } from "./ui/afflictions.mjs";
import { registerChatHooks } from "./ui/chat.mjs";
import { registerCombatEntry } from "./ui/combat-entry.mjs";
import { registerEntryPoints } from "./ui/entry.mjs";
import { primeNotifications, registerNotifications } from "./ui/notify.mjs";
import { registerWindowHooks } from "./ui/workshop.mjs";

/* -------------------------------------------- */
/*  Setup                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
    // Console only, for bug reports; nothing here is shown to users.
    console.log(`${MODULE_ID} | version ${game.modules.get(MODULE_ID).version}`);

    // Internal flag for the local test harness (DESIGN.md 14.3, 15.3). Hidden from the settings
    // window; a GM sets it from the console in a test world and reloads.
    game.settings.register(MODULE_ID, "dev", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
    });

    // Development runs make deprecation warnings throw (DESIGN.md 15.1). Core matches includePatterns
    // against the whole stack, so a warning throws whenever this module's files are on the stack, even
    // one raised inside pf2e, core or another module that this module (or the fixture builder) called.
    // Warnings whose stacks do not pass through this module are not reported at all in a dev world.
    // One is left out: Application V1's own warning. pf2e 8.6.1's check dialog is still V1, so a Craft check rolled
    // from the Workshop with its dialog (the ground rules want pf2e's dialog) would throw at the dialog's constructor;
    // this module's own code never uses V1, which the lint rules check (DESIGN.md 15.1).
    if (isDev()) {
        CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.FAILURE;
        CONFIG.compatibility.includePatterns.push(new RegExp(`/modules/${MODULE_ID}/`));
        CONFIG.compatibility.excludePatterns.push(/^The V1 Application framework is deprecated/);
    }

    // Storage and sync (DESIGN.md 5): settings, the GM relay, deletion guards and the all-client hooks.
    initSync();

    // The order lifecycle's one hook-driven write (the settlement repair, 6.12), and the Workshop window, its chat cards,
    // notifications and where it opens from (DESIGN.md 10, M4).
    registerOrderHooks();
    // M5: the formula claim's applier (5.5), so the claims sweep writes formulas into the learner's book.
    registerFormulaClaims();
    // M6: the prompt when downtime days accrue (9.1), the day offset frozen once, and the clock's high-water mark.
    registerDowntimeHooks();
    // M7: party-wide expiry (its claim, deadlines and the inert guard) and the rest ordering of 7.8.
    registerExpiryHooks();
    registerRestHooks();
    // M9: tattoos and grafts (6.14): healing ends and investiture on the subject's responsible client.
    registerCraftHooks();
    // M8: combat (DESIGN.md 8): the 10-minute cap on Quick Alchemy effects, vial gathering as world time passes, and the
    // Bandolier, the Quick Alchemy panel, the token HUD palette, the keybindings and the combat cards. Turn expiry is part
    // of the expiry hooks above; all of it steps aside while Duct Tape is active.
    registerAlchemyHooks();
    registerVialHooks();
    registerCombatEntry();
    // M8a: the affliction tracker (DESIGN.md 8.10): exposure and coating-spend claims, save recording, timing, the stage
    // guard, coated Strikes, and its window, cards and item-card augment. Independent of the combat features and Duct Tape.
    registerAfflictionHooks();
    registerCoatingHooks();
    registerAfflictionUi();
    registerChatHooks();
    registerNotifications();
    registerWindowHooks();
    registerEntryPoints();
});

Hooks.once("ready", async () => {
    await readySync();
    primeNotifications();
    publishApi();
    // M7 (7.9): the pf2e-dailies custom daily, when pf2e-dailies is active.
    registerDailies();
    // M8a (8.10.8): pending saves for the actors this client is responsible for, and the migration to native items.
    readyAfflictions().catch((error) => console.warn("pf2e-artisans-workshop | afflictions not ready", error));
    if (isDev()) await loadDevHarness();
});

/* -------------------------------------------- */
/*  Development harness                          */
/* -------------------------------------------- */

function isDev() {
    return game.settings.get(MODULE_ID, "dev") === true;
}

/**
 * Load the harness tools from `tools/harness/`: the sync scenarios on every client (they are run by several
 * users at once, DESIGN.md 15.3) and the fixture-actor tools for a GM.
 *
 * `tools/` is not in the release zip (DESIGN.md 16.2), so this only works from a development checkout
 * symlinked into `Data/modules`. Nothing is imported unless the dev flag is on, and a failed import
 * is logged rather than thrown, so a released copy with the flag set still starts normally.
 */
async function loadDevHarness() {
    try {
        const dev = { scenarios: (await import("../tools/harness/sync-scenarios.mjs")).scenarios };
        if (game.user.isGM) dev.fixtures = (await import("../tools/harness/fixture-actors.mjs")).fixtures;
        game.modules.get(MODULE_ID).dev = dev;
        console.log(`${MODULE_ID} | dev harness ready: game.modules.get("${MODULE_ID}").dev (${Object.keys(dev).join(", ")})`);
    } catch (error) {
        console.error(`${MODULE_ID} | dev harness not available`, error);
    }
}
