import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { SANDBOX_DEFAULT_SCRIPT, WORKSHOP_RECIPES } from '../assets/WorkshopRecipes.ts';
import { fbm2D } from '../core/math/NoiseMath.ts';
import { extractCartridgeFromPng } from '../core/runtime/CartridgePngCodec.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type {
  CartridgeArchetypeDef,
  CartridgeCardDef,
  CartridgeControllerKind,
  CartridgeGenreHud,
  CartridgeJsonV1,
  CartridgeStageDef,
  CartridgeStageSpawn,
} from '../core/sim/CartridgeSchema.ts';
type CartridgeFgTileDef = NonNullable<CartridgeStageDef['fgTiles']>[number];
import type { VmAction, VmButtonId, VmCondition, VmRule, VmTrigger } from '../core/sim/EventActionVm.ts';
import { FEEDBACK_RECIPES } from '../core/sim/JuiceSystem.ts';
import {
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_HAZARD,
  COLLISION_SOLID,
  TILE_SIZE,
} from '../core/sim/TilemapGrid.ts';
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
import { atlasSpriteToCanvas } from './MomoMascot.ts';
import {
  buildWorkshopTemplate,
  OFFICIAL_CARD_DECK,
  WORKSHOP_TEMPLATES,
  type WorkshopGenreTemplateId,
} from './WorkshopTemplates.ts';
import { btn, el } from './dom.ts';

type WorkshopScriptMode = 'custom' | 'sandbox' | 'dnd';
type WorkshopLayer = 'main' | 'fg';
type StageCols = 40 | 64 | 80 | 120;
type StageRows = 12 | 16 | 20 | 24;
type ZoomLevel = 0.75 | 1 | 1.5;

type BrushId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

interface BrushDef {
  id: BrushId;
  label: string;
  layer: 'both' | WorkshopLayer;
  tint: string;
  sprite?: SpriteId;
}

const BRUSHES: readonly BrushDef[] = [
  { id: 0, label: '🧹 橡皮擦', layer: 'both', tint: 'rgba(255,255,255,0.12)' },
  { id: 1, label: '🟩 草皮', layer: 'main', tint: 'rgba(86, 211, 156, 0.25)', sprite: 'grass' },
  { id: 2, label: '🧱 石磚', layer: 'main', tint: 'rgba(140, 154, 181, 0.28)', sprite: 'stone' },
  { id: 3, label: '☁️ 雲台', layer: 'main', tint: 'rgba(255, 250, 240, 0.4)', sprite: 'cloud_m' },
  { id: 4, label: '🔺 尖刺', layer: 'main', tint: 'rgba(255, 112, 141, 0.28)', sprite: 'trap' },
  { id: 5, label: '🌀 彈簧', layer: 'main', tint: 'rgba(245, 155, 35, 0.25)', sprite: 'spring' },
  { id: 6, label: '👾 史萊姆', layer: 'main', tint: 'rgba(217, 59, 96, 0.22)', sprite: 'slime_a' },
  { id: 7, label: '⭐ 星星', layer: 'main', tint: 'rgba(255, 212, 71, 0.25)', sprite: 'star_a' },
  { id: 8, label: '🔑 鑰匙', layer: 'main', tint: 'rgba(224, 170, 255, 0.25)', sprite: 'key' },
  { id: 9, label: '🚪 終點門', layer: 'main', tint: 'rgba(94, 194, 247, 0.25)', sprite: 'gate_closed' },
  { id: 10, label: '🚩 出生點', layer: 'main', tint: 'rgba(86, 211, 156, 0.3)', sprite: 'hero_a' },
  { id: 11, label: '🪝 飛鉤環', layer: 'main', tint: 'rgba(255, 212, 71, 0.28)', sprite: 'grapple_ring' },
  { id: 12, label: '💎 重置水晶', layer: 'main', tint: 'rgba(94, 194, 247, 0.28)', sprite: 'crystal_reset' },
  { id: 13, label: '⚡ 軌道衝刺磚', layer: 'main', tint: 'rgba(94, 194, 247, 0.3)', sprite: 'zip_block' },
  { id: 14, label: '🪨 碎裂磚', layer: 'main', tint: 'rgba(212, 163, 115, 0.28)', sprite: 'crumble_tile' },
  { id: 15, label: '🌿 前景樹冠', layer: 'fg', tint: 'rgba(86, 211, 156, 0.32)', sprite: 'tree_canopy' },
];

interface SpecialStageSpawn {
  c: number;
  r: number;
  spawn: CartridgeStageSpawn;
  previewSprite: SpriteId;
}

interface EditableStage {
  id: string;
  name: string;
  hint: string;
  cols: StageCols;
  rows: number;
  bgmTheme: BgmTheme;
  artMoodBase: string;
  artMoodAccent: string;
  skyTop?: string;
  skyBottom?: string;
  ambientDarkness?: number;
  springCamera?: CartridgeStageDef['springCamera'];
  bgParallaxLayers?: CartridgeStageDef['bgParallaxLayers'];
  spawn: { c: number; r: number };
  terrainCells: Uint8Array;
  fgCells: Uint8Array;
  specialSpawns: SpecialStageSpawn[];
}

type IfCondKey = '' | 'p2Hp<=30' | 'mana>=2' | 'switches>=1' | 'combo>=3';

interface RuleDraft {
  whenKey: string;
  ifKey: IfCondKey;
  doType: 'PlaySfx' | 'Juice' | 'Impulse' | 'SetVar' | 'FloatText' | 'EndGame';
  sfxPreset: SimEvent;
  juicePreset: FeedbackPreset;
  floatText: string;
}

const WHEN_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'OnStart', label: '開局時 (OnStart)' },
  { key: 'OnButton:action', label: '按下 A 動作鍵' },
  { key: 'OnButton:skillY', label: '按下 Y 技能/飛鉤擺盪' },
  { key: 'OnButton:shoulderL', label: '按下 L 肩鍵 (OnButton:shoulderL)' },
  { key: 'OnButton:shoulderR', label: '按下 R 牽引鍵' },
  { key: 'OnSignal:fighter_hit', label: '訊號：格鬥命中 (fighter_hit)' },
  { key: 'OnSignal:card_played', label: '訊號：打出卡牌 (card_played)' },
  { key: 'OnSignal:switch_on', label: '訊號：開關啟動 (switch_on)' },
  { key: 'OnSignal:gate_unlocked', label: '訊號：門禁解鎖 (gate_unlocked)' },
  { key: 'OnVar:p2Hp<=0', label: '條件：對手血量歸零 (p2Hp <= 0)' },
  { key: 'OnVar:enemyHp<=0', label: '條件：敵方血量歸零 (enemyHp <= 0)' },
  { key: 'OnCollide:player+star', label: '吃到星星時' },
  { key: 'OnCollide:player+enemy', label: '碰到敵人時' },
  { key: 'OnCollide:player+crystal_reset', label: '觸碰重置水晶時' },
  { key: 'OnCollide:player+switch_off', label: '觸發邏輯開關時' },
  { key: 'OnCollide:player+ember_warden', label: '對決格鬥頭目時' },
  { key: 'OnEvery:120', label: '每 2 秒節拍' },
];

const IF_OPTIONS: readonly { key: IfCondKey; label: string; cond?: VmCondition }[] = [
  { key: '', label: '無條件' },
  { key: 'p2Hp<=30', label: 'p2Hp <= 30', cond: { varName: 'p2Hp', op: '<=', value: 30 } },
  { key: 'mana>=2', label: 'mana >= 2', cond: { varName: 'mana', op: '>=', value: 2 } },
  { key: 'switches>=1', label: 'switches >= 1', cond: { varName: 'switches', op: '>=', value: 1 } },
  { key: 'combo>=3', label: 'combo >= 3', cond: { varName: 'combo', op: '>=', value: 3 } },
];

const CONTROLLER_OPTIONS: readonly { value: Exclude<CartridgeControllerKind, 'shmup'>; label: string }[] = [
  { value: 'platformer', label: '🏃 平台跳躍 (Platformer)' },
  { value: 'fighter', label: '🥊 格鬥對決 (Fighter)' },
  { value: 'card', label: '🃏 回合卡牌 (Card)' },
  { value: 'topdown', label: '🧩 俯視解謎 (TopDown)' },
];

const SFX_AUDITION_PRESETS: readonly { value: SimEvent; label: string }[] = [
  { value: 'star', label: '⭐ 星塵音階' },
  { value: 'jump', label: '⬆ 彈跳音階' },
  { value: 'bounce', label: '🌀 彈簧蹦音' },
  { value: 'rail', label: '🪝 飛鉤射出' },
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

const GENRE_HUD_OPTIONS: readonly { value: CartridgeGenreHud; label: string }[] = [
  { value: 'platformer', label: '平台 HUD (Platformer)' },
  { value: 'parkour', label: '飛鉤跑酷 HUD (Parkour)' },
  { value: 'fighter', label: '雙人格鬥 HUD (Fighter)' },
  { value: 'card', label: '魔導卡牌 HUD (Card)' },
  { value: 'grid', label: '邏輯開關 HUD (Grid)' },
];

const IDE_CANVAS_W = 640;
const IDE_CANVAS_H = 304;
const MAX_STAGES = 8;

const BASE_WORKSHOP_ARCHETYPES: Record<string, CartridgeArchetypeDef> = {
  star: {
    sprite: 'star_a',
    spriteB: 'star_b',
    animFps: 5,
    w: 16,
    h: 16,
    tags: ['collectible', 'star'],
    scoreValue: 100,
    emissive: 0.72,
  },
  key: { sprite: 'key', w: 16, h: 16, tags: ['collectible', 'key'], scoreValue: 200, emissive: 0.72 },
  gate: { sprite: 'gate_closed', spriteB: 'gate_open', w: 16, h: 16, tags: ['gate'], emissive: 0.75 },
  spring: { sprite: 'spring', w: 16, h: 16, tags: ['bouncy'], bounceVy: -275 },
  slime: {
    sprite: 'slime_a',
    spriteB: 'slime_b',
    animFps: 4,
    w: 16,
    h: 16,
    tags: ['enemy', 'stompable', 'hazard', 'gravity'],
    behavior: { kind: 'patrol', speedX: 28 },
    hp: 1,
    scoreValue: 120,
    castShadow: true,
  },
  grapple_ring: {
    sprite: 'grapple_ring',
    w: 16,
    h: 16,
    tags: ['grapple_ring'],
    emissive: 0.85,
    light: { radius: 28, color: '#ffd447', intensity: 0.45 },
  },
  crystal_reset: {
    sprite: 'crystal_reset',
    w: 16,
    h: 16,
    tags: ['crystal_reset'],
    emissive: 0.9,
    light: { radius: 26, color: '#5ec2f7', intensity: 0.55 },
  },
  zip_block: {
    sprite: 'zip_block',
    w: 16,
    h: 16,
    tags: ['zip_block'],
    emissive: 0.75,
    light: { radius: 28, color: '#5ec2f7', intensity: 0.5 },
  },
  crumble_tile: {
    sprite: 'crumble_tile',
    w: 16,
    h: 16,
    tags: ['crumble_tile'],
  },
  switch_off: {
    sprite: 'switch_off',
    spriteB: 'switch_on',
    w: 16,
    h: 16,
    tags: ['logic_switch'],
    scoreValue: 120,
    emissive: 0.72,
  },
  crate: { sprite: 'crate', w: 16, h: 16, tags: ['solid'] },
  spark: { sprite: 'sparkle', w: 8, h: 8, tags: ['bullet'], emissive: 0.9 },
};

export interface WorkshopStudioBridge {
  getStudioSprites: () => { sprites: Record<string, string[]>; paletteRow: number; editEpoch?: number };
  onImportCartridgeFile?: (file: File) => Promise<void>;
}

function snapCols(rawCols: number): StageCols {
  if (rawCols >= 100) return 120;
  if (rawCols >= 72) return 80;
  if (rawCols >= 52) return 64;
  return 40;
}

function snapRows(rawRows: number): StageRows {
  if (rawRows >= 22) return 24;
  if (rawRows >= 18) return 20;
  if (rawRows >= 14) return 16;
  return 12;
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
  private eventUnsub: (() => void) | undefined;

  // Custom Cartridge Workbench 3.0 state
  private editingCustomId: string | undefined;
  private stages: EditableStage[] = [];
  private activeStageIdx = 0;
  private activeLayer: WorkshopLayer = 'main';
  private activeBrush: BrushId = 1;
  private zoom: ZoomLevel = 1;
  private showGrid = true;
  private panX = 0;
  private panY = 0;
  private hoverCol = -1;
  private hoverRow = -1;
  private isPainting = false;
  private isErasingStroke = false;
  private isPanning = false;
  private panStartClientX = 0;
  private panStartClientY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private lastPaintedKey = -1;

  private controllerKind: CartridgeControllerKind = 'platformer';
  private genreHud: CartridgeGenreHud = 'platformer';
  private grappleEnabled = false;
  private playerSprite: SpriteId = 'hero_a';
  private playerSpriteB: SpriteId = 'hero_b';
  private playerMaxHearts = 3;
  private paletteRow = 0;
  private useStudioSprites = true;
  private importedSprites: Record<string, string[]> | undefined;
  private importedSpritesEpoch = -1;
  private preservedInitialVars: Record<string, number> = { combo: 0 };
  private preservedArchetypes: Record<string, CartridgeArchetypeDef> = {};
  private preservedCardDeck: CartridgeCardDef[] | undefined;
  private preservedFullRules: VmRule[] | undefined;
  private rulesDirty = false;
  private customRules: RuleDraft[] = [
    { whenKey: 'OnCollide:player+star', ifKey: '', doType: 'PlaySfx', sfxPreset: 'star', juicePreset: 'relic_burst', floatText: 'NICE!' },
    { whenKey: 'OnButton:skillY', ifKey: '', doType: 'Juice', sfxPreset: 'laser', juicePreset: 'charge_shot', floatText: 'BOOM!' },
  ];
  private fbmSeed = 101;
  private animPhase = 0;
  private rafId = 0;

  private readonly titleInput: HTMLInputElement;
  private readonly controllerSelect: HTMLSelectElement;
  private readonly genreHudSelect: HTMLSelectElement;
  private readonly grappleCheck: HTMLInputElement;
  private readonly colsSelect: HTMLSelectElement;
  private readonly rowsSelect: HTMLSelectElement;
  private readonly bgmSelect: HTMLSelectElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly studioSpriteCheck: HTMLInputElement;
  private readonly stageTabsEl: HTMLElement;
  private readonly mainLayerBtn: HTMLButtonElement;
  private readonly fgLayerBtn: HTMLButtonElement;
  private readonly zoomSelect: HTMLSelectElement;
  private readonly gridCheck: HTMLInputElement;
  private readonly panXInput: HTMLInputElement;
  private readonly panYInput: HTMLInputElement;
  private readonly statusBadgeEl: HTMLElement;
  private readonly brushBtns = new Map<BrushId, HTMLButtonElement>();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
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
    this.stages = [this.createStarterStage(0)];
    this.activeStageIdx = 0;

    this.element = el('section', 'studio-card');

    const head = el('div', 'studio-head');
    head.innerHTML = `
      <div>
        <h2>🧱 積木＆卡匣工坊 3.0（WYSIWYG 畫布編輯・多關卡・風格模板）</h2>
        <p class="studio-sub">雙圖層 Canvas 繪圖、多關卡標籤、4 款官方遊戲引擎範本、When → Do VM 規則與拍立得 PNG 匯出！</p>
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

    const columns = el('div', 'workshop-columns');

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

    // Right: Mode Switcher + Studio Workbench 3.0 / PA-03 / PA-04
    const scriptPane = el('div', 'script-pane');
    const modeRow = el('div', 'tool-row');
    const customTab = btn('toy-btn is-active', '🗺️ 自製工坊 3.0');
    const sandboxTab = btn('toy-btn', '🧱 PA-03 積木');
    const dndTab = btn('toy-btn', '🐉 PA-04 D&D');
    modeRow.append(customTab, sandboxTab, dndTab);

    const customPane = el('div', 'custom-maker-pane');

    // 4-Button Official Genre Template Strip
    const templateStrip = el('div', 'genre-template-strip');
    templateStrip.appendChild(el('strong', undefined, '🎮 一鍵載入官方風格範本：'));
    for (const tpl of WORKSHOP_TEMPLATES) {
      templateStrip.appendChild(
        btn(
          'toy-btn is-mint',
          tpl.buttonLabel,
          tpl.description,
          () => this.applyGenreTemplate(tpl.id),
          this.ac.signal,
        ),
      );
    }

    // Meta Bar: Title, Controller, genreHud, Grapple toggle, BGM, Palette, Studio Sprites
    const metaBar = el('div', 'tool-row');
    this.titleInput = el('input', 'atelier-input');
    this.titleInput.type = 'text';
    this.titleInput.maxLength = 28;
    this.titleInput.value = '我的草莓冒險';
    this.titleInput.placeholder = '卡匣標題';

    this.controllerSelect = el('select', 'atelier-select');
    for (const co of CONTROLLER_OPTIONS) {
      const opt = el('option');
      opt.value = co.value;
      opt.textContent = co.label;
      this.controllerSelect.appendChild(opt);
    }
    this.controllerSelect.addEventListener(
      'change',
      () => {
        const nextCtrl = this.controllerSelect.value as CartridgeControllerKind;
        this.controllerKind = nextCtrl;
        if (nextCtrl === 'fighter') {
          this.genreHud = 'fighter';
          this.genreHudSelect.value = 'fighter';
          this.grappleEnabled = false;
          this.grappleCheck.checked = false;
        } else if (nextCtrl === 'card') {
          this.genreHud = 'card';
          this.genreHudSelect.value = 'card';
          this.grappleEnabled = false;
          this.grappleCheck.checked = false;
          if (!this.preservedCardDeck || this.preservedCardDeck.length === 0) {
            this.preservedCardDeck = OFFICIAL_CARD_DECK.map((c) => ({ ...c }));
          }
        } else if (nextCtrl === 'topdown') {
          this.genreHud = 'grid';
          this.genreHudSelect.value = 'grid';
          this.grappleEnabled = false;
          this.grappleCheck.checked = false;
        } else if (this.genreHud === 'fighter' || this.genreHud === 'card' || this.genreHud === 'grid') {
          this.genreHud = this.grappleEnabled ? 'parkour' : 'platformer';
          this.genreHudSelect.value = this.genreHud;
        }
        this.renderCanvas();
      },
      { signal: this.ac.signal },
    );

    this.genreHudSelect = el('select', 'atelier-select');
    for (const gh of GENRE_HUD_OPTIONS) {
      const opt = el('option');
      opt.value = gh.value;
      opt.textContent = gh.label;
      this.genreHudSelect.appendChild(opt);
    }
    this.genreHudSelect.addEventListener(
      'change',
      () => {
        this.genreHud = this.genreHudSelect.value as CartridgeGenreHud;
        if (this.genreHud === 'parkour') {
          this.grappleEnabled = true;
          this.grappleCheck.checked = true;
        }
      },
      { signal: this.ac.signal },
    );

    const grappleLabel = el('label', 'maker-check-pill');
    this.grappleCheck = el('input');
    this.grappleCheck.type = 'checkbox';
    this.grappleCheck.checked = false;
    this.grappleCheck.addEventListener(
      'change',
      () => {
        this.grappleEnabled = this.grappleCheck.checked;
      },
      { signal: this.ac.signal },
    );
    grappleLabel.append(this.grappleCheck, el('span', undefined, '🪝 啟用飛鉤'));

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
        this.getCurrentStage().bgmTheme = this.bgmSelect.value as BgmTheme;
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
        this.renderCanvas();
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

    metaBar.append(
      this.titleInput,
      this.controllerSelect,
      this.genreHudSelect,
      grappleLabel,
      this.bgmSelect,
      this.paletteSelect,
      spriteToggleLabel,
    );

    // Multi-Stage Tabs + Size & FBM Terrain Bar
    const stageBar = el('div', 'atelier-workbench-bar');
    this.stageTabsEl = el('div', 'tool-row');

    this.colsSelect = el('select', 'atelier-select');
    for (const w of [40, 64, 80, 120] as const) {
      const opt = el('option');
      opt.value = String(w);
      opt.textContent = `${w} 寬格`;
      this.colsSelect.appendChild(opt);
    }
    this.colsSelect.addEventListener(
      'change',
      () => this.resizeCurrentStage(Number(this.colsSelect.value) as StageCols, this.getCurrentStage().rows),
      { signal: this.ac.signal },
    );

    this.rowsSelect = el('select', 'atelier-select');
    for (const h of [12, 16, 20, 24] as const) {
      const opt = el('option');
      opt.value = String(h);
      opt.textContent = `${h} 高格`;
      this.rowsSelect.appendChild(opt);
    }
    this.rowsSelect.addEventListener(
      'change',
      () => this.resizeCurrentStage(this.getCurrentStage().cols, Number(this.rowsSelect.value) as StageRows),
      { signal: this.ac.signal },
    );

    const addStageBtn = btn(
      'toy-btn is-mint',
      '＋ 新增關卡',
      undefined,
      () => {
        if (this.stages.length >= MAX_STAGES) return;
        const st = this.createStarterStage(this.stages.length);
        this.stages.push(st);
        this.selectStage(this.stages.length - 1);
      },
      this.ac.signal,
    );
    const delStageBtn = btn(
      'toy-btn',
      '－ 刪除此關',
      undefined,
      () => {
        if (this.stages.length <= 1) return;
        this.stages.splice(this.activeStageIdx, 1);
        this.selectStage(Math.min(this.activeStageIdx, this.stages.length - 1));
      },
      this.ac.signal,
    );
    const fbmBtn = btn(
      'toy-btn is-honey',
      '🌄 生成隨機地形',
      '使用 Simplex FBM 產生隨機山丘、雲梯與道具配置',
      () => this.generateProceduralTerrain(),
      this.ac.signal,
    );

    stageBar.append(this.stageTabsEl, addStageBtn, delStageBtn, this.colsSelect, this.rowsSelect, fbmBtn);

    // Layer Switcher, Zoom, Grid Toggle, Pan Controls, Status Readout
    const viewBar = el('div', 'atelier-workbench-bar');
    this.mainLayerBtn = btn(
      'toy-btn is-active',
      '🗺️ 主地形與物件',
      undefined,
      () => this.setLayer('main'),
      this.ac.signal,
    );
    this.fgLayerBtn = btn(
      'toy-btn',
      '🌿 前景遮罩 (FG)',
      undefined,
      () => this.setLayer('fg'),
      this.ac.signal,
    );

    this.zoomSelect = el('select', 'atelier-select');
    for (const z of [0.75, 1, 1.5] as const) {
      const opt = el('option');
      opt.value = String(z);
      opt.textContent = `縮放 ${z}x`;
      this.zoomSelect.appendChild(opt);
    }
    this.zoomSelect.value = '1';
    this.zoomSelect.addEventListener(
      'change',
      () => {
        this.zoom = (Number(this.zoomSelect.value) as ZoomLevel) || 1;
        this.clampPan();
        this.syncPanInputs();
        this.renderCanvas();
        this.updateStatusBadge();
      },
      { signal: this.ac.signal },
    );

    const gridLabel = el('label', 'maker-check-pill');
    this.gridCheck = el('input');
    this.gridCheck.type = 'checkbox';
    this.gridCheck.checked = true;
    this.gridCheck.addEventListener(
      'change',
      () => {
        this.showGrid = this.gridCheck.checked;
        this.renderCanvas();
      },
      { signal: this.ac.signal },
    );
    gridLabel.append(this.gridCheck, el('span', undefined, '網格顯示'));

    this.panXInput = el('input', 'atelier-range');
    this.panXInput.type = 'range';
    this.panXInput.min = '0';
    this.panXInput.max = '0';
    this.panXInput.value = '0';
    this.panXInput.style.width = '90px';
    this.panXInput.title = '水平捲動視野 (Alt+拖曳或滾輪)';
    this.panXInput.addEventListener(
      'input',
      () => {
        this.panX = Number(this.panXInput.value) || 0;
        this.renderCanvas();
      },
      { signal: this.ac.signal },
    );

    this.panYInput = el('input', 'atelier-range');
    this.panYInput.type = 'range';
    this.panYInput.min = '0';
    this.panYInput.max = '0';
    this.panYInput.value = '0';
    this.panYInput.style.width = '64px';
    this.panYInput.title = '垂直捲動視野';
    this.panYInput.addEventListener(
      'input',
      () => {
        this.panY = Number(this.panYInput.value) || 0;
        this.renderCanvas();
      },
      { signal: this.ac.signal },
    );

    this.statusBadgeEl = el('span', 'atelier-light-readout', '座標 (-, -) · 比例 1x · 關卡 1/1');
    viewBar.append(
      this.mainLayerBtn,
      this.fgLayerBtn,
      this.zoomSelect,
      gridLabel,
      el('span', 'atelier-light-readout', 'X'),
      this.panXInput,
      el('span', 'atelier-light-readout', 'Y'),
      this.panYInput,
      this.statusBadgeEl,
    );

    // 16 Brushes Palette (each button shows real pixel-art icon from TextureAtlas)
    const brushRow = el('div', 'tool-row');
    for (const br of BRUSHES) {
      const b = btn(
        br.id === this.activeBrush ? 'toy-btn is-active' : 'toy-btn',
        '',
        br.label,
        () => this.selectBrush(br.id),
        this.ac.signal,
      );
      b.style.display = 'inline-flex';
      b.style.alignItems = 'center';
      b.style.gap = '4px';
      if (br.sprite) {
        const iconCanvas = el('canvas');
        iconCanvas.width = 16;
        iconCanvas.height = 16;
        Object.assign(iconCanvas.style, {
          width: '16px',
          height: '16px',
          imageRendering: 'pixelated',
          flexShrink: '0',
        });
        const ictx = iconCanvas.getContext('2d');
        if (ictx) {
          ictx.imageSmoothingEnabled = false;
          ictx.drawImage(atlasSpriteToCanvas(this.atlas, br.sprite), 0, 0, 16, 16);
        }
        b.appendChild(iconCanvas);
      }
      b.appendChild(el('span', undefined, br.label));
      this.brushBtns.set(br.id, b);
      brushRow.appendChild(b);
    }

    // Real HTML5 Canvas WYSIWYG Level IDE Stage
    const canvasStage = el('div', 'workshop-canvas-stage');
    this.canvas = el('canvas', 'workshop-canvas');
    this.canvas.width = IDE_CANVAS_W;
    this.canvas.height = IDE_CANVAS_H;
    this.canvas.style.width = '100%';
    this.canvas.style.maxWidth = `${IDE_CANVAS_W}px`;
    this.canvas.style.height = 'auto';
    this.ctx = this.canvas.getContext('2d');

    this.attachCanvasListeners();
    canvasStage.appendChild(this.canvas);

    // When -> If -> Do Rule Builder
    const rulesBox = el('div', 'maker-rules-box');
    const rulesHead = el('div', 'tool-row');
    rulesHead.append(
      el('strong', undefined, '🧩 When → If → Do 積木規則（純 VM、即時試聽）'),
      btn(
        'toy-btn is-mint',
        '＋ 新增規則',
        undefined,
        () => {
          if (this.customRules.length >= 12) return;
          this.customRules.push({
            whenKey: 'OnButton:action',
            ifKey: '',
            doType: 'PlaySfx',
            sfxPreset: 'jump',
            juicePreset: 'dash_kick',
            floatText: 'NICE!',
          });
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
          this.renderRules();
        },
        this.ac.signal,
      ),
    );
    this.rulesListEl = el('div', 'maker-rules-list');
    rulesBox.append(rulesHead, this.rulesListEl);
    this.renderRules();

    // Actions: Play, Export Polaroid PNG, Import PNG/JSON, New Blank
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
          this.importedSprites = undefined;
          this.importedSpritesEpoch = -1;
          this.useStudioSprites = true;
          this.studioSpriteCheck.checked = true;
          this.controllerKind = 'platformer';
          this.controllerSelect.value = 'platformer';
          this.genreHud = 'platformer';
          this.genreHudSelect.value = 'platformer';
          this.grappleEnabled = false;
          this.grappleCheck.checked = false;
          this.playerSprite = 'hero_a';
          this.playerSpriteB = 'hero_b';
          this.playerMaxHearts = 3;
          this.preservedInitialVars = { combo: 0 };
          this.preservedArchetypes = {};
          this.preservedCardDeck = undefined;
          this.preservedFullRules = undefined;
          this.rulesDirty = false;
          this.titleInput.value = '我的新冒險';
          this.stages = [this.createStarterStage(0)];
          this.selectStage(0);
        },
        this.ac.signal,
      ),
      this.fileInput,
    );

    const savedBox = el('div', 'maker-saved-box');
    savedBox.appendChild(el('strong', undefined, '💾 本機自製／匯入卡匣庫（上限 16 張）'));
    this.savedListEl = el('div', 'maker-saved-list');
    savedBox.appendChild(this.savedListEl);
    this.renderSavedList();

    customPane.append(templateStrip, metaBar, stageBar, viewBar, brushRow, canvasStage, rulesBox, actionRow, savedBox);

    // Legacy PA-03 & PA-04 Pane
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
    columns.append(paramList, scriptPane);
    this.element.append(head, columns);

    this.syncStageUi();
    this.eventUnsub = this.host.events.on('plugin:registered', () => this.renderSavedList());
    this.startCursorLoop();
  }

  public destroy(): void {
    this.isPainting = false;
    this.isPanning = false;
    this.lastPaintedKey = -1;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.eventUnsub?.();
    this.eventUnsub = undefined;
    this.ac.abort();
    this.sliders.clear();
  }

  public refreshSavedCartridges(): void {
    this.renderSavedList();
  }

  private getCurrentStage(): EditableStage {
    return this.stages[this.activeStageIdx] ?? this.stages[0];
  }

  private createStarterStage(idx: number): EditableStage {
    const cols: StageCols = 40;
    const rows: StageRows = 12;
    const terrainCells = new Uint8Array(cols * rows);
    const fgCells = new Uint8Array(cols * rows);
    for (let c = 0; c < cols; c++) {
      terrainCells[10 * cols + c] = 1;
      terrainCells[11 * cols + c] = 2;
    }
    for (let c = 14; c <= 16; c++) {
      terrainCells[10 * cols + c] = 0;
      terrainCells[11 * cols + c] = 4;
      terrainCells[7 * cols + c] = 3;
    }
    for (let c = 22; c <= 25; c++) terrainCells[7 * cols + c] = 2;
    terrainCells[9 * cols + 10] = 5;
    terrainCells[6 * cols + 15] = 7;
    terrainCells[6 * cols + 23] = 7;
    terrainCells[9 * cols + 20] = 6;
    terrainCells[9 * cols + 30] = 8;
    terrainCells[9 * cols + 36] = 9;
    fgCells[9 * cols + 5] = 15;
    return {
      id: `custom-stage-${idx + 1}`,
      name: `關卡 ${idx + 1}`,
      hint: '方向移動 · B 跳躍 · L 重試',
      cols,
      rows,
      bgmTheme: idx % 2 === 0 ? 'meadow' : 'starlight',
      artMoodBase: idx % 2 === 0 ? '#1b2648' : '#181136',
      artMoodAccent: idx % 2 === 0 ? '#ffd447' : '#ff5d8f',
      skyTop: '#76c7ff',
      skyBottom: '#fff3df',
      spawn: { c: 2, r: 9 },
      terrainCells,
      fgCells,
      specialSpawns: [],
    };
  }

  private selectStage(idx: number): void {
    this.activeStageIdx = Math.max(0, Math.min(this.stages.length - 1, idx));
    this.panX = 0;
    this.panY = 0;
    this.syncStageUi();
  }

  private resizeCurrentStage(nextCols: StageCols, nextRows: number): void {
    const st = this.getCurrentStage();
    const clampedRows = Math.max(12, Math.min(24, nextRows));
    if (st.cols === nextCols && st.rows === clampedRows) return;
    const nextTerrain = new Uint8Array(nextCols * clampedRows);
    const nextFg = new Uint8Array(nextCols * clampedRows);
    const rowShift = clampedRows - st.rows;
    for (let r = 0; r < st.rows; r++) {
      const dstR = r + rowShift;
      if (dstR < 0 || dstR >= clampedRows) continue;
      for (let c = 0; c < st.cols && c < nextCols; c++) {
        nextTerrain[dstR * nextCols + c] = st.terrainCells[r * st.cols + c];
        nextFg[dstR * nextCols + c] = st.fgCells[r * st.cols + c];
      }
    }
    st.cols = nextCols;
    st.rows = clampedRows;
    st.terrainCells = nextTerrain;
    st.fgCells = nextFg;
    st.spawn = {
      c: Math.max(0, Math.min(nextCols - 1, st.spawn.c)),
      r: Math.max(0, Math.min(clampedRows - 1, st.spawn.r + rowShift)),
    };
    st.specialSpawns = st.specialSpawns
      .map((sp) => ({ ...sp, r: sp.r + rowShift }))
      .filter((sp) => sp.c >= 0 && sp.c < nextCols && sp.r >= 0 && sp.r < clampedRows);
    this.clampPan();
    this.syncStageUi();
  }

  private setLayer(layer: WorkshopLayer): void {
    this.activeLayer = layer;
    this.mainLayerBtn.classList.toggle('is-active', layer === 'main');
    this.fgLayerBtn.classList.toggle('is-active', layer === 'fg');
    if (layer === 'fg' && this.activeBrush !== 0 && this.activeBrush !== 15) {
      this.selectBrush(15);
    }
    this.renderCanvas();
  }

  private selectBrush(id: BrushId): void {
    this.activeBrush = id;
    for (const [bid, bEl] of this.brushBtns.entries()) {
      bEl.classList.toggle('is-active', bid === id);
    }
    if (id === 15 && this.activeLayer !== 'fg') {
      this.activeLayer = 'fg';
      this.mainLayerBtn.classList.remove('is-active');
      this.fgLayerBtn.classList.add('is-active');
    } else if (id >= 1 && id <= 14 && this.activeLayer !== 'main') {
      this.activeLayer = 'main';
      this.mainLayerBtn.classList.add('is-active');
      this.fgLayerBtn.classList.remove('is-active');
    }
    this.renderCanvas();
  }

  private renderStageTabs(): void {
    this.stageTabsEl.innerHTML = '';
    this.stages.forEach((st, idx) => {
      const b = btn(
        idx === this.activeStageIdx ? 'toy-btn is-active' : 'toy-btn',
        `關卡 ${idx + 1}`,
        st.name,
        () => this.selectStage(idx),
        this.ac.signal,
      );
      this.stageTabsEl.appendChild(b);
    });
  }

  private syncStageUi(): void {
    const st = this.getCurrentStage();
    this.colsSelect.value = String(snapCols(st.cols));
    this.rowsSelect.value = String(snapRows(st.rows));
    this.bgmSelect.value = st.bgmTheme;
    this.clampPan();
    this.syncPanInputs();
    this.renderStageTabs();
    this.updateStatusBadge();
    this.renderCanvas();
  }

  private clampPan(): void {
    const st = this.getCurrentStage();
    const step = TILE_SIZE * this.zoom;
    const maxPanX = Math.max(0, st.cols * step - IDE_CANVAS_W);
    const maxPanY = Math.max(0, st.rows * step - IDE_CANVAS_H);
    this.panX = Math.max(0, Math.min(maxPanX, this.panX));
    this.panY = Math.max(0, Math.min(maxPanY, this.panY));
  }

  private syncPanInputs(): void {
    const st = this.getCurrentStage();
    const step = TILE_SIZE * this.zoom;
    const maxPanX = Math.max(0, Math.ceil(st.cols * step - IDE_CANVAS_W));
    const maxPanY = Math.max(0, Math.ceil(st.rows * step - IDE_CANVAS_H));
    this.panXInput.max = String(maxPanX);
    this.panXInput.value = String(Math.round(this.panX));
    this.panXInput.disabled = maxPanX <= 0;
    this.panYInput.max = String(maxPanY);
    this.panYInput.value = String(Math.round(this.panY));
    this.panYInput.disabled = maxPanY <= 0;
  }

  private updateStatusBadge(): void {
    const coord = this.hoverCol >= 0 && this.hoverRow >= 0 ? `(${this.hoverCol}, ${this.hoverRow})` : '(-, -)';
    this.statusBadgeEl.textContent = `座標 ${coord} · 比例 ${this.zoom}x · 關卡 ${this.activeStageIdx + 1}/${this.stages.length}`;
  }

  private generateProceduralTerrain(): void {
    const st = this.getCurrentStage();
    this.fbmSeed = (this.fbmSeed + 37) | 0;
    st.terrainCells.fill(0);
    st.fgCells.fill(0);
    st.specialSpawns = [];

    const baseRow = st.rows - 2;
    let lastSurfaceRow = baseRow;
    for (let c = 0; c < st.cols; c++) {
      const safeEdge = c <= 4 || c >= st.cols - 5;
      const pitNoise = fbm2D(c * 0.14, 1.7, 2, 2.0, 0.5, this.fbmSeed + 19);
      if (!safeEdge && pitNoise < -0.36) {
        st.terrainCells[(st.rows - 1) * st.cols + c] = 4; // hazard spikes
        if (c % 3 === 0 && baseRow - 4 >= 2) {
          st.terrainCells[(baseRow - 4) * st.cols + c] = this.grappleEnabled ? 11 : 3;
        }
        continue;
      }
      const hNoise = fbm2D(c * 0.08, 0.4, 3, 2.02, 0.5, this.fbmSeed);
      const hillRow = safeEdge
        ? baseRow
        : Math.max(4, Math.min(st.rows - 2, Math.round(baseRow - (hNoise + 0.35) * 2.6)));
      lastSurfaceRow = hillRow;
      st.terrainCells[hillRow * st.cols + c] = 1;
      for (let r = hillRow + 1; r < st.rows; r++) {
        st.terrainCells[r * st.cols + c] = 2;
      }
      if (!safeEdge && c % 11 === 6 && hillRow >= 4) {
        st.terrainCells[(hillRow - 3) * st.cols + c] = 7; // star
      }
      if (!safeEdge && c % 14 === 9 && hillRow >= 3) {
        st.terrainCells[(hillRow - 1) * st.cols + c] = this.grappleEnabled && c % 28 === 9 ? 12 : 6;
      }
      if (!safeEdge && c % 13 === 4 && hillRow >= 3) {
        st.fgCells[(hillRow - 1) * st.cols + c] = 15;
      }
    }
    st.spawn = { c: 2, r: Math.max(1, baseRow - 1) };
    st.terrainCells[Math.max(1, lastSurfaceRow - 1) * st.cols + (st.cols - 3)] = 9;
    this.host.playUiSound('star');
    this.renderCanvas();
  }

  private applyGenreTemplate(id: WorkshopGenreTemplateId): void {
    this.host.unlockAudio();
    const tpl = buildWorkshopTemplate(id, this.host);
    this.loadIntoEditor(tpl, tpl.meta.id);
    this.host.playUiSound('snap');
  }

  private attachCanvasListeners(): void {
    const clientToCell = (clientX: number, clientY: number): { c: number; r: number } => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { c: -1, r: -1 };
      const canvasX = ((clientX - rect.left) / rect.width) * IDE_CANVAS_W;
      const canvasY = ((clientY - rect.top) / rect.height) * IDE_CANVAS_H;
      const step = TILE_SIZE * this.zoom;
      const st = this.getCurrentStage();
      const c = Math.floor((canvasX + this.panX) / step);
      const r = Math.floor((canvasY + this.panY) / step);
      if (c < 0 || c >= st.cols || r < 0 || r >= st.rows) return { c: -1, r: -1 };
      return { c, r };
    };

    const stopAll = () => {
      this.isPainting = false;
      this.isErasingStroke = false;
      this.isPanning = false;
      this.lastPaintedKey = -1;
    };

    this.canvas.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
      },
      { signal: this.ac.signal },
    );

    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.host.unlockAudio();
        if (e.button === 1 || e.altKey) {
          this.isPanning = true;
          this.panStartClientX = e.clientX;
          this.panStartClientY = e.clientY;
          this.panOriginX = this.panX;
          this.panOriginY = this.panY;
        } else {
          this.isPainting = true;
          this.isErasingStroke = e.button === 2;
          this.lastPaintedKey = -1;
          const cell = clientToCell(e.clientX, e.clientY);
          this.hoverCol = cell.c;
          this.hoverRow = cell.r;
          if (cell.c >= 0 && cell.r >= 0) {
            this.paintCell(cell.c, cell.r, this.isErasingStroke);
          }
        }
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore browsers rejecting pointer capture on synthetic events
        }
      },
      { signal: this.ac.signal },
    );

    this.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (this.isPanning) {
          const rect = this.canvas.getBoundingClientRect();
          const scaleX = rect.width > 0 ? IDE_CANVAS_W / rect.width : 1;
          const scaleY = rect.height > 0 ? IDE_CANVAS_H / rect.height : 1;
          this.panX = this.panOriginX - (e.clientX - this.panStartClientX) * scaleX;
          this.panY = this.panOriginY - (e.clientY - this.panStartClientY) * scaleY;
          this.clampPan();
          this.syncPanInputs();
          this.renderCanvas();
          return;
        }
        const cell = clientToCell(e.clientX, e.clientY);
        const changedHover = cell.c !== this.hoverCol || cell.r !== this.hoverRow;
        this.hoverCol = cell.c;
        this.hoverRow = cell.r;
        if (this.isPainting && cell.c >= 0 && cell.r >= 0) {
          this.paintCell(cell.c, cell.r, this.isErasingStroke);
        } else if (changedHover) {
          this.updateStatusBadge();
          this.renderCanvas();
        }
      },
      { signal: this.ac.signal },
    );

    this.canvas.addEventListener(
      'pointerleave',
      () => {
        this.hoverCol = -1;
        this.hoverRow = -1;
        this.updateStatusBadge();
        this.renderCanvas();
      },
      { signal: this.ac.signal },
    );

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const st = this.getCurrentStage();
        const step = TILE_SIZE * this.zoom;
        const canScrollX = st.cols * step > IDE_CANVAS_W;
        const canScrollY = st.rows * step > IDE_CANVAS_H;
        if (!canScrollX && !canScrollY) return;
        e.preventDefault();
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
        const dy = dx === 0 && canScrollY ? e.deltaY : 0;
        this.panX += dx !== 0 ? dx : e.deltaY * 0.7;
        this.panY += dy;
        this.clampPan();
        this.syncPanInputs();
        this.renderCanvas();
      },
      { signal: this.ac.signal, passive: false },
    );

    this.canvas.addEventListener('pointercancel', stopAll, { signal: this.ac.signal });
    window.addEventListener('pointerup', stopAll, { signal: this.ac.signal });
  }

  private paintCell(col: number, row: number, forceErase = false): void {
    const st = this.getCurrentStage();
    const idx = row * st.cols + col;
    const key = idx * 4 + (this.activeLayer === 'fg' ? 1 : 0) + (forceErase ? 2 : 0);
    if (key === this.lastPaintedKey) return;
    this.lastPaintedKey = key;

    const brush = forceErase ? 0 : this.activeBrush;
    if (this.activeLayer === 'fg' || brush === 15) {
      st.fgCells[idx] = brush === 15 ? 15 : 0;
    } else if (brush === 10) {
      st.spawn = { c: col, r: row };
      st.terrainCells[idx] = 0;
    } else {
      st.terrainCells[idx] = brush;
      if (st.specialSpawns.length > 0) {
        st.specialSpawns = st.specialSpawns.filter((sp) => !(sp.c === col && sp.r === row));
      }
    }

    this.host.playTactile('ui', 'down');
    this.updateStatusBadge();
    this.renderCanvas();
  }

  private startCursorLoop(): void {
    const step = () => {
      if (this.ac.signal.aborted) return;
      if (this.mode === 'custom' && this.hoverCol >= 0 && this.hoverRow >= 0) {
        this.animPhase += 0.12;
        this.renderCanvas();
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = this.getCurrentStage();
    const step = TILE_SIZE * this.zoom;

    ctx.imageSmoothingEnabled = false;

    // 1. Sky Mood Gradient + Subtle Parallax Horizon Silhouettes
    const grad = ctx.createLinearGradient(0, 0, 0, IDE_CANVAS_H);
    grad.addColorStop(0, st.artMoodBase || '#181434');
    grad.addColorStop(1, st.artMoodAccent || '#ff5d8f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, IDE_CANVAS_W, IDE_CANVAS_H);

    // Subtle parallax skyline hints
    ctx.fillStyle = 'rgba(18, 14, 36, 0.24)';
    ctx.beginPath();
    ctx.moveTo(0, IDE_CANVAS_H);
    for (let x = 0; x <= IDE_CANVAS_W + 32; x += 32) {
      const wx = x + this.panX * 0.25;
      const hillY = IDE_CANVAS_H * 0.62 + Math.sin(wx * 0.015) * 18 + Math.cos(wx * 0.032) * 10;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(IDE_CANVAS_W, IDE_CANVAS_H);
    ctx.closePath();
    ctx.fill();

    // Visible world bounds clipping indicator
    const worldW = st.cols * step;
    const worldH = st.rows * step;
    ctx.fillStyle = 'rgba(10, 8, 24, 0.35)';
    if (worldW - this.panX < IDE_CANVAS_W) {
      ctx.fillRect(worldW - this.panX, 0, IDE_CANVAS_W - (worldW - this.panX), IDE_CANVAS_H);
    }
    if (worldH - this.panY < IDE_CANVAS_H) {
      ctx.fillRect(0, worldH - this.panY, IDE_CANVAS_W, IDE_CANVAS_H - (worldH - this.panY));
    }

    const cStart = Math.max(0, Math.floor(this.panX / step));
    const cEnd = Math.min(st.cols - 1, Math.ceil((this.panX + IDE_CANVAS_W) / step));
    const rStart = Math.max(0, Math.floor(this.panY / step));
    const rEnd = Math.min(st.rows - 1, Math.ceil((this.panY + IDE_CANVAS_H) / step));

    // 2. Main Layer Terrain & Objects
    ctx.save();
    if (this.activeLayer === 'fg') ctx.globalAlpha = 0.52;
    for (let r = rStart; r <= rEnd; r++) {
      const dy = Math.round(r * step - this.panY);
      for (let c = cStart; c <= cEnd; c++) {
        const val = st.terrainCells[r * st.cols + c] as BrushId;
        if (val === 0) continue;
        const br = BRUSHES[val];
        if (!br?.sprite) continue;
        const dx = Math.round(c * step - this.panX);
        ctx.drawImage(atlasSpriteToCanvas(this.atlas, br.sprite), dx, dy, Math.ceil(step), Math.ceil(step));
      }
    }

    // Preserved Special Spawns (ember_warden, astral_core, switch_off, etc.)
    for (const sp of st.specialSpawns) {
      if (sp.c < cStart || sp.c > cEnd || sp.r < rStart || sp.r > rEnd) continue;
      const dx = Math.round(sp.c * step - this.panX);
      const dy = Math.round(sp.r * step - this.panY);
      ctx.drawImage(atlasSpriteToCanvas(this.atlas, sp.previewSprite), dx, dy, Math.ceil(step), Math.ceil(step));
    }

    // Player Spawn Marker
    const sx = Math.round(st.spawn.c * step - this.panX);
    const sy = Math.round(st.spawn.r * step - this.panY);
    if (sx + step >= 0 && sx <= IDE_CANVAS_W && sy + step >= 0 && sy <= IDE_CANVAS_H) {
      ctx.fillStyle = 'rgba(86, 211, 156, 0.28)';
      ctx.fillRect(sx, sy, step, step);
      ctx.drawImage(
        atlasSpriteToCanvas(this.atlas, this.grappleEnabled ? 'parkour_hero_idle' : this.playerSprite),
        sx,
        sy,
        Math.ceil(step),
        Math.ceil(step),
      );
    }
    ctx.restore();

    // 3. Foreground Mask Layer (FG)
    ctx.save();
    ctx.globalAlpha = this.activeLayer === 'fg' ? 0.96 : 0.65;
    for (let r = rStart; r <= rEnd; r++) {
      const dy = Math.round(r * step - this.panY);
      for (let c = cStart; c <= cEnd; c++) {
        if (st.fgCells[r * st.cols + c] === 0) continue;
        const dx = Math.round(c * step - this.panX);
        ctx.drawImage(atlasSpriteToCanvas(this.atlas, 'tree_canopy'), dx, dy, Math.ceil(step), Math.ceil(step));
      }
    }
    ctx.restore();

    // 4. Optional Tile Grid Lines
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(255, 250, 240, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = cStart; c <= cEnd + 1; c++) {
        const x = Math.round(c * step - this.panX) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, Math.min(IDE_CANVAS_H, worldH - this.panY));
      }
      for (let r = rStart; r <= rEnd + 1; r++) {
        const y = Math.round(r * step - this.panY) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(Math.min(IDE_CANVAS_W, worldW - this.panX), y);
      }
      ctx.stroke();
    }

    // 5. Animated Brush Hover Ghost & Selection Cursor
    if (this.hoverCol >= 0 && this.hoverRow >= 0 && this.hoverCol < st.cols && this.hoverRow < st.rows) {
      const hx = Math.round(this.hoverCol * step - this.panX);
      const hy = Math.round(this.hoverRow * step - this.panY);
      const activeBr = BRUSHES[this.activeBrush];
      if (activeBr?.sprite) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.drawImage(atlasSpriteToCanvas(this.atlas, activeBr.sprite), hx, hy, Math.ceil(step), Math.ceil(step));
        ctx.restore();
      }
      const pulse = 0.55 + 0.45 * Math.sin(this.animPhase);
      ctx.strokeStyle = this.activeLayer === 'fg' ? `rgba(86, 211, 156, ${pulse})` : `rgba(255, 212, 71, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, Math.max(2, step - 2), Math.max(2, step - 2));
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
      if (!WHEN_OPTIONS.some((w) => w.key === rule.whenKey) && rule.whenKey) {
        const customOpt = el('option');
        customOpt.value = rule.whenKey;
        customOpt.textContent = rule.whenKey;
        whenSel.appendChild(customOpt);
      }
      whenSel.value = rule.whenKey || WHEN_OPTIONS[0].key;
      whenSel.addEventListener(
        'change',
        () => {
          rule.whenKey = whenSel.value;
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
        },
        { signal: this.ac.signal },
      );

      const ifSel = el('select', 'atelier-select');
      for (const condOpt of IF_OPTIONS) {
        const opt = el('option');
        opt.value = condOpt.key;
        opt.textContent = condOpt.label;
        ifSel.appendChild(opt);
      }
      ifSel.value = IF_OPTIONS.some((c) => c.key === rule.ifKey) ? rule.ifKey : '';
      ifSel.addEventListener(
        'change',
        () => {
          rule.ifKey = ifSel.value as IfCondKey;
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
        },
        { signal: this.ac.signal },
      );

      const doSel = el('select', 'atelier-select');
      for (const [val, label] of [
        ['PlaySfx', '🔊 播放音階音效'],
        ['Juice', '✨ 視覺果汁＋震動'],
        ['FloatText', '💬 浮動像素文字'],
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
      const floatInput = el('input', 'atelier-input');
      floatInput.type = 'text';
      floatInput.maxLength = 18;
      floatInput.placeholder = '像素文字';
      floatInput.value = rule.floatText || 'NICE!';
      floatInput.style.width = '104px';

      const rebuildSub = () => {
        subSel.innerHTML = '';
        if (rule.doType === 'PlaySfx') {
          subSel.classList.remove('panel-hidden');
          floatInput.classList.add('panel-hidden');
          for (const s of SFX_AUDITION_PRESETS) {
            const opt = el('option');
            opt.value = s.value;
            opt.textContent = s.label;
            subSel.appendChild(opt);
          }
          subSel.value = rule.sfxPreset;
        } else if (rule.doType === 'Juice') {
          subSel.classList.remove('panel-hidden');
          floatInput.classList.add('panel-hidden');
          for (const j of JUICE_PRESETS) {
            const opt = el('option');
            opt.value = j.value;
            opt.textContent = j.label;
            subSel.appendChild(opt);
          }
          subSel.value = rule.juicePreset;
        } else if (rule.doType === 'FloatText') {
          subSel.classList.add('panel-hidden');
          floatInput.classList.remove('panel-hidden');
        } else {
          subSel.classList.add('panel-hidden');
          floatInput.classList.add('panel-hidden');
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
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
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
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
          auditionCurrent();
        },
        { signal: this.ac.signal },
      );

      floatInput.addEventListener(
        'input',
        () => {
          rule.floatText = floatInput.value;
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
        },
        { signal: this.ac.signal },
      );

      const delBtn = btn(
        'toy-btn',
        '✕',
        '刪除此規則',
        () => {
          this.customRules.splice(idx, 1);
          this.rulesDirty = true;
          this.preservedFullRules = undefined;
          this.renderRules();
        },
        this.ac.signal,
      );

      row.append(
        el('span', 'rule-badge', 'WHEN'),
        whenSel,
        el('span', 'rule-badge', 'IF'),
        ifSel,
        el('span', 'rule-badge', 'DO'),
        doSel,
        subSel,
        floatInput,
        delBtn,
      );
      this.rulesListEl.appendChild(row);
    });
  }

  private compileVmRules(): VmRule[] {
    if (!this.rulesDirty && this.preservedFullRules) {
      return this.preservedFullRules;
    }
    return this.customRules.map((r, i) => {
      let when: VmTrigger;
      if (r.whenKey === 'OnStart') when = { type: 'OnStart' };
      else if (r.whenKey.startsWith('OnEvery:')) {
        when = { type: 'OnEvery', intervalTicks: Number(r.whenKey.split(':')[1]) || 120 };
      } else if (r.whenKey.startsWith('OnSignal:')) {
        when = { type: 'OnSignal', signal: r.whenKey.slice('OnSignal:'.length) || 'fighter_hit' };
      } else if (r.whenKey.startsWith('OnVar:')) {
        const m = /^OnVar:([a-zA-Z0-9_]+)(==|!=|<=|>=|<|>)(-?\d+(?:\.\d+)?)$/.exec(r.whenKey);
        if (m) {
          when = {
            type: 'OnVar',
            varName: m[1],
            op: m[2] as VmCondition['op'],
            value: Number(m[3]),
            edge: true,
          };
        } else {
          when = { type: 'OnStart' };
        }
      } else if (r.whenKey.startsWith('OnButton:')) {
        const rawBtn = (r.whenKey.split(':')[1] ?? 'action') as VmButtonId;
        when = { type: 'OnButton', button: rawBtn, edge: 'pressed' };
      } else if (r.whenKey.startsWith('OnCollide:')) {
        const pair = r.whenKey.split(':')[1] ?? 'player+star';
        const [sourceTag, targetTag] = pair.split('+');
        when = { type: 'OnCollide', sourceTag: sourceTag ?? 'player', targetTag: targetTag ?? 'star' };
      } else {
        when = { type: 'OnStart' };
      }

      const ifOpt = IF_OPTIONS.find((c) => c.key === r.ifKey);
      const ifList = ifOpt?.cond ? [ifOpt.cond] : undefined;

      let action: VmAction;
      if (r.doType === 'PlaySfx') action = { type: 'PlaySfx', preset: r.sfxPreset };
      else if (r.doType === 'Juice') action = { type: 'Juice', preset: r.juicePreset };
      else if (r.doType === 'FloatText') {
        action = { type: 'FloatText', text: r.floatText.trim() || 'NICE!', color: '#ffd447', anchor: 'player', x: 0, y: -14 };
      } else if (r.doType === 'Impulse') action = { type: 'Impulse', target: 'player', vx: 0, vy: -220, setVelocity: false };
      else if (r.doType === 'SetVar') action = { type: 'SetVar', name: 'combo', op: '+=', value: 1 };
      else action = { type: 'EndGame', outcome: 'won' };

      return ifList ? { id: `maker-rule-${i}`, when, if: ifList, do: [action] } : { id: `maker-rule-${i}`, when, do: [action] };
    });
  }

  private showError(msg: string): void {
    this.errorBox.textContent = msg;
    this.errorBox.classList.remove('panel-hidden');
    this.host.playUiSound('hurt');
  }

  private hideError(): void {
    this.errorBox.classList.add('panel-hidden');
  }

  private buildCartridgeJson(targetId?: string): CartridgeJsonV1 {
    const id = targetId ?? this.editingCustomId ?? `custom-maker-${Date.now().toString(36)}`;
    const title = this.titleInput.value.trim() || '我的自製卡匣';
    const studioData = this.studioBridge?.getStudioSprites();
    const currentEpoch = studioData?.editEpoch ?? 0;
    if (this.importedSprites && currentEpoch !== this.importedSpritesEpoch) {
      this.importedSprites = undefined;
    }
    const resolvedSprites = this.importedSprites ?? studioData?.sprites;
    const useStudio = this.useStudioSprites && Boolean(resolvedSprites);

    const hasKey = (k: string) => Boolean(useStudio && resolvedSprites && resolvedSprites[k]);
    const heroSpriteA: SpriteId = hasKey('studio_hero_a')
      ? 'studio_hero_a'
      : this.grappleEnabled
        ? 'parkour_hero_idle'
        : this.playerSprite;
    const heroSpriteB: SpriteId = hasKey('studio_hero_b')
      ? 'studio_hero_b'
      : this.grappleEnabled
        ? 'parkour_hero_run_a'
        : this.playerSpriteB;
    const starSpriteA: SpriteId = hasKey('studio_item_a') ? 'studio_item_a' : 'star_a';
    const starSpriteB: SpriteId = hasKey('studio_item_b') ? 'studio_item_b' : 'star_b';
    const enemySpriteA: SpriteId = hasKey('studio_enemy_a') ? 'studio_enemy_a' : 'slime_a';
    const enemySpriteB: SpriteId = hasKey('studio_enemy_b') ? 'studio_enemy_b' : 'slime_b';
    const tileStoneSprite: SpriteId = hasKey('studio_tile') ? 'studio_tile' : 'stone';

    const archetypes: Record<string, CartridgeArchetypeDef> = {
      ...BASE_WORKSHOP_ARCHETYPES,
      ...this.preservedArchetypes,
      star: {
        ...BASE_WORKSHOP_ARCHETYPES.star,
        sprite: starSpriteA,
        spriteB: starSpriteB,
      },
      slime: {
        ...BASE_WORKSHOP_ARCHETYPES.slime,
        sprite: enemySpriteA,
        spriteB: enemySpriteB,
      },
    };

    const compiledStages: CartridgeStageDef[] = this.stages.map((st, sIdx) => {
      const tiles: number[] = [];
      const collision: number[] = [];
      const spawns: CartridgeStageSpawn[] = [];
      const fgTiles: CartridgeFgTileDef[] = [];

      for (let r = 0; r < st.rows; r++) {
        for (let c = 0; c < st.cols; c++) {
          const idx = r * st.cols + c;
          const val = st.terrainCells[idx] as BrushId;
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
            if (spawns.length < 480) {
              if (val === 5) spawns.push({ archetype: 'spring', x: px, y: py });
              else if (val === 6) {
                spawns.push({
                  archetype: 'slime',
                  x: px,
                  y: py,
                  minX: Math.max(0, px - 48),
                  maxX: Math.min(st.cols * TILE_SIZE - 16, px + 48),
                });
              } else if (val === 7) spawns.push({ archetype: 'star', x: px, y: py });
              else if (val === 8) spawns.push({ archetype: 'key', x: px, y: py });
              else if (val === 9) spawns.push({ archetype: 'gate', x: px, y: py });
              else if (val === 11) spawns.push({ archetype: 'grapple_ring', x: px, y: py });
              else if (val === 12) spawns.push({ archetype: 'crystal_reset', x: px, y: py });
              else if (val === 13) {
                spawns.push({
                  archetype: 'zip_block',
                  x: px,
                  y: py,
                  minX: px,
                  maxX: Math.min(st.cols * TILE_SIZE - 16, px + 64),
                });
              } else if (val === 14) spawns.push({ archetype: 'crumble_tile', x: px, y: py });
            }
          }

          if (st.fgCells[idx] !== 0 && fgTiles.length < 512) {
            fgTiles.push({
              sprite: 'tree_canopy',
              x: px,
              y: py - 8,
              w: 24,
              h: 24,
              alpha: 0.88,
            });
          }
        }
      }

      for (const sp of st.specialSpawns) {
        if (spawns.length < 508) {
          spawns.push({ ...sp.spawn, x: sp.c * TILE_SIZE, y: sp.r * TILE_SIZE });
        }
      }

      if (!spawns.some((s) => s.archetype === 'gate')) {
        spawns.push({
          archetype: 'gate',
          x: (st.cols - 3) * TILE_SIZE,
          y: Math.max(1, st.rows - 3) * TILE_SIZE,
        });
      }

      return {
        id: st.id || `custom-stage-${sIdx + 1}`,
        name: st.name || `${title} #${sIdx + 1}`,
        worldWidth: st.cols * TILE_SIZE,
        worldHeight: st.rows * TILE_SIZE,
        viewport: this.grappleEnabled ? 'hd' : undefined,
        skyTop: st.skyTop ?? '#76c7ff',
        skyBottom: st.skyBottom ?? '#fff3df',
        bgmTheme: st.bgmTheme,
        paletteRow: this.paletteRow,
        ambientDarkness: st.ambientDarkness,
        hint: st.hint || (this.grappleEnabled ? '滑鼠／右搖桿瞄準 · 左鍵/Y 擺盪 · 右鍵/R 牽引 · B 甩射跳躍' : '方向移動 · B 跳躍 · L 重試'),
        spawn: {
          x: st.spawn.c * TILE_SIZE,
          y: st.spawn.r * TILE_SIZE,
        },
        artMood: {
          baseHex: st.artMoodBase,
          accentHex: st.artMoodAccent,
          warmth: 0.3,
          contrast: 0.72,
          parallaxFog: 0.24,
        },
        springCamera: st.springCamera,
        bgParallaxLayers: st.bgParallaxLayers,
        fgTiles: fgTiles.length > 0 ? fgTiles : undefined,
        tileGrid: {
          cols: st.cols,
          rows: st.rows,
          tiles,
          collision,
          spriteMap: {
            '1': 'grass',
            '2': tileStoneSprite,
            '3': 'cloud_m',
            '4': 'trap',
            '5': 'dungeon_floor',
          },
        },
        spawns,
      };
    });

    const initialVars: Record<string, number> = { ...this.preservedInitialVars };
    if (this.controllerKind === 'fighter') {
      if (initialVars.p1Hp === undefined) initialVars.p1Hp = 100;
      if (initialVars.p1MaxHp === undefined) initialVars.p1MaxHp = initialVars.p1Hp;
      if (initialVars.p2Hp === undefined) initialVars.p2Hp = 100;
      if (initialVars.p2MaxHp === undefined) initialVars.p2MaxHp = initialVars.p2Hp;
    } else if (this.controllerKind === 'card') {
      if (initialVars.mana === undefined) initialVars.mana = 3;
      if (initialVars.maxMana === undefined) initialVars.maxMana = 3;
      if (initialVars.turn === undefined) initialVars.turn = 1;
      if (initialVars.hp === undefined) initialVars.hp = 20;
      if (initialVars.maxHp === undefined) initialVars.maxHp = initialVars.hp;
      if (initialVars.enemyHp === undefined) initialVars.enemyHp = 20;
      if (initialVars.maxEnemyHp === undefined) initialVars.maxEnemyHp = initialVars.enemyHp;
    } else if (this.controllerKind === 'topdown') {
      if (initialVars.switches === undefined) initialVars.switches = 0;
    }

    const cardDeck =
      this.preservedCardDeck && this.preservedCardDeck.length > 0
        ? (JSON.parse(JSON.stringify(this.preservedCardDeck)) as CartridgeCardDef[])
        : this.controllerKind === 'card'
          ? OFFICIAL_CARD_DECK.map((c) => ({ ...c }))
          : undefined;

    const firstSt = this.stages[0];
    return {
      version: 1,
      meta: {
        id,
        code: 'CUS',
        title,
        subtitle: `${this.stages.length} 關 × ${firstSt.cols}×${firstSt.rows} 工坊卡匣`,
        genre: 'platformer',
        genreHud: this.genreHud,
        viewport: this.grappleEnabled ? 'hd' : 'wide',
        paletteRow: this.paletteRow,
      },
      initialVars,
      sprites: useStudio ? resolvedSprites : undefined,
      cardDeck,
      player: {
        controller: this.controllerKind,
        sprite: heroSpriteA,
        spriteB: heroSpriteB,
        w: 16,
        h: 16,
        maxHearts: this.playerMaxHearts,
        grappleConfig: this.grappleEnabled
          ? { enabled: true, maxRange: 165, attachWalls: true, pullSpeed: 350 }
          : undefined,
      },
      archetypes,
      stages: compiledStages,
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
    this.host.syncCartridgeSpritesToAtlas(cart);
    const theme = PALETTE_THEMES[cart.meta.paletteRow ?? 0];
    const cover = renderCartridgeCoverCanvas(this.atlas, cart);
    const dataUrl = await exportCartridgeCardPngDataUrl(
      cover,
      {
        id: cart.meta.id,
        code: cart.meta.code,
        title: cart.meta.title,
        subtitle: cart.meta.subtitle ?? '',
        genre: '自製平台',
        accentHex: theme?.colors[4] ?? '#ff708d',
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

    this.controllerKind = cart.player.controller;
    this.controllerSelect.value =
      cart.player.controller === 'shmup' ? 'platformer' : cart.player.controller;
    this.genreHud = cart.meta.genreHud ?? 'platformer';
    this.genreHudSelect.value = this.genreHud;
    this.grappleEnabled = Boolean(cart.player.grappleConfig?.enabled);
    this.grappleCheck.checked = this.grappleEnabled;
    this.playerSprite = cart.player.sprite;
    this.playerSpriteB = cart.player.spriteB ?? cart.player.sprite;
    this.playerMaxHearts = cart.player.maxHearts;
    this.preservedCardDeck =
      cart.cardDeck && cart.cardDeck.length > 0
        ? (JSON.parse(JSON.stringify(cart.cardDeck)) as CartridgeCardDef[])
        : undefined;

    const hasStudioSprites =
      Boolean(cart.sprites && Object.keys(cart.sprites).length > 0) ||
      cart.player.sprite.startsWith('studio_');
    this.useStudioSprites = hasStudioSprites;
    this.studioSpriteCheck.checked = hasStudioSprites;
    this.importedSprites = cart.sprites
      ? (JSON.parse(JSON.stringify(cart.sprites)) as Record<string, string[]>)
      : undefined;
    this.importedSpritesEpoch = this.studioBridge?.getStudioSprites().editEpoch ?? 0;

    this.preservedInitialVars = cart.initialVars ? { ...cart.initialVars } : { combo: 0 };
    this.preservedArchetypes = JSON.parse(JSON.stringify(cart.archetypes)) as Record<string, CartridgeArchetypeDef>;

    const spawnBrushMap: Record<string, BrushId> = {
      spring: 5,
      slime: 6,
      star: 7,
      key: 8,
      gate: 9,
      grapple_ring: 11,
      crystal_reset: 12,
      zip_block: 13,
      crumble_tile: 14,
    };

    const nextStages: EditableStage[] = [];
    for (const st of cart.stages.slice(0, MAX_STAGES)) {
      const srcCols = st.tileGrid?.cols ?? Math.round(st.worldWidth / TILE_SIZE);
      const srcRows = st.tileGrid?.rows ?? Math.round((st.worldHeight ?? 192) / TILE_SIZE);
      const cols = snapCols(srcCols);
      const rows = snapRows(srcRows);
      const terrainCells = new Uint8Array(cols * rows);
      const fgCells = new Uint8Array(cols * rows);
      const specialSpawns: SpecialStageSpawn[] = [];
      const rowOffset = Math.max(0, srcRows - rows);

      if (st.tileGrid) {
        const sm = st.tileGrid.spriteMap;
        for (let r = 0; r < rows; r++) {
          const srcR = r + rowOffset;
          if (srcR < 0 || srcR >= st.tileGrid.rows) continue;
          for (let c = 0; c < st.tileGrid.cols && c < cols; c++) {
            const idx = srcR * st.tileGrid.cols + c;
            const tid = st.tileGrid.tiles[idx] ?? 0;
            const colKind = st.tileGrid.collision[idx] ?? 0;
            const spriteName = sm[String(tid)] ?? '';
            if (colKind === COLLISION_HAZARD || tid === 4 || spriteName === 'trap') {
              terrainCells[r * cols + c] = 4;
            } else if (colKind === COLLISION_CLOUD || tid === 3 || spriteName.startsWith('cloud')) {
              terrainCells[r * cols + c] = 3;
            } else if (colKind === COLLISION_EMPTY || tid === 0) {
              terrainCells[r * cols + c] = 0;
            } else if (tid === 1 || spriteName === 'grass') {
              terrainCells[r * cols + c] = 1;
            } else if (tid > 0) {
              terrainCells[r * cols + c] = 2;
            }
          }
        }
      }

      const fgList = st.fgTiles ?? [];
      for (const ft of fgList) {
        const c = Math.max(0, Math.min(cols - 1, Math.round(ft.x / TILE_SIZE)));
        const r = Math.max(0, Math.min(rows - 1, Math.round((ft.y + 8) / TILE_SIZE) - rowOffset));
        if (ft.sprite === 'tree_canopy' || fgList.length <= 64) {
          fgCells[r * cols + c] = 15;
        }
      }

      for (const sp of st.spawns ?? []) {
        const c = Math.max(0, Math.min(cols - 1, Math.round(sp.x / TILE_SIZE)));
        const r = Math.max(0, Math.min(rows - 1, Math.round(sp.y / TILE_SIZE) - rowOffset));
        const mapped = spawnBrushMap[sp.archetype];
        if (mapped !== undefined) {
          terrainCells[r * cols + c] = mapped;
        } else {
          const arch = cart.archetypes[sp.archetype];
          specialSpawns.push({
            c,
            r,
            spawn: { ...sp },
            previewSprite: arch?.sprite ?? 'star_a',
          });
        }
      }

      const sc = Math.max(0, Math.min(cols - 1, Math.round(st.spawn.x / TILE_SIZE)));
      const sr = Math.max(0, Math.min(rows - 1, Math.round(st.spawn.y / TILE_SIZE) - rowOffset));

      nextStages.push({
        id: st.id,
        name: st.name,
        hint: st.hint,
        cols,
        rows,
        bgmTheme: st.bgmTheme,
        artMoodBase: st.artMood?.baseHex ?? '#1b2648',
        artMoodAccent: st.artMood?.accentHex ?? '#ff5d8f',
        skyTop: st.skyTop,
        skyBottom: st.skyBottom,
        ambientDarkness: st.ambientDarkness,
        springCamera: st.springCamera,
        bgParallaxLayers: st.bgParallaxLayers,
        spawn: { c: sc, r: sr },
        terrainCells,
        fgCells,
        specialSpawns,
      });
    }

    this.stages = nextStages.length > 0 ? nextStages : [this.createStarterStage(0)];
    this.selectStage(0);

    if (cart.rules && cart.rules.length > 0) {
      this.preservedFullRules = JSON.parse(JSON.stringify(cart.rules)) as VmRule[];
      this.rulesDirty = false;
      const mapped: RuleDraft[] = [];
      for (const r of cart.rules.slice(0, 12)) {
        let whenKey = 'OnStart';
        if (r.when.type === 'OnEvery') whenKey = `OnEvery:${r.when.intervalTicks}`;
        else if (r.when.type === 'OnSignal') whenKey = `OnSignal:${r.when.signal}`;
        else if (r.when.type === 'OnVar') whenKey = `OnVar:${r.when.varName}${r.when.op}${r.when.value}`;
        else if (r.when.type === 'OnButton') whenKey = `OnButton:${r.when.button}`;
        else if (r.when.type === 'OnCollide') whenKey = `OnCollide:${r.when.sourceTag}+${r.when.targetTag}`;

        let ifKey: IfCondKey = '';
        const cond = r.if?.[0];
        if (cond) {
          const match = IF_OPTIONS.find(
            (opt) =>
              opt.cond &&
              opt.cond.varName === cond.varName &&
              opt.cond.op === cond.op &&
              opt.cond.value === cond.value,
          );
          if (match) ifKey = match.key;
        }

        const act = r.do[0];
        if (!act) continue;
        let doType: RuleDraft['doType'] = 'PlaySfx';
        let sfxPreset: SimEvent = 'star';
        let juicePreset: FeedbackPreset = 'relic_burst';
        let floatText = 'NICE!';
        if (act.type === 'PlaySfx') {
          doType = 'PlaySfx';
          sfxPreset = act.preset as SimEvent;
        } else if (act.type === 'Juice') {
          doType = 'Juice';
          juicePreset = (act.preset ?? 'relic_burst') as FeedbackPreset;
        } else if (act.type === 'FloatText') {
          doType = 'FloatText';
          floatText = act.text;
        } else if (act.type === 'Impulse') doType = 'Impulse';
        else if (act.type === 'SetVar') doType = 'SetVar';
        else if (act.type === 'EndGame') doType = 'EndGame';
        mapped.push({ whenKey, ifKey, doType, sfxPreset, juicePreset, floatText });
      }
      if (mapped.length > 0) {
        this.customRules = mapped;
        this.renderRules();
      }
    } else {
      this.preservedFullRules = undefined;
      this.rulesDirty = true;
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
