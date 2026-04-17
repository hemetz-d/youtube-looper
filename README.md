# Video Looper

Download YouTube videos and loop specific segments.

## Setup

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Stopping the server

```bash
npm stop
```

## Cookies (required for YouTube downloads)

YouTube requires authentication. Export a `cookies.txt` from your browser using the [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) extension while logged into YouTube, then drop the file onto the cookies bar in the app.

## Usage

1. Paste a YouTube URL and click **LOAD**
2. Use **SET IN** / **SET OUT** (or `I` / `O`) to mark a segment
3. Add multiple segments, then click **LOOP** to play them in sequence
4. Previously downloaded videos are saved in the **Library** — segments persist across sessions

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `I` / `[` | Set in point |
| `O` / `]` | Set out point |
| `Space` | Play / pause |
| `←` / `→` | Seek ±5s |
| `,` / `.` | Seek ±0.1s |
| `L` | Toggle loop |
| `↑` / `↓` | Volume ±5% |
| `M` | Mute / unmute |
