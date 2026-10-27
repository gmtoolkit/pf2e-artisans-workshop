/**
 * Affliction overrides and the affliction ignore list (DESIGN.md 8.10.2, M8a). The tracker parses a compendium item's
 * stages from its description at runtime (`scripts/logic/affliction-parse.mjs`); an item whose text does not parse fully, or
 * whose intro changes the general rules, has an entry here, keyed by its pf2e slug with its compendium UUID beside it (as
 * the registry, 6.11). Numbers, slugs and UUIDs only (P9): no rules text.
 *
 * An override is merged onto the parse (`scripts/logic/affliction.mjs` `applyOverride`):
 * - `save {type, value, against?}`, `onset`, `duration` (the maximum duration) replace the parsed ones;
 * - `stages {<n>: {duration?, damage?, conditions?, effects?}}` replace those parts of stage n (a stage interval an item
 *   leaves out is an interpretation: one round where the maximum duration is in rounds);
 * - `prose [n...]`: stages whose remaining text is for the table to apply (an item bonus, a choice, death): reviewed, the
 *   mapped parts run, the stage's own paragraph is shown from the source item;
 * - `traits [...]`: kinds the item's traits leave out (a talisman or weapon that delivers a poison);
 * - `reExposure`: the item's own rule for another exposure: `none` (no new save, Lethargy Poison and Stupor Poison),
 *   `reset-max` (the maximum duration starts again; the poison rule applies too), `table` (no save is rolled, the card
 *   says the item's own text decides);
 * - `keepsCoating`: the item stays potent across victims (Forgetful Ink), so a coating of it is not spent;
 * - rules an intro sets for a stage condition (the corpus check flags an intro that names one with "cumulative", "can't be
 *   removed", "lasts for" or "ends when"): `cumulative [slug...]` (the value adds up with each failed save and never goes
 *   down while the affliction lasts), `detach [slug...]` (the condition outlasts its stage and the affliction; its own
 *   duration is the table's), `intro: "table"` (reviewed: the intro's rule is the table's to apply).
 *
 * The parser applies none of a stage's parts when its text qualifies them (a choice between them, a condition on them, a
 * duration of their own); such a stage is the table's, and an override may name the parts that do apply.
 *
 * `tools/validate-registry.mjs` runs the parser over every candidate in a pf2e checkout and fails on one that neither parses
 * fully, nor has an override, nor is on the ignore list; an intro that mentions further, additional or multiple exposure
 * needs an entry too.
 */

/** Freeze a JSON-compatible value all the way down. */
function deepFreeze(value) {
    if (value && typeof value === "object") {
        for (const inner of Object.values(value)) deepFreeze(inner);
        Object.freeze(value);
    }
    return value;
}

/** The pf2e release the overrides were checked against. */
export const AFFLICTIONS_VERIFIED = "pf2e-8.6.1";

const ROUND = Object.freeze({ value: 1, unit: "rounds" });
const DAY = Object.freeze({ value: 1, unit: "days" });

export const AFFLICTION_OVERRIDES = deepFreeze({
    "alcohol": { uuid: "Compendium.pf2e.equipment-srd.Item.UMAXLDpI6YLSfYX1", prose: [1, 2, 7] },
    "alghollthu-lash": { uuid: "Compendium.pf2e.equipment-srd.Item.QyzNxesxaSdPo3Pd", prose: [2, 3] },
    "antipode-oil": { uuid: "Compendium.pf2e.equipment-srd.Item.7iZCCqXDGiTv0ar3", prose: [1, 2] },
    "blaze": { uuid: "Compendium.pf2e.equipment-srd.Item.q5Hr2nZr8RQ9DSZM", prose: [1, 2] },
    "blightburn-bomb": { uuid: "Compendium.pf2e.equipment-srd.Item.kIExO59KkiXZUmto", prose: [5] },
    "blightburn-bomb-greater": { uuid: "Compendium.pf2e.equipment-srd.Item.ZrXw7hAH8dQOGAYL", prose: [5] },
    "blisterwort": { uuid: "Compendium.pf2e.equipment-srd.Item.F0x5a1MI3k9Du9j3", prose: [1, 2, 3],
        stages: { 1: { duration: ROUND }, 2: { duration: ROUND }, 3: { duration: ROUND } } },
    "bloodeye-coffee": { uuid: "Compendium.pf2e.equipment-srd.Item.2DoUHoueAyyP4lMN", prose: [1, 3] },
    "blood-sap": { uuid: "Compendium.pf2e.equipment-srd.Item.PNwgGnN081l0cETR", prose: [1] },
    "bogeyman-breath": { uuid: "Compendium.pf2e.equipment-srd.Item.nn9X4cswWWo2QTwL", prose: [1, 2, 3] },
    "bower-fruit": { uuid: "Compendium.pf2e.equipment-srd.Item.9nrB5W2evrc2U3op", traits: ["curse"], prose: [1, 2, 3, 4] },
    "breathtaking-vapor": { uuid: "Compendium.pf2e.equipment-srd.Item.H20eUVst7rgwhUb6", prose: [1, 2, 3],
        stages: { 1: { duration: ROUND }, 2: { duration: ROUND }, 3: { duration: ROUND } } },
    "brightshade": { uuid: "Compendium.pf2e.equipment-srd.Item.NAkbCs6NqqPWnp5H", prose: [1, 2] },
    "careless-delight": { uuid: "Compendium.pf2e.equipment-srd.Item.QbuAXdWjwXlSk1pa", prose: [3] },
    "clown-monarch": { uuid: "Compendium.pf2e.equipment-srd.Item.Tccy21bO1sDb6hQM", prose: [1, 2, 3] },
    "clubhead-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.Tqtcy25OCiNlWqF6", prose: [1, 2, 3] },
    "creeping-death": { uuid: "Compendium.pf2e.equipment-srd.Item.lExsX8c5VUxiu05y", prose: [4] },
    // Stage 3's paralysis comes only from a failed save at stage 3, which ends the poison: the table's (prose).
    "curare": { uuid: "Compendium.pf2e.equipment-srd.Item.VvN9EjaBLwYg13z3", duration: { value: 6, unit: "rounds" }, prose: [3],
        stages: { 3: { duration: ROUND, damage: [{ formula: "4d6", damageType: "poison", category: null }],
            conditions: [{ slug: "clumsy", value: 2, linked: true }, { slug: "enfeebled", value: 2, linked: true }, { slug: "slowed", value: 1, linked: true }] } } },
    "cytillesh": { uuid: "Compendium.pf2e.equipment-srd.Item.rjUJEY424jyG9dGn", prose: [2] },
    "dancing-lamentation": { uuid: "Compendium.pf2e.equipment-srd.Item.WMdHOfjjBtJAEvqU", prose: [1, 2, 3] },
    "darkening-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.zXcCVIzDCq3P1pqT", traits: ["poison"], prose: [2, 3] },
    "demon-dust": { uuid: "Compendium.pf2e.equipment-srd.Item.ZROIWl7TLxKbPDLr", prose: [1, 2, 5, 6] },
    "diluted-hype": { uuid: "Compendium.pf2e.equipment-srd.Item.1CAPGpQczfq5exrs", prose: [1] },
    "dreamtime-tea": { uuid: "Compendium.pf2e.equipment-srd.Item.dwaF9zHPK9823COa", prose: [2] },
    "elven-absinthe": { uuid: "Compendium.pf2e.equipment-srd.Item.26bM70yn28MjDT9A", prose: [1] },
    "false-hope": { uuid: "Compendium.pf2e.equipment-srd.Item.bASMkq9syBtpaXok", stages: { 3: { duration: ROUND } } },
    "flayleaf": { uuid: "Compendium.pf2e.equipment-srd.Item.PTwm2NAcReBw2iUY", prose: [1, 2] },
    "forgetful-ink": { uuid: "Compendium.pf2e.equipment-srd.Item.iCRoLguNunOjIM7L", prose: [1], keepsCoating: true },
    "fraudslayer-oil": { uuid: "Compendium.pf2e.equipment-srd.Item.vAEQsYQbOYmqfIc0", prose: [1, 2, 3] },
    "frenzy-oil": { uuid: "Compendium.pf2e.equipment-srd.Item.7p3C9xf3XgUbvKHL", prose: [1, 2, 3] },
    "gorgons-breath": { uuid: "Compendium.pf2e.equipment-srd.Item.QImdOdyolrMWwuxD", prose: [4] },
    "greater-enhance-venom": { uuid: "Compendium.pf2e.feats-srd.Item.VPKBjEy8frqDMxyO", traits: ["poison"] },
    "grit": { uuid: "Compendium.pf2e.equipment-srd.Item.vl5dww56cbXo9QnP", prose: [1, 2, 3, 6] },
    "grolna": { uuid: "Compendium.pf2e.equipment-srd.Item.I2ZbXsfm0c9Eep4I", prose: [1], reExposure: "table" },
    "hero-killer": { uuid: "Compendium.pf2e.equipment-srd.Item.tdwPBrchFga79M9Q", prose: [1, 3] },
    "honeyscent": { uuid: "Compendium.pf2e.equipment-srd.Item.7TT0XIb8ovLFOP2e", stages: { 3: { duration: ROUND } } },
    "horn-of-rust": { uuid: "Compendium.pf2e.equipment-srd.Item.4eC5wMw1vcDDgC4x", prose: [2, 3, 4] },
    "hyldarfs-fang": { uuid: "Compendium.pf2e.equipment-srd.Item.O7pgJB6M5UqUZ9Qq", traits: ["poison"], save: { type: "fortitude", value: 34 },
        stages: { 1: { duration: ROUND }, 2: { duration: ROUND } } },
    "hype": { uuid: "Compendium.pf2e.equipment-srd.Item.z3IG6t2o0zsfP2XQ", traits: ["poison"], prose: [1] },
    "isolation-draught": { uuid: "Compendium.pf2e.equipment-srd.Item.VwzIiWAtbJCgGOEz", prose: [1, 2, 3] },
    "knockout-dram": { uuid: "Compendium.pf2e.equipment-srd.Item.0XSl2DU7JvKXOqTo", prose: [1, 2] },
    "leadenleg": { uuid: "Compendium.pf2e.equipment-srd.Item.QJ1fTrX42PoEWpK5", prose: [1, 2, 3] },
    "lethargy-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.zo0ophqfKunJFxZN", prose: [3, 4], reExposure: "none" },
    "liars-demise": { uuid: "Compendium.pf2e.equipment-srd.Item.ChIhgRwtnhTukICY", prose: [1, 2, 3] },
    "lionfish-spear": { uuid: "Compendium.pf2e.equipment-srd.Item.ZbZMaY8B8dinYhHK", traits: ["poison"], prose: [3] },
    "lionfish-spear-greater": { uuid: "Compendium.pf2e.equipment-srd.Item.R4nk2W7rTvMDqyUR", traits: ["poison"], prose: [3] },
    "looters-lethargy": { uuid: "Compendium.pf2e.equipment-srd.Item.p3RduziOxQxtREg9", prose: [1, 2, 3] },
    "midnight-milk-experimental": { uuid: "Compendium.pf2e.equipment-srd.Item.thqCdyIkkPUl2N3Y", prose: [1] },
    "midnight-milk-pure": { uuid: "Compendium.pf2e.equipment-srd.Item.L5cDsqIYsDsW7BKA", prose: [1] },
    "midnight-milk-refined": { uuid: "Compendium.pf2e.equipment-srd.Item.EX8Ta6J56SNrYbqJ", prose: [1] },
    "moderate-enhance-venom": { uuid: "Compendium.pf2e.feats-srd.Item.0BUSnsCKOeFCJKEp", traits: ["poison"] },
    "mustard-powder": { uuid: "Compendium.pf2e.equipment-srd.Item.lzjx7KiuoaQuh025", prose: [2, 3] },
    "mythotoxin": { uuid: "Compendium.pf2e.equipment-srd.Item.i5DbxSLYu0LE52CV", prose: [3] },
    "nightmare-salt": { uuid: "Compendium.pf2e.equipment-srd.Item.dRi775Uhzqgn7aBs", prose: [1, 2, 3, 4] },
    "plasma-hype": { uuid: "Compendium.pf2e.equipment-srd.Item.bRqczrlQDaeUvg6b", traits: ["poison"], prose: [1, 2] },
    "poison-sedum": { uuid: "Compendium.pf2e.equipment-srd.Item.GWTSMcXocmUsNLmN", prose: [1, 2] },
    "primal-pollen": { uuid: "Compendium.pf2e.equipment-srd.Item.xKVtAqqVUPWjKFBJ", stages: { 4: { duration: ROUND } } },
    "protectors-final-gift": { uuid: "Compendium.pf2e.equipment-srd.Item.D9vU4fADTYSaZpM9", stages: { 1: { duration: ROUND } } },
    "pummel-growth-toxin": { uuid: "Compendium.pf2e.equipment-srd.Item.m1XubXwbBy3JzMkY", prose: [1] },
    "puppetmaster-extract": { uuid: "Compendium.pf2e.equipment-srd.Item.3Byr7YKaNlZl474Y", prose: [3, 4] },
    "qat": { uuid: "Compendium.pf2e.equipment-srd.Item.JPGOrHeYxjdnUogT", prose: [1] },
    // Stages 1 and 2's doomed lasts 1 round of its own: the table's (prose); their damage applies.
    "reapers-shadow": { uuid: "Compendium.pf2e.equipment-srd.Item.ehd8FIXgo4S24TKV", prose: [1, 2],
        stages: { 1: { damage: [{ formula: "2d12", damageType: "void", category: null }] }, 2: { damage: [{ formula: "3d12", damageType: "void", category: null }] } } },
    "refined-pesh": { uuid: "Compendium.pf2e.equipment-srd.Item.Vy3z2cIQ8uJRUMYw", prose: [1, 2] },
    "scarlet-mist": { uuid: "Compendium.pf2e.equipment-srd.Item.mQSV1gq64kKeAfuN", prose: [1, 2, 3] },
    "scour": { uuid: "Compendium.pf2e.equipment-srd.Item.8BDBsf55gP0UW07Y", prose: [1] },
    "serpent-dagger": { uuid: "Compendium.pf2e.equipment-srd.Item.ZvIEJCY60fHqzl6r", stages: { 1: { duration: ROUND } } },
    "shard-of-self-destruction": { uuid: "Compendium.pf2e.equipment-srd.Item.bL0FbIMucp28oocF", traits: ["curse"], prose: [2, 3, 4, 5] },
    "shiver": { uuid: "Compendium.pf2e.equipment-srd.Item.UfoaNXFA7AWZiXxI", prose: [1, 3] },
    "sightless-tincture": { uuid: "Compendium.pf2e.equipment-srd.Item.xvJ2jzqipBNrwZ2w", prose: [1, 2, 3] },
    "sloughing-toxin": { uuid: "Compendium.pf2e.equipment-srd.Item.JvpiniS6wTHsDoFX", prose: [1, 2, 3] },
    "smother-shroud": { uuid: "Compendium.pf2e.equipment-srd.Item.pF4ggWXiiNksDKsU", prose: [2, 3] },
    "spider-mold": { uuid: "Compendium.pf2e.equipment-srd.Item.gza0CcZEYhPKIYEk", prose: [4] },
    "sportlebore-capsule": { uuid: "Compendium.pf2e.equipment-srd.Item.Ary0uHNPkoFHX40N", prose: [3] },
    "stupor-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.nn2HAN1XKkKHfVnM", prose: [3, 4], reExposure: "none" },
    "succubus-kiss": { uuid: "Compendium.pf2e.equipment-srd.Item.qwCefJjr7AJSqYay", prose: [1, 2, 3, 4, 5] },
    "tangle-root-toxin": { uuid: "Compendium.pf2e.equipment-srd.Item.76T49dJYfxIrPvQe", prose: [1, 2, 3] },
    "terror-spores": { uuid: "Compendium.pf2e.equipment-srd.Item.4AqxogIf4G5qZsq3", prose: [3] },
    "toilers-gruel": { uuid: "Compendium.pf2e.equipment-srd.Item.agT3mN20ZHaR3eBS", prose: [2, 3], reExposure: "reset-max" },
    "violet-venom": { uuid: "Compendium.pf2e.equipment-srd.Item.Oip645RjC5y57wFa", prose: [1, 2, 3] },
    "vipers-fang": { uuid: "Compendium.pf2e.equipment-srd.Item.sjxhPujyv6rJJRWO", traits: ["poison"], stages: { 1: { duration: ROUND } } },
    "wand-of-pernicious-poison-6th-rank": { uuid: "Compendium.pf2e.equipment-srd.Item.QC4TXwjteVhwRSNO",
        save: { type: "fortitude", value: null, against: "spell" } },
    "warpwobble-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.xcwPOFTAjQpmiFsN", prose: [1, 2, 3] },
    "yellow-musk-poison": { uuid: "Compendium.pf2e.equipment-srd.Item.bJVk50mhaODgsOUe", prose: [1, 2] },
    "zerk": { uuid: "Compendium.pf2e.equipment-srd.Item.eKpL2j1JA92wndO6", prose: [1] },
    // Intros that change how a stage condition works (reviewed against pf2e-8.6.1).
    "kings-sleep": { uuid: "Compendium.pf2e.equipment-srd.Item.RkI3jKKrCozvEvfr", cumulative: ["drained"] },
    "nethershade": { uuid: "Compendium.pf2e.equipment-srd.Item.Wjkw0lEUOhypYvzo", detach: ["enfeebled"] },
    "arsenic": { uuid: "Compendium.pf2e.equipment-srd.Item.OIirLySQDLZgT15S", intro: "table" },
    "daylight-vapor": { uuid: "Compendium.pf2e.equipment-srd.Item.6vyr3drpizIrd5PS", intro: "table" },
    "fearweed": { uuid: "Compendium.pf2e.equipment-srd.Item.RH1fNsslZ1wdeqy2", intro: "table" },
    "slumber-wine": { uuid: "Compendium.pf2e.equipment-srd.Item.z7eOUqVwyht6tj11", intro: "table" },
    "sweet-hags-eye": { uuid: "Compendium.pf2e.equipment-srd.Item.HNzFnmRfpt2oz5qQ", intro: "table" },
    "tasters-folly": { uuid: "Compendium.pf2e.equipment-srd.Item.pvsJXFfbwGWhoG5N", intro: "table" },
    // Spells (their save is the spell's defense, against the caster's spell DC) and creature abilities (their DC is the
    // creature's): started with Expose (8.10.3, 1.2).
    "abyssal-plague": { uuid: "Compendium.pf2e.spells-srd.Item.vJuaxTd6q11OjGqA", prose: [2] },
    "advanced-scurvy": { uuid: "Compendium.pf2e.spells-srd.Item.XEhzFKNTSARsofav", prose: [1, 2, 3] },
    "blightburn-blast": { uuid: "Compendium.pf2e.spells-srd.Item.EgkypvUZIZkx1UlQ", prose: [5] },
    "blinding-bottle": { uuid: "Compendium.pf2e.spells-srd.Item.3ygqSJYWZM1UV76Z", prose: [1, 2, 3, 4] },
    "blister-bomb": { uuid: "Compendium.pf2e.spells-srd.Item.3qx1axryNbl97ker", intro: "table" },
    "blood-chestnuts": { uuid: "Compendium.pf2e.spells-srd.Item.HTzrWoYokIEqxD9t", prose: [3] },
    "bone-moths-kiss": { uuid: "Compendium.pf2e.spells-srd.Item.MavAJJo6jhQfdBXW", prose: [3] },
    "curse-of-death": { uuid: "Compendium.pf2e.spells-srd.Item.nQS4vPm5zprqkzFZ", prose: [1, 2, 3, 4] },
    "divine-plagues": { uuid: "Compendium.pf2e.spells-srd.Item.NkeLctXo9FLGnDhi", prose: [1, 2, 3] },
    "dread-mosquito-storm": { uuid: "Compendium.pf2e.spells-srd.Item.Q6cvsLytYffpeN3g", prose: [1, 2, 3], stages: { 2: { duration: ROUND } } },
    "gift-of-dusk": { uuid: "Compendium.pf2e.spells-srd.Item.E9BlwQavx05qwSpi", prose: [3] },
    "goblin-pox": { uuid: "Compendium.pf2e.spells-srd.Item.zJQnkKEKbJqGB3iB", prose: [3] },
    "imp-sting": { uuid: "Compendium.pf2e.spells-srd.Item.oryfsRK27jAUnziw", stages: { 1: { duration: ROUND } } },
    "internal-insurrection": { uuid: "Compendium.pf2e.spells-srd.Item.RbORUmnwlB8b3mNf", prose: [5] },
    "mosquito-blight": { uuid: "Compendium.pf2e.spells-srd.Item.dNpIc5k1aCI3bHIg", prose: [5], stages: { 4: { duration: DAY } } },
    "mycological-malady": { uuid: "Compendium.pf2e.spells-srd.Item.V4jrHiaMh4XuANOP", intro: "table" },
    "perfection-of-essence": { uuid: "Compendium.pf2e.spells-srd.Item.kExRMPVI07iIFCaa", prose: [1, 2, 4] },
    "plague-shot": { uuid: "Compendium.pf2e.spells-srd.Item.NjN6md0KpdelWpu7", prose: [4, 5] },
    "terminate-bloodline": { uuid: "Compendium.pf2e.spells-srd.Item.yUM5OYeMY8971b2S", save: { type: "fortitude", value: null, against: "spell" }, prose: [5] },
    "blackfrost-dead-blackfrost": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.kLQ0eq18SvKEvggc", prose: [2, 3] },
    "ghast-ghast-fever": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.hA6HsM4i4yPfEsDH", prose: [2, 4, 6] },
    "ghoul-ghoul-fever": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.N7UV5CZXtcoxDxCF", prose: [2, 4, 6] },
    "ghoul-ghoul-whispers": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.pOW2IvfVusdmD5v5", prose: [2, 4, 5] },
    "graveknight-graveknights-curse": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.5dbzWZbiTyPKgwKS", prose: [1, 2, 3] },
    "sporeborn-sporeborn-infestation": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.EosAqVmnYlxMEGdT", prose: [5] },
    "vampire-nosferatu-plague-of-ancients": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.NgiwaeUqMPfkYvQq", prose: [6] },
    "vampire-vrykolakas-master-bubonic-plague": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.haMVGGDY3mLuKy9s", prose: [3] },
    "zombie-plague-ridden": { uuid: "Compendium.pf2e.bestiary-family-ability-glossary.Item.MhymIeTQoxbacG1o", prose: [5] },
});

/** Why a candidate is not tracked, by code. */
export const AFFLICTION_IGNORE_REASONS = deepFreeze({
    "not-affliction": "onset wording that is not an affliction (a potion that takes effect after a delay)",
    "boon-stages": "a magical item whose stages are a progression with no saving throw, not an affliction",
});

/** Candidates the tracker leaves alone, each with its reason code. */
export const AFFLICTION_IGNORE = deepFreeze({
    "Compendium.pf2e.equipment-srd.Item.FqbDpztscJfM4XMe": "not-affliction",   // Shrinking Potion
    "Compendium.pf2e.equipment-srd.Item.uf05VGoYSaeKtUG1": "boon-stages",   // Elder Seed
    "Compendium.pf2e.equipment-srd.Item.ZJE92c4sE6cu8l8l": "boon-stages",   // Heartblood Ring
    "Compendium.pf2e.equipment-srd.Item.po3Lhiccc0RQYikr": "boon-stages",   // Phoenix Cinder
    "Compendium.pf2e.equipment-srd.Item.u1ouo0mH0sS6QoGw": "boon-stages",   // Void Fragment
});
