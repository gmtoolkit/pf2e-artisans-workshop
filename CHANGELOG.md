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
