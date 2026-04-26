// ── Constants ─────────────────────────────────────────────────────────────
const COLORS  = ['#7c6fff','#22c55e','#f97316','#06b6d4','#ec4899','#facc15','#8b5cf6','#10b981'];
const SPEED_PRESETS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25];
const SPEED_STEP = 0.05;
const SPEED_MIN  = 0.25;
const SPEED_MAX  = 2;
const VOL_STEP   = 0.05;
const VOL_KEY    = 'yl-volume';
const MUTE_KEY   = 'yl-muted';
const VIEW_KEY        = 'yl-view';
const SONG_KEY        = 'yl-song';
const TUNING_FILTER_KEY = 'yl-tuning-filter';
const TIME_KEY_PREFIX = 'yl-time-';

const TUNING_COLORS = {
  'drop d':       '#7c6fff',
  'drop-d':       '#7c6fff',
  'drop c':       '#ef4444',
  'drop-c':       '#ef4444',
  'e standard':   '#06b6d4',
  'eb standard':  '#22c55e',
  'db standard':  '#a855f7',
  'drop eb':      '#f59e0b',
  'drop-eb':      '#f59e0b',
};
const DEFAULT_TUNING_COLOR = '#94a3b8';

// ── DOM refs (set after DOMContentLoaded) ─────────────────────────────────
let video       = null;
let saveDotEl   = null;
let statusEl    = null;
let statusTimer = null;

// ── State globals ─────────────────────────────────────────────────────────
let segments       = [];
let pendingIn      = null;
let looping        = false;
let loopIdx        = 0;
let currentVideoId = null;
let currentSpeed   = 1;
let saveTimer      = null;
let libraryData    = [];
let allTags        = [];
let allTunings     = [];
let collections    = [];
let activeFilter   = []; // legacy — kept so renderTagRow doesn't error; not exposed in U1 UI
let segCounts      = {}; // {videoId: number} — populated lazily by Atlas

// View routing
let currentView   = 'atlas';      // 'atlas' | 'orbit'
let tuningFilter  = null;         // null = "All"

// Hook called on every rAF tick by views that want playhead updates.
window.onPlayheadTick = function () {};

// ── Tuning helpers ────────────────────────────────────────────────────────
function tuningColor(name) {
  if (!name) return DEFAULT_TUNING_COLOR;
  return TUNING_COLORS[name.trim().toLowerCase()] || DEFAULT_TUNING_COLOR;
}

function primaryTuning(entry) {
  if (entry?.tunings?.length) return entry.tunings[0];
  for (const t of (entry?.tags || [])) {
    if (TUNING_COLORS[t.trim().toLowerCase()]) return t;
  }
  return null;
}

function uniqueTunings(library) {
  const seen = new Set();
  const out = [];
  for (const e of library) {
    const t = primaryTuning(e);
    if (!t) continue;
    const k = t.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

// ── Time formatting ───────────────────────────────────────────────────────
function fmt(t, precise = false) {
  if (!isFinite(t) || t < 0) t = 0;
  const m  = Math.floor(t / 60);
  const s  = Math.floor(t % 60);
  const ds = precise ? '.' + Math.floor((t % 1) * 10) : '';
  return `${m}:${String(s).padStart(2, '0')}${ds}`;
}

function fmtTimeFine(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m  = Math.floor(t / 60);
  const s  = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function formatEditTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function parseTime(str) {
  if (typeof str !== 'string') return NaN;
  const s = str.trim();
  if (!s) return NaN;
  if (s.includes(':')) {
    const [mPart, sPart] = s.split(':');
    const m = Number(mPart), sec = Number(sPart);
    if (!Number.isFinite(m) || !Number.isFinite(sec) || m < 0 || sec < 0 || sec >= 60) return NaN;
    return m * 60 + sec;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove('visible'), 3500);
}

// ── rAF loop (preserved verbatim — gap-free segment looping) ──────────────
function rafLoop() {
  if (video && video.duration) {
    const t   = video.currentTime;
    const dur = video.duration;

    // Trigger jump 0.1s early to cover seek latency → nearly gap-free
    if (looping && segments.length && !video.paused) {
      const enabledIdx = segments
        .map((s, i) => (s.loopEnabled !== false ? i : -1))
        .filter(i => i !== -1);
      if (enabledIdx.length) {
        let pos = enabledIdx.indexOf(loopIdx);
        if (pos === -1) { pos = 0; loopIdx = enabledIdx[0]; }
        const seg = segments[loopIdx];
        if (t >= seg.end - 0.1) {
          pos = (pos + 1) % enabledIdx.length;
          loopIdx = enabledIdx[pos];
          video.currentTime = segments[loopIdx].start;
        }
      }
    }

    try { window.onPlayheadTick(t, dur); } catch {}
  }
  requestAnimationFrame(rafLoop);
}

// ── Persistence: library / segments / tags / tunings / collections ────────
async function loadLibrary() {
  try {
    const r = await fetch('/library');
    libraryData = await r.json();
  } catch {
    libraryData = [];
  }
}

async function loadAllTags() {
  try { allTags = await (await fetch('/tags')).json(); } catch { allTags = []; }
}

async function loadAllTunings() {
  try { allTunings = await (await fetch('/tunings')).json(); } catch { allTunings = []; }
}

async function loadCollections() {
  try { collections = await (await fetch('/collections')).json(); } catch { collections = []; }
}

async function loadSegmentsFor(id) {
  try {
    const r = await fetch('/segments/' + id);
    return await r.json();
  } catch {
    return [];
  }
}

async function loadAllSegmentCounts() {
  // Parallel fetch of segment counts for every library entry. Cheap for ~17 entries.
  const entries = await Promise.all(libraryData.map(async v => {
    const segs = await loadSegmentsFor(v.id);
    return [v.id, Array.isArray(segs) ? segs.length : 0];
  }));
  segCounts = Object.fromEntries(entries);
}

function scheduleSegmentSave() {
  if (!currentVideoId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSegments, 600);
}

async function saveSegments() {
  if (!currentVideoId) return;
  await fetch('/segments/' + currentVideoId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(segments)
  });
  if (saveDotEl) {
    saveDotEl.classList.add('visible');
    setTimeout(() => saveDotEl.classList.remove('visible'), 1200);
  }
  segCounts[currentVideoId] = segments.length;
}

// ── Cookies ───────────────────────────────────────────────────────────────
async function checkCookies() {
  try {
    const { exists } = await fetch('/cookies').then(r => r.json());
    setCookiesUI(exists);
  } catch { /* drawer just stays inactive */ }
}

function setCookiesUI(active) {
  const bar    = document.getElementById('cookiesBar');
  const text   = document.getElementById('cookiesText');
  const remove = document.getElementById('cookiesRemove');
  if (!bar) return;
  bar.classList.toggle('active', active);
  bar.style.cursor = active ? 'default' : 'pointer';
  text.textContent = active
    ? 'cookies.txt loaded — YouTube downloads enabled'
    : 'No cookies.txt — click or drop file to enable downloads';
  remove.style.display = active ? '' : 'none';
}

async function uploadCookies(content) {
  const r = await fetch('/cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content
  });
  if (r.ok) { setCookiesUI(true); setStatus('🍪 cookies.txt loaded'); }
  else      { setStatus('❌ Failed to upload cookies'); }
}

async function removeCookies() {
  await fetch('/cookies', { method: 'DELETE' });
  setCookiesUI(false);
  setStatus('🍪 cookies.txt removed');
}

function cookiesFileChosen(input) {
  const f = input.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => uploadCookies(r.result);
  r.readAsText(f);
  input.value = '';
}
function cookiesDragOver(e) { e.preventDefault(); document.getElementById('cookiesBar').classList.add('dragover'); }
function cookiesDragLeave()  { document.getElementById('cookiesBar').classList.remove('dragover'); }
function cookiesDrop(e) {
  e.preventDefault();
  document.getElementById('cookiesBar').classList.remove('dragover');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => uploadCookies(r.result);
  r.readAsText(f);
}

// ── Download drawer + SSE progress ────────────────────────────────────────
function toggleDownloadPanel() {
  const drawer = document.getElementById('downloadDrawer');
  const btn    = document.getElementById('atlasAddYtBtn');
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    btn?.classList.remove('active');
    btn?.setAttribute('aria-expanded', 'false');
    drawer.addEventListener('transitionend', () => {
      if (!drawer.classList.contains('open')) drawer.hidden = true;
    }, { once: true });
  } else {
    drawer.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      btn?.classList.add('active');
      btn?.setAttribute('aria-expanded', 'true');
      document.getElementById('urlInput').focus();
    });
  }
}

async function loadVideo() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;

  const sessionId = Math.random().toString(36).slice(2);

  const es = new EventSource('/progress/' + sessionId);
  const progressFill  = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const progressWrap  = document.getElementById('progressWrap');
  const loadBtn       = document.getElementById('loadBtn');

  loadBtn.disabled = true;
  progressWrap.style.display = 'block';
  progressFill.style.width   = '0%';
  progressLabel.textContent  = '';
  setStatus('⏳ Fetching info…');

  es.addEventListener('message', e => {
    const { percent, speed, eta } = JSON.parse(e.data);
    progressFill.style.width  = percent + '%';
    progressLabel.textContent = `${percent}%  ·  ${speed}  ·  ETA ${eta}`;
    setStatus('⏳ Downloading…');
  });

  es.addEventListener('done', async e => {
    es.close();
    progressWrap.style.display = 'none';
    progressLabel.textContent  = '';
    loadBtn.disabled = false;

    const d = JSON.parse(e.data);
    if (d.success) {
      setStatus('✅ ' + d.title);
      await loadLibrary();
      await loadAllSegmentCounts();
      if (currentView === 'atlas' && window.AtlasView) AtlasView.render();
      // Auto-jump straight to Orbit on the new song.
      switchToOrbit(d.id);
      toggleDownloadPanel();
    } else {
      setStatus('❌ ' + d.error);
    }
  });

  es.onerror = () => {
    es.close();
    progressWrap.style.display = 'none';
    progressLabel.textContent  = '';
    loadBtn.disabled = false;
  };

  fetch('/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, sessionId })
  }).catch(() => {
    es.close();
    loadBtn.disabled = false;
    progressWrap.style.display = 'none';
    setStatus('❌ Network error');
  });
}

// ── Speed ─────────────────────────────────────────────────────────────────
function setSpeed(s) {
  s = Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, s)) * 100) / 100;
  currentSpeed = s;
  if (video) video.playbackRate = s;
  if (window.OrbitView) OrbitView.onSpeedChange(s);
}

function resetSpeed() { setSpeed(1); }

// ── Volume (preserved keyboard behavior; UI-less in U1) ───────────────────
function initVolume() {
  if (!video) return;
  const savedVol   = parseFloat(localStorage.getItem(VOL_KEY));
  const savedMuted = localStorage.getItem(MUTE_KEY) === '1';
  const v = Number.isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 1;
  video.volume = v;
  video.muted  = savedMuted;
}

function setVolume(v) {
  if (!video) return;
  v = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  video.volume = v;
  if (v > 0 && video.muted) video.muted = false;
  localStorage.setItem(VOL_KEY, String(v));
  localStorage.setItem(MUTE_KEY, video.muted ? '1' : '0');
  setStatus(video.muted ? 'muted' : `volume ${Math.round(v * 100)}%`);
}

function toggleMute() {
  if (!video) return;
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) setVolume(0.5);
  else {
    localStorage.setItem(MUTE_KEY, video.muted ? '1' : '0');
    setStatus(video.muted ? 'muted' : 'unmuted');
  }
}

// ── Segment CRUD + loop ───────────────────────────────────────────────────
function setIn() {
  if (!video || !video.src) return;
  pendingIn = video.currentTime;
  setStatus(`In → ${fmt(pendingIn, true)}  ·  press O to set Out`);
  if (window.OrbitView) OrbitView.refreshSegments();
}

function setOut() {
  if (pendingIn === null) { setStatus('Set In point first (I)'); return; }
  let a = pendingIn, b = video.currentTime;
  if (b < a) [a, b] = [b, a];
  if (b - a < 0.15) { setStatus('Segment too short (min 0.15s)'); return; }
  segments.push({ start: a, end: b, color: COLORS[segments.length % COLORS.length] });
  pendingIn = null;
  scheduleSegmentSave();
  setStatus(`Segment ${segments.length}: ${fmt(a, true)} → ${fmt(b, true)}  (${fmt(b - a, true)})`);
  if (window.OrbitView) OrbitView.refreshSegments();
}

function toggleLoop() {
  if (!segments.length) { setStatus('Add a segment first'); return; }
  const firstEnabled = segments.findIndex(s => s.loopEnabled !== false);
  if (firstEnabled === -1) { setStatus('Enable at least one segment for the loop'); return; }
  looping = !looping;
  if (looping) {
    loopIdx = firstEnabled;
    video.currentTime = segments[firstEnabled].start;
    video.play().catch(() => {});
  }
  if (window.OrbitView) OrbitView.onLoopChange();
}

function playSingle(i) {
  if (i < 0 || i >= segments.length) return;
  loopIdx = i;
  video.currentTime = segments[i].start;
  video.play().catch(() => {});
  if (window.OrbitView) OrbitView.refreshSegments();
}

function toggleSegmentLoop(i) {
  if (i < 0 || i >= segments.length) return;
  const enabled = segments[i].loopEnabled !== false;
  segments[i].loopEnabled = !enabled;
  scheduleSegmentSave();
  if (window.OrbitView) OrbitView.refreshSegments();
}

function removeSegment(i) {
  segments.splice(i, 1);
  if (loopIdx >= segments.length) loopIdx = 0;
  scheduleSegmentSave();
  if (window.OrbitView) OrbitView.refreshSegments();
}

function clearAll() {
  segments = []; pendingIn = null; looping = false; loopIdx = 0;
  scheduleSegmentSave();
  if (window.OrbitView) OrbitView.refreshSegments();
}

// ── Fullscreen ────────────────────────────────────────────────────────────
function toggleFullscreen() {
  const wrap = document.getElementById('orbitVideoWrap');
  if (!wrap) return;
  if (!document.fullscreenElement) {
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen)?.call(wrap);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
}

// ── Tags + tunings (Notes panel — reused from Orbit) ──────────────────────
const MAX_TAG_LEN = 40, MAX_TAGS_PER_RESOURCE = 20;
const MAX_TUNING_LEN = 40, MAX_TUNINGS_PER_ENTRY = 6;

function getVideoTags() {
  return libraryData.find(v => v.id === currentVideoId)?.tags ?? [];
}

async function setVideoTags(tags) {
  if (!currentVideoId) return;
  const r = await fetch('/library/' + currentVideoId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });
  if (!r.ok) { setStatus('❌ Failed to save tags'); return; }
  const updated = await r.json();
  const entry = libraryData.find(v => v.id === currentVideoId);
  if (entry) entry.tags = updated.tags;
  await loadAllTags();
}

function renderTagRow(row) {
  const tags = getVideoTags();
  row.innerHTML = tags.map((t, i) => `
    <span class="tag-chip">
      ${escapeHtml(t)}<span class="tag-x" data-i="${i}" title="Remove">×</span>
    </span>
  `).join('') + `<input class="tag-input" placeholder="+ tag" maxlength="${MAX_TAG_LEN}" aria-label="Add tag"><div class="tag-suggest"></div>`;

  wireTagInput(row, {
    pool: () => allTags,
    current: getVideoTags,
    commit: async raw => {
      const trimmed = String(raw || '').trim().slice(0, MAX_TAG_LEN);
      if (!trimmed) return;
      const cur = getVideoTags();
      if (cur.length >= MAX_TAGS_PER_RESOURCE) { setStatus('Tag limit reached (20)'); return; }
      if (cur.some(t => t.toLowerCase() === trimmed.toLowerCase())) { setStatus('Tag already added'); return; }
      await setVideoTags([...cur, trimmed]);
      renderTagRow(row);
      row.querySelector('.tag-input').focus();
    },
    onRemove: async i => {
      const next = getVideoTags().filter((_, n) => n !== i);
      await setVideoTags(next);
      renderTagRow(row);
    },
  });
}

function getVideoTunings() {
  return libraryData.find(v => v.id === currentVideoId)?.tunings ?? [];
}

async function setVideoTunings(tunings) {
  if (!currentVideoId) return;
  const r = await fetch('/library/' + currentVideoId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tunings })
  });
  if (!r.ok) { setStatus('❌ Failed to save tunings'); return; }
  const updated = await r.json();
  const entry = libraryData.find(v => v.id === currentVideoId);
  if (entry) entry.tunings = updated.tunings;
  await loadAllTunings();
  // Tile color may have changed — rerender Atlas tiles next time it's shown.
  if (window.OrbitView && currentView === 'orbit') OrbitView.refreshHeader();
}

function renderTuningRow(row) {
  const items = getVideoTunings();
  row.innerHTML = items.map((t, i) => `
    <span class="tag-chip tuning">
      ${escapeHtml(t)}<span class="tag-x" data-i="${i}" title="Remove">×</span>
    </span>
  `).join('') + `<input class="tag-input" placeholder="+ tuning" maxlength="${MAX_TUNING_LEN}" aria-label="Add tuning"><div class="tag-suggest"></div>`;

  wireTagInput(row, {
    pool: () => allTunings,
    current: getVideoTunings,
    commit: async raw => {
      const trimmed = String(raw || '').trim().slice(0, MAX_TUNING_LEN);
      if (!trimmed) return;
      const cur = getVideoTunings();
      if (cur.length >= MAX_TUNINGS_PER_ENTRY) { setStatus(`Tuning limit reached (${MAX_TUNINGS_PER_ENTRY})`); return; }
      if (cur.some(t => t.toLowerCase() === trimmed.toLowerCase())) { setStatus('Tuning already added'); return; }
      const canonical = allTunings.find(t => t.toLowerCase() === trimmed.toLowerCase()) || trimmed;
      await setVideoTunings([...cur, canonical]);
      renderTuningRow(row);
      row.querySelector('.tag-input').focus();
    },
    onRemove: async i => {
      const next = getVideoTunings().filter((_, n) => n !== i);
      await setVideoTunings(next);
      renderTuningRow(row);
    },
  });
}

// Shared autocomplete wiring for tag + tuning rows.
function wireTagInput(row, { pool, current, commit, onRemove }) {
  const inp = row.querySelector('.tag-input');
  const sug = row.querySelector('.tag-suggest');
  let hi = -1;

  row.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', () => onRemove(+x.dataset.i));
  });

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    const cur = current().map(t => t.toLowerCase());
    const matches = pool().filter(t =>
      t.toLowerCase().includes(q) && !cur.includes(t.toLowerCase())
    ).slice(0, 8);
    if (!q || !matches.length) { sug.classList.remove('open'); return; }
    hi = -1;
    sug.innerHTML = matches.map((t, i) =>
      `<div class="tag-suggest-item" data-tag="${escapeHtml(t)}" data-i="${i}">${escapeHtml(t)}</div>`
    ).join('');
    sug.classList.add('open');
    sug.querySelectorAll('.tag-suggest-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        commit(item.dataset.tag);
        sug.classList.remove('open');
        inp.value = '';
      });
    });
  });

  inp.addEventListener('keydown', e => {
    const items = [...sug.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = hi >= 0 && items[hi] ? items[hi].dataset.tag : inp.value;
      commit(pick); sug.classList.remove('open'); inp.value = '';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sug.classList.remove('open'); inp.blur();
    } else if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault(); hi = (hi + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === hi));
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault(); hi = (hi - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === hi));
    }
  });
  inp.addEventListener('blur', () => setTimeout(() => sug.classList.remove('open'), 120));
}

// ── View routing ──────────────────────────────────────────────────────────
function switchToAtlas({ pause = true } = {}) {
  if (pause && video && !video.paused) video.pause();
  currentView = 'atlas';
  localStorage.setItem(VIEW_KEY, 'atlas');
  document.getElementById('orbitRoot').hidden = true;
  document.getElementById('atlasRoot').hidden = false;
  // Defer to rAF so the just-unhidden board has a measurable clientHeight.
  if (window.AtlasView) requestAnimationFrame(() => AtlasView.render());
}

function switchToOrbit(videoId) {
  const entry = libraryData.find(v => v.id === videoId);
  if (!entry) { setStatus('Song not found'); return; }
  currentView = 'orbit';
  localStorage.setItem(VIEW_KEY, 'orbit');
  localStorage.setItem(SONG_KEY, videoId);
  document.getElementById('atlasRoot').hidden = true;
  document.getElementById('orbitRoot').hidden = false;
  if (window.OrbitView) OrbitView.open(entry);
}

// Persist playhead while in Orbit so refresh restores position.
function persistPlayhead() {
  if (currentView !== 'orbit' || !currentVideoId || !video || !video.duration) return;
  localStorage.setItem(TIME_KEY_PREFIX + currentVideoId, String(video.currentTime));
}

// ── Keyboard router ───────────────────────────────────────────────────────
function onKeydown(e) {
  // ⌘K / Ctrl+K — works even from inputs (Atlas only).
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    if (currentView === 'atlas') {
      e.preventDefault();
      const inp = document.getElementById('atlasSearch');
      inp?.focus();
      inp?.select?.();
    }
    return;
  }

  // Esc closes notes panel first; second Esc returns to Atlas.
  if (e.key === 'Escape' && currentView === 'orbit') {
    const notes = document.getElementById('notesPanel');
    if (notes && !notes.hidden) {
      e.preventDefault();
      OrbitView.toggleNotes(false);
      return;
    }
    e.preventDefault();
    switchToAtlas();
    return;
  }

  // Suppress other shortcuts when typing in inputs/textareas.
  if (e.target.matches?.('input, textarea, [contenteditable="true"]')) return;

  if (currentView === 'atlas') {
    if (window.AtlasView && AtlasView.onKey(e)) return;
    return;
  }

  // Orbit: full existing player shortcut set.
  switch (e.key) {
    case 'i': case '[': setIn();  break;
    case 'o': case ']': setOut(); break;
    case ' ':
      e.preventDefault();
      if (!video) break;
      video.paused ? video.play().catch(() => {}) : video.pause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (video) video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (video) video.currentTime = Math.min(video.duration, video.currentTime + 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (video) setVolume(video.volume + VOL_STEP);
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (video) setVolume(video.volume - VOL_STEP);
      break;
    case 'm': toggleMute(); break;
    case ',': if (video) video.currentTime = Math.max(0, video.currentTime - 0.1); break;
    case '.': if (video) video.currentTime = Math.min(video.duration, video.currentTime + 0.1); break;
    case 'l': toggleLoop(); break;
    case 'L': {
      if (!segments.length) { setStatus('Add a segment first'); break; }
      const idx = looping ? loopIdx : 0;
      toggleSegmentLoop(idx);
      break;
    }
    case 'f': toggleFullscreen(); break;
    case '-': setSpeed(currentSpeed - SPEED_STEP); break;
    case '=': setSpeed(currentSpeed + SPEED_STEP); break;
    case '0': setSpeed(1); break;
    case 'd': toggleDownloadPanel(); break;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  video     = document.getElementById('player');
  saveDotEl = document.getElementById('saveDot');
  statusEl  = document.getElementById('status');

  initVolume();

  // Wire video-level notes/artist persistence (Notes panel inputs).
  const videoNotesEl  = document.getElementById('videoNotes');
  const videoArtistEl = document.getElementById('videoArtist');
  videoNotesEl.addEventListener('change', async () => {
    if (!currentVideoId) return;
    const r = await fetch('/library/' + currentVideoId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: videoNotesEl.value })
    });
    if (!r.ok) { setStatus('❌ Failed to save video notes'); return; }
    const updated = await r.json();
    const entry = libraryData.find(v => v.id === currentVideoId);
    if (entry) entry.notes = updated.notes;
  });
  videoArtistEl.addEventListener('change', async () => {
    if (!currentVideoId) return;
    const r = await fetch('/library/' + currentVideoId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: videoArtistEl.value })
    });
    if (!r.ok) { setStatus('❌ Failed to save artist'); return; }
    const updated = await r.json();
    const entry = libraryData.find(v => v.id === currentVideoId);
    if (entry) entry.artist = updated.artist;
    if (window.OrbitView && currentView === 'orbit') OrbitView.refreshHeader();
  });

  // Persist playhead lifecycle.
  video.addEventListener('pause', persistPlayhead);
  window.addEventListener('beforeunload', persistPlayhead);
  setInterval(() => { if (video && !video.paused) persistPlayhead(); }, 5000);

  // Resize → relayout active view.
  window.addEventListener('resize', () => {
    if (currentView === 'orbit' && window.OrbitView) OrbitView.relayout();
    if (currentView === 'atlas' && window.AtlasView) AtlasView.render();
  });

  // Fullscreen state on the FS button.
  const onFs = () => {
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) fsBtn.textContent = document.fullscreenElement ? '⤓' : '⛶';
  };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  // Global keydown.
  document.addEventListener('keydown', onKeydown);

  // Boot data fetches.
  await loadLibrary();
  await Promise.all([loadCollections(), loadAllTags(), loadAllTunings()]);
  await loadAllSegmentCounts();
  checkCookies();

  // Initialize tuning filter from localStorage.
  tuningFilter = localStorage.getItem(TUNING_FILTER_KEY) || null;

  // Route to last view.
  const lastView = localStorage.getItem(VIEW_KEY) || 'atlas';
  const lastSong = localStorage.getItem(SONG_KEY);
  if (lastView === 'orbit' && lastSong && libraryData.some(v => v.id === lastSong)) {
    switchToOrbit(lastSong);
  } else {
    switchToAtlas({ pause: false });
  }

  // Kick off the rAF loop.
  rafLoop();
});
