# Sky mobile polish — ODD task ledger

## Objective

Fix four issues the user reported in the sky (years / year / month depths), mostly on mobile.

## Problem and why (user, 2026-10-23)

1. On mobile, in horizontal orientation, the years still crowd together.
2. On mobile, horizontal travel does not respond to a horizontal finger swipe; the user must swipe vertically to move sideways, which feels odd.
3. Year and month covers (constellation mosaics) crop most photos so they look wrong, and the whole layout feels too square/grid-like; the user wants something more "disordered" (organic, scattered).
4. On first load the photos of the first visible year do not appear until the user scrolls a little; they must appear without scrolling.

## Constraints

Accessibility (keyboard, focus, 44px targets, reduced motion), night-sky tokens from `DESIGN.md`, existing load queue and engine contracts. Generated artifacts in English, UI copy in Spanish.

## Checks

TDD not configured: ordinary functional checks. `pnpm --filter @linea-de-vida/web test|typecheck|lint|build`, committed-content `oxfmt --check`. RDD: off (clone-local).

Delivery: branch `fix/sky-mobile-polish`; the user merges to `main`.

## Tasks

- [x] **SM-1 — First year photos load without scrolling.** Route: delegated writer (single writer, mapping trigger evidence: 10+ sky files).
- [x] **SM-2 — Horizontal swipe travels on touch.** Route: delegated writer (single writer, mapping trigger evidence: 10+ sky files).
- [x] **SM-3 — Years do not crowd on mobile horizontal.** Route: delegated writer (single writer, mapping trigger evidence: 10+ sky files).
- [x] **SM-4 — Covers keep photo aspect and look scattered, less square.** Route: delegated writer (single writer, mapping trigger evidence: 10+ sky files).

## Progress

- 2026-10-23: feature document created.
- SM-1 e3866ca: root cause, the frame loop sleeps at rest and nothing woke it when a group's previews arrived, so tiles stayed stars until a scroll; Constellation now wakes the engine when its cells change.
- SM-2 dc3969f: engine touch handling; a predominantly horizontal swipe travels the track (preventDefault, drag via jumpTo) with decaying momentum on release (none under reduced motion); vertical swipes and taps untouched.
- SM-3 a75f290: sideways gap between groups now follows group size and a 170px floor on compact screens (width < 640 or height < 500).
- SM-4 (this commit): `mosaic` is now a scattered collage (real aspect ratios, varied sizes, 1-5.5 deg tilts, small overlaps, lead photo on top, deterministic); used by Constellation and the Portadas preview.

## Next step

Merged to main on 2026-10-23; user checks touch feel and the collage on a real phone.
