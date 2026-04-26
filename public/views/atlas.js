// views/atlas.js — Atlas tile-board view (home / library)
//
// Exposes window.AtlasView = { render, focusSearch, onKey }.
// Reads global state from app.js: libraryData, segCounts, tuningFilter, currentVideoId.

(function () {
  let highlightedIdx = 0;
  let searchQuery   = '';
  let searchTimer   = null;

  // ── Top-level render ───────────────────────────────────────────────────
  function render() {
    renderMeta();
    renderTuningRail();
    renderTileBoard();
    renderNowStrip();
    wireSearch();
  }

  function renderMeta() {
    const meta = document.getElementById('atlasMeta');
    if (!meta) return;
    const songs = libraryData.length;
    const tunings = uniqueTunings(libraryData).length;
    meta.textContent = `${songs} song${songs === 1 ? '' : 's'} · ${tunings} tuning${tunings === 1 ? '' : 's'}`;
  }

  function renderTuningRail() {
    const rail = document.getElementById('tuningRail');
    if (!rail) return;
    const tunings = uniqueTunings(libraryData);

    const allActive = tuningFilter === null;
    const html = [];
    html.push(`<button class="tuning-pill${allActive ? ' active' : ''}"
                       data-tuning=""
                       style="${allActive ? 'background:' + 'rgba(245,240,230,0.95)' : ''}"
                       aria-pressed="${allActive}">All</button>`);
    for (const t of tunings) {
      const c = tuningColor(t);
      const active = tuningFilter && t.toLowerCase() === tuningFilter.toLowerCase();
      const style = active
        ? `background:${c}; color:#0a0810; border-color:transparent;`
        : '';
      html.push(`
        <button class="tuning-pill${active ? ' active' : ''}"
                data-tuning="${escapeHtml(t)}"
                style="${style}"
                aria-pressed="${active}">
          <span class="tn-dot" style="background:${c}"></span>
          ${escapeHtml(t)}
        </button>
      `);
    }
    rail.innerHTML = html.join('');

    rail.querySelectorAll('.tuning-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.tuning || null;
        tuningFilter = (v && tuningFilter && v.toLowerCase() === tuningFilter.toLowerCase()) ? null : v;
        if (tuningFilter) localStorage.setItem('yl-tuning-filter', tuningFilter);
        else              localStorage.removeItem('yl-tuning-filter');
        highlightedIdx = 0;
        renderTuningRail();
        renderTileBoard();
      });
    });
  }

  // ── Filtering ──────────────────────────────────────────────────────────
  function visibleEntries() {
    const q = searchQuery.trim().toLowerCase();
    const tf = tuningFilter ? tuningFilter.toLowerCase() : null;
    return libraryData.filter(v => {
      if (tf) {
        const pt = primaryTuning(v);
        if (!pt || pt.trim().toLowerCase() !== tf) return false;
      }
      if (q) {
        const hay = `${v.title || ''} ${v.artist || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ── Tile packing (greedy row-pack per SPEC §Atlas/Tile packing) ────────
  function tileWeight(e) {
    const segCount = segCounts[e.id] || 0;
    const segWeight = Math.min(6, segCount + 1);
    return segWeight * 1; // recencyWeight=1 until T2.3 lands
  }

  function packTiles(entries, boardW, boardH) {
    if (!entries.length) return [];
    const items = entries.map(e => ({ e, w: tileWeight(e) }));
    const minRowH = 110, maxRowH = 220;
    const estRows = Math.max(1, Math.ceil(boardH / 150));
    let remaining = items.slice();
    let remainingRows = Math.min(estRows, remaining.length);
    let avail = boardH;
    const rows = [];
    while (remaining.length) {
      const tilesPerRow = Math.ceil(remaining.length / Math.max(1, remainingRows));
      const rowItems = remaining.splice(0, tilesPerRow);
      const rowH = Math.max(minRowH, Math.min(maxRowH, avail / Math.max(1, remainingRows) - 8));
      const wSum = rowItems.reduce((s, it) => s + it.w, 0) || 1;
      rows.push({
        height: rowH,
        tiles: rowItems.map(it => ({
          entry:  it.e,
          width:  (it.w / wSum) * boardW,
          height: rowH,
        })),
      });
      avail -= (rowH + 8);
      remainingRows = Math.max(1, remainingRows - 1);
    }
    return rows;
  }

  function levelFor(w, h) {
    if (w > 220 && h > 140) return 'full';
    if (w > 150 && h > 100) return 'med';
    return 'min';
  }

  // ── Tile board render ──────────────────────────────────────────────────
  function renderTileBoard() {
    const board = document.getElementById('tileBoard');
    if (!board) return;
    const entries = visibleEntries();

    if (highlightedIdx >= entries.length) highlightedIdx = Math.max(0, entries.length - 1);

    if (!entries.length) {
      board.innerHTML = `<div class="atlas-board-empty">${
        libraryData.length
          ? 'No songs match this filter.'
          : 'No videos yet. Click + Add YouTube to download one.'
      }</div>`;
      return;
    }

    const boardW = board.clientWidth - 0;
    const boardH = board.clientHeight - 0;
    const rows = packTiles(entries, boardW - 0, boardH - 0);

    const html = [];
    let flatIdx = 0;
    for (const row of rows) {
      html.push(`<div class="tile-row" style="height:${row.height}px;">`);
      for (const t of row.tiles) {
        const e   = t.entry;
        const tn  = primaryTuning(e);
        const c   = tuningColor(tn);
        const lvl = levelFor(t.width, t.height);
        const segCount = segCounts[e.id] || 0;

        let stripHtml = '';
        if (lvl === 'full' && e.duration && segCount > 0) {
          // Synchronous segment-count is enough for the 8px strip here;
          // we don't have the actual ranges without a per-tile fetch, so render
          // an even distribution proportional to count. Small visual hint only.
          // (When the user opens Orbit, real arcs are drawn.)
          const dots = [];
          const step = 100 / segCount;
          for (let i = 0; i < segCount; i++) {
            const left = i * step + step * 0.1;
            const w = step * 0.65;
            dots.push(`<span class="tile-segstrip-bar looped" style="left:${left}%;width:${w}%;background:${c};"></span>`);
          }
          stripHtml = `<div class="tile-segstrip">${dots.join('')}</div>`;
        }

        const stats = lvl !== 'min' ? `
          <div class="tile-stats">
            <span class="stat">${segCount} segment${segCount === 1 ? '' : 's'}</span>
            ${e.duration ? `<span class="stat">${fmt(e.duration)}</span>` : ''}
          </div>
        ` : '';

        const chip = (lvl !== 'min' && tn) ? `
          <span class="tile-tuning-chip">
            <span class="tn-dot" style="background:${c}"></span>
            ${escapeHtml(tn)}
          </span>
        ` : '';

        const isHi = flatIdx === highlightedIdx;
        const tileStyle = `width:${t.width - 8}px; height:${t.height}px; border-color:${isHi ? c : 'var(--border)'};`;

        html.push(`
          <div class="tile level-${lvl} size-${lvl} ${isHi ? 'highlighted' : ''}"
               role="gridcell"
               data-id="${escapeHtml(e.id)}"
               data-flat-idx="${flatIdx}"
               style="${tileStyle}"
               tabindex="0">
            <div class="tile-title">${escapeHtml(e.title || '(untitled)')}</div>
            <div class="tile-artist">${escapeHtml(e.artist || '—')}</div>
            ${chip}
            ${stripHtml}
            ${stats}
            <button class="tile-edit" data-edit-id="${escapeHtml(e.id)}"
                    tabindex="-1" aria-label="Edit metadata"
                    title="Edit artist / tunings / tags / notes">✎</button>
            <button class="tile-play" style="background:${c}" tabindex="-1" aria-label="Open">▶</button>
          </div>
        `);
        flatIdx++;
      }
      html.push(`</div>`);
    }
    board.innerHTML = html.join('');

    board.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', e => {
        // Edit button has its own handler; don't open Orbit on its clicks.
        if (e.target.closest('.tile-edit')) return;
        const id = el.dataset.id;
        const idx = +el.dataset.flatIdx;
        highlightedIdx = idx;
        switchToOrbit(id);
      });
      el.addEventListener('mouseenter', () => {
        highlightedIdx = +el.dataset.flatIdx;
        applyHighlight();
      });
      el.addEventListener('focus', () => {
        highlightedIdx = +el.dataset.flatIdx;
        applyHighlight();
      });
    });
    board.querySelectorAll('.tile-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openEdit(btn.dataset.editId);
      });
    });
  }

  function applyHighlight() {
    const tiles = document.querySelectorAll('#tileBoard .tile');
    tiles.forEach((el, i) => {
      el.classList.toggle('highlighted', i === highlightedIdx);
    });
  }

  function renderNowStrip() {
    const strip = document.getElementById('atlasNow');
    const text  = document.getElementById('atlasNowText');
    if (!strip || !text) return;
    const lastId = localStorage.getItem('yl-song');
    const entry = lastId ? libraryData.find(v => v.id === lastId) : null;
    if (!entry) { strip.hidden = true; return; }
    strip.hidden = false;
    text.innerHTML = `Last practiced: <span class="atlas-now-strong">${escapeHtml(entry.title || '(untitled)')}</span>` +
      (entry.artist ? ` · ${escapeHtml(entry.artist)}` : '');
  }

  // ── Search wiring ──────────────────────────────────────────────────────
  function wireSearch() {
    const inp = document.getElementById('atlasSearch');
    if (!inp || inp.dataset.wired) return;
    inp.dataset.wired = '1';
    inp.value = searchQuery;
    inp.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = inp.value;
        highlightedIdx = 0;
        renderTileBoard();
      }, 400);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const entries = visibleEntries();
        const target = entries[highlightedIdx] || entries[0];
        if (target) switchToOrbit(target.id);
      } else if (e.key === 'Escape') {
        inp.blur();
      }
    });
  }

  // ── Keyboard nav (Atlas-only; called by app.js router) ─────────────────
  function onKey(e) {
    const entries = visibleEntries();
    if (!entries.length) return false;

    switch (e.key) {
      case 'Enter': {
        const target = entries[highlightedIdx] || entries[0];
        if (target) {
          e.preventDefault();
          switchToOrbit(target.id);
        }
        return true;
      }
      case 'ArrowRight':
        e.preventDefault();
        highlightedIdx = (highlightedIdx + 1) % entries.length;
        applyHighlight();
        return true;
      case 'ArrowLeft':
        e.preventDefault();
        highlightedIdx = (highlightedIdx - 1 + entries.length) % entries.length;
        applyHighlight();
        return true;
      case 'ArrowDown':
        e.preventDefault();
        highlightedIdx = Math.min(entries.length - 1, highlightedIdx + 4);
        applyHighlight();
        return true;
      case 'ArrowUp':
        e.preventDefault();
        highlightedIdx = Math.max(0, highlightedIdx - 4);
        applyHighlight();
        return true;
      case 'f': case 'F':
        e.preventDefault();
        document.querySelector('#tuningRail .tuning-pill')?.focus();
        return true;
    }
    return false;
  }

  function focusSearch() {
    document.getElementById('atlasSearch')?.focus();
  }

  // ── Edit panel (artist / tunings / tags / notes) ────────────────────────
  function openEdit(id) {
    const entry = libraryData.find(v => v.id === id);
    if (!entry) return;
    editingVideoId = id;
    const panel = document.getElementById('notesPanel');
    document.getElementById('notesPanelTitle').textContent = 'EDIT SONG';
    document.getElementById('videoTitle').value  = entry.title  ?? '';
    document.getElementById('videoArtist').value = entry.artist ?? '';
    document.getElementById('videoBpm').value    = Number.isFinite(entry.bpm) ? entry.bpm : '';
    document.getElementById('videoNotes').value  = entry.notes  ?? '';
    renderTagRow(document.getElementById('videoTagRow'));
    renderTuningRow(document.getElementById('videoTuningRow'));
    panel.hidden = false;
    panel.querySelector('input, textarea')?.focus();
  }

  function closeEdit() {
    const panel = document.getElementById('notesPanel');
    if (panel) panel.hidden = true;
    editingVideoId = null;
  }

  window.AtlasView = { render, focusSearch, onKey, openEdit, closeEdit };
})();
