/**
 * The responsible client (DESIGN.md 5.6, P4): which user performs a write that a hook firing on every
 * client triggers, so it happens once. Pure: the Foundry side passes the users as plain data.
 *
 * A user is `{id, active, isGM, character}`, `character` being the id of the actor assigned to them (or
 * null). `activeGMId` is Foundry's `game.users.activeGM` (the active GM with the highest role, then the lowest
 * id), passed in rather than recomputed so the module elects exactly the GM core elects.
 *
 * Within one user's clients, the Web Locks lease (`scripts/foundry/lease.mjs`) picks the one tab that acts.
 */
import { compareIds } from "./ids.mjs";

/** The user with the lowest id (code-point order), or null. */
function lowestId(users) {
    return [...users].sort((a, b) => compareIds(a.id, b.id))[0] ?? null;
}

/**
 * The user who writes to, or is prompted about, an actor:
 * 1. a connected player whose assigned character it is and who owns it (the lowest id if several): Foundry lets
 *    a GM assign a character the player only observes, and such a player could not write it;
 * 2. else the connected player owner with the lowest id;
 * 3. else the active GM (who may be an assistant);
 * 4. else nobody: the `ready` sweep of the next responsible client catches up.
 *
 * `actor.primaryUpdater` is not used: it prefers the GM, and its last step does not require the user to be
 * connected.
 *
 * @param {{id: string, owners: Set<string>}} actor  `owners`: ids of the users with OWNER on it
 * @param {{users: object[], activeGMId: string|null}} world
 * @returns {string|null}  a user id
 */
export function responsibleUserFor(actor, { users, activeGMId = null }) {
    const players = users.filter((u) => u.active && !u.isGM);
    const assigned = lowestId(players.filter((u) => u.character === actor.id && actor.owners.has(u.id)));
    const owner = lowestId(players.filter((u) => actor.owners.has(u.id)));
    return assigned?.id ?? owner?.id ?? activeGMId ?? null;
}

/**
 * The user who writes to the shared documents because of a change another user made: that user while
 * connected, else the active GM, else the connected user with the lowest id.
 */
export function responsibleUserForShared(triggeringUserId, { users, activeGMId = null }) {
    const triggering = users.find((u) => u.id === triggeringUserId && u.active);
    return triggering?.id ?? activeGMId ?? lowestId(users.filter((u) => u.active))?.id ?? null;
}

/**
 * The elected user for timer-driven work on the shared documents (migrations 4.14, archiving 5.3.3): the
 * active GM, otherwise the connected user with the lowest id.
 */
export function electedUser({ users, activeGMId = null }) {
    return activeGMId ?? lowestId(users.filter((u) => u.active))?.id ?? null;
}
