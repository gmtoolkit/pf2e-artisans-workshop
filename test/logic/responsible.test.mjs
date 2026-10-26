/** The responsible client (DESIGN.md 5.6): who performs a write that a hook on every client triggers. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { electedUser, responsibleUserFor, responsibleUserForShared } from "../../scripts/logic/responsible.mjs";

const user = (id, fields = {}) => ({ id, active: true, isGM: false, character: null, ...fields });
const actor = (id, owners = []) => ({ id, owners: new Set(owners) });

test("the connected player whose character it is comes first, even over a lower-id owner", () => {
    const users = [user("aaaa"), user("bbbb", { character: "pc1" }), user("gm", { isGM: true })];
    assert.equal(responsibleUserFor(actor("pc1", ["aaaa", "bbbb"]), { users, activeGMId: "gm" }), "bbbb");
});

test("several players assigned the same character: the lowest id, in code-point order", () => {
    const users = [user("b", { character: "pc1" }), user("B", { character: "pc1" }), user("a", { character: "pc1" })];
    assert.equal(responsibleUserFor(actor("pc1", ["a", "b", "B"]), { users }), "B");   // "B" < "a" < "b"
});

test("a player assigned a character they only observe is passed over for its owner", () => {
    const users = [user("p1", { character: "pc1" }), user("p2"), user("gm", { isGM: true })];
    assert.equal(responsibleUserFor(actor("pc1", ["p2"]), { users, activeGMId: "gm" }), "p2");
    assert.equal(responsibleUserFor(actor("pc1", []), { users, activeGMId: "gm" }), "gm", "no player owner: the GM");
});

test("else the connected player owner with the lowest id, by code point not locale", () => {
    const users = [user("b"), user("Z"), user("a")];
    assert.equal(responsibleUserFor(actor("pc1", ["b", "Z", "a"]), { users }), "Z");
});

test("disconnected players and GM owners are skipped; then the active GM", () => {
    const users = [user("p1", { active: false, character: "pc1" }), user("p2", { active: false }), user("gm", { isGM: true })];
    assert.equal(responsibleUserFor(actor("pc1", ["p1", "p2", "gm"]), { users, activeGMId: "gm" }), "gm");
});

test("nobody when no owner and no GM is connected: the ready sweep catches up later", () => {
    const users = [user("p1", { active: false }), user("p2")];
    assert.equal(responsibleUserFor(actor("pc1", ["p1"]), { users, activeGMId: null }), null);
});

test("shared writes: the triggering user while connected, else the active GM, else the lowest-id user", () => {
    const users = [user("p2"), user("p1"), user("p3", { active: false })];
    assert.equal(responsibleUserForShared("p2", { users, activeGMId: "gm" }), "p2");
    assert.equal(responsibleUserForShared("p3", { users, activeGMId: "gm" }), "gm");
    assert.equal(responsibleUserForShared("p3", { users, activeGMId: null }), "p1");
    assert.equal(responsibleUserForShared("p3", { users: [user("p3", { active: false })] }), null);
});

test("the elected user for migrations: the active GM, else the connected user with the lowest id", () => {
    const users = [user("p2"), user("p1"), user("P0", { active: false })];
    assert.equal(electedUser({ users, activeGMId: "gm" }), "gm");
    assert.equal(electedUser({ users, activeGMId: null }), "p1");
    assert.equal(electedUser({ users: [], activeGMId: null }), null);
});
