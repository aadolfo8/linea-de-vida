# Visual refresh — ODD task ledger

## Objective and boundary

Improve the archive's visual clarity and settings usability in reviewable, independent work units. This branch starts at merge-base `03258dab386c17d0dbc1654c114a94cb0b1ecbd2` against `origin/main`. The current work unit is **VR-1 only**: an in-app concentration mode for the timeline, not the browser Fullscreen API. Do not touch the user's dirty `.gitignore`, remote state, backend, or unrelated features. Preserve privacy, user authorization, date precision (`YEAR`, `MONTH`, `DAY`, `UNKNOWN`), and the existing editorial/immersive navigation.

## Route and trigger evidence

- `apps/web/app/timeline/page.tsx`, `[year]/page.tsx`, and `[year]/[month]/page.tsx` all render `TimelineRoute`, selecting editorial only when `view=editorial`.
- `TimelineRoute.tsx` owns `ArchiveNav`, the view switch, and the renderer for all three depths; `timelineHref` preserves the editorial query in timeline navigation. `timeline-shell.effects.spec.tsx` already checks shell controls and month positioning.
- This ledger covers three requested outcomes, but only VR-1 is authorized for implementation in this work unit. Later visual-world choices require user direction; do not replace `DESIGN.md` here.

## Stable tasks

### VR-1 — Fullscreen concentration mode (current)

Add an explicit, reversible in-app focus presentation for panorama, year, and month routes in both timeline variants. Hide peripheral archive navigation and the view switch while active, retain temporal navigation, back/retry/load-more and other critical content controls, and keep a visible exit. Enter/exit and Escape must work with keyboard focus restored appropriately. Do not enter the native browser Fullscreen API, change the current pathname or `view` query, or alter the interpretation of dates or authorization. Test route depths, variants, keyboard, and transitions alongside the behavior.

### VR-2 — Coherent replacement visual identity across timeline/home (deferred)

Choose a replacement visual world with the user and implement it coherently across timeline and home, preserving product truth and interaction contracts. Acceptance: both surfaces share a consistent approved identity, remain usable at mobile and desktop widths, and preserve existing archive flows. Do not choose the world or modify `DESIGN.md` in VR-1.

### VR-3 — Settings task-first information architecture (deferred)

Organize settings around user tasks and recovery paths without changing authorization or data semantics. Acceptance: major tasks are discoverable, keyboard-operable, and retain their existing behavior; test critical settings flows.

## Review workload and delivery

VR-1 forecast: approximately 220–350 authored changed lines across route shell, scoped styles, tests, and this ledger; VR-2 and VR-3 are separate units and not estimated until scoped. The 400-line advisory is not a reason to compress tests or code. Delivery strategy: **ask-on-risk** if the cohesive VR-1 change exceeds 400 authored additions plus deletions or cannot be reviewed independently; do not silently start another task or PR. No TDD configuration is explicitly known, so use ordinary functional checks: `pnpm --filter @linea-de-vida/web test`, `pnpm --filter @linea-de-vida/web typecheck`, `pnpm --filter @linea-de-vida/web lint`, and `pnpm format:check` (targeted check if an unrelated global baseline fails). Format edited source before verification. Record actual outcomes and counts here.

## VR-1 evidence and status

- Status: implemented and verified locally; commit pending. A shared timeline layout provider keeps focus mode across nested route changes; entering hides only peripheral shell controls, leaving the timeline and a visible exit in place. Escape defers to the photo dialog.
- Focused test: `timeline-shell.effects.spec.tsx` — 12 passed, including both variants at panorama/year/month/unknown-month depths, persistent nested navigation, Escape, and focus restoration. Runtime harness: N/A (no browser runtime harness exercised in this unit); jsdom component integration covers UI transitions, but visual behavior in a real browser remains unverified.
- Checks: `pnpm --filter @linea-de-vida/web test` — 9 files, 43 tests passed; `pnpm --filter @linea-de-vida/web typecheck` — passed; `pnpm --filter @linea-de-vida/web lint` — passed; `pnpm format:check` — passed (100 files). `node C:\Users\acpal\.agents\skills\impeccable\scripts\detect.mjs --json` on changed UI targets — `[]` (no mechanical findings). Initial `pnpm exec prettier --write` could not run because Prettier is not installed; formatted with the repository's `pnpm exec oxfmt` instead.
- Rollback boundary: VR-1 route-shell behavior, scoped CSS, and associated tests; VR-2/VR-3 remain untouched.
- Commit identity and verification: pending.
- Engram mirror topic: `odd/visual-refresh/tasks`; pre-source-write mirror and readback succeeded; final status mirror pending.
