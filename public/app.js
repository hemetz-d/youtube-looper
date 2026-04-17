const COLORS  = ['#7c6fff','#22c55e','#f97316','#06b6d4','#ec4899','#facc15','#8b5cf6','#10b981'];
const SPEED_PRESETS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25];
const SPEED_STEP = 0.05;
const SPEED_MIN  = 0.25;
const SPEED_MAX  = 2;

const video   = document.getElementById('player');
const tl      = document.getElementById('timeline');
const ph      = document.getElementById('playhead');
const timeBig = document.getElementById('timeBig');
const loopBtn = document.getElementById('loopBtn');

let segments        = [];
let pendingIn       = null;
let looping         = false;
let loopIdx         = 0;
let currentVideoId  = null;
let currentSpeed    = 1;
let saveTimer       = null;
let libraryOpen     = false;
let libraryData     = [];
let allTags         = [];       // autocomplete source (server union)
let collections     = [];       // saved collections
let activeFilter    = [];       // current tag filter (string[])
let activeCollId    = null;     // saved collection id that matches activeFilter exactly, if any

// ── Init ──────────────────────────────────────────────────────────────────
loadLibrary();
loadCollections();
loadAllTags();
checkCookies();

// ── Cookies ───────────────────────────────────────────────────────────────
async function checkCookies() {
  const { exists } = await fetch('/cookies').then(r => r.json());
  setCookiesUI(exists);
}

function setCookiesUI(active) {
  const bar    = document.getElementById('cookiesBar');
  const text   = document.getElementById('cookiesText');
  const remove = document.getElementById('cookiesRemove');
  bar.classList.toggle('active', active);
  bar.style.cursor = active ? 'default' : 'pointer';
  text.textContent = active
    ? 'cookies.txt active'
    : 'No cookies.txt — click or drop file to enable downloads';
  remove.style.display = active ? 'inline-block' : 'none';
}

async function uploadCookies(content) {
  const r = await fetch('/cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content
  });
  if ((await r.json()).success) setCookiesUI(true);
}

async function removeCookies() {
  await fetch('/cookies', { method: 'DELETE' });
  setCookiesUI(false);
}

function cookiesFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => uploadCookies(e.target.result);
  reader.readAsText(file);
  input.value = ''; // reset so same file can be re-selected
}

function cookiesDragOver(e) {
  e.preventDefault();
  document.getElementById('cookiesBar').classList.add('dragover');
}

function cookiesDragLeave(e) {
  document.getElementById('cookiesBar').classList.remove('dragover');
}

function cookiesDrop(e) {
  e.preventDefault();
  document.getElementById('cookiesBar').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => uploadCookies(ev.target.result);
  reader.readAsText(file);
}

// ── rAF loop (playhead + gap-free segment looping) ────────────────────────
(function rafLoop() {
  if (video.duration) {
    const t   = video.currentTime;
    const pct = t / video.duration * 100;
    ph.style.left = pct + '%';
    timeBig.textContent = `${fmt(t, true)} / ${fmt(video.duration)}`;
    document.getElementById('tLeft').textContent = fmt(t);

    // Trigger jump 0.1s early to cover seek latency → nearly gap-free
    if (looping && segments.length && !video.paused) {
      const seg = segments[loopIdx];
      if (t >= seg.end - 0.1) {
        loopIdx = (loopIdx + 1) % segments.length;
        video.currentTime = segments[loopIdx].start;
      }
    }
  }
  requestAnimationFrame(rafLoop);
})();

// ── Library ───────────────────────────────────────────────────────────────
async function loadLibrary() {
  const r = await fetch('/library');
  libraryData = await r.json();
  renderLibrary();
  renderCollections();
  applyCollectionFilter();
}

function renderLibrary() {
  const panel = document.getElementById('libraryPanel');
  const list  = document.getElementById('libraryList');
  const count = document.getElementById('libraryCount');

  if (!libraryData.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  count.textContent = libraryData.length;

  // Open the list on first render so the sidebar shows songs immediately
  if (!libraryOpen) {
    libraryOpen = true;
    list.style.display = 'block';
    document.getElementById('libraryHeader').classList.add('open');
    document.getElementById('libraryChevron').classList.add('open');
  }

  list.innerHTML = libraryData.map((v, i) => `
    <div class="lib-item ${v.id === currentVideoId ? 'active' : ''}" onclick="openFromLibrary(${i})">
      <span class="lib-icon">${v.id === currentVideoId ? '▶' : '○'}</span>
      <span class="lib-title">${v.title}</span>
      ${v.duration ? `<span class="lib-dur">${fmt(v.duration)}</span>` : ''}
      <a class="lib-action" href="${v.file}" download title="Download file" onclick="event.stopPropagation()">↓</a>
      <button class="lib-action del" title="Delete video" onclick="event.stopPropagation(); deleteVideo(${i})">✕</button>
    </div>
  `).join('');
}

function toggleLibrary() {
  libraryOpen = !libraryOpen;
  document.getElementById('libraryList').style.display   = libraryOpen ? 'block' : 'none';
  document.getElementById('libraryHeader').classList.toggle('open', libraryOpen);
  document.getElementById('libraryChevron').classList.toggle('open', libraryOpen);
}

async function openFromLibrary(i) {
  const entry = libraryData[i];
  const { id, file, title } = entry;
  currentVideoId = id;
  video.src = file;
  setStatus('📁 ' + title);
  renderLibrary();

  document.getElementById('videoNotes').value = entry.notes ?? '';
  renderTagRow(document.getElementById('videoTagRow'));

  const r = await fetch('/segments/' + id);
  segments = await r.json();
  looping = false; loopIdx = 0;
  loopBtn.classList.remove('on');
  loopBtn.textContent = '⟳ LOOP';
  resetSpeed();
  redrawTimeline();
  redrawList();
  renderCollections(); // segment-match counts depend on the current video
}

async function deleteVideo(i) {
  const { id, title } = libraryData[i];
  if (!confirm(`Delete "${title}"?\nThis removes the file from disk.`)) return;
  const r = await fetch('/library/' + id, { method: 'DELETE' });
  const d = await r.json();
  if (!d.success) { setStatus('❌ Delete failed'); return; }

  // If the deleted video was playing, reset the player
  if (id === currentVideoId) {
    video.removeAttribute('src');
    video.load();
    currentVideoId = null;
    segments = []; looping = false; loopIdx = 0;
    loopBtn.classList.remove('on');
    loopBtn.textContent = '⟳ LOOP';
    document.getElementById('controlPanel').style.display = 'none';
    document.getElementById('segPanel').style.display     = 'none';
    document.getElementById('notesPanel').style.display   = 'none';
    document.getElementById('videoNotes').value = '';
    document.getElementById('videoTagRow').innerHTML = '';
    redrawList();
    setStatus('🗑 Deleted');
  }
  await loadLibrary();
}

// ── Download with SSE progress ────────────────────────────────────────────
async function loadVideo() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;

  const sessionId = Math.random().toString(36).slice(2);

  // Open SSE stream before the POST so we don't miss early events
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

  es.addEventListener('done', e => {
    es.close();
    progressWrap.style.display = 'none';
    progressLabel.textContent  = '';
    loadBtn.disabled = false;

    const d = JSON.parse(e.data);
    if (d.success) {
      currentVideoId = d.id;
      video.src = d.file;
      setStatus('✅ ' + d.title);
      segments = []; looping = false; loopIdx = 0;
      loopBtn.classList.remove('on');
      loopBtn.textContent = '⟳ LOOP';
      resetSpeed();
      redrawList();
      loadLibrary();
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

  // Fire the download request — response is a secondary confirmation;
  // the real result arrives via the `done` SSE event
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

video.addEventListener('loadedmetadata', () => {
  document.getElementById('controlPanel').style.display = 'flex';
  document.getElementById('segPanel').style.display    = 'block';
  document.getElementById('notesPanel').style.display   = 'block';
  document.getElementById('tRight').textContent = fmt(video.duration);
  redrawTimeline();
});

// ── Video notes ───────────────────────────────────────────────────────────
const videoNotesEl = document.getElementById('videoNotes');
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

// ── Timeline seek ─────────────────────────────────────────────────────────
tl.addEventListener('click', e => {
  if (!video.duration) return;
  if (e.target.classList.contains('seg-handle')) return;
  const r = tl.getBoundingClientRect();
  video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
});

// ── Timeline drag handles ─────────────────────────────────────────────────
tl.addEventListener('mousedown', e => {
  const handle = e.target.closest('.seg-handle');
  if (!handle || !video.duration) return;
  e.preventDefault();
  e.stopPropagation();
  handle.classList.add('dragging');

  const idx  = +handle.dataset.idx;
  const edge = handle.dataset.edge;
  const MIN_SEG = 0.15;
  const rect = tl.getBoundingClientRect();

  const onMove = (ev) => {
    const t = Math.max(0, Math.min(video.duration, ((ev.clientX - rect.left) / rect.width) * video.duration));
    const seg = segments[idx];
    if (edge === 'start') seg.start = Math.min(t, seg.end - MIN_SEG);
    else                  seg.end   = Math.max(t, seg.start + MIN_SEG);
    redrawTimeline();
    // keep the input field(s) in sync without losing focus elsewhere
    const selector = `.seg-time-input[data-idx="${idx}"][data-edge="${edge}"]`;
    const inp = document.querySelector(selector);
    if (inp && document.activeElement !== inp) inp.value = formatEditTime(seg[edge]);
    const durSpan = document.querySelector(`#si${idx} .seg-dur`);
    if (durSpan) durSpan.textContent = ` · ${fmt(seg.end - seg.start, true)}`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    handle.classList.remove('dragging');
    scheduleSegmentSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ── In / Out ──────────────────────────────────────────────────────────────
function setIn() {
  if (!video.src) return;
  pendingIn = video.currentTime;
  redrawTimeline();
  setStatus(`In → ${fmt(pendingIn, true)}  ·  now press O to set Out`);
}

function setOut() {
  if (pendingIn === null) { setStatus('Set In point first (I)'); return; }
  let a = pendingIn, b = video.currentTime;
  if (b < a) [a, b] = [b, a];
  if (b - a < 0.15) { setStatus('Segment too short (min 0.15s)'); return; }
  segments.push({ start: a, end: b, color: COLORS[segments.length % COLORS.length] });
  pendingIn = null;
  redrawTimeline();
  redrawList();
  scheduleSegmentSave();
  setStatus(`Segment ${segments.length}: ${fmt(a, true)} → ${fmt(b, true)}  (${fmt(b - a, true)})`);
}

// ── Playback speed ────────────────────────────────────────────────────────
function setSpeed(s) {
  s = Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, s)) * 100) / 100;
  currentSpeed = s;
  video.playbackRate = s;
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.textContent) === s);
  });
  document.getElementById('speedValue').textContent = s.toFixed(2) + '×';
}

function resetSpeed() {
  setSpeed(1);
}

// ── Loop ──────────────────────────────────────────────────────────────────
function toggleLoop() {
  if (!segments.length) { setStatus('Add a segment first'); return; }
  looping = !looping;
  loopBtn.classList.toggle('on', looping);
  loopBtn.textContent = looping ? '⟳ LOOPING' : '⟳ LOOP';
  if (looping) {
    loopIdx = 0;
    video.currentTime = segments[0].start;
    video.play();
  }
}

function playSingle(i) {
  loopIdx = i;
  video.currentTime = segments[i].start;
  video.play();
}

function removeSegment(i) {
  segments.splice(i, 1);
  if (loopIdx >= segments.length) loopIdx = 0;
  redrawTimeline();
  redrawList();
  scheduleSegmentSave();
}

function clearAll() {
  segments = []; pendingIn = null; looping = false; loopIdx = 0;
  loopBtn.classList.remove('on');
  loopBtn.textContent = '⟳ LOOP';
  redrawTimeline();
  redrawList();
  scheduleSegmentSave();
}

// ── Segment persistence ───────────────────────────────────────────────────
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
  const dot = document.getElementById('saveDot');
  dot.classList.add('visible');
  setTimeout(() => dot.classList.remove('visible'), 1200);
}

// ── Render timeline ───────────────────────────────────────────────────────
function redrawTimeline() {
  tl.querySelectorAll('.seg-bar, .in-marker, .in-label, .seg-handle').forEach(e => e.remove());
  const d = video.duration || 1;

  segments.forEach((seg, i) => {
    const bar = document.createElement('div');
    bar.className = 'seg-bar';
    bar.style.cssText = `left:${seg.start/d*100}%;width:${(seg.end-seg.start)/d*100}%;background:${seg.color};opacity:0.45;`;
    tl.insertBefore(bar, ph);

    if (!video.duration) return;
    const left = document.createElement('div');
    left.className = 'seg-handle';
    left.dataset.idx = i; left.dataset.edge = 'start';
    left.style.left = `calc(${seg.start/d*100}% - 4px)`;
    const right = document.createElement('div');
    right.className = 'seg-handle';
    right.dataset.idx = i; right.dataset.edge = 'end';
    right.style.left = `calc(${seg.end/d*100}% - 4px)`;
    tl.insertBefore(left, ph);
    tl.insertBefore(right, ph);
  });

  if (pendingIn !== null) {
    const pct = pendingIn / d * 100;
    const mk = document.createElement('div');
    mk.className = 'in-marker';
    mk.style.left = pct + '%';
    const lb = document.createElement('div');
    lb.className = 'in-label';
    lb.textContent = 'IN';
    lb.style.left = (pct + 0.3) + '%';
    tl.appendChild(mk);
    tl.appendChild(lb);
  }
}

// ── Render segment list ───────────────────────────────────────────────────
function redrawList() {
  const list = document.getElementById('segList');
  if (!segments.length) {
    list.innerHTML = '<div class="seg-empty">No segments yet — press <kbd>I</kbd> then <kbd>O</kbd> to mark one.</div>';
    return;
  }
  list.innerHTML = segments.map((s, i) => `
    <div class="seg-row" id="sr${i}">
      <div class="seg-item" id="si${i}">
        <div class="seg-dot" style="background:${s.color}25;color:${s.color}">${i + 1}</div>
        <div class="seg-info">
          <input class="seg-label" data-idx="${i}" placeholder="Name segment ${i + 1}" maxlength="80" aria-label="Segment ${i + 1} label">
          <div class="seg-times">
            <input class="seg-time-input" data-idx="${i}" data-edge="start" aria-label="Segment ${i + 1} start time">
            <span class="seg-arrow">→</span>
            <input class="seg-time-input" data-idx="${i}" data-edge="end" aria-label="Segment ${i + 1} end time">
            <span class="seg-dur"> · ${fmt(s.end - s.start, true)}</span>
          </div>
        </div>
        <div class="seg-btns">
          <button class="icon-btn seg-notes-toggle${s.notes ? ' on' : ''}" data-idx="${i}" style="background:#22223a;color:#8a8aa5" title="Notes">📝</button>
          <button class="icon-btn" style="background:${s.color}20;color:${s.color}" onclick="playSingle(${i})" title="Play">▶</button>
          <button class="icon-btn" style="background:#ff446620;color:#ff4466" onclick="removeSegment(${i})" title="Remove">✕</button>
        </div>
      </div>
      <div class="seg-notes-wrap${s.notes ? ' open' : ''}" id="sn${i}">
        <textarea class="seg-notes" data-idx="${i}" placeholder="Notes for segment ${i + 1}…" maxlength="2000" aria-label="Segment ${i + 1} notes"></textarea>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.seg-label').forEach(inp => {
    const idx = +inp.dataset.idx;
    inp.value = segments[idx].label ?? '';
    // commit on blur — `change` fires when value differs from focus-time value
    inp.addEventListener('change', () => {
      segments[idx].label = inp.value;
      scheduleSegmentSave();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        inp.value = segments[idx].label ?? '';  // restore from committed state
        inp.blur();
      }
    });
  });

  const MIN_SEG = 0.15;
  list.querySelectorAll('.seg-time-input').forEach(inp => {
    const idx  = +inp.dataset.idx;
    const edge = inp.dataset.edge; // 'start' | 'end'
    inp.value = formatEditTime(segments[idx][edge]);
    inp.addEventListener('change', () => {
      const parsed = parseTime(inp.value);
      const dur = video.duration || Infinity;
      const other = edge === 'start' ? segments[idx].end : segments[idx].start;
      const valid =
        Number.isFinite(parsed) && parsed >= 0 && parsed <= dur &&
        (edge === 'start' ? parsed + MIN_SEG <= other : parsed - MIN_SEG >= other);
      if (!valid) {
        inp.classList.add('error');
        setStatus(edge === 'start'
          ? `Invalid start — must be < end and ≥ 0`
          : `Invalid end — must be > start and ≤ video duration`);
        // restore prior value after a brief moment so the user sees the error
        setTimeout(() => { inp.value = formatEditTime(segments[idx][edge]); inp.classList.remove('error'); }, 900);
        return;
      }
      segments[idx][edge] = parsed;
      inp.classList.remove('error');
      inp.value = formatEditTime(parsed); // canonicalize
      scheduleSegmentSave();
      redrawTimeline();
      // update the duration span live without a full redrawList (avoids losing focus on siblings)
      const durSpan = inp.parentElement.querySelector('.seg-dur');
      if (durSpan) durSpan.textContent = ` · ${fmt(segments[idx].end - segments[idx].start, true)}`;
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        inp.classList.remove('error');
        inp.value = formatEditTime(segments[idx][edge]);
        inp.blur();
      }
    });
  });

  list.querySelectorAll('.seg-notes').forEach(ta => {
    const idx = +ta.dataset.idx;
    ta.value = segments[idx].notes ?? '';
    ta.addEventListener('change', () => {
      segments[idx].notes = ta.value;
      scheduleSegmentSave();
      // keep the toggle indicator in sync with content
      const toggle = list.querySelector(`.seg-notes-toggle[data-idx="${idx}"]`);
      if (toggle) toggle.classList.toggle('on', !!ta.value.trim());
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); ta.value = segments[idx].notes ?? ''; ta.blur(); }
    });
  });

  list.querySelectorAll('.seg-notes-toggle').forEach(btn => {
    const idx = +btn.dataset.idx;
    btn.addEventListener('click', () => {
      const wrap = document.getElementById('sn' + idx);
      const willOpen = !wrap.classList.contains('open');
      wrap.classList.toggle('open', willOpen);
      if (willOpen) wrap.querySelector('.seg-notes').focus();
    });
  });

  applyCollectionFilter();
}

// ── Keyboard ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
  switch (e.key) {
    case 'i': case '[': setIn();  break;
    case 'o': case ']': setOut(); break;
    case ' ':
      e.preventDefault();
      video.paused ? video.play() : video.pause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      video.currentTime = Math.min(video.duration, video.currentTime + 5);
      break;
    case ',': video.currentTime = Math.max(0, video.currentTime - 0.1); break;
    case '.': video.currentTime = Math.min(video.duration, video.currentTime + 0.1); break;
    case 'l': toggleLoop(); break;
    case 'f': toggleFullscreen(); break;
    case '-': setSpeed(currentSpeed - SPEED_STEP); break;
    case '=': setSpeed(currentSpeed + SPEED_STEP); break;
    case '0': setSpeed(1); break;
    case 'd': toggleDownloadPanel(); break;
  }
});

// ── Tags ──────────────────────────────────────────────────────────────────
const MAX_TAG_LEN = 40, MAX_TAGS_PER_RESOURCE = 20;

async function loadAllTags() {
  try { allTags = await (await fetch('/tags')).json(); } catch { allTags = []; }
}

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
  renderCollections();
  applyCollectionFilter();
}

function renderTagRow(row) {
  const tags = getVideoTags();
  const filterLower = activeFilter.map(t => t.toLowerCase());
  const isMatch = (t) => filterLower.includes(t.toLowerCase());

  row.innerHTML = tags.map((t, i) => `
    <span class="tag-chip${isMatch(t) ? ' match' : ''}">
      ${escapeHtml(t)}<span class="tag-x" data-i="${i}" title="Remove">×</span>
    </span>
  `).join('') + `<input class="tag-input" placeholder="+ tag" maxlength="${MAX_TAG_LEN}" aria-label="Add tag"><div class="tag-suggest"></div>`;

  const inp = row.querySelector('.tag-input');
  const sug = row.querySelector('.tag-suggest');
  let hi = -1;

  const commit = async (raw) => {
    const trimmed = String(raw || '').trim().slice(0, MAX_TAG_LEN);
    if (!trimmed) return;
    const current = getVideoTags();
    if (current.length >= MAX_TAGS_PER_RESOURCE) { setStatus('Tag limit reached (20)'); return; }
    if (current.some(t => t.toLowerCase() === trimmed.toLowerCase())) { setStatus('Tag already added'); return; }
    await setVideoTags([...current, trimmed]);
    renderTagRow(row);
    row.querySelector('.tag-input').focus();
  };

  row.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', async () => {
      const i = +x.dataset.i;
      const next = getVideoTags().filter((_, n) => n !== i);
      await setVideoTags(next);
      renderTagRow(row);
    });
  });

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    const current = getVideoTags().map(t => t.toLowerCase());
    const matches = allTags.filter(t =>
      t.toLowerCase().includes(q) && !current.includes(t.toLowerCase())
    ).slice(0, 8);
    if (!q || !matches.length) { sug.classList.remove('open'); return; }
    hi = -1;
    sug.innerHTML = matches.map((t, i) =>
      `<div class="tag-suggest-item" data-tag="${escapeHtml(t)}" data-i="${i}">${escapeHtml(t)}</div>`
    ).join('');
    sug.classList.add('open');
    sug.querySelectorAll('.tag-suggest-item').forEach(item => {
      item.addEventListener('mousedown', e => { e.preventDefault(); commit(item.dataset.tag); sug.classList.remove('open'); inp.value = ''; });
    });
  });

  inp.addEventListener('keydown', e => {
    const items = [...sug.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = hi >= 0 && items[hi] ? items[hi].dataset.tag : inp.value;
      commit(pick); sug.classList.remove('open'); inp.value = '';
    } else if (e.key === 'Escape') {
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

function renderAllTagRows() {
  // Only the video-notes tag row uses renderTagRow.
  // The filter row (#filterTagRow) renders via renderFilterRow.
  document.querySelectorAll('#videoTagRow.tag-row').forEach(renderTagRow);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Collections / Filter ──────────────────────────────────────────────────
async function loadCollections() {
  try {
    collections = await (await fetch('/collections')).json();
  } catch { collections = []; }
  document.getElementById('collPanel').style.display = 'block';
  refreshFilter();
}

function collMatchCounts(query) {
  const q = query.map(t => t.toLowerCase());
  let videos = 0;
  for (const v of libraryData) {
    const vTags = (v.tags ?? []).map(t => t.toLowerCase());
    if (q.every(t => vTags.includes(t))) videos++;
  }
  return { videos };
}

// Called whenever activeFilter changes — rerenders everything that depends on it.
function refreshFilter() {
  // Derive activeCollId: which saved collection's query matches the current filter exactly?
  activeCollId = null;
  if (activeFilter.length) {
    const filterKey = [...activeFilter].map(t => t.toLowerCase()).sort().join('\0');
    const hit = collections.find(c => {
      const ckey = [...c.query].map(t => t.toLowerCase()).sort().join('\0');
      return ckey === filterKey;
    });
    if (hit) activeCollId = hit.id;
  }
  renderFilterRow();
  renderMatchRow();
  renderCollections();
  applyCollectionFilter();
}

// Filter tag row — a chip picker fed by allTags, writes to activeFilter.
function renderFilterRow() {
  const row = document.getElementById('filterTagRow');
  row.innerHTML = activeFilter.map((t, i) => `
    <span class="tag-chip match">
      ${escapeHtml(t)}<span class="tag-x" data-i="${i}" title="Remove">×</span>
    </span>
  `).join('') + `<input class="tag-input" placeholder="+ pick a tag" maxlength="${MAX_TAG_LEN}" aria-label="Add filter tag"><div class="tag-suggest"></div>`;

  row.querySelectorAll('.tag-x').forEach(x => {
    x.addEventListener('click', () => {
      const i = +x.dataset.i;
      activeFilter = activeFilter.filter((_, n) => n !== i);
      refreshFilter();
    });
  });

  const inp = row.querySelector('.tag-input');
  const sug = row.querySelector('.tag-suggest');
  let hi = -1;

  const commit = (raw) => {
    const trimmed = String(raw || '').trim().slice(0, MAX_TAG_LEN);
    if (!trimmed) return;
    if (activeFilter.some(t => t.toLowerCase() === trimmed.toLowerCase())) return;
    // Use canonical casing from allTags when available
    const canonical = allTags.find(t => t.toLowerCase() === trimmed.toLowerCase()) || trimmed;
    activeFilter.push(canonical);
    refreshFilter();
    setTimeout(() => document.querySelector('#filterTagRow .tag-input')?.focus(), 0);
  };

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    const current = activeFilter.map(t => t.toLowerCase());
    const matches = allTags.filter(t =>
      t.toLowerCase().includes(q) && !current.includes(t.toLowerCase())
    ).slice(0, 8);
    if (!q || !matches.length) { sug.classList.remove('open'); return; }
    hi = -1;
    sug.innerHTML = matches.map((t, i) =>
      `<div class="tag-suggest-item" data-tag="${escapeHtml(t)}" data-i="${i}">${escapeHtml(t)}</div>`
    ).join('');
    sug.classList.add('open');
    sug.querySelectorAll('.tag-suggest-item').forEach(item => {
      item.addEventListener('mousedown', e => { e.preventDefault(); commit(item.dataset.tag); });
    });
  });
  inp.addEventListener('keydown', e => {
    const items = [...sug.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = hi >= 0 && items[hi] ? items[hi].dataset.tag : inp.value;
      commit(pick);
    } else if (e.key === 'Escape') {
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

// Match-count + Save-as row.
function renderMatchRow() {
  const row = document.getElementById('collMatchRow');
  if (!activeFilter.length) {
    row.innerHTML = `<span style="color:#33335a;font-style:italic">Pick one or more tags to filter the library.</span>`;
    return;
  }
  const { videos } = collMatchCounts(activeFilter);
  const countClass = videos ? 'coll-match-count-hit' : 'coll-match-count-miss';
  let saveHtml = '';
  if (activeCollId) {
    const coll = collections.find(c => c.id === activeCollId);
    saveHtml = `<span class="coll-saved-label">· saved as "${escapeHtml(coll.name)}"</span>`;
  } else {
    saveHtml = `<button class="coll-save-btn" id="collSaveBtn">Save as…</button>`;
  }
  row.innerHTML =
    `<span class="${countClass}">${videos} video${videos === 1 ? '' : 's'} match</span>` +
    saveHtml +
    ` <button class="coll-save-btn cancel" id="collClearBtn" title="Clear filter">Clear</button>`;

  document.getElementById('collSaveBtn')?.addEventListener('click', showSaveForm);
  document.getElementById('collClearBtn').addEventListener('click', () => {
    activeFilter = [];
    refreshFilter();
  });
}

function showSaveForm() {
  const row = document.getElementById('collMatchRow');
  row.innerHTML = `
    <input class="coll-name-input" id="collNameInput" placeholder="Collection name" maxlength="80" aria-label="Collection name">
    <button class="coll-save-btn" id="collSaveConfirmBtn">Save</button>
    <button class="coll-save-btn cancel" id="collSaveCancelBtn">Cancel</button>
  `;
  const nameInp = document.getElementById('collNameInput');
  nameInp.focus();
  nameInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitNewColl(); }
    else if (e.key === 'Escape') renderMatchRow();
  });
  document.getElementById('collSaveConfirmBtn').addEventListener('click', submitNewColl);
  document.getElementById('collSaveCancelBtn').addEventListener('click', renderMatchRow);
}

async function submitNewColl() {
  const nameEl = document.getElementById('collNameInput');
  const name = (nameEl?.value || '').trim();
  if (!name) { setStatus('Collection needs a name'); nameEl?.focus(); return; }
  if (!activeFilter.length) { setStatus('Pick at least one tag first'); return; }
  const r = await fetch('/collections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query: activeFilter })
  });
  if (!r.ok) { setStatus('❌ Failed to save collection'); return; }
  const created = await r.json();
  const idx = collections.findIndex(c => c.id === created.id);
  if (idx >= 0) collections[idx] = created; else collections.push(created);
  setStatus(`💾 Saved "${created.name}"`);
  refreshFilter(); // will recompute activeCollId → now matches the new entry
}

function renderCollections() {
  const list = document.getElementById('collList');
  if (!collections.length) {
    list.innerHTML = '<div class="coll-empty">No saved collections yet — pick tags above and "Save as…".</div>';
    return;
  }
  list.innerHTML = collections.map(c => {
    const { videos } = collMatchCounts(c.query);
    return `<span class="coll-chip${c.id === activeCollId ? ' active' : ''}" data-id="${c.id}" title="Click to load this filter">
      ${escapeHtml(c.name)}
      <span class="coll-count">${videos}</span>
      <span class="coll-del" data-id="${c.id}" title="Delete">×</span>
    </span>`;
  }).join('');
  list.querySelectorAll('.coll-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('coll-del')) return;
      const id = chip.dataset.id;
      if (activeCollId === id) {
        activeFilter = [];
      } else {
        const coll = collections.find(c => c.id === id);
        activeFilter = coll ? [...coll.query] : [];
      }
      refreshFilter();
    });
  });
  list.querySelectorAll('.coll-del').forEach(x => {
    x.addEventListener('click', async e => {
      e.stopPropagation();
      const id = x.dataset.id;
      if (!confirm('Delete this collection?')) return;
      const r = await fetch('/collections/' + id, { method: 'DELETE' });
      if (!r.ok) { setStatus('❌ Delete failed'); return; }
      collections = collections.filter(c => c.id !== id);
      refreshFilter();
    });
  });
}

function applyCollectionFilter() {
  const q = activeFilter.map(t => t.toLowerCase());
  const matches = (tags) => {
    if (!q.length) return true;
    const lower = (tags ?? []).map(t => t.toLowerCase());
    return q.every(t => lower.includes(t));
  };
  document.querySelectorAll('.lib-item').forEach((el, i) => {
    el.classList.toggle('dim', !matches(libraryData[i]?.tags));
  });
  // re-render video tag row match highlights
  renderAllTagRows();
}

// ── Utils ─────────────────────────────────────────────────────────────────
function fmt(t, precise = false) {
  if (!isFinite(t) || t < 0) t = 0;
  const m  = Math.floor(t / 60);
  const s  = Math.floor(t % 60);
  const ds = precise ? '.' + Math.floor((t % 1) * 10) : '';
  return `${m}:${String(s).padStart(2, '0')}${ds}`;
}

// mm:ss.ss for editable inputs — two decimal precision.
function formatEditTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Accepts "mm:ss.ss", "m:ss", or bare seconds ("12.34"). Returns NaN on bad input.
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

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ── Download drawer ───────────────────────────────────────────────────────
function toggleDownloadPanel() {
  const drawer = document.getElementById('downloadDrawer');
  const btn    = document.getElementById('downloadToggleBtn');
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
    drawer.addEventListener('transitionend', () => {
      if (!drawer.classList.contains('open')) drawer.hidden = true;
    }, { once: true });
  } else {
    drawer.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      btn.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
      document.getElementById('urlInput').focus();
    });
  }
}

// ── Library search ────────────────────────────────────────────────────────
;(function initLibrarySearch() {
  const inp = document.getElementById('librarySearch');
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    document.querySelectorAll('#libraryList .lib-item').forEach((el, i) => {
      const title = (libraryData[i]?.title ?? '').toLowerCase();
      el.style.display = (!q || title.includes(q)) ? '' : 'none';
    });
  });
})();

// ── Fullscreen ────────────────────────────────────────────────────────────
function toggleFullscreen() {
  const wrap = document.getElementById('videoWrap');
  if (!document.fullscreenElement) {
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen).call(wrap);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

function onFsChange() {
  const inFs = !!document.fullscreenElement;
  const fsBtn = document.getElementById('fsBtn');
  fsBtn.classList.toggle('on', inFs);
  fsBtn.innerHTML = inFs ? '⛶ EXIT <kbd>F</kbd>' : '⛶ FULL <kbd>F</kbd>';
}
