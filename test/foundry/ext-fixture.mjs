/**
 * A test extension (DESIGN.md 12, M10): a module of its own, `workshop-test-ext`, that registers one object of each interface
 * the way a real extension does, from the `pf2e-artisans-workshop.register` hook, and keeps its state only in its own store.
 * `test/foundry/extensions.test.mjs` runs the Workshop against it; nothing in it is circus-specific, and nothing in the
 * Workshop refers to it.
 *
 * - `workshop-test-ext.study`: a downtime activity of 2 consecutive days with a Society check against the party's
 *   level-based DC and an Aid (2 days, Society DC 20, +2); its result is a keyed store record per run and, on a success,
 *   1 gp of income into the party fund.
 * - `workshop-test-ext.rest`: a 1-day activity with no check, eligible only for a character whose name is not "Bo".
 * - `workshop-test-ext.show`: an income source per event into the party fund; `.stipend` per day into the PC's purse;
 *   `.share` per event split among the members.
 * - `workshop-test-ext.alchemical-trick`: a sink for alchemical consumables, +1 circumstance.
 * - `workshop-test-ext.costume`: +1 circumstance to Society and Performance checks.
 */
export const EXT_ID = "workshop-test-ext";

/** The registrations, so a test can call them with the registry the hook hands it. */
export function registerTestExtension(registry, { requiresApi = 1 } = {}) {
    const ext = registry.extension(EXT_ID, { requiresApi });
    if (!ext) return null;
    const results = {
        study: ext.downtimeActivity({
            id: `${EXT_ID}.study`, label: "TEST.Study", icon: "fa-solid fa-book", days: 2, consecutive: true,
            check: { statistic: "society", dc: "partyLevel", traits: ["circus"], rollOptions: ["test:study"] },
            aid: { days: 2, statistic: "society", dc: 20, bonus: 2 },
            compendiumUuid: "Compendium.pf2e.adventure-specific-actions.Item.lD2RA75awEu4cG7e",
            resolve: (ctx) => {
                const gain = [0, 1, ctx.actor.level, 2 * ctx.actor.level][ctx.degree];
                return {
                    ext: { [`gains.${ctx.run.id}`]: { actor: ctx.actorId, day: ctx.day, gain, aided: ctx.aids.length } },
                    ledger: ctx.degree >= 2 ? [{ kind: "income", cp: 100, via: "box" }] : [],
                    notes: ["TEST.Studied"],
                };
            },
        }),
        rest: ext.downtimeActivity({
            id: `${EXT_ID}.rest`, label: "TEST.Rest", days: 1,
            eligible: (actor) => (actor.name === "Bo" ? { ok: false, reason: "TEST.NotBo" } : { ok: true }),
            resolve: (ctx) => ({ ext: { [`rested.${ctx.actorId}`]: ctx.day } }),
        }),
        show: ext.incomeSource({ id: `${EXT_ID}.show`, label: "TEST.Show", cadence: "perEvent", distribute: "strongbox",
            compute: (ctx) => ({ cp: ctx.data.cp, breakdown: [{ label: "TEST.Base", cp: ctx.data.cp }] }) }),
        stipend: ext.incomeSource({ id: `${EXT_ID}.stipend`, label: "TEST.Stipend", cadence: "perDay", distribute: "actor",
            compute: (ctx) => ({ cp: ctx.record?.activity?.kind === "ext" ? 10 : 0, breakdown: [] }) }),
        share: ext.incomeSource({ id: `${EXT_ID}.share`, label: "TEST.Share", cadence: "perEvent", distribute: "split",
            compute: (ctx) => ({ cp: ctx.data.cp, breakdown: [] }) }),
        sink: ext.consumableSink({ id: `${EXT_ID}.alchemical-trick`, label: "TEST.Trick",
            accepts: (item) => [...(item.system?.traits?.value ?? [])].includes("alchemical"),
            spend: (ctx) => ({ modifiers: [{ slug: "alchemical-trick", label: "TEST.Trick", modifier: 1, type: "circumstance" }, { slug: "Bad Slug", modifier: 9 }],
                notes: [`spent ${ctx.item.name}`] }) }),
        costume: ext.checkModifierSource({ id: `${EXT_ID}.costume`, selectors: ["society", "performance"],
            modifiers: (ctx) => (ctx.kind === "aid" ? [] : [{ slug: "costume", label: "TEST.Costume", modifier: 1, type: "circumstance" }]) }),
    };
    return results;
}
