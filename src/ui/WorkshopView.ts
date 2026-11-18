import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import { SANDBOX_DEFAULT_SCRIPT, WORKSHOP_RECIPES } from '../assets/WorkshopRecipes.ts';
import { extractCartridgeFromPng } from '../core/runtime/CartridgePngCodec.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeJsonV1, CartridgeStageSpawn } from '../core/sim/CartridgeSchema.ts';
import type { VmAction, VmRule, VmTrigger } from '../core/sim/EventActionVm.ts';
import { FEEDBACK_RECIPES } from '../core/sim/JuiceSystem.ts';
import { COLLISION_CLOUD, COLLISION_EMPTY, COLLISION_HAZARD, COLLISION_SOLID, TILE_SIZE } from '../core/sim/TilemapGrid.ts';
import {
  CARTRIDGE_PARAM_DEFS,
  DEFAULT_RUNTIME_PARAMS,
  type BgmTheme,
  type CartridgeId,
  type FeedbackPreset,
  type SimEvent,
} from '../core/types/WorldTypes.ts';
import { DND_DEFAULT_MODULE_JSON } from '../game/BuiltinCartridges.ts';
import { exportCartridgeCardPngDataUrl, renderCartridgeCoverCanvas } from './CardArt.ts';
import { btn, el } from './dom.ts';

type WorkshopScriptMode = 'custom' | 'sandbox' | 'dnd';

type BrushId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

interface BrushDef {
  id: BrushId;
  icon: string;
  label: string;
  color: string;
}

const LEVEL_ROWS = 12;

const BRUSHES: readonly BrushDef[] = [
  { id: 0, icon: '·', label: '🧹 橡皮擦', color: 'transparent' },
  { id: 1, icon: '▓', label: '🟩 草皮', color: '#56d39c' },
  { id: 2, icon: '▦', label: '🧱 石磚', color: '#8c9ab5' },
  { id: 3, icon: '☁', label: '☁️ 雲台', color: '#fffaf0' },
  { id: 4, icon: '▲', label: '🔺 尖刺', color: '#ff708d' },
  { id: 5, icon: '⇪', label: '🌀 彈簧', color: '#f59b23' },
  { id: 6, icon: '👾', label: '👾 史萊姆', color: '#d93b60' },
  { id: 7, icon: '★', label: '⭐ 星星', color: '#ffd447' },
  { id: 8, icon: '⚿', label: '🔑 鑰匙', color: '#e0aaff' },
  { id: 9, icon: '⛩', label: '🚪 終點門', color: '#5ec2f7' },
  { id: 10, icon: '🚩', label: '🚩 出生點', color: '#239b69' },
];

interface RuleDraft {
  whenKey: string;
  doType: 'PlaySfx' | 'Juice' | 'Impulse' | 'SetVar' | 'EndGame';
  sfxPreset: SimEvent;
  juicePreset: FeedbackPreset;
}

const WHEN_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'OnStart', label: '開局時 (OnStart)' },
  { key: 'OnButton:action', label: '按下 A 動作鍵' },
  { key: 'OnButton:skillY', label: '按下 Y 技能鍵' },
  { key: 'OnCollide:player+star', label: '吃到星星時' },
  { key: 'OnCollide:player+enemy', label: '碰到敵人時' },
  { key: 'OnEvery:120', label: '每 2 秒節拍' },
];

const SFX_AUDITION_PRESETS: readonly { value: SimEvent; label: string }[] = [
  { value: 'star', label: '⭐ 星塵音階' },
  { value: 'jump', label: '⬆ 彈跳音階' },
  { value: 'bounce', label: '🌀 彈簧蹦音' },
  { value: 'laser', label: '⚡ 雷射合成' },
  { value: 'key', label: '🔑 鑰匙和弦' },
  { value: 'win', label: '🏆 勝利號角' },
  { value: 'stomp', label: '💥 踩踏節拍' },
  { value: 'explode', label: '🔥 爆破低音' },
  { value: 'snap', label: '📸 快門清音' },
];

const JUICE_PRESETS: readonly { value: FeedbackPreset; label: string }[] = [
  { value: 'relic_burst', label: '✨ 吃星閃耀' },
  { value: 'dash_kick', label: '💨 起跳彈力' },
  { value: 'light_hit', label: '💥 輕擊頓幀' },
  { value: 'charge_shot', label: '⚡ 蓄力爆發' },
  { value: 'player_hurt', label: '💢 受傷震動' },
  { value: 'heavy_kill', label: '🎆 重擊慶祝' },
];

const BGM_OPTIONS: readonly { value: BgmTheme; label: string }[] = [
  { value: 'meadow', label: '🌿 草原輕快 (Meadow)' },
  { value: 'starlight', label: '🌌 星光合成 (Starlight)' },
  { value: 'dungeon', label: '🕯️ 地牢神秘 (Dungeon)' },
  { value: 'boss', label: '🔥 頭目熱血 (Boss)' },
];

export interface WorkshopStudioBridge {
  getStudioSprites: () => { sprites: Record<string, string[]>; paletteRow: number };
  onImportCartridgeFile?: (file: File) => Promise<void>;
}

export class WorkshopView {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly onGoPlay?: (targetId?: CartridgeId) => void;
  private readonly studioBridge?: WorkshopStudioBridge;

  private sliders = new Map<string, { input: HTMLInputElement; valEl: HTMLElement; unit: string }>();
  private filterCheck: HTMLInputElement;
  private codeBox: HTMLTextAreaElement;
  private errorBox: HTMLElement;
  private mode: WorkshopScriptMode = 'custom';
  private sandboxDraft: string;
  private dndDraft: string;
  private readonly ac = new AbortController();

  // Custom Cartridge Maker state
  private editingCustomId: string | undefined;
  private cols: 40 | 64 | 80 = 40;
  private gridCells = new Uint8Array(80 * LEVEL_ROWS);
  private activeBrush: BrushId = 1;
  private isPainting = false;
  private bgmTheme: BgmTheme = 'meadow';
  private paletteRow = 0;
  private useStudioSprites = true;
  private customRules: RuleDraft[] = [
    { whenKey: 'OnCollide:player+star', doType: 'PlaySfx', sfxPreset: 'star', juicePreset: 'relic_burst' },
    { whenKey: 'OnButton:skillY', doType: 'Juice', sfxPreset: 'laser', juicePreset: 'charge_shot' },
  ];

  private readonly titleInput: HTMLInputElement;
  private readonly colsSelect: HTMLSelectElement;
  private readonly bgmSelect: HTMLSelectElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly studioSpriteCheck: HTMLInputElement;
  private readonly brushBtns = new Map<BrushId, HTMLButtonElement>();
  private readonly boardGridEl: HTMLElement;
  private levelCellEls: HTMLDivElement[] = [];
  private readonly rulesListEl: HTMLElement;
  private readonly savedListEl: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(
    host: EngineHost,
    atlas: TextureAtlas,
    onGoPlay?: (targetId?: CartridgeId) => void,
    studioBridge?: WorkshopStudioBridge,
  ) {
    this.host = host;
    this.atlas = atlas;
    this.onGoPlay = onGoPlay;
    this.studioBridge = studioBridge;

    this.sandboxDraft = this.host.getSandboxScript();
    this.dndDraft = this.host.getDndModuleJson();
    this.seedStarterLevel();

    this.element = el('section', 'studio-card');

    const head = el('div', 'studio-head');
    head.innerHTML = `
      <div>
        <h2>🧱 積木＆卡匣工坊（物理調校・自製關卡・PNG 分享）</h2>
        <p class="studio-sub">手繪橫向平台關卡、編排 When → Do 五聲音階積木規則，立即試玩並匯出拍立得 PNG 卡匣！</p>
      </div>
    `;
    head.appendChild(
      btn(
        'toy-btn',
        '↺ 恢復原廠物理參數',
        undefined,
        () => {
          this.host.resetParams();
          this.syncSliders();
        },
        this.ac.signal,
      ),
    );

    const cols = el('div', 'workshop-columns');

    // Left: Physics, Glow & Screen-Shake Dials
    const paramList = el('div', 'param-list');
    const params = this.host.getParams();
    for (const def of CARTRIDGE_PARAM_DEFS) {
      const box = el('div', 'param-item');
      const row = el('div', 'param-row');
      const valEl = el('span', 'param-val', `${params[def.key]}${def.unit}`);
      row.append(el('span', undefined, def.label), valEl);

      const input = el('input', 'atelier-range');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(params[def.key]);
      input.addEventListener(
        'input',
        () => {
          const num = Number(input.value);
          this.host.setParam(def.key, num);
          valEl.textContent = `${num}${def.unit}`;
        },
        { signal: this.ac.signal },
      );
      this.sliders.set(def.key, { input, valEl, unit: def.unit });
      box.append(row, input);
      paramList.appendChild(box);
    }

    const filterItem = el('label', 'param-item');
    Object.assign(filterItem.style, {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
    });
    const filterText = el('span', undefined, '✨ 掌機暖光 LCD 掃描紋理');
    filterText.style.fontSize = '0.84rem';
    filterText.style.fontWeight = '800';
    this.filterCheck = el('input');
    this.filterCheck.type = 'checkbox';
    this.filterCheck.checked = params.cozyFilter > 0.5;
    this.filterCheck.addEventListener(
      'change',
      () => this.host.setParam('cozyFilter', this.filterCheck.checked ? 1 : 0),
      { signal: this.ac.signal },
    );
    filterItem.append(filterText, this.filterCheck);
    paramList.appendChild(filterItem);

    // Right: Mode Switcher + Custom Maker / PA-03 / PA-04
    const scriptPane = el('div', 'script-pane');

    const modeRow = el('div', 'tool-row');
    const customTab = btn('toy-btn is-active', '🗺️ 自製卡匣工坊');
    const sandboxTab = btn('toy-btn', '🧱 PA-03 積木');
    const dndTab = btn('toy-btn', '🐉 PA-04 D&D');
    modeRow.append(customTab, sandboxTab, dndTab);

    // --- Custom Maker Pane ---
    const customPane = el('div', 'custom-maker-pane');

    const metaBar = el('div', 'tool-row');
    this.titleInput = el('input', 'atelier-input');
    this.titleInput.type = 'text';
    this.titleInput.maxLength = 24;
    this.titleInput.value = '我的草莓冒險';
    this.titleInput.placeholder = '卡匣標題';

    this.colsSelect = el('select', 'atelier-select');
    for (const w of [40, 64, 80] as const) {
      const opt = el('option');
      opt.value = String(w);
      opt.textContent = `${w}×12 格`;
      this.colsSelect.appendChild(opt);
    }
    this.colsSelect.addEventListener(
      'change',
      () => {
        this.cols = Number(this.colsSelect.value) as 40 | 64 | 80;
        this.rebuildLevelBoard();
      },
      { signal: this.ac.signal },
    );

    this.bgmSelect = el('select', 'atelier-select');
    for (const b of BGM_OPTIONS) {
      const opt = el('option');
      opt.value = b.value;
      opt.textContent = b.label;
      this.bgmSelect.appendChild(opt);
    }
    this.bgmSelect.addEventListener(
      'change',
      () => {
        this.bgmTheme = this.bgmSelect.value as BgmTheme;
      },
      { signal: this.ac.signal },
    );

    this.paletteSelect = el('select', 'atelier-select');
    PALETTE_THEMES.forEach((t, idx) => {
      const opt = el('option');
      opt.value = String(idx);
      opt.textContent = `LUT ${idx}: ${t.label}`;
      this.paletteSelect.appendChild(opt);
    });
    this.paletteSelect.addEventListener(
      'change',
      () => {
        this.paletteRow = Number(this.paletteSelect.value) || 0;
      },
      { signal: this.ac.signal },
    );

    const spriteToggleLabel = el('label', 'maker-check-pill');
    this.studioSpriteCheck = el('input');
    this.studioSpriteCheck.type = 'checkbox';
    this.studioSpriteCheck.checked = true;
    this.studioSpriteCheck.addEventListener(
      'change',
      () => {
        this.useStudioSprites = this.studioSpriteCheck.checked;
      },
      { signal: this.ac.signal },
    );
    spriteToggleLabel.append(this.studioSpriteCheck, el('span', undefined, '🎨 套用畫室精靈'));

    metaBar.append(this.titleInput, this.colsSelect, this.bgmSelect, this.paletteSelect, spriteToggleLabel);

    // 10 Brushes + Eraser
    const brushRow = el('div', 'tool-row');
    for (const br of BRUSHES) {
      const b = btn(
        br.id === this.activeBrush ? 'toy-btn is-active' : 'toy-btn',
        br.label,
        undefined,
        () => {
          this.activeBrush = br.id;
          for (const [id, elBtn] of this.brushBtns.entries()) {
            elBtn.classList.toggle('is-active', id === this.activeBrush);
          }
        },
        this.ac.signal,
      );
      this.brushBtns.set(br.id, b);
      brushRow.appendChild(b);
    }

    // Scrollable Level Grid
    const scrollWrap = el('div', 'workshop-level-scroll');
    this.boardGridEl = el('div', 'workshop-level-grid');
    const stopPaint = () => {
      this.isPainting = false;
    };
    this.boardGridEl.addEventListener('pointerleave', stopPaint, { signal: this.ac.signal });
    window.addEventListener('pointerup', stopPaint, { signal: this.ac.signal });
    scrollWrap.appendChild(this.boardGridEl);
    this.rebuildLevelBoard();

    // When -> Do Rule Builder
    const rulesBox = el('div', 'maker-rules-box');
    const rulesHead = el('div', 'tool-row');
    rulesHead.append(
      el('strong', undefined, '🧩 When → Do 積木規則（純 VM、即時試聽）'),
      btn(
        'toy-btn is-mint',
        '＋ 新增規則',
        undefined,
        () => {
          if (this.customRules.length >= 12) return;
          this.customRules.push({
            whenKey: 'OnButton:action',
            doType: 'PlaySfx',
            sfxPreset: 'jump',
            juicePreset: 'dash_kick',
          });
          this.renderRules();
        },
        this.ac.signal,
      ),
    );
    this.rulesListEl = el('div', 'maker-rules-list');
    rulesBox.append(rulesHead, this.rulesListEl);
    this.renderRules();

    // Actions: Play, Export Polaroid PNG, Import PNG/JSON
    const actionRow = el('div', 'tool-row');
    this.fileInput = el('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.png,.json,image/png,application/json';
    this.fileInput.className = 'panel-hidden';
    this.fileInput.addEventListener(
      'change',
      () => {
        const file = this.fileInput.files?.[0];
        this.fileInput.value = '';
        if (file) void this.handleImportFile(file);
      },
      { signal: this.ac.signal },
    );

    actionRow.append(
      btn('toy-btn is-primary', '▶ 立即試玩', undefined, () => this.playCustomCartridge(), this.ac.signal),
      btn('toy-btn is-honey', '📸 匯出拍立得 PNG', undefined, () => void this.exportPolaroidPng(), this.ac.signal),
      btn('toy-btn', '📥 匯入 PNG / JSON', undefined, () => this.fileInput.click(), this.ac.signal),
      btn(
        'toy-btn',
        '🆕 新空白關卡',
        undefined,
        () => {
          this.editingCustomId = undefined;
          this.titleInput.value = '我的新冒險';
          this.seedStarterLevel();
          this.renderLevelCells();
        },
        this.ac.signal,
      ),
      this.fileInput,
    );

    // Saved custom cartridges manager (Edit / Remix / Export / Delete)
    const savedBox = el('div', 'maker-saved-box');
    savedBox.appendChild(el('strong', undefined, '💾 本機自製／匯入卡匣庫（上限 16 張）'));
    this.savedListEl = el('div', 'maker-saved-list');
    savedBox.appendChild(this.savedListEl);
    this.renderSavedList();

    customPane.append(metaBar, brushRow, scrollWrap, rulesBox, actionRow, savedBox);

    // --- Legacy PA-03 & PA-04 Pane ---
    const textEditorPane = el('div', 'script-pane panel-hidden');
    const recipeRow = el('div', 'tool-row');
    const dndRecipeRow = el('div', 'tool-row panel-hidden');
    for (const r of WORKSHOP_RECIPES) {
      recipeRow.appendChild(
        btn(
          'toy-btn is-honey',
          r.label,
          undefined,
          () => {
            this.codeBox.value = r.code;
            this.sandboxDraft = r.code;
          },
          this.ac.signal,
        ),
      );
    }
    recipeRow.appendChild(
      btn(
        'toy-btn',
        '📄 預設基地',
        undefined,
        () => {
          this.codeBox.value = SANDBOX_DEFAULT_SCRIPT;
          this.sandboxDraft = SANDBOX_DEFAULT_SCRIPT;
        },
        this.ac.signal,
      ),
    );
    dndRecipeRow.appendChild(
      btn(
        'toy-btn is-honey',
        '🐉 恢復預設餘燼迷宮 JSON',
        undefined,
        () => {
          this.codeBox.value = DND_DEFAULT_MODULE_JSON;
          this.dndDraft = DND_DEFAULT_MODULE_JSON;
        },
        this.ac.signal,
      ),
    );

    this.codeBox = el('textarea', 'atelier-code');
    this.codeBox.spellcheck = false;
    this.codeBox.value = this.sandboxDraft;
    const applyLegacyBtn = btn('toy-btn is-primary', '▶ 套用積木程式並切換到遊玩台');
    applyLegacyBtn.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        if (this.mode === 'sandbox') {
          this.sandboxDraft = this.codeBox.value;
          const err = this.host.applySandboxScript(this.codeBox.value);
          if (err) {
            this.showError(`積木執行小錯誤：${err}`);
          } else {
            this.hideError();
            this.host.clearSram('sandbox-toybox');
            this.host.playUiSound('key');
            this.onGoPlay?.('sandbox-toybox');
          }
        } else {
          this.dndDraft = this.codeBox.value;
          const err = this.host.applyDndModuleJson(this.codeBox.value);
          if (err) {
            this.showError(`D&D JSON 解析錯誤：${err}`);
          } else {
            this.hideError();
            this.host.clearSram('emberkeep-dnd');
            this.host.playUiSound('key');
            this.onGoPlay?.('emberkeep-dnd');
          }
        }
      },
      { signal: this.ac.signal },
    );
    textEditorPane.append(recipeRow, dndRecipeRow, this.codeBox, applyLegacyBtn);

    this.errorBox = el('div', 'script-error panel-hidden');

    const setMode = (next: WorkshopScriptMode) => {
      if (this.mode === next) return;
      if (this.mode === 'sandbox') this.sandboxDraft = this.codeBox.value;
      else if (this.mode === 'dnd') this.dndDraft = this.codeBox.value;

      this.mode = next;
      customTab.classList.toggle('is-active', next === 'custom');
      sandboxTab.classList.toggle('is-active', next === 'sandbox');
      dndTab.classList.toggle('is-active', next === 'dnd');
      customPane.classList.toggle('panel-hidden', next !== 'custom');
      textEditorPane.classList.toggle('panel-hidden', next === 'custom');
      recipeRow.classList.toggle('panel-hidden', next !== 'sandbox');
      dndRecipeRow.classList.toggle('panel-hidden', next !== 'dnd');
      this.hideError();
      if (next === 'sandbox') {
        this.codeBox.value = this.sandboxDraft;
        applyLegacyBtn.textContent = '▶ 套用積木程式並切換到遊玩台';
      } else if (next === 'dnd') {
        this.codeBox.value = this.dndDraft;
        applyLegacyBtn.textContent = '🐉 套用 D&D 劇本並插卡開玩！';
      }
    };

    customTab.addEventListener('click', () => setMode('custom'), { signal: this.ac.signal });
    sandboxTab.addEventListener('click', () => setMode('sandbox'), { signal: this.ac.signal });
    dndTab.addEventListener('click', () => setMode('dnd'), { signal: this.ac.signal });

    scriptPane.append(modeRow, customPane, textEditorPane, this.errorBox);
    cols.append(paramList, scriptPane);
    this.element.append(head, cols);

    this.host.events.on('plugin:registered', () => this.renderSavedList());
  }

  public destroy(): void {
    this.isPainting = false;
    this.ac.abort();
    this.sliders.clear();
  }

  public refreshSavedCartridges(): void {
    this.renderSavedList();
  }

  private showError(msg: string): void {
    this.errorBox.textContent = msg;
    this.errorBox.classList.remove('panel-hidden');
    this.host.playUiSound('hurt');
  }

  private hideError(): void {
    this.errorBox.classList.add('panel-hidden');
  }

  private seedStarterLevel(): void {
    this.gridCells.fill(0);
    for (let c = 0; c < 80; c++) {
      this.gridCells[10 * 80 + c] = 1; // grass top
      this.gridCells[11 * 80 + c] = 2; // stone base
    }
    // Starter gap + cloud + collectibles + enemy + gate
    for (let c = 14; c <= 16; c++) {
      this.gridCells[10 * 80 + c] = 0;
      this.gridCells[11 * 80 + c] = 4; // spikes in pit
    }
    for (let c = 14; c <= 16; c++) this.gridCells[7 * 80 + c] = 3; // cloud bridge
    for (let c = 22; c <= 25; c++) this.gridCells[7 * 80 + c] = 2; // elevated stone
    this.gridCells[9 * 80 + 2] = 10; // spawn
    this.gridCells[9 * 80 + 10] = 5; // spring
    this.gridCells[6 * 80 + 15] = 7; // star 1
    this.gridCells[6 * 80 + 23] = 7; // star 2
    this.gridCells[9 * 80 + 20] = 6; // slime
    this.gridCells[9 * 80 + 30] = 8; // key
    this.gridCells[9 * 80 + 36] = 9; // gate
  }

  private rebuildLevelBoard(): void {
    this.boardGridEl.innerHTML = '';
    this.levelCellEls = [];
    this.boardGridEl.style.gridTemplateColumns = `repeat(${this.cols}, 18px)`;
    for (let r = 0; r < LEVEL_ROWS; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = el('div', 'workshop-level-cell');
        cell.addEventListener(
          'pointerdown',
          (e) => {
            e.preventDefault();
            this.host.unlockAudio();
            this.isPainting = true;
            this.paintCell(c, r);
          },
          { signal: this.ac.signal },
        );
        cell.addEventListener(
          'pointerenter',
          () => {
            if (this.isPainting) this.paintCell(c, r);
          },
          { signal: this.ac.signal },
        );
        this.levelCellEls.push(cell);
        this.boardGridEl.appendChild(cell);
      }
    }
    this.renderLevelCells();
  }

  private paintCell(col: number, row: number): void {
    if (this.activeBrush === 10) {
      // Only one spawn point in the level
      for (let i = 0; i < this.gridCells.length; i++) {
        if (this.gridCells[i] === 10) this.gridCells[i] = 0;
      }
    }
    this.gridCells[row * 80 + col] = this.activeBrush;
    this.host.playTactile('ui', 'down');
    this.renderLevelCells();
  }

  private renderLevelCells(): void {
    for (let r = 0; r < LEVEL_ROWS; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const val = this.gridCells[r * 80 + c] as BrushId;
        const cell = this.levelCellEls[idx];
        const br = BRUSHES[val] ?? BRUSHES[0];
        cell.textContent = val === 0 ? '' : br.icon;
        cell.style.backgroundColor = br.color;
      }
    }
  }

  private renderRules(): void {
    this.rulesListEl.innerHTML = '';
    this.customRules.forEach((rule, idx) => {
      const row = el('div', 'maker-rule-row');

      const whenSel = el('select', 'atelier-select');
      for (const w of WHEN_OPTIONS) {
        const opt = el('option');
        opt.value = w.key;
        opt.textContent = w.label;
        whenSel.appendChild(opt);
      }
      whenSel.value = rule.whenKey;
      whenSel.addEventListener(
        'change',
        () => {
          rule.whenKey = whenSel.value;
        },
        { signal: this.ac.signal },
      );

      const doSel = el('select', 'atelier-select');
      for (const [val, label] of [
        ['PlaySfx', '🔊 播放音階音效'],
        ['Juice', '✨ 視覺果汁＋震動'],
        ['Impulse', '⬆ 向上彈跳'],
        ['SetVar', '🔢 連擊變數 +1'],
        ['EndGame', '🏁 立即過關'],
      ] as const) {
        const opt = el('option');
        opt.value = val;
        opt.textContent = label;
        doSel.appendChild(opt);
      }
      doSel.value = rule.doType;

      const subSel = el('select', 'atelier-select');
      const rebuildSub = () => {
        subSel.innerHTML = '';
        if (rule.doType === 'PlaySfx') {
          subSel.classList.remove('panel-hidden');
          for (const s of SFX_AUDITION_PRESETS) {
            const opt = el('option');
            opt.value = s.value;
            opt.textContent = s.label;
            subSel.appendChild(opt);
          }
          subSel.value = rule.sfxPreset;
        } else if (rule.doType === 'Juice') {
          subSel.classList.remove('panel-hidden');
          for (const j of JUICE_PRESETS) {
            const opt = el('option');
            opt.value = j.value;
            opt.textContent = j.label;
            subSel.appendChild(opt);
          }
          subSel.value = rule.juicePreset;
        } else {
          subSel.classList.add('panel-hidden');
        }
      };
      rebuildSub();

      const auditionCurrent = () => {
        this.host.unlockAudio();
        if (rule.doType === 'PlaySfx') {
          this.host.playUiSound(rule.sfxPreset);
          this.host.triggerHaptic('tap', 'right', true);
        } else if (rule.doType === 'Juice') {
          const recipe = FEEDBACK_RECIPES[rule.juicePreset];
          if (recipe.sound) this.host.playUiSound(recipe.sound);
          if (recipe.haptic) this.host.triggerHaptic(recipe.haptic, 'both', true);
        }
      };

      doSel.addEventListener(
        'change',
        () => {
          rule.doType = doSel.value as RuleDraft['doType'];
          rebuildSub();
          auditionCurrent();
        },
        { signal: this.ac.signal },
      );

      subSel.addEventListener(
        'change',
        () => {
          if (rule.doType === 'PlaySfx') rule.sfxPreset = subSel.value as SimEvent;
          else if (rule.doType === 'Juice') rule.juicePreset = subSel.value as FeedbackPreset;
          auditionCurrent();
        },
        { signal: this.ac.signal },
      );

      const delBtn = btn(
        'toy-btn',
        '✕',
        '刪除此規則',
        () => {
          this.customRules.splice(idx, 1);
          this.renderRules();
        },
        this.ac.signal,
      );

      row.append(el('span', 'rule-badge', 'WHEN'), whenSel, el('span', 'rule-badge', 'DO'), doSel, subSel, delBtn);
      this.rulesListEl.appendChild(row);
    });
  }

  private compileVmRules(): VmRule[] {
    return this.customRules.map((r, i) => {
      let when: VmTrigger;
      if (r.whenKey === 'OnStart') when = { type: 'OnStart' };
      else if (r.whenKey.startsWith('OnEvery:')) {
        when = { type: 'OnEvery', intervalTicks: Number(r.whenKey.split(':')[1]) || 120 };
      } else if (r.whenKey.startsWith('OnButton:')) {
        when = { type: 'OnButton', button: (r.whenKey.split(':')[1] as 'action' | 'skillY') ?? 'action', edge: 'pressed' };
      } else if (r.whenKey.startsWith('OnCollide:')) {
        const pair = r.whenKey.split(':')[1] ?? 'player+star';
        const [sourceTag, targetTag] = pair.split('+');
        when = { type: 'OnCollide', sourceTag: sourceTag ?? 'player', targetTag: targetTag ?? 'star' };
      } else {
        when = { type: 'OnStart' };
      }

      let action: VmAction;
      if (r.doType === 'PlaySfx') action = { type: 'PlaySfx', preset: r.sfxPreset };
      else if (r.doType === 'Juice') action = { type: 'Juice', preset: r.juicePreset };
      else if (r.doType === 'Impulse') action = { type: 'Impulse', target: 'player', vx: 0, vy: -220, setVelocity: false };
      else if (r.doType === 'SetVar') action = { type: 'SetVar', name: 'combo', op: '+=', value: 1 };
      else action = { type: 'EndGame', outcome: 'won' };

      return { id: `maker-rule-${i}`, when, do: [action] };
    });
  }

  private buildCartridgeJson(targetId?: string): CartridgeJsonV1 {
    const id = targetId ?? this.editingCustomId ?? `custom-maker-${Date.now().toString(36)}`;
    const title = this.titleInput.value.trim() || '我的自製卡匣';
    const studioData = this.studioBridge?.getStudioSprites();
    const useStudio = this.useStudioSprites && Boolean(studioData);

    const tiles: number[] = [];
    const collision: number[] = [];
    const spawns: CartridgeStageSpawn[] = [];
    let spawn = { x: 32, y: 140 };

    for (let r = 0; r < LEVEL_ROWS; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.gridCells[r * 80 + c] as BrushId;
        const px = c * TILE_SIZE;
        const py = r * TILE_SIZE;
        if (val === 1) {
          tiles.push(1);
          collision.push(COLLISION_SOLID);
        } else if (val === 2) {
          tiles.push(2);
          collision.push(COLLISION_SOLID);
        } else if (val === 3) {
          tiles.push(3);
          collision.push(COLLISION_CLOUD);
        } else if (val === 4) {
          tiles.push(4);
          collision.push(COLLISION_HAZARD);
        } else {
          tiles.push(0);
          collision.push(COLLISION_EMPTY);
          if (val === 5) spawns.push({ archetype: 'spring', x: px, y: py });
          else if (val === 6) spawns.push({ archetype: 'slime', x: px, y: py, minX: Math.max(0, px - 48), maxX: Math.min(this.cols * TILE_SIZE - 16, px + 48) });
          else if (val === 7) spawns.push({ archetype: 'star', x: px, y: py });
          else if (val === 8) spawns.push({ archetype: 'key', x: px, y: py });
          else if (val === 9) spawns.push({ archetype: 'gate', x: px, y: py });
          else if (val === 10) spawn = { x: px, y: py };
        }
      }
    }

    if (!spawns.some((s) => s.archetype === 'gate')) {
      spawns.push({ archetype: 'gate', x: (this.cols - 3) * TILE_SIZE, y: 9 * TILE_SIZE });
    }

    return {
      version: 1,
      meta: {
        id,
        code: 'CUS',
        title,
        subtitle: `自製 ${this.cols}×12 平台關卡`,
        genre: 'platformer',
        paletteRow: this.paletteRow,
      },
      initialVars: { combo: 0 },
      sprites: useStudio ? studioData?.sprites : undefined,
      player: {
        controller: 'platformer',
        sprite: useStudio ? 'studio_hero_a' : 'hero_a',
        spriteB: useStudio ? 'studio_hero_b' : 'hero_b',
        w: 16,
        h: 16,
        maxHearts: 3,
      },
      archetypes: {
        star: {
          sprite: useStudio ? 'studio_item_a' : 'star_a',
          spriteB: useStudio ? 'studio_item_b' : 'star_b',
          animFps: 5,
          w: 16,
          h: 16,
          tags: ['collectible', 'star'],
          scoreValue: 100,
          emissive: 0.72,
        },
        key: { sprite: 'key', w: 16, h: 16, tags: ['collectible', 'key'], scoreValue: 200, emissive: 0.72 },
        gate: { sprite: 'gate_closed', w: 16, h: 16, tags: ['gate'] },
        spring: { sprite: 'spring', w: 16, h: 16, tags: ['bouncy'], bounceVy: -275 },
        slime: {
          sprite: useStudio ? 'studio_enemy_a' : 'slime_a',
          spriteB: useStudio ? 'studio_enemy_b' : 'slime_b',
          animFps: 4,
          w: 16,
          h: 16,
          tags: ['enemy', 'stompable', 'hazard', 'gravity'],
          behavior: { kind: 'patrol', speedX: 28 },
          hp: 1,
          scoreValue: 120,
          castShadow: true,
        },
      },
      stages: [
        {
          id: 'custom-stage-1',
          name: title,
          worldWidth: this.cols * TILE_SIZE,
          worldHeight: LEVEL_ROWS * TILE_SIZE,
          skyTop: '#76c7ff',
          skyBottom: '#fff3df',
          bgmTheme: this.bgmTheme,
          paletteRow: this.paletteRow,
          hint: '方向移動 · B 跳躍 · L 重試',
          spawn,
          tileGrid: {
            cols: this.cols,
            rows: LEVEL_ROWS,
            tiles,
            collision,
            spriteMap: {
              '1': 'grass',
              '2': useStudio ? 'studio_tile' : 'stone',
              '3': 'cloud_m',
              '4': 'trap',
            },
          },
          spawns,
        },
      ],
      rules: this.compileVmRules(),
    };
  }

  private playCustomCartridge(): void {
    this.host.unlockAudio();
    const cart = this.buildCartridgeJson();
    const res = this.host.loadCartridge(cart, { save: true, mount: true, customId: cart.meta.id, overwrite: true });
    if (!res.ok) {
      this.showError(res.errors[0] ?? '自製卡匣驗證失敗');
      return;
    }
    this.hideError();
    this.editingCustomId = res.id;
    this.host.playUiSound('key');
    this.renderSavedList();
    this.onGoPlay?.(res.id);
  }

  private async exportPolaroidPng(cartridgeOverride?: CartridgeJsonV1): Promise<void> {
    this.host.unlockAudio();
    const cart = cartridgeOverride ?? this.buildCartridgeJson();
    if (!cartridgeOverride) {
      const res = this.host.loadCartridge(cart, { save: true, mount: false, customId: cart.meta.id, overwrite: true });
      if (!res.ok) {
        this.showError(res.errors[0] ?? '卡匣驗證失敗，無法匯出');
        return;
      }
      this.editingCustomId = res.id;
    }
    const cover = renderCartridgeCoverCanvas(this.atlas, cart);
    const dataUrl = await exportCartridgeCardPngDataUrl(
      cover,
      {
        id: cart.meta.id,
        code: cart.meta.code,
        title: cart.meta.title,
        subtitle: cart.meta.subtitle ?? '',
        genre: '自製平台',
        accentHex: '#ff708d',
        badgeText: '',
        controlsHint: '',
        goalHint: '',
        defaultScript: '',
      },
      0,
      0,
      cart.stages[0]?.spawns?.filter((s) => s.archetype === 'star').length ?? 0,
      cart,
    );
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `pixer-${cart.meta.id}-${Date.now()}.png`;
    a.click();
    this.host.playUiSound('snap');
    this.renderSavedList();
  }

  private async handleImportFile(file: File): Promise<void> {
    if (this.studioBridge?.onImportCartridgeFile) {
      await this.studioBridge.onImportCartridgeFile(file);
      this.renderSavedList();
      return;
    }
    let rawJson: unknown;
    if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
      const buf = new Uint8Array(await file.arrayBuffer());
      const res = await extractCartridgeFromPng(buf);
      if (!res.ok) {
        this.showError(res.error);
        return;
      }
      rawJson = res.data;
    } else {
      rawJson = await file.text();
    }
    const loaded = this.host.loadCartridge(rawJson, { save: true, mount: false });
    if (!loaded.ok) {
      this.showError(loaded.errors[0] ?? '匯入卡匣失敗');
      return;
    }
    this.hideError();
    this.loadIntoEditor(loaded.cartridge, loaded.id);
    this.renderSavedList();
  }

  public loadIntoEditor(cart: CartridgeJsonV1, asId?: string): void {
    this.editingCustomId = asId;
    this.titleInput.value = cart.meta.title;
    this.paletteRow = cart.meta.paletteRow ?? 0;
    this.paletteSelect.value = String(this.paletteRow);
    const st = cart.stages[0];
    if (st) {
      this.bgmTheme = st.bgmTheme;
      this.bgmSelect.value = st.bgmTheme;
      const inferredCols = st.tileGrid?.cols ?? Math.round(st.worldWidth / TILE_SIZE);
      this.cols = inferredCols >= 72 ? 80 : inferredCols >= 52 ? 64 : 40;
      this.colsSelect.value = String(this.cols);
      this.gridCells.fill(0);
      if (st.tileGrid) {
        for (let r = 0; r < st.tileGrid.rows && r < LEVEL_ROWS; r++) {
          for (let c = 0; c < st.tileGrid.cols && c < this.cols; c++) {
            const tid = st.tileGrid.tiles[r * st.tileGrid.cols + c] ?? 0;
            const col = st.tileGrid.collision[r * st.tileGrid.cols + c] ?? 0;
            if (col === COLLISION_HAZARD || tid === 4) this.gridCells[r * 80 + c] = 4;
            else if (col === COLLISION_CLOUD || tid === 3) this.gridCells[r * 80 + c] = 3;
            else if (tid === 1) this.gridCells[r * 80 + c] = 1;
            else if (tid > 0) this.gridCells[r * 80 + c] = 2;
          }
        }
      }
      for (const sp of st.spawns ?? []) {
        const c = Math.max(0, Math.min(this.cols - 1, Math.round(sp.x / TILE_SIZE)));
        const r = Math.max(0, Math.min(LEVEL_ROWS - 1, Math.round(sp.y / TILE_SIZE)));
        const map: Record<string, BrushId> = { spring: 5, slime: 6, star: 7, key: 8, gate: 9 };
        if (map[sp.archetype] !== undefined) this.gridCells[r * 80 + c] = map[sp.archetype];
      }
      const sc = Math.max(0, Math.min(this.cols - 1, Math.round(st.spawn.x / TILE_SIZE)));
      const sr = Math.max(0, Math.min(LEVEL_ROWS - 1, Math.round(st.spawn.y / TILE_SIZE)));
      this.gridCells[sr * 80 + sc] = 10;
      this.rebuildLevelBoard();
    }
    if (cart.rules && cart.rules.length > 0) {
      const mapped: RuleDraft[] = [];
      for (const r of cart.rules.slice(0, 12)) {
        let whenKey = 'OnStart';
        if (r.when.type === 'OnEvery') whenKey = `OnEvery:${r.when.intervalTicks}`;
        else if (r.when.type === 'OnButton') whenKey = `OnButton:${r.when.button}`;
        else if (r.when.type === 'OnCollide') whenKey = `OnCollide:${r.when.sourceTag}+${r.when.targetTag}`;
        const act = r.do[0];
        if (!act) continue;
        let doType: RuleDraft['doType'] = 'PlaySfx';
        let sfxPreset: SimEvent = 'star';
        let juicePreset: FeedbackPreset = 'relic_burst';
        if (act.type === 'PlaySfx') {
          doType = 'PlaySfx';
          sfxPreset = act.preset as SimEvent;
        } else if (act.type === 'Juice') {
          doType = 'Juice';
          juicePreset = act.preset as FeedbackPreset;
        } else if (act.type === 'Impulse') doType = 'Impulse';
        else if (act.type === 'SetVar') doType = 'SetVar';
        else if (act.type === 'EndGame') doType = 'EndGame';
        mapped.push({ whenKey, doType, sfxPreset, juicePreset });
      }
      if (mapped.length > 0) {
        this.customRules = mapped;
        this.renderRules();
      }
    }
  }

  private renderSavedList(): void {
    this.savedListEl.innerHTML = '';
    const entries = this.host.listCustomCartridges();
    if (entries.length === 0) {
      this.savedListEl.appendChild(el('span', 'studio-sub', '尚未儲存任何自製或匯入卡匣'));
      return;
    }
    for (const entry of entries) {
      const row = el('div', 'maker-saved-row');
      const info = el('span', 'maker-saved-title', `${entry.cartridge.meta.title} (${entry.id})`);
      const btns = el('div', 'tool-row');
      btns.append(
        btn(
          'toy-btn',
          '▶ 玩',
          undefined,
          () => {
            this.host.mount(entry.id, false);
            this.onGoPlay?.(entry.id);
          },
          this.ac.signal,
        ),
        btn(
          'toy-btn',
          '✏ 編輯',
          undefined,
          () => {
            this.loadIntoEditor(entry.cartridge, entry.id);
            this.host.playUiSound('snap');
          },
          this.ac.signal,
        ),
        btn(
          'toy-btn is-mint',
          '🧬 Remix',
          undefined,
          () => {
            const remixId = `custom-remix-${Date.now().toString(36)}`;
            const copy = JSON.parse(JSON.stringify(entry.cartridge)) as CartridgeJsonV1;
            copy.meta.title = `${copy.meta.title} Remix`;
            this.loadIntoEditor(copy, remixId);
            this.host.playUiSound('star');
          },
          this.ac.signal,
        ),
        btn(
          'toy-btn is-honey',
          '📸 匯出',
          undefined,
          () => void this.exportPolaroidPng(entry.cartridge),
          this.ac.signal,
        ),
        btn(
          'toy-btn',
          '🗑 刪除',
          undefined,
          () => {
            this.host.deleteCustomCartridge(entry.id);
            if (this.editingCustomId === entry.id) this.editingCustomId = undefined;
            this.renderSavedList();
          },
          this.ac.signal,
        ),
      );
      row.append(info, btns);
      this.savedListEl.appendChild(row);
    }
  }

  private syncSliders(): void {
    const params = this.host.getParams();
    const keys = Object.keys(params) as (keyof typeof DEFAULT_RUNTIME_PARAMS)[];
    for (const key of keys) {
      const item = this.sliders.get(key);
      if (item) {
        item.input.value = String(params[key]);
        item.valEl.textContent = `${params[key]}${item.unit}`;
      }
    }
    this.filterCheck.checked = params.cozyFilter > 0.5;
  }
}
