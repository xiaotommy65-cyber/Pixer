import {
  addEventGraphNode,
  autoLayoutEventGraph,
  compileEventGraphToScript,
  compileScriptToEventGraph,
  connectEventGraphNodes,
  describeEventGraphNode,
  disconnectEventGraphEdge,
  moveEventGraphNode,
  removeEventGraphNode,
  type EcsEventGraphIR,
  type EcsEventGraphNode,
  type EcsEventGraphNodeKind,
} from '../core/ecs/EcsEventGraph.ts';
import type {
  EcsCompareOp,
  EcsProjectV2,
  EcsScriptCond,
  EcsScriptDef,
  EcsScriptOp,
  EcsScriptTrigger,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type { SandboxScriptVm } from '../core/ecs/SandboxScriptVm.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 220;
const NODE_PORT_Y = 26;

const TRIGGER_OPTIONS: { value: EcsScriptTrigger['on']; label: string }[] = [
  { value: 'event', label: '監聽事件 (event)' },
  { value: 'timer', label: '定時週期 (timer)' },
  { value: 'input', label: '按鍵輸入 (input)' },
  { value: 'collide', label: '物理碰撞 (collide)' },
  { value: 'start', label: '實體誕生 (start)' },
  { value: 'tick', label: '每幀更新 (tick)' },
  { value: 'path_end', label: '路徑終點 (path_end)' },
];

const INPUT_BUTTON_OPTIONS: { value: 'action' | 'jump' | 'menu' | 'skill'; label: string }[] = [
  { value: 'action', label: 'A / 動作鍵' },
  { value: 'jump', label: 'B / 跳躍鍵' },
  { value: 'skill', label: 'X / 技能衝刺' },
  { value: 'menu', label: '選單鍵' },
];

const COMPARE_OPTIONS: { value: EcsCompareOp; label: string }[] = [
  { value: 'gte', label: '>=' },
  { value: 'gt', label: '>' },
  { value: 'eq', label: '==' },
  { value: 'neq', label: '!=' },
  { value: 'lte', label: '<=' },
  { value: 'lt', label: '<' },
];

const ACTION_OPTIONS: { value: EcsScriptOp['op']; label: string }[] = [
  { value: 'add_score', label: '增加分數 (add_score)' },
  { value: 'add_global', label: '增減全域 (add_global)' },
  { value: 'set_global', label: '設定全域 (set_global)' },
  { value: 'play_sfx', label: '播放音效 (play_sfx)' },
  { value: 'emit_event', label: '廣播事件 (emit_event)' },
  { value: 'set_status', label: '宣告勝負 (set_status)' },
  { value: 'spawn_prefab', label: '生成模板 (spawn_prefab)' },
  { value: 'find_nearest', label: '搜尋目標 (find_nearest)' },
  { value: 'fire_at_target', label: '發射彈體 (fire_at_target)' },
  { value: 'damage_global', label: '扣減生命 (damage_global)' },
  { value: 'destroy_self', label: '銷毀自身 (destroy_self)' },
  { value: 'set_vel', label: '設定速度 (set_vel)' },
  { value: 'set_var', label: '設定槽位 (set_var)' },
  { value: 'add_var', label: '增減槽位 (add_var)' },
  { value: 'judge_lane_hit', label: '節拍判定 (judge_lane_hit)' },
];

const SFX_OPTIONS: { value: 'star' | 'hit' | 'jump' | 'snap' | 'win' | 'lose'; label: string }[] = [
  { value: 'star', label: 'star (星光)' },
  { value: 'snap', label: 'snap (清脆)' },
  { value: 'jump', label: 'jump (跳躍)' },
  { value: 'hit', label: 'hit (打擊)' },
  { value: 'win', label: 'win (通關)' },
  { value: 'lose', label: 'lose (失敗)' },
];

interface LiveNodeBinding {
  el: HTMLElement;
  badgeEl: HTMLElement;
  ruleIndex: number;
  lastHot: boolean;
  lastCount: number;
}

interface LiveEdgeBinding {
  pathEl: SVGPathElement;
  ruleIndex: number;
  lastHot: boolean;
}

function createDefaultTrigger(on: EcsScriptTrigger['on']): EcsScriptTrigger {
  switch (on) {
    case 'start':
      return { on: 'start' };
    case 'tick':
      return { on: 'tick' };
    case 'path_end':
      return { on: 'path_end' };
    case 'timer':
      return { on: 'timer', intervalSec: 0.5 };
    case 'input':
      return { on: 'input', button: 'action' };
    case 'collide':
      return { on: 'collide', withTag: 'hero' };
    case 'event':
      return { on: 'event', name: 'collect_shard' };
  }
}

function createDefaultAction(op: EcsScriptOp['op']): EcsScriptOp {
  switch (op) {
    case 'add_score':
      return { op: 'add_score', delta: 50 };
    case 'add_global':
      return { op: 'add_global', key: 'energy', delta: 1 };
    case 'set_global':
      return { op: 'set_global', key: 'energy', value: 10 };
    case 'play_sfx':
      return { op: 'play_sfx', sfx: 'star' };
    case 'emit_event':
      return { op: 'emit_event', name: 'custom_pulse' };
    case 'set_status':
      return { op: 'set_status', status: 'won' };
    case 'spawn_prefab':
      return { op: 'spawn_prefab', prefab: 'star_bolt', offsetX: 0, offsetY: 0 };
    case 'find_nearest':
      return { op: 'find_nearest', tag: 'enemy', range: 240 };
    case 'fire_at_target':
      return { op: 'fire_at_target', prefab: 'star_bolt', speed: 240, cooldownSec: 0.65 };
    case 'damage_global':
      return { op: 'damage_global', key: 'coreHp', delta: 1 };
    case 'destroy_self':
      return { op: 'destroy_self' };
    case 'set_vel':
      return { op: 'set_vel', vx: 60, vy: 0 };
    case 'set_var':
      return { op: 'set_var', slot: 0, value: 1 };
    case 'add_var':
      return { op: 'add_var', slot: 0, delta: 1 };
    case 'judge_lane_hit':
      return { op: 'judge_lane_hit', lane: 0, energyGlobal: 'energy', comboGlobal: 'combo' };
  }
}

export interface EventGraphEditorCallbacks {
  onSelectScript?: (scriptId: string) => void;
}

/**
 * Pixer 9.0 Batch 9.5 Zero-Dependency Visual Script Event Graph Editor.
 * Compiles bidirectionally between `EcsEventGraphIR` and `EcsScriptDef` (zero eval / zero new Function)
 * and renders live Zero-GC VM execution trace highlights over Bezier SVG wires and draggable cards.
 */
export class EventGraphEditorView {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private renderAc = new AbortController();
  private readonly session: EcsStudioSession;
  private readonly callbacks: EventGraphEditorCallbacks;

  private readonly scriptSelectEl: HTMLSelectElement;
  private readonly zoomLabelEl: HTMLSpanElement;
  private readonly liveStatsEl: HTMLSpanElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly stageEl: HTMLDivElement;
  private readonly viewportEl: HTMLDivElement;
  private readonly svgEl: SVGSVGElement;
  private readonly nodesLayerEl: HTMLDivElement;

  private activeScriptId: string | null = null;
  private graph: EcsEventGraphIR | null = null;
  private wiringFromNodeId: string | null = null;
  private selectedNodeId: string | null = null;
  private panX = 16;
  private panY = 16;
  private zoom = 1;
  private spacePanHeld = false;
  private isCommitting = false;
  private statusNotice = '';

  private dragState:
    | { kind: 'node'; nodeId: string; startClientX: number; startClientY: number; origX: number; origY: number; moved: boolean }
    | { kind: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number }
    | null = null;

  private readonly liveNodeBindings: LiveNodeBinding[] = [];
  private readonly liveEdgeBindings: LiveEdgeBinding[] = [];

  constructor(session: EcsStudioSession, callbacks: EventGraphEditorCallbacks = {}) {
    this.session = session;
    this.callbacks = callbacks;
    const { signal } = this.ac;

    this.element = document.createElement('div');
    this.element.className = 'p7-eg-root';
    this.element.setAttribute('aria-label', '視覺化腳本事件圖編輯器');

    // ---- Top Toolbar ----
    const bar = document.createElement('div');
    bar.className = 'p7-eg-toolbar';

    const leftGrp = document.createElement('div');
    leftGrp.className = 'p7-toolbar-group';

    this.scriptSelectEl = document.createElement('select');
    this.scriptSelectEl.className = 'p7-select p7-mono';
    this.scriptSelectEl.setAttribute('aria-label', '選擇事件圖腳本');
    this.scriptSelectEl.addEventListener(
      'change',
      () => {
        this.activeScriptId = this.scriptSelectEl.value || null;
        this.wiringFromNodeId = null;
        this.selectedNodeId = null;
        this.statusNotice = '';
        this.loadActiveScriptFromProject(this.session.getProject());
        if (this.activeScriptId) this.callbacks.onSelectScript?.(this.activeScriptId);
      },
      { signal },
    );

    const newScriptBtn = document.createElement('button');
    newScriptBtn.type = 'button';
    newScriptBtn.className = 'p7-btn p7-btn-xs';
    newScriptBtn.textContent = '+ 新腳本';
    newScriptBtn.addEventListener('click', () => this.createNewScript(), { signal });

    const addTrigBtn = document.createElement('button');
    addTrigBtn.type = 'button';
    addTrigBtn.className = 'p7-btn p7-btn-xs p7-eg-btn-trig';
    addTrigBtn.textContent = '+ 觸發器';
    addTrigBtn.addEventListener('click', () => this.addDraftNode('trigger'), { signal });

    const addCondBtn = document.createElement('button');
    addCondBtn.type = 'button';
    addCondBtn.className = 'p7-btn p7-btn-xs p7-eg-btn-cond';
    addCondBtn.textContent = '+ 條件';
    addCondBtn.addEventListener('click', () => this.addDraftNode('condition'), { signal });

    const addActBtn = document.createElement('button');
    addActBtn.type = 'button';
    addActBtn.className = 'p7-btn p7-btn-xs p7-eg-btn-act';
    addActBtn.textContent = '+ 動作';
    addActBtn.addEventListener('click', () => this.addDraftNode('action'), { signal });

    leftGrp.append(this.scriptSelectEl, newScriptBtn, addTrigBtn, addCondBtn, addActBtn);

    const rightGrp = document.createElement('div');
    rightGrp.className = 'p7-toolbar-group';

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'p7-btn p7-btn-xs';
    autoBtn.textContent = '自動排布';
    autoBtn.addEventListener('click', () => this.handleAutoLayout(), { signal });

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'p7-btn p7-btn-xs';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.setAttribute('aria-label', '縮小事件圖');
    zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoom - 0.1), { signal });

    this.zoomLabelEl = document.createElement('span');
    this.zoomLabelEl.className = 'p7-eg-zoom p7-mono';
    this.zoomLabelEl.textContent = '100%';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'p7-btn p7-btn-xs';
    zoomInBtn.textContent = '+';
    zoomInBtn.setAttribute('aria-label', '放大事件圖');
    zoomInBtn.addEventListener('click', () => this.setZoom(this.zoom + 0.1), { signal });

    this.liveStatsEl = document.createElement('span');
    this.liveStatsEl.className = 'p7-eg-live-stat p7-mono';
    this.liveStatsEl.textContent = 'VM 即時追蹤就緒';

    rightGrp.append(autoBtn, zoomOutBtn, this.zoomLabelEl, zoomInBtn, this.liveStatsEl);
    bar.append(leftGrp, rightGrp);

    // ---- Helper / Warning Banner ----
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'p7-eg-banner';
    this.bannerEl.textContent = '拖曳節點標題移動；點擊右側輸出埠「●」再點目標左側輸入埠「○」完成連線；點擊連線可斷開。';

    // ---- Interactive Graph Stage ----
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'p7-eg-stage';

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'p7-eg-viewport';

    this.svgEl = document.createElementNS(SVG_NS, 'svg');
    this.svgEl.setAttribute('class', 'p7-eg-svg');
    this.svgEl.setAttribute('width', '2400');
    this.svgEl.setAttribute('height', '1400');

    this.nodesLayerEl = document.createElement('div');
    this.nodesLayerEl.className = 'p7-eg-nodes';

    this.viewportEl.append(this.svgEl, this.nodesLayerEl);
    this.stageEl.appendChild(this.viewportEl);

    this.element.append(bar, this.bannerEl, this.stageEl);

    // Stage pan (Middle/Right/Space+Left/background Left), wheel zoom, dblclick reset & keyboard
    const isBgTarget = (t: EventTarget | null): boolean =>
      t === this.stageEl || t === this.viewportEl || t === this.svgEl;
    const isEditableTarget = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

    this.stageEl.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    this.stageEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false, signal });
    this.stageEl.addEventListener('dblclick', (e) => {
      if (isBgTarget(e.target)) this.resetViewport();
    }, { signal });
    this.stageEl.addEventListener('pointerdown', (e) => {
      const explicitPan = e.button === 1 || e.button === 2 || (e.button === 0 && this.spacePanHeld);
      if (!explicitPan && !isBgTarget(e.target)) return;
      if (explicitPan) e.preventDefault();
      if (!explicitPan && this.wiringFromNodeId) {
        this.wiringFromNodeId = null;
        this.statusNotice = '已取消連線模式。';
        this.renderGraph();
        return;
      }
      if (!explicitPan && e.button !== 0) return;
      this.dragState = { kind: 'pan', startClientX: e.clientX, startClientY: e.clientY, origPanX: this.panX, origPanY: this.panY };
    }, { signal });

    window.addEventListener('keydown', (e) => {
      if (!this.element.isConnected || this.element.closest('[hidden]') || isEditableTarget(e.target)) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this.spacePanHeld = true;
      } else if ((e.code === 'Home' || e.code === 'Digit0' || e.code === 'Numpad0') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.resetViewport();
      }
    }, { signal });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.key === ' ') this.spacePanHeld = false; }, { signal });
    window.addEventListener('blur', () => { this.spacePanHeld = false; this.dragState = null; }, { signal });

    window.addEventListener('pointermove', (e) => {
      if (!this.dragState) return;
      if (this.dragState.kind === 'pan') {
        this.panX = Math.round(this.dragState.origPanX + (e.clientX - this.dragState.startClientX));
        this.panY = Math.round(this.dragState.origPanY + (e.clientY - this.dragState.startClientY));
        this.applyViewportTransform();
        return;
      }
      if (this.dragState.kind === 'node' && this.graph) {
        const dx = (e.clientX - this.dragState.startClientX) / this.zoom;
        const dy = (e.clientY - this.dragState.startClientY) / this.zoom;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.dragState.moved = true;
        this.graph = moveEventGraphNode(this.graph, this.dragState.nodeId, this.dragState.origX + dx, this.dragState.origY + dy);
        this.updateDraggedNodeDom(this.dragState.nodeId);
      }
    }, { signal });

    window.addEventListener('pointerup', () => {
      if (!this.dragState) return;
      const finished = this.dragState;
      this.dragState = null;
      if (finished.kind === 'node' && finished.moved && this.graph) this.commitGraph('移動事件圖節點');
    }, { signal });

    this.applyViewportTransform();
    this.syncProject(session.getProject());
  }

  public syncProject(project: EcsProjectV2, focusScriptId?: string): void {
    const scriptIds = Object.keys(project.scripts);
    this.scriptSelectEl.textContent = '';

    for (const sid of scriptIds) {
      const def = project.scripts[sid];
      const opt = document.createElement('option');
      opt.value = sid;
      opt.textContent = `${def.name} (${sid})`;
      this.scriptSelectEl.appendChild(opt);
    }

    if (focusScriptId && project.scripts[focusScriptId]) {
      this.activeScriptId = focusScriptId;
      this.panX = 16;
      this.panY = 16;
      this.applyViewportTransform();
    } else if (!this.activeScriptId || !project.scripts[this.activeScriptId]) {
      // Prefer a periodic or primary script so live trace is immediately engaging
      this.activeScriptId = project.scripts.rift_pulse_beacon
        ? 'rift_pulse_beacon'
        : scriptIds[0] ?? null;
    }

    if (this.activeScriptId) {
      this.scriptSelectEl.value = this.activeScriptId;
    }

    if (!this.isCommitting) {
      this.loadActiveScriptFromProject(project);
    }
  }

  public getActiveScriptId(): string | null {
    return this.activeScriptId;
  }

  private loadActiveScriptFromProject(project: EcsProjectV2): void {
    if (!this.activeScriptId || !project.scripts[this.activeScriptId]) {
      this.graph = null;
      this.renderGraph();
      return;
    }
    const def = project.scripts[this.activeScriptId];
    const savedLayout = project.graphLayouts?.[this.activeScriptId];
    this.graph = compileScriptToEventGraph(def, savedLayout);
    this.renderGraph();
  }

  private setZoom(next: number): void {
    this.zoom = Math.max(0.5, Math.min(1.8, Math.round(next * 100) / 100));
    this.zoomLabelEl.textContent = `${Math.round(this.zoom * 100)}%`;
    this.applyViewportTransform();
  }

  private resetViewport(): void {
    this.panX = 0;
    this.panY = 0;
    this.setZoom(1);
  }

  private applyViewportTransform(): void {
    this.viewportEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  private createNewScript(): void {
    const proj = this.session.getProject();
    let idx = Object.keys(proj.scripts).length + 1;
    let sid = `event_graph_${idx}`;
    while (proj.scripts[sid]) {
      idx++;
      sid = `event_graph_${idx}`;
    }
    const newScript: EcsScriptDef = {
      id: sid,
      name: `自訂事件圖 #${idx}`,
      description: '由視覺化事件圖編輯器建立的沙盒規則。',
      rules: [
        {
          trigger: { on: 'timer', intervalSec: 1.0 },
          ops: [{ op: 'add_score', delta: 25 }],
        },
      ],
    };
    const graph = compileScriptToEventGraph(newScript);
    const compiled = compileEventGraphToScript(graph);
    this.activeScriptId = sid;
    this.session.dispatch({
      type: 'upsert_script',
      script: compiled.script,
      graphLayout: compiled.layout,
    });
    // Attach to first entity so newly created script runs immediately in simulation
    const firstEnt = this.session.getProject().entities[0];
    if (firstEnt) {
      const existing = firstEnt.components.scripts ?? [];
      if (!existing.includes(sid)) {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: firstEnt.id,
          patch: { scripts: [...existing, sid] },
        });
      }
    }
    this.statusNotice = `已建立並掛載新事件圖「${newScript.name}」。`;
    this.syncProject(this.session.getProject(), sid);
  }

  private addDraftNode(kind: EcsEventGraphNodeKind): void {
    if (!this.graph) {
      this.createNewScript();
      if (!this.graph) return;
    }
    const res = addEventGraphNode(this.graph, kind);
    this.graph = res.graph;
    this.selectedNodeId = res.createdNodeId;
    if (kind === 'trigger') {
      this.statusNotice = '已新增觸發器節點；可點擊右側輸出埠「●」連線至條件或動作。';
      this.commitGraph('新增觸發器節點');
    } else {
      this.statusNotice = `已新增${kind === 'condition' ? '條件' : '動作'}節點（待連線）；點擊觸發器輸出埠「●」再點此節點輸入埠「○」即可即時編譯生效。`;
      this.renderGraph();
    }
  }

  private handleAutoLayout(): void {
    if (!this.graph) return;
    this.graph = autoLayoutEventGraph(this.graph);
    this.panX = 16;
    this.panY = 16;
    this.applyViewportTransform();
    this.commitGraph('自動排布事件圖');
  }

  private commitGraph(noticePrefix?: string): void {
    if (!this.graph) return;
    const compiled = compileEventGraphToScript(this.graph);
    this.isCommitting = true;
    try {
      const res = this.session.dispatch({
        type: 'upsert_script',
        script: compiled.script,
        graphLayout: compiled.layout,
      });
      if (!res.ok) {
        this.statusNotice = `編譯提交失敗：${res.errors?.[0] ?? '未知錯誤'}`;
      } else if (compiled.warnings.length > 0) {
        this.statusNotice = `${noticePrefix ? `${noticePrefix} · ` : ''}${compiled.warnings[0]}`;
      } else if (noticePrefix) {
        this.statusNotice = `${noticePrefix} · 已即時編譯至沙盒 VM（${compiled.script.rules.length} 條規則）`;
      }
    } finally {
      this.isCommitting = false;
    }

    // Reload canonical graph while preserving any still-unconnected draft nodes so user can keep wiring them
    const proj = this.session.getProject();
    if (this.activeScriptId && proj.scripts[this.activeScriptId]) {
      const canonical = compileScriptToEventGraph(
        proj.scripts[this.activeScriptId],
        proj.graphLayouts?.[this.activeScriptId],
      );
      const reachedIds = new Set<string>();
      const outMap = new Map<string, string[]>();
      for (const e of this.graph.edges) {
        const list = outMap.get(e.fromNodeId);
        if (list) list.push(e.toNodeId);
        else outMap.set(e.fromNodeId, [e.toNodeId]);
      }
      const stack = this.graph.nodes.filter((n) => n.kind === 'trigger').map((n) => n.id);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (reachedIds.has(cur)) continue;
        reachedIds.add(cur);
        const nexts = outMap.get(cur) ?? [];
        for (const nxt of nexts) stack.push(nxt);
      }
      const unattached = this.graph.nodes.filter((n) => !reachedIds.has(n.id));
      if (unattached.length > 0) {
        canonical.nodes.push(...unattached);
      }
      this.graph = canonical;
    }
    this.renderGraph();
  }

  private renderGraph(): void {
    this.renderAc.abort();
    this.renderAc = new AbortController();
    const { signal } = this.renderAc;

    this.liveNodeBindings.length = 0;
    this.liveEdgeBindings.length = 0;
    this.nodesLayerEl.textContent = '';
    this.svgEl.textContent = '';

    if (!this.graph) {
      this.bannerEl.textContent = '此專案尚無沙盒腳本，點擊「+ 新腳本」立即建立事件圖。';
      return;
    }

    if (this.wiringFromNodeId) {
      const src = this.graph.nodes.find((n) => n.id === this.wiringFromNodeId);
      const srcLabel = src ? describeEventGraphNode(src).title : this.wiringFromNodeId;
      this.bannerEl.textContent = `連線中：從「${srcLabel}」出發 → 請點擊目標節點左側的輸入埠「○」（點擊空白畫布可取消）`;
      this.bannerEl.classList.add('is-wiring');
    } else {
      this.bannerEl.classList.remove('is-wiring');
      this.bannerEl.textContent =
        this.statusNotice ||
        `編輯中：${this.graph.scriptName} · ${this.graph.nodes.length} 節點 / ${this.graph.edges.length} 連線 · 拖曳標題移動，點擊埠「●」→「○」連線`;
    }

    // Render SVG Bezier wires
    this.renderSvgWires(signal);

    // Render interactive Node Cards
    for (const node of this.graph.nodes) {
      const card = this.buildNodeCard(node, signal);
      this.nodesLayerEl.appendChild(card);
    }
  }

  private renderSvgWires(signal: AbortSignal): void {
    if (!this.graph) return;
    this.svgEl.textContent = '';
    this.liveEdgeBindings.length = 0;

    const nodeMap = new Map<string, EcsEventGraphNode>();
    for (const n of this.graph.nodes) nodeMap.set(n.id, n);

    for (const edge of this.graph.edges) {
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (!from || !to) continue;

      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + NODE_PORT_Y;
      const x2 = to.x;
      const y2 = to.y + NODE_PORT_Y;
      const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'p7-eg-wire');
      path.setAttribute('data-edge-id', edge.id);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `斷開連線 ${edge.fromNodeId} 至 ${edge.toNodeId}`);

      path.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          if (!this.graph) return;
          this.graph = disconnectEventGraphEdge(this.graph, edge.id);
          this.commitGraph('斷開節點連線');
        },
        { signal },
      );

      this.svgEl.appendChild(path);
      if (from.ruleIndex !== undefined) {
        this.liveEdgeBindings.push({
          pathEl: path,
          ruleIndex: from.ruleIndex,
          lastHot: false,
        });
      }
    }
  }

  private updateDraggedNodeDom(nodeId: string): void {
    if (!this.graph) return;
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const card = this.nodesLayerEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (card) {
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
    }
    this.renderSvgWires(this.renderAc.signal);
  }

  private buildNodeCard(node: EcsEventGraphNode, signal: AbortSignal): HTMLElement {
    const info = describeEventGraphNode(node);
    const card = document.createElement('div');
    card.className = `p7-eg-node is-${node.kind}`;
    card.dataset.nodeId = node.id;
    if (this.selectedNodeId === node.id) card.classList.add('is-selected');
    if (this.wiringFromNodeId === node.id) card.classList.add('is-wiring-source');
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;

    // ---- Card Header (Draggable) ----
    const head = document.createElement('div');
    head.className = 'p7-eg-node-head';

    // Input Port (left, for condition & action)
    if (node.kind !== 'trigger') {
      const inPort = document.createElement('button');
      inPort.type = 'button';
      inPort.className = 'p7-eg-port p7-eg-port-in';
      inPort.textContent = '○';
      inPort.setAttribute('aria-label', `連線至 ${info.badge} ${node.id}`);
      inPort.title = '輸入埠：點擊以接收上游連線';
      if (this.wiringFromNodeId && this.wiringFromNodeId !== node.id) {
        inPort.classList.add('is-target-ready');
      }
      inPort.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          if (!this.wiringFromNodeId || !this.graph) return;
          const res = connectEventGraphNodes(this.graph, this.wiringFromNodeId, node.id);
          if (!res.ok) {
            this.statusNotice = `連線失敗：${res.error ?? '無效連線'}`;
            this.wiringFromNodeId = null;
            this.renderGraph();
            return;
          }
          this.graph = res.graph;
          this.wiringFromNodeId = null;
          this.commitGraph('建立事件圖連線');
        },
        { signal },
      );
      head.appendChild(inPort);
    }

    const titleWrap = document.createElement('div');
    titleWrap.className = 'p7-eg-node-title-wrap';
    const badge = document.createElement('span');
    badge.className = 'p7-eg-kind-tag';
    badge.textContent = info.badge;
    const title = document.createElement('span');
    title.className = 'p7-eg-node-title';
    title.textContent = info.title;
    titleWrap.append(badge, title);

    const traceBadge = document.createElement('span');
    traceBadge.className = 'p7-eg-trace-badge p7-mono';
    traceBadge.textContent = node.ruleIndex !== undefined ? '×0' : '待連';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'p7-eg-del-btn';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `刪除節點 ${node.id}`);
    delBtn.addEventListener(
      'click',
      (ev) => {
        ev.stopPropagation();
        if (!this.graph) return;
        this.graph = removeEventGraphNode(this.graph, node.id);
        if (this.wiringFromNodeId === node.id) this.wiringFromNodeId = null;
        this.commitGraph('刪除事件圖節點');
      },
      { signal },
    );

    // Output Port (right)
    const outPort = document.createElement('button');
    outPort.type = 'button';
    outPort.className = 'p7-eg-port p7-eg-port-out';
    outPort.textContent = '●';
    outPort.setAttribute('aria-label', `從 ${info.badge} ${node.id} 拉出連線`);
    outPort.title = '輸出埠：點擊開始連線至下一個節點';
    if (this.wiringFromNodeId === node.id) outPort.classList.add('is-active');
    outPort.addEventListener(
      'click',
      (ev) => {
        ev.stopPropagation();
        this.wiringFromNodeId = this.wiringFromNodeId === node.id ? null : node.id;
        this.renderGraph();
      },
      { signal },
    );

    head.append(titleWrap, traceBadge, delBtn, outPort);

    head.addEventListener(
      'pointerdown',
      (ev) => {
        const target = ev.target as HTMLElement;
        if (ev.button !== 0 || this.spacePanHeld || target.closest('button')) return;
        ev.stopPropagation();
        this.selectedNodeId = node.id;
        this.dragState = {
          kind: 'node',
          nodeId: node.id,
          startClientX: ev.clientX,
          startClientY: ev.clientY,
          origX: node.x,
          origY: node.y,
          moved: false,
        };
      },
      { signal },
    );

    // ---- Card Body (Inline Parameter Editors) ----
    const body = document.createElement('div');
    body.className = 'p7-eg-node-body';
    this.populateNodeBody(node, body, signal);

    card.append(head, body);

    if (node.ruleIndex !== undefined) {
      this.liveNodeBindings.push({
        el: card,
        badgeEl: traceBadge,
        ruleIndex: node.ruleIndex,
        lastHot: false,
        lastCount: -1,
      });
    }

    return card;
  }

  private mutateNodeAndCommit(nodeId: string, updater: (n: EcsEventGraphNode) => EcsEventGraphNode, summary: string): void {
    if (!this.graph) return;
    this.graph = {
      ...this.graph,
      nodes: this.graph.nodes.map((n) => (n.id === nodeId ? updater(n) : n)),
    };
    this.commitGraph(summary);
  }

  private populateNodeBody(node: EcsEventGraphNode, body: HTMLElement, signal: AbortSignal): void {
    if (node.kind === 'trigger' && node.trigger) {
      const trig = node.trigger;
      const typeSel = document.createElement('select');
      typeSel.className = 'p7-select p7-eg-ctrl';
      typeSel.setAttribute('aria-label', `觸發類型 ${node.id}`);
      for (const opt of TRIGGER_OPTIONS) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        typeSel.appendChild(o);
      }
      typeSel.value = trig.on;
      typeSel.addEventListener(
        'change',
        () => {
          const next = createDefaultTrigger(typeSel.value as EcsScriptTrigger['on']);
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, trigger: next }), '更新觸發類型');
        },
        { signal },
      );
      body.appendChild(typeSel);

      if (trig.on === 'event') {
        const inp = this.makeInlineInput(`事件名稱 ${node.id}`, trig.name, 'text', (v) => {
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, trigger: { on: 'event', name: v || 'custom_event' } }), '更新事件名');
        }, signal);
        body.appendChild(this.wrapInlineField('事件名', inp));
      } else if (trig.on === 'timer') {
        const inp = this.makeInlineInput(`定時間隔 ${node.id}`, String(trig.intervalSec), 'number', (v) => {
          const sec = Math.max(0.05, Number(v) || 0.5);
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, trigger: { on: 'timer', intervalSec: sec } }), '更新定時間隔');
        }, signal, '0.05');
        body.appendChild(this.wrapInlineField('間隔(秒)', inp));
      } else if (trig.on === 'input') {
        const btnSel = document.createElement('select');
        btnSel.className = 'p7-select p7-eg-ctrl';
        btnSel.setAttribute('aria-label', `觸發按鍵 ${node.id}`);
        for (const opt of INPUT_BUTTON_OPTIONS) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          btnSel.appendChild(o);
        }
        btnSel.value = trig.button;
        btnSel.addEventListener(
          'change',
          () => {
            const b = btnSel.value as 'action' | 'jump' | 'menu' | 'skill';
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, trigger: { on: 'input', button: b } }), '更新觸發按鍵');
          },
          { signal },
        );
        body.appendChild(this.wrapInlineField('按鍵', btnSel));
      } else if (trig.on === 'collide') {
        const inp = this.makeInlineInput(`碰撞標籤 ${node.id}`, trig.withTag ?? '', 'text', (v) => {
          this.mutateNodeAndCommit(
            node.id,
            (n) => ({ ...n, trigger: { on: 'collide', withTag: v.trim() || undefined } }),
            '更新碰撞標籤',
          );
        }, signal);
        body.appendChild(this.wrapInlineField('對象標籤', inp));
      }
      return;
    }

    if (node.kind === 'condition' && node.cond) {
      const cond = node.cond;
      const kindSel = document.createElement('select');
      kindSel.className = 'p7-select p7-eg-ctrl';
      kindSel.setAttribute('aria-label', `條件來源 ${node.id}`);
      for (const opt of [
        { v: 'global', l: '全域數值 (global)' },
        { v: 'var', l: '實體槽位 (var)' },
        { v: 'hp', l: '自身血量 (hp)' },
      ]) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.l;
        kindSel.appendChild(o);
      }
      kindSel.value = cond.kind;
      kindSel.addEventListener(
        'change',
        () => {
          const nextKind = kindSel.value as EcsScriptCond['kind'];
          const nextCond: EcsScriptCond = {
            kind: nextKind,
            ...(nextKind === 'global' ? { key: cond.key || 'energy' } : {}),
            ...(nextKind === 'var' ? { slot: cond.slot ?? 0 } : {}),
            op: cond.op,
            value: cond.value,
          };
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, cond: nextCond }), '更新條件來源');
        },
        { signal },
      );
      body.appendChild(kindSel);

      if (cond.kind === 'global') {
        const keyInp = this.makeInlineInput(`條件鍵名 ${node.id}`, cond.key ?? 'energy', 'text', (v) => {
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, cond: { ...cond, key: v || 'energy' } }), '更新條件鍵名');
        }, signal);
        body.appendChild(this.wrapInlineField('鍵名', keyInp));
      } else if (cond.kind === 'var') {
        const slotInp = this.makeInlineInput(`條件槽位 ${node.id}`, String(cond.slot ?? 0), 'number', (v) => {
          this.mutateNodeAndCommit(
            node.id,
            (n) => ({ ...n, cond: { ...cond, slot: Math.max(0, Math.min(7, Number(v) || 0)) } }),
            '更新條件槽位',
          );
        }, signal);
        body.appendChild(this.wrapInlineField('槽位', slotInp));
      }

      const row = document.createElement('div');
      row.className = 'p7-eg-row';
      const opSel = document.createElement('select');
      opSel.className = 'p7-select p7-eg-ctrl p7-mono';
      opSel.setAttribute('aria-label', `比較運算子 ${node.id}`);
      for (const opt of COMPARE_OPTIONS) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        opSel.appendChild(o);
      }
      opSel.value = cond.op;
      opSel.addEventListener(
        'change',
        () => {
          this.mutateNodeAndCommit(
            node.id,
            (n) => ({ ...n, cond: { ...cond, op: opSel.value as EcsCompareOp } }),
            '更新比較運算子',
          );
        },
        { signal },
      );
      const valInp = this.makeInlineInput(`比較數值 ${node.id}`, String(cond.value), 'number', (v) => {
        this.mutateNodeAndCommit(node.id, (n) => ({ ...n, cond: { ...cond, value: Number(v) || 0 } }), '更新比較值');
      }, signal);
      row.append(opSel, valInp);
      body.appendChild(row);
      return;
    }

    if (node.kind === 'action' && node.op) {
      const op = node.op;
      const opSel = document.createElement('select');
      opSel.className = 'p7-select p7-eg-ctrl';
      opSel.setAttribute('aria-label', `動作指令 ${node.id}`);
      for (const opt of ACTION_OPTIONS) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        opSel.appendChild(o);
      }
      opSel.value = op.op;
      opSel.addEventListener(
        'change',
        () => {
          const next = createDefaultAction(opSel.value as EcsScriptOp['op']);
          this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: next }), '更新動作指令');
        },
        { signal },
      );
      body.appendChild(opSel);

      switch (op.op) {
        case 'add_score': {
          const inp = this.makeInlineInput(`加分幅度 ${node.id}`, String(op.delta), 'number', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { op: 'add_score', delta: Number(v) || 0 } }), '更新分數增量');
          }, signal);
          body.appendChild(this.wrapInlineField('分數 +', inp));
          break;
        }
        case 'add_global': {
          const keyInp = this.makeInlineInput(`全域鍵名 ${node.id}`, op.key, 'text', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, key: v || 'energy' } }), '更新全域鍵名');
          }, signal);
          const dInp = this.makeInlineInput(`全域增量 ${node.id}`, String(op.delta), 'number', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, delta: Number(v) || 0 } }), '更新全域增量');
          }, signal);
          body.append(this.wrapInlineField('鍵名', keyInp), this.wrapInlineField('增量', dInp));
          break;
        }
        case 'set_global': {
          const keyInp = this.makeInlineInput(`全域鍵名 ${node.id}`, op.key, 'text', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, key: v || 'energy' } }), '更新全域鍵名');
          }, signal);
          const vInp = this.makeInlineInput(`全域數值 ${node.id}`, String(op.value), 'number', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, value: Number(v) || 0 } }), '更新全域值');
          }, signal);
          body.append(this.wrapInlineField('鍵名', keyInp), this.wrapInlineField('數值', vInp));
          break;
        }
        case 'play_sfx': {
          const sSel = document.createElement('select');
          sSel.className = 'p7-select p7-eg-ctrl';
          sSel.setAttribute('aria-label', `音效類型 ${node.id}`);
          for (const s of SFX_OPTIONS) {
            const o = document.createElement('option');
            o.value = s.value;
            o.textContent = s.label;
            sSel.appendChild(o);
          }
          sSel.value = op.sfx;
          sSel.addEventListener(
            'change',
            () => {
              this.mutateNodeAndCommit(
                node.id,
                (n) => ({ ...n, op: { op: 'play_sfx', sfx: sSel.value as typeof op.sfx } }),
                '更新音效',
              );
            },
            { signal },
          );
          body.appendChild(this.wrapInlineField('音效', sSel));
          break;
        }
        case 'emit_event': {
          const inp = this.makeInlineInput(`廣播事件名 ${node.id}`, op.name, 'text', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { op: 'emit_event', name: v || 'custom_event' } }), '更新事件名');
          }, signal);
          body.appendChild(this.wrapInlineField('事件名', inp));
          break;
        }
        case 'set_status': {
          const sSel = document.createElement('select');
          sSel.className = 'p7-select p7-eg-ctrl';
          sSel.setAttribute('aria-label', `勝負狀態 ${node.id}`);
          for (const st of [
            { v: 'won', l: '勝利 (won)' },
            { v: 'lost', l: '失敗 (lost)' },
          ]) {
            const o = document.createElement('option');
            o.value = st.v;
            o.textContent = st.l;
            sSel.appendChild(o);
          }
          sSel.value = op.status;
          sSel.addEventListener(
            'change',
            () => {
              this.mutateNodeAndCommit(
                node.id,
                (n) => ({ ...n, op: { op: 'set_status', status: sSel.value as 'won' | 'lost' } }),
                '更新勝負狀態',
              );
            },
            { signal },
          );
          body.appendChild(this.wrapInlineField('結果', sSel));
          break;
        }
        case 'spawn_prefab': {
          const inp = this.makeInlineInput(`Prefab 識別碼 ${node.id}`, op.prefab, 'text', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, prefab: v || 'star_bolt' } }), '更新生成模板');
          }, signal);
          body.appendChild(this.wrapInlineField('Prefab', inp));
          break;
        }
        case 'damage_global': {
          const keyInp = this.makeInlineInput(`扣減鍵名 ${node.id}`, op.key, 'text', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, key: v || 'coreHp' } }), '更新扣減鍵名');
          }, signal);
          const dInp = this.makeInlineInput(`扣減量 ${node.id}`, String(op.delta), 'number', (v) => {
            this.mutateNodeAndCommit(node.id, (n) => ({ ...n, op: { ...op, delta: Math.max(1, Number(v) || 1) } }), '更新扣減量');
          }, signal);
          body.append(this.wrapInlineField('鍵名', keyInp), this.wrapInlineField('扣減', dInp));
          break;
        }
        default: {
          const note = document.createElement('span');
          note.className = 'p7-meta-line p7-mono';
          note.textContent = describeEventGraphNode(node).subtitle;
          body.appendChild(note);
          break;
        }
      }
    }
  }

  private makeInlineInput(
    ariaLabel: string,
    initialValue: string,
    type: 'text' | 'number',
    onCommit: (val: string) => void,
    signal: AbortSignal,
    step?: string,
  ): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'p7-input p7-eg-ctrl p7-mono';
    inp.value = initialValue;
    if (step) inp.step = step;
    inp.setAttribute('aria-label', ariaLabel);
    inp.addEventListener('change', () => onCommit(inp.value), { signal });
    return inp;
  }

  private wrapInlineField(labelText: string, ctrl: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'p7-eg-field';
    const lbl = document.createElement('span');
    lbl.className = 'p7-eg-field-lbl';
    lbl.textContent = labelText;
    row.append(lbl, ctrl);
    return row;
  }

  /**
   * Updates live VM execution trace highlight classes and fire counters in place (zero DOM rebuild).
   */
  public updateLiveTrace(vm: SandboxScriptVm): void {
    if (!this.activeScriptId) return;
    const ops = vm.getLastFrameOpCount();
    this.liveStatsEl.textContent = `VM ${ops} ops/f`;

    for (let i = 0; i < this.liveNodeBindings.length; i++) {
      const b = this.liveNodeBindings[i];
      const glow = vm.getRuleHotGlow(this.activeScriptId, b.ruleIndex);
      const count = vm.getRuleFireCount(this.activeScriptId, b.ruleIndex);
      const isHot = glow > 0.05;
      if (isHot !== b.lastHot) {
        b.lastHot = isHot;
        b.el.classList.toggle('is-hot', isHot);
      }
      if (count !== b.lastCount) {
        b.lastCount = count;
        b.badgeEl.textContent = `×${count}`;
      }
    }

    for (let i = 0; i < this.liveEdgeBindings.length; i++) {
      const e = this.liveEdgeBindings[i];
      const isHot = vm.getRuleHotGlow(this.activeScriptId, e.ruleIndex) > 0.05;
      if (isHot !== e.lastHot) {
        e.lastHot = isHot;
        e.pathEl.classList.toggle('is-hot', isHot);
      }
    }
  }

  public destroy(): void {
    this.renderAc.abort();
    this.ac.abort();
    this.element.remove();
  }
}
