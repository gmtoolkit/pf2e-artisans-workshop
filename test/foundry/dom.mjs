/**
 * A small DOM and a faithful ApplicationV2 for the tests that need more than a context object (M11): elements with classes,
 * attributes (`data-*` mirrored into `dataset`), children, listeners, `isConnected` through a document root, and a selector
 * engine for what the module's code asks (tags, classes, `[attr]`, `[attr='v']`, `:scope >`, descendants, `:not(...)` of one
 * compound, comma lists). The ApplicationV2 has Foundry 14.368's read-only properties as getters (`state`, `rendered`,
 * `element`, `id`, `window`, `title`, `position`) and frozen `options`, so code that assigns one of them fails here as it
 * would in Foundry (the M6 follow-up on one faithful stub).
 */

const camel = (name) => name.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export class FakeElement {
    constructor(tag, doc) {
        this.tagName = tag.toUpperCase();
        this.ownerDocument = doc;
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.listeners = {};
        this.hidden = false;
        this.inert = false;
        this.disabled = false;
        this.clientWidth = 0;
        this._text = "";
        const classes = new Set();
        const self = this;
        this.classList = {
            add: (...c) => c.forEach((x) => classes.add(x)),
            remove: (...c) => c.forEach((x) => classes.delete(x)),
            contains: (c) => classes.has(c),
            toggle: (c, force) => {
                const on = force === undefined ? !classes.has(c) : !!force;
                if (on) classes.add(c);
                else classes.delete(c);
                return on;
            },
            get length() { return classes.size; },
            [Symbol.iterator]: () => classes.values(),
        };
        this.dataset = new Proxy({}, {
            get: (_t, key) => (typeof key === "string" ? self.attributes[`data-${kebab(key)}`] : undefined),
            set: (_t, key, value) => { self.attributes[`data-${kebab(key)}`] = String(value); return true; },
            deleteProperty: (_t, key) => { delete self.attributes[`data-${kebab(key)}`]; return true; },
            has: (_t, key) => `data-${kebab(key)}` in self.attributes,
            ownKeys: () => Object.keys(self.attributes).filter((k) => k.startsWith("data-")).map((k) => camel(k.slice(5))),
            getOwnPropertyDescriptor: (_t, key) => (`data-${kebab(key)}` in self.attributes
                ? { enumerable: true, configurable: true, value: self.attributes[`data-${kebab(key)}`] } : undefined),
        });
    }

    get id() { return this.attributes.id ?? ""; }
    set id(value) { this.attributes.id = String(value); }
    get className() { return [...this.classList].join(" "); }
    set className(value) { for (const c of [...this.classList]) this.classList.remove(c); this.classList.add(...String(value).split(/\s+/).filter(Boolean)); }
    get type() { return this.attributes.type ?? ""; }
    set type(value) { this.attributes.type = String(value); }
    get tabIndex() { return Number(this.attributes.tabindex ?? -1); }
    set tabIndex(value) { this.attributes.tabindex = String(value); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set textContent(value) { this.children = []; this._text = String(value ?? ""); }
    get isConnected() {
        let node = this;
        while (node.parentElement) node = node.parentElement;
        return node === this.ownerDocument?.body;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "class") this.className = value;
    }
    getAttribute(name) { return name === "class" ? this.className : this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes || (name === "class" && this.classList.length > 0); }
    removeAttribute(name) { delete this.attributes[name]; }

    #adopt(node) {
        node.parentElement?.removeChild(node);
        node.parentElement = this;
        return node;
    }
    append(...nodes) { for (const n of nodes) if (n) this.children.push(this.#adopt(n)); }
    prepend(...nodes) { this.children.unshift(...nodes.filter(Boolean).map((n) => this.#adopt(n))); }
    removeChild(node) {
        const i = this.children.indexOf(node);
        if (i >= 0) this.children.splice(i, 1);
        node.parentElement = null;
        return node;
    }
    remove() { this.parentElement?.removeChild(this); }
    after(...nodes) {
        const parent = this.parentElement;
        const at = parent.children.indexOf(this) + 1;
        parent.children.splice(at, 0, ...nodes.filter(Boolean).map((n) => { n.parentElement?.removeChild(n); n.parentElement = parent; return n; }));
    }
    replaceChildren(...nodes) {
        for (const c of this.children) c.parentElement = null;
        this.children = [];
        this._text = "";
        this.append(...nodes);
        this.ownerDocument?.mutated?.(this);
    }
    contains(node) {
        for (let n = node; n; n = n.parentElement) if (n === this) return true;
        return false;
    }
    getClientRects() { return this.hidden ? [] : [{}]; }
    focus() { this.ownerDocument.activeElement = this; }
    scrollIntoView() {}

    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
    dispatch(type, init = {}) {
        const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...init };
        for (let node = this; node; node = node.parentElement) for (const fn of node.listeners[type] ?? []) fn(event);
        return event;
    }
    click() { return this.dispatch("click"); }

    matches(selector) { return selectorList(selector).some((chain) => matchChain(this, chain, null)); }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        const chains = selectorList(selector);
        const out = [];
        const walk = (node) => {
            for (const child of node.children) {
                if (chains.some((chain) => matchChain(child, chain, this))) out.push(child);
                walk(child);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

/** `a, b` into chains of `{compound, combinator}` (descendant " " or child ">"), `:scope` kept as a compound. */
function selectorList(selector) {
    return selector.split(",").map((part) => {
        const tokens = part.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
        const chain = [];
        let combinator = " ";
        for (const token of tokens) {
            if (token === ">") { combinator = ">"; continue; }
            chain.push({ compound: token, combinator });
            combinator = " ";
        }
        return chain;
    });
}

/** Whether `el` matches one compound: `tag.class[attr='v'][attr]`, or `:scope` (the element queried from). */
function matchCompound(el, compound, scope) {
    if (compound === ":scope") return el === scope;
    const nots = [...compound.matchAll(/:not\(([^)]*)\)/g)].map((m) => m[1]);
    if (nots.some((inner) => matchCompound(el, inner, scope))) return false;
    compound = compound.replace(/:not\([^)]*\)/g, "");
    const attrs = [...compound.matchAll(/\[([\w-]+)(?:=(['"]?)(.*?)\2)?\]/g)];
    const rest = compound.replace(/\[[^\]]*\]/g, "");
    const [tag, ...classes] = rest.split(".");
    if (tag && tag !== "*" && el.tagName !== tag.toUpperCase()) return false;
    if (!classes.every((c) => el.classList.contains(c))) return false;
    return attrs.every(([, name, , value]) => {
        const actual = el.getAttribute(name);
        if (value === undefined) return el.hasAttribute(name);
        return actual === value;
    });
}

/** Whether `el` matches a chain, read right to left. */
function matchChain(el, chain, scope) {
    const last = chain.length - 1;
    if (!matchCompound(el, chain[last].compound, scope)) return false;
    const up = (node, index) => {
        if (index < 0) return true;
        const { combinator } = chain[index + 1];
        if (combinator === ">") return !!node.parentElement && matchCompound(node.parentElement, chain[index].compound, scope) && up(node.parentElement, index - 1);
        for (let p = node.parentElement; p; p = p.parentElement) if (matchCompound(p, chain[index].compound, scope) && up(p, index - 1)) return true;
        return false;
    };
    return up(el, last - 1);
}

/** A document with a body; `mutated` lets a fake MutationObserver hear `replaceChildren`. */
export function fakeDocument() {
    const doc = { activeElement: null, observers: [], defaultView: { innerWidth: 1440, innerHeight: 900 } };
    doc.createElement = (tag) => new FakeElement(tag, doc);
    doc.body = new FakeElement("body", doc);
    doc.mutated = (target) => {
        for (const o of doc.observers) if (o.target === target || o.target.contains(target)) o.callback([{ type: "childList", target }]);
    };
    return doc;
}

/** A MutationObserver that hears `replaceChildren` of the observed element (and inside it, when `subtree`). */
export function installMutationObserver(doc) {
    globalThis.MutationObserver = class {
        constructor(callback) { this.callback = callback; }
        observe(target) { doc.observers.push({ target, callback: this.callback }); }
        disconnect() { doc.observers = doc.observers.filter((o) => o.callback !== this.callback); }
    };
}

/** Build elements from a nested spec: `["div.a.b", {attrs}, ...children]` or a string (text). */
export function build(doc, spec) {
    if (typeof spec === "string") {
        const text = doc.createElement("span");
        text.textContent = spec;
        return text;
    }
    const [head, maybeAttrs, ...rest] = spec;
    const [tag, ...classes] = head.split(".");
    const el = doc.createElement(tag);
    if (classes.length) el.classList.add(...classes);
    const attrs = maybeAttrs && !Array.isArray(maybeAttrs) && typeof maybeAttrs === "object" ? maybeAttrs : null;
    for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
    for (const child of attrs ? rest : [maybeAttrs, ...rest]) if (child !== undefined && child !== null) el.append(build(doc, child));
    return el;
}

/** ApplicationV2 with 14.368's read-only properties as getters, frozen options, and a render that runs the life cycle. */
export function faithfulApplicationV2(doc) {
    return class ApplicationV2 {
        #state = 0;
        #element = null;
        #window = {};
        #position;
        static DEFAULT_OPTIONS = {};
        constructor(options = {}) {
            const defaults = this.constructor.DEFAULT_OPTIONS ?? {};
            const classes = [...(defaults.classes ?? []), ...(options.classes ?? [])];
            this.options = Object.freeze({ ...defaults, ...options, classes });
            this.#position = { ...(defaults.position ?? {}), ...(options.position ?? {}) };
            this.tabGroups = { primary: "queue" };
            this.renders = [];
            this.children = [];
        }
        get state() { return this.#state; }
        get rendered() { return this.#state === 2; }
        get element() { return this.#element; }
        get id() { return this.options.id; }
        get window() { return this.#window; }
        get title() { return this.options.window?.title ?? ""; }
        get position() { return this.#position; }
        get minimized() { return false; }
        async _prepareContext() { return {}; }
        async _preparePartContext(_partId, context) { return context; }
        _preSyncPartState() {}
        _syncPartState() {}
        async _onRender() {}
        _onClose() {}
        _onPosition() {}
        setPosition(position) {
            Object.assign(this.#position, position);
            this._onPosition(this.#position);
            return this.#position;
        }
        renderChild(app) { this.children.push(app); return app.render({ force: true }); }
        bringToFront() {}
        async render(options = {}) {
            const first = this.#state !== 2;
            this.context = await this._prepareContext(options);
            this.renders.push(options);
            if (first) {
                this.#element = doc.createElement("div");
                this.#element.classList.add(...this.options.classes);
                doc.body.append(this.#element);
                this.#state = 2;
                await this._onFirstRender?.(this.context, options);
            }
            await this._onRender(this.context, { ...options, isFirstRender: first });
            return this;
        }
        async close() {
            this.#state = -1;
            this.#element?.remove();
            this._onClose({});
            return this;
        }
    };
}
