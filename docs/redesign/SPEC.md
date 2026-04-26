# Atlas + Orbit Redesign — Design Spec

> **Status:** Spec only. No code changes yet. See `docs/redesign/BACKLOG-ENTRY.md` for the proposed backlog item, and `docs/redesign/practice-app-reference/` for the working HTML prototype.

---

## What this is

A two-screen redesign of the practice library:

1. **Atlas (home)** — replaces the current sidebar + main split. The library *is* the home screen: a spatial board of song tiles, color-coded by tuning, sized by activity, with filter pills + search.
2. **Orbit (practice view)** — replaces the current timeline strip. The song is rendered as a clock: segments are arcs around a circular timeline, the playhead sweeps like a clock hand, the play button sits at the hub.

Click an Atlas tile to enter Orbit. `Esc` or the back chevron returns to Atlas.

The current toolbar / download drawer / segments / notes / tags / collections all still exist — they're rearranged, not removed.

---

## Why these two metaphors

| Old | New | Why |
|---|---|---|
| Sidebar tree of titles | Atlas tile board | Lets tile size + color carry information (tuning, recency, activity). Library becomes scannable, not a list. |
| Linear timeline strip | Orbit (circular timeline) | Songs are cyclical (we loop them). A circle makes "where in the song are we" a glanceable angle, and gives segments room to breathe with arc thickness. Playhead-as-clock-hand is intuitive. |

---

## Visual system

### Color tokens

```
--bg:        #0a0810        /* page */
--surface:   rgba(255,255,255,0.04)
--surface-2: rgba(255,255,255,0.035)
--border:    rgba(255,255,255,0.08)
--text:      #f5f0e6
--text-dim:  rgba(245,240,230,0.55)
--text-mute: rgba(245,240,230,0.4)
--accent-cta:#fbbf24        /* "Add YouTube" pill */
```

**Tuning palette** (used everywhere a tuning appears — tile borders, chips, Orbit accent, playhead):

```
Drop D       #7c6fff    purple
Drop C / -C  #ef4444    red
E Standard   #06b6d4    cyan
Eb Standard  #22c55e    green
Db Standard  #a855f7    violet
Drop Eb      #f59e0b    amber
default      #94a3b8    slate
```

A song's primary tuning (`tunings[0]`) drives its tile border and, in Orbit, the playhead + play button + center hub color.

### Segment palette

Unchanged from the existing app — the 8-color rotation already in `COLORS` is reused for arcs.

### Type

- **Family:** Inter (already loaded). `ui-monospace` for time codes and the keyboard hint pills.
- **Atlas tile title:** 15/600/-0.01em (down to 12 on small tiles).
- **Atlas tile artist:** 11/400, dim.
- **Orbit song title:** 26/700/-0.02em.
- **Orbit "NOW LOOPING" eyebrow:** 9.5/700/0.22em uppercase, muted.
- **Time codes:** `ui-monospace`, never less than 10.5px.

### Spacing & radii

- Page padding: 28px.
- Tile gap: 8px.
- Tile radius: 14px.
- Card / panel radius: 14–16px.
- Pill radius: 99px.

---

## Atlas — layout

### Top bar (fixed, 22px from top)

- Left: 30px circular logo gradient `#ff6b6b → #ec4899` + "Practice Library" + meta line ("N songs · M tunings · 1h 12m today").
- Right: search pill (280px wide, with ⌘K hint chip) + amber "+ Add YouTube" pill (opens existing download drawer).

### Tuning filter rail (78px from top)

Pills, one per unique tuning across the library, plus "All" first. Active pill: filled with the tuning color, black text. Inactive: dark surface with a 6×6 color dot.

### Tile board

Container: `left/right: 28px; top: 122px; bottom: 64px`.

**Tile packing.** Greedy row layout, not a true treemap:
1. Compute a weight per song: `segWeight × recencyWeight`.
   - `segWeight = min(6, segmentCount + 1)`
   - `recencyWeight`: 2.5 if practiced today, 2 if hours ago, 1.4 if days, else 1
2. Estimated rows: `ceil((H - y) / 150)`.
3. Tiles per row: `ceil(remaining / remainingRows)`.
4. Row height: clamp(110, 220, available / remainingRows - 8).
5. Inside each row, divide width by relative weights.

### Tile content

Three responsive levels based on tile size:
- `showFull` (w>220, h>140): title + artist + tuning chip + segment strip + stats row + hover play button
- `showMed` (w>150, h>100): same but no segment strip
- minimal: just title + artist

**Segment strip:** 8px tall bar, looped segments at 85% opacity, others at 35%, positioned by `start/end / duration`.

**Hover state:** border gets the tuning color, tile lifts 2px, colored shadow, circular play button appears bottom-right.

### Bottom now-playing strip

Fixed 18px from bottom: green dot · "Last practiced: BOLD song · artist" · keyboard hints.

---

## Orbit — layout

### Header (24px from top)

Back chevron (rotated 180°) → song eyebrow / title / artist+tuning+duration → right side floating pills (`{N} looped`, `practiced 12m`, `● rec`).

### Geometry — must be responsive

This is non-negotiable; the prototype broke at 720p before being fixed.

```
orbitTop = 120
orbitBottomMargin = 40
avail = max(360, vh - orbitTop - orbitBottomMargin)
R = min(290, max(160, (avail - 140) / 2))    // outer ring
R2 = R - 46                                   // arc ring
cx = max(R + 60, 320)
cy = orbitTop + R + 30
```

This guarantees the play button + center card stay above the fold from ~540px tall up.

### Orbit elements

1. **Outer ring** (r=R) — 1px stroke at 6% white.
2. **Inner disc** (r=R2-70) — 2.5% white fill, sets the "stage."
3. **Tick marks** every 30s, with mm:ss labels at `r=R+26`. Mono font, 10px, 40% white.
4. **Segment arcs** at `r=R2`: 14px stroke (24px when active). Looped: 100% opacity. Not looped: 35%. Active arc gets a 2px white overlay at 55% for emphasis.
5. **Segment number labels** ("01", "02", ...) at `r=R2-30`, in the segment's own color tone, mono, bold.
6. **Playhead arm** — line from center hub to outer ring, rotated to `(t/dur) × 360`. 2px stroke + 6px tip dot, both in the tuning color.
7. **Center hub** — 44px black disc, 1px white-30% border, 8px tuning-color dot at center.

### Center play button

`72×72`, positioned at `{ left: cx-36, top: cy-36 }`. Tuning-color background, black play/pause icon, dark glow + 6px halo against `rgba(10,8,16,0.85)` so it pops against the disc.

### Floating "Now Looping" card

Below the orbit, `{ left: cx-145, top: cy + R - R2 + 70 }`. Width 290px. Glass panel (78% dark, 18px blur, white-08 border). Contents:
- Color square + "NOW LOOPING" eyebrow + live time code (`fmtTimeFine`).
- Segment label, 20/700.
- `mm:ss → mm:ss · Ns` mono line.
- 4px progress bar within the loop window.

### Right column (`right: 36, top: 130, bottom: 28, width: 540`)

Vertical stack with 14px gaps:

1. **Video** — 16:9 with rounded corners. Bottom-left chip = active segment color + label + speed multiplier. Top-right chips = LOOP state + reverb preset name.
2. **Speed control** — large numeric readout (32px tabular) + custom segmented slider with stops at 0.5/0.75/1.0/1.25, then transport row (`Loop · Prev · Next · Mark solid`).
3. **Passages + Reverb** — flex container. Top: chip cloud of segments (active = filled with segment color, looped = 100% opacity, others = 50%). Bottom: 5-cell reverb selector (`off / room / hall / stadium / cathedral`) anchored to the bottom of the panel.
4. **Shortcut bar** — Mono key chips + labels.

---

## Interactions

### Atlas

| Action | Result |
|---|---|
| Click tile | Enter Orbit for that song |
| Hover tile | Border tints, lift 2px, play button reveals |
| Type in search | Filter tiles by `title + artist` (debounced 400ms per CLAUDE §1) |
| Click filter pill | Filter to that tuning; "All" clears |
| `⌘K` | Focus search |
| `Enter` | Open the highlighted tile |

### Orbit

| Action | Result |
|---|---|
| Click arc | Make that segment active, jump playhead to its start |
| Click chip in passages | Same |
| Center play button | Play/pause |
| Speed slider stop / drag | Change speed |
| Loop button | Toggle loop on the active segment |
| Prev/Next | Cycle active segment |
| Mark solid | Sets segment status (T2.2) |
| Reverb chip | Switch preset (T3.4) |
| `Esc` | Back to Atlas |
| `Space / I / O / L / [ ] / ← → / , . / − = / F` | All existing shortcuts preserved |

---

## Data — uses what's already there

No schema changes needed for this redesign. Reads directly from:

- `data/library.json` — `{ id, title, artist?, duration, tunings?, tags?, file }`
- `data/segments.json` — `{ [videoId]: [{ start, end, color, label?, notes?, status? }] }`

Derived in-app:
- `lastPlayed` — needs T2.3 (sessions) to be real. Until then, tiles can fall back to "—" or hide the field.
- Tile `recencyWeight` — also derived from sessions; until T2.3, default to 1 for everyone (uniform tile size baseline).
- `segments` count per song — `segments[id]?.length || 0`.

The prototype synthesizes segment lists for songs that don't have any — in production, songs with zero segments would either show a "no segments" hint in Orbit or auto-prompt to create the first one.

---

## What this redesign drops vs current UI

**Removed:**
- Sidebar tree (replaced by Atlas).
- Linear horizontal timeline (replaced by Orbit).
- Bottom shortcut row inside the player (now contextual: in the Orbit right column, only relevant ones).

**Moved:**
- Download drawer → triggered from "+ Add YouTube" pill in Atlas top bar (same drawer markup, just a different trigger).
- Cookies UI → stays in the drawer.
- Video Notes / Artist / Tunings / Tags → moves into Orbit, behind a notes button (not in the v1 spec — proposed as a follow-up).
- Volume control → bottom of the video panel in Orbit (not in v1; current behavior preserved with existing keys).

**Kept identical:**
- All keyboard shortcuts.
- All endpoints (`/api/library`, `/api/segments`, `/cookies`, `/tunings`, etc.).
- All persistence (no new files, no schema bump).

---

## What `CLAUDE.md` rules are affected

This redesign touches enough surface area that it's worth being explicit:

1. **§1 single-file rule** — `app.js` is 1271 lines today and will grow with two views. Proposing to split into `app.js` (entry + globals + shared) + `views/atlas.js` + `views/orbit.js`, all loaded as classic `<script>` tags in order. Still no modules, no bundler.
2. **§4 no modal dialogs** — Orbit isn't a modal, it's a route swap (full-screen view replacement). Compliant.
3. **§4 keyboard-first** — Atlas adds `⌘K` for search focus and `Enter` to open the highlighted tile. Documented in README.
4. **§3 schema** — no changes required for v1. T2.3 (sessions) would unlock real recency weighting later, but the redesign ships without it.
5. **§4 color is never the only signal** — tuning chips also carry the tuning name as text; segment loop status uses opacity *plus* the chip lives in a "Looped" labeled count. Status pill (T2.2) when added must keep an icon/text alongside color.

---

## Open questions for the team

1. **Tile sizing without sessions data.** Until T2.3 lands, all tiles get equal weight, which makes Atlas feel uniform. Acceptable? Or should we use `segments.length` alone as a proxy?
2. **Where do video-level notes / artist / tunings live in Orbit?** Inline panel, side panel, or behind a button? The prototype omitted this.
3. **Empty Orbit (song with zero segments).** Show a "create your first segment" coach mark, or fall back to the old linear timeline UI? Both are reasonable.
4. **Mobile.** Out of scope for v1, but the Orbit geometry already scales down — Atlas would need a different packing strategy (probably a single-column list).

---

## Files in this folder

- `SPEC.md` — this document.
- `BACKLOG-ENTRY.md` — the proposed backlog item, ready to paste into `BACKLOG.md`.
- `practice-app-reference/Practice App.html` — the working clickable prototype (open in a browser).
