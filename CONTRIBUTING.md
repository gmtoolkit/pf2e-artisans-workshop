# Contributing to PF2e Artisan's Workshop

Thanks for helping. This page says how the project works, so that a contribution can be merged as it is.

## Before you start

- **Reports and requests** go through the issue forms (bug report, feature request, translation); blank issues are
  off. A bug report needs the module version, the Foundry build, the PF2e system version, the host, the other active
  modules and the console errors, because most crafting bugs depend on them.
- **The design comes first.** `DESIGN.md` is the specification and `DECISIONS.md` records every decision, newest first.
  Read the parts your change touches; a change that departs from the design changes `DESIGN.md` in the same pull request,
  and a new decision gets a `DECISIONS.md` entry.
- **What the module is not.** It builds on the PF2e system's own crafting (its `CraftingAbility` methods, formula
  list, coins, rest and rolls) and never replaces the system's Craft button or Craft macro. It works beside
  pf2e-dailies, PF2e Toolbelt, PF2e Workbench and Item Piles and does not repeat what they do. Nothing in it waits for a
  GM to approve or to be online. Adventure-path subsystems (a circus, a kingdom) belong in their own modules, built on
  the extension API (`DESIGN.md` 12).

## Development

Use Node 24.13.1 or a later 24.x (`npm ci` refuses any other). There is no build step and no runtime dependency.

```sh
npm ci
npm run lint    # ESLint, then tools/check-source.mjs
npm test        # node --test over test/
```

Both must pass before a pull request; the pull request template has the rest of the checklist. The README's Development
section covers the manifest, asset and strings checks, the registry validation against a pf2e checkout, the live
harness in a local Foundry world, and the release dry run. Foundry code is Application V2 only, and the lint rules
reject the APIs Foundry v15 removes.

## User-facing text and Foundry's AI content policy

Foundry's AI content policy (https://foundryvtt.com/article/ai-policy/) requires a listed package's user-facing text
(UI labels and messages, the package description, journal text) to be written by people, and allows no AI-generated
images. This project keeps to that as follows:

- **Every string a user sees lives in `lang/en.json`**, under a `pf2e-artisans-workshop.` key; code and templates name
  keys only, and the lint rules reject literal text in templates and notifications.
- **The strings in this repository are drafts until 1.0.** They are written with the code, much of which is written
  with an AI coding assistant, and the author rewrites every one of them by hand before the module is listed.
- **The sign-off gate proves it.** `lang/review/en.signoff.json` holds a hash of each string, the README, the package
  description and the manifest's title and description, recorded by the author with `npm run signoff` once they have
  rewritten it. A stable release fails while anything is new or changed since its sign-off. Only the author signs off:
  do not edit `lang/review/`.
- **In a pull request**, add or change strings in `lang/en.json` as plain, short placeholders; they are rewritten and
  signed off by the author like the rest. Do not submit machine-written text as final wording.
- **No images, audio or fonts.** Icons are Font Awesome classes, Foundry core icons or PF2e system icon paths, and item
  images come from the compendium. The asset check fails on anything else, except the README's screenshots of the
  module's own window in `docs/screenshots/`.
- **Translations** come as a pull request adding `lang/<code>.json`, reviewed by a fluent speaker: machine translation
  is allowed only with that review. They are best started once the English text is signed off at 1.0.

Code may be written with any tools, AI assistants included, as long as you understand every line you submit and it
stays small enough for the author to maintain.

## Rules text and licences

Do not add Paizo rules text: the module refers to the PF2e system's compendium items by UUID and ships only numbers
(tables, rarity adjustments, thresholds), each cited by book and page in `scripts/data/`. The code is MIT; by
contributing you agree that your contribution is released under the same licence. `NOTICE` holds the Community Use
Policy, ORC and OGL notices for the game material.

## Releases

Releases are made by the author: publishing a GitHub release whose tag is the bare version runs the release workflow
(`DESIGN.md` 16.9). Pre-releases are for test tables and are installed by manifest URL; nothing is listed on
foundryvtt.com before the whole scope of `DESIGN.md` 1 is done.
