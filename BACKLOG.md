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
  Arbitrary string tags on segments and videos. A "collection" is just a saved tag query.
  *Schema:* `tags?: string[]` on segment and video. New `data/collections.json` for saved queries: `[{ id, name, query: string[] }]`.
  *UI:* tag input with autocomplete from existing tags; sidebar list of collections.

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

---

## Tier 3 — Forks in the road (decide before starting)

Each of these is a scope jump. Open a discussion in the PR *before* writing code.

- [ ] **T3.1 — Local-first vs backend** — pick one. Stays local = current JSON files + optional export/import. Adds backend = SQLite (not a remote DB) + simple auth only if multi-device matters.
- [ ] **T3.2 — Beyond YouTube** — local file upload first (cheap). Spotify/Apple Music require licensed APIs and won't return raw audio. Stem separation (Demucs) is its own product.
- [ ] **T3.3 — Musician-specific tooling** — metronome overlay, pitch-preserving tempo (already partially via `playbackRate`; true pitch-preserve needs Web Audio + a time-stretch lib), tab/chord attachments. Each ships independently.

---

## Cross-cutting

- [ ] **X.1 — Data migration safety**
  Every schema bump must load old JSON without throwing. See [CLAUDE.md](CLAUDE.md#schema-migrations).

- [ ] **X.2 — Smoke test script**
  Add `npm run smoke` that boots the server, hits the key endpoints, and exits. Prevents regressions since we have no unit tests.

- [ ] **X.3 — Keyboard shortcut doc sync**
  Any new shortcut updates both the in-app help overlay (if/when added) and [README.md](README.md).
