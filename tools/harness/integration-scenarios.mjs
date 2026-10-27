/**
 * Live-harness steps for M11 (DESIGN.md 10.4, 10.8, 10.9, 11.1, 13, 15.3 scenarios 8 and 10), merged into the scenarios of
 * `sync-scenarios.mjs` as scenario `m11`. The live driver's behaviour checks (`live-plans.mjs`, the `m11-*` plans) run them:
 * the character sheet's header button and Crafting tab strip with and without PF2e Toolbelt and PF2e Workbench, the Party
 * sheet's card (and pf2e rendering its region again), the Actors directory's context menu, the macro shelf and a tile
 * dragged onto the hotbar, every catalogue macro run once, the keybinding, an accessibility audit of the Workshop and the
 * shelf, the contrast of what they show in both schemes and with Parchment, and screenshots of the strip and the shelf.
 *
 * The steps read and write only through the module's own functions, pf2e's sheets and Foundry's API. Macros the steps make
 * are the user's own, flagged with the catalogue's id; `cleanup` deletes them and empties the hotbar slots they took. Console
 * output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { MACROS } from "../../scripts/logic/macros.mjs";
import { STRIP_CLASS, CARD_CLASS } from "../../scripts/ui/entry.mjs";
import { MacroShelf, ownMacroOf } from "../../scripts/ui/macros.mjs";
import { WorkshopApp } from "../../scripts/ui/workshop.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const actorOf = (p) => (p.actor ? fromUuidSync(p.actor) : game.user.character);

/** Wait until `test()` is truthy or `ms` pass. */
async function waitFor(test, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await sleep(100);
    }
    return null;
}

/** An Application V1 sheet's outer element (pf2e 8.6.1's sheets), or a V2 one's. */
const sheetElement = (sheet) => sheet?.element?.[0] ?? sheet?.element ?? null;

/** Close every window of the module (the Workshop, the shelf, the wizard, the request form) and its dialogs. */
async function closeOurs() {
    for (const app of [...foundry.applications.instances.values()]) {
        const classes = app.options?.classes ?? [];
        if (classes.includes(MODULE_ID) || app instanceof foundry.applications.api.DialogV2) await app.close({ animate: false }).catch(() => {});
    }
}

/** What the WCAG contrast of two `rgb(...)` colours is. */
function contrastOf(fg, bg) {
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
}

/** The colour behind an element: its own background, or the first ancestor's that is not transparent. */
function backgroundOf(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        const bg = style.backgroundColor;
        const alpha = Number((bg.match(/rgba\([^)]*,\s*([\d.]+)\)/) ?? [])[1] ?? 1);
        if (bg && bg !== "transparent" && alpha > 0.5) return bg;
    }
    return "rgb(255, 255, 255)";
}

/**
 * An accessibility audit of a window (10.9): buttons, links and fields without a name, positive tab indexes, images without
 * `alt`, tabs outside a tablist, and the text colours below 4.5:1 against what is behind them (large text 3:1).
 */
function audit(root) {
    if (!root) return null;
    // `aria-labelledby` may name several elements (the Downtime tab's activity select: its label, then the PC's name).
    const labelledBy = (el) => (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
        .map((id) => root.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
    const name = (el) => (el.getAttribute("aria-label") || labelledBy(el) || el.textContent || el.getAttribute("title") || (el.labels?.[0]?.textContent) || "").trim();
    const visible = (el) => el.getClientRects().length > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== "hidden";
    const unnamed = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=tab]")]
        .filter((el) => visible(el) && !name(el) && !el.closest("label")?.textContent?.trim())
        .map((el) => el.outerHTML.slice(0, 160));
    const positive = [...root.querySelectorAll("[tabindex]")].filter((el) => Number(el.getAttribute("tabindex")) > 0).map((el) => el.outerHTML.slice(0, 120));
    const noAlt = [...root.querySelectorAll("img:not([alt])")].map((el) => el.outerHTML.slice(0, 120));
    const looseTabs = [...root.querySelectorAll("[role=tab]")].filter((el) => !el.closest("[role=tablist]")).length;
    const lowContrast = [];
    for (const el of root.querySelectorAll("*")) {
        if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        const ratio = contrastOf(style.color, backgroundOf(el));
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) lowContrast.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: style.color, bg: backgroundOf(el) });
    }
    return { unnamed, positive, noAlt, looseTabs, lowContrast: lowContrast.slice(0, 20), lowContrastCount: lowContrast.length };
}

/**
 * The windows a macro run opened: the module's own (its class on the window) and core's dialogs (the questions), by a class
 * that says which. Core's interface (the hotbar, the sidebar, the players list and the rest) is ApplicationV2 too and always
 * in `foundry.applications.instances`, so counting every rendered instance found a window for every run (M11 live pass).
 */
export function moduleWindows(apps) {
    const Dialog = foundry.applications.api.DialogV2;
    return [...apps].filter((a) => a?.rendered && ((a.options?.classes ?? []).includes(MODULE_ID) || (typeof Dialog === "function" && a instanceof Dialog)))
        .map((a) => (a.options?.classes ?? []).find((c) => c !== MODULE_ID && /window|shelf|panel|bandolier|request|advance|afflictions|dialog|workshop/.test(c))
            ?? a.constructor?.name ?? "window");
}

/** The user's macros of the catalogue (flagged with an id), and the hotbar slots that hold them. */
function catalogueMacros() {
    const mine = game.macros.filter((m) => m.flags?.[MODULE_ID]?.macro && m._source.author === game.user.id);
    const slots = Object.entries(game.user.hotbar ?? {}).filter(([, id]) => mine.some((m) => m.id === id)).map(([slot, id]) => ({ slot: Number(slot), id }));
    return { macros: mine.map((m) => ({ id: m.id, name: m.name, macro: m.flags[MODULE_ID].macro, command: m.command, type: m.type, img: m.img })), slots };
}

export const INTEGRATION_SCENARIOS = {
    m11: {
        about: "M11: the integration surface: sheet entries, the Party card, the context menu, macros and the shelf, keybindings, accessibility and theming.",
        modules: { about: "GM: turn PF2e Toolbelt (with lib-wrapper) and PF2e Workbench on or off (params.toolbelt, params.workbench); the pages must reload", run: async (p) => {
            const config = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
            const before = { toolbelt: !!config["pf2e-toolbelt"], workbench: !!config["xdy-pf2e-workbench"], libWrapper: !!config["lib-wrapper"] };
            if (p.toolbelt !== undefined) config["pf2e-toolbelt"] = !!p.toolbelt;
            if (p.workbench !== undefined) config["xdy-pf2e-workbench"] = !!p.workbench;
            if (p.toolbelt) config["lib-wrapper"] = true;
            await game.settings.set("core", "moduleConfiguration", config);
            return { before, after: { toolbelt: !!config["pf2e-toolbelt"], workbench: !!config["xdy-pf2e-workbench"] } };
        } },
        active: { about: "any client: whether Toolbelt and Workbench are active here", run: async () => ({
            toolbelt: game.modules.get("pf2e-toolbelt")?.active === true, workbench: game.modules.get("xdy-pf2e-workbench")?.active === true,
        }) },
        companions: { about: "the client: Toolbelt's crafting sort buttons (a user setting) and, as GM, Workbench's formula rarity colours (a world setting) on", run: async () => {
            const out = {};
            const keys = [...game.settings.settings.keys()];
            const sort = keys.find((k) => k.startsWith("pf2e-toolbelt.") && /sortList$/.test(k));
            if (sort) {
                await game.settings.set("pf2e-toolbelt", sort.slice("pf2e-toolbelt.".length), true);
                out.sortList = sort;
            }
            if (game.user.isGM && keys.includes("xdy-pf2e-workbench.playerCraftingRarityColour")) {
                await game.settings.set("xdy-pf2e-workbench", "playerCraftingRarityColour", true);
                out.rarityColour = true;
            }
            return out;
        } },
        sheet: { about: "the client: open params.actor's sheet on the Crafting tab and read the header button, the strip and what Toolbelt and Workbench put there", run: async (p) => {
            const actor = actorOf(p);
            const sheet = actor.sheet;
            await sheet.render(true);
            await waitFor(() => sheetElement(sheet)?.querySelector?.(".tab.crafting"), 8000);
            sheet._tabs?.[0]?.activate?.("crafting");
            await sleep(p.ms ?? 800);
            const root = sheetElement(sheet);
            const pane = root?.querySelector(".tab.crafting.crafting-pane") ?? root?.querySelector(".tab[data-tab='crafting']");
            const strip = pane?.querySelector(`.${STRIP_CLASS}`) ?? null;
            const out = {
                open: !!root, header: root?.querySelectorAll(".window-header .pf2e-artisans-workshop-open").length ?? 0,
                strips: pane?.querySelectorAll(`.${STRIP_CLASS}`).length ?? 0, first: !!strip && pane.firstElementChild === strip,
                stripText: strip?.textContent.replace(/\s+/g, " ").trim() ?? null,
                stripButtons: strip ? [...strip.querySelectorAll("button")].map((b) => b.dataset.pf2eArtisansWorkshopEntry) : [],
                stripFormulaItems: strip?.querySelectorAll(".formula-item, [data-item-id], [data-item-uuid], [data-action]").length ?? 0,
                stripWorkbench: strip ? [...strip.querySelectorAll("*")].filter((el) => [...el.classList].some((c) => c.startsWith("xdy-pf2e-workbench"))).length : 0,
                formulaItems: pane?.querySelectorAll("li.formula-item").length ?? 0,
                toolbeltSort: pane ? [...pane.querySelectorAll("header *")].filter((el) => /toolbelt|toobelt/.test(el.className) || el.dataset?.tooltip?.includes?.("toolbelt")).length : 0,
                workbenchRarity: pane?.querySelectorAll("li.formula-item [class*='xdy-pf2e-workbench-rarity']").length ?? 0,
                audit: strip ? audit(strip) : null,
            };
            if (p.click) {
                strip?.querySelector(`[data-pf2e-artisans-workshop-entry='${p.click}']`)?.click();
                await sleep(1200);
                out.clicked = { workshop: !!WorkshopApp.instance?.rendered, acting: WorkshopApp.instance?.actingActor?.()?.uuid ?? null,
                    tab: WorkshopApp.instance?.tabGroups?.primary ?? null, requestForm: [...foundry.applications.instances.values()].some((a) => a.options?.classes?.includes?.("workshop-request")) };
            }
            if (!p.keep) await sheet.close();
            return plain(out);
        } },
        party: { about: "the client: open the Party sheet on its Overview, read the card, have pf2e render the region again (a member update) and read it again", run: async (p) => {
            const party = game.actors.party;
            const sheet = party.sheet;
            await sheet.render(true);
            await waitFor(() => sheetElement(sheet)?.querySelector?.("[data-region]"), 8000);
            sheet._tabs?.[0]?.activate?.("overview");
            await sleep(800);
            const read = () => {
                const region = sheetElement(sheet)?.querySelector("[data-region='overview']");
                const cards = region?.querySelectorAll(`.${CARD_CLASS}`) ?? [];
                return { region: !!region, cards: cards.length, afterSummary: cards[0]?.previousElementSibling?.matches?.("section.summary") ?? false,
                    facts: cards[0] ? [...cards[0].querySelectorAll("dd")].map((dd) => dd.textContent.trim()) : [],
                    header: sheetElement(sheet)?.querySelectorAll(".window-header .pf2e-artisans-workshop-open").length ?? 0 };
            };
            const first = read();
            // pf2e renders the member regions again on its own when a member changes (no render hook).
            sheet.render(false, { actors: true });
            await sleep(1500);
            const again = read();
            const out = { first, again, audit: audit(sheetElement(sheet)?.querySelector(`.${CARD_CLASS}`)) };
            if (!p.keep) await sheet.close();
            return plain(out);
        } },
        open: { about: "any client: is the Workshop open, acting as whom, on which tab, with which filter and detail", run: async () => {
            const app = WorkshopApp.instance;
            return plain({ open: !!app?.rendered, acting: app?.actingActor?.()?.uuid ?? null, tab: app?.tabGroups?.primary ?? null,
                filter: app?.filters?.scope ?? null, selected: app?.selected ?? null, classes: app ? [...app.element.classList] : [] });
        } },
        close: { about: "any client: close the module's windows and dialogs", run: async () => {
            await closeOurs();
            return { closed: true };
        } },
        shelf: { about: "the client: open the macro shelf from the Workshop's status bar and read its tiles", run: async () => {
            await closeOurs();
            const { openWorkshop } = await import("../../scripts/ui/workshop.mjs");
            const app = await openWorkshop({ tab: "queue" });
            app.element.querySelector("button[data-action='macros']")?.click();
            await waitFor(() => MacroShelf.instance?.rendered, 5000);
            const root = MacroShelf.instance?.element ?? null;
            return plain({
                open: !!root, tiles: root ? [...root.querySelectorAll(".macro-tile")].map((t) => t.dataset.macro) : [],
                draggable: root?.querySelectorAll(".macro-tile[draggable='true']").length ?? 0, canScript: game.user.can("MACRO_SCRIPT"),
                hotbarButtons: root?.querySelectorAll("button[data-action='hotbar']").length ?? 0, audit: audit(root),
            });
        } },
        hotbar: { about: "any client: the user's catalogue macros and the hotbar slots that hold them", run: async () => plain(catalogueMacros()) },
        cleanup: { about: "any client: delete the user's catalogue macros and empty the slots they held", run: async () => {
            const { macros, slots } = catalogueMacros();
            const hotbar = foundry.utils.deepClone(game.user.hotbar ?? {});
            for (const { slot } of slots) delete hotbar[slot];
            if (slots.length) await game.user.update({ hotbar: _replace(hotbar) });
            if (macros.length) await Macro.implementation.deleteDocuments(macros.map((m) => m.id));
            return { deleted: macros.length, slots: slots.length };
        } },
        run: { about: "the client: run catalogue macros (params.ids, default all) with params.args[id]; a question that opens is answered by closing it", run: async (p) => {
            const api = game.modules.get(MODULE_ID).api;
            const ids = p.ids ?? MACROS.map((m) => m.id);
            const out = [];
            for (const id of ids) {
                await closeOurs();
                const notesBefore = window.__live?.notes?.length ?? 0;
                const started = Date.now();
                const running = api.macros.run(id, p.args?.[id] ?? {});
                const settled = await Promise.race([running.then((r) => ({ done: true, result: r })), sleep(p.wait ?? 3000).then(() => ({ done: false }))]);
                const windows = moduleWindows(foundry.applications.instances.values());
                await closeOurs();
                const result = settled.done ? settled.result : await Promise.race([running, sleep(3000).then(() => ({ pending: true }))]);
                const notes = (window.__live?.notes ?? []).slice(notesBefore).map((n) => ({ type: n.type, message: n.message }));
                out.push({ id, ms: Date.now() - started, asked: !settled.done, windows,
                    result: result && typeof result === "object" ? { ok: result.ok, reason: result.reason ?? null, outcome: result.outcome ?? null, app: !!result.rendered || !!result.element } : result ?? null,
                    notes });
            }
            await closeOurs();
            return plain(out);
        } },
        keybinding: { about: "the client: bind (params.bind: true) Open Workshop to Alt+Shift+W, or put it back unbound", run: async (p) => {
            await game.keybindings.set(MODULE_ID, "openWorkshop", p.bind ? [{ key: "KeyW", modifiers: ["Alt", "Shift"] }] : []);
            const action = game.keybindings.actions.get(`${MODULE_ID}.openWorkshop`);
            return { registered: !!action, bindings: plain(game.keybindings.get(MODULE_ID, "openWorkshop")),
                others: ["openBandolier", "quickAlchemy"].map((id) => !!game.keybindings.actions.get(`${MODULE_ID}.${id}`)) };
        } },
        focus: { about: "any client: what has focus (inside which window, which control) and the Workshop's tier", run: async () => {
            const active = document.activeElement;
            const app = WorkshopApp.instance;
            return plain({
                tag: active?.tagName ?? null, inWorkshop: !!app?.element?.contains(active), inDetail: !!active?.closest?.(".order-detail"),
                inShelf: !!MacroShelf.instance?.element?.contains(active), tab: active?.dataset?.tab ?? null, action: active?.dataset?.action ?? null,
                macro: active?.closest?.("[data-macro]")?.dataset.macro ?? null,
                op: active?.dataset?.op ?? null, orderId: active?.closest?.("[data-order-id]")?.dataset.orderId ?? null, label: active?.getAttribute?.("aria-label") ?? null,
                text: active?.textContent?.trim().slice(0, 40) ?? null, width: app?.element?.clientWidth ?? null, selected: app?.selected ?? null,
                currentTab: app?.tabGroups?.primary ?? null, detailOpen: !!app?.element?.querySelector(".order-detail"),
            });
        } },
        size: { about: "any client: resize the open Workshop to params.width (the tier) and read the size it remembers", run: async (p) => {
            const app = WorkshopApp.instance;
            if (!app?.rendered) return { open: false };
            if (p.width) app.setPosition({ width: p.width, height: p.height ?? app.position.height });
            await sleep(900);
            return { open: true, width: app.element.clientWidth, saved: plain(game.settings.get(MODULE_ID, "ui.windowSize")) };
        } },
        audit: { about: "any client: the accessibility audit of the open Workshop (and the shelf, if open), with its theme classes", run: async () => plain({
            workshop: audit(WorkshopApp.instance?.element ?? null), shelf: audit(MacroShelf.instance?.element ?? null),
            scheme: document.body.classList.contains("theme-dark") ? "dark" : "light", classes: WorkshopApp.instance ? [...WorkshopApp.instance.element.classList] : [],
        }) },
        parchment: { about: "the client: the Parchment setting on or off (params.on)", run: async (p) => {
            await game.settings.set(MODULE_ID, "ui.parchment", !!p.on);
            await sleep(300);
            return { on: game.settings.get(MODULE_ID, "ui.parchment"), classes: WorkshopApp.instance ? [...WorkshopApp.instance.element.classList] : [] };
        } },
        own: { about: "any client: whether the user's catalogue macro of params.id exists (ownMacroOf)", run: async (p) => ({ id: ownMacroOf(p.id)?.id ?? null }) },
        table: { about: "any client: what core's keybindings change (the pause, the view, the controlled tokens and where the tokens stand); params.tokens activates the token layer and releases every token first; params.blur takes focus off any control", run: async (p) => {
            if (p.blur) document.activeElement?.blur?.();
            // A scene the GM just activated draws on every client a moment later.
            if (p.tokens) await waitFor(() => canvas?.ready && canvas.tokens?.placeables?.length, 15000);
            const ready = canvas?.ready === true;
            if (ready && p.tokens) {
                canvas.tokens.activate();
                canvas.tokens.releaseAll();
                await sleep(300);
            }
            const pivot = ready ? { x: Math.round(canvas.stage.pivot.x), y: Math.round(canvas.stage.pivot.y) } : null;
            return plain({
                paused: game.paused, canvas: ready, layer: ready ? canvas.activeLayer?.constructor?.name ?? null : null, pivot,
                controlled: ready ? canvas.tokens.controlled.map((t) => t.id).sort() : [],
                tokens: ready ? canvas.tokens.placeables.map((t) => ({ id: t.id, x: t.document.x, y: t.document.y })).sort((a, b) => (a.id < b.id ? -1 : 1)) : [],
                focus: document.activeElement?.tagName ?? null,
            });
        } },
    },
};
