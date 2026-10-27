/** Talismans at daily preparation (DESIGN.md 7.4): the Dabbler DC stamp, affix time and the affix board. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { affixBoard, affixMinutes, dabblerDc, stampInlineChecks } from "../../scripts/logic/talismans.mjs";

test("Talisman Dabbler's DC is the highest of the class DC and the spell DC; none when there is neither (7.4)", () => {
    assert.equal(dabblerDc({ classDc: 27, spellDc: 25 }), 27);
    assert.equal(dabblerDc({ classDc: null, spellDc: 29 }), 29);
    assert.equal(dabblerDc({}), null);
    assert.equal(dabblerDc({ classDc: 0 }), null);
});

test("the DC stamp raises inline check DCs below the creator's and leaves higher and resolved ones alone (7.4, 8.10.4)", () => {
    const text = "<p>@Check[fortitude|dc:20] and @Check[type:reflex|dc:31|basic] and @Check[will|dc:resolve(@actor.level)]</p>";
    const out = stampInlineChecks(text, 27);
    assert.equal(out.changed, 1);
    assert.deepEqual(out.printed, [20, 31]);
    assert.equal(out.text, "<p>@Check[fortitude|dc:27] and @Check[type:reflex|dc:31|basic] and @Check[will|dc:resolve(@actor.level)]</p>");
    assert.deepEqual(stampInlineChecks(text, 19).changed, 0, "a creator DC below every printed one writes nothing");
    assert.deepEqual(stampInlineChecks(text, null).changed, 0);
    assert.deepEqual(stampInlineChecks("", 30), { text: "", changed: 0, printed: [] });
    assert.equal(stampInlineChecks("@Check[fortitude| dc: 18 ]", 22).text, "@Check[fortitude| dc: 22 ]", "spacing kept");
});

test("the DC stamp raises saving throw DCs only: a flat check or a skill check keeps its DC (second review fix, Player Core 2)", () => {
    // Mummified Bat (GM Core, level 10: a 20th-level Dabbler makes it): a flat DC 5 a stamp of 41 would make impossible.
    const bat = "<p>you need only a successful @Check[flat|dc:5] to target a concealed creature</p>";
    assert.deepEqual(stampInlineChecks(bat, 41), { text: bat, changed: 0, printed: [] });
    assert.equal(stampInlineChecks("@Check[flat|showDC:all|dc:10]", 41).changed, 0, "Horned Lion Amulet's flat check");
    assert.equal(stampInlineChecks("@Check[athletics|dc:20]", 30).changed, 0, "a skill check");
    assert.equal(stampInlineChecks("@Check[type:will|dc:20]", 30).text, "@Check[type:will|dc:30]", "a save named by type:");
    assert.equal(stampInlineChecks("@Check[reflex,fortitude|dc:20]", 30).changed, 1, "a choice of saves");
    assert.equal(stampInlineChecks("@Check[dc:20]", 30).changed, 0, "no type, no stamp");
});

test("affixing takes 10 minutes each; 1 with Rapid Affixture; four per 10 minutes for a Dabbler, four per minute with Quick Fix (7.4)", () => {
    assert.equal(affixMinutes(3), 30);
    assert.equal(affixMinutes(3, { rapidAffixture: true }), 3);
    assert.equal(affixMinutes(5, { dabbler: true }), 20);
    assert.equal(affixMinutes(5, { dabbler: true, quickFix: true }), 2);
    assert.equal(affixMinutes(1, { dabbler: true, quickFix: true }), 1);
    assert.equal(affixMinutes(0, { quickFix: true }), 0);
});

test("the affix board: one talisman works; two suppress each other unless the host is the Talismanic Sage's treated item (7.4)", () => {
    const hosts = [
        { id: "armor", name: "Armor", usable: true },
        { id: "sword", name: "Sword", usable: false },
        { id: "shield", name: "Shield", usable: true },
    ];
    const talismans = [
        { id: "t1", name: "A", host: "armor" }, { id: "t2", name: "B", host: "armor" },
        { id: "t3", name: "C", host: "sword" }, { id: "t4", name: "D", host: null }, { id: "t5", name: "E", host: "gone" },
    ];
    const plain = affixBoard({ talismans, hosts });
    assert.deepEqual(plain.hosts.map((h) => [h.id, h.state, h.count]), [["armor", "suppressed", 2], ["sword", "active", 1], ["shield", "empty", 0]]);
    assert.equal(plain.suppressed, 1);
    assert.equal(plain.hosts[1].warn, true, "a talisman on a host neither worn nor wielded cannot be activated");
    assert.deepEqual(plain.loose.map((t) => [t.id, t.orphan]), [["t4", false], ["t5", true]], "affixed to an item that is gone counts as loose");
    const sage = affixBoard({ talismans, hosts, sageHost: "armor", talismanicSage: true });
    assert.equal(sage.hosts[0].state, "active", "two on the treated item work");
    assert.equal(sage.hosts[0].sage, true);
    const third = affixBoard({ talismans: [...talismans, { id: "t6", name: "F", host: "armor" }], hosts, sageHost: "armor", talismanicSage: true });
    assert.equal(third.hosts[0].state, "suppressed", "three are too many even there");
    const wrongHost = affixBoard({ talismans, hosts, sageHost: "shield", talismanicSage: true });
    assert.equal(wrongHost.hosts[0].state, "suppressed", "only the treated item takes two");
});
