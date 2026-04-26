// views/orbit.js — Orbit circular-timeline view (practice)
//
// Exposes window.OrbitView = {
//   open, relayout, refreshSegments, refreshHeader,
//   togglePlay, toggleNotes, prevSegment, nextSegment,
//   onSpeedChange, onLoopChange,
// }.
// Reads global state from app.js: video, segments, currentVideoId, libraryData,
// looping, loopIdx, currentSpeed.

(function () {
  // Geometry, recomputed on resize / open.
  let cx = 0, cy = 0, R = 0, R2 = 0;
  let svgW = 0, svgH = 0;

  let entry = null;            // current library entry
  let restoreTimePending = NaN;

  // ── Public ─────────────────────────────────────────────────────────────
  function open(libEntry) {
    entry = libEntry;
    currentVideoId = entry.id;

    // Wire <video>.
    if (video.src !== location.origin + entry.file && video.src !== entry.file) {
      video.src = entry.file;
    }
    setStatus('📁 ' + entry.title);

    // Reset loop state for the new song (matches the original openFromLibrary).
    looping = false;
    loopIdx = 0;
    pendingIn = null;

    // Restore last playhead position on loadedmetadata.
    const saved = parseFloat(localStorage.getItem('yl-time-' + entry.id));
    restoreTimePending = Number.isFinite(saved) ? saved : NaN;
    video.addEventListener('loadedmetadata', applyPendingTime, { once: true });

    // Reset speed.
    resetSpeed();

    // Load segments and render.
    loadSegmentsFor(entry.id).then(segs => {
      segments = Array.isArray(segs) ? segs : [];
      refreshHeader();
      refreshSegments();
    });

    // Wire the Notes panel for this entry.
    document.getElementById('videoNotes').value  = entry.notes  ?? '';
    document.getElementById('videoArtist').value = entry.artist ?? '';
    renderTagRow(document.getElementById('videoTagRow'));
    renderTuningRow(document.getElementById('videoTuningRow'));
    document.getElementById('notesPanel').hidden = true;

    // Render header even before segments arrive (title etc).
    refreshHeader();
    relayout();

    // Hook playhead tick.
    window.onPlayheadTick = onTick;

    // Speed slider stops + transport state.
    renderSpeedSlider();
    onSpeedChange(currentSpeed);
    onLoopChange();
  }

  function applyPendingTime() {
    if (!Number.isFinite(restoreTimePending) || !video.duration) return;
    const t = Math.min(video.duration - 0.5, Math.max(0, restoreTimePending));
    if (t > 0.1) video.currentTime = t;
    restoreTimePending = NaN;
  }

  function relayout() {
    computeGeometry();
    drawSvg();
    positionPlayButton();
    positionCard();
  }

  function refreshSegments() {
    refreshHeader();
    drawSvg();
    renderPassages();
    updateVideoChip();
    onLoopChange();
  }

  function refreshHeader() {
    if (!entry) return;
    const tn = primaryTuning(entry);
    const c = tn ? tuningColor(tn) : DEFAULT_TUNING_COLOR;
    document.getElementById('orbitTitle').textContent = entry.title || '(untitled)';
    const meta = document.getElementById('orbitMeta');
    const parts = [];
    if (entry.artist) parts.push(escapeHtml(entry.artist));
    if (tn) parts.push(`<span class="tn-dot" style="background:${c}"></span>${escapeHtml(tn)}`);
    if (entry.duration) parts.push(fmt(entry.duration));
    meta.innerHTML = parts.join(' · ');

    const looped = segments.filter(s => s.loopEnabled !== false).length;
    document.getElementById('orbitLoopedCount').textContent =
      `${looped} looped`;

    // Tuning color drives play-button + playhead color.
    document.documentElement.style.setProperty('--tn-current', c);
    document.documentElement.style.setProperty('--tn-glow', hexToRgba(c, 0.4));
    const playBtn = document.getElementById('orbitPlay');
    if (playBtn) playBtn.style.background = c;
  }

  // ── Geometry ───────────────────────────────────────────────────────────
  function computeGeometry() {
    const orbitTop = 120;
    const orbitBottomMargin = 40;
    const avail = Math.max(360, window.innerHeight - orbitTop - orbitBottomMargin);
    R  = Math.min(290, Math.max(160, (avail - 140) / 2));
    R2 = R - 46;
    cx = Math.max(R + 60, 320);
    cy = orbitTop + R + 30;

    // SVG covers the left half so the right-column doesn't overlap.
    svgW = Math.min(window.innerWidth - 600, cx + R + 80);
    svgH = window.innerHeight;
    if (svgW < cx + R + 40) svgW = cx + R + 40;
  }

  // ── SVG drawing ────────────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';

  function drawSvg() {
    const svg = document.getElementById('orbitSvg');
    if (!svg || !entry) return;
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', svgH);
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Outer ring
    svg.appendChild(circle(cx, cy, R, {
      fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 1,
    }));

    // Inner disc
    svg.appendChild(circle(cx, cy, R2 - 70, {
      fill: 'rgba(255,255,255,0.025)',
    }));

    // Tick marks
    const dur = entry.duration || (video?.duration && isFinite(video.duration) ? video.duration : 0);
    if (dur > 0) {
      for (let t = 0; t <= dur; t += 30) {
        const angle = (t / dur) * 360;
        const a = (angle - 90) * Math.PI / 180;
        const x1 = cx + Math.cos(a) * (R - 4);
        const y1 = cy + Math.sin(a) * (R - 4);
        const x2 = cx + Math.cos(a) * (R + 4);
        const y2 = cy + Math.sin(a) * (R + 4);
        svg.appendChild(line(x1, y1, x2, y2, {
          stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 1,
        }));
        const lx = cx + Math.cos(a) * (R + 26);
        const ly = cy + Math.sin(a) * (R + 26);
        svg.appendChild(text(lx, ly, fmt(t), {
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          'font-size': 10,
          fill: 'rgba(255,255,255,0.4)',
        }));
      }
    }

    // Segment arcs
    if (dur > 0) {
      segments.forEach((s, i) => {
        const a0 = (s.start / dur) * 360;
        const a1 = (s.end   / dur) * 360;
        const isActive = looping && i === loopIdx;
        const isLooped = s.loopEnabled !== false;
        const sw = isActive ? 24 : 14;
        const opacity = isLooped ? 1 : 0.35;
        const path = arcPath(cx, cy, R2, a0, a1);
        const arcEl = createEl('path', {
          d: path, fill: 'none', stroke: s.color, 'stroke-width': sw,
          'stroke-linecap': 'butt', opacity,
          class: 'arc',
          'data-idx': String(i),
        });
        arcEl.addEventListener('click', () => playSingle(i));
        svg.appendChild(arcEl);

        if (isActive) {
          const overlay = createEl('path', {
            d: path, fill: 'none', stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 2,
            'stroke-linecap': 'butt',
          });
          svg.appendChild(overlay);
        }

        // Number label at r=R2-30, counter-rotated to read upright.
        const mid = (a0 + a1) / 2;
        const ar = (mid - 90) * Math.PI / 180;
        const lx = cx + Math.cos(ar) * (R2 - 30);
        const ly = cy + Math.sin(ar) * (R2 - 30);
        svg.appendChild(text(lx, ly, String(i + 1).padStart(2, '0'), {
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          'font-weight': 700,
          'font-size': 10,
          fill: s.color,
        }));
      });
    }

    // Playhead arm + tip dot
    const playhead = createEl('g', { id: 'orbitPlayhead' });
    const tn = primaryTuning(entry);
    const c = tn ? tuningColor(tn) : DEFAULT_TUNING_COLOR;
    playhead.appendChild(line(cx, cy, cx, cy - R, {
      stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round',
    }));
    playhead.appendChild(circle(cx, cy - R, 6, { fill: c }));
    playhead.setAttribute('transform', `rotate(0 ${cx} ${cy})`);
    svg.appendChild(playhead);

    // Center hub
    svg.appendChild(circle(cx, cy, 22, {
      fill: '#0a0810', stroke: 'rgba(255,255,255,0.3)', 'stroke-width': 1,
    }));
    svg.appendChild(circle(cx, cy, 4, { fill: c }));

    // Coach-mark for empty Orbit
    const coach = document.getElementById('orbitCoachmark');
    if (!segments.length) {
      coach.hidden = false;
      coach.style.left = (cx - 110) + 'px';
      coach.style.top  = (cy - 16) + 'px';
      coach.style.width = '220px';
      coach.innerHTML = `Press <span class="kbd">I</span> then <span class="kbd">O</span><br>to mark your first segment`;
    } else {
      coach.hidden = true;
    }
  }

  function arcPath(cx, cy, r, startDeg, endDeg) {
    const sa = (startDeg - 90) * Math.PI / 180;
    const ea = (endDeg   - 90) * Math.PI / 180;
    const sx = cx + Math.cos(sa) * r;
    const sy = cy + Math.sin(sa) * r;
    const ex = cx + Math.cos(ea) * r;
    const ey = cy + Math.sin(ea) * r;
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  }

  function createEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function circle(cx, cy, r, attrs) { return createEl('circle', { cx, cy, r, ...(attrs || {}) }); }
  function line(x1, y1, x2, y2, attrs) { return createEl('line', { x1, y1, x2, y2, ...(attrs || {}) }); }
  function text(x, y, content, attrs) {
    const el = createEl('text', { x, y, ...(attrs || {}) });
    el.textContent = content;
    return el;
  }

  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(124,111,255,${a})`;
    return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
  }

  // ── Play button + Now-Looping card positioning ────────────────────────
  function positionPlayButton() {
    const btn = document.getElementById('orbitPlay');
    if (!btn) return;
    btn.style.left = (cx - 36) + 'px';
    btn.style.top  = (cy - 36) + 'px';
  }

  function positionCard() {
    const card = document.getElementById('nowLoopingCard');
    if (!card) return;
    card.style.left = (cx - 145) + 'px';
    card.style.top  = (cy + R - R2 + 70) + 'px';
  }

  // ── rAF tick: update playhead, time-fine, progress ────────────────────
  function onTick(t, dur) {
    if (!entry) return;
    const D = dur || entry.duration || 0;
    if (!D) return;

    // Playhead arm rotation.
    const angle = (t / D) * 360;
    const ph = document.getElementById('orbitPlayhead');
    if (ph) ph.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);

    // Now-Looping card content.
    const card = document.getElementById('nowLoopingCard');
    if (segments.length) {
      card.hidden = false;
      const seg = segments[Math.min(loopIdx, segments.length - 1)];
      const sq = document.getElementById('nlColorSquare');
      if (sq) sq.style.background = seg.color;
      document.getElementById('nlTimeFine').textContent = fmtTimeFine(t);
      const label = seg.label && seg.label.trim() ? seg.label : `Segment ${loopIdx + 1}`;
      document.getElementById('nlLabel').textContent = label;
      const dur = seg.end - seg.start;
      document.getElementById('nlRange').textContent = `${fmt(seg.start)} → ${fmt(seg.end)} · ${dur.toFixed(1)}s`;
      const within = Math.max(0, Math.min(dur, t - seg.start));
      const pct = dur > 0 ? (within / dur) * 100 : 0;
      const fill = document.getElementById('nlProgress');
      if (fill) {
        fill.style.width = pct + '%';
        fill.style.background = seg.color;
      }
    } else {
      card.hidden = true;
    }

    // Video chip (bottom-left of video).
    updateVideoChip();
  }

  function updateVideoChip() {
    const chip = document.getElementById('orVideoChip');
    if (!chip) return;
    if (!segments.length || !entry) { chip.hidden = true; return; }
    chip.hidden = false;
    const seg = segments[Math.min(loopIdx, segments.length - 1)];
    document.getElementById('orVideoChipSquare').style.background = seg.color;
    const label = seg.label && seg.label.trim() ? seg.label : `Segment ${loopIdx + 1}`;
    document.getElementById('orVideoChipText').textContent =
      `${label} · ${currentSpeed.toFixed(2)}×`;
  }

  // ── Speed slider ──────────────────────────────────────────────────────
  function renderSpeedSlider() {
    const slider = document.getElementById('orSpeedSlider');
    if (!slider) return;
    const stops = [
      { v: 0.5,  label: '0.5×' },
      { v: 0.75, label: '0.75×' },
      { v: 1.0,  label: '1×' },
      { v: 1.25, label: '1.25×' },
    ];
    const innerHtml = ['<div class="or-speed-track"></div>'];
    for (const s of stops) {
      const pct = ((s.v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
      innerHtml.push(`<div class="or-speed-stop" data-v="${s.v}" style="left:${pct}%; top:50%; transform:translate(-50%,-50%);" tabindex="0"></div>`);
      innerHtml.push(`<span class="or-speed-stop-label" style="left:${pct}%;">${s.label}</span>`);
    }
    innerHtml.push(`<div class="or-speed-thumb" id="orSpeedThumb"></div>`);
    slider.innerHTML = innerHtml.join('');

    slider.querySelectorAll('.or-speed-stop').forEach(stop => {
      stop.addEventListener('click', () => setSpeed(+stop.dataset.v));
      stop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSpeed(+stop.dataset.v); }
      });
    });

    // Drag anywhere on the slider to set speed.
    let dragging = false;
    const apply = ev => {
      const rect = slider.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const pct = x / rect.width;
      const v = SPEED_MIN + pct * (SPEED_MAX - SPEED_MIN);
      setSpeed(Math.round(v * 20) / 20); // 0.05 increments
    };
    slider.addEventListener('mousedown', e => {
      dragging = true; slider.classList.add('dragging'); apply(e);
      const onMove = ev => { if (dragging) apply(ev); };
      const onUp = () => {
        dragging = false; slider.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function onSpeedChange(s) {
    const ro = document.getElementById('orSpeedReadout');
    if (ro) ro.textContent = s.toFixed(2) + '×';
    const stops = document.querySelectorAll('#orSpeedSlider .or-speed-stop');
    stops.forEach(st => st.classList.toggle('active', Math.abs((+st.dataset.v) - s) < 0.001));
    const thumb = document.getElementById('orSpeedThumb');
    if (thumb) {
      const pct = ((s - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;
      thumb.style.left = pct + '%';
      thumb.style.top  = '50%';
      thumb.style.transform = 'translate(-50%, -50%)';
      thumb.style.display = 'block';
    }
    updateVideoChip();
  }

  // ── Loop / transport ───────────────────────────────────────────────────
  function onLoopChange() {
    const btn = document.getElementById('orLoopBtn');
    if (btn) {
      btn.classList.toggle('on', looping);
      btn.innerHTML = (looping ? '⟳ Looping ' : '⟳ Loop ') + '<kbd>L</kbd>';
    }
    const chip = document.getElementById('orVideoLoopChip');
    if (chip) {
      chip.classList.toggle('on', looping);
      chip.textContent = looping ? 'LOOP on' : 'LOOP off';
    }
    drawSvg();
    renderPassages();
  }

  function prevSegment() {
    if (!segments.length) return;
    const enabled = enabledIdxList();
    if (!enabled.length) return;
    const pos = enabled.indexOf(loopIdx);
    const prev = enabled[(pos - 1 + enabled.length) % enabled.length];
    playSingle(prev);
  }
  function nextSegment() {
    if (!segments.length) return;
    const enabled = enabledIdxList();
    if (!enabled.length) return;
    const pos = enabled.indexOf(loopIdx);
    const next = enabled[(pos + 1) % enabled.length];
    playSingle(next);
  }
  function enabledIdxList() {
    return segments.map((s, i) => s.loopEnabled !== false ? i : -1).filter(i => i !== -1);
  }

  function togglePlay() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else              video.pause();
  }

  // ── Passages chip cloud ────────────────────────────────────────────────
  function renderPassages() {
    const wrap = document.getElementById('orPassages');
    if (!wrap) return;
    if (!segments.length) {
      wrap.innerHTML = `<div class="or-passages-empty">No segments yet — press <span class="kbd">I</span> then <span class="kbd">O</span> to mark one.</div>`;
      return;
    }
    const html = segments.map((s, i) => {
      const isLooped = s.loopEnabled !== false;
      const isActive = i === loopIdx;
      const label = s.label && s.label.trim() ? s.label : `Segment ${i + 1}`;
      const style = isActive
        ? `background:${s.color}; border-color:transparent;`
        : `border-left:3px solid ${s.color};`;
      return `
        <button class="passage-chip${isLooped ? ' looped' : ''}${isActive ? ' active' : ''}"
                data-idx="${i}"
                style="${style}"
                role="listitem">
          <span class="pc-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="pc-label">${escapeHtml(label)}</span>
        </button>
      `;
    }).join('');
    wrap.innerHTML = html;
    wrap.querySelectorAll('.passage-chip').forEach(c => {
      c.addEventListener('click', () => {
        const idx = +c.dataset.idx;
        playSingle(idx);
      });
    });
  }

  // ── Notes panel ────────────────────────────────────────────────────────
  function toggleNotes(force) {
    const panel = document.getElementById('notesPanel');
    if (!panel) return;
    const willOpen = (force === undefined) ? panel.hidden : !!force;
    panel.hidden = !willOpen;
    if (willOpen) panel.querySelector('input, textarea')?.focus();
  }

  // ── Expose ────────────────────────────────────────────────────────────
  window.OrbitView = {
    open, relayout, refreshSegments, refreshHeader,
    togglePlay, toggleNotes, prevSegment, nextSegment,
    onSpeedChange, onLoopChange,
  };
})();
