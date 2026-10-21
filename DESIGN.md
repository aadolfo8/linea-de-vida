# Cielo nocturno — the timeline design

This document describes the timeline as shipped, from the code in `apps/web/app/components`. Organizar and Ajustes are out of scope and keep their survey-paper look (see [Out of scope](#out-of-scope)).

## Purpose

Travel a private photo archive by date, as a dark sky you fly through. Every period is a constellation of its own photos; going deeper is a zoom into a group, going up is a zoom out. Nothing claims more than the archive knows: dates keep their real precision (`YEAR`, `MONTH`, `DAY`, `UNKNOWN`) and uncertain groups are named as such ("Sin mes", "Día sin concretar").

## The three depths

| Depth | Route                                        | What you see                                                                                                                     |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Years | `/timeline`                                  | One constellation per year (outline numeral, photo count, months with photos), oldest to newest, joined by a thread.             |
| Year  | `/timeline/[year]`                           | Large year header, then one constellation per month with photos plus a "Sin mes" group for `YEAR`-precision photos.              |
| Month | `/timeline/[year]/[month]` and `.../sin-mes` | Every photo of the period, paged while travelling, grouped by day with a "Día sin concretar" group for `MONTH`-precision photos. |

**Travel.** Pressing a constellation zooms into it (`useTravel`): the world scales away from the pressed point, the stars streak outward, then the router navigates. The next depth mounts inside the same stage (the shell lives in `timeline/layout.tsx`) and plays the matching entry zoom (`useTravelEntry`).

- Going up (breadcrumb, back button, `Esc`, trackpad pinch-out) lands the next depth on the group you came from (`landKey`) and zooms out onto it.
- Browser back/forward carry no travel; it is inferred from the depth change.
- The pending travel lives in a module store so the depth that unmounts can hand it to the one that mounts, and it is consumed once.
- Months with no photos are not destinations: the month depth sends you back up to the year.

**Orientation.** Vertical or horizontal, persisted per browser (`ldv-sky-orientation` in `localStorage`). Wheel, trackpad, touch, arrow keys and the rail drive the same inertial track in both.

## Tokens

Defined on `.sky` / `.sky-scope` in `sky/sky.css` and mirrored in `globals.css` `@theme` (`--color-sky-*`). They are scoped: nothing outside the timeline reads them.

### Colour

| Token          | Value                   | Role                                                        |
| -------------- | ----------------------- | ----------------------------------------------------------- |
| `--sky-ink`    | `#05070d`               | The sky: page, stage and canvas background.                 |
| `--sky-ink-2`  | `#0b0f1a`               | Raised chrome: pills, menu panel, return card.              |
| `--sky-tile`   | `#0e1424`               | Placeholder behind a photo while it loads.                  |
| `--sky-fg`     | `#e8ecf4`               | Primary text and the pressed state of controls.             |
| `--sky-mute`   | `#8790a4`               | Secondary text: counts, labels, inactive rail entries.      |
| `--sky-accent` | `#cfe0ff`               | The one accent: current location, nodes, focus ring, hover. |
| `--sky-glow`   | `rgba(190,210,255,.55)` | Glow of nodes, star points and the active rail diamond.     |
| `--sky-line`   | `rgba(196,212,255,.16)` | Hairlines and control borders.                              |

Photos are shown unfiltered. The viewer is the one place that goes to pure black, tinted by the blurred photo itself (ambient backdrop).

### Type

Loaded with `next/font/google` in `timeline/layout.tsx`.

| Token           | Face         | Role                                                                           |
| --------------- | ------------ | ------------------------------------------------------------------------------ |
| `--sky-display` | Bodoni Moda  | Brand, outline year numerals, month titles, the viewer's date. Editorial.      |
| `--sky-mono`    | Martian Mono | Labels: breadcrumb, counts, rail, chips, zoom level. Uppercase, wide tracking. |
| `--sky-ui`      | Figtree      | Controls, menu, notices, prose.                                                |

### Other

- `--sky-bar-h`: height of the fixed top bar (`60px` plus the safe-area inset). The vertical track reserves it as `padding-top`, so headers and the first group start below the bar.
- `--sky-ease`: `cubic-bezier(0.22, 1, 0.36, 1)`, the one easing used for settling motion.
- Hit areas: every `a` and `button` under `.sky` keeps a 44x44 minimum, even when the glyph is smaller.

## Components

All in `components/sky/` unless noted.

- **Stage** (`SkyStage`, `sky-engine.ts`): one sticky, full-viewport stage with a starfield canvas behind a `world` that holds a `track`. Native scroll is converted into an eased track position (`SMOOTHING 0.1`), vertical or horizontal. Items register their measured offsets (`useSkyItem`); depths subscribe per frame (`useSkyFrame`) or after re-measure (`useSkyMeasure`). Chrome that must not travel renders through the overlay layer (`SkyOverlay`).
- **Starfield** (`starfield.ts`): stars with parallax depth, twinkle and warp streaks, seeded so the sky is stable.
- **Constellation** (`Constellation`, `constellation-layout.ts`, `mosaic.ts`): the period's preview photos in a tight treemap mosaic of varied shapes, with numeral or month title, counts, "+N más" and a CTA. Tiles start as star points and grow into photos as they approach the leading edge. A cluster is a real link (plain click travels, modified clicks are left to the browser).
- **Thread** (`SkyThread`): one path through every group's node; it draws itself as you travel. Undated groups get a hollow node.
- **Period header** (`PeriodHeader`): the large outline numeral or "Agosto 2004" title that leads a deeper list.
- **Rail** (`SkyRail`): jump list for years, months or days; vertical at the right edge, horizontal at the bottom. Empty periods stay visible but disabled. The current entry follows the track.
- **Chrome** (`SkyChrome`, `ArchiveNav` with `variant="sky"`): one top bar. Left: brand, back button and breadcrumb. Right: one control cluster with the archive menu, "Concentrar vista" and the orientation switch. See [Responsive chrome](#responsive-chrome).
- **Month masonry** (`MonthDepth`, `month-layout.ts`, `masonry.ts`): shortest-lane placement with the photos' real aspect ratios (columns when vertical, rows when horizontal), day sections with headings, keyset paging of 60 photos while the track nears the end, and a tail that shows loading or a retry.
- **Viewer** (`TimelinePhotoViewer`, `viewer-zoom.ts`): see [Viewer](#viewer).
- **Gate** (`ProtectedSurface tone="sky"`): the session check renders in the sky palette, so the timeline never flashes light.

### Responsive chrome

- The bar is a single row at every width and never overlaps content: it is fixed, `--sky-bar-h` tall, with a fade from the sky colour.
- Below 1360px the archive links, session and sign-out collapse behind one menu button (`aria-expanded`, `aria-controls`). `Esc` closes it from anywhere and returns focus to the button; an outside tap or a navigation also closes it.
- Below 1360px "Concentrar vista" and the orientation buttons are icon-only; their names stay available to assistive technology. Below 640px only the back button and the current period remain in the breadcrumb; below 480px the brand text is hidden (the menu still has "Cronología").
- On narrow vertical travel the rail is a slim edge column (labels hidden, 44px wide). Content keeps a matching right gutter (`SMALL_GUTTER` 16px left, `SMALL_RAIL` 44px right in the layout code), so the rail never covers a photo.

### Viewer

- Opens from a tile: the photo grows out of the tile's rectangle and shrinks back to it on close (the sky behind follows the photo being shown, without animation, so the shrink lands on a real tile).
- The photo fits the band between the bottom of the top meta block (date and precision chip) and the top of the filmstrip, measured from the real layout (`stageBox`, `fitSize`); the zoom and pan maths run on that band.
- Wheel, pinch and double click/tap zoom around the pointer (1x to 6x); drag pans while zoomed; swipe or arrows change photo (no wrap); a swipe down dismisses. Keys: `+`, `-`, `0`, arrows (pan when zoomed), `Esc` (resets zoom first, then closes).
- Thumbnail first, then the original on top; if the original fails the thumbnail stays with a notice; HEIC/HEIF show a preview with a download link. Neighbours are preloaded.
- The chrome fades after 2.6 s of stillness, never from under keyboard use. Focus is trapped while open and restored to the tile on close.

## Motion rules

- Motion explains position: zoom in when going deeper, zoom out when going up, a star point growing into a photo when it enters. It is never decoration on its own.
- One easing (`--sky-ease`); travel exit 420-480 ms, entry 620 ms, warp 1 s, viewer grow 520 ms and shrink 380 ms.
- Input stays responsive: a second travel is ignored while one is leaving; if the navigation never lands, the world is given back after 3.5 s.
- The track is transformed with `translate3d` and measured from `offsetLeft`/`offsetTop`, never from transformed rectangles.

### Reduced motion

With `prefers-reduced-motion` (read through `useReducedMotion`):

- Travel navigates immediately: no exit zoom, no warp, and the entry only lands (focus moves to the current breadcrumb) without animating or hiding the world.
- The track follows scroll without easing; jumps are instant.
- Tiles show as photos at once (no star-to-photo growth), labels are visible, the thread is drawn in full, the starfield redraws only when something changes, CSS transitions are off.
- The viewer opens and closes without the grow/shrink flight.

## Accessibility

- Landmarks and names: one `main` (`#timeline-main`) with a skip link, a breadcrumb `nav` with `aria-current="location"`, a labelled back button, a labelled rail `nav`, a polite live region announcing the depth ("Año 2004", "Agosto de 2004").
- After travelling, focus moves to the current breadcrumb entry; closing the viewer restores focus to the tile that opened it.
- Keyboard: every control is a real link or button; `Esc` closes the topmost layer in order: menu, viewer (zoom first), concentration mode, then one depth up.
- 44px minimum targets, visible `:focus-visible` rings in the accent colour.
- Dialog: the viewer is `role="dialog"` with `aria-modal`, traps focus and marks the page behind it inert.
- Concentration mode ("Concentrar vista") hides the archive menu, turns the toggle into one exit button ("Salir del modo concentración", focused on entry) and survives route changes; the orientation switch stays.
- Colour is never the only signal: the current rail entry also grows its diamond, undated groups use a hollow node and a label.

## Privacy and data

Media is requested only through the session-guarded API proxy, with `width=640|1280` thumbnail variants and the original only in the viewer. The timeline is read-only: it never changes Drive. Cached archive data is invalidated on the archive-index update event.

## Out of scope

- Organizar and Ajustes keep the survey-paper theme (`--color-map-*`: ink `#0c2935`, paper `#f1efe8`, route `#1d7780`, active `#e96b4d`). Restyling them is a follow-up.
- Light theme for the timeline: the sky is always dark (`color-scheme: dark`).
- No new data claims: no face, place or content recognition, and no dates inferred beyond what the archive stores.
