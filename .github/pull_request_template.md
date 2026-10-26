## What and why

<!-- The milestone (DESIGN.md 17) and what this changes. -->

## Checklist

- [ ] `npm run lint`, `npm test`, `npm run check:manifest` and `npm run check:assets` pass on Node 24.
- [ ] `DESIGN.md` is updated in this PR wherever the code departs from it.
- [ ] Every new user-facing string is in `lang/en.json` under a `pf2e-artisans-workshop.` key.
- [ ] Checked against the principles of `DESIGN.md` 2 (P1-P16), in particular: nothing waits on a GM (P1, P2),
      writes go by key to documents the user owns (P3), all-client hooks write on one client (P4), effects are
      idempotent (P5), the system is the engine (P6), no rules text (P9), and nothing targets a specific
      character (P15).
- [ ] No images, audio or fonts; icons are Font Awesome, Foundry core or pf2e paths (P14).
