const express = require('express');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.text({ type: 'text/plain', limit: '10mb' }));
app.use(express.static('public'));

const DATA_DIR         = path.join(__dirname, 'data');
const LIBRARY_FILE     = path.join(DATA_DIR, 'library.json');
const SEGMENTS_FILE    = path.join(DATA_DIR, 'segments.json');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const COOKIES_FILE     = path.join(DATA_DIR, 'cookies.txt');

// Strips playlist/tracking params so yt-dlp always downloads a single video.
// Handles youtube.com/watch?v=ID&list=...  and  youtu.be/ID?si=...
function normalizeYoutubeUrl(raw) {
    try {
        const u = new URL(raw.trim());
        if (u.hostname === 'youtu.be') {
            return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
        }
        const v = u.searchParams.get('v');
        if (v) return `https://www.youtube.com/watch?v=${v}`;
    } catch {}
    return raw;
}

function readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}

function writeJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

const MAX_SEGMENT_LABEL_LEN = 80;
const MAX_SEGMENT_NOTES_LEN = 2000;
const MAX_VIDEO_NOTES_LEN   = 8000;
const MAX_TITLE_LEN         = 200;
const BPM_MIN               = 20;
const BPM_MAX               = 300;
const MAX_TAG_LEN           = 40;
const MAX_TAGS_PER_RESOURCE = 20;
const MAX_COLLECTION_NAME_LEN = 80;
const MAX_ARTIST_LEN        = 120;
const MAX_TUNING_LEN        = 40;
const MAX_TUNINGS_PER_ENTRY = 6;

// Curated set of recognizable tuning names for the one-time tag→tunings migration.
// Comparison is against tuningKey() (lowercased, whitespace/hyphen collapsed).
const KNOWN_TUNINGS = new Set([
    'standard', 'e standard', 'eb standard', 'd standard', 'db standard',
    'c standard', 'c# standard', 'b standard',
    'drop d', 'drop db', 'drop c#', 'drop c', 'drop b', 'drop a', 'drop eb',
    'open d', 'open g', 'open c', 'open e', 'open a',
    'dadgad', 'half step down', 'whole step down',
]);

function tuningKey(s) {
    return String(s).toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

// Trim, dedupe (case-insensitive, first occurrence wins), drop empties, cap count.
function normalizeStringList(raw, maxCount, maxLen) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const t of raw) {
        if (typeof t !== 'string') continue;
        const trimmed = t.trim().slice(0, maxLen);
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
        if (out.length >= maxCount) break;
    }
    return out;
}

function normalizeTags(raw) {
    return normalizeStringList(raw, MAX_TAGS_PER_RESOURCE, MAX_TAG_LEN);
}

function normalizeSegment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const start = Number(raw.start);
    const end   = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const seg = {
        start,
        end,
        color: typeof raw.color === 'string' ? raw.color : '#7c6fff',
    };
    if (typeof raw.label === 'string') {
        const label = raw.label.trim().slice(0, MAX_SEGMENT_LABEL_LEN);
        if (label) seg.label = label;
    }
    if (typeof raw.notes === 'string') {
        const notes = raw.notes.slice(0, MAX_SEGMENT_NOTES_LEN);
        if (notes.trim()) seg.notes = notes;
    }
    seg.loopEnabled = raw.loopEnabled !== false;
    return seg;
}

function normalizeLibraryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || typeof raw.file !== 'string') return null;
    const rawTitle = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_LEN) : '';
    const entry = {
        id: raw.id,
        title: rawTitle || raw.id,
        file: raw.file,
        duration: Number.isFinite(raw.duration) ? raw.duration : null,
    };
    if (typeof raw.notes === 'string') {
        const notes = raw.notes.slice(0, MAX_VIDEO_NOTES_LEN);
        if (notes.trim()) entry.notes = notes;
    }
    if (typeof raw.artist === 'string') {
        const artist = raw.artist.trim().slice(0, MAX_ARTIST_LEN);
        if (artist) entry.artist = artist;
    }
    if (Number.isFinite(raw.bpm) && raw.bpm >= BPM_MIN && raw.bpm <= BPM_MAX) {
        entry.bpm = Math.round(raw.bpm);
    }
    let tags = normalizeTags(raw.tags);
    let tunings = normalizeStringList(raw.tunings, MAX_TUNINGS_PER_ENTRY, MAX_TUNING_LEN);

    // One-time migration: if `tunings` is absent, move any tag matching a known
    // tuning into `tunings` and drop it from `tags`. Idempotent once migrated
    // (tuning-looking tags no longer appear in `tags`).
    if (!Array.isArray(raw.tunings)) {
        const migrated = [];
        const remaining = [];
        for (const t of tags) {
            if (KNOWN_TUNINGS.has(tuningKey(t))) migrated.push(t);
            else remaining.push(t);
        }
        if (migrated.length) {
            tags = remaining;
            tunings = normalizeStringList(
                [...tunings, ...migrated], MAX_TUNINGS_PER_ENTRY, MAX_TUNING_LEN
            );
        }
    }

    if (tags.length) entry.tags = tags;
    if (tunings.length) entry.tunings = tunings;
    return entry;
}

function normalizeCollection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.name !== 'string') return null;
    const name = raw.name.trim().slice(0, MAX_COLLECTION_NAME_LEN);
    if (!name) return null;
    const query = normalizeTags(raw.query);
    if (!query.length) return null;
    const id = (typeof raw.id === 'string' && raw.id) ? raw.id : Math.random().toString(36).slice(2, 10);
    return { id, name, query };
}

// ── SSE progress clients ──────────────────────────────────────────────────────
const progressClients = new Map();

app.get('/progress/:sessionId', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    progressClients.set(req.params.sessionId, res);
    req.on('close', () => progressClients.delete(req.params.sessionId));
});

function sendProgress(sessionId, data) {
    const client = progressClients.get(sessionId);
    if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendDone(sessionId, data) {
    const client = progressClients.get(sessionId);
    if (client) {
        client.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
        progressClients.delete(sessionId);
    }
}

// ── Cookies ───────────────────────────────────────────────────────────────────
app.get('/cookies', (req, res) => {
    res.json({ exists: fs.existsSync(COOKIES_FILE) });
});

app.post('/cookies', (req, res) => {
    if (!req.body || typeof req.body !== 'string') {
        return res.status(400).json({ success: false, error: 'Expected plain text body' });
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COOKIES_FILE, req.body, 'utf8');
    console.log('[cookies] cookies.txt saved');
    res.json({ success: true });
});

app.delete('/cookies', (req, res) => {
    try { fs.unlinkSync(COOKIES_FILE); } catch {}
    console.log('[cookies] cookies.txt removed');
    res.json({ success: true });
});

// ── Cookie handling ───────────────────────────────────────────────────────────
// Use cookies.txt if uploaded, otherwise no cookies.
async function fetchInfo(url, extraOpts = {}) {
    const base = { dumpSingleJson: true, noCheckCertificate: true, noWarnings: true };
    const cookiesOpt = fs.existsSync(COOKIES_FILE) ? { cookies: COOKIES_FILE } : {};
    const info = await youtubedl(url, { ...base, ...extraOpts, ...cookiesOpt });
    return { info, cookiesOpt };
}

// ── Download ──────────────────────────────────────────────────────────────────
app.post('/download', async (req, res) => {
    const { url: rawUrl, sessionId } = req.body;
    const url = normalizeYoutubeUrl(rawUrl);
    const videosDir = path.join(__dirname, 'public', 'videos');
    fs.mkdirSync(videosDir, { recursive: true });

    try {
        const { info, cookiesOpt } = await fetchInfo(url);

        const outputPath = path.join(videosDir, `${info.id}.%(ext)s`);
        const dlProc = youtubedl(url, {
            output: outputPath,
            format: 'bestvideo+bestaudio/best',
            noCheckCertificate: true,
            noWarnings: true,
            ...cookiesOpt,
        });

        const parseProgress = (chunk) => {
            for (const line of chunk.toString().split('\n')) {
                const m = line.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/);
                if (m) sendProgress(sessionId, { percent: m[1], speed: m[2], eta: m[3] });
            }
        };
        dlProc.stdout?.on('data', parseProgress);
        dlProc.stderr?.on('data', parseProgress);

        await dlProc;

        const files = fs.readdirSync(videosDir);
        const downloadedFile = files.find(f => f.startsWith(info.id));
        if (!downloadedFile) throw new Error('Downloaded file not found');

        const library = readJSON(LIBRARY_FILE, []);
        if (!library.find(v => v.id === info.id)) {
            const artistGuess = (info.artist || info.creator || info.uploader || info.channel || '').trim();
            const entry = { id: info.id, title: info.title, file: `/videos/${downloadedFile}`, duration: info.duration ?? null };
            if (artistGuess) entry.artist = artistGuess.slice(0, MAX_ARTIST_LEN);
            library.push(entry);
            writeJSON(LIBRARY_FILE, library);
        }

        const result = { success: true, id: info.id, file: `/videos/${downloadedFile}`, title: info.title };
        sendDone(sessionId, result);
        res.json(result);

    } catch (err) {
        console.error(err);
        sendDone(sessionId, { success: false, error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Library ───────────────────────────────────────────────────────────────────
app.get('/library', (req, res) => {
    const library = readJSON(LIBRARY_FILE, []);
    const filtered = library
        .filter(v => v && typeof v === 'object' && typeof v.file === 'string'
            && fs.existsSync(path.join(__dirname, 'public', v.file)))
        .map(normalizeLibraryEntry)
        .filter(Boolean);
    res.json(filtered);
});

app.post('/library/:id', (req, res) => {
    const { id } = req.params;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: 'Expected JSON object body' });
    }
    const library = readJSON(LIBRARY_FILE, []);
    const idx = library.findIndex(v => v && v.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    // Mutable here: notes, tags, artist, tunings, title, bpm. id/file/duration stay put.
    const merged = { ...library[idx] };
    if ('notes'   in req.body) merged.notes   = req.body.notes;
    if ('tags'    in req.body) merged.tags    = req.body.tags;
    if ('artist'  in req.body) merged.artist  = req.body.artist;
    if ('tunings' in req.body) merged.tunings = req.body.tunings;
    if ('title'   in req.body) {
        const t = String(req.body.title || '').trim().slice(0, MAX_TITLE_LEN);
        if (!t) return res.status(400).json({ success: false, error: 'Title cannot be empty' });
        merged.title = t;
    }
    if ('bpm' in req.body) {
        const v = req.body.bpm;
        if (v === null || v === '' || v === undefined) {
            delete merged.bpm;
        } else {
            const n = Number(v);
            if (!Number.isFinite(n) || n < BPM_MIN || n > BPM_MAX) {
                return res.status(400).json({ success: false, error: `BPM must be ${BPM_MIN}–${BPM_MAX}` });
            }
            merged.bpm = Math.round(n);
        }
    }
    const normalized = normalizeLibraryEntry(merged);
    if (!normalized) return res.status(400).json({ success: false, error: 'Invalid entry' });
    library[idx] = normalized;
    writeJSON(LIBRARY_FILE, library);
    res.json(normalized);
});

app.delete('/library/:id', (req, res) => {
    const { id } = req.params;
    const library = readJSON(LIBRARY_FILE, []);
    const entry = library.find(v => v.id === id);
    if (!entry) return res.status(404).json({ success: false, error: 'Not found' });

    try { fs.unlinkSync(path.join(__dirname, 'public', entry.file)); } catch {}
    writeJSON(LIBRARY_FILE, library.filter(v => v.id !== id));

    const segments = readJSON(SEGMENTS_FILE, {});
    delete segments[id];
    writeJSON(SEGMENTS_FILE, segments);

    res.json({ success: true });
});

// ── Segments ──────────────────────────────────────────────────────────────────
app.get('/segments/:id', (req, res) => {
    const all = readJSON(SEGMENTS_FILE, {});
    const raw = Array.isArray(all[req.params.id]) ? all[req.params.id] : [];
    res.json(raw.map(normalizeSegment).filter(Boolean));
});

app.post('/segments/:id', (req, res) => {
    if (!Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: 'Expected array of segments' });
    }
    const normalized = req.body.map(normalizeSegment).filter(Boolean);
    const all = readJSON(SEGMENTS_FILE, {});
    all[req.params.id] = normalized;
    writeJSON(SEGMENTS_FILE, all);
    res.json(normalized);
});

// ── Tags (union across library videos) ────────────────────────────────────────
app.get('/tags', (req, res) => {
    const library = readJSON(LIBRARY_FILE, []);
    const map = new Map(); // lowercase → first-seen casing
    for (const raw of library) {
        const v = normalizeLibraryEntry(raw);
        if (!v || !Array.isArray(v.tags)) continue;
        for (const t of v.tags) {
            const k = t.toLowerCase();
            if (!map.has(k)) map.set(k, t);
        }
    }
    res.json([...map.values()].sort((a, b) => a.localeCompare(b)));
});

// ── Tunings (curated presets ∪ union across library videos) ──────────────────
app.get('/tunings', (req, res) => {
    const library = readJSON(LIBRARY_FILE, []);
    const map = new Map();
    const presets = [
        'E Standard', 'Eb Standard', 'D Standard', 'Db Standard', 'C Standard', 'B Standard',
        'Drop D', 'Drop Db', 'Drop C', 'Drop B', 'Drop A',
        'Open D', 'Open G', 'Open C', 'Open E', 'Open A',
        'DADGAD', 'Half Step Down', 'Whole Step Down',
    ];
    for (const t of presets) map.set(t.toLowerCase(), t);
    for (const v of library) {
        if (!v || !Array.isArray(v.tunings)) continue;
        for (const t of normalizeStringList(v.tunings, MAX_TUNINGS_PER_ENTRY, MAX_TUNING_LEN)) {
            const k = t.toLowerCase();
            if (!map.has(k)) map.set(k, t);
        }
    }
    res.json([...map.values()].sort((a, b) => a.localeCompare(b)));
});

// ── Collections ───────────────────────────────────────────────────────────────
app.get('/collections', (req, res) => {
    const raw = readJSON(COLLECTIONS_FILE, []);
    const list = Array.isArray(raw) ? raw.map(normalizeCollection).filter(Boolean) : [];
    res.json(list);
});

app.post('/collections', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: 'Expected JSON object body' });
    }
    const normalized = normalizeCollection(req.body);
    if (!normalized) return res.status(400).json({ success: false, error: 'Invalid collection (name + non-empty query required)' });
    const all = readJSON(COLLECTIONS_FILE, []);
    const list = Array.isArray(all) ? all : [];
    // If id matches an existing entry, replace it; otherwise append.
    const existingIdx = list.findIndex(c => c && c.id === normalized.id);
    if (existingIdx >= 0) list[existingIdx] = normalized; else list.push(normalized);
    writeJSON(COLLECTIONS_FILE, list);
    res.json(normalized);
});

app.delete('/collections/:id', (req, res) => {
    const all = readJSON(COLLECTIONS_FILE, []);
    const list = Array.isArray(all) ? all : [];
    const next = list.filter(c => c && c.id !== req.params.id);
    if (next.length === list.length) return res.status(404).json({ success: false, error: 'Not found' });
    writeJSON(COLLECTIONS_FILE, next);
    res.json({ success: true });
});

// SPA fallback: serve index.html for non-asset paths (e.g. /song/<id>) so direct
// loads and refreshes work. Asset and API routes above match first; this only
// catches anything that fell through. Express 5 wildcard syntax.
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Server ────────────────────────────────────────────────────────────────────
const server = app.listen(3000, () => {
    fs.writeFileSync('server.pid', String(process.pid));
    console.log('Server running on http://localhost:3000');
});

process.on('SIGINT',  () => shutdown());
process.on('SIGTERM', () => shutdown());

function shutdown() {
    try { fs.unlinkSync('server.pid'); } catch {}
    server.close(() => process.exit(0));
}
