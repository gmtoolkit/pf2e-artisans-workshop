import { MODULE_ID } from "./constants.mjs";

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
    if (isDev()) {
        CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.FAILURE;
        CONFIG.compatibility.includePatterns.push(new RegExp(`/modules/${MODULE_ID}/`));
    }
});

Hooks.once("ready", async () => {
    if (!isDev() || !game.user.isGM) return;
    await loadDevHarness();
});

/* -------------------------------------------- */
/*  Development harness                          */
/* -------------------------------------------- */

function isDev() {
    return game.settings.get(MODULE_ID, "dev") === true;
}

/**
 * Load the fixture-actor tools from `tools/harness/`.
 *
 * `tools/` is not in the release zip (DESIGN.md 16.2), so this only works from a development checkout
 * symlinked into `Data/modules`. Nothing is imported unless the dev flag is on, and a failed import
 * is logged rather than thrown, so a released copy with the flag set still starts normally.
 */
async function loadDevHarness() {
    try {
        const { fixtures } = await import("../tools/harness/fixture-actors.mjs");
        game.modules.get(MODULE_ID).dev = { fixtures };
        console.log(`${MODULE_ID} | dev harness ready: game.modules.get("${MODULE_ID}").dev.fixtures`);
    } catch (error) {
        console.error(`${MODULE_ID} | dev harness not available`, error);
    }
}
