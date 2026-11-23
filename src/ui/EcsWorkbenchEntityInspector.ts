import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import {
  countEntityOverrides,
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsEntityInitDef,
  type EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
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

  const savePrefBtn = document.createElement('button');
  savePrefBtn.type = 'button';
  savePrefBtn.className = 'p7-btn p7-btn-xs';
  savePrefBtn.textContent = '存為 Prefab';
  savePrefBtn.addEventListener('click', () => cb.onSaveEntityAsPrefab(ent.id));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
  delBtn.textContent = '刪除實體';
  delBtn.addEventListener('click', () => {
    session.dispatch({ type: 'remove_entity', entityId: ent.id });
  });
  headBtns.append(savePrefBtn, delBtn);
  trHead.append(trTitle, headBtns);

  if (linkedPrefab) {
    const linkBar = document.createElement('div');
    linkBar.className = 'p7-prefab-link-bar';
    const linkInfo = document.createElement('span');
    linkInfo.className = 'p7-meta-line p7-mono';
    linkInfo.textContent = `繼承模板：${linkedPrefab.name} (${linkedPrefab.id}) · ${overrideCount} 項覆寫`;

    const linkActs = document.createElement('div');
    linkActs.className = 'p7-prefab-actions';

    const editTplBtn = document.createElement('button');
    editTplBtn.type = 'button';
    editTplBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
    editTplBtn.textContent = '編輯模板';
    editTplBtn.addEventListener('click', () => cb.onEditPrefabTemplate(linkedPrefab.id));

    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.className = 'p7-btn p7-btn-xs';
    revertBtn.textContent = '重置覆寫';
    revertBtn.disabled = overrideCount === 0;
    revertBtn.addEventListener('click', () => {
      session.dispatch({ type: 'revert_prefab_overrides', entityId: ent.id, keepPosition: true });
    });

    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.className = 'p7-btn p7-btn-xs';
    unlinkBtn.textContent = '斷開連結';
    unlinkBtn.addEventListener('click', () => {
      session.dispatch({ type: 'unlink_prefab', entityId: ent.id });
    });

    linkActs.append(editTplBtn, revertBtn, unlinkBtn);
    linkBar.append(linkInfo, linkActs);
    trSec.append(trHead, linkBar);
  } else {
    trSec.append(trHead);
  }

  const grid = document.createElement('div');
  grid.className = 'p7-prop-grid';
  const tr = resolved.transform;

  const addNumField = (label: string, val: number, onCommit: (n: number) => void) => {
    const wrap = document.createElement('div');
    wrap.className = 'p7-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'p7-input p7-mono';
    inp.value = String(Math.round(val));
    inp.addEventListener('change', () => {
      const parsed = Number(inp.value);
      if (Number.isFinite(parsed)) onCommit(parsed);
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
  trSec.append(grid);

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
    const matSec = document.createElement('div');
    matSec.className = 'p7-section';
    const matTitle = document.createElement('h3');
    matTitle.className = 'p7-section-title';
    matTitle.textContent = 'PBR 材質與精靈圖集';

    const sprField = document.createElement('div');
    sprField.className = 'p7-field';
    const sprLbl = document.createElement('label');
    sprLbl.textContent = '高解析精靈資產 (Multi-Page Atlas)';
    const sprSel = document.createElement('select');
    sprSel.className = 'p7-select p7-mono';
    sprSel.setAttribute('aria-label', '精靈紋理選擇');

    const spriteOpts = collectProjectSpriteOptions(proj, atlas);
    const seen = new Set<string>();
    for (const opt of spriteOpts) {
      seen.add(opt.id);
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      sprSel.appendChild(o);
    }
    if (!seen.has(sp.sprite)) {
      const o = document.createElement('option');
      o.value = sp.sprite;
      o.textContent = sp.sprite;
      sprSel.appendChild(o);
    }
    const commitSprite = (partial: Partial<typeof sp>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { sprite: partial } });
    };
    sprSel.value = sp.sprite;
    sprSel.addEventListener('change', () => commitSprite({ sprite: sprSel.value as SpriteId }));
    sprField.append(sprLbl, sprSel);

    const sliders = document.createElement('div');
    sliders.className = 'p7-slider-group';
    sliders.append(
      createWorkbenchSliderRow(
        '金屬度 Metallic',
        0,
        1,
        0.05,
        sp.metallic ?? 0.25,
        (v) => v.toFixed(2),
        (v) => cb.liveMutator.mutateMaterial(ent.id, { metallic: v }),
        (v) => commitSprite({ metallic: v }),
      ),
      createWorkbenchSliderRow(
        '粗糙度 Roughness',
        0.05,
        1,
        0.05,
        sp.roughness ?? 0.42,
        (v) => v.toFixed(2),
        (v) => cb.liveMutator.mutateMaterial(ent.id, { roughness: v }),
        (v) => commitSprite({ roughness: v }),
      ),
      createWorkbenchSliderRow(
        '自發光 Emissive',
        0,
        1.5,
        0.05,
        sp.emissive ?? 0,
        (v) => v.toFixed(2),
        (v) => cb.liveMutator.mutateMaterial(ent.id, { emissive: v }),
        (v) => commitSprite({ emissive: v }),
      ),
    );
    matSec.append(matTitle, sprField, sliders);
    sections.push(matSec);
  }

  // Section 4: Live Dynamic Light Controls
  if (resolved.light) {
    const lt = resolved.light;
    const lightSec = document.createElement('div');
    lightSec.className = 'p7-section';
    const lightTitle = document.createElement('h3');
    lightTitle.className = 'p7-section-title';
    lightTitle.textContent = '動態點光源 LightSource';

    const colRow = document.createElement('div');
    colRow.className = 'p7-color-row';
    const colLbl = document.createElement('span');
    colLbl.textContent = '光色 Color';
    const colRight = document.createElement('div');
    colRight.className = 'p7-toolbar-group';
    const colHexText = document.createElement('span');
    colHexText.className = 'p7-mono p7-slider-val';
    colHexText.textContent = lt.color.toUpperCase();
    const colInput = document.createElement('input');
    colInput.type = 'color';
    colInput.className = 'p7-color-input';
    colInput.value = lt.color;
    colInput.setAttribute('aria-label', '光源顏色');
    colInput.addEventListener('input', () => {
      colHexText.textContent = colInput.value.toUpperCase();
      cb.liveMutator.mutateLight(ent.id, { color: colInput.value });
    });
    const commitLight = (partial: Partial<typeof lt>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { light: partial } });
    };
    colInput.addEventListener('change', () => commitLight({ color: colInput.value }));
    colRight.append(colHexText, colInput);
    colRow.append(colLbl, colRight);

    const lightSliders = document.createElement('div');
    lightSliders.className = 'p7-slider-group';
    lightSliders.append(
      createWorkbenchSliderRow(
        '照射半徑 Radius',
        16,
        180,
        4,
        lt.radius,
        (v) => `${Math.round(v)}px`,
        (v) => cb.liveMutator.mutateLight(ent.id, { radius: v }),
        (v) => commitLight({ radius: v }),
      ),
      createWorkbenchSliderRow(
        '光照強度 Intensity',
        0.1,
        2.0,
        0.05,
        lt.intensity ?? 0.9,
        (v) => v.toFixed(2),
        (v) => cb.liveMutator.mutateLight(ent.id, { intensity: v }),
        (v) => commitLight({ intensity: v }),
      ),
    );
    lightSec.append(lightTitle, colRow, lightSliders);
    sections.push(lightSec);
  }

  // Section 4b: CharacterMotor2D Action Physics Inspector
  if (resolved.characterMotor2d) {
    const m = resolved.characterMotor2d;
    const motorSec = document.createElement('div');
    motorSec.className = 'p7-section';
    const motorTitle = document.createElement('h3');
    motorTitle.className = 'p7-section-title';
    motorTitle.textContent = 'CharacterMotor2D 動作馬達';

    const commitMotor = (partial: Partial<typeof m>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { characterMotor2d: partial } });
    };
    const motorSliders = document.createElement('div');
    motorSliders.className = 'p7-slider-group';
    motorSliders.append(
      createWorkbenchSliderRow(
        '重力 Gravity',
        100,
        1600,
        20,
        m.gravity ?? 720,
        (v) => `${Math.round(v)} px/s²`,
        (v) => cb.liveMutator.mutateMotor(ent.id, { gravity: v }),
        (v) => commitMotor({ gravity: v }),
      ),
      createWorkbenchSliderRow(
        '跳躍初速 Jump',
        120,
        560,
        10,
        m.jumpVelocity ?? 290,
        (v) => `${Math.round(v)} px/s`,
        (v) => cb.liveMutator.mutateMotor(ent.id, { jumpVelocity: v }),
        (v) => commitMotor({ jumpVelocity: v }),
      ),
      createWorkbenchSliderRow(
        '移動速度 Speed',
        40,
        360,
        10,
        m.moveSpeed ?? 150,
        (v) => `${Math.round(v)} px/s`,
        (v) => cb.liveMutator.mutateMotor(ent.id, { moveSpeed: v }),
        (v) => commitMotor({ moveSpeed: v }),
      ),
      createWorkbenchSliderRow(
        '土狼時間 Coyote',
        0,
        0.3,
        0.02,
        m.coyoteTimeSec ?? 0.12,
        (v) => `${v.toFixed(2)}s`,
        (v) => cb.liveMutator.mutateMotor(ent.id, { coyoteTimeSec: v }),
        (v) => commitMotor({ coyoteTimeSec: v }),
      ),
      createWorkbenchSliderRow(
        '地面高度 Floor Y',
        0,
        360,
        4,
        m.floorY ?? 224,
        (v) => (v <= 0 ? '視口底部' : `${Math.round(v)}px`),
        (v) => cb.liveMutator.mutateMotor(ent.id, { floorY: v }),
        (v) => commitMotor({ floorY: v }),
      ),
    );
    motorSec.append(motorTitle, motorSliders);
    sections.push(motorSec);
  }

  // Section 4c: GrappleAnchor Inspector
  if (resolved.grappleAnchor) {
    const g = resolved.grappleAnchor;
    const grapSec = document.createElement('div');
    grapSec.className = 'p7-section';
    const grapTitle = document.createElement('h3');
    grapTitle.className = 'p7-section-title';
    grapTitle.textContent = 'GrappleAnchor 鉤索錨點';

    const commitGrapple = (partial: Partial<typeof g>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { grappleAnchor: partial } });
    };
    const grapSliders = document.createElement('div');
    grapSliders.className = 'p7-slider-group';
    grapSliders.append(
      createWorkbenchSliderRow(
        '捕獲半徑 Radius',
        40,
        280,
        10,
        g.anchorRadius ?? 150,
        (v) => `${Math.round(v)}px`,
        (v) => cb.liveMutator.mutateGrapple(ent.id, { anchorRadius: v }),
        (v) => commitGrapple({ anchorRadius: v }),
      ),
      createWorkbenchSliderRow(
        '擺盪張力 Tension',
        0.8,
        1.0,
        0.01,
        g.swingTension ?? 0.98,
        (v) => v.toFixed(2),
        (v) => cb.liveMutator.mutateGrapple(ent.id, { swingTension: v }),
        (v) => commitGrapple({ swingTension: v }),
      ),
      createWorkbenchSliderRow(
        '捲繩速度 Reel',
        20,
        240,
        8,
        g.reelSpeed ?? 96,
        (v) => `${Math.round(v)} px/s`,
        (v) => cb.liveMutator.mutateGrapple(ent.id, { reelSpeed: v }),
        (v) => commitGrapple({ reelSpeed: v }),
      ),
    );
    grapSec.append(grapTitle, grapSliders);
    sections.push(grapSec);
  }

  // Section 4d: TriggerZone Sensor Inspector
  if (resolved.triggerZone) {
    const tz = resolved.triggerZone;
    const tzSec = document.createElement('div');
    tzSec.className = 'p7-section';
    const tzTitle = document.createElement('h3');
    tzTitle.className = 'p7-section-title';
    tzTitle.textContent = 'TriggerZone 互動感測區';

    const commitZone = (partial: Partial<typeof tz>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { triggerZone: partial } });
    };
    const tzGrid = document.createElement('div');
    tzGrid.className = 'p7-prop-grid';

    const shapeWrap = document.createElement('div');
    shapeWrap.className = 'p7-field';
    const shapeLbl = document.createElement('label');
    shapeLbl.textContent = '感測形狀 Shape';
    const shapeSel = document.createElement('select');
    shapeSel.className = 'p7-select p7-mono';
    shapeSel.setAttribute('aria-label', '感測區形狀');
    for (const sh of ['circle', 'rect'] as const) {
      const o = document.createElement('option');
      o.value = sh;
      o.textContent = sh === 'circle' ? '圓形 Circle' : '矩形 Rect';
      shapeSel.appendChild(o);
    }
    shapeSel.value = tz.shape ?? 'circle';
    shapeSel.addEventListener('change', () => commitZone({ shape: shapeSel.value as 'circle' | 'rect' }));
    shapeWrap.append(shapeLbl, shapeSel);

    const makeTextField = (
      label: string,
      value: string,
      placeholder: string,
      onChange: (val: string) => void,
    ): HTMLElement => {
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
    };

    tzGrid.append(
      shapeWrap,
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

    tzSec.append(tzTitle, tzGrid, radSlider, oneShotBtn);
    sections.push(tzSec);
  }

  // Section 4e: VerletChain Rope/Cape Inspector
  if (resolved.verletChain) {
    const vc = resolved.verletChain;
    const vcSec = document.createElement('div');
    vcSec.className = 'p7-section';
    const vcTitle = document.createElement('h3');
    vcTitle.className = 'p7-section-title';
    vcTitle.textContent = 'VerletChain 柔體鍊條';

    const commitVerlet = (partial: Partial<typeof vc>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { verletChain: partial } });
    };
    const vcColRow = document.createElement('div');
    vcColRow.className = 'p7-color-row';
    const vcColLbl = document.createElement('span');
    vcColLbl.textContent = '鍊條色 Color';
    const vcColRight = document.createElement('div');
    vcColRight.className = 'p7-toolbar-group';
    const vcHex = document.createElement('span');
    vcHex.className = 'p7-mono p7-slider-val';
    vcHex.textContent = (vc.color ?? '#f59e0b').toUpperCase();
    const vcColInp = document.createElement('input');
    vcColInp.type = 'color';
    vcColInp.className = 'p7-color-input';
    vcColInp.value = vc.color ?? '#f59e0b';
    vcColInp.setAttribute('aria-label', '鍊條顏色');
    vcColInp.addEventListener('input', () => {
      vcHex.textContent = vcColInp.value.toUpperCase();
      cb.liveMutator.mutateVerlet(ent.id, { color: vcColInp.value });
    });
    vcColInp.addEventListener('change', () => commitVerlet({ color: vcColInp.value }));
    vcColRight.append(vcHex, vcColInp);
    vcColRow.append(vcColLbl, vcColRight);

    const vcSliders = document.createElement('div');
    vcSliders.className = 'p7-slider-group';
    vcSliders.append(
      createWorkbenchSliderRow(
        '節點數量 Nodes',
        2,
        16,
        1,
        vc.nodeCount ?? 6,
        (v) => `${Math.round(v)} 節`,
        (v) => cb.liveMutator.mutateVerlet(ent.id, { nodeCount: v }),
        (v) => commitVerlet({ nodeCount: v }),
      ),
      createWorkbenchSliderRow(
        '節段長度 Segment',
        4,
        28,
        1,
        vc.segmentLength ?? 10,
        (v) => `${Math.round(v)}px`,
        (v) => cb.liveMutator.mutateVerlet(ent.id, { segmentLength: v }),
        (v) => commitVerlet({ segmentLength: v }),
      ),
      createWorkbenchSliderRow(
        '柔體重力 Gravity',
        0,
        1200,
        20,
        vc.gravity ?? 420,
        (v) => `${Math.round(v)}`,
        (v) => cb.liveMutator.mutateVerlet(ent.id, { gravity: v }),
        (v) => commitVerlet({ gravity: v }),
      ),
    );
    vcSec.append(vcTitle, vcColRow, vcSliders);
    sections.push(vcSec);
  }

  // Section 4f: Spatial3D Elevation & Dimension Mask Inspector
  if (resolved.spatial3d) {
    const sp = resolved.spatial3d;
    const spSec = document.createElement('div');
    spSec.className = 'p7-section';
    const spTitle = document.createElement('h3');
    spTitle.className = 'p7-section-title';
    spTitle.textContent = 'Spatial3D 立體高度與維度';

    const commitSpatial = (partial: Partial<typeof sp>) => {
      session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { spatial3d: partial } });
    };
    const realmField = document.createElement('div');
    realmField.className = 'p7-field';
    const realmLbl = document.createElement('label');
    realmLbl.textContent = '所屬維度位面 (Dimension Mask)';
    const realmSel = document.createElement('select');
    realmSel.className = 'p7-select p7-mono';
    realmSel.setAttribute('aria-label', '實體所屬維度位面');
    for (const opt of [
      { v: 1, t: '表世界 [1]' },
      { v: 2, t: '裡世界 [2]' },
      { v: 3, t: '全維度共用 [3]' },
    ]) {
      const o = document.createElement('option');
      o.value = String(opt.v);
      o.textContent = opt.t;
      realmSel.appendChild(o);
    }
    realmSel.value = String(sp.dimensionMask ?? 1);
    realmSel.addEventListener('change', () => {
      const mask = Number(realmSel.value) || 1;
      cb.liveMutator.mutateSpatial3D(ent.id, { dimensionMask: mask });
      commitSpatial({ dimensionMask: mask });
    });
    realmField.append(realmLbl, realmSel);

    const spSliders = document.createElement('div');
    spSliders.className = 'p7-slider-group';
    spSliders.append(
      createWorkbenchSliderRow(
        '海拔高度 Z',
        0,
        120,
        2,
        sp.z ?? 0,
        (v) => `${Math.round(v)}px`,
        (v) => cb.liveMutator.mutateSpatial3D(ent.id, { z: v }),
        (v) => commitSpatial({ z: v }),
      ),
      createWorkbenchSliderRow(
        '垂直厚度 Height',
        4,
        64,
        2,
        sp.height ?? 16,
        (v) => `${Math.round(v)}px`,
        (v) => cb.liveMutator.mutateSpatial3D(ent.id, { height: v }),
        (v) => commitSpatial({ height: v }),
      ),
      createWorkbenchSliderRow(
        'Z 軸重力 GravityZ',
        0,
        1200,
        20,
        sp.gravityZ ?? 0,
        (v) => (v <= 0 ? '懸浮 (0)' : `${Math.round(v)} px/s²`),
        (v) => cb.liveMutator.mutateSpatial3D(ent.id, { gravityZ: v }),
        (v) => commitSpatial({ gravityZ: v }),
      ),
      createWorkbenchSliderRow(
        'Z 跳躍初速 JumpZ',
        0,
        420,
        10,
        sp.jumpZVelocity ?? 190,
        (v) => `${Math.round(v)} px/s`,
        (v) => cb.liveMutator.mutateSpatial3D(ent.id, { jumpZVelocity: v }),
        (v) => commitSpatial({ jumpZVelocity: v }),
      ),
    );
    spSec.append(spTitle, realmField, spSliders);
    sections.push(spSec);
  }

  // Section 5: Sandboxed Script VM Rules
  const scrSec = document.createElement('div');
  scrSec.className = 'p7-section';
  const scrTitle = document.createElement('h3');
  scrTitle.className = 'p7-section-title';
  scrTitle.textContent = '沙盒腳本虛擬機規則';
  scrSec.appendChild(scrTitle);

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
