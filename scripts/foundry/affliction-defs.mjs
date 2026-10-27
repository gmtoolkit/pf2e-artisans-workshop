/**
 * Affliction definitions, the backend and the DCs on this client (DESIGN.md 8.10.1, 8.10.2, 8.10.4, M8a).
 *
 * - **Definitions** (8.10.2): parsed at runtime, on the client that needs one, from the description of the item's compendium
 *   source (its `sourceId`), falling back to the item's own; cached in memory per source UUID and pf2e version; no text is
 *   stored. An override (`scripts/data/afflictions.mjs`) is merged onto the parse; a world definition
 *   (`afflictionDefs.<hash of the source UUID>` in the ledger, filled in by any member when nothing parses) wins over both.
 * - **The backend** (8.10.1, OQ-47): `native` once pf2e registers the affliction type in a release build, `effect` until
 *   then, by feature detection.
 * - **DCs** (8.10.4): the stamp at creation (Powerful Alchemy for an infused item that allows a save, written only when it
 *   raises the printed DC; the legacy Potent Poisoner, badged), the inline DC as pf2e resolves it for a holder, and the DC
 *   an exposure freezes.
 */
import { MODULE_ID } from "../constants.mjs";
import { AFFLICTION_OVERRIDES } from "../data/afflictions.mjs";
import { ownSaveDc, parseAffliction } from "../logic/affliction-parse.mjs";
import { chooseBackend, chooseDc, potentPoisonerDc, powerfulAlchemyDc, resolveDefinition } from "../logic/affliction.mjs";
import { hashId } from "../logic/ids.mjs";
import { heldKeysOf } from "./registry.mjs";
import { read } from "./store.mjs";
import { canWrite, status } from "./state.mjs";

/** Overrides by compendium UUID, and by slug for an item that has no source. */
const OVERRIDE_BY_UUID = new Map(Object.entries(AFFLICTION_OVERRIDES).map(([slug, entry]) => [entry.uuid, { slug, ...entry }]));

/** An item's compendium source UUID: pf2e's `sourceId`, else its compendium source, else its own UUID when it is in a pack. */
export function sourceUuidOf(item) {
    if (!item) return null;
    if (typeof item === "string") return item;
    return item.sourceId ?? item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? (item.pack ? item.uuid : null) ?? item.uuid ?? null;
}

/** The ledger key of a world definition for a source. */
export const worldDefKey = (sourceUuid) => hashId(`affliction-def:${sourceUuid}`);

/** The definition key a run records: the world definition's, else the source's. */
export const defKeyOf = (sourceUuid) => (sourceUuid ? `uuid:${sourceUuid}` : null);

/** The labels the parser matches: the system's localized stage and onset words, and the English ones. */
function labels() {
    const loc = (key, fallback) => {
        const text = game.i18n?.localize?.(key);
        return text && text !== key ? text : fallback;
    };
    const stage = loc("PF2E.Item.Affliction.StageLabel", "Stage");
    const onset = loc("PF2E.Item.Affliction.OnsetLabel", "Onset");
    return { stage: [...new Set([stage, "Stage"])], onset: [...new Set([onset, "Onset"])], maxDuration: ["Maximum Duration"], save: ["Saving Throw"] };
}

/** Parses cached per source UUID and pf2e version. */
const parsed = new Map();

/** The parse of an item's affliction text (its compendium source's, else its own), cached. */
async function parsedOf(item, sourceUuid) {
    const key = `${sourceUuid ?? item?.uuid}@${game.system?.version ?? ""}`;
    if (parsed.has(key)) return parsed.get(key);
    const source = sourceUuid && sourceUuid !== item?.uuid ? await fromUuid(sourceUuid).catch(() => null) : null;
    const doc = source ?? item;
    const html = doc?.system?.description?.value ?? item?.system?.description?.value ?? "";
    const statistic = doc?.system?.defense?.save?.statistic ?? null;   // a spell's save, against its caster's spell DC
    const def = parseAffliction(html, { level: doc?.system?.level?.value ?? doc?.level ?? 0, traits: [...(doc?.system?.traits?.value ?? [])],
        save: statistic ? { type: statistic, against: "spell" } : null }, labels());
    parsed.set(key, def);
    return def;
}

/** The world definition of a source, or null (8.10.2). */
export function worldDefinition(sourceUuid) {
    if (!sourceUuid || !["ready", "newer", "migrating", "stale"].includes(status())) return null;
    const record = read(`afflictionDefs.${worldDefKey(sourceUuid)}`);
    return record?.def ? { ...record.def, source: record.source } : null;
}

/**
 * The affliction definition of an item (or a source UUID) that applies (8.10.2): a world definition, an override merged onto
 * the parse, the parse. Each with `key` (the run's `defKey`) and `origin`. Null when nothing is known at all.
 */
export async function definitionOf(itemOrUuid) {
    const item = typeof itemOrUuid === "string" ? await fromUuid(itemOrUuid).catch(() => null) : itemOrUuid;
    const sourceUuid = sourceUuidOf(item ?? itemOrUuid);
    if (!item && !sourceUuid) return null;
    const world = worldDefinition(sourceUuid);
    const override = OVERRIDE_BY_UUID.get(sourceUuid) ?? [...OVERRIDE_BY_UUID.values()].find((o) => item?.slug && o.slug === item.slug) ?? null;
    const def = resolveDefinition({ world, override, parsed: item || sourceUuid ? await parsedOf(item, sourceUuid) : null });
    if (!def) return null;
    return { ...def, key: defKeyOf(sourceUuid), sourceUuid };
}

/** Write a world definition (8.10.2): any member may; it is stored with its author and the whole party reuses it. */
export async function defineWorld(sourceUuid, def) {
    if (!canWrite()) return { ok: false, reason: "not-ready" };
    if (!sourceUuid || !def?.stages?.length || !def.save?.type) return { ok: false, reason: "bad-definition" };
    const { write, stampNow } = await import("./store.mjs");
    const id = worldDefKey(sourceUuid);
    const stamp = stampNow();
    await write({ replace: { [`afflictionDefs.${id}`]: { id, v: 1, source: sourceUuid, def: { ...def, confidence: "full", origin: "world" }, ...stamp } } });
    parsed.delete(`${sourceUuid}@${game.system?.version ?? ""}`);
    return { ok: true, id };
}

/** For tests only. */
export function resetDefinitions() {
    parsed.clear();
}

/* -------------------------------------------- */
/*  The backend (8.10.1)                         */
/* -------------------------------------------- */

/** `native` once pf2e makes the affliction type available in this build, `effect` until then (OQ-47). */
export function backend() {
    return chooseBackend({ dataModels: CONFIG.Item?.dataModels ?? {}, documentTypes: game.system?.documentTypes?.Item ?? [] });
}

/* -------------------------------------------- */
/*  DCs (8.10.4)                                 */
/* -------------------------------------------- */

/** A creature's class DC (the alchemist's, else the first), or null. */
export function classDcOf(actor) {
    const dc = actor?.classDCs?.alchemist?.dc?.value ?? actor?.classDCs?.alchemist?.value ?? actor?.classDC?.dc?.value ?? actor?.classDC?.value ??
        actor?.system?.attributes?.classDC?.value ?? null;
    return Number.isInteger(dc) ? dc : null;
}

/** Whether an item has a trait. */
const traitOf = (item, trait) => [...(item?.system?.traits?.value ?? [])].includes(trait);

/**
 * The DC stamp an item gets from its creator at creation (8.10.4, 7.1 step 4): Powerful Alchemy for an infused item that
 * allows a save, the higher of the printed DC and the creator's class DC, written only when the class DC is higher; the legacy
 * Potent Poisoner for a poison crafted by any means (badged). Null when nothing is written. `item` is the item's data (a
 * document or its source).
 */
export function dcStampFor(creator, item) {
    if (!creator || !item) return null;
    const held = heldKeysOf(creator);
    // The item's own save DC (its Saving Throw paragraph's check), never another check's (an addiction's, a stage's basic save).
    const own = ownSaveDc(item.system?.description?.value ?? "");
    const printed = Number.isInteger(own) ? [own] : [];
    const classDc = classDcOf(creator);
    const at = game.time?.worldTime ?? 0;
    if (held.includes("powerful-alchemy")) {
        const value = powerfulAlchemyDc({ printed, classDc, infused: traitOf(item, "infused") });
        if (value) return { value, rule: "powerful-alchemy", creator: creator.uuid, printed: own, at };
    }
    if (held.includes("potent-poisoner") && traitOf(item, "poison")) {
        const value = potentPoisonerDc({ printed, classDc });
        if (value) return { value, rule: "potent-poisoner", creator: creator.uuid, printed: own, at, legacy: true };
    }
    return null;
}

/** The DC a stamp on an item carries (8.10.4): this milestone's `value`, or a Talisman Dabbler stamp's `dc` (7.4). */
export function stampedDc(item) {
    const stamp = item?.flags?.[MODULE_ID]?.dcStamp;
    const value = stamp?.value ?? stamp?.dc ?? null;
    return Number.isInteger(value) ? value : null;
}

/**
 * The inline DC as pf2e resolves it for a holder (8.10.4 rung 4): the item's own save DC (the check of its Saving Throw
 * paragraph, `ownSaveDc`; not an addiction's or a stage's basic save), upgraded to the holder's class DC when the item is
 * infused and the holder has Powerful Alchemy (pf2e's `AdjustModifier` upgrade on `inline-dc` reads the holder's own
 * modifiers, verified).
 */
export function inlineDcFor(item, holder) {
    const printed = ownSaveDc(item?.system?.description?.value ?? "");
    if (!Number.isInteger(printed)) return null;
    if (holder && traitOf(item, "infused") && heldKeysOf(holder).includes("powerful-alchemy")) {
        const classDc = classDcOf(holder);
        if (Number.isInteger(classDc) && classDc > printed) return classDc;
    }
    return printed;
}

/**
 * The DC an exposure freezes (8.10.4), the first that applies: a world definition's or override's DC, a DC typed on a manual
 * Expose, the item's DC stamp, the inline DC for its holder, the parsed printed DC. `{value, source, creator?}` or null.
 */
export function exposureDc({ def, item = null, holder = null, manual = null }) {
    const fixed = def?.origin === "world" ? def?.save?.value ?? null : def?.dcFixed ?? null;
    const chosen = chooseDc({
        fixed,
        manual: Number.isInteger(manual) ? manual : null,
        stamp: stampedDc(item),
        inline: item ? inlineDcFor(item, holder ?? item.actor ?? null) : null,
        printed: def?.save?.value ?? null,
    });
    if (!chosen) return null;
    const creator = item?.flags?.[MODULE_ID]?.dcStamp?.creator ?? item?.flags?.[MODULE_ID]?.expiry?.creator ?? null;
    return { ...chosen, ...(creator ? { creator } : {}) };
}
