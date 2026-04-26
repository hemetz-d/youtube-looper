# Practice Library

A local-first, single-page app for downloading YouTube videos and drilling specific segments. Built for practice — pick a passage, loop it, slow it down, take notes, move on to the next.

The UI has two screens: **Atlas** (home/library — a tile board of every song, color-coded by guitar tuning, sized by segment count) and **Orbit** (practice view — a circular timeline where segments are arcs and the playhead sweeps the ring like a clock hand). Click a tile to enter Orbit; press `Esc` to return.

![Video Looper UI](docs/screenshot.png)

> The library, tags, and segments above are example data for documentation — your local library lives in `data/` and is never committed.

## What it does

- **Download** — paste a YouTube URL, grab the video locally via `yt-dlp`.
- **Library** — every downloaded video lives in a searchable sidebar, tagged however you like. Each entry tracks artist (auto-filled from the YouTube uploader, editable) and guitar tunings as a structured list.
- **Segments** — mark in/out points on any video, label them, jump between them, loop one or the whole sequence.
- **Playback control** — per-session speed (0.25×–2×), volume with mute, keyboard-first navigation.
- **Notes** — per-video and per-segment text notes that persist alongside the library.
- **Filters & collections** — narrow the library by tag; save tag combinations as named collections.

Everything is stored on disk as plain JSON — no database, no auth, no cloud.

## Setup

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Stop with `npm stop`.

## Cookies (required for YouTube downloads)

YouTube requires authentication. Export a `cookies.txt` from your browser using the [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) extension while logged in, then drop the file onto the cookies bar in the download drawer.

## Usage

1. From **Atlas**, click **+ Add YouTube** (top right), paste a URL, click **LOAD**. The new song lands in the library and Orbit opens automatically.
2. From the Atlas tile board, click any tile to open **Orbit** for that song.
3. In Orbit, press `I` / `O` to mark a segment — an arc appears on the ring.
4. Add more segments, then press `L` (or click **Loop**) to cycle through them.
5. To exclude a segment from the loop, click its arc / chip while looping is on, or press `Shift`+`L`.
6. Tune speed (slider stops at 0.5 / 0.75 / 1× / 1.25× or `-` / `=` for fine control), open **Notes** for artist / tunings / tags / video notes. Everything auto-saves.
7. Press `Esc` to return to Atlas.

## Keyboard shortcuts

### Atlas (library)

| Key | Action |
|-----|--------|
| `⌘K` / `Ctrl`+`K` | Focus search |
| `↑` `↓` `←` `→` | Move highlighted tile |
| `Enter` | Open the highlighted tile in Orbit |
| `F` | Focus the tuning filter rail |

### Orbit (practice)

| Key | Action |
|-----|--------|
| `Esc` | Return to Atlas (closes the Notes panel first if open) |
| `I` / `[` | Set in point |
| `O` / `]` | Set out point |
| `Space` | Play / pause |
| `←` / `→` | Seek ±5s |
| `,` / `.` | Seek ±0.1s |
| `L` | Toggle loop |
| `Shift`+`L` | Include/exclude active segment from the loop |
| `F` | Toggle fullscreen on the video panel |
| `-` / `=` | Speed ±0.05× |
| `0` | Reset speed to 1× |
| `↑` / `↓` | Volume ±5% |
| `M` | Mute / unmute |
| `D` | Toggle download drawer |

Shortcuts are suppressed while typing in an input or textarea, so you can take notes freely. `⌘K` works from anywhere.

## Data layout

All state lives under `data/` (gitignored):

- `library.json` — one entry per downloaded video (id, title, file, duration, tags, notes, artist, tunings).
- `segments.json` — keyed by video id; list of `{ start, end, color, label?, notes?, loopEnabled }`.
- `collections.json` — named tag-filter presets.
- `cookies.txt` — your YouTube cookies (only if you uploaded them).

Downloaded video files live in `public/videos/` (also gitignored).

## Architecture

Static files under `public/`:

- `index.html` — markup
- `styles.css` — all styles
- `app.js` — entry, globals, shared helpers, persistence wrappers, the `<video>` rAF loop, view router, keyboard router
- `views/atlas.js` — Atlas tile-board view
- `views/orbit.js` — Orbit circular-timeline view

All three JS files load as classic `<script>` tags in `index.html` in the order listed (no `type="module"`, no bundler, no TypeScript). Top-level function declarations and the `window.AtlasView` / `window.OrbitView` namespaces wire views to the rest of the app.

Server is Express 5 + `youtube-dl-exec`. See [CLAUDE.md](CLAUDE.md) for the working rules when extending it.
