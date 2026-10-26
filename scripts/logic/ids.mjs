/**
 * Record ids and idempotency keys (DESIGN.md 4.1, 4.6, 5.6).
 *
 * - Every record id is 16 lowercase letters and digits: a random id, or the hash of an idempotency key.
 *   Both are valid Foundry document ids (Foundry 14 `common/data/validators.mjs` `isValidId`:
 *   16 characters of `[a-zA-Z0-9]`), so a row's id can also be the `_id` of the lock page that guards it
 *   (5.4).
 * - An idempotency key is built from the operation, never from the clock: `pledge:<order>:<actor>:<nonce>`.
 * - User ids are compared in code-point order, exactly as Foundry's `String#compare`
 *   (`common/primitives/string.mjs`), never with `localeCompare`, so every client elects the same user.
 */

/** Length of every record id. */
export const ID_LENGTH = 16;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MASK_64 = (1n << 64n) - 1n;
const FNV_PRIME = 0x100000001b3n;
/** Two FNV-1a offset bases: the standard one, and a second one so the two halves are independent. */
const FNV_OFFSETS = [0xcbf29ce484222325n, 0x84222325cbf29ce4n];

/** Code-point order of two strings: negative, zero or positive. The same as Foundry's `String#compare`. */
export function compareIds(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** 64-bit FNV-1a over the string's UTF-16 code units. */
function fnv1a64(text, offset) {
    let hash = offset;
    for (let i = 0; i < text.length; i++) {
        hash ^= BigInt(text.charCodeAt(i));
        hash = (hash * FNV_PRIME) & MASK_64;
    }
    return hash;
}

/**
 * The record id of an idempotency key: two 64-bit FNV-1a hashes of the key joined into one 128-bit number,
 * written in base 36, last 16 digits (about 82 bits). The same key always gives the same id on every client,
 * which is what makes a row written twice land on one key and one lock page (4.6, 5.4).
 */
export function hashId(key) {
    if (typeof key !== "string" || key === "") throw new TypeError("an idempotency key must be a non-empty string");
    const [high, low] = FNV_OFFSETS.map((offset) => fnv1a64(key, offset));
    return ((high << 64n) | low).toString(36).padStart(ID_LENGTH, "0").slice(-ID_LENGTH);
}

/**
 * A random id from random 32-bit integers, as Foundry's `randomID` makes one but lowercase (4.1: random ids
 * are safe inside roll options). Values that would bias the result are rejected, so the caller passes fresh
 * values until it gets an id; null means "draw again".
 *
 * @param {ArrayLike<number>} values  at least 16 random unsigned 32-bit integers
 * @returns {string|null}
 */
export function idFromRandom(values) {
    if (values.length < ID_LENGTH) throw new RangeError(`need ${ID_LENGTH} random values`);
    const cutoff = 2 ** 32 - (2 ** 32 % ALPHABET.length);
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) {
        if (values[i] >= cutoff) return null;
        id += ALPHABET[values[i] % ALPHABET.length];
    }
    return id;
}

/** Whether `id` has the shape of a record id. */
export function isRecordId(id) {
    return typeof id === "string" && /^[a-z0-9]{16}$/.test(id);
}

/**
 * An idempotency key from its parts, joined with ":". Parts are strings or integers (an actor UUID, an order
 * id, a day, a sequence number); a part may not be empty or contain ":", so two different operations can
 * never produce the same key.
 */
export function idemKey(...parts) {
    if (!parts.length) throw new TypeError("an idempotency key needs at least one part");
    return parts.map((part) => {
        if (Number.isInteger(part)) return String(part);
        if (typeof part !== "string" || part === "" || part.includes(":")) {
            throw new TypeError(`bad idempotency key part ${JSON.stringify(part)}`);
        }
        return part;
    }).join(":");
}
