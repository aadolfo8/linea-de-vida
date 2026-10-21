# Ordenar sencillo — ODD task ledger

## Objective

Replace "Organizar" and "Ajustes" with two simple screens in the night-sky world: **Ordenar** (put dates on photos, photo-first, with the Drive folder structure as a navigable tree) and **Ajustes** (where photos come from, account, privacy). Approved reference prototype: https://claude.ai/artifact/8tZ1jZdtBiuvBdpQfMSHMZ (local copy: session scratchpad `proto/ordenar.html`).

## Problem and why

The current Organizar is one long page with eight stacked blocks, ~45 controls, six inline confirmations and up to five names per concept; the user, who built it, cannot use it. Folder dates silently do not change photos with camera dates unless a third, confusing scope is chosen; manual dates cannot be removed from the UI; adding a folder means pasting an ID. The user's Drive folders are "all mixed", so the work is mostly photo by photo or in batches.

## Decisions

- Google Photos: since 31 Mar 2025 third-party apps cannot read a user's whole library. Chosen path: **manual Google Takeout** extracted into a Drive folder. Re-importing a new export into the same source must **not duplicate** photos and must add only new ones.
- Photo identity becomes content-based: Drive `md5Checksum` + size, per user, across sources. A photo stays in the archive while at least one of its Drive copies exists; manual dates, hidden state and folder membership survive re-exports.
- Drive folders keep their real structure: Ordenar shows a nested, expandable folder tree with per-subtree counts and a breadcrumb; a folder date can include its subfolders.
- Folder picking stays server-side (paste the folder link, then preview name, subfolders and whether it looks like a Takeout export); the browser never receives Google tokens, so Google Picker is out of scope. Takeout is detected automatically when possible.
- "Ocultar" becomes a reversible soft hide with immediate restore (no waiting for the next sync).
- Confirmations are replaced by undo where the action is reversible.

## Approved behaviour

1. **Ordenar**: piles _Sin fecha_, _Solo el año_, _Con fecha_, _Ocultas_ with counts; the folder tree (nested, expandable, counts of photos still to date per subtree) as a filter; a photo grid with click / shift-click / select all; a floating bar _Poner fecha · Quitar fecha · Ocultar/Volver a mostrar_; a date sheet (year field ± and decade chips, month chips, "No sé el mes", optional day); folder date with "incluir subcarpetas" and "cambiar también las que traen fecha de cámara"; filename-date suggestions (WhatsApp/phone names); "Fechar una a una" keyboard quick mode; undo toast; large peek.
2. **Ajustes**: one card per source (Exportación de Google Fotos / Carpeta de Drive) with state, counts, "Buscar fotos nuevas", "Quitar"; "Añadir fotos" in two steps; account (Drive connection, disconnect, sign out); privacy promises.
3. Unified vocabulary: _carpeta_, _Buscar fotos nuevas_, _Ocultar / Volver a mostrar_, _Poner fecha / Quitar fecha_, _Sin fecha_.

## Constraints

Drive read-only; only explicitly chosen folders; no tokens in the browser; per-user authorization; honest date precision (`YEAR`, `MONTH`, `DAY`, `UNKNOWN`); manual date always wins; accessibility (keyboard, focus, 44px, reduced motion, aria-live); night-sky tokens from `DESIGN.md`. Generated artifacts in English, UI copy in Spanish.

## Checks

TDD not configured (no project/session setting): ordinary functional checks. `pnpm --filter @linea-de-vida/api test|typecheck|lint`, `pnpm --filter @linea-de-vida/web test|typecheck|lint|build`, committed-content format check (`git -c core.autocrlf=false archive HEAD` + `oxfmt --check`), browser QA with the scratchpad mock API.

## Tasks

- [ ] **OS-1 — Content identity and re-import without duplicates (API).** Request `md5Checksum,size` from Drive; store them; one photo can have several Drive copies (new relation); sync attaches a new copy to the existing photo instead of creating a duplicate; reconciliation marks a photo missing only when all its copies are gone; Prisma migration and backfill strategy for existing rows; tests (re-export into the same source, export in a second source, old export deleted). Route: delegated writer.
- [ ] **OS-2 — Ordering API.** Filename dates (WhatsApp/phone/screenshot patterns) below camera/Takeout and above folder names; soft hide with instant restore; batch set/clear of dates without the visible 50 limit (chunked server-side); folder date = include-subfolders + override-camera flags mapped onto the existing scopes; endpoints for piles counts, folder tree with per-subtree counts, photos by pile and folder subtree (cursor); suggestions endpoint. Route: delegated writer.
- [ ] **OS-3 — Ordenar screen (web).** Route, piles, folder tree, grid/selection, action bar, date sheet, undo, suggestions, quick mode, peek; night-sky styling; tests. Route: delegated writer.
- [ ] **OS-4 — Ajustes screen (web).** Source cards, add-photos wizard (paste link + preview + Takeout detection), sync progress, account, privacy; navigation rename (Cronología / Ordenar / Ajustes); tests. Route: delegated writer.
- [ ] **OS-5 — Cleanup and finish.** Remove `ArchiveWorkspace` and dead code/styles/specs, keep `/organizar` and `/settings` redirects, docs (README, DESIGN.md), code review, browser QA. Route: delegated writer + parent review.

## Delivery

Forecast: about 4,000 authored changed lines. The user previously chose direct delivery to `main` (which deploys to production); confirm before pushing.

## Progress

- Branch `feat/ordenar-sencillo` from `main` @ `d178342`.
- Engram mirror: `odd/ordenar-sencillo/tasks`.

## Next step

OS-1 and OS-2 (one API writer, separate commits).
