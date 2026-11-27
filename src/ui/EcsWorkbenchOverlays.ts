import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import { BUILTIN_ECS_PROJECTS } from './EcsWorkbenchCatalog.ts';

export interface WorkbenchOverlaysDeps {
  getProject: () => EcsProjectV2;
  getActiveRoomId: () => string | null;
  isSimRunning: () => boolean;
  onSwitchRoom: (roomId: string) => void;
  onSelectAndFocusEntity: (entityId: string, roomId?: string) => void;
  onSelectPrefab: (prefabId: string) => void;
  onLoadBuiltinProject: (project: EcsProjectV2) => void;
  onToggleQuadView: () => void;
  onOpenModelAtelier: () => void;
  onOpenClassicWorkshop: () => void;
  onTogglePlayPause: () => void;
  onToggleSidePanes: () => void;
  onResetCamera: () => void;
  onRunDiagnostics: () => void;
}

interface PaletteItem {
  category: string;
  title: string;
  meta: string;
  searchKey: string;
  run: () => void;
}

const SHORTCUT_GROUPS: readonly [string, readonly [string, string][]][] = [
  ['視口導覽', [
    ['中鍵 / Space+左鍵', '平移視口（依 3D 方位角）'],
    ['右鍵 / Alt+左鍵', '3D 環繞旋轉 (Orbit)'],
    ['滾輪 / Shift+滾輪', '縮放編輯視口 / 切換 Z 樓層'],
    ['F / 0 / Home', '聚焦選取實體 / 重設視角縮放'],
  ]],
  ['工具切換', [
    ['V / B / R', '選取 Gizmo / 筆刷 / 矩形拉高'],
    ['G / E / I', '油漆桶 / 橡皮擦 / 吸管取樣'],
  ]],
  ['實體多選與 Gizmo', [
    ['點擊 / 框選 / Shift', '單選、框選或加減多選實體'],
    ['Ctrl+D / Delete', '複製 (+16px) / 刪除選取實體'],
    ['Ctrl+Z / Ctrl+Y', '復原 / 重做編修歷史'],
  ]],
  ['3D 體素與樓層', [
    ['[ / ]', '降低 / 升高目前編輯 Z 樓層'],
    ['Q / Shift+Q', '順 / 逆時針旋轉階梯與斜坡'],
    ['雙擊四視圖標題', '切換四視圖與單一正交視圖'],
  ]],
  ['工作區與試玩', [
    ['P', '切換試玩 / 編輯（保留縮放）'],
    ['Ctrl/Cmd + K', '開啟快速指令與跳轉面板'],
    ['Tab / ? / Esc', '收合側欄 / 快捷鍵 / 關閉彈窗'],
  ]],
];

function scoreFuzzyMatch(rawQuery: string, target: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 1;
  const t = target.toLowerCase();
  const idx = t.indexOf(q);
  if (idx === 0) return 120;
  if (idx > 0) return 90 - Math.min(40, idx);
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 4 + streak * 2;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Portal overlay manager for Workstation 2.0:
 * hosts the `?` Shortcut Cheatsheet and `Ctrl+K` Quick Command / Jump Palette above `.p7-topbar`.
 */
export class EcsWorkbenchOverlays {
  public readonly element: HTMLDivElement;
  private readonly ac = new AbortController();
  private readonly deps: WorkbenchOverlaysDeps;
  private readonly shortcutsBackdrop: HTMLDivElement;
  private readonly paletteBackdrop: HTMLDivElement;
  private readonly paletteInput: HTMLInputElement;
  private readonly paletteListEl: HTMLDivElement;

  private activeModal: 'none' | 'shortcuts' | 'palette' = 'none';
  private allItems: PaletteItem[] = [];
  private filteredItems: PaletteItem[] = [];
  private selectedIndex = 0;

  constructor(deps: WorkbenchOverlaysDeps) {
    this.deps = deps;
    const { signal } = this.ac;

    this.element = el('div', 'p7-overlays-host');
    this.element.hidden = true;

    this.shortcutsBackdrop = this.buildShortcutsModal(signal);
    const built = this.buildCommandPaletteModal(signal);
    this.paletteBackdrop = built.backdrop;
    this.paletteInput = built.input;
    this.paletteListEl = built.listEl;
    this.element.append(this.shortcutsBackdrop, this.paletteBackdrop);

    window.addEventListener('keydown', (e) => {
      if (this.activeModal !== 'none' && e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeAll();
      }
    }, { signal });
  }

  private buildShortcutsModal(signal: AbortSignal): HTMLDivElement {
    const backdrop = el('div', 'p7-shortcuts-modal');
    backdrop.dataset.testid = 'shortcut-cheatsheet-modal';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.hidden = true;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeAll(); }, { signal });

    const dialog = el('div', 'p7-shortcuts-dialog');
    const head = el('div', 'p7-overlay-head');
    const closeBtn = el('button', 'p7-btn p7-btn-xs', '關閉 Esc');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => this.closeAll(), { signal });
    head.append(el('h3', 'p7-overlay-title', '快捷鍵總覽 (?)'), closeBtn);

    const grid = el('div', 'p7-shortcuts-grid');
    for (const [cat, items] of SHORTCUT_GROUPS) {
      const card = el('section', 'p7-shortcuts-card');
      const list = el('div', 'p7-shortcuts-list');
      for (const [keys, desc] of items) {
        const row = el('div', 'p7-shortcuts-row');
        row.append(el('kbd', 'p7-kbd p7-mono', keys), el('span', 'p7-shortcuts-desc', desc));
        list.appendChild(row);
      }
      card.append(el('h4', 'p7-shortcuts-cat', cat), list);
      grid.appendChild(card);
    }
    dialog.append(head, grid);
    backdrop.appendChild(dialog);
    return backdrop;
  }

  private buildCommandPaletteModal(signal: AbortSignal): {
    backdrop: HTMLDivElement;
    input: HTMLInputElement;
    listEl: HTMLDivElement;
  } {
    const backdrop = el('div', 'p7-cmd-palette');
    backdrop.dataset.testid = 'command-palette-modal';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.hidden = true;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeAll(); }, { signal });

    const dialog = el('div', 'p7-cmd-dialog');
    const inputWrap = el('div', 'p7-cmd-input-wrap');
    const input = el('input', 'p7-input p7-cmd-input');
    input.type = 'text';
    input.dataset.testid = 'command-palette-input';
    input.placeholder = '輸入關鍵字跳轉房間、實體、物件庫、內建專案或常用指令…';
    input.autocomplete = 'off';
    input.addEventListener('input', () => this.applyFilter(input.value), { signal });
    input.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowDown' && this.filteredItems.length > 0) {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredItems.length;
        this.syncActiveRow();
      } else if (e.code === 'ArrowUp' && this.filteredItems.length > 0) {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
        this.syncActiveRow();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        const picked = this.filteredItems[this.selectedIndex];
        if (picked) { this.closeAll(); picked.run(); }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.closeAll();
      }
    }, { signal });
    inputWrap.appendChild(input);

    const listEl = el('div', 'p7-cmd-list');
    listEl.dataset.testid = 'command-palette-list';
    dialog.append(inputWrap, listEl, el('div', 'p7-cmd-footer p7-mono', '↑↓ 選擇 · Enter 執行 · Esc 關閉'));
    backdrop.appendChild(dialog);
    return { backdrop, input, listEl };
  }

  private collectPaletteItems(): PaletteItem[] {
    const proj = this.deps.getProject();
    const activeRoomId = this.deps.getActiveRoomId();
    const items: PaletteItem[] = [];
    const push = (category: string, title: string, meta: string, extraKey: string, run: () => void): void => {
      items.push({ category, title, meta, searchKey: `${category} ${title} ${meta} ${extraKey}`, run });
    };

    push('指令', '切換四視圖', 'Quad View 3D 多視角', 'quad', () => this.deps.onToggleQuadView());
    push('指令', '開啟 3D 建模', 'Model Atelier 工坊', 'model 3d', () => this.deps.onOpenModelAtelier());
    push('指令', '開啟像素畫室', 'Sprite Atelier 畫室', 'sprite pixel', () => this.deps.onOpenClassicWorkshop());
    push('指令', '開始/停止試玩', this.deps.isSimRunning() ? '返回編輯 [P]' : '開始試玩 [P]', 'play sim', () => this.deps.onTogglePlayPause());
    push('指令', '收合左右側欄', '放大中心視口 [Tab]', 'collapse pane', () => this.deps.onToggleSidePanes());
    push('指令', '重設視角', '鏡頭與縮放 100% [0]', 'reset camera zoom', () => this.deps.onResetCamera());
    push('指令', '空間診斷', 'AI 空間與試玩診斷', 'diag oracle', () => this.deps.onRunDiagnostics());
    push('指令', '快捷鍵總覽', '顯示鍵盤滑鼠快捷鍵 [?]', 'shortcut help', () => this.openShortcuts());

    for (const r of proj.worldMap?.rooms ?? []) {
      const tag = r.id === activeRoomId ? ' · 目前' : '';
      push('房間', r.name, `${r.id} (${r.cols}×${r.rows})${tag}`, 'room', () => this.deps.onSwitchRoom(r.id));
    }
    for (const ent of proj.entities) {
      push('實體', ent.name, ent.roomId ? `${ent.id} · ${ent.roomId}` : ent.id, 'entity', () =>
        this.deps.onSelectAndFocusEntity(ent.id, ent.roomId),
      );
    }
    for (const pref of Object.values(proj.prefabs)) {
      push('物件庫', pref.name, pref.id, 'prefab', () => this.deps.onSelectPrefab(pref.id));
    }
    for (const bp of BUILTIN_ECS_PROJECTS) {
      push('專案', bp.label, bp.id === proj.meta.id ? `${bp.id} · 目前` : bp.id, 'project', () =>
        this.deps.onLoadBuiltinProject(bp.project),
      );
    }
    return items;
  }

  private applyFilter(query: string): void {
    const scored: { item: PaletteItem; score: number }[] = [];
    for (const item of this.allItems) {
      const s = scoreFuzzyMatch(query, item.searchKey);
      if (s >= 0) scored.push({ item, score: s });
    }
    if (query.trim().length > 0) scored.sort((a, b) => b.score - a.score);
    this.filteredItems = scored.slice(0, 40).map((e) => e.item);
    this.selectedIndex = 0;
    this.renderPaletteList();
  }

  private renderPaletteList(): void {
    this.paletteListEl.textContent = '';
    if (this.filteredItems.length === 0) {
      this.paletteListEl.appendChild(el('div', 'p7-cmd-empty', '找不到相符的指令或專案項目'));
      return;
    }
    this.filteredItems.forEach((item, idx) => {
      const row = el('button', idx === this.selectedIndex ? 'p7-cmd-item is-active' : 'p7-cmd-item');
      row.type = 'button';
      row.append(
        el('span', 'p7-cmd-badge', item.category),
        el('span', 'p7-cmd-item-title', item.title),
        el('span', 'p7-cmd-item-meta p7-mono', item.meta),
      );
      row.addEventListener('mouseenter', () => { this.selectedIndex = idx; this.syncActiveRow(); });
      row.addEventListener('click', () => { this.closeAll(); item.run(); });
      this.paletteListEl.appendChild(row);
    });
  }

  private syncActiveRow(): void {
    const children = this.paletteListEl.children;
    for (let i = 0; i < children.length; i++) {
      const active = i === this.selectedIndex;
      children[i].classList.toggle('is-active', active);
      if (active && typeof (children[i] as HTMLElement).scrollIntoView === 'function') {
        (children[i] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }

  public isOpen(): boolean { return this.activeModal !== 'none'; }

  public openShortcuts(): void {
    this.activeModal = 'shortcuts';
    this.element.hidden = false;
    this.paletteBackdrop.hidden = true;
    this.shortcutsBackdrop.hidden = false;
  }

  public openCommandPalette(): void {
    this.activeModal = 'palette';
    this.element.hidden = false;
    this.shortcutsBackdrop.hidden = true;
    this.paletteBackdrop.hidden = false;
    this.allItems = this.collectPaletteItems();
    this.paletteInput.value = '';
    this.applyFilter('');
    queueMicrotask(() => { if (this.activeModal === 'palette') this.paletteInput.focus(); });
  }

  public closeAll(): void {
    this.activeModal = 'none';
    this.shortcutsBackdrop.hidden = true;
    this.paletteBackdrop.hidden = true;
    this.element.hidden = true;
  }

  public destroy(): void {
    this.ac.abort();
    this.closeAll();
    this.element.remove();
  }
}
