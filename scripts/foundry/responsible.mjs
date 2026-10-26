/**
 * The responsible-client guard (DESIGN.md 5.6, P4) over Foundry's users: every handler of a hook that fires on
 * all clients starts with `isResponsibleFor(actor)` (or `isResponsibleForShared` / `isElected`). The choice
 * itself is pure (`scripts/logic/responsible.mjs`); this file passes it the users and adds the lease, so only
 * one tab of the responsible user acts.
 */
import { electedUser, responsibleUserFor, responsibleUserForShared } from "../logic/responsible.mjs";
import { holdsLease } from "./lease.mjs";

/** The users as the pure resolver reads them, and core's active GM. */
function world() {
    const users = game.users.map((u) => ({ id: u.id, active: u.active, isGM: u.isGM, character: u.character?.id ?? null }));
    return { users, activeGMId: game.users.activeGM?.id ?? null };
}

/** The ids of the non-GM users with OWNER on `actor`. */
function ownersOf(actor) {
    return new Set(game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.id));
}

/** The id of the user responsible for writes to (and prompts about) `actor`, or null. */
export function responsibleUserIdFor(actor) {
    return responsibleUserFor({ id: actor.id, owners: ownersOf(actor) }, world());
}

/** Whether this tab performs writes about `actor` that a hook on every client triggered. */
export function isResponsibleFor(actor) {
    return holdsLease() && responsibleUserIdFor(actor) === game.user.id;
}

/** Whether this tab performs shared-document writes caused by a change `userId` made. */
export function isResponsibleForShared(userId) {
    return holdsLease() && responsibleUserForShared(userId, world()) === game.user.id;
}

/** Whether this tab is the elected one for timer-driven shared work (migrations). */
export function isElected() {
    return holdsLease() && electedUser(world()) === game.user.id;
}

/** Whether a non-GM owner of `actor` is connected (the relay then leaves its claims to that owner, 5.7). */
export function ownerConnected(actor) {
    return game.users.some((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}
