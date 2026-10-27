/** Expiry stamps and party-wide expiry (DESIGN.md 4.12, 7.1, 7.7): pure parts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RANK } from "../../scripts/logic/core.mjs";
import {
    ADVANCED_ALCHEMY_SECONDS, actorIdOf, expiryReason, needsSplit, outputsOf, preservationCap, preservePlan, prepStamp, sameStamp, snapshotOf,
} from "../../scripts/logic/expiry.mjs";

const ALCH = "Actor.alchemist0000001";

test("a prep stamp names the creator and its cycle; Advanced Alchemy adds the 24-hour deadline and the next logged day (7.7)", () => {
    assert.deepEqual(prepStamp({ creator: ALCH, cycle: 3, pool: "cauldron" }), { creator: ALCH, cycle: 3, rule: "prep", pool: "cauldron" });
    const advanced = prepStamp({ creator: ALCH, cycle: 3, pool: "advanced-alchemy", worldTime: 1000, day: 7 });
    assert.equal(advanced.at, 1000 + ADVANCED_ALCHEMY_SECONDS);
    assert.equal(advanced.atDay, 8);
    assert.throws(() => prepStamp({ creator: ALCH, cycle: 3, pool: "advanced-alchemy" }), TypeError, "the time and day are required");
    assert.throws(() => prepStamp({ creator: "", cycle: 0 }), TypeError);
    assert.throws(() => prepStamp({ creator: ALCH, cycle: -1 }), RangeError);
});

test("a stamped item expires at the creator's next cycle, at 24 hours, or on the next logged day, whichever comes first (7.7)", () => {
    const stamp = prepStamp({ creator: ALCH, cycle: 2, pool: "advanced-alchemy", worldTime: 0, day: 5 });
    assert.equal(expiryReason(stamp, { creatorCycle: 2, worldTime: 3600, loggedDay: null }), null, "same cycle, an hour later: potent");
    assert.equal(expiryReason(stamp, { creatorCycle: 3, worldTime: 3600 }), "cycle", "the creator prepared again");
    assert.equal(expiryReason(stamp, { creatorCycle: 2, worldTime: ADVANCED_ALCHEMY_SECONDS }), "time", "24 hours without preparing");
    assert.equal(expiryReason(stamp, { creatorCycle: 2, worldTime: 10, loggedDay: 6 }), "day", "a day logged ahead of the clock");
    assert.equal(expiryReason(stamp, { creatorCycle: 2, worldTime: 10, loggedDay: 5 }), null, "the same logged day");
    const plain = prepStamp({ creator: ALCH, cycle: 2, pool: "talisman-dabbler" });
    assert.equal(expiryReason(plain, { creatorCycle: 2, worldTime: 10 * ADVANCED_ALCHEMY_SECONDS, loggedDay: 99 }), null,
        "a temporary talisman lasts until the next preparations, however long");
    assert.equal(expiryReason(plain, { creatorCycle: 3 }), "cycle");
    assert.equal(expiryReason({ ...plain, exempt: { key: "food-preservation" } }, { creatorCycle: 9 }), null, "an exception never expires here");
    assert.equal(expiryReason(plain, { creatorCycle: 9, inert: true }), null, "an inert item is not marked twice");
    assert.equal(expiryReason({ ...plain, rule: "turn-start" }, { creatorCycle: 9 }), null, "turn rules are M8's");
    assert.equal(expiryReason({ creator: ALCH, rule: "world", at: 50 }, { worldTime: 50 }), "time");
    assert.equal(expiryReason(null, { creatorCycle: 9 }), null);
    assert.equal(expiryReason(plain, { creatorCycle: null }), null, "a creator gone from the world leaves its items alone");
});

test("stamps compare by creator, cycle, rule, deadlines and exemption", () => {
    const a = prepStamp({ creator: ALCH, cycle: 1, pool: "advanced-alchemy", worldTime: 0, day: 0 });
    assert.equal(sameStamp(a, { ...a }), true);
    assert.equal(sameStamp(a, { ...a, cycle: 2 }), false);
    assert.equal(sameStamp(a, { ...a, creator: "Actor.other00000000001" }), false);
    assert.equal(sameStamp(a, null), false);
    assert.equal(sameStamp(null, undefined), true);
    assert.equal(sameStamp(a, { ...a, exempt: { key: "x" } }), false);
});

test("what a run made: new ids and quantity increases, merged ones marked with what the stack held (7.1)", () => {
    const before = snapshotOf([{ id: "a", quantity: 2 }, { id: "b", quantity: 1 }, { id: "c" }]);
    assert.deepEqual(before, { a: 2, b: 1, c: 1 });
    const outputs = outputsOf(before, [{ id: "a", quantity: 6 }, { id: "b", quantity: 1 }, { id: "c", quantity: 0 }, { id: "d", quantity: 4 }]);
    assert.deepEqual(outputs, [
        { id: "a", added: 4, merged: true, before: 2 },
        { id: "d", added: 4, merged: false, before: 0 },
    ]);
});

test("output merged into a stack with another stamp is split before stamping; one of the same stamp is not (7.1 step 3)", () => {
    const mine = prepStamp({ creator: ALCH, cycle: 4, pool: "advanced-alchemy", worldTime: 0, day: 0 });
    const theirs = prepStamp({ creator: "Actor.other00000000001", cycle: 9, pool: "advanced-alchemy", worldTime: 0, day: 0 });
    const merged = { id: "a", added: 2, merged: true, before: 3 };
    assert.equal(needsSplit(merged, theirs, mine), true, "another creator's delivery");
    assert.equal(needsSplit(merged, null, mine), true, "an unstamped stack is not stamped by mistake");
    assert.equal(needsSplit(merged, mine, mine), false);
    assert.equal(needsSplit({ id: "d", added: 2, merged: false, before: 0 }, null, mine), false, "a new item is stamped in place");
});

test("Food Preservation: 1, 2 from expert, 3 at master, 5 at legendary; the oldest spoil past the cap (7.7)", () => {
    assert.deepEqual([RANK.untrained, RANK.trained, RANK.expert, RANK.master, RANK.legendary].map(preservationCap), [1, 1, 2, 3, 5]);
    const preserved = [{ id: "old", at: 1 }, { id: "mid", at: 2 }];
    assert.deepEqual(preservePlan(preserved, ["new"], 2, 3), { ok: true, preserve: ["new"], spoil: ["old"] });
    assert.deepEqual(preservePlan(preserved, ["new"], 3, 3), { ok: true, preserve: ["new"], spoil: [] });
    assert.deepEqual(preservePlan(preserved, ["mid"], 2, 3), { ok: true, preserve: [], spoil: [] }, "preserving one already preserved changes nothing");
    assert.deepEqual(preservePlan([], ["a", "b", "c"], 2, 1), { ok: false, reason: "too-many", data: { cap: 2 } });
});

test("an actor's id in its UUID", () => {
    assert.equal(actorIdOf("Actor.abc"), "abc");
    assert.equal(actorIdOf("Scene.x.Token.y.Actor.z"), null, "a token's actor is not a world actor");
    assert.equal(actorIdOf(null), null);
});
