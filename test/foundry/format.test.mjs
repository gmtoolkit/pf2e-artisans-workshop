/**
 * The interface's number and date formatting makes its `Intl` formatter once per interface language (M12 performance pass,
 * DESIGN.md 15.7): the profile of a Workshop re-render over a seeded ledger put a new `Intl.NumberFormat` per amount among
 * its largest costs, on every client after every change to the ledger.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { installFoundry } from "./stubs.mjs";

installFoundry();
game.i18n.lang = "en";
game.i18n.localize = (key) => (key.startsWith("PF2E.CurrencyAbbreviations.") ? key.split(".").at(-1) : key);
game.i18n.format = (key, data) => (key === "pf2e-artisans-workshop.Money.Part" ? `${data.n} ${data.unit}` : key);

/** Count the formatters made from here on; `restore` puts the real constructors back. */
function countFormatters() {
    const made = { number: 0, date: 0 };
    const { NumberFormat, DateTimeFormat } = Intl;
    Intl.NumberFormat = function (...args) {
        made.number += 1;
        return new NumberFormat(...args);
    };
    Intl.DateTimeFormat = function (...args) {
        made.date += 1;
        return new DateTimeFormat(...args);
    };
    made.restore = () => Object.assign(Intl, { NumberFormat, DateTimeFormat });
    return made;
}

const made = countFormatters();
const format = await import("../../scripts/ui/format.mjs");

test("amounts and dates: one formatter per kind and language, however many are shown", () => {
    try {
        for (let i = 0; i < 200; i += 1) format.number(i * 1000);
        for (let i = 0; i < 100; i += 1) format.money(104530 + i);
        for (let i = 0; i < 50; i += 1) format.when({ real: Date.UTC(2026, 9, 27, 12, i) });
        assert.deepEqual([made.number, made.date], [1, 1]);
        assert.equal(format.number(1045), "1,045");
        assert.equal(format.money(104530), "1,045 gp 3 sp");
        game.i18n.lang = "de";
        assert.equal(format.number(1045), "1.045", "a new language formats in its own way");
        format.number(2000);
        assert.deepEqual([made.number, made.date], [2, 1]);
        game.i18n.lang = "en";
        assert.equal(format.number(1045), "1,045");
        assert.equal(made.number, 2, "back to a language seen before: its formatter again");
        assert.equal(format.when({}), "", "no stamp, no date");
    } finally {
        made.restore();
        game.i18n.lang = "en";
    }
});
