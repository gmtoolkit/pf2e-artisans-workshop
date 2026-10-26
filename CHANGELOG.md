# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the module uses
[semantic versioning](https://semver.org/) from 1.0.0.

## [Unreleased]

### Added

- Development scaffold (milestone M0): manifest, ESLint rules, tests, the strings sign-off gate,
  the asset and manifest checks, CI, and fixture actors for the local test harness. No features
  yet.
- Rules core (milestone M1), as pure functions with tests and not yet used in Foundry: the level,
  rarity and Craft DCs; Income Earned; Craft pricing, setup (with the formula, without it, the fixed
  setups and Complex Crafting's table), the frozen plan and the money each order step moves; extra-day
  reductions with level-up recompute, minimums and the level-20 critical-success row; batches,
  including ammunition and Efficient Alchemy; formula families and coverage; eligibility gates G1-G12;
  precious materials; Communal Crafting helpers and Aid; formula routes and acquisition jobs; Earn
  Income jobs; the coin planner (pf2e change-making, create-only strongbox plans) and the pro-rata
  splitter. The numeric tables ship as data modules cited by book and page.
- Storage and sync (milestone M2), with no window yet: the master switch, which has a GM create the shared
  ledger and strongbox that every player owns (and re-create or repair them); the schema version with a
  migration framework; the key-path store over the ledger; the responsible client with a one-tab lease;
  coin moves as lock-first batches using the coin planner; claims for refunds, wages and deliveries, with the
  GM relay as an accelerator; roster snapshots; deletion guards; the GM's purge of all data; reconciliation
  and the catch-up sweep at ready. Settings for the master switch, members, auto-claim and the rules-gap
  defaults. Live-harness scenario scripts for the multi-user cases.
- Live-harness driver (`npm run harness:live`): runs the storage-and-sync scenarios in a running dev world
  with Playwright, one browser per user and device, and checks the results against the server.

### Fixed

- Storage and sync, from the first live runs: a client stops writing the moment a shared document it uses is
  deleted, or its user loses OWNER on one, even when no update hook reaches it (players without a canvas); ages
  and timeouts read stamps on the server's own clock across relaunches of the world, so a migration lock or a
  pending row from an earlier, longer launch is no longer taken to be recent; a move waits for a late answer from
  a busy server instead of giving up after 30 s with its lock taken and nothing moved, and gives up at once when
  the connection drops; a duplicate claim or coin move that sees the first one's lock says "already" rather than
  "strongbox-short", and leaves the first one's resolution of the claim alone.
- Live harness: the scenario steps that failed on their own (the purse check across two devices, the claim
  step's row count, a GM's refunds, refunds written in one go, a race started before its claim arrived); the
  cleric fixture's Domain Initiate, granted two grants deep, no longer opens pf2e's choice prompt.
- A coin move whose lock request landed but whose apply request never did (a tab closed, or the connection
  dropped, between the two) is resumed by the catch-up sweep once it is past the grace time and its coins are as
  it planned them; an apply mark makes its apply request land once, whoever sends it. Before, its row stayed
  pending and its claim resolved with nothing paid. A stopped move's note no longer sets its row back to pending
  (which could undo a resume), except when the request went out without an operation.
- A pledge, deposit, withdrawal or wage with no positive amount is refused as "nothing" again, not thrown.
- A client that has to reload says why: a refused change, a dropped connection or a missing answer.
- The lint rule against the game socket catches every way of reaching it again (destructuring, computed access).
- The fixture actors' marks live in `flags.world`, outside the module's flags, so a purge no longer strips them.
