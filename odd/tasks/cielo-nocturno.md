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
- [ ] **CN-2 — Sky foundation.** Night-sky tokens and fonts scoped to the timeline, sky stage engine (starfield canvas, inertial sticky track, orientation toggle), treemap mosaic and masonry lane utilities with unit tests, breadcrumb/back/rail chrome, zoom travel transition helper. Route: delegated writer.
- [ ] **CN-3 — Years and year depths.** Years and months constellations on real data (lazy year summaries, month previews), thread, rail, travel between depths through the real routes. Route: delegated writer.
- [ ] **CN-4 — Month depth.** All photos of a month or "sin mes", keyset paging while travelling, day groups, masonry in both orientations, day rail. Route: delegated writer.
- [ ] **CN-5 — Viewer.** Zoom/pan/pinch/double-click, swipe, filmstrip, ambient backdrop, grow-from-tile, keeping the existing viewer contract (focus trap, HEIC, original fallback, no wrap, loadMore). Route: delegated writer.
- [ ] **CN-6 — Cleanup and finish.** Remove obsolete timeline components and styles, update specs, document the design (DESIGN.md), run all checks. Route: delegated writer.

## Delivery

Forecast: about 3,000 authored changed lines across six work-unit commits, above the 400-line advisory. Strategy: `ask-on-risk`; the chain strategy will be asked once before any pull request is planned. Push and PR remain the user's decision.

## Progress

- Base: `4e25514` (pending cache/continuous-loading work committed on `feat/calidad-fotos-cronologia` at the user's request); branch `feat/cielo-nocturno` created from it.
- Engram mirror: `odd/cielo-nocturno/tasks`.
- CN-1 done in `7bb2e12` (`feat(api): expose month previews for a timeline year`; 256 lines). Single-pass SQL (`NTILE(6)` partitioned by month + `DISTINCT ON`). Checks: api test 196 passed (5 new, mocked Prisma), typecheck/lint/format clean. Parent ran the exact SQL on a throwaway PostgreSQL 14 container: 13 groups × 6 previews, counts summing to all 230 seeded photos, no foreign or MISSING rows. Review assessment: medium, `under_budget` (boundary stays at `4e25514`).

## Next step

CN-2.
