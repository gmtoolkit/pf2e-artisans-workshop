/**
 * PF2E Affliction Forge coexistence (DESIGN.md 8.10.11, 13, M8a). One engine per affliction:
 *
 * - while Affliction Forge is active the Workshop never applies an exposure to an actor that already has a Forge controller
 *   for the same source (`api.instances.listForActor`), never touches its controllers or the items that carry its references
 *   (`flags["pf2e-affliction-forge"].afflictionReferences`), refuses "Apply poison" on a weapon it already coats, and ignores
 *   Strikes from weapons that carry its references;
 * - with `afflictions.handOffToForge` on, an exposure whose source item has a linked Forge template (a reference on the item,
 *   or a template whose `definition.metadata.sourceUuid`, the provenance its importer writes, is the item's source) goes to
 *   `api.application.apply({templateUuid, targets, context: {saveDc}})` instead. Affliction Forge applies templates only on a
 *   GM client (its engine's `assertGm`, 0.1.74), so the hand-off is the active GM's; with no GM connected
 *   `afflictions.forgeWithoutGm` decides: `workshop` tracks it here (P2), `wait` keeps it pending.
 *
 * Read from its 0.1.74 README, `docs/API.md` and `docs/DATA_CONTRACT.md`; not run yet (OQ-41).
 */
import { MODULE_ID } from "../constants.mjs";
import { setting } from "./settings.mjs";

/** Affliction Forge's package id. */
export const FORGE = "pf2e-affliction-forge";

/** Whether Affliction Forge is active (13). */
export const forgeActive = () => game.modules?.get(FORGE)?.active === true;

/** Its public API, or null. */
export const forgeApi = () => (forgeActive() ? game.modules.get(FORGE)?.api ?? null : null);

/** Whether an item carries Affliction Forge references (a weapon it coats, an ability it links). */
export function forgeReferences(item) {
    const refs = item?.flags?.[FORGE]?.afflictionReferences;
    return Array.isArray(refs) ? refs.filter((r) => r?.enabled !== false && r?.templateUuid) : refs && typeof refs === "object" ? Object.values(refs).filter((r) => r?.templateUuid) : [];
}

/** Whether a document is one Affliction Forge manages (a template, a controller, a stage effect). */
export const forgeManaged = (item) => item?.flags?.[FORGE]?.managed === true;

/** Templates found by source UUID, per session (its template list is read once). */
let templates = null;

/** The Forge template linked to a source item (8.10.11): a reference on the item, else a template made from that source. */
export async function forgeTemplateFor(item, sourceUuid) {
    const api = forgeApi();
    if (!api) return null;
    const ref = forgeReferences(item)[0];
    if (ref) return ref.templateUuid;
    if (!sourceUuid) return null;
    if (!templates) {
        templates = new Map();
        try {
            const list = await api.templates?.list?.({ includeWorld: true, includeCompendia: true }) ?? [];
            for (const entry of list) {
                const doc = entry?.uuid ? entry : entry?.item ?? null;
                const source = doc?.flags?.[FORGE]?.definition?.metadata?.sourceUuid ?? entry?.definition?.metadata?.sourceUuid ?? null;
                if (source && doc?.uuid) templates.set(source, doc.uuid);
            }
        } catch (error) {
            console.warn(`${MODULE_ID} | could not read Affliction Forge's templates`, error);
        }
    }
    return templates.get(sourceUuid) ?? null;
}

/** Whether a creature already has a Forge controller for a source (one engine per affliction). */
export async function forgeControllerFor(actor, sourceUuid) {
    const api = forgeApi();
    if (!api || !actor) return false;
    try {
        const list = await api.instances?.listForActor?.(actor) ?? [];
        return list.some((c) => {
            const flags = c?.flags?.[FORGE] ?? c ?? {};
            const origin = flags.origin?.item?.sourceUuid ?? flags.origin?.itemUuid ?? flags.origin?.item?.uuid ?? null;
            const meta = flags.definitionSnapshot?.metadata?.sourceUuid ?? null;
            return !!sourceUuid && (origin === sourceUuid || meta === sourceUuid);
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not read Affliction Forge's controllers`, error);
        return false;
    }
}

/** The hand-off settings (14.5). */
export const forgeSettings = () => ({ handOff: setting("afflictions.handOffToForge") !== false, withoutGm: setting("afflictions.forgeWithoutGm") ?? "workshop" });

/**
 * Hand an exposure to Affliction Forge (8.10.11), on the active GM's client only: its engine throws on any other. `saveDc`
 * carries the DC the Workshop chose (8.10.4); a `fixed` template keeps its own.
 */
export async function handOff({ template, target, dc }) {
    const api = forgeApi();
    if (!api) return { ok: false, reason: "forge-off" };
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return { ok: false, reason: "not-gm" };
    try {
        await api.application.apply({ templateUuid: template, targets: target, context: { saveDc: dc ?? undefined } });
        return { ok: true };
    } catch (error) {
        console.warn(`${MODULE_ID} | Affliction Forge refused the hand-off`, error);
        return { ok: false, reason: "forge-refused" };
    }
}

/** For tests only. */
export function resetForge() {
    templates = null;
}
