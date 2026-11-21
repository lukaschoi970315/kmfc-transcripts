/* ==========================================================================
   근의학 강의 녹취 아카이브 — Client Application
   ========================================================================== */

const STORAGE_KEYS = {
  theme: 'kmfc_theme',
  font: 'kmfc_font',
  size: 'kmfc_size',
  timestamps: 'kmfc_timestamps',
  completed: 'kmfc_completed_lectures',
  notes: 'kmfc_lecture_notes',
  playerCollapsed: 'kmfc_player_collapsed',
};

const state = {
  catalog: null,
  lecturesCache: new Map(),
  searchIndex: null,
  activeLectureId: null,
  activeLecture: null,
  activeTab: 'transcript',
  inpageQuery: '',
  sidebarQuery: '',
  viewMode: 'lecture', // 'lecture' | 'master-glossary'
  completed: new Set(),
  notes: {},
  previewCounter: 0,
  tocObserver: null,
  playerCollapsed: false,
  playerPip: false,
  loadedVideoLectureId: null,
};

const el = {};

function cacheElements() {
  const ids = [
    'siteTitle', 'siteSubtitle', 'brandHomeLink',
    'sidebarToggleBtn', 'sidebarBackdrop', 'librarySidebar',
    'archiveStatsText', 'sidebarFilterInput', 'seriesNav',
    'progressCountLabel', 'progressBarFill',
    'globalSearchInput', 'globalSearchResults',
    'masterGlossaryBtn', 'guideModalBtn', 'themeToggleBtn',
    'themeIconSun', 'themeIconMoon',
    'mainContent', 'lectureView', 'masterGlossaryView',
    'lectureSeriesBadge', 'lectureEpisodeNum', 'lectureCompletedBadge',
    'lectureTitle', 'lectureMetaRow', 'lectureTagsRow',
    'lecturePlayerSection', 'playerTimeIndicator', 'togglePlayerPipBtn',
    'togglePlayerCollapseBtn', 'openExternalPlayerLink', 'playerFrameBox',
    'pipTitleLabel', 'unpinPlayerBtn', 'closePipBtn', 'lectureVideoIframe',
    'pipPlaceholderNotice', 'restorePlayerInlineBtn',
    'tabTranscript', 'tabSummary', 'tabGlossary', 'glossaryCountBadge',
    'inpageSearchInput', 'inpageMatchCount',
    'toggleTimestampsBtn', 'toggleFontBtn', 'fontSizeCycleBtn',
    'copyMarkdownBtn', 'downloadMarkdownBtn', 'printLectureBtn', 'markCompleteBtn',
    'panelTranscript', 'panelSummary', 'panelGlossary',
    'transcriptContainer', 'summaryContainer', 'glossaryContainer',
    'lectureNotesTextarea', 'notesSavedStatus', 'episodePagination',
    'tocRail', 'tocList',
    'backToLectureBtn', 'masterGlossarySearch', 'masterGlossaryCount', 'masterGlossaryGrid',
    'guideModal', 'closeGuideModalBtn', 'localPreviewFileInput', 'downloadTemplateBtn',
    'toastBanner',
  ];
  for (const id of ids) {
    el[id] = document.getElementById(id);
  }
}

/* ---------- Utilities ---------- */

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let toastTimer = null;
function showToast(message) {
  el.toastBanner.textContent = message;
  el.toastBanner.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toastBanner.classList.add('hidden');
  }, 2600);
}

function loadPreferences() {
  try {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    const savedFont = localStorage.getItem(STORAGE_KEYS.font) || 'sans';
    const savedSize = localStorage.getItem(STORAGE_KEYS.size) || 'md';
    const savedTs = localStorage.getItem(STORAGE_KEYS.timestamps);
    const showTs = savedTs === null ? true : savedTs === 'true';
    state.playerCollapsed = localStorage.getItem(STORAGE_KEYS.playerCollapsed) === 'true';

    applyTheme(savedTheme, false);
    applyFont(savedFont, false);
    applySize(savedSize, false);
    applyTimestamps(showTs, false);

    const completedRaw = JSON.parse(localStorage.getItem(STORAGE_KEYS.completed) || '[]');
    if (Array.isArray(completedRaw)) {
      state.completed = new Set(completedRaw);
    }
    const notesRaw = JSON.parse(localStorage.getItem(STORAGE_KEYS.notes) || '{}');
    if (notesRaw && typeof notesRaw === 'object') {
      state.notes = notesRaw;
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  el.themeIconSun.classList.toggle('hidden', !isDark);
  el.themeIconMoon.classList.toggle('hidden', isDark);
  if (persist) localStorage.setItem(STORAGE_KEYS.theme, theme);
}

function applyFont(font, persist = true) {
  document.documentElement.setAttribute('data-font', font);
  el.toggleFontBtn.textContent = font === 'serif' ? '고딕' : '명조';
  el.toggleFontBtn.classList.toggle('active', font === 'serif');
  if (persist) localStorage.setItem(STORAGE_KEYS.font, font);
}

function applySize(size, persist = true) {
  document.documentElement.setAttribute('data-size', size);
  const labels = { sm: '가-', md: '가', lg: '가+' };
  el.fontSizeCycleBtn.textContent = labels[size] || '가';
  if (persist) localStorage.setItem(STORAGE_KEYS.size, size);
}

function applyTimestamps(show, persist = true) {
  document.body.classList.toggle('hide-timestamps', !show);
  el.toggleTimestampsBtn.classList.toggle('active', show);
  el.toggleTimestampsBtn.setAttribute('aria-pressed', String(show));
  if (persist) localStorage.setItem(STORAGE_KEYS.timestamps, String(show));
}

function formatTotalDuration(lectures) {
  const totalSec = lectures.reduce((acc, l) => acc + (Number(l.durationSeconds) || 0), 0);
  if (!totalSec) return `${lectures.length}강`;
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const timeStr = hrs > 0 ? `${hrs}시간 ${mins}분` : `${mins}분`;
  return `${lectures.length}강 · ${timeStr}`;
}

/* ---------- Data Fetching ---------- */

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadLectureData(lectureId) {
  if (state.lecturesCache.has(lectureId)) {
    return state.lecturesCache.get(lectureId);
  }
  const meta = state.catalog.lectures.find((l) => l.id === lectureId);
  if (!meta) throw new Error(`Lecture not found: ${lectureId}`);
  const data = await fetchJson(`./${meta.file}`);
  state.lecturesCache.set(lectureId, data);
  return data;
}

async function ensureAllLecturesLoaded() {
  if (!state.catalog) return;
  await Promise.all(
    state.catalog.lectures.map((item) =>
      loadLectureData(item.id).catch(() => null)
    )
  );
}

/* ---------- Sidebar Rendering ---------- */

function renderSidebar() {
  if (!state.catalog) return;
  const { series, lectures } = state.catalog;
  const filter = state.sidebarQuery.trim().toLowerCase();

  el.archiveStatsText.textContent = formatTotalDuration(lectures);

  const completedCount = lectures.filter((l) => state.completed.has(l.id)).length;
  const pct = lectures.length ? Math.round((completedCount / lectures.length) * 100) : 0;
  el.progressCountLabel.textContent = `${completedCount} / ${lectures.length}강`;
  el.progressBarFill.style.width = `${pct}%`;

  const sortedSeries = [...series].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groupsHtml = sortedSeries
    .map((s) => {
      const items = lectures
        .filter((l) => l.seriesId === s.id)
        .filter((l) => {
          if (!filter) return true;
          const hay = `${l.title} ${(l.tags || []).join(' ')} ${l.instructor || ''}`.toLowerCase();
          return hay.includes(filter);
        })
        .sort((a, b) => (a.episode || 0) - (b.episode || 0));

      if (!items.length && filter) return '';

      const listHtml = items.length
        ? items
            .map((l) => {
              const isActive = l.id === state.activeLectureId && state.viewMode === 'lecture';
              const isDone = state.completed.has(l.id);
              const epLabel = String(l.episode || 1).padStart(2, '0');
              return `
                <li>
                  <button type="button" class="episode-item-btn ${isActive ? 'active' : ''}" data-lecture-id="${escapeHtml(l.id)}">
                    <span class="ep-num">${epLabel}</span>
                    <span class="ep-info">
                      <span class="ep-title">${escapeHtml(l.title)}</span>
                      <span class="ep-sub">
                        <span>${escapeHtml(l.duration || '')}</span>
                        <span>·</span>
                        <span>${escapeHtml(l.date || '')}</span>
                      </span>
                    </span>
                    ${isDone ? '<span class="ep-done-dot" title="학습 완료"></span>' : ''}
                  </button>
                </li>
              `;
            })
            .join('')
        : `<li class="search-empty">등록된 강의가 없습니다.</li>`;

      return `
        <div class="series-group">
          <div class="series-group-header">
            <span class="series-group-title">${escapeHtml(s.title)}</span>
            <span class="series-group-count">${items.length}강</span>
          </div>
          <ul class="episode-list">${listHtml}</ul>
        </div>
      `;
    })
    .join('');

  el.seriesNav.innerHTML = groupsHtml || '<div class="search-empty">일치하는 강의가 없습니다.</div>';

  el.seriesNav.querySelectorAll('.episode-item-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-lecture-id');
      closeMobileSidebar();
      selectLecture(id);
    });
  });
}

/* ---------- Lecture Rendering ---------- */

function highlightText(rawText, query, glossaryTerms) {
  let html = escapeHtml(rawText);

  if (query && query.trim()) {
    const qRe = new RegExp(`(${escapeRegExp(query.trim())})`, 'gi');
    html = html.replace(qRe, '<mark class="search-hit">$1</mark>');
    return html;
  }

  if (Array.isArray(glossaryTerms) && glossaryTerms.length > 0) {
    const sortedTerms = [...glossaryTerms]
      .map((g) => g.term)
      .filter((t) => t && t.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (sortedTerms.length > 0) {
      const termPattern = sortedTerms.map(escapeRegExp).join('|');
      const re = new RegExp(`(${termPattern})`, 'g');
      html = html.replace(re, '<span class="inline-term" data-term="$1">$1</span>');
    }
  }
  return html;
}

function parseTimestampToSeconds(ts) {
  if (!ts) return 0;
  const parts = String(ts).trim().split(':').map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function getVideoBaseEmbedUrl(lecture) {
  if (!lecture) return '';
  if (lecture.videoEmbedUrl) return lecture.videoEmbedUrl;
  if (lecture.videoId) return `https://kakaotv.daum.net/embed/player/cliplink/${encodeURIComponent(lecture.videoId)}`;
  return '';
}

function buildVideoEmbedUrl(lecture, startSeconds = 0, autoplay = false) {
  const base = getVideoBaseEmbedUrl(lecture);
  if (!base) return '';
  const url = new URL(base);
  const sec = Math.max(0, Math.floor(Number(startSeconds) || 0));
  if (sec > 0) url.searchParams.set('start', String(sec));
  if (autoplay) url.searchParams.set('autoplay', '1');
  return url.toString();
}

function updatePlayerControlsUI() {
  if (!el.lecturePlayerSection) return;
  const isPip = state.playerPip;
  const isCollapsed = state.playerCollapsed && !isPip;
  el.lecturePlayerSection.classList.toggle('is-pip', isPip);
  el.lecturePlayerSection.classList.toggle('is-collapsed', isCollapsed);
  el.pipPlaceholderNotice.classList.toggle('hidden', !isPip);
  el.togglePlayerPipBtn.classList.toggle('active', isPip);
  el.togglePlayerPipBtn.setAttribute('aria-pressed', String(isPip));
  el.togglePlayerCollapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
  el.togglePlayerCollapseBtn.textContent = isCollapsed ? '영상 펼치기' : '영상 접기';
}

function renderVideoPlayer(lecture, forceReset = false) {
  const baseUrl = getVideoBaseEmbedUrl(lecture);
  if (!baseUrl) {
    el.lecturePlayerSection.classList.add('hidden');
    if (state.loadedVideoLectureId !== null) {
      el.lectureVideoIframe.src = 'about:blank';
      state.loadedVideoLectureId = null;
    }
    return;
  }

  el.lecturePlayerSection.classList.remove('hidden');
  el.openExternalPlayerLink.href = baseUrl;
  el.pipTitleLabel.textContent = lecture.title || '강의 영상 재생';
  el.lectureVideoIframe.title = `${lecture.title} 강의 영상`;

  if (forceReset || state.loadedVideoLectureId !== lecture.id) {
    el.lectureVideoIframe.src = buildVideoEmbedUrl(lecture, 0, false);
    el.playerTimeIndicator.textContent = '00:00부터 대기';
    state.loadedVideoLectureId = lecture.id;
  }

  updatePlayerControlsUI();
}

function seekVideoTo(timeStr, autoplay = true) {
  if (!state.activeLecture || !getVideoBaseEmbedUrl(state.activeLecture)) return false;
  const sec = parseTimestampToSeconds(timeStr);
  const label = timeStr || '00:00';

  if (state.playerCollapsed) {
    state.playerCollapsed = false;
    try {
      localStorage.setItem(STORAGE_KEYS.playerCollapsed, 'false');
    } catch {}
  }

  el.lectureVideoIframe.src = buildVideoEmbedUrl(state.activeLecture, sec, autoplay);
  el.playerTimeIndicator.textContent = autoplay ? `${label}부터 재생 중` : `${label} 시점 준비됨`;
  state.loadedVideoLectureId = state.activeLecture.id;
  updatePlayerControlsUI();

  if (state.activeLecture.id) {
    window.history.replaceState(
      null,
      '',
      `#lecture=${encodeURIComponent(state.activeLecture.id)}&t=${encodeURIComponent(label)}`
    );
  }
  return true;
}

function renderLecture(lecture) {
  state.activeLecture = lecture;
  state.activeLectureId = lecture.id;
  const series = state.catalog?.series.find((s) => s.id === lecture.seriesId);
  const epNum = String(lecture.episode || 1).padStart(2, '0');

  document.title = `${lecture.title} · ${state.catalog?.site?.title || '근의학 강의 녹취 아카이브'}`;
  el.lectureSeriesBadge.textContent = series ? series.title : '강의 시리즈';
  el.lectureEpisodeNum.textContent = `EP.${epNum}`;
  el.lectureTitle.textContent = lecture.title;

  const isDone = state.completed.has(lecture.id);
  el.lectureCompletedBadge.classList.toggle('hidden', !isDone);
  el.markCompleteBtn.classList.toggle('completed', isDone);
  el.markCompleteBtn.setAttribute('aria-pressed', String(isDone));
  el.markCompleteBtn.textContent = isDone ? '완료됨 ✓' : '완료 체크';

  const metaParts = [];
  if (lecture.instructor) {
    metaParts.push(`<span class="meta-item">강사 <strong>${escapeHtml(lecture.instructor)}</strong></span>`);
  }
  if (lecture.date) {
    metaParts.push(`<span class="meta-item">게시일 <strong>${escapeHtml(lecture.date)}</strong></span>`);
  }
  if (lecture.duration) {
    metaParts.push(`<span class="meta-item">재생시간 <strong>${escapeHtml(lecture.duration)}</strong></span>`);
  }
  if (lecture.sourceUrl) {
    metaParts.push(
      `<span class="meta-item"><a class="meta-source-link" href="${escapeHtml(lecture.sourceUrl)}" target="_blank" rel="noopener noreferrer">원본 게시글 ↗</a></span>`
    );
  }
  el.lectureMetaRow.innerHTML = metaParts.join('');

  el.lectureTagsRow.innerHTML = (lecture.tags || [])
    .map((tag) => `<span class="tag-chip"># ${escapeHtml(tag)}</span>`)
    .join('');

  const glossary = lecture.glossary || [];
  el.glossaryCountBadge.textContent = String(glossary.length);

  renderVideoPlayer(lecture);
  renderTranscriptSections(lecture);
  renderSummaryView(lecture);
  renderGlossaryView(lecture);
  renderToc(lecture.sections || []);
  renderPagination(lecture.id);

  el.lectureNotesTextarea.value = state.notes[lecture.id] || '';
  el.notesSavedStatus.textContent = state.notes[lecture.id] ? '저장됨' : '';

  renderSidebar();
}

function renderTranscriptSections(lecture) {
  const sections = lecture.sections || [];
  const glossary = lecture.glossary || [];
  const query = state.inpageQuery.trim();
  const hasVideo = Boolean(getVideoBaseEmbedUrl(lecture));
  let matchTotal = 0;

  if (query) {
    const qRe = new RegExp(escapeRegExp(query), 'gi');
    for (const sec of sections) {
      for (const p of sec.paragraphs || []) {
        const m = (p.text || '').match(qRe);
        if (m) matchTotal += m.length;
      }
    }
    el.inpageMatchCount.textContent = `${matchTotal}건`;
    el.inpageMatchCount.classList.remove('hidden');
  } else {
    el.inpageMatchCount.classList.add('hidden');
  }

  el.transcriptContainer.innerHTML = sections
    .map((sec) => {
      const paragraphsHtml = (sec.paragraphs || [])
        .map((p, idx) => {
          const blockId = `${sec.id}-p-${idx}`;
          const formatted = highlightText(p.text || '', query, glossary);
          const ts = p.time || sec.timestamp || '';
          const tsTitle = hasVideo
            ? `${ts}부터 영상 재생 (Ctrl/⌘+클릭: 링크 복사)`
            : `링크 복사 (${ts})`;
          return `
            <div class="paragraph-block" id="${escapeHtml(blockId)}" data-time="${escapeHtml(ts)}">
              <button type="button" class="para-time" title="${escapeHtml(tsTitle)}" data-jump-time="${escapeHtml(ts)}">${escapeHtml(ts)}</button>
              <p class="para-text">${formatted}</p>
            </div>
          `;
        })
        .join('');

      const secTime = sec.timestamp || '';
      const secBadgeTitle = hasVideo ? `${secTime} 구간부터 영상 재생` : secTime;
      return `
        <section class="transcript-section" id="${escapeHtml(sec.id)}">
          <div class="section-header">
            <div class="section-title-wrap">
              <h2 class="section-heading">${escapeHtml(sec.title)}</h2>
              ${sec.summary ? `<p class="section-summary">${escapeHtml(sec.summary)}</p>` : ''}
            </div>
            <button type="button" class="section-time-badge" title="${escapeHtml(secBadgeTitle)}" data-jump-time="${escapeHtml(secTime)}">${escapeHtml(secTime)}</button>
          </div>
          <div class="section-body">
            ${paragraphsHtml}
          </div>
        </section>
      `;
    })
    .join('');

  el.transcriptContainer.querySelectorAll('.para-time, .section-time-badge').forEach((node) => {
    node.addEventListener('click', (e) => {
      const t = node.getAttribute('data-jump-time');
      if (!t) return;
      const url = new URL(window.location.href);
      url.hash = `lecture=${encodeURIComponent(lecture.id)}&t=${encodeURIComponent(t)}`;

      if ((e.ctrlKey || e.metaKey) || !hasVideo) {
        navigator.clipboard?.writeText(url.toString()).catch(() => {});
        showToast(`시점 링크가 복사되었습니다 (${t})`);
        return;
      }

      if (seekVideoTo(t, true)) {
        if (!state.playerPip && window.innerWidth >= 900) {
          const rect = el.lecturePlayerSection.getBoundingClientRect();
          if (rect.bottom < 80) {
            state.playerPip = true;
            updatePlayerControlsUI();
          }
        }
        showToast(`▶ ${t} 시점으로 영상을 이동했습니다`);
      }
    });
  });

  el.transcriptContainer.querySelectorAll('.inline-term').forEach((node) => {
    node.addEventListener('click', () => {
      const termName = node.getAttribute('data-term');
      const item = (lecture.glossary || []).find((g) => g.term === termName);
      if (item) {
        showToast(`${item.term}${item.hanjaOrEn ? ` (${item.hanjaOrEn})` : ''}: ${item.definition}`);
      }
    });
  });

  setupTocObserver();
}

function renderSummaryView(lecture) {
  const takeawaysHtml = (lecture.keyTakeaways || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');

  const outlineHtml = (lecture.sections || [])
    .map(
      (sec) => `
      <button type="button" class="chapter-outline-item" data-jump-section="${escapeHtml(sec.id)}">
        <span class="section-time-badge">${escapeHtml(sec.timestamp || '')}</span>
        <div>
          <div style="font-weight:600;color:var(--ink-primary);margin-bottom:2px;">${escapeHtml(sec.title)}</div>
          ${sec.summary ? `<div style="font-size:13px;color:var(--ink-muted);">${escapeHtml(sec.summary)}</div>` : ''}
        </div>
      </button>
    `
    )
    .join('');

  el.summaryContainer.innerHTML = `
    <div class="summary-card">
      <h2>강의 개요</h2>
      <p>${escapeHtml(lecture.overview || lecture.summary || '강의 요약이 아직 등록되지 않았습니다.')}</p>
    </div>
    ${
      takeawaysHtml
        ? `<div class="summary-card">
             <h2>핵심 학습 포인트</h2>
             <ul class="takeaway-list">${takeawaysHtml}</ul>
           </div>`
        : ''
    }
    <div class="summary-card">
      <h2>구간별 목차 바로가기</h2>
      <div class="chapter-outline-list">${outlineHtml}</div>
    </div>
  `;

  el.summaryContainer.querySelectorAll('[data-jump-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const secId = btn.getAttribute('data-jump-section');
      switchTab('transcript');
      requestAnimationFrame(() => {
        const target = document.getElementById(secId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
}

function renderGlossaryView(lecture) {
  const glossary = lecture.glossary || [];
  if (!glossary.length) {
    el.glossaryContainer.innerHTML = '<div class="summary-card"><p>이 강의에 등록된 용어 해설이 없습니다.</p></div>';
    return;
  }
  el.glossaryContainer.innerHTML = `
    <div class="glossary-grid">
      ${glossary
        .map(
          (g) => `
          <div class="glossary-card">
            <div class="glossary-card-head">
              <span class="glossary-term">${escapeHtml(g.term)}</span>
              ${g.hanjaOrEn ? `<span class="glossary-sub">${escapeHtml(g.hanjaOrEn)}</span>` : ''}
            </div>
            <p class="glossary-def">${escapeHtml(g.definition)}</p>
            ${
              g.timestamp
                ? `<button type="button" class="glossary-jump-btn" data-jump-time="${escapeHtml(g.timestamp)}" data-section="${escapeHtml(g.sectionId || '')}">
                     ⏱ ${escapeHtml(g.timestamp)} 본문 보기
                   </button>`
                : ''
            }
          </div>
        `
        )
        .join('')}
    </div>
  `;

  el.glossaryContainer.querySelectorAll('.glossary-jump-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      jumpToTimestamp(btn.getAttribute('data-jump-time'), btn.getAttribute('data-section'));
    });
  });
}

function renderToc(sections) {
  el.tocList.innerHTML = sections
    .map(
      (sec) => `
      <li>
        <a href="#${escapeHtml(sec.id)}" class="toc-link" data-toc-id="${escapeHtml(sec.id)}">
          <span class="toc-time">${escapeHtml(sec.timestamp || '')}</span>
          <span>${escapeHtml(sec.title)}</span>
        </a>
      </li>
    `
    )
    .join('');

  el.tocList.querySelectorAll('.toc-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-toc-id');
      if (state.activeTab !== 'transcript') switchTab('transcript');
      requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
}

function setupTocObserver() {
  if (state.tocObserver) state.tocObserver.disconnect();
  const sections = el.transcriptContainer.querySelectorAll('.transcript-section');
  if (!sections.length) return;

  state.tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          el.tocList.querySelectorAll('.toc-link').forEach((a) => {
            a.classList.toggle('active', a.getAttribute('data-toc-id') === id);
          });
          break;
        }
      }
    },
    { rootMargin: '-20% 0px -65% 0px', threshold: 0.01 }
  );

  sections.forEach((sec) => state.tocObserver.observe(sec));
}

function renderPagination(currentId) {
  const ordered = [...state.catalog.lectures].sort((a, b) => {
    if (a.seriesId !== b.seriesId) return a.seriesId.localeCompare(b.seriesId);
    return (a.episode || 0) - (b.episode || 0);
  });
  const idx = ordered.findIndex((l) => l.id === currentId);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  el.episodePagination.innerHTML = `
    <button type="button" class="page-nav-card prev" ${prev ? `data-nav-id="${escapeHtml(prev.id)}"` : 'disabled'}>
      <span class="page-nav-dir">← 이전 강의</span>
      <span class="page-nav-title">${prev ? escapeHtml(prev.title) : '첫 번째 강의입니다'}</span>
    </button>
    <button type="button" class="page-nav-card next" ${next ? `data-nav-id="${escapeHtml(next.id)}"` : 'disabled'}>
      <span class="page-nav-dir">다음 강의 →</span>
      <span class="page-nav-title">${next ? escapeHtml(next.title) : '다음 강의가 추가될 예정입니다'}</span>
    </button>
  `;

  el.episodePagination.querySelectorAll('[data-nav-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectLecture(btn.getAttribute('data-nav-id'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/* ---------- Navigation & View Modes ---------- */

function switchViewMode(mode) {
  state.viewMode = mode;
  const isMaster = mode === 'master-glossary';
  el.lectureView.classList.toggle('hidden', isMaster);
  el.tocRail.classList.toggle('hidden', isMaster);
  el.masterGlossaryView.classList.toggle('hidden', !isMaster);
  el.masterGlossaryBtn.classList.toggle('active', isMaster);
  renderSidebar();
}

function switchTab(tab) {
  state.activeTab = tab;
  const tabs = [
    { name: 'transcript', btn: el.tabTranscript, panel: el.panelTranscript },
    { name: 'summary', btn: el.tabSummary, panel: el.panelSummary },
    { name: 'glossary', btn: el.tabGlossary, panel: el.panelGlossary },
  ];
  for (const item of tabs) {
    const active = item.name === tab;
    item.btn.classList.toggle('active', active);
    item.btn.setAttribute('aria-selected', String(active));
    item.panel.classList.toggle('hidden', !active);
  }
  el.tocRail.style.visibility = tab === 'transcript' && state.viewMode === 'lecture' ? 'visible' : 'hidden';
}

async function selectLecture(lectureId, jumpTime = null, jumpSection = null) {
  switchViewMode('lecture');
  try {
    const data = await loadLectureData(lectureId);
    renderLecture(data);
    if (!jumpTime) {
      window.history.replaceState(null, '', `#lecture=${encodeURIComponent(lectureId)}`);
    } else {
      window.history.replaceState(null, '', `#lecture=${encodeURIComponent(lectureId)}&t=${encodeURIComponent(jumpTime)}`);
      jumpToTimestamp(jumpTime, jumpSection, false);
    }
  } catch (err) {
    showToast('강의를 불러오지 못했습니다.');
    console.error(err);
  }
}

function jumpToTimestamp(timeStr, sectionId = null, autoplayVideo = true) {
  switchTab('transcript');
  if (timeStr && getVideoBaseEmbedUrl(state.activeLecture)) {
    seekVideoTo(timeStr, autoplayVideo);
  }
  requestAnimationFrame(() => {
    let target = null;
    if (timeStr) {
      target = el.transcriptContainer.querySelector(`.paragraph-block[data-time="${CSS.escape(timeStr)}"]`);
      if (!target) {
        const all = [...el.transcriptContainer.querySelectorAll('.paragraph-block')];
        target = all.find((node) => (node.getAttribute('data-time') || '') >= timeStr) || null;
      }
    }
    if (!target && sectionId) {
      target = document.getElementById(sectionId);
    }
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('jump-flash');
      void target.offsetWidth;
      target.classList.add('jump-flash');
      setTimeout(() => target.classList.remove('jump-flash'), 1800);
    }
  });
}

/* ---------- Master Glossary ---------- */

async function openMasterGlossary() {
  switchViewMode('master-glossary');
  renderMasterGlossary();
  await ensureAllLecturesLoaded();
  renderMasterGlossary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMasterGlossary() {
  const q = el.masterGlossarySearch.value.trim().toLowerCase();
  const entries = [];

  for (const meta of state.catalog.lectures) {
    const lecture = state.lecturesCache.get(meta.id);
    if (!lecture) continue;
    for (const g of lecture.glossary || []) {
      entries.push({ ...g, lectureId: lecture.id, lectureTitle: lecture.title });
    }
  }

  const filtered = entries.filter((item) => {
    if (!q) return true;
    const hay = `${item.term} ${item.hanjaOrEn || ''} ${item.definition} ${item.lectureTitle}`.toLowerCase();
    return hay.includes(q);
  });

  el.masterGlossaryCount.textContent = `${filtered.length}개 용어`;
  el.masterGlossaryGrid.innerHTML = filtered.length
    ? filtered
        .map(
          (g) => `
          <div class="glossary-card">
            <div class="glossary-card-head">
              <span class="glossary-term">${escapeHtml(g.term)}</span>
              ${g.hanjaOrEn ? `<span class="glossary-sub">${escapeHtml(g.hanjaOrEn)}</span>` : ''}
            </div>
            <p class="glossary-def">${escapeHtml(g.definition)}</p>
            <div style="font-size:12px;color:var(--ink-muted);margin-top:4px;">${escapeHtml(g.lectureTitle)}</div>
            <button type="button" class="glossary-jump-btn" data-lecture-id="${escapeHtml(g.lectureId)}" data-time="${escapeHtml(g.timestamp || '')}" data-sec="${escapeHtml(g.sectionId || '')}">
              ⏱ ${escapeHtml(g.timestamp || '00:00')} 강의에서 보기
            </button>
          </div>
        `
        )
        .join('')
    : '<div class="summary-card"><p>검색 조건에 맞는 용어가 없습니다.</p></div>';

  el.masterGlossaryGrid.querySelectorAll('.glossary-jump-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectLecture(
        btn.getAttribute('data-lecture-id'),
        btn.getAttribute('data-time'),
        btn.getAttribute('data-sec')
      );
    });
  });
}

/* ---------- Global Cross-Lecture Search ---------- */

async function handleGlobalSearch(query) {
  const q = query.trim();
  if (q.length < 1) {
    el.globalSearchResults.classList.add('hidden');
    el.globalSearchResults.innerHTML = '';
    return;
  }

  await ensureAllLecturesLoaded();
  const qLower = q.toLowerCase();
  const hits = [];

  for (const meta of state.catalog.lectures) {
    const lecture = state.lecturesCache.get(meta.id);
    if (!lecture) continue;

    if (lecture.title.toLowerCase().includes(qLower)) {
      hits.push({
        type: '강의 제목',
        lectureId: lecture.id,
        title: lecture.title,
        snippet: lecture.overview || meta.summary || '',
        time: '00:00',
        sectionId: lecture.sections?.[0]?.id || '',
      });
    }

    for (const g of lecture.glossary || []) {
      const hay = `${g.term} ${g.hanjaOrEn || ''} ${g.definition}`.toLowerCase();
      if (hay.includes(qLower)) {
        hits.push({
          type: `용어 · ${g.term}`,
          lectureId: lecture.id,
          title: lecture.title,
          snippet: g.definition,
          time: g.timestamp || '00:00',
          sectionId: g.sectionId || '',
        });
      }
    }

    for (const sec of lecture.sections || []) {
      for (const p of sec.paragraphs || []) {
        if ((p.text || '').toLowerCase().includes(qLower)) {
          hits.push({
            type: `${sec.title} · ${p.time || sec.timestamp}`,
            lectureId: lecture.id,
            title: lecture.title,
            snippet: p.text,
            time: p.time || sec.timestamp || '',
            sectionId: sec.id,
          });
          if (hits.length >= 24) break;
        }
      }
      if (hits.length >= 24) break;
    }
    if (hits.length >= 24) break;
  }

  if (!hits.length) {
    el.globalSearchResults.innerHTML = '<div class="search-empty">검색 결과가 없습니다.</div>';
  } else {
    el.globalSearchResults.innerHTML = hits
      .slice(0, 18)
      .map(
        (h) => `
        <button type="button" class="search-result-item" data-lecture-id="${escapeHtml(h.lectureId)}" data-time="${escapeHtml(h.time)}" data-sec="${escapeHtml(h.sectionId)}">
          <span class="search-result-meta">
            <span class="search-result-type">${escapeHtml(h.type)}</span>
            <span>${escapeHtml(h.title)}</span>
          </span>
          <span class="search-result-snippet">${escapeHtml(h.snippet)}</span>
        </button>
      `
      )
      .join('');

    el.globalSearchResults.querySelectorAll('.search-result-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.globalSearchResults.classList.add('hidden');
        selectLecture(
          btn.getAttribute('data-lecture-id'),
          btn.getAttribute('data-time'),
          btn.getAttribute('data-sec')
        );
      });
    });
  }

  el.globalSearchResults.classList.remove('hidden');
}

/* ---------- Markdown Export ---------- */

function buildLectureMarkdown(lecture) {
  const lines = [];
  lines.push(`# ${lecture.title}`);
  lines.push('');
  const meta = [];
  if (lecture.instructor) meta.push(`- **강사**: ${lecture.instructor}`);
  if (lecture.date) meta.push(`- **게시일**: ${lecture.date}`);
  if (lecture.duration) meta.push(`- **재생시간**: ${lecture.duration}`);
  if (lecture.sourceUrl) meta.push(`- **원문 링크**: ${lecture.sourceUrl}`);
  const embedUrl = getVideoBaseEmbedUrl(lecture);
  if (embedUrl) meta.push(`- **영상 바로보기**: ${embedUrl}`);
  if (lecture.tags?.length) meta.push(`- **태그**: ${lecture.tags.join(', ')}`);
  lines.push(...meta, '');

  if (lecture.overview) {
    lines.push('## 강의 개요', '', lecture.overview, '');
  }

  if (lecture.keyTakeaways?.length) {
    lines.push('## 핵심 학습 포인트', '');
    for (const item of lecture.keyTakeaways) lines.push(`- ${item}`);
    lines.push('');
  }

  if (lecture.glossary?.length) {
    lines.push('## 핵심 용어 정리', '');
    for (const g of lecture.glossary) {
      const sub = g.hanjaOrEn ? ` (${g.hanjaOrEn})` : '';
      const t = g.timestamp ? ` [${g.timestamp}]` : '';
      lines.push(`- **${g.term}**${sub}${t}: ${g.definition}`);
    }
    lines.push('');
  }

  lines.push('## 전체 녹취록', '');
  for (const sec of lecture.sections || []) {
    lines.push(`### [${sec.timestamp || ''}] ${sec.title}`, '');
    if (sec.summary) lines.push(`> ${sec.summary}`, '');
    for (const p of sec.paragraphs || []) {
      lines.push(`**[${p.time || ''}]** ${p.text}`, '');
    }
  }

  const userNote = state.notes[lecture.id];
  if (userNote && userNote.trim()) {
    lines.push('## 개인 학습 메모', '', userNote.trim(), '');
  }

  return lines.join('\n');
}

/* ---------- Mobile Sidebar & Modal ---------- */

function openMobileSidebar() {
  el.librarySidebar.classList.add('open');
  el.sidebarBackdrop.classList.remove('hidden');
  el.sidebarToggleBtn.setAttribute('aria-expanded', 'true');
}

function closeMobileSidebar() {
  el.librarySidebar.classList.remove('open');
  el.sidebarBackdrop.classList.add('hidden');
  el.sidebarToggleBtn.setAttribute('aria-expanded', 'false');
}

function downloadFile(filename, content, mimeType = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Event Listeners ---------- */

function bindEvents() {
  el.themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  el.toggleFontBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-font');
    applyFont(current === 'serif' ? 'sans' : 'serif');
  });

  el.fontSizeCycleBtn.addEventListener('click', () => {
    const order = ['sm', 'md', 'lg'];
    const current = document.documentElement.getAttribute('data-size') || 'md';
    const next = order[(order.indexOf(current) + 1) % order.length];
    applySize(next);
  });

  el.toggleTimestampsBtn.addEventListener('click', () => {
    const isHidden = document.body.classList.contains('hide-timestamps');
    applyTimestamps(isHidden);
  });

  el.tabTranscript.addEventListener('click', () => switchTab('transcript'));
  el.tabSummary.addEventListener('click', () => switchTab('summary'));
  el.tabGlossary.addEventListener('click', () => switchTab('glossary'));

  el.sidebarFilterInput.addEventListener('input', (e) => {
    state.sidebarQuery = e.target.value;
    renderSidebar();
  });

  el.inpageSearchInput.addEventListener('input', (e) => {
    state.inpageQuery = e.target.value;
    if (state.activeLecture) renderTranscriptSections(state.activeLecture);
  });

  el.globalSearchInput.addEventListener('input', (e) => {
    handleGlobalSearch(e.target.value);
  });

  el.globalSearchInput.addEventListener('focus', () => {
    if (el.globalSearchInput.value.trim()) {
      el.globalSearchResults.classList.remove('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-wrap')) {
      el.globalSearchResults.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      el.globalSearchInput.focus();
    } else if (e.key === 'Escape') {
      el.globalSearchResults.classList.add('hidden');
      el.guideModal.classList.add('hidden');
      closeMobileSidebar();
    }
  });

  el.markCompleteBtn.addEventListener('click', () => {
    if (!state.activeLecture) return;
    const id = state.activeLecture.id;
    if (state.completed.has(id)) {
      state.completed.delete(id);
      showToast('학습 완료 표시를 해제했습니다.');
    } else {
      state.completed.add(id);
      showToast('학습 완료로 체크했습니다.');
    }
    localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify([...state.completed]));
    renderLecture(state.activeLecture);
  });

  el.lectureNotesTextarea.addEventListener('input', (e) => {
    if (!state.activeLecture) return;
    state.notes[state.activeLecture.id] = e.target.value;
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(state.notes));
    el.notesSavedStatus.textContent = '자동 저장됨';
  });

  el.copyMarkdownBtn.addEventListener('click', async () => {
    if (!state.activeLecture) return;
    const md = buildLectureMarkdown(state.activeLecture);
    try {
      await navigator.clipboard.writeText(md);
      showToast('마크다운 녹취록을 클립보드에 복사했습니다.');
    } catch {
      showToast('복사에 실패했습니다. .md 저장을 이용해 주세요.');
    }
  });

  el.downloadMarkdownBtn.addEventListener('click', () => {
    if (!state.activeLecture) return;
    const md = buildLectureMarkdown(state.activeLecture);
    downloadFile(`${state.activeLecture.id}.md`, md);
    showToast(`${state.activeLecture.id}.md 파일을 저장했습니다.`);
  });

  el.printLectureBtn.addEventListener('click', () => {
    window.print();
  });

  el.masterGlossaryBtn.addEventListener('click', openMasterGlossary);
  el.backToLectureBtn.addEventListener('click', () => switchViewMode('lecture'));
  el.masterGlossarySearch.addEventListener('input', renderMasterGlossary);
  el.brandHomeLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.catalog?.lectures?.length) {
      selectLecture(state.catalog.lectures[0].id);
    }
  });

  el.sidebarToggleBtn.addEventListener('click', () => {
    if (el.librarySidebar.classList.contains('open')) closeMobileSidebar();
    else openMobileSidebar();
  });
  el.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  el.togglePlayerCollapseBtn.addEventListener('click', () => {
    if (state.playerPip) {
      state.playerPip = false;
      state.playerCollapsed = false;
    } else {
      state.playerCollapsed = !state.playerCollapsed;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.playerCollapsed, String(state.playerCollapsed));
    } catch {}
    updatePlayerControlsUI();
  });

  el.togglePlayerPipBtn.addEventListener('click', () => {
    state.playerPip = !state.playerPip;
    if (state.playerPip && state.playerCollapsed) {
      state.playerCollapsed = false;
      try {
        localStorage.setItem(STORAGE_KEYS.playerCollapsed, 'false');
      } catch {}
    }
    updatePlayerControlsUI();
  });

  const exitPipInline = () => {
    state.playerPip = false;
    updatePlayerControlsUI();
  };
  el.unpinPlayerBtn.addEventListener('click', exitPipInline);
  el.restorePlayerInlineBtn.addEventListener('click', exitPipInline);
  el.closePipBtn.addEventListener('click', () => {
    state.playerPip = false;
    state.playerCollapsed = true;
    try {
      localStorage.setItem(STORAGE_KEYS.playerCollapsed, 'true');
    } catch {}
    updatePlayerControlsUI();
  });

  el.guideModalBtn.addEventListener('click', () => el.guideModal.classList.remove('hidden'));
  el.closeGuideModalBtn.addEventListener('click', () => el.guideModal.classList.add('hidden'));
  el.guideModal.addEventListener('click', (e) => {
    if (e.target === el.guideModal) el.guideModal.classList.add('hidden');
  });

  el.localPreviewFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.title || !Array.isArray(parsed.sections)) {
        throw new Error('올바른 녹취 JSON 형식이 아닙니다.');
      }
      state.previewCounter += 1;
      const tempId = parsed.id || `preview-${state.previewCounter}`;
      parsed.id = tempId;
      parsed.seriesId = parsed.seriesId || state.catalog.series[0]?.id || 'kmfc-vol1';
      state.lecturesCache.set(tempId, parsed);
      if (!state.catalog.lectures.some((l) => l.id === tempId)) {
        state.catalog.lectures.push({
          id: tempId,
          seriesId: parsed.seriesId,
          episode: parsed.episode || state.catalog.lectures.length + 1,
          title: `${parsed.title} (미리보기)`,
          instructor: parsed.instructor || '',
          date: parsed.date || '',
          duration: parsed.duration || '',
          durationSeconds: parsed.durationSeconds || 0,
          videoId: parsed.videoId || '',
          videoEmbedUrl: parsed.videoEmbedUrl || '',
          tags: parsed.tags || [],
        });
      }
      el.guideModal.classList.add('hidden');
      selectLecture(tempId);
      showToast('로컬 JSON 녹취본을 미리보기로 불러왔습니다.');
    } catch (err) {
      showToast(err.message || 'JSON 파일을 읽지 못했습니다.');
    } finally {
      e.target.value = '';
    }
  });

  el.downloadTemplateBtn.addEventListener('click', () => {
    const template = {
      id: 'vol1-03-example',
      seriesId: 'kmfc-vol1',
      episode: 3,
      title: '최신근육학총설 3(강의명)',
      instructor: '단송',
      date: '2019-11-20',
      duration: '45:00',
      durationSeconds: 2700,
      sourceUrl: 'https://m.cafe.daum.net/kmfc2/haqk/13',
      videoId: '카카오TV_영상ID_입력',
      tags: ['키워드1', '키워드2'],
      overview: '강의 전체 요약을 여기에 작성합니다.',
      keyTakeaways: ['핵심 요약 포인트 1', '핵심 요약 포인트 2'],
      glossary: [
        {
          term: '용어명',
          hanjaOrEn: 'English / 한자',
          definition: '용어에 대한 핵심 정의를 여기에 작성합니다.',
          timestamp: '00:00',
          sectionId: 'sec-01',
        },
      ],
      sections: [
        {
          id: 'sec-01',
          timestamp: '00:00',
          title: '첫 번째 섹션 제목',
          summary: '구간 요약',
          paragraphs: [
            { time: '00:00', text: '녹취 본문 첫 번째 단락을 여기에 작성합니다.' },
          ],
        },
      ],
    };
    downloadFile('lecture-template.json', JSON.stringify(template, null, 2), 'application/json;charset=utf-8');
  });
}

/* ---------- Boot ---------- */

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(raw);
  return {
    lecture: params.get('lecture'),
    t: params.get('t'),
  };
}

async function init() {
  cacheElements();
  loadPreferences();
  bindEvents();

  try {
    state.catalog = await fetchJson('./data/catalog.json');
    if (state.catalog.site?.title) {
      el.siteTitle.textContent = state.catalog.site.title;
    }
    if (state.catalog.site?.subtitle) {
      el.siteSubtitle.textContent = state.catalog.site.subtitle;
    }

    const { lecture, t } = parseHash();
    const initialId =
      (lecture && state.catalog.lectures.some((l) => l.id === lecture) && lecture) ||
      state.catalog.lectures[0]?.id;

    if (initialId) {
      await selectLecture(initialId, t || null);
    }
  } catch (err) {
    el.lectureTitle.textContent = '아카이브 데이터를 불러오지 못했습니다.';
    el.transcriptContainer.innerHTML = `<div class="summary-card"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

window.addEventListener('DOMContentLoaded', init);
