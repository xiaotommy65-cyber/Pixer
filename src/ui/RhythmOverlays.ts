import {
  BUILTIN_RHYTHM_COURSES,
  type RhythmCourseClearRecord,
  type RhythmCourseDefinition,
  type RhythmPlayerProfileSummary,
} from '../core/rhythm/RhythmProgression.ts';
import {
  TIMING_HISTOGRAM_BINS,
  type RhythmSongProject,
} from '../core/rhythm/RhythmTypes.ts';
import {
  buildJacketFallbackGradient,
  getSongJacketUrl,
} from './RhythmArtRegistry.ts';

/**
 * Modular high-craft UI builders & vector renderers for PA-13 «星脈共鳴 Pulse Resonance».
 * Strictly adheres to Zero-Pill, Zero-Backdrop-Filter, and Native-Button accessibility rules.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Custom bespoke inline <svg> Astral Pulse Crest & Title Emblem for the Title Screen.
 */
export function createAstralCrestSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('width', '76');
  svg.setAttribute('height', '76');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('rhy-crest-svg');

  svg.innerHTML = `
    <defs>
      <linearGradient id="rhyCrestGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fde68a" />
        <stop offset="55%" stop-color="#f59e0b" />
        <stop offset="100%" stop-color="#d97706" />
      </linearGradient>
      <linearGradient id="rhyCrestIce" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#38bdf8" />
        <stop offset="100%" stop-color="#e0f2fe" />
      </linearGradient>
    </defs>
    <circle cx="48" cy="48" r="42" fill="none" stroke="url(#rhyCrestIce)" stroke-width="1.5" stroke-dasharray="14 6 4 6" opacity="0.85" />
    <circle cx="48" cy="48" r="32" fill="rgba(6, 12, 26, 0.72)" stroke="url(#rhyCrestGold)" stroke-width="2" />
    <polygon points="48,10 56,38 86,48 56,58 48,86 40,58 10,48 40,38" fill="url(#rhyCrestGold)" opacity="0.92" />
    <polygon points="48,21 53,42 75,48 53,54 48,75 43,54 21,48 43,42" fill="#071022" />
    <polygon points="48,29 52,44 67,48 52,52 48,67 44,52 29,48 44,44" fill="url(#rhyCrestIce)" />
    <circle cx="48" cy="48" r="4.5" fill="#ffffff" />
  `;
  return svg;
}

/**
 * Compact 24x24 inline SVG icons for Pause / Mute / Workstation Escape buttons.
 */
export function createHudIconSvg(kind: 'pause' | 'volume' | 'muted' | 'exit' | 'play'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.1');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  if (kind === 'pause') {
    svg.innerHTML = `<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>`;
  } else if (kind === 'volume') {
    svg.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.5a9.2 9.2 0 0 1 0 13"/>`;
  } else if (kind === 'muted') {
    svg.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>`;
  } else if (kind === 'play') {
    svg.innerHTML = `<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>`;
  } else {
    svg.innerHTML = `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`;
  }
  return svg;
}

/**
 * Updates a jacket frame element with high-resolution album cover art (`<img>`)
 * and guaranteed Zero-Broken-Image CSS gradient fallback.
 */
export function syncJacketFrame(
  frameEl: HTMLElement,
  imgEl: HTMLImageElement,
  song: RhythmSongProject,
): void {
  frameEl.style.background = buildJacketFallbackGradient(song.accentPrimary, song.accentSecondary);
  const url = getSongJacketUrl(song.id);
  if (url) {
    if (imgEl.dataset.songId !== song.id) {
      imgEl.dataset.songId = song.id;
      imgEl.alt = `${song.title} 專輯封面`;
      imgEl.classList.remove('is-hidden');
      imgEl.onerror = () => {
        imgEl.classList.add('is-hidden');
      };
      imgEl.src = url;
    }
  } else {
    imgEl.dataset.songId = '';
    imgEl.removeAttribute('src');
    imgEl.classList.add('is-hidden');
  }
}

/**
 * Renders the 64-bin chart density sparkline on Song Select.
 */
export function renderDensitySparkline(
  canvas: HTMLCanvasElement,
  bins: readonly number[],
  primaryHex: string,
  secondaryHex: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(7, 12, 24, 0.72)';
  ctx.fillRect(0, 0, w, h);

  const count = Math.max(1, bins.length);
  const stepX = w / count;
  const grad = ctx.createLinearGradient(0, h, 0, 4);
  grad.addColorStop(0, `${primaryHex}44`);
  grad.addColorStop(0.55, primaryHex);
  grad.addColorStop(1, secondaryHex);

  ctx.fillStyle = grad;
  for (let i = 0; i < count; i++) {
    const val = Math.max(0.05, Math.min(1, bins[i] ?? 0));
    const barH = val * (h - 10);
    ctx.fillRect(i * stepX + 0.8, h - barH - 2, Math.max(1.8, stepX - 1.6), barH);
  }
}

/**
 * Renders the 21-bin Early (FAST) / Late (SLOW) millisecond timing histogram on Result Showcase.
 */
export function renderTimingHistogram(
  canvas: HTMLCanvasElement,
  histogram: readonly number[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(7, 12, 24, 0.78)';
  ctx.fillRect(0, 0, w, h);

  const midX = w * 0.5;
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(midX, 6);
  ctx.lineTo(midX, h - 18);
  ctx.stroke();

  let maxVal = 1;
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > maxVal) maxVal = histogram[i];
  }

  const count = Math.max(TIMING_HISTOGRAM_BINS, histogram.length);
  const padX = 14;
  const barW = (w - padX * 2) / count;
  const centerIdx = Math.floor(count / 2);

  for (let i = 0; i < count; i++) {
    const v = histogram[i] ?? 0;
    if (v <= 0) continue;
    const bh = (v / maxVal) * (h - 32);
    const x = padX + i * barW + 1.5;
    const y = h - 18 - bh;
    const dist = Math.abs(i - centerIdx);
    ctx.fillStyle =
      dist <= 1 ? '#f8fafc' : i < centerIdx ? '#38bdf8' : '#f59e0b';
    ctx.fillRect(x, y, Math.max(3, barW - 3), bh);
  }

  ctx.font = '600 10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'left';
  ctx.fillText('FAST -150ms', 12, h - 5);
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.fillText('0ms', midX, h - 5);
  ctx.fillStyle = '#f59e0b';
  ctx.textAlign = 'right';
  ctx.fillText('+150ms SLOW', w - 12, h - 5);
}

/**
 * Renders the 3 built-in Course Mode (段位巡演) cards into `container`.
 */
export function renderCourseCards(params: {
  container: HTMLElement;
  songs: readonly RhythmSongProject[];
  courseRecords: Record<string, RhythmCourseClearRecord>;
  signal: AbortSignal;
  onStartCourse: (course: RhythmCourseDefinition) => void;
  onHover?: () => void;
}): void {
  const { container, songs, courseRecords, signal, onStartCourse, onHover } = params;
  container.innerHTML = '';

  const songLookup = new Map<string, RhythmSongProject>();
  for (const s of songs) songLookup.set(s.id, s);

  for (const course of BUILTIN_RHYTHM_COURSES) {
    const rec = courseRecords[course.id];
    const card = document.createElement('article');
    card.className = 'rhy-course-card';
    card.style.setProperty('--course-accent', course.accentHex);

    const top = document.createElement('div');
    top.className = 'rhy-course-head';

    const tier = document.createElement('span');
    tier.className = 'rhy-course-tier';
    tier.textContent = course.tierCode;

    const medal = document.createElement('span');
    medal.className = `rhy-course-medal ${rec?.cleared ? `is-${rec.medal.toLowerCase()}` : ''}`;
    medal.textContent = rec?.cleared
      ? `${rec.medal === 'GOLD' ? '金章合格' : rec.medal === 'SILVER' ? '銀章合格' : '銅章合格'} · ${rec.avgAccuracy.toFixed(1)}%`
      : `合格門檻 ${course.minPassAccuracy}%`;

    top.append(tier, medal);

    const title = document.createElement('h3');
    title.className = 'rhy-course-title';
    title.textContent = course.title;

    const sub = document.createElement('p');
    sub.className = 'rhy-course-sub';
    sub.textContent = course.subtitle;

    const trackList = document.createElement('ol');
    trackList.className = 'rhy-course-tracks';
    course.stages.forEach((st, idx) => {
      const s = songLookup.get(st.songId);
      const li = document.createElement('li');
      li.className = 'rhy-course-track-row';
      const idxSpan = document.createElement('span');
      idxSpan.className = 'rhy-course-stage-num';
      idxSpan.textContent = `0${idx + 1}`;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'rhy-course-track-name';
      nameSpan.textContent = s ? s.title : st.songId;
      const diffSpan = document.createElement('span');
      diffSpan.className = `rhy-course-track-diff is-${st.difficulty.toLowerCase()}`;
      const lv = s ? s.charts[st.difficulty].level : '?';
      diffSpan.textContent = `${st.difficulty} Lv.${lv}`;
      li.append(idxSpan, nameSpan, diffSpan);
      trackList.appendChild(li);
    });

    const footer = document.createElement('div');
    footer.className = 'rhy-course-foot';
    const bestInfo = document.createElement('span');
    bestInfo.className = 'rhy-course-best';
    bestInfo.textContent = rec
      ? `最高總分 ${rec.totalScore.toLocaleString()} · 剩餘 HP ${Math.round(rec.remainingHp)}%`
      : '3 首連續挑戰 · HP 延續制';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'rhy-btn rhy-btn-primary';
    startBtn.textContent = '挑戰此段位';
    startBtn.addEventListener('click', () => onStartCourse(course), { signal });
    if (onHover) startBtn.addEventListener('mouseenter', onHover, { signal });

    footer.append(bestInfo, startBtn);
    card.append(top, title, sub, trackList, footer);
    container.appendChild(card);
  }
}

/**
 * Renders the Player Profile Rating, stats, and 8 Achievement tiles.
 */
export function renderProfileContent(
  summaryEl: HTMLElement,
  achievementsEl: HTMLElement,
  profile: RhythmPlayerProfileSummary,
): void {
  summaryEl.innerHTML = '';

  const ratingCol = document.createElement('div');
  ratingCol.className = 'rhy-profile-rating-hero';
  const rankKicker = document.createElement('span');
  rankKicker.className = 'rhy-meta-kicker';
  rankKicker.textContent = `PLAYER RATING · ${profile.rankCode}`;
  const ratingVal = document.createElement('div');
  ratingVal.className = 'rhy-profile-rating-num';
  ratingVal.textContent = profile.rating.toFixed(2);
  const rankTitle = document.createElement('div');
  rankTitle.className = 'rhy-profile-rank-title';
  rankTitle.textContent = profile.rankTitle;
  ratingCol.append(rankKicker, ratingVal, rankTitle);

  const statsGrid = document.createElement('div');
  statsGrid.className = 'rhy-profile-stats-grid';
  const statPairs: [string, string][] = [
    ['累計演奏', String(profile.totalPlays)],
    ['通關譜面', String(profile.clearedCharts)],
    ['FULL COMBO', String(profile.fcCount)],
    ['ALL PERFECT', String(profile.apCount)],
    ['段位合格', `${profile.coursesCleared} / ${BUILTIN_RHYTHM_COURSES.length}`],
    ['歷史最高分', profile.bestScore > 0 ? profile.bestScore.toLocaleString() : '—'],
  ];
  for (const [label, value] of statPairs) {
    const cell = document.createElement('div');
    cell.className = 'rhy-profile-stat-cell';
    const l = document.createElement('span');
    l.className = 'rhy-profile-stat-label';
    l.textContent = label;
    const v = document.createElement('strong');
    v.className = 'rhy-profile-stat-val';
    v.textContent = value;
    cell.append(l, v);
    statsGrid.appendChild(cell);
  }

  summaryEl.append(ratingCol, statsGrid);

  achievementsEl.innerHTML = '';
  for (const ach of profile.achievements) {
    const item = document.createElement('div');
    item.className = `rhy-ach-card ${ach.unlocked ? 'is-unlocked' : ''} is-tier-${ach.tier}`;

    const head = document.createElement('div');
    head.className = 'rhy-ach-head';
    const name = document.createElement('strong');
    name.className = 'rhy-ach-title';
    name.textContent = ach.title;
    const prog = document.createElement('span');
    prog.className = 'rhy-ach-progress';
    prog.textContent = ach.unlocked ? '已解鎖' : ach.progressText;
    head.append(name, prog);

    const desc = document.createElement('p');
    desc.className = 'rhy-ach-desc';
    desc.textContent = ach.description;

    item.append(head, desc);
    achievementsEl.appendChild(item);
  }
}
