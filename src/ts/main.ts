import { User } from 'firebase/auth';
import { onAuthChange, loginWithGoogle, logout } from './auth';
import { showToast, openOverlay, closeOverlay, textEl, button } from './ui';
import { submitFeedback } from './feedback';
import { todayKey, labelOf, monthKey, daysInMonth } from './dates';
import {
  SKILLS, SKILL_KEYS, FEELS, FEEL_LABEL, SCORE_LEVELS, skillOf, practiceXp, episodePrompt,
} from './options';
import {
  subscribePractices, subscribeAssessments, createPractice, updatePractice, setEpisode, deletePractice,
  saveAssessment, PracticeInput,
} from './store';
import {
  totalXp, titleOf, skillStats, streak, countByDate, latestAssessment, todaySkill, drillIndex,
} from './stats';
import { Assessment, Feel, Practice, SkillKey } from './types';
import { initClickTracking } from './analytics';

initClickTracking();

// ============================================================
// DOM refs
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const SVG_NS = 'http://www.w3.org/2000/svg';

const loginScreen = $('login-screen');
const appEl = $('app');
const userInfo = $('user-info');
const userAvatar = $<HTMLImageElement>('user-avatar');
const userName = $('user-name');
const btnGoogleLogin = $<HTMLButtonElement>('btn-google-login');
const btnLogout = $<HTMLButtonElement>('btn-logout');

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs__btn'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const countShelf = $('count-shelf');

const todayDateEl = $('today-date');
const todayStreak = $('today-streak');
const todayCount = $('today-count');
const todayTitle = $('today-title');
const assessReminder = $('assess-reminder');
const drillMark = $('drill-mark');
const drillSkill = $('drill-skill');
const drillReason = $('drill-reason');
const drillText = $('drill-text');
const drillTip = $('drill-tip');
const btnDrillDone = $<HTMLButtonElement>('btn-drill-done');
const btnDrillNext = $<HTMLButtonElement>('btn-drill-next');
const todaySkillChips = $('today-skill-chips');
const todayList = $('today-list');

const zukanList = $('zukan-list');

const inputSearch = $<HTMLInputElement>('input-search');
const shelfKindChips = $('shelf-kind-chips');
const shelfChips = $('shelf-chips');
const shelfList = $('shelf-list');

const statTitle = $('stat-title');
const statXp = $('stat-xp');
const statTitleFill = $('stat-title-fill');
const statNext = $('stat-next');
const statTotal = $('stat-total');
const statStreak = $('stat-streak');
const statEpisode = $('stat-episode');
const radarEl = $('radar');
const radarLegend = $('radar-legend');
const radarMemo = $('radar-memo');
const skillLevels = $('skill-levels');
const calTitle = $('cal-title');
const calendarEl = $('calendar');

const btnFab = $<HTMLButtonElement>('btn-fab');
const btnAddInline = $<HTMLButtonElement>('btn-add-inline');

const practiceOverlay = $('practice-modal-overlay');
const practiceForm = $<HTMLFormElement>('practice-form');
const practiceModalTitle = $('practice-modal-title');
const practiceSkillChips = $('practice-skill-chips');
const practiceDrill = $('practice-drill');
const inputDate = $<HTMLInputElement>('input-date');
const inputScene = $<HTMLInputElement>('input-scene');
const inputResult = $<HTMLTextAreaElement>('input-result');
const feelOptions = $('feel-options');
const inputInsight = $<HTMLTextAreaElement>('input-insight');
const inputEpisode = $<HTMLInputElement>('input-episode');
const btnPracticeSubmit = $<HTMLButtonElement>('btn-practice-submit');

const assessOverlay = $('assess-modal-overlay');
const assessForm = $<HTMLFormElement>('assess-form');
const assessModalTitle = $('assess-modal-title');
const scoreScale = $('score-scale');
const assessRows = $('assess-rows');
const inputAssessMemo = $<HTMLTextAreaElement>('input-assess-memo');
const btnAssessSubmit = $<HTMLButtonElement>('btn-assess-submit');

const confirmOverlay = $('confirm-dialog-overlay');
const confirmTitle = $('confirm-dialog-title');
const confirmText = $('confirm-dialog-text');
const btnConfirmCancel = $<HTMLButtonElement>('btn-confirm-cancel');
const btnConfirmOk = $<HTMLButtonElement>('btn-confirm-ok');

const feedbackBtn = $<HTMLButtonElement>('feedback-btn');
const feedbackOverlay = $('feedback-modal-overlay');
const inputFeedbackMessage = $<HTMLTextAreaElement>('input-feedback-message');
const btnFeedbackClose = $<HTMLButtonElement>('btn-feedback-close');
const btnFeedbackSend = $<HTMLButtonElement>('btn-feedback-send');

// ============================================================
// State
// ============================================================
type Tab = 'today' | 'zukan' | 'shelf' | 'growth';
type ShelfKind = 'all' | 'episode';

interface State {
  uid: string | null;
  unsubscribers: (() => void)[];
  practices: Practice[];
  assessments: Assessment[];
  loaded: boolean;
  tab: Tab;
  /** 今日の稽古で、自分で選び直したスキル（null ならおすすめ） */
  pickedSkill: SkillKey | null;
  drillOffset: number;
  shelfSkill: SkillKey | 'all';
  shelfKind: ShelfKind;
  search: string;
  calYear: number;
  calMonth0: number;
  editingId: string | null;
  formSkill: SkillKey;
  formDrill: string;
  formFeel: Feel;
  assessScores: Record<SkillKey, number>;
  pending: Set<string>;
  confirmAction: (() => Promise<void>) | null;
}

const now = new Date();
const state: State = {
  uid: null,
  unsubscribers: [],
  practices: [],
  assessments: [],
  loaded: false,
  tab: 'today',
  pickedSkill: null,
  drillOffset: 0,
  shelfSkill: 'all',
  shelfKind: 'all',
  search: '',
  calYear: now.getFullYear(),
  calMonth0: now.getMonth(),
  editingId: null,
  formSkill: SKILLS[0].key,
  formDrill: '',
  formFeel: 'good',
  assessScores: {} as Record<SkillKey, number>,
  pending: new Set(),
  confirmAction: null,
};

// ============================================================
// Helpers
// ============================================================
const findPractice = (id: string | null): Practice | undefined =>
  (id ? state.practices.find((p) => p.id === id) : undefined);

const currentMonth = (): string => todayKey().slice(0, 7);

/** 同じキーの処理が進行中なら何もしない（二重送信防止） */
async function withLock(key: string, fn: () => Promise<void>, errorMessage = '保存に失敗しました。通信環境を確認してください'): Promise<boolean> {
  if (state.pending.has(key)) return false;
  state.pending.add(key);
  renderAll();
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    showToast(errorMessage);
    return false;
  } finally {
    state.pending.delete(key);
    renderAll();
  }
}

function askConfirm(title: string, text: string, okLabel: string, action: () => Promise<void>): void {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  btnConfirmOk.textContent = okLabel;
  state.confirmAction = action;
  openOverlay(confirmOverlay);
}

function emptyState(text: string): HTMLElement {
  return textEl('p', 'empty-state', text);
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch {
    // クリップボードAPIが使えない環境向けのフォールバック
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    showToast(ok ? done : 'コピーできませんでした');
  }
}

function pill(text: string, className: string): HTMLElement {
  return textEl('span', className, text);
}

function radioChip(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = button(label, `chip${active ? ' is-active' : ''}`, onClick);
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(active));
  return b;
}

function skillMarkEl(key: SkillKey, small = false): HTMLElement {
  return textEl('span', `skill-mark${small ? ' skill-mark--sm' : ''}`, skillOf(key).mark);
}

/** 証拠の棚の1枚を、人に語れる形のテキストにする */
function episodeText(p: Practice): string {
  const s = skillOf(p.skill);
  const lines = [`【${s.name}】`];
  if (p.scene.trim()) lines.push(`場面：${p.scene.trim()}`);
  if (p.drill.trim()) lines.push(`やったこと：${p.drill.trim()}`);
  lines.push(`結果：${p.result.trim()}`);
  if (p.insight.trim()) lines.push(`学び：${p.insight.trim()}`);
  lines.push(`（${labelOf(p.date)}）`);
  return lines.join('\n');
}

// ============================================================
// 今日の稽古
// ============================================================
function currentDrill(): { skill: SkillKey; drill: string; recommended: boolean } {
  const day = todayKey();
  const recommended = todaySkill(state.practices, state.assessments, day);
  const skill = state.pickedSkill ?? recommended;
  const drills = skillOf(skill).drills;
  return { skill, drill: drills[drillIndex(skill, day, state.drillOffset, drills.length)], recommended: skill === recommended };
}

function practiceRow(p: Practice): HTMLElement {
  const s = skillOf(p.skill);
  const card = document.createElement('article');
  card.className = `item-card practice${p.episode ? ' is-episode' : ''}`;
  const head = document.createElement('div');
  head.className = 'item-card__head';
  head.append(
    skillMarkEl(p.skill, true),
    pill(s.name, 'item-card__badge'),
    pill(FEEL_LABEL[p.feel], `feel-pill feel-pill--${p.feel}`),
    pill(`+${practiceXp(p)}XP`, 'xp-pill'),
  );
  if (p.episode) head.appendChild(pill('エピソード', 'episode-pill'));
  card.appendChild(head);
  card.appendChild(textEl('p', 'item-card__meta', `${labelOf(p.date)}${p.scene.trim() ? `・${p.scene.trim()}` : ''}`));
  if (p.drill.trim()) card.appendChild(practiceLine('お題', p.drill, 'practice__row--muted'));
  card.appendChild(practiceLine('やってみて', p.result));
  if (p.insight.trim()) card.appendChild(practiceLine('気づき', p.insight, 'practice__row--insight'));

  const actions = document.createElement('div');
  actions.className = 'item-card__actions';
  if (p.episode) {
    actions.append(
      button('語れる形でコピー', 'btn btn--primary btn--sm', () => void copyText(episodeText(p), 'コピーしました')),
      button('AIで面接用に整える', 'btn btn--ghost btn--sm', () => void copyText(episodePrompt(p), 'AIへの依頼文をコピーしました')),
    );
  }
  const episodeBtn = button(p.episode ? 'エピソードから外す' : 'エピソードに入れる', 'text-btn', () => {
    const uid = state.uid;
    if (!uid) return;
    void withLock(`episode:${p.id}`, async () => {
      await setEpisode(uid, p.id, !p.episode);
      showToast(p.episode ? 'エピソードから外しました' : 'エピソードに入れました +5XP');
    });
  });
  episodeBtn.disabled = state.pending.has(`episode:${p.id}`);
  actions.append(
    episodeBtn,
    button('編集', 'text-btn', () => openPracticeModal({ id: p.id })),
    button('削除', 'text-btn', () => askConfirm('削除しますか？', `${labelOf(p.date)}の「${s.name}」の稽古記録を削除します。元に戻せません。`, '削除する', async () => {
      const uid = state.uid;
      if (!uid) return;
      const ok = await withLock(`delete:${p.id}`, () => deletePractice(uid, p.id), '削除に失敗しました');
      if (ok) showToast('削除しました');
    })),
  );
  card.appendChild(actions);
  return card;
}

function practiceLine(label: string, text: string, className = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = `practice__row${className ? ` ${className}` : ''}`;
  row.append(textEl('span', 'practice__label', label), textEl('p', 'practice__text', text));
  return row;
}

function renderToday(): void {
  const day = todayKey();
  todayDateEl.textContent = labelOf(day);
  todayStreak.textContent = `${streak(state.practices)}日`;
  const todays = state.practices.filter((p) => p.date === day);
  todayCount.textContent = String(todays.length);
  todayTitle.textContent = titleOf(totalXp(state.practices)).name;

  const assessed = state.assessments.some((a) => a.month === currentMonth());
  assessReminder.classList.toggle('hidden', !state.loaded || assessed);

  const { skill, drill, recommended } = currentDrill();
  const s = skillOf(skill);
  drillMark.textContent = s.mark;
  drillSkill.textContent = s.name;
  const latest = latestAssessment(state.assessments);
  drillReason.textContent = !recommended
    ? 'あなたが選んだ力'
    : latest ? `自己評価がいちばん低い力（${latest.scores[skill]}／5）` : '今日の日替わりの力';
  drillText.textContent = drill;
  drillTip.textContent = `コツ：${s.tip}`;

  todaySkillChips.replaceChildren(...SKILLS.map((x) => radioChip(x.name, x.key === skill, () => {
    state.pickedSkill = x.key;
    state.drillOffset = 0;
    renderToday();
  })));

  if (!state.loaded) {
    todayList.replaceChildren(emptyState('読み込み中…'));
    return;
  }
  todayList.replaceChildren(...(todays.length
    ? todays.map(practiceRow)
    : [emptyState('まだ今日の稽古はありません。お題を1つやってみて「やってみた！」で記録しましょう。')]));
}

btnDrillDone.addEventListener('click', () => {
  const { skill, drill } = currentDrill();
  openPracticeModal({ skill, drill });
});

btnDrillNext.addEventListener('click', () => {
  state.drillOffset += 1;
  renderToday();
});

// ============================================================
// 図鑑
// ============================================================
function renderZukan(): void {
  const stats = skillStats(state.practices);
  const latest = latestAssessment(state.assessments);
  zukanList.replaceChildren(...SKILLS.map((s) => {
    const st = stats[s.key];
    const card = document.createElement('article');
    card.className = 'item-card zukan-card';
    const head = document.createElement('div');
    head.className = 'zukan-card__head';
    const titleWrap = document.createElement('div');
    titleWrap.append(textEl('h3', 'zukan-card__name', s.name), textEl('p', 'zukan-card__short', s.short));
    head.append(skillMarkEl(s.key), titleWrap);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'zukan-card__meta';
    meta.append(
      pill(`Lv.${st.level}`, 'level-pill'),
      pill(`稽古${st.count}回`, 'source-pill'),
    );
    if (latest) meta.appendChild(pill(`自己評価 ${latest.scores[s.key]}／5`, 'source-pill'));
    card.appendChild(meta);

    card.appendChild(practiceLine('なぜAIには難しい？', s.whyHuman));
    card.appendChild(practiceLine('稽古のコツ', s.tip, 'practice__row--insight'));

    const details = document.createElement('details');
    details.className = 'zukan-card__drills';
    details.appendChild(textEl('summary', '', `お題の例（${s.drills.length}）`));
    const ul = document.createElement('ul');
    s.drills.forEach((d) => ul.appendChild(textEl('li', '', d)));
    details.appendChild(ul);
    card.appendChild(details);

    const actions = document.createElement('div');
    actions.className = 'item-card__actions';
    actions.append(button('この力で稽古する', 'btn btn--primary btn--sm', () => {
      state.pickedSkill = s.key;
      state.drillOffset = 0;
      switchTab('today');
    }));
    card.appendChild(actions);
    return card;
  }));
}

// ============================================================
// 証拠の棚
// ============================================================
function renderShelf(): void {
  const all = state.practices;
  const episodes = all.filter((p) => p.episode);
  shelfKindChips.replaceChildren(
    radioChip(`すべての記録 ${all.length}`, state.shelfKind === 'all', () => { state.shelfKind = 'all'; renderShelf(); }),
    radioChip(`エピソード ${episodes.length}`, state.shelfKind === 'episode', () => { state.shelfKind = 'episode'; renderShelf(); }),
  );
  const base = state.shelfKind === 'episode' ? episodes : all;
  const used = SKILLS.filter((s) => base.some((p) => p.skill === s.key));
  if (state.shelfSkill !== 'all' && !used.some((s) => s.key === state.shelfSkill)) state.shelfSkill = 'all';
  shelfChips.replaceChildren(
    radioChip('すべての力', state.shelfSkill === 'all', () => { state.shelfSkill = 'all'; renderShelf(); }),
    ...used.map((s) => radioChip(`${s.name} ${base.filter((p) => p.skill === s.key).length}`, state.shelfSkill === s.key, () => {
      state.shelfSkill = s.key;
      renderShelf();
    })),
  );
  shelfChips.classList.toggle('hidden', base.length === 0);

  if (!state.loaded) {
    shelfList.replaceChildren(emptyState('読み込み中…'));
    return;
  }
  const q = state.search.trim().toLowerCase();
  const list = base
    .filter((p) => state.shelfSkill === 'all' || p.skill === state.shelfSkill)
    .filter((p) => !q || [skillOf(p.skill).name, p.drill, p.scene, p.result, p.insight]
      .some((t) => t.toLowerCase().includes(q)));
  shelfList.replaceChildren(...(list.length
    ? list.map(practiceRow)
    : [emptyState(base.length
      ? '条件に合う記録はありません。'
      : state.shelfKind === 'episode'
        ? 'まだエピソードはありません。手応えのあった稽古を「エピソードに入れる」と、ここに並びます。'
        : 'まだ記録はありません。「稽古」タブのお題をやってみて記録しましょう。')]));
}

// ============================================================
// 成長
// ============================================================
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function renderRadar(): void {
  const W = 380;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const R = 100;
  const n = SKILLS.length;
  const pt = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'radar__svg', role: 'img', 'aria-label': '自己評価のレーダーチャート' });

  for (let lv = 1; lv <= 5; lv++) {
    const pts = SKILLS.map((_, i) => pt(i, (R * lv) / 5).join(',')).join(' ');
    root.appendChild(svg('polygon', { points: pts, class: 'radar__grid' }));
  }
  SKILLS.forEach((s, i) => {
    const [x, y] = pt(i, R);
    root.appendChild(svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'radar__axis' }));
    const [lx, ly] = pt(i, R + 18);
    const anchor = Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end';
    const label = svg('text', { x: lx, y: ly + 4, 'text-anchor': anchor, class: 'radar__label' });
    label.textContent = s.label;
    root.appendChild(label);
  });

  const list = state.assessments;
  const latest = list[list.length - 1];
  const prev = list[list.length - 2];
  const shape = (a: Assessment, cls: string): SVGPolygonElement =>
    svg('polygon', { points: SKILLS.map((s, i) => pt(i, (R * a.scores[s.key]) / 5).join(',')).join(' '), class: cls });
  if (prev) root.appendChild(shape(prev, 'radar__shape radar__shape--prev'));
  if (latest) {
    root.appendChild(shape(latest, 'radar__shape'));
    SKILLS.forEach((s, i) => {
      const [x, y] = pt(i, (R * latest.scores[s.key]) / 5);
      root.appendChild(svg('circle', { cx: x, cy: y, r: 3.5, class: 'radar__dot' }));
    });
  }
  radarEl.replaceChildren(root);

  const fmt = (m: string): string => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
  if (!latest) {
    radarLegend.textContent = 'まだ自己評価がありません。月に1回、8つの力をふりかえりましょう。';
  } else {
    radarLegend.textContent = prev ? `実線：${fmt(latest.month)}　点線：${fmt(prev.month)}` : `${fmt(latest.month)}の自己評価`;
  }
  radarMemo.textContent = latest?.memo ? `ひとこと：${latest.memo}` : '';
  radarMemo.classList.toggle('hidden', !latest?.memo);
}

function renderCalendar(): void {
  const y = state.calYear;
  const m0 = state.calMonth0;
  calTitle.textContent = `${y}年${m0 + 1}月の稽古`;
  const counts = countByDate(state.practices);
  const prefix = monthKey(y, m0);
  const cells: HTMLElement[] = ['日', '月', '火', '水', '木', '金', '土'].map((w) => textEl('span', 'calendar__week', w));
  const first = new Date(y, m0, 1).getDay();
  for (let i = 0; i < first; i++) cells.push(textEl('span', 'calendar__cell is-empty', ''));
  const today = todayKey();
  for (let d = 1; d <= daysInMonth(y, m0); d++) {
    const key = `${prefix}-${String(d).padStart(2, '0')}`;
    const c = counts.get(key) ?? 0;
    const cell = textEl('span', `calendar__cell${c ? ` is-done${c >= 3 ? ' is-lv3' : c === 2 ? ' is-lv2' : ''}` : ''}${key === today ? ' is-today' : ''}`, String(d));
    if (c) cell.title = `${c}回稽古`;
    cells.push(cell);
  }
  calendarEl.replaceChildren(...cells);
}

function renderGrowth(): void {
  const xp = totalXp(state.practices);
  const t = titleOf(xp);
  statTitle.textContent = t.name;
  statXp.textContent = String(xp);
  if (t.next) {
    const ratio = (xp - t.min) / (t.next.min - t.min);
    statTitleFill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
    statNext.textContent = `「${t.next.name}」まであと${t.next.min - xp}XP`;
  } else {
    statTitleFill.style.width = '100%';
    statNext.textContent = '最高の段位です。人間力の師範！';
  }
  statTotal.textContent = String(state.practices.length);
  statStreak.textContent = `${streak(state.practices)}日`;
  statEpisode.textContent = String(state.practices.filter((p) => p.episode).length);

  renderRadar();

  const stats = skillStats(state.practices);
  skillLevels.replaceChildren(...SKILLS.map((s) => {
    const st = stats[s.key];
    const row = document.createElement('div');
    row.className = 'field-level';
    const head = document.createElement('div');
    head.className = 'field-level__head';
    head.append(
      skillMarkEl(s.key, true),
      textEl('span', 'field-level__name', s.name),
      textEl('span', 'field-level__lv', `Lv.${st.level}`),
      textEl('span', 'field-level__meta', `${st.count}回・${st.xp}XP`),
    );
    const track = document.createElement('div');
    track.className = 'field-level__track';
    const fill = document.createElement('div');
    fill.className = 'field-level__fill';
    fill.style.width = `${Math.round(st.progress * 100)}%`;
    track.appendChild(fill);
    row.append(head, track);
    return row;
  }));

  renderCalendar();
}

$('btn-cal-prev').addEventListener('click', () => {
  const d = new Date(state.calYear, state.calMonth0 - 1, 1);
  state.calYear = d.getFullYear();
  state.calMonth0 = d.getMonth();
  renderCalendar();
});
$('btn-cal-next').addEventListener('click', () => {
  const d = new Date(state.calYear, state.calMonth0 + 1, 1);
  state.calYear = d.getFullYear();
  state.calMonth0 = d.getMonth();
  renderCalendar();
});

// ============================================================
// Render all
// ============================================================
function renderTabs(): void {
  tabButtons.forEach((b) => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== state.tab));
}

function switchTab(tab: Tab): void {
  state.tab = tab;
  renderAll();
  window.scrollTo({ top: 0 });
}

function renderAll(): void {
  const episodes = state.practices.filter((p) => p.episode).length;
  countShelf.textContent = episodes ? String(episodes) : '';
  renderTabs();
  renderToday();
  renderZukan();
  renderShelf();
  renderGrowth();
  btnPracticeSubmit.disabled = state.pending.has('practice');
  btnAssessSubmit.disabled = state.pending.has('assess');
}

// ============================================================
// 稽古の記録
// ============================================================
function renderPracticeFormChoices(): void {
  practiceSkillChips.replaceChildren(...SKILLS.map((s) => radioChip(s.name, s.key === state.formSkill, () => {
    if (state.formSkill !== s.key) state.formDrill = '';
    state.formSkill = s.key;
    renderPracticeFormChoices();
  })));
  practiceDrill.textContent = state.formDrill ? `お題：${state.formDrill}` : '';
  practiceDrill.classList.toggle('hidden', !state.formDrill);

  feelOptions.replaceChildren(...FEELS.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `segmented__btn segmented__btn--${f.key}${state.formFeel === f.key ? ' is-active' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.formFeel === f.key));
    b.append(textEl('span', 'segmented__label', f.label), textEl('span', 'segmented__desc', f.desc));
    b.addEventListener('click', () => {
      state.formFeel = f.key;
      renderPracticeFormChoices();
    });
    return b;
  }));
}

function openPracticeModal(opts: { id?: string; skill?: SkillKey; drill?: string }): void {
  const p = findPractice(opts.id ?? null);
  state.editingId = p ? p.id : null;
  practiceModalTitle.textContent = p ? '稽古の記録を編集' : '稽古を記録する';
  btnPracticeSubmit.textContent = p ? '保存する' : '記録する';
  state.formSkill = p?.skill ?? opts.skill ?? currentDrill().skill;
  state.formDrill = p?.drill ?? opts.drill ?? '';
  state.formFeel = p?.feel ?? 'good';
  inputDate.value = p?.date ?? todayKey();
  inputDate.max = todayKey();
  inputScene.value = p?.scene ?? '';
  inputResult.value = p?.result ?? '';
  inputInsight.value = p?.insight ?? '';
  inputEpisode.checked = p?.episode ?? false;
  renderPracticeFormChoices();
  openOverlay(practiceOverlay);
  window.setTimeout(() => (inputScene.value ? inputResult : inputScene).focus(), 50);
}

const closePracticeModal = (): void => {
  closeOverlay(practiceOverlay);
  state.editingId = null;
};

practiceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const date = inputDate.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast('稽古した日を入力してください');
    return;
  }
  if (date > todayKey()) {
    showToast('稽古した日は今日までの日付にしてください');
    return;
  }
  const result = inputResult.value.trim();
  if (!result) {
    showToast('やってみてどうだったかを書いてください');
    inputResult.focus();
    return;
  }
  const input: PracticeInput = {
    skill: state.formSkill,
    date,
    drill: state.formDrill,
    scene: inputScene.value.trim(),
    result,
    feel: state.formFeel,
    insight: inputInsight.value.trim(),
    episode: inputEpisode.checked,
  };
  const editingId = state.editingId;
  void withLock('practice', async () => {
    if (editingId) await updatePractice(uid, editingId, input);
    else await createPractice(uid, input);
    closePracticeModal();
    if (editingId) {
      showToast('保存しました');
    } else {
      showToast(`稽古しました！ +${practiceXp({ ...input, id: '', createdAt: 0 })}XP`);
      state.pickedSkill = null;
      state.drillOffset = 0;
    }
  });
});

$('btn-practice-close').addEventListener('click', closePracticeModal);
$('btn-practice-cancel').addEventListener('click', closePracticeModal);

// ============================================================
// 自己評価
// ============================================================
function renderAssessRows(): void {
  assessRows.replaceChildren(...SKILLS.map((s) => {
    const row = document.createElement('div');
    row.className = 'assess-row';
    const head = document.createElement('div');
    head.className = 'assess-row__head';
    head.append(skillMarkEl(s.key, true), textEl('span', 'assess-row__name', s.name));
    const scores = document.createElement('div');
    scores.className = 'score-btns';
    scores.setAttribute('role', 'radiogroup');
    scores.setAttribute('aria-label', s.name);
    SCORE_LEVELS.forEach((lv) => {
      const on = state.assessScores[s.key] === lv.value;
      const b = button(String(lv.value), `score-btn${on ? ' is-active' : ''}`, () => {
        state.assessScores[s.key] = lv.value;
        renderAssessRows();
      });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.title = lv.label;
      scores.appendChild(b);
    });
    row.append(head, scores);
    return row;
  }));
}

function openAssessModal(): void {
  const month = currentMonth();
  const existing = state.assessments.find((a) => a.month === month);
  const base = existing ?? latestAssessment(state.assessments);
  assessModalTitle.textContent = `${Number(month.slice(5, 7))}月の自己評価`;
  state.assessScores = {} as Record<SkillKey, number>;
  SKILL_KEYS.forEach((k) => { state.assessScores[k] = base ? base.scores[k] : 0; });
  inputAssessMemo.value = existing?.memo ?? '';
  renderAssessRows();
  openOverlay(assessOverlay);
}

assessForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const missing = SKILLS.filter((s) => !state.assessScores[s.key]);
  if (missing.length) {
    showToast(`「${missing[0].name}」の点数を選んでください`);
    return;
  }
  const a: Assessment = { month: currentMonth(), scores: { ...state.assessScores }, memo: inputAssessMemo.value.trim() };
  void withLock('assess', async () => {
    await saveAssessment(uid, a);
    closeOverlay(assessOverlay);
    showToast('自己評価を保存しました。伸ばしたい力のお題が出やすくなります');
  });
});

$('btn-assess').addEventListener('click', openAssessModal);
$('btn-assess-reminder').addEventListener('click', openAssessModal);
$('btn-assess-close').addEventListener('click', () => closeOverlay(assessOverlay));
$('btn-assess-cancel').addEventListener('click', () => closeOverlay(assessOverlay));

// ============================================================
// 確認ダイアログ
// ============================================================
btnConfirmCancel.addEventListener('click', () => {
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
});

btnConfirmOk.addEventListener('click', () => {
  const action = state.confirmAction;
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
  if (action) void action();
});

// ============================================================
// フィードバック
// ============================================================
feedbackBtn.addEventListener('click', () => {
  openOverlay(feedbackOverlay);
  window.setTimeout(() => inputFeedbackMessage.focus(), 50);
});
btnFeedbackClose.addEventListener('click', () => closeOverlay(feedbackOverlay));

btnFeedbackSend.addEventListener('click', async () => {
  const message = inputFeedbackMessage.value.trim();
  if (!message) {
    showToast('内容を入力してください');
    return;
  }
  if (btnFeedbackSend.disabled) return;
  btnFeedbackSend.disabled = true;
  btnFeedbackSend.textContent = '送信中…';
  const ok = await submitFeedback(message);
  btnFeedbackSend.disabled = false;
  btnFeedbackSend.textContent = '送信する';
  if (ok) {
    inputFeedbackMessage.value = '';
    closeOverlay(feedbackOverlay);
    showToast('送信しました。ありがとうございます！');
  } else {
    showToast('送信に失敗しました。時間をおいて再度お試しください');
  }
});

// オーバーレイの背景クリックで閉じる（確認ダイアログは誤操作防止のため除外）
[practiceOverlay, assessOverlay, feedbackOverlay].forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (overlay === practiceOverlay) closePracticeModal();
    else closeOverlay(overlay);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closePracticeModal();
  closeOverlay(assessOverlay);
  closeOverlay(feedbackOverlay);
  closeOverlay(confirmOverlay);
  state.confirmAction = null;
});

// ============================================================
// Tabs / buttons
// ============================================================
tabButtons.forEach((b) => b.addEventListener('click', () => switchTab((b.dataset.tab as Tab) || 'today')));

btnFab.addEventListener('click', () => openPracticeModal({}));
btnAddInline.addEventListener('click', () => openPracticeModal({ skill: currentDrill().skill, drill: '' }));

inputSearch.addEventListener('input', () => {
  state.search = inputSearch.value;
  renderShelf();
});

// ============================================================
// Auth
// ============================================================
btnGoogleLogin.addEventListener('click', async () => {
  if (btnGoogleLogin.disabled) return;
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
  } catch (err) {
    console.error(err);
    const code = (err as { code?: string }).code;
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      showToast('ログインに失敗しました。もう一度お試しください');
    }
  } finally {
    btnGoogleLogin.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await logout();
  } catch (err) {
    console.error(err);
    showToast('ログアウトに失敗しました');
  }
});

function stopSubscriptions(): void {
  state.unsubscribers.forEach((u) => u());
  state.unsubscribers = [];
}

onAuthChange((user: User | null) => {
  stopSubscriptions();
  if (!user) {
    state.uid = null;
    state.practices = [];
    state.assessments = [];
    state.loaded = false;
    loginScreen.classList.remove('hidden');
    appEl.classList.add('hidden');
    userInfo.classList.add('hidden');
    return;
  }
  state.uid = user.uid;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  userAvatar.src = user.photoURL ?? '';
  userAvatar.classList.toggle('hidden', !user.photoURL);
  userName.textContent = user.displayName ?? '';
  renderAll();

  const onError = (err: Error): void => {
    console.error(err);
    showToast('データの読み込みに失敗しました。再読み込みしてください');
  };
  state.unsubscribers.push(subscribePractices(user.uid, (items) => {
    state.practices = items;
    state.loaded = true;
    renderAll();
  }, onError));
  state.unsubscribers.push(subscribeAssessments(user.uid, (items) => {
    state.assessments = items;
    renderAll();
  }, onError));
});

scoreScale.textContent = SCORE_LEVELS.map((l) => `${l.value}：${l.label}`).join('　');

// 日付が変わったら「今日」の表示を更新する
let lastDay = todayKey();
window.setInterval(() => {
  const t = todayKey();
  if (t !== lastDay) {
    lastDay = t;
    state.drillOffset = 0;
    renderAll();
  }
}, 60 * 1000);
