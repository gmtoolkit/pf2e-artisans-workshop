/**
 * Keyboard focus and the caret across a re-render (DESIGN.md 10.9: live updates never steal focus). Core's
 * `HandlebarsApplicationMixin` gives focus back only to an element with an id or a name, and with the caret at the
 * start of a text field. The Workshop's controls are told apart by their data attributes (a filter, an action and its
 * step, the order or ledger row they belong to), so its windows record the focused control as a selector before a part
 * is replaced (`_preSyncPartState`) and focus it again afterwards (`_syncPartState`), caret and selection included.
 */

/**
 * A control's own data attributes that tell it apart, in the order a selector names them. The Downtime tab and the
 * wizard repeat a control per character, job, settlement or skill, told apart by `actor`, `job`, `profile`, `skill`,
 * and a check's `kind` and `ref` (M6); the Morning tab's by `pool`, `standing`, `loadout`, `talisman`, `gap` and `morning` (M7); the
 * Bandolier's and the Quick Alchemy panel's by `bandolier`, `quick` and a Strike's `map` (M8).
 */
const OWN = Object.freeze(["filter", "action", "op", "tab", "uuid", "toggle", "fix", "item", "actor", "job", "profile", "skill", "kind", "ref", "pool", "standing",
    "loadout", "talisman", "gap", "morning", "bandolier", "quick", "map"]);
/** Data attributes of the container a control belongs to: an order (its row or its detail), a ledger row. */
const SCOPE = Object.freeze(["orderId", "rowId"]);

/** `orderId` as an attribute name: `data-order-id`. */
const attribute = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** `[data-key="value"]` for each of `keys` the element has. */
const attributes = (element, keys) => keys.filter((key) => element.dataset?.[key] !== undefined)
    .map((key) => `[${attribute(key)}=${JSON.stringify(String(element.dataset[key]))}]`).join("");

const SCOPE_SELECTOR = SCOPE.map((key) => `[${attribute(key)}]`).join(", ");

/**
 * A selector that finds `element` again in a re-rendered part, or null when nothing names it: its id; or its name, with
 * its own data attributes (one select per character shares a name) and a radio button's value; or its tag and data
 * attributes inside the order or ledger row it belongs to (a row's button, the detail drawer's button).
 */
export function focusSelector(element) {
    if (!element?.tagName) return null;
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}[id=${JSON.stringify(element.id)}]`;
    const name = element.getAttribute?.("name");
    if (name) {
        const value = element.type === "radio" ? `[value=${JSON.stringify(String(element.value))}]` : "";
        return `${tag}[name=${JSON.stringify(name)}]${value}${attributes(element, OWN)}`;
    }
    const scope = element.closest?.(SCOPE_SELECTOR) ?? null;
    if (scope === element) return `${tag}${attributes(element, SCOPE)}`;
    const own = attributes(element, OWN);
    if (!own) return null;
    return scope ? `${scope.tagName.toLowerCase()}${attributes(scope, SCOPE)} ${tag}${own}` : `${tag}${own}`;
}

/** What to give focus back to inside `root`: the focused control's selector and a text field's selection, or null. */
export function focusState(root) {
    const active = root?.ownerDocument?.activeElement;
    if (!active || active === root || !root.contains(active)) return null;
    const selector = focusSelector(active);
    if (!selector) return null;
    const caret = Number.isInteger(active.selectionStart) ? [active.selectionStart, active.selectionEnd, active.selectionDirection ?? "none"] : null;
    return { selector, caret };
}

/** Give focus back inside `root` (`focusState`), without scrolling, with the caret where it was. */
export function restoreFocus(root, state) {
    const element = state ? root?.querySelector(state.selector) : null;
    if (!element) return false;
    element.focus({ preventScroll: true });
    if (state.caret && typeof element.setSelectionRange === "function") {
        try {
            element.setSelectionRange(...state.caret);
        } catch {
            // a field type without a selection (a number): focus is enough
        }
    }
    return true;
}

/**
 * The layout tier of a window this wide (10.8): `wide` at 1040 px and more, `medium` from 720 px, `narrow` below. The
 * stylesheet's container queries draw the same lines; a width of 0 (not rendered) reads as wide.
 */
export function tierOf(width) {
    if (!(width > 0) || width >= 1040) return "wide";
    return width >= 720 ? "medium" : "narrow";
}

/** What Tab can reach inside `root`: enabled controls, links and anything given a tab stop, in document order. */
const TABBABLE = "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/** The elements of `root` that Tab reaches, without hidden ones. */
export function focusablesIn(root) {
    return [...(root?.querySelectorAll?.(TABBABLE) ?? [])].filter((el) => !el.hidden && !el.closest?.("[hidden], [inert]") && el.getClientRects?.().length !== 0);
}

/**
 * A focus trap's step (10.9: drawers trap focus): from the last of `focusables` Tab goes to the first, from the first (or
 * the container itself) Shift+Tab goes to the last. Null when the browser's own step stays inside.
 *
 * @param {Element[]} focusables
 * @param {Element} active
 * @param {boolean} shift
 */
export function trapStep(focusables, active, shift) {
    if (!focusables.length) return null;
    const first = focusables[0];
    const last = focusables.at(-1);
    const index = focusables.indexOf(active);
    if (shift && index <= 0) return last;
    if (!shift && (index === -1 || active === last)) return first;
    return null;
}
