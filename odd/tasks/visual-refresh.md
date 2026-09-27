# Visual refresh — ODD task ledger

## Objective and boundary

Improve the archive's visual clarity and settings usability in reviewable, independent work units. This branch starts at merge-base `03258dab386c17d0dbc1654c114a94cb0b1ecbd2` against `origin/main`. VR-1 delivered the in-app concentration mode; VR-2 and VR-3 are now authorized after the user's visual-world selection. Do not touch the user's dirty `.gitignore`, remote state, backend, or unrelated features. Preserve privacy, user authorization, date precision (`YEAR`, `MONTH`, `DAY`, `UNKNOWN`), and both editorial/immersive exploration modes.

## Route and trigger evidence

- `apps/web/app/timeline/page.tsx`, `[year]/page.tsx`, and `[year]/[month]/page.tsx` all render `TimelineRoute`, selecting editorial only when `view=editorial`.
- `TimelineRoute.tsx` owns `ArchiveNav`, the view switch, and the renderer for all three depths; `timelineHref` preserves the editorial query in timeline navigation. `timeline-shell.effects.spec.tsx` already checks shell controls and month positioning.
- Impeccable decision board `http://127.0.0.1:49630/`, seed `4bc7ea36`: the user chose the assigned direction **Cartografía de recuerdos**. Its grammar is survey-paper surfaces, marine ink, mint route lines, coral active stations, and unfiltered authenticated photographs. Years and months are wayfinding nodes; never invent locations or date precision. The category-standard option and unchosen challengers were not selected.
- Image generation is unavailable in this environment (`OPENAI_API_KEY` is unset). No generated sketches/composition comps were used; do not represent catalog inspiration as a promised product screenshot.

## Stable tasks

### VR-1 — Fullscreen concentration mode (current)

Add an explicit, reversible in-app focus presentation for panorama, year, and month routes in both timeline variants. Hide peripheral archive navigation and the view switch while active, retain temporal navigation, back/retry/load-more and other critical content controls, and keep a visible exit. Enter/exit and Escape must work with keyboard focus restored appropriately. Do not enter the native browser Fullscreen API, change the current pathname or `view` query, or alter the interpretation of dates or authorization. Test route depths, variants, keyboard, and transitions alongside the behavior.

### VR-2 — Approved visual-world rollout across home and timeline (in progress)

Apply Cartografía de recuerdos across root tokens, welcome, navigation, immersive timeline, editorial timeline, and concentration mode. Preserve current routes, both exploration modes, temporal controls, privacy, and real precision. Acceptance: the surfaces share one light wayfinding palette and route-marker grammar; mobile, keyboard, loading/error/empty states, and reduced motion remain usable; root build output retains the visual contract. Record `DESIGN.md` at finish from the shipped implementation.

### VR-3 — Task-first Settings under the approved world (in progress)

Keep the recent photo-classification redesign and present common tasks first: review photos without dates, inspect archive state, add a selected folder, and verify Drive access. Progressive disclosure may collapse secondary folder setup only when a source exists. Preserve every confirmation, folder scope warning, Drive read-only boundary, authorization behavior, and existing date semantics. Acceptance: task entry points are visible, keyboard-operable, and reveal the intended existing task without changing API behavior.

## Review workload and delivery

The visual identity and settings IA share one surface rollout; authored-line count and review risk will be recorded after the diff is complete. The 400-line advisory is not a reason to compress tests or code. No TDD configuration is explicitly known, so use ordinary functional checks: `pnpm --filter @linea-de-vida/web test`, `pnpm --filter @linea-de-vida/web typecheck`, `pnpm --filter @linea-de-vida/web lint`, `pnpm --filter @linea-de-vida/web build`, and `pnpm format:check`. Format edited source before verification. Record actual outcomes and counts here.

## VR-1 evidence and status

- Status: implemented and verified locally. A shared timeline layout provider keeps focus mode across nested route changes; entering hides only peripheral shell controls, leaving the timeline and a visible exit in place. Escape defers to the photo dialog.
- Focused test: `timeline-shell.effects.spec.tsx` — 12 passed, including both variants at panorama/year/month/unknown-month depths, persistent nested navigation, Escape, and focus restoration. Runtime harness: N/A (no browser runtime harness exercised in this unit); jsdom component integration covers UI transitions, but visual behavior in a real browser remains unverified.
- Checks: `pnpm --filter @linea-de-vida/web test` — 9 files, 43 tests passed; `pnpm --filter @linea-de-vida/web typecheck` — passed; `pnpm --filter @linea-de-vida/web lint` — passed; `pnpm format:check` — passed (100 files). `node C:\Users\acpal\.agents\skills\impeccable\scripts\detect.mjs --json` on changed UI targets — `[]` (no mechanical findings). Initial `pnpm exec prettier --write` could not run because Prettier is not installed; formatted with the repository's `pnpm exec oxfmt` instead.
- Rollback boundary: VR-1 route-shell behavior, scoped CSS, and associated tests; VR-2/VR-3 remain untouched.
- Work-unit commit: `2d20383e1b21b4a00c59f168a7a900bf5f844492` (`feat(timeline): add in-app concentration mode`); 271 additions and 21 deletions, below the 400-line advisory. The ledger status is recorded in a separate docs-only commit after the behavior commit.
- Engram mirror topic: `odd/visual-refresh/tasks`; pre-source-write mirror and readback succeeded. Final status mirrored and read back after the work-unit commit.
