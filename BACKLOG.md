# Feature Backlog — Practice Library Evolution

Tracks the shift from "YouTube looper" to "music practice library."
Work top-to-bottom. Don't skip tiers — each tier assumes the previous one landed.
See [CLAUDE.md](CLAUDE.md) for the rules that govern *how* each item is implemented and tested.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped

---

## Tier 1 — Extend existing primitives (highest leverage, smallest lift)

- [x] **T1.1 — Segment labels**
  Each segment gets an editable name ("Intro riff", "Bend at 1:42"). Empty label falls back to today's numeric display.
  *Schema touch:* `segments.json` segment objects gain `label?: string`.
  *UI:* inline-editable label on segment chips; Enter commits, Esc cancels.

- [x] **T1.2 — Notes per segment and per video**
  Free-text notes. Multiline. Autosaves on blur.
  *Schema:* segment gains `notes?: string`; `library.json` video entries gain `notes?: string`.
  *UI:* collapsible notes panel next to the timeline; textarea tied to the currently selected segment, plus a video-level notes box in the library row.

- [-] **T1.3 — Persist speed per segment** *(dropped)*
  Global playback speed is sufficient in practice; per-segment speed adds state without enough payoff.

- [x] **T1.4 — Edit segment in/out after creation**
  Adjust boundaries without deleting and re-creating.
  *UI:* drag handles on the segment bar, plus numeric inputs in the segment chip (mm:ss.ss).
  *Constraint:* must never allow `out <= in`; clamp to video duration.

---

## Tier 2 — Practice-library primitives (new concepts, still local-first)

- [x] **T2.1 — Tags and collections**
  Arbitrary string tags on videos (not segments — tags classify the whole video; segments already have label + notes). A "collection" is just a saved tag query that filters the library.
  *Schema:* `tags?: string[]` on library video entries. New `data/collections.json` for saved queries: `[{ id, name, query: string[] }]`.
  *UI:* tag input with autocomplete from existing tags (in the video notes panel); collections panel with chip list, click to toggle. Active collection dims non-matching library entries.

- [ ] **T2.2 — Status per segment**
  Three states: `learning` (default), `solid`, `mastered`.
  *Schema:* segment gains `status?: "learning" | "solid" | "mastered"`.
  *UI:* status pill on the segment chip; click cycles state. Color coding must be colorblind-safe.
  *View:* library filter "needs work" = any segment where `status !== "mastered"`.

- [ ] **T2.3 — Session log**
  Record when a segment was actively looped, and for how long. "Active loop" = LOOP toggled on + playhead moving inside the segment window.
  *Schema:* new `data/sessions.json`: append-only `[{ id, videoId, segmentId?, startedAt, durationSec }]`.
  *Derived views:* `lastPracticedAt` on segments/videos; weekly streak counter on the header.
  *Write cadence:* flush to disk at most every 10s or on pause/stop.

- [ ] **T2.4 — Library search and filter**
  Text search across title + notes + tags. Filter chips: has-segments, status, tag, last-practiced within N days.
  *UI:* single search box in the library panel. Filters persist to `localStorage`, not `library.json`.

- [x] **T2.5 — Artist and tunings metadata**
  Structured per-video `artist` (auto-filled from `uploader`/`artist`/`channel` at download time, user-editable) and `tunings: string[]` (up to 6, autocompleted from a curated preset list + existing library usage).
  *Schema:* library entries gain `artist?: string` and `tunings?: string[]`. One-time migration moves tuning-looking values out of `tags` into `tunings` on first load (covers `Drop D`, `Drop-C`, `E Standard`, `Db Standard`, etc.).
  *UI:* library row becomes two-line — title on top, dim artist text + tuning chips below. Artist input and tuning chip editor live in the Video Notes panel. New `GET /tunings` endpoint for autocomplete.

---

## Tier 2.5 — UI Redesign

- [x] **U1 — Atlas library + Orbit practice view**

  Replace the current sidebar/timeline UI with two screens: an Atlas tile board as the home / library view, and an Orbit circular-timeline practice view that opens when a song is selected. Full design spec in `docs/redesign/SPEC.md`. Working prototype in `docs/redesign/practice-app-reference/Practice App.html`.

  *Architecture touch (CLAUDE.md §1):* split `app.js` into `app.js` (entry, globals, shared helpers) + `views/atlas.js` + `views/orbit.js`, all classic `<script>` tags loaded in order. No bundler, no modules. Document the split in `CLAUDE.md` as part of this PR.

  *Schema touch:* none. Reads existing `library.json` and `segments.json` as-is.

  *UI:*
  - Atlas top bar: brand + search (⌘K) + "+ Add YouTube" pill (triggers existing download drawer).
  - Atlas tuning filter rail: one pill per unique tuning + "All".
  - Atlas tile board: greedy row pack, color-coded by primary tuning, segment strip on large tiles.
  - Orbit header: back chevron → song title.
  - Orbit center: SVG ring with segment arcs, playhead arm, hub play button. Geometry scales to viewport height.
  - Orbit right column: video → speed control + transport → passages + reverb → shortcuts.

  *Keyboard:*
  - Atlas: `⌘K` focus search, `Enter` open highlighted tile, `F` focus filter.
  - Orbit: all existing shortcuts (`Space`, `I`, `O`, `L`, `[ ]`, `← →`, `, .`, `− =`, `F`) preserved + `Esc` to return to Atlas.
  - No collisions with existing set.

  *Persistence:*
  - Active view + last-opened song → `localStorage` so refresh restores context.
  - Tuning filter selection → `localStorage`.
  - All other state goes through existing endpoints.

  *Acceptance criteria:*
  1. Loading the app shows Atlas with tiles for every entry in `library.json`.
  2. Filter pills correctly subset the tile board.
  3. Clicking a tile opens Orbit with that song's segments rendered as arcs.
  4. Active segment loops correctly (gap-free, same as today).
  5. `Esc` returns to Atlas with playback paused.
  6. All existing keyboard shortcuts still work in Orbit.
  7. Refresh on Orbit returns to Orbit for the same song; refresh on Atlas returns to Atlas.
  8. Old `library.json` and `segments.json` (no `tunings`, no `label`, no `status`) load without errors — fields fall back to defaults.

  *Test checklist additions (CLAUDE.md §7):*
  - Atlas: search "warning" → only The Warning tiles visible. Click "Drop D" pill → only Drop D tiles. "All" clears.
  - Atlas: tile count matches `library.json` length.
  - Orbit: every segment in `segments.json` for a song renders an arc at the correct angle (`(start/duration) × 360`).
  - Orbit: hub play/pause button toggles `<video>` playback.
  - Orbit: speed slider stops set `video.playbackRate` to the displayed value.
  - Orbit: viewport heights from 540px → 1200px keep the play button + Now Looping card fully on-screen.
  - Cross-screen: open song A in Orbit, Esc, open song B → no stale state from A.
  - Persistence: open Orbit on song X, hard-refresh → still in Orbit on X with playhead at last position.

---

## Tier 3 — Forks in the road (decide before starting)

Each of these is a scope jump. Open a discussion in the PR *before* writing code.

- [ ] **T3.1 — Local-first vs backend** — pick one. Stays local = current JSON files + optional export/import. Adds backend = SQLite (not a remote DB) + simple auth only if multi-device matters.
- [ ] **T3.2 — Beyond YouTube** — local file upload first (cheap). Spotify/Apple Music require licensed APIs and won't return raw audio. Stem separation (Demucs) is its own product.
- [ ] **T3.3 — Musician-specific tooling** — metronome overlay, pitch-preserving tempo (already partially via `playbackRate`; true pitch-preserve needs Web Audio + a time-stretch lib), tab/chord attachments. Each ships independently.

- [ ] **T3.4 — Stage reverb mode**
  Apply a room-simulation reverb to the video audio so practice feels like playing in a hall, club, or stadium. Purely an effect — does not alter the source file.
  *Tech:* route the `<video>` element through the Web Audio API (`AudioContext` + `MediaElementAudioSourceNode`). No new npm dependency.
  *Presets:* off (default) · small room · hall · stadium · cathedral. Implementation can be either convolution (ConvolverNode + short impulse-response `.wav` assets under `public/ir/`) or algorithmic (chained `DelayNode` / `BiquadFilterNode` / feedback) — decide in the PR. Convolution sounds better; algorithmic ships zero binary assets.
  *UI:* a compact preset dropdown in the player toolbar next to the volume slider, with a wet/dry mix slider. Visible label + `aria-label`. "Off" preset fully bypasses the graph (no CPU cost, bit-identical audio).
  *Keyboard:* `R` cycles presets (off → small room → hall → stadium → cathedral → off). Wet/dry via `Shift+R` / `Shift+Alt+R` is optional.
  *Schema:* **none** — user preference is session-scoped. Persist last preset + wet/dry to `localStorage` (`yl-reverb-preset`, `yl-reverb-mix`), matching the pattern used by the volume keys `yl-volume` / `yl-muted`.
  *Constraints:*
    - Must not break existing volume / mute controls — `video.volume` and `video.muted` keep working when reverb is on.
    - Creating the `AudioContext` must be lazy (first user interaction), to comply with browser autoplay policies.
    - Toggling presets mid-playback must not cause a click / dropout — crossfade or bypass cleanly.
    - Fullscreen and speed controls are unaffected.

---

## Cross-cutting

- [ ] **X.1 — Data migration safety**
  Every schema bump must load old JSON without throwing. See [CLAUDE.md](CLAUDE.md#schema-migrations).

- [ ] **X.2 — Smoke test script**
  Add `npm run smoke` that boots the server, hits the key endpoints, and exits. Prevents regressions since we have no unit tests.

- [ ] **X.3 — Keyboard shortcut doc sync**
  Any new shortcut updates both the in-app help overlay (if/when added) and [README.md](README.md).
