# Usabilidad táctil — ODD task ledger

## Objective

Make the timeline feel right on touch screens (a home touchscreen and phones): responsive scroll and taps, reliable entry into a year, visible loading states, much faster photo loading when jumping far down the years, and readable folder names in Ordenar.

## Problem and why

- Touch scroll feels floaty: native momentum is smoothed again by a per-frame lerp (`sky-engine.ts:356`), mobile browser chrome resizes rebuild the whole sky mid-scroll, the "Entrar en →" CTA is hover-only, rail targets are ~24px and no `touch-action` is set.
- Tapping a year sometimes does not enter it: taps during the lerp tail are eaten as scroll, gaps inside a group are not tappable, the 3.5s exit guard cancels slow navigations, and `travelling` can stay stuck without `try/finally` (`use-travel.ts`).
- No skeleton: only a "Cargando años…" text line.
- Reaching 2022 from 2009 is very slow: each thumbnail downloads the full Drive original and resizes it (`media-proxy.service.ts:150-215`), `Cache-Control: max-age=60`, and every year passed queues its 8 previews on the browser's 6 connections with no cancellation or priority.
- Ordenar folder names are cut with an ellipsis (`ordenar.css:143`).

## Decisions

- **No persistent thumbnail cache** (user decision, 2026-10-22): keep the documented promise that the server stores no images. Instead: use Drive's own small thumbnail for the small width, longer private browser caching, and smarter client request scheduling. A disk cache stays a possible later extension if this is not enough.

## Constraints

Drive read-only; no tokens or Drive URLs in the browser; per-user authorization of media; honest date precision; accessibility (keyboard, focus, 44px targets, reduced motion); night-sky tokens from `DESIGN.md`. Generated artifacts in English, UI copy in Spanish. Desktop behaviour must keep working as today.

## Checks

TDD not configured (no project/session setting): ordinary functional checks. `pnpm --filter @linea-de-vida/web test|typecheck|lint`, `pnpm --filter @linea-de-vida/api test|typecheck|lint` when the API changes, `pnpm format:check`. RDD: off (clone-local), no native review.

Delivery strategy: `ask-on-risk`. Forecast ~600–900 authored changed lines across 5 tasks; branch `feat/usabilidad-tactil`.

## Tasks

- [ ] **UT-1 — Reliable entry into a year/month.** `try/finally` around travel, reset `travelling`/`busy` on every failure path, tolerant exit guard for slow navigations (keep a visible loading state instead of bouncing back), whole group area tappable. Tests. Route: delegated writer (4+ files).
- [ ] **UT-2 — Touch feel.** Time-based damping and near-direct tracking on coarse pointers, ignore height-only viewport changes from browser chrome, `touch-action: manipulation`, tap highlight, CTA always visible on `(hover: none)`, 44px rail targets. Tests. Route: delegated writer.
- [ ] **UT-3 — Loading skeletons.** Skeleton for the years depth and first year, shimmering `--sky-tile` placeholders until images arrive. Tests. Route: delegated writer.
- [ ] **UT-4 — Faster photos.** API: Drive thumbnail for the small width (fallback to current path), private long-lived cache headers. Web: request previews only when scroll settles near a group, prioritise the group nearest the centre, limit concurrency, sensible `sizes`. Docs updated. Tests. Route: delegated writer.
- [ ] **UT-5 — Folder names in Ordenar.** Two-line clamp and full name on hover/long-press (`title`). Route: inline (one CSS/TSX pair).

## Progress

- 2026-10-22: exploration done, feature document created.

## Next step

UT-1.
