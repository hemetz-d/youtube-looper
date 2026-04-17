const express = require('express');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.text({ type: 'text/plain', limit: '10mb' }));
app.use(express.static('public'));

const DATA_DIR      = path.join(__dirname, 'data');
const LIBRARY_FILE  = path.join(DATA_DIR, 'library.json');
const SEGMENTS_FILE = path.join(DATA_DIR, 'segments.json');
const COOKIES_FILE  = path.join(DATA_DIR, 'cookies.txt');

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
    return seg;
}

function normalizeLibraryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || typeof raw.file !== 'string') return null;
    const entry = {
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title : raw.id,
        file: raw.file,
        duration: Number.isFinite(raw.duration) ? raw.duration : null,
    };
    if (typeof raw.notes === 'string') {
        const notes = raw.notes.slice(0, MAX_VIDEO_NOTES_LEN);
        if (notes.trim()) entry.notes = notes;
    }
    return entry;
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
            library.push({ id: info.id, title: info.title, file: `/videos/${downloadedFile}`, duration: info.duration ?? null });
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
    // Only `notes` is mutable here; id/file/title/duration stay put.
    const merged = { ...library[idx], notes: req.body.notes };
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
