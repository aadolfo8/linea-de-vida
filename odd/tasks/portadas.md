# Portadas — ODD task ledger

## Objective

A new **Portadas** section, styled like Ordenar, where the user chooses which photos make up the cover of each year (years depth constellation) and of each month and the "Sin mes" group (year depth constellations), in the order they choose.

## Problem and why

Covers are picked automatically today: `GET /v1/timeline/years/:year` takes the newest photo of each of 8 `NTILE` buckets (`app.controller.ts:1142-1206`) and `GET /v1/timeline/years/:year/month-previews` takes 6 per month with `NTILE(6)` (`app.controller.ts:1311-1365`). Once a year is fully dated the user wants to curate what represents it.

## Decisions (user, 2026-10-22)

- **Fill mode A**: chosen photos come first, in the chosen order; remaining slots are auto-filled with the current NTILE picks (excluding already chosen photos). Covers always look full.
- Defaults accepted by the user: max **8 per year, 6 per month** (as today); year and month covers are independent (a photo may be in both); "Sin mes" group has its own cover; order matters (it drives the mosaic); a cover photo that is later hidden, not `ACTIVE`, or re-dated out of the scope silently drops out at read time (auto-fill covers it) and Portadas flags the missing slot; the server stores only photo references, never images.

## Constraints

Per-user authorization on every query; mutations behind `SessionGuard` + `CsrfGuard`; foreign ids reported as `NOT_FOUND`; Drive read-only; honest precision (a `YEAR`-precision photo is eligible for the year cover and "Sin mes", never for a month); accessibility (keyboard, focus, 44px, reduced motion, aria-live); night-sky tokens from `DESIGN.md`. Generated artifacts in English, UI copy in Spanish.

## Checks

TDD not configured: ordinary functional checks. `pnpm --filter @linea-de-vida/api test|typecheck|lint`, `pnpm --filter @linea-de-vida/web test|typecheck|lint|build`, committed-content `oxfmt --check` (via `git -c core.autocrlf=false archive`). RDD: off (clone-local).

Delivery: forecast ~1000–1400 authored lines in 3 tasks on `feat/portadas`; the user merges straight to `main` (as with the previous feature).

## Tasks

- [x] **PO-1 — Cover data and API.** `PhotoCover` model + migration (scope kind YEAR / MONTH / UNKNOWN_MONTH, year, month, photoId, position; per-user; cascade on photo/user delete); `GET /v1/covers?year=`, `PUT /v1/covers` (replace one scope's ordered set, validated), `DELETE /v1/covers` (back to automatic); `/timeline/years/:year` and `/month-previews` use chosen covers first plus NTILE fill. Tests. Route: delegated writer.
- [x] **PO-2 — Portadas screen.** `/portadas` route, nav entry, year → month/"Sin mes" navigator, candidate grid with ordered numbered selection, live constellation preview, save / reset to automatic, missing-slot notice, `notifyArchiveIndexUpdated` after saving. Tests. Route: delegated writer.
- [x] **PO-3 — Docs.** Technical reference (endpoints, fill rule), `DESIGN.md` (Portadas surface), README feature table. Route: delegated writer.

## Progress

- 2026-10-22: exploration done; fill mode A chosen; feature document created.
- 2026-10-22: PO-1 7eb9c2b (PhotoCover + migration 20261022100000_photo_covers, /v1/covers GET/PUT/DELETE, year summary and month-previews put valid chosen covers first and fill the rest), PO-2 a751d93 (/portadas screen, nav entry, mini-mosaic preview, ordered selection with earlier/later buttons, save / back to automatic, unsaved-changes guard, dropped-photo notice), PO-3 9d6c141 (docs). Deviations accepted: year `<select>` instead of a year list; preview is a mosaic() mini preview, approximate for the auto-filled part; reordering by buttons, not drag.
- Checks: api 395 passed / 5 skipped, typecheck, lint ok; web 46 files / 426 passed, typecheck, lint, build ok (writer); parent spot check: covers + month-previews specs 21 passed, portadas spec 19 passed; parent read-through of the migration and raw SQL found no issue. NOT verified: migration and raw SQL against a real PostgreSQL (Docker Desktop not running; integration spec skipped).

## Next step

User runs `pnpm --filter @linea-de-vida/api prisma:deploy` against the local DB and tries /portadas; then merge to main.
