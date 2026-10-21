# Cielo nocturno — ODD task ledger

## Objective

Replace the timeline experience with the approved "Cielo nocturno" direction: a dark, cinematic sky where the archive is travelled in three depths that zoom into each other, plus a new photo viewer with real zoom.

## Problem and why

The user finds the current timeline ugly, slow to move through, and the viewer poor (no zoom). After two clickable prototype rounds the user chose "Cielo nocturno" and asked to implement it now. Approved reference prototype (v2): https://claude.ai/artifact/GrrraSdgJ1ez5X5UnsT67G (local copy used by writers: the session scratchpad `proto/index.html`).

## Approved behaviour

1. **Years** (`/timeline`): every year is a constellation: a tight treemap mosaic of ~8 preview photos with varied shapes, outline year numeral, total photos and months with photos. A thin thread joins the years and draws as you travel. Tiles reveal from a star point into the photo as they enter.
2. **Year** (`/timeline/[year]`): zoom-in transition; large year header, then one constellation per month with photos (preview mosaic + count), plus a "Sin mes" group for `YEAR`-precision photos.
3. **Month** (`/timeline/[year]/[month]` and `/timeline/[year]/sin-mes`): every photo of the period, paged while travelling, grouped by day with a "Día sin concretar" group for `MONTH`-precision photos; masonry lanes with real aspect ratios.
4. Navigation: breadcrumb (Años / 2004 / Agosto), back button, Escape and trackpad pinch-out go up one depth; leaving lands the zoom on the group you came from. A side rail (bottom rail when horizontal) jumps to years, months, or days.
5. Orientation: vertical or horizontal travel, persisted per browser; wheel/trackpad/touch drive the same inertial track.
6. Viewer: grows from the tile, ambient blurred backdrop, wheel/pinch/double-click zoom around the pointer, pan when zoomed, swipe/arrows to change, filmstrip, thumbnail-first then original, neighbour preloading, idle chrome.

## Constraints

- Preserve privacy (media only through the session-guarded API proxy; `width=640|1280` variants only), per-user authorization, date precision (`YEAR`, `MONTH`, `DAY`, `UNKNOWN`) and honest labels, canonical routes and `returnTo`/`returnLabel`, the archive-index cache invalidation, accessibility (keyboard, focus trap/restore, 44px targets, reduced motion, aria-live), and the concentration mode.
- Drive stays read-only; no new data claims. Organizar and Ajustes restyling is out of scope for this feature (follow-up).
- Generated artifacts in English; UI copy in Spanish.

## Checks

TDD mode: not configured (source: no project/session setting) — ordinary functional checks. Runners: `pnpm --filter @linea-de-vida/web test|typecheck|lint|build`, `pnpm --filter @linea-de-vida/api test|typecheck|lint`, `pnpm format:check`.

## Tasks

- [x] **CN-1 — Month previews API.** `GET /v1/timeline/years/:year/month-previews` returning, per month with photos and for the unknown-month group, `{ month | null, kind, label, photoCount, previews }` with up to 6 previews spread across the period, owner-scoped. Tests in `apps/api/test`. Route: delegated writer (API controller + service + tests).
- [x] **CN-2 — Sky foundation.** Night-sky tokens and fonts scoped to the timeline, sky stage engine (starfield canvas, inertial sticky track, orientation toggle), treemap mosaic and masonry lane utilities with unit tests, breadcrumb/back/rail chrome, zoom travel transition helper. Route: delegated writer.
- [x] **CN-3 — Years and year depths.** Years and months constellations on real data (lazy year summaries, month previews), thread, rail, travel between depths through the real routes. Route: delegated writer.
- [x] **CN-4 — Month depth.** All photos of a month or "sin mes", keyset paging while travelling, day groups, masonry in both orientations, day rail. Route: delegated writer.
- [x] **CN-5 — Viewer.** Zoom/pan/pinch/double-click, swipe, filmstrip, ambient backdrop, grow-from-tile, keeping the existing viewer contract (focus trap, HEIC, original fallback, no wrap, loadMore). Route: delegated writer.
- [x] **CN-6 — Cleanup and finish.** Remove obsolete timeline components and styles, update specs, document the design (DESIGN.md), run all checks. Route: delegated writer.

## Delivery

Forecast: about 3,000 authored changed lines across six work-unit commits, above the 400-line advisory. Strategy: `ask-on-risk`; the chain strategy will be asked once before any pull request is planned. Push and PR remain the user's decision.

## Progress

- Base: `4e25514` (pending cache/continuous-loading work committed on `feat/calidad-fotos-cronologia` at the user's request); branch `feat/cielo-nocturno` created from it.
- Engram mirror: `odd/cielo-nocturno/tasks`.
- CN-1 done in `7bb2e12` (`feat(api): expose month previews for a timeline year`; 256 lines). Single-pass SQL (`NTILE(6)` partitioned by month + `DISTINCT ON`). Checks: api test 196 passed (5 new, mocked Prisma), typecheck/lint/format clean. Parent ran the exact SQL on a throwaway PostgreSQL 14 container: 13 groups × 6 previews, counts summing to all 230 seeded photos, no foreign or MISSING rows. Review assessment: medium, `under_budget` (boundary stays at `4e25514`).

- Review: STATUS preflight on the whole branch (base `fb25802`, 4260 lines) and later on the slice from `4e25514` (4837 lines) both ended in the terminal stop `lens_context_budget_exceeded` after the user granted consent; no review authority was created. Reviewing requires smaller per-commit candidates; deferred to feature close.
- CN-2 done in `3da79c1` (`feat(timeline): add night sky stage and layout primitives`; +2147/-1) and CN-3 in `d4d767a` (`feat(timeline): travel years and months as constellations`; +2297/-153), one delegated writer. Writer checks at `d4d767a`: web test 25 files/150 passed, typecheck, lint, build, format clean; parent re-ran web test: 150 passed. Parent visual QA with a local mock API and headless Edge (1440×900): years and year depths render as approved (mosaic, counts, "+N más", rail, breadcrumb, thread). Follow-ups noted for CN-6: three stacked controls at top-right (nav, "Concentrar vista", orientation) feel crowded; `ProtectedSurface` loading is still light (flash); no direct tests for `useTravel`/`useTravelEntry`/`SkyThread`.
- Design choices: years read oldest → newest; `TimelineRoute` now lives in `timeline/layout.tsx` so the stage persists across depths; pending travel kept in a module store.

- CN-4 done in `292919b` (`feat(timeline): travel every photo of a month`; +1566/-84) and CN-5 in `10c5e91` (`feat(timeline): zoom and travel photos in the viewer`; +1882/-368), one delegated writer. Writer checks at `10c5e91`: web test 28 files/215 passed, typecheck, lint, build, format clean. A third review STATUS/START on the whole branch was refused with `stale_target_identity` because CN-4 landed while consent was being answered; no authority created.
- Parent visual QA (CDP-driven headless Edge + mock API): month depth paged to 120 tiles, viewer opened from a tile, wheel zoom reached 294%, Escape reset zoom then closed; horizontal years and month render well. Defects found: (1) at 390px the top chrome (ArchiveNav, "Concentrar vista", orientation) overlaps headers and content and the rail covers photos; (2) the viewer image overlaps the date/precision meta; (3) desktop top-right controls stacked in three rows.

- CN-6 done in `3c12334` (responsive sky bar with collapsible menu, slim rail with content gutter, viewer fit between meta and filmstrip, dark loading, viewer↔sky follow), `f0bd6a0` (legacy timeline, Embla and dead helpers removed; travel and thread tests) and `bbfeade` (`DESIGN.md`, README).
- Review: on the user's instruction gentle-ai review was dropped and disabled for this clone (`gentle-ai review mode disable --scope clone`); the parent ran its own code review of `4e25514..HEAD` (high effort). Ten findings, all fixed with regression tests in `63c0742` (browser zoom kept, pinch-out detector; viewer paging end), `8aa2ab2` (idle render loop, keyed lookups) and `a0fbd5f` (orientation keeps position, previews refetch after invalidation, per-trip exit guard, paging never stalls, back/forward landing wins over saved position, shared helpers, short-year slim rail). Parent QA after the fixes: tiles still reveal with the idle loop, a 160-photo month pages to the end, orientation switch keeps 50% progress; bar veiled over travelling photos in `d53dd3b`.
- Final checks (parent): web test 31 files/266 passed, api test 18 files/196 passed, format clean; writer: typecheck, lint, build clean.
- Not verified: the new SQL against the real project database with real photos; real Google Drive media; touch gestures on a physical phone.

## Next step

Feature complete on `feat/cielo-nocturno` (not pushed). Pending user decisions: push/PR and the chain strategy (the branch also carries earlier unmerged work since `fb25802`); follow-up phase restyles Organizar and Ajustes in the same world.
