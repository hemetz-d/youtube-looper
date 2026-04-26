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

- [ ] **T2.6 — Local file upload (video & audio)**
  Add to the library directly from disk, alongside the YouTube downloader. Accepts video (`mp4`, `webm`, `mov`, `mkv`) and audio-only (`mp3`, `m4a`, `flac`, `wav`, `opus`). Audio-only is a first-class concept: many practice tracks are isolated stems / backing tracks / live recordings without a video frame.
  *Schema:* library entries gain `mediaType?: 'video' | 'audio'` (defaults to `'video'` for old YouTube downloads) and `source?: 'youtube' | 'local'` (defaults to `'youtube'`). Files stored in `public/media/<id>.<ext>` (with a `public/videos/` redirect for backwards compat).
  *Endpoint:* `POST /upload` accepting `multipart/form-data`. Server uses the file mime to derive `mediaType`. Returns the same library-entry shape as `/download`.
  *UI:* second pill in the Atlas top bar: `+ Local file`. Drag-and-drop overlay on the tile board accepts dropped files. New tile renders immediately on success.
  *Constraint:* keep upload streaming; never load the file into memory server-side.

- [ ] **T2.7 — Audio-only entry display in Orbit**
  Audio-only entries have no video frame, so the Orbit "video" panel needs a different treatment. Show extracted cover art if present (ID3 / FLAC tags); fall back to a stylized panel with the tuning color, song title, artist, and a live waveform.
  *Schema:* library entries gain `artwork?: string` (path under `public/artwork/<id>.<ext>`). Audio entries get a `♪` badge in Atlas tiles to distinguish from video entries.
  *Tech:* artwork extraction at upload time. Either a tiny Node helper using `fs` + a minimal mp3/flac tag parser, or a curated dependency (e.g. `music-metadata`) — needs user approval per CLAUDE §1.
  *UI:* Orbit's video panel becomes a "now playing" panel with a 1:1 (or 16:9 letterboxed) artwork tile + live waveform overlay during playback. Fullscreen still works (just shows the artwork enlarged).
  *Note:* depends on T2.6; ship together or in immediate succession.

- [ ] **T2.8 — Exercises and warmups (entry kinds)**
  Library entries are all "songs" today. Add a `kind` axis so the practice library can also track skill-building content — scales, picking patterns, chord drills, finger stretches, ear-training loops — alongside song work. A daily session typically opens with a warmup, runs through a few exercises, and only then dives into songs; reflect that in the data model and UI.
  *Schema:* library entries gain `kind?: 'song' | 'exercise' | 'warmup'` (defaults to `'song'` for old entries). Optional `targetDurationSec?: number` for timed exercises (e.g. "5 min finger stretch"). The existing `bpm` field doubles as the target tempo for metronome-driven exercises (T2.8 doesn't introduce a separate field).
  *UI:*
  - **Atlas filter rail:** add a kind toggle (`All · Songs · Exercises · Warmups`) above or beside the tuning rail. Selection persists to `localStorage` like `tuningFilter`.
  - **Atlas tile:** small icon badge in the top-left for non-song kinds (e.g. `✱` exercise, `↻` warmup), so the board stays scannable.
  - **Edit panel:** new "Kind" segmented selector (song / exercise / warmup) and an optional "Target duration" input (mm:ss).
  - **Orbit eyebrow:** swap "PRACTICE" for "WARMUP" / "EXERCISE" when applicable, so the screen tells you what kind of work this is.
  *Open question — media-less entries:* should warmups/exercises be allowed without a video/audio file? A 60-second finger stretch might just need a metronome + count-up timer, no media. If yes, depends on T2.6's media abstraction and adds an Orbit variant with no video panel — instead a big timer + metronome surface. Decide in the PR; the simple version (still requires a media file, but treats it as practice content rather than a song) is a clean first ship.
  *Future:* routines that stitch warmup → exercise → exercise → song into a guided session (own backlog item; do not bundle here).

- [ ] **T2.9 — Performance recording**
  Record yourself while practicing — capture mic audio (optionally webcam) while the song plays, then listen back to hear your takes. Keep multiple attempts per segment so you can hear progress over a week of working a passage.
  *Schema:* new `data/recordings.json`: `{ [videoId]: [{ id, segmentIdx?, recordedAt: ISO string, durationSec, format, file }] }`. Recording files in `public/recordings/<id>.<ext>` (gitignored). Migration follows CLAUDE §3 — additive shape, missing fields default cleanly.
  *Endpoint:* `POST /recording/:videoId` with `multipart/form-data` (blob + optional `segmentIdx`). Server writes the file, appends to the manifest, returns the new recording entry. `DELETE /recording/:id` for take cleanup.
  *Tech:* `navigator.mediaDevices.getUserMedia()` + `MediaRecorder`. Audio-only by default (Opus in WebM, ~48 kbps). Permission requested on first record click; cached state in `localStorage` so we don't re-prompt every session. No new npm dependency.
  *UI:*
  - **Orbit transport row:** new `● Rec` button next to Loop / Count-in. While recording, button pulses red and shows live duration. Click again to stop.
  - **Orbit takes strip:** small play buttons for each recorded take of the active segment, surfaced below or beside the Now-Looping card. Click a take → playback through a separate `<audio>` element (the source video pauses automatically).
  - **Atlas tile badge:** small `●` indicator on tiles that have at least one recording.
  - **Edit panel:** "Recordings" section with a list of takes (date, duration, segment label) and a `Delete` per take + `Delete all takes for this song`.
  *Decisions for the PR:*
  1. **Audio vs audio + video.** Audio-only is simpler, smaller, no webcam privacy concern. Video adds hand-position context but doubles storage. Default audio-only; webcam toggle as a follow-up.
  2. **Per-segment vs session recording.** Per-segment (anchored to whatever segment is active when Rec is pressed) makes "compare three attempts at the same passage" trivial. Session recording is a separate UX concern. Default per-segment; full-session is a follow-up.
  3. **Live monitoring.** Recording while the song plays through speakers means the mic captures both — that's the desired effect (you hear yourself in context), but lossy. A "no monitor" mode that mutes the song during record is out of scope for v1; document the trade-off.
  *Constraints:*
  - Coexists with T3.4 reverb if that ships first: recording captures the raw mic stream, not reverb-processed output.
  - Per-recording cap (default 5 minutes) so a forgotten record session doesn't fill the disk.
  - Recordings are local-only by default; surface a clear delete affordance.
  *Keyboard:* `R` to start/stop recording (only when an Orbit segment is active). Reserves `Shift+R` for the future "no monitor" toggle.

- [ ] **T2.10 — Stats page**
  A dedicated screen that surfaces how the user has actually been practicing. Aggregates `sessions.json` (T2.3) into glanceable views: total time, time per tuning, time per song, time per kind (song / exercise / warmup), day streak, weekly heatmap. Answers "where am I spending my time?" — and the implicit "where am I *not*?".
  *Schema:* none new — pure derived view over `sessions.json` (T2.3) and `library.json`.
  *Endpoint:* `GET /stats?range=7d|30d|all` returning pre-aggregated buckets so the client doesn't recompute on every render:
  ```json
  {
    "totals":    { "practiceSec": 0, "sessionCount": 0, "daysActive": 0 },
    "perTuning": [{ "tuning": "Drop D", "practiceSec": 0 }],
    "perKind":   [{ "kind": "song",     "practiceSec": 0 }],
    "perSong":   [{ "id": "...", "title": "...", "artist": "...", "practiceSec": 0, "lastPracticedAt": "..." }],
    "perDay":    [{ "date": "2026-04-26", "practiceSec": 0 }],
    "streak":    { "current": 0, "longest": 0 }
  }
  ```
  *UI:*
  - **Entry point:** new `📊 Stats` button in the Atlas top bar (next to "+ Add YouTube"). Opens a third top-level view alongside Atlas / Orbit, persisted to `localStorage[yl-view] = 'stats'` so refresh restores it.
  - **Hero row:** three big numbers — *X hours this week*, *Y hours total*, *Z day streak*.
  - **Per-tuning rail:** horizontal bars colored from the tuning palette, ordered by time descending. Reuses the same color tokens as the Atlas tuning rail so the visual identity carries across.
  - **Per-kind rail:** horizontal bars for `song / exercise / warmup`, only visible after T2.8 ships (otherwise everything is "song" and the row collapses).
  - **Top songs:** ranked list (top 5–10) with title, artist, total time, last-practiced-at.
  - **Heatmap:** 7×24 grid (day-of-week × hour) with cell opacity scaled to minutes practiced — tells the user "you practice mostly evenings on Wednesdays".
  - **Range toggle:** `Last 7 days · Last 30 days · All time` pill row, persisted to `localStorage[yl-stats-range]`.
  - **Empty state:** when `sessions.json` is missing or empty, render a friendly "Practice some songs to see stats here" placeholder rather than zeroes everywhere.
  *Tech:* no charting dependency — bars are flex/`<div>`s with `width: %`, the heatmap is a CSS grid with `background: rgba(tuning-color, opacity)` per cell. SVG only if/when a more elaborate chart appears later.
  *Keyboard:* `Esc` from Stats returns to Atlas (mirrors Orbit). `S` from Atlas toggles Stats? — leave as an open question; depends on whether `S` collides with anything (currently free).
  *Dependencies:* hard dependency on T2.3 (without session data there's nothing to aggregate). Render the empty-state placeholder until T2.3 ships, so this view can land independently and become useful as soon as session logging is on.
  *Future:* per-segment depth ("minutes per segment, ranked"), goal tracking ("hit 30 min/day"), share-as-image — all separate items, do not bundle.

- [ ] **T2.11 — Browser navigation and mini player**
  Wire the browser's back/forward buttons to view transitions, and keep playback alive when leaving the practice view. Today, view state is in `localStorage` but not in `history` — the browser's back/forward buttons do nothing useful, and direct URLs don't deep-link to a song. Pressing `Esc` from a playing Orbit also kills the audio; for "browse the library while the track keeps spinning", playback should continue in a minimized chip.
  *Routing:*
  - `history.pushState({ view: 'atlas' }, '', '/')` when entering Atlas.
  - `history.pushState({ view: 'orbit', id }, '', '/song/' + id)` when entering Orbit.
  - `popstate` listener flips between views without re-pushing history (gate behind a `routing` flag to avoid double-push).
  - Atlas search query + tuning filter via `replaceState` on change (so back/forward only crosses major view boundaries, not every keystroke). Shareable filter URLs as a side benefit.
  *Server:* add an Express catch-all GET after all API routes that serves `public/index.html` for non-asset paths, so `/song/abc123` works on direct access and refresh. Express 5 wildcard syntax is `app.get('/{*splat}', ...)` — verify before merging.
  *Mini player (in Atlas, visible only when audio is playing):*
  - A pinned chip in the bottom-right corner. Contents: tuning-color square or video-frame thumbnail · song title (truncated) · play/pause · `Open` (returns to Orbit) · `×` (pause and dismiss).
  - **Approach decision:**
    a. **Reposition the `<video>` element** via DOM move into a small fixed container while Atlas is showing — preserves frame rendering for music videos.
    b. **Hide the video** and let the chip be a UI shell that controls playback via existing `playVideo()` / `video.pause()` — simpler, assumes audio is what matters during library browsing.
    Decide in the PR. (a) is the user-visible default if music videos are worth showing while browsing.
  - `Esc` in Atlas with the mini player open does NOT pause — dismissal is explicit via the × button. The Esc-closes-edit-panel cascade still applies first.
  - Mini player does not autoplay on reload (autoplay-policy compliant): if the user reloads while a song was playing, the chip restores in paused state.
  *Schema:* none. Existing `yl-view`, `yl-song`, `yl-time-<id>` keys remain the refresh fallback; the URL is the primary source of truth for "what view am I in".
  *Acceptance:*
  1. Click an Atlas tile → URL becomes `/song/<id>` → browser back → URL returns to `/` and Atlas shows.
  2. Direct-load `/song/<id>` → app boots into Orbit on that song.
  3. Direct-load `/song/<id>` with an unknown id → graceful fallback to Atlas.
  4. Start playback in Orbit → press Esc → Atlas shows the mini player; audio keeps playing.
  5. Click the chip's `Open` → Orbit re-opens on the same song without re-fetching the source (`<video>.src` already correct).
  6. Click the chip's `×` → audio pauses, chip disappears.
  7. Refresh while in Orbit → returns to Orbit on the same song; refresh from Atlas → returns to Atlas (existing behavior preserved).
  *Constraints:*
  - All existing keyboard shortcuts and the Atlas Esc behavior are unchanged when no song is playing.
  - `switchToOrbit` must not double-push history (compare current state.id before pushing).
  - Mini player's repositioned `<video>` (if approach (a)) must not break fullscreen — fullscreen target should stay the orbit-side container; pressing F from Atlas mini-player view re-opens Orbit first.
  *Future:* "Now playing" sticky bar at the top of Atlas instead of a corner chip; queue / playlist of upcoming songs.

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
- [ ] **T3.2 — Beyond YouTube** — strategic header. Concrete next steps split out: local file upload as Tier 2 (T2.6 video+audio, T2.7 audio-only display); streaming integrations as Tier 3 (T3.5 YouTube IFrame, T3.6 Spotify Web Playback). Stem separation (Demucs) is its own product, not in scope here.
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

- [ ] **T3.5 — YouTube direct stream (no download)**
  Embed the YouTube IFrame Player API to play a song directly from YouTube without downloading the file. Pros: zero disk usage, no `cookies.txt` needed, no copyright residue on the user's disk. Cons: requires internet for playback, ad interruptions for non-Premium viewers, fewer player primitives.
  *Schema:* library entries gain `source: 'local' | 'youtube'` (default `'local'` for old entries). `youtube`-source entries store `youtubeId` instead of (or alongside) the local `file`. `mediaType` from T2.6 stays `'video'`.
  *Tech:* the `<video>` element is wrapped by an abstraction (`PlayerHandle`) with `currentTime`, `play`, `pause`, `playbackRate`, `volume`, etc. For `local`, it's the existing `<video>`; for `youtube`, it's a YouTube IFrame controlled via `postMessage`. The rAF loop's gap-free segment math reads `getCurrentTime()` instead of `video.currentTime`.
  *UI:* the "+ Add YouTube" pill gets a toggle inside the drawer: **download** (current) vs **stream** (T3.5). Streamed entries get a small `▶ stream` badge in their tile so the user knows they need internet to play.
  *Caveats:*
    - YouTube may revoke playback for embedded contexts on some videos — fall back to a "this video can't be embedded" message with a link.
    - Speed control: YouTube IFrame supports `setPlaybackRate(0.25/0.5/0.75/1/1.25/1.5/1.75/2)` only — snap our slider to the nearest supported value.
    - Reverb (T3.4) does NOT apply to YouTube streams (the audio is in an iframe, not addressable by Web Audio).

- [ ] **T3.6 — Spotify direct stream (Premium-only, library reference)**
  Use Spotify Web Playback SDK to stream a track. Requires user OAuth login and Spotify Premium. Significantly more constrained than YouTube: **no `playbackRate` API** (so no slow-down for practice), seek granularity is coarse (~250ms), can't store the audio.
  *Decision needed:* given Spotify can't slow down — is it actually useful as a practice source? Probably **not for active practice**. Frame this as a "library reference" feature: link a Spotify track to a song entry for quick streaming review (e.g. listening at speed during commute), but real practice still uses a downloaded copy or YouTube stream.
  *Schema:* library entries gain `spotifyTrackId?: string`. A song can have a local file, a YouTube ID, AND a Spotify ID (independent fields).
  *Auth:* OAuth Authorization Code with PKCE. Tokens persisted in `data/spotify-token.json` (gitignored). Single-user assumption (matches current local-first scope).
  *UI:* in the Atlas edit panel (T2.5/U1 metadata), add a "Spotify track" field. In Orbit, when a Spotify ID is linked, show a `▶ Listen on Spotify` chip in the header that opens the Web Playback SDK in a small floating panel — the existing Orbit ring + practice elements stay tied to the local/YouTube source.
  *Constraint:* if the user only has a Spotify-source entry (no local / no YouTube), Orbit should disable speed control with a tooltip ("Spotify can't slow down — link a local or YouTube source for speed control").

---

## Cross-cutting

- [ ] **X.1 — Data migration safety**
  Every schema bump must load old JSON without throwing. See [CLAUDE.md](CLAUDE.md#schema-migrations).

- [ ] **X.2 — Smoke test script**
  Add `npm run smoke` that boots the server, hits the key endpoints, and exits. Prevents regressions since we have no unit tests.

- [ ] **X.3 — Keyboard shortcut doc sync**
  Any new shortcut updates both the in-app help overlay (if/when added) and [README.md](README.md).
