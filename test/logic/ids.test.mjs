/** Record ids, idempotency keys and id order (DESIGN.md 4.1, 4.6, 5.6). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ID_LENGTH, compareIds, hashId, idFromRandom, idemKey, isRecordId } from "../../scripts/logic/ids.mjs";

/** Foundry 14.368 `common/data/validators.mjs` `isValidId`: lock pages use row ids as document ids. */
const isValidFoundryId = (id) => /^[a-zA-Z0-9]{16}$/.test(id);

test("a key always hashes to the same 16-character lowercase id, valid as a Foundry document id", () => {
    const key = "pledge:abc123:Actor.x1:n0nce";
    assert.equal(hashId(key), hashId(key));
    assert.equal(hashId(key).length, ID_LENGTH);
    assert.ok(isRecordId(hashId(key)));
    assert.ok(isValidFoundryId(hashId(key)));
});

test("different keys give different ids, across many near-identical keys", () => {
    const ids = new Set();
    for (let i = 0; i < 20000; i++) ids.add(hashId(`wage:job1:${i}:0`));
    assert.equal(ids.size, 20000);
    assert.notEqual(hashId("a"), hashId("b"));
    assert.notEqual(hashId("expend:o:1:0"), hashId("expend:o:1:1"));
});

test("hashing refuses an empty or non-string key", () => {
    assert.throws(() => hashId(""), TypeError);
    assert.throws(() => hashId(12), TypeError);
});

test("ids compare in code-point order, as String#compare does, not by locale", () => {
    // Foundry 14.368 common/primitives/string.mjs: compare(other) is `this < other ? -1 : ...`.
    assert.ok(compareIds("B", "a") < 0);          // "B" (66) sorts before "a" (97)
    assert.ok("B".localeCompare("a", "en") > 0);  // where a locale sort would disagree
    assert.equal(compareIds("abc", "abc"), 0);
    assert.deepEqual(["b", "A", "a", "B"].sort(compareIds), ["A", "B", "a", "b"]);
});

test("random ids are lowercase alphanumerics; a biased value asks for a fresh draw", () => {
    const id = idFromRandom(Array.from({ length: 16 }, (_, i) => i * 7919));
    assert.ok(isRecordId(id));
    assert.equal(idFromRandom(Array.from({ length: 16 }, () => 0)), "aaaaaaaaaaaaaaaa");
    assert.equal(idFromRandom([...Array(15).fill(1), 2 ** 32 - 1]), null);
    assert.throws(() => idFromRandom([1, 2, 3]), RangeError);
});

test("idempotency keys join their parts and refuse parts that could make two keys collide", () => {
    assert.equal(idemKey("wage", "job1", 12, 0), "wage:job1:12:0");
    assert.equal(idemKey("pledge", "o1", "Actor.abc", "n1"), "pledge:o1:Actor.abc:n1");
    assert.throws(() => idemKey("a", "b:c"), TypeError);
    assert.throws(() => idemKey("a", ""), TypeError);
    assert.throws(() => idemKey("a", 1.5), TypeError);
    assert.throws(() => idemKey(), TypeError);
});
