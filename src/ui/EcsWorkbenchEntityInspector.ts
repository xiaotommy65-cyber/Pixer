import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import {
  countEntityOverrides,
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsEntityInitDef,
  type EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsAlignEntitiesMode, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import {
  COMPONENT_CATALOG,
  collectProjectSpriteOptions,
  createWorkbenchSliderRow,
} from './EcsWorkbenchCatalog.ts';
import type { EcsWorkbenchLiveMutator } from './EcsWorkbenchLiveMutator.ts';

export interface EntityInspectorCallbacks {
  systemCount: number;
  liveMutator: EcsWorkbenchLiveMutator;
  onSaveEntityAsPrefab: (entityId: string) => void;
  onEditPrefabTemplate: (prefabId: string) => void;
  onOpenEventGraph: (scriptId: string) => void;
}

const ALIGN_BUTTONS: readonly { mode: EcsAlignEntitiesMode; label: string }[] = [
  { mode: 'align_x', label: '左/X 對齊' },
  { mode: 'align_y', label: '上/Y 對齊' },
  { mode: 'align_z', label: '同高 Z' },
  { mode: 'distribute_x', label: '水平等距' },
  { mode: 'distribute_y', label: '垂直等距' },
  { mode: 'snap_floor', label: '貼齊地/樓面' },
];

type SliderSpec = readonly [
  label: string,
  min: number,
  max: number,
  step: number,
  val: number,
  fmt: (v: number) => string,
  onLive: (v: number) => void,
  onCommit: (v: number) => void,
];

function makeBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function makeSection(titleText: string): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'p7-section';
  const title = document.createElement('h3');
  title.className = 'p7-section-title';
  title.textContent = titleText;
  sec.appendChild(title);
  return sec;
}

function makeSliderGroup(specs: readonly SliderSpec[]): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'p7-slider-group';
  for (const [label, min, max, step, val, fmt, onLive, onCommit] of specs) {
    group.appendChild(createWorkbenchSliderRow(label, min, max, step, val, fmt, onLive, onCommit));
  }
  return group;
}

function makeColorRow(
  label: string,
  ariaLabel: string,
  color: string,
  onLive: (hex: string) => void,
  onCommit: (hex: string) => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'p7-color-row';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  const right = document.createElement('div');
  right.className = 'p7-toolbar-group';
  const hexText = document.createElement('span');
  hexText.className = 'p7-mono p7-slider-val';
  hexText.textContent = color.toUpperCase();
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.className = 'p7-color-input';
  inp.value = color;
  inp.setAttribute('aria-label', ariaLabel);
  inp.addEventListener('input', () => {
    hexText.textContent = inp.value.toUpperCase();
    onLive(inp.value);
  });
  inp.addEventListener('change', () => onCommit(inp.value));
  right.append(hexText, inp);
  row.append(lbl, right);
  return row;
}

function makeSelectField(
  label: string,
  ariaLabel: string,
  options: readonly { value: string; label: string }[],
  value: string,
  onChange: (val: string) => void,
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'p7-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const sel = document.createElement('select');
  sel.className = 'p7-select p7-mono';
  sel.setAttribute('aria-label', ariaLabel);
  let hasValue = false;
  for (const opt of options) {
    if (opt.value === value) hasValue = true;
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  if (value && !hasValue) {
    const cur = document.createElement('option');
    cur.value = value;
    cur.textContent = value;
    sel.appendChild(cur);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  field.append(lbl, sel);
  return field;
}

function makeTextField(
  label: string,
  value: string,
  placeholder: string,
  onChange: (val: string) => void,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'p7-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'p7-input p7-mono';
  if (placeholder) inp.placeholder = placeholder;
  inp.value = value;
  inp.addEventListener('change', () => onChange(inp.value.trim()));
  wrap.append(lbl, inp);
  return wrap;
}

/**
 * Builds the Multi-Select Batch Action & Alignment section rendered at the top of the Right Inspector
 * whenever 2 or more entities are selected.
 */
export function buildMultiSelectInspectorSection(
  proj: EcsProjectV2,
  session: EcsStudioSession,
  selectedIds: readonly string[],
  onSelectionChange: (ids: string[]) => void,
): HTMLElement {
  const entityMap = new Map(proj.entities.map((e) => [e.id, e]));
  const selectedEntities: EcsEntityInitDef[] = [];
  for (const id of selectedIds) {
    const ent = entityMap.get(id);
    if (ent) selectedEntities.push(ent);
  }
  const validIds = selectedEntities.map((e) => e.id);

  const sec = document.createElement('div');
  sec.className = 'p7-section';
  sec.dataset.testid = 'multi-select-inspector';

  const head = document.createElement('div');
  head.className = 'p7-section-head';
  const title = document.createElement('h3');
  title.className = 'p7-section-title';
  title.textContent = `已多選 ${validIds.length} 個實體`;
  head.append(title, makeBtn('清除選取', 'p7-btn p7-btn-xs', () => onSelectionChange([])));

  const pills = document.createElement('div');
  pills.className = 'p7-interop-tags';
  for (const ent of selectedEntities) {
    const pill = makeBtn(ent.name, 'p7-btn p7-btn-xs p7-mono', () => onSelectionChange([ent.id]));
    pill.title = `單獨選取「${ent.name}」(${ent.id})`;
    pills.appendChild(pill);
  }

  const alignGrid = document.createElement('div');
  alignGrid.className = 'p7-map-tools';
  for (const ab of ALIGN_BUTTONS) {
    const btn = makeBtn(ab.label, 'p7-btn p7-btn-xs', () => {
      if (validIds.length > 0) session.dispatch({ type: 'align_entities', entityIds: [...validIds], mode: ab.mode });
    });
    btn.dataset.alignMode = ab.mode;
    alignGrid.appendChild(btn);
  }

  const actionRow = document.createElement('div');
  actionRow.className = 'p7-prefab-actions';
  const dupBtn = makeBtn('複製群組 (Ctrl+D)', 'p7-btn p7-btn-accent p7-btn-xs', () => {
    if (validIds.length === 0) return;
    const res = session.dispatch({ type: 'duplicate_entities', entityIds: [...validIds], offsetX: 16, offsetY: 16 });
    if (res.ok && res.createdEntityIds && res.createdEntityIds.length > 0) onSelectionChange([...res.createdEntityIds]);
  });
  dupBtn.dataset.testid = 'multi-select-duplicate';

  const delBtn = makeBtn('刪除所選 (Del)', 'p7-btn p7-btn-danger p7-btn-xs', () => {
    if (validIds.length === 0) return;
    const res = session.dispatchBatch(validIds.map((entityId) => ({ type: 'remove_entity', entityId })), `刪除 ${validIds.length} 個實體`);
    if (res.ok) onSelectionChange([]);
  });
  delBtn.dataset.testid = 'multi-select-delete';

  actionRow.append(dupBtn, delBtn);
  sec.append(head, pills, alignGrid, actionRow);
  return sec;
}

/**
 * Builds the Right-Pane Entity Component Inspector sections:
 * Transform2D, Prefab Inheritance Bar, Dynamic Attach/Detach Slots, PBR Material,
 * LightSource, CharacterMotor2D, GrappleAnchor, TriggerZone, VerletChain, Spatial3D, and Scripts.
 */
export function buildEntityInspectorSections(
  proj: EcsProjectV2,
  ent: EcsEntityInitDef,
  session: EcsStudioSession,
  atlas: TextureAtlas,
  cb: EntityInspectorCallbacks,
): HTMLElement[] {
  const resolved = resolveEntityComponents(ent, proj.prefabs);
  const linkedPrefabId = getEntityPrefabId(ent);
  const linkedPrefab = linkedPrefabId ? proj.prefabs[linkedPrefabId] : undefined;
  const overrideCount = linkedPrefab ? countEntityOverrides(ent) : 0;

  // Section 1: Transform & Entity Header
  const trSec = document.createElement('div');
  trSec.className = 'p7-section';
  const trHead = document.createElement('div');
  trHead.className = 'p7-section-head';
  const trTitle = document.createElement('h3');
  trTitle.className = 'p7-section-title';
  trTitle.textContent = `實體：${ent.name}`;
  trTitle.title = ent.name;

  const headBtns = document.createElement('div');
  headBtns.className = 'p7-head-actions';
  headBtns.append(
    makeBtn('存為 Prefab', 'p7-btn p7-btn-xs', () => cb.onSaveEntityAsPrefab(ent.id)),
    makeBtn('刪除實體', 'p7-btn p7-btn-danger p7-btn-xs', () => {
      session.dispatch({ type: 'remove_entity', entityId: ent.id });
    }),
  );
  trHead.append(trTitle, headBtns);

  if (linkedPrefab) {
    const linkBar = document.createElement('div');
    linkBar.className = 'p7-prefab-link-bar';
    const linkInfo = document.createElement('span');
    linkInfo.className = 'p7-meta-line p7-mono';
    linkInfo.textContent = `繼承模板：${linkedPrefab.name} (${linkedPrefab.id}) · ${overrideCount} 項覆寫`;

    const linkActs = document.createElement('div');
    linkActs.className = 'p7-prefab-actions';
    const revertBtn = makeBtn('重置覆寫', 'p7-btn p7-btn-xs', () => {
      session.dispatch({ type: 'revert_prefab_overrides', entityId: ent.id, keepPosition: true });
    });
    revertBtn.disabled = overrideCount === 0;
    linkActs.append(
      makeBtn('編輯模板', 'p7-btn p7-btn-xs p7-btn-accent', () => cb.onEditPrefabTemplate(linkedPrefab.id)),
      revertBtn,
      makeBtn('斷開連結', 'p7-btn p7-btn-xs', () => {
        session.dispatch({ type: 'unlink_prefab', entityId: ent.id });
      }),
    );
    linkBar.append(linkInfo, linkActs);
    trSec.append(trHead, linkBar);
  } else {
    trSec.append(trHead);
  }

  const grid = document.createElement('div');
  grid.className = 'p7-prop-grid';
  const tr = resolved.transform;
  const clampScale = (n: number) => Math.round(Math.max(0.1, Math.min(8, n)) * 1000) / 1000;
  const formatScale = (n: number) => String(Math.round(n * 100) / 100);
  const addNumField = (
    label: string,
    val: number,
    onCommit: (n: number) => void,
    opts?: { step?: string; min?: string; max?: string; float?: boolean; testId?: string; onLive?: (n: number) => void },
  ) => {
    const wrap = document.createElement('div');
    wrap.className = 'p7-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'p7-input p7-mono';
    if (opts?.step) inp.step = opts.step;
    if (opts?.min) inp.min = opts.min;
    if (opts?.max) inp.max = opts.max;
    if (opts?.testId) inp.dataset.testid = opts.testId;
    inp.value = opts?.float ? formatScale(val) : String(Math.round(val));
    if (opts?.onLive) {
      const onLive = opts.onLive;
      inp.addEventListener('input', () => {
        const parsed = Number(inp.value);
        if (Number.isFinite(parsed)) onLive(parsed);
      });
    }
    inp.addEventListener('change', () => {
      const parsed = Number(inp.value);
      if (!Number.isFinite(parsed)) return;
      if (opts?.float) inp.value = formatScale(clampScale(parsed));
      onCommit(parsed);
    });
    wrap.append(lbl, inp);
    grid.appendChild(wrap);
  };
  const commitTransform = (partial: Partial<typeof tr>) => {
    session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { transform: partial } });
  };
  addNumField('X 座標', tr.x, (x) => commitTransform({ x }));
  addNumField('Y 座標', tr.y, (y) => commitTransform({ y }));
  addNumField('寬度 W', tr.w ?? 16, (w) => commitTransform({ w }));
  addNumField('高度 H', tr.h ?? 16, (h) => commitTransform({ h }));
  addNumField('縮放 X (scaleX)', tr.scaleX ?? 1, (n) => commitTransform({ scaleX: clampScale(n) }), {
    step: '0.05', min: '0.1', max: '8', float: true, testId: 'entity-scale-x',
    onLive: (n) => cb.liveMutator?.mutateTransform(ent.id, { scaleX: clampScale(n) }),
  });
  addNumField('縮放 Y (scaleY)', tr.scaleY ?? 1, (n) => commitTransform({ scaleY: clampScale(n) }), {
    step: '0.05', min: '0.1', max: '8', float: true, testId: 'entity-scale-y',
    onLive: (n) => cb.liveMutator?.mutateTransform(ent.id, { scaleY: clampScale(n) }),
  });
  trSec.append(grid);

  if (resolved.mesh3d) {
    const m3 = resolved.mesh3d;
    const meshWrap = document.createElement('div');
    meshWrap.className = 'p7-field';
    const meshLbl = document.createElement('label');
    meshLbl.textContent = '3D 縮放 (SX / SY / SZ)';
    const meshGrid = document.createElement('div');
    meshGrid.className = 'p7-model-atelier-vec3';
    meshGrid.dataset.testid = 'entity-mesh3d-scale';
    for (const [key, label, testId, val] of [
      ['scaleX', 'SX', 'entity-mesh-scale-x', m3.scaleX ?? 1],
      ['scaleY', 'SY', 'entity-mesh-scale-y', m3.scaleY ?? 1],
      ['scaleZ', 'SZ', 'entity-mesh-scale-z', m3.scaleZ ?? 1],
    ] as const) {
      const cell = document.createElement('div');
      cell.className = 'p7-field';
      const axLbl = document.createElement('label');
      axLbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'p7-input p7-mono';
      inp.step = '0.05';
      inp.min = '0.1';
      inp.max = '8';
      inp.value = formatScale(val);
      inp.dataset.testid = testId;
      inp.setAttribute('aria-label', `3D 縮放 ${label}`);
      inp.addEventListener('input', () => {
        const parsed = Number(inp.value);
        if (Number.isFinite(parsed)) cb.liveMutator?.mutateMesh3DScale(ent.id, { [key]: clampScale(parsed) });
      });
      inp.addEventListener('change', () => {
        const parsed = Number(inp.value);
        if (!Number.isFinite(parsed)) return;
        const clamped = clampScale(parsed);
        inp.value = formatScale(clamped);
        session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { mesh3d: { [key]: clamped } } });
      });
      cell.append(axLbl, inp);
      meshGrid.appendChild(cell);
    }
    meshWrap.append(meshLbl, meshGrid);
    trSec.appendChild(meshWrap);
  }

  // Section 2: Dynamic ECS Component Attach / Detach Manager
  const compSec = document.createElement('div');
  compSec.className = 'p7-section';
  const compHead = document.createElement('div');
  compHead.className = 'p7-section-head';
  const compTitle = document.createElement('h3');
  compTitle.className = 'p7-section-title';
  compTitle.textContent = 'ECS 元件插槽';
  const pipeNote = document.createElement('span');
  pipeNote.className = 'p7-meta-line p7-mono';
  pipeNote.textContent = `5 階段 · ${cb.systemCount} 系統`;
  compHead.append(compTitle, pipeNote);

  const compList = document.createElement('div');
  compList.className = 'p7-comp-list';
  const coreRow = document.createElement('div');
  coreRow.className = 'p7-comp-row';
  const coreNm = document.createElement('span');
  coreNm.className = 'p7-comp-name p7-mono';
  coreNm.textContent = 'Transform2D';
  const coreMeta = document.createElement('span');
  coreMeta.className = 'p7-comp-meta p7-mono';
  coreMeta.textContent = '核心必要';
  coreRow.append(coreNm, coreMeta);
  compList.appendChild(coreRow);

  const compRecord = resolved as unknown as Record<string, unknown>;
  const overrideRecord = (ent.overrides ?? {}) as Record<string, unknown>;
  const unmounted: (typeof COMPONENT_CATALOG)[number][] = [];
  for (const def of COMPONENT_CATALOG) {
    if (compRecord[def.key] !== undefined) {
      const row = document.createElement('div');
      row.className = 'p7-comp-row';
      const nm = document.createElement('span');
      nm.className = 'p7-comp-name';
      nm.textContent = def.label;
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
      rmBtn.textContent = '移除';
      rmBtn.dataset.detachComponent = def.key;
      rmBtn.addEventListener('click', () => {
        session.dispatch({ type: 'detach_component', entityId: ent.id, component: def.key });
      });
      if (linkedPrefab && overrideRecord[def.key] !== undefined) {
        const ovMark = document.createElement('span');
        ovMark.className = 'p7-override-mark p7-mono';
        ovMark.textContent = '已覆寫';
        row.append(nm, ovMark, rmBtn);
      } else {
        row.append(nm, rmBtn);
      }
      compList.appendChild(row);
    } else {
      unmounted.push(def);
    }
  }
  compSec.append(compHead, compList);

  if (unmounted.length > 0) {
    const attachBar = document.createElement('div');
    attachBar.className = 'p7-attach-bar';
    const sel = document.createElement('select');
    sel.className = 'p7-select';
    sel.setAttribute('aria-label', '選擇要掛載的 ECS 元件');
    for (const def of unmounted) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = def.label;
      sel.appendChild(opt);
    }
    const addCompBtn = document.createElement('button');
    addCompBtn.type = 'button';
    addCompBtn.className = 'p7-btn p7-btn-accent';
    addCompBtn.textContent = '+ 掛載元件';
    addCompBtn.addEventListener('click', () => {
      const chosen = unmounted.find((u) => u.key === sel.value) ?? unmounted[0];
      if (!chosen) return;
      session.dispatch({
        type: 'attach_component',
        entityId: ent.id,
        component: chosen.key,
        value: chosen.createDefault(),
      });
    });
    attachBar.append(sel, addCompBtn);
    compSec.appendChild(attachBar);
  }

  const sections: HTMLElement[] = [trSec, compSec];

  // Section 3: Live GPU PBR Material Inspector
  if (resolved.sprite) {
    const sp = resolved.sprite;
    const matSec = makeSection('PBR 材質與精靈圖集');
    const commitSprite = (partial: Partial<typeof sp>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { sprite: partial } });
    };
    const spriteOpts = collectProjectSpriteOptions(proj, atlas).map((o) => ({ value: o.id, label: o.label }));
    matSec.append(
      makeSelectField('高解析精靈資產 (Multi-Page Atlas)', '精靈紋理選擇', spriteOpts, sp.sprite, (v) =>
        commitSprite({ sprite: v as SpriteId }),
      ),
      makeSliderGroup([
        ['金屬度 Metallic', 0, 1, 0.05, sp.metallic ?? 0.25, (v) => v.toFixed(2), (v) => cb.liveMutator.mutateMaterial(ent.id, { metallic: v }), (v) => commitSprite({ metallic: v })],
        ['粗糙度 Roughness', 0.05, 1, 0.05, sp.roughness ?? 0.42, (v) => v.toFixed(2), (v) => cb.liveMutator.mutateMaterial(ent.id, { roughness: v }), (v) => commitSprite({ roughness: v })],
        ['自發光 Emissive', 0, 1.5, 0.05, sp.emissive ?? 0, (v) => v.toFixed(2), (v) => cb.liveMutator.mutateMaterial(ent.id, { emissive: v }), (v) => commitSprite({ emissive: v })],
      ]),
    );
    sections.push(matSec);
  }

  // Section 4: Live Dynamic Light Controls
  if (resolved.light) {
    const lt = resolved.light;
    const lightSec = makeSection('動態點光源 LightSource');
    const commitLight = (partial: Partial<typeof lt>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { light: partial } });
    };
    lightSec.append(
      makeColorRow('光色 Color', '光源顏色', lt.color, (color) => cb.liveMutator.mutateLight(ent.id, { color }), (color) => commitLight({ color })),
      makeSliderGroup([
        ['照射半徑 Radius', 16, 180, 4, lt.radius, (v) => `${Math.round(v)}px`, (v) => cb.liveMutator.mutateLight(ent.id, { radius: v }), (v) => commitLight({ radius: v })],
        ['光照強度 Intensity', 0.1, 2.0, 0.05, lt.intensity ?? 0.9, (v) => v.toFixed(2), (v) => cb.liveMutator.mutateLight(ent.id, { intensity: v }), (v) => commitLight({ intensity: v })],
      ]),
    );
    sections.push(lightSec);
  }

  // Section 4b: CharacterMotor2D Action Physics Inspector
  if (resolved.characterMotor2d) {
    const m = resolved.characterMotor2d;
    const motorSec = makeSection('CharacterMotor2D 動作馬達');
    const commitMotor = (partial: Partial<typeof m>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { characterMotor2d: partial } });
    };
    motorSec.append(
      makeSliderGroup([
        ['重力 Gravity', 100, 1600, 20, m.gravity ?? 720, (v) => `${Math.round(v)} px/s²`, (v) => cb.liveMutator.mutateMotor(ent.id, { gravity: v }), (v) => commitMotor({ gravity: v })],
        ['跳躍初速 Jump', 120, 560, 10, m.jumpVelocity ?? 290, (v) => `${Math.round(v)} px/s`, (v) => cb.liveMutator.mutateMotor(ent.id, { jumpVelocity: v }), (v) => commitMotor({ jumpVelocity: v })],
        ['移動速度 Speed', 40, 360, 10, m.moveSpeed ?? 150, (v) => `${Math.round(v)} px/s`, (v) => cb.liveMutator.mutateMotor(ent.id, { moveSpeed: v }), (v) => commitMotor({ moveSpeed: v })],
        ['土狼時間 Coyote', 0, 0.3, 0.02, m.coyoteTimeSec ?? 0.12, (v) => `${v.toFixed(2)}s`, (v) => cb.liveMutator.mutateMotor(ent.id, { coyoteTimeSec: v }), (v) => commitMotor({ coyoteTimeSec: v })],
        ['地面高度 Floor Y', 0, 360, 4, m.floorY ?? 224, (v) => (v <= 0 ? '視口底部' : `${Math.round(v)}px`), (v) => cb.liveMutator.mutateMotor(ent.id, { floorY: v }), (v) => commitMotor({ floorY: v })],
      ]),
    );
    sections.push(motorSec);
  }

  // Section 4c: GrappleAnchor Inspector
  if (resolved.grappleAnchor) {
    const g = resolved.grappleAnchor;
    const grapSec = makeSection('GrappleAnchor 鉤索錨點');
    const commitGrapple = (partial: Partial<typeof g>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { grappleAnchor: partial } });
    };
    grapSec.append(
      makeSliderGroup([
        ['捕獲半徑 Radius', 40, 280, 10, g.anchorRadius ?? 150, (v) => `${Math.round(v)}px`, (v) => cb.liveMutator.mutateGrapple(ent.id, { anchorRadius: v }), (v) => commitGrapple({ anchorRadius: v })],
        ['擺盪張力 Tension', 0.8, 1.0, 0.01, g.swingTension ?? 0.98, (v) => v.toFixed(2), (v) => cb.liveMutator.mutateGrapple(ent.id, { swingTension: v }), (v) => commitGrapple({ swingTension: v })],
        ['捲繩速度 Reel', 20, 240, 8, g.reelSpeed ?? 96, (v) => `${Math.round(v)} px/s`, (v) => cb.liveMutator.mutateGrapple(ent.id, { reelSpeed: v }), (v) => commitGrapple({ reelSpeed: v })],
      ]),
    );
    sections.push(grapSec);
  }

  // Section 4d: TriggerZone Sensor Inspector
  if (resolved.triggerZone) {
    const tz = resolved.triggerZone;
    const tzSec = makeSection('TriggerZone 互動感測區');
    const commitZone = (partial: Partial<typeof tz>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { triggerZone: partial } });
    };
    const tzGrid = document.createElement('div');
    tzGrid.className = 'p7-prop-grid';
    tzGrid.append(
      makeSelectField(
        '感測形狀 Shape',
        '感測區形狀',
        [
          { value: 'circle', label: '圓形 Circle' },
          { value: 'rect', label: '矩形 Rect' },
        ],
        tz.shape ?? 'circle',
        (v) => commitZone({ shape: v as 'circle' | 'rect' }),
      ),
      makeTextField('目標標籤 Filter Tag', tz.filterTag ?? '', '留空偵測全部', (v) => commitZone({ filterTag: v })),
      makeTextField('進入事件 Enter', tz.onEnterEvent ?? 'zone_enter', '', (v) => commitZone({ onEnterEvent: v })),
      makeTextField('離開事件 Exit', tz.onExitEvent ?? 'zone_exit', '', (v) => commitZone({ onExitEvent: v })),
    );
    const radSlider = createWorkbenchSliderRow(
      '感測半徑 Radius',
      12,
      140,
      4,
      tz.radius ?? 36,
      (v) => `${Math.round(v)}px`,
      () => {},
      (v) => commitZone({ radius: v }),
    );
    const oneShotBtn = document.createElement('button');
    oneShotBtn.type = 'button';
    oneShotBtn.className = tz.oneShot ? 'p7-btn p7-btn-accent' : 'p7-btn';
    oneShotBtn.textContent = tz.oneShot ? '單次觸發 One-Shot：開啟' : '單次觸發 One-Shot：關閉';
    oneShotBtn.addEventListener('click', () => commitZone({ oneShot: !tz.oneShot }));
    tzSec.append(tzGrid, radSlider, oneShotBtn);
    sections.push(tzSec);
  }

  // Section 4e: VerletChain Rope/Cape Inspector
  if (resolved.verletChain) {
    const vc = resolved.verletChain;
    const vcSec = makeSection('VerletChain 柔體鍊條');
    const commitVerlet = (partial: Partial<typeof vc>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { verletChain: partial } });
    };
    vcSec.append(
      makeColorRow('鍊條色 Color', '鍊條顏色', vc.color ?? '#f59e0b', (color) => cb.liveMutator.mutateVerlet(ent.id, { color }), (color) => commitVerlet({ color })),
      makeSliderGroup([
        ['節點數量 Nodes', 2, 16, 1, vc.nodeCount ?? 6, (v) => `${Math.round(v)} 節`, (v) => cb.liveMutator.mutateVerlet(ent.id, { nodeCount: v }), (v) => commitVerlet({ nodeCount: v })],
        ['節段長度 Segment', 4, 28, 1, vc.segmentLength ?? 10, (v) => `${Math.round(v)}px`, (v) => cb.liveMutator.mutateVerlet(ent.id, { segmentLength: v }), (v) => commitVerlet({ segmentLength: v })],
        ['柔體重力 Gravity', 0, 1200, 20, vc.gravity ?? 420, (v) => `${Math.round(v)}`, (v) => cb.liveMutator.mutateVerlet(ent.id, { gravity: v }), (v) => commitVerlet({ gravity: v })],
      ]),
    );
    sections.push(vcSec);
  }

  // Section 4f: Spatial3D Elevation & Dimension Mask Inspector
  if (resolved.spatial3d) {
    const sp = resolved.spatial3d;
    const spSec = makeSection('Spatial3D 立體高度與維度');
    const commitSpatial = (partial: Partial<typeof sp>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { spatial3d: partial } });
    };
    const normYaw = (deg: number) => {
      const w = ((deg % 360) + 360) % 360;
      return w === 360 ? 0 : Math.round(w * 100) / 100;
    };
    const yawField = document.createElement('div');
    yawField.className = 'p7-field';
    const yawLbl = document.createElement('label');
    yawLbl.textContent = '水平旋轉 Yaw (°)';
    const yawRow = document.createElement('div');
    yawRow.style.display = 'flex';
    yawRow.style.alignItems = 'center';
    yawRow.style.gap = '6px';
    const yawInp = document.createElement('input');
    yawInp.type = 'number';
    yawInp.className = 'p7-input p7-mono';
    yawInp.step = '1';
    yawInp.min = '-360';
    yawInp.max = '360';
    yawInp.value = String(normYaw(sp.yaw ?? 0));
    yawInp.style.flex = '1';
    yawInp.style.minWidth = '0';
    yawInp.dataset.testid = 'entity-spatial-yaw';
    yawInp.setAttribute('aria-label', '水平旋轉 Yaw (°)');
    yawInp.addEventListener('input', () => {
      const parsed = Number(yawInp.value);
      if (Number.isFinite(parsed)) cb.liveMutator?.mutateSpatial3D(ent.id, { yaw: parsed });
    });
    yawInp.addEventListener('change', () => {
      const parsed = Number(yawInp.value);
      if (!Number.isFinite(parsed)) return;
      const yaw = normYaw(parsed);
      yawInp.value = String(yaw);
      commitSpatial({ yaw });
    });
    const yawResetBtn = makeBtn('0°', 'p7-btn p7-btn-xs', () => {
      yawInp.value = '0';
      cb.liveMutator?.mutateSpatial3D(ent.id, { yaw: 0 });
      commitSpatial({ yaw: 0 });
    });
    yawResetBtn.dataset.testid = 'entity-spatial-yaw-reset';
    yawResetBtn.title = '歸零水平旋轉 Yaw 為 0°';
    yawRow.append(yawInp, yawResetBtn);
    yawField.append(yawLbl, yawRow);

    spSec.append(
      makeSelectField(
        '所屬維度位面 (Dimension Mask)',
        '實體所屬維度位面',
        [
          { value: '1', label: '表世界 [1]' },
          { value: '2', label: '裡世界 [2]' },
          { value: '3', label: '全維度共用 [3]' },
        ],
        String(sp.dimensionMask ?? 1),
        (val) => {
          const mask = Number(val) || 1;
          cb.liveMutator.mutateSpatial3D(ent.id, { dimensionMask: mask });
          commitSpatial({ dimensionMask: mask });
        },
      ),
      yawField,
      makeSliderGroup([
        ['海拔高度 Z', 0, 120, 2, sp.z ?? 0, (v) => `${Math.round(v)}px`, (v) => cb.liveMutator.mutateSpatial3D(ent.id, { z: v }), (v) => commitSpatial({ z: v })],
        ['垂直厚度 Height', 4, 64, 2, sp.height ?? 16, (v) => `${Math.round(v)}px`, (v) => cb.liveMutator.mutateSpatial3D(ent.id, { height: v }), (v) => commitSpatial({ height: v })],
        ['Z 軸重力 GravityZ', 0, 1200, 20, sp.gravityZ ?? 0, (v) => (v <= 0 ? '懸浮 (0)' : `${Math.round(v)} px/s²`), (v) => cb.liveMutator.mutateSpatial3D(ent.id, { gravityZ: v }), (v) => commitSpatial({ gravityZ: v })],
        ['Z 跳躍初速 JumpZ', 0, 420, 10, sp.jumpZVelocity ?? 190, (v) => `${Math.round(v)} px/s`, (v) => cb.liveMutator.mutateSpatial3D(ent.id, { jumpZVelocity: v }), (v) => commitSpatial({ jumpZVelocity: v })],
      ]),
    );
    sections.push(spSec);
  }

  // Section 5: Sandboxed Script VM Rules
  const scrSec = makeSection('沙盒腳本虛擬機規則');
  const attachedScripts = resolved.scripts ?? [];
  if (attachedScripts.length === 0) {
    const note = document.createElement('p');
    note.className = 'p7-empty-note';
    note.textContent = '此實體尚未掛載沙盒腳本。';
    scrSec.appendChild(note);
  } else {
    for (const sid of attachedScripts) {
      const def = proj.scripts[sid];
      if (!def) continue;
      const item = document.createElement('div');
      item.className = 'p7-script-item';
      const itemHead = document.createElement('div');
      itemHead.className = 'p7-section-head';
      const nm = document.createElement('strong');
      nm.className = 'p7-item-title';
      nm.textContent = `${def.name} (${def.id})`;
      const openGraphBtn = document.createElement('button');
      openGraphBtn.type = 'button';
      openGraphBtn.className = 'p7-btn p7-btn-xs';
      openGraphBtn.textContent = '編輯事件圖';
      openGraphBtn.setAttribute('aria-label', `編輯 ${def.name} 事件圖`);
      openGraphBtn.addEventListener('click', () => cb.onOpenEventGraph(def.id));
      itemHead.append(nm, openGraphBtn);

      const desc = document.createElement('span');
      desc.className = 'p7-meta-line';
      const totalOps = def.rules.reduce((acc, r) => acc + r.ops.length, 0);
      desc.textContent = `${def.rules.length} 條規則 · ${totalOps} 指令 · ${def.description ?? '確定性位元碼'}`;
      item.append(itemHead, desc);
      scrSec.appendChild(item);
    }
  }
  sections.push(scrSec);

  return sections;
}
