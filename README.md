# Artisan's Workshop (PF2e)

A Foundry VTT module for the Pathfinder Second Edition system: one place to run an
alchemist or crafter, and the party that leans on them.

**Status: early development.** Nothing installable yet: the repository has the M0
scaffold (manifest, tooling, CI) and the M1 rules core (pure crafting and Earn Income
rules with tests), which nothing in Foundry uses yet. The specification is `DESIGN.md`;
decisions land in `DECISIONS.md`.

## What it is for

- **A party crafting queue.** Party members request items; the crafter sees what
  is wanted, which formulas they have (and how they could get the missing ones),
  the materials and days each item needs, and how far along each one is. Everyone
  sees the queue and a progress bar per item.
- **Shared funding.** Party members put gold toward an item's materials, and the
  ledger remembers who paid for what.
- **Daily preparations.** Advanced Alchemy, talismans and other daily items, built
  to work alongside the PF2e system and pf2e-dailies rather than against them.
- **Rules coverage.** Feats, class features and gear that change crafting cost,
  time, batches or formulas are read from the character, not entered by hand.
- **Downtime.** Earn Income with Crafting, Cooking Lore or any other skill, paid
  straight to the earner; GMs set settlement task levels. Nothing waits on GM
  approval, and it works with no GM online.

Alchemy is the first crafting journey, not the only one: magic items and runes,
talismans, tattoos and snares are in scope.

## Compatibility

Targets the latest Foundry VTT release and the latest PF2e system release, Remaster
rules first.

## Development

No build step and no runtime dependencies: `npm` installs only ESLint for the dev
tools. Use Node 24.13.1 or a later 24.x (`DESIGN.md` 3.2); `npm ci` refuses any other.

```sh
npm ci
npm run lint             # ESLint (DESIGN.md 15.1), then tools/check-source.mjs
npm test                 # node --test over test/
npm run check:manifest   # module.json against the manifest policy (DESIGN.md 3.1, 16.3)
npm run check:assets     # no images, audio, video or fonts (DESIGN.md 16.5)
npm run check:strings    # strings still waiting for the author's sign-off (DESIGN.md 16.4)
npm run check:strings:enforce   # the same, failing if any is left (stable releases)
npm run signoff -- --keys <key> [<key> ...]   # sign off strings the author has rewritten
```

Every user-facing string lives in `lang/en.json` under `pf2e-artisans-workshop.` keys.
Write each key out in full in code and templates (`"pf2e-artisans-workshop.Queue.Title"`,
not built from `MODULE_ID`) and capitalise its first segment: that is how `npm run lint`
finds keys and checks they exist, and how it tells them from hook and query names, which
are lower case. CI (`.github/workflows/ci.yml`) runs all of the above, with the strings
gate in report mode.

Layout: `scripts/` is the shipped code (`module.mjs` is the entry); `lang/` holds the
strings and `lang/review/` their sign-off hashes; `tools/` holds the dev scripts and
`tools/harness/` the fixture actors, neither shipped; `test/` the tests. `scripts/logic/`
is the rules engine (pure functions with no Foundry or browser globals, so `node --test`
imports it directly; tests in `test/logic/`) and `scripts/data/` its numeric tables, each
cited by book and page. Later milestones add `templates/`, `styles/` and `macros/`
(copy-paste macros; the lint rules and key check already cover that folder).

Local Foundry harness: symlink the checkout into `Data/modules/`, enable the module in a
test world, and as GM run `await game.settings.set("pf2e-artisans-workshop", "dev", true)`
in the console, then reload. In a dev world any deprecation warning whose stack passes
through this module's files throws, even one raised inside pf2e, core or another module
that this module called, and `game.modules.get("pf2e-artisans-workshop").dev.fixtures.create()`
builds the fixture actors of `DESIGN.md` 15.4 (`{ reset: true }` rebuilds them). To check
the fixtures' compendium UUIDs and choice-set answers against a pf2e source checkout, run
`PF2E_SRC=<checkout> npm test`.

## License

Code is MIT (see `LICENSE`). This is unofficial fan content, not affiliated with or
endorsed by Paizo Inc.; the content-licensing notice will be finalised before the
first release.
