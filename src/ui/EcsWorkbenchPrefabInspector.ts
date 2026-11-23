import type { SpriteId } from '../assets/TextureAtlas.ts';
import {
  countEntityOverrides,
  getEntityPrefabId,
  type EcsPrefabDef,
  type EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsAttachableComponent, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';

export interface PrefabComponentCatalogItem {
  key: EcsAttachableComponent;
  label: string;
  createDefault: () => unknown;
}

export interface PrefabInspectorHostCallbacks {
  componentCatalog: readonly PrefabComponentCatalogItem[];
  spriteOptions: readonly { id: SpriteId; label: string }[];
  createSliderRow: (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    format: (v: number) => string,
    onLiveInput: (v: number) => void,
    onCommit: (v: number) => void,
  ) => HTMLElement;
  onBackToEntity: () => void;
  onInstantiatePrefab: (prefabId: string) => void;
  onSelectInstance: (entityId: string) => void;
  onMutateLiveMaterial: (prefabId: string, patch: { metallic?: number; roughness?: number; emissive?: number }) => void;
  onMutateLiveLight: (prefabId: string, patch: { color?: string; radius?: number; intensity?: number }) => void;
}

/**
 * Modular Prefab Template Inspector extracted from `EcsWorkbenchView.ts`.
 * Supports transactional component attach/detach, live PBR material & light propagation,
 * and linked instance inspection.
 */
export function renderPrefabInspectorPanel(
  rightTitleEl: HTMLElement,
  rightContentEl: HTMLElement,
  proj: EcsProjectV2,
  prefab: EcsPrefabDef,
  session: EcsStudioSession,
  cb: PrefabInspectorHostCallbacks,
): void {
  rightTitleEl.textContent = `Prefab 模板：${prefab.name}`;
  const instCount = session.getPrefabInstanceCount(prefab.id);

  // Header Section
  const headSec = document.createElement('div');
  headSec.className = 'p7-section';

  const topRow = document.createElement('div');
  topRow.className = 'p7-section-head';
  const titleEl = document.createElement('h3');
  titleEl.className = 'p7-section-title';
  titleEl.textContent = `模板 ID：${prefab.id}`;
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'p7-btn p7-btn-xs';
  backBtn.textContent = '返回實體';
  backBtn.addEventListener('click', () => cb.onBackToEntity());
  topRow.append(titleEl, backBtn);

  const syncMeta = document.createElement('div');
  syncMeta.className = 'p7-meta-line p7-mono';
  syncMeta.textContent = `同步連結 ${instCount} 個實例 · 修改模板屬性將自動傳播至所有未覆寫實例`;

  const nameField = document.createElement('div');
  nameField.className = 'p7-field';
  const nameLbl = document.createElement('label');
  nameLbl.textContent = '模板顯示名稱';
  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.className = 'p7-input';
  nameInp.value = prefab.name;
  nameInp.setAttribute('aria-label', '模板顯示名稱');
  nameInp.addEventListener('change', () => {
    if (nameInp.value.trim()) {
      session.dispatch({ type: 'update_prefab', prefabId: prefab.id, name: nameInp.value.trim() });
    }
  });
  nameField.append(nameLbl, nameInp);

  const actRow = document.createElement('div');
  actRow.className = 'p7-prefab-actions';
  const spawnBtn = document.createElement('button');
  spawnBtn.type = 'button';
  spawnBtn.className = 'p7-btn p7-btn-accent';
  spawnBtn.textContent = '+ 立即生成實例';
  spawnBtn.addEventListener('click', () => cb.onInstantiatePrefab(prefab.id));
  actRow.appendChild(spawnBtn);

  headSec.append(topRow, syncMeta, nameField, actRow);

  // Component Attach / Detach on Prefab
  const compSec = document.createElement('div');
  compSec.className = 'p7-section';
  const compTitle = document.createElement('h3');
  compTitle.className = 'p7-section-title';
  compTitle.textContent = '模板元件插槽';
  const compList = document.createElement('div');
  compList.className = 'p7-comp-list';

  const compRec = prefab.components as unknown as Record<string, unknown>;
  const unmounted: PrefabComponentCatalogItem[] = [];
  for (const def of cb.componentCatalog) {
    if (compRec[def.key] !== undefined) {
      const row = document.createElement('div');
      row.className = 'p7-comp-row';
      const nm = document.createElement('span');
      nm.className = 'p7-comp-name';
      nm.textContent = def.label;
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
      rmBtn.textContent = '移除';
      rmBtn.addEventListener('click', () => {
        session.dispatch({ type: 'update_prefab', prefabId: prefab.id, detachComponent: def.key });
      });
      row.append(nm, rmBtn);
      compList.appendChild(row);
    } else {
      unmounted.push(def);
    }
  }
  compSec.append(compTitle, compList);
  if (unmounted.length > 0) {
    const attachBar = document.createElement('div');
    attachBar.className = 'p7-attach-bar';
    const sel = document.createElement('select');
    sel.className = 'p7-select';
    sel.setAttribute('aria-label', '選擇要掛載至模板的元件');
    for (const def of unmounted) {
      const opt = document.createElement('option');
      opt.value = def.key;
      opt.textContent = def.label;
      sel.appendChild(opt);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p7-btn p7-btn-accent';
    addBtn.textContent = '+ 掛載至模板';
    addBtn.addEventListener('click', () => {
      const chosen = unmounted.find((u) => u.key === sel.value) ?? unmounted[0];
      if (!chosen) return;
      session.dispatch({
        type: 'update_prefab',
        prefabId: prefab.id,
        attachComponent: { component: chosen.key, value: chosen.createDefault() },
      });
    });
    attachBar.append(sel, addBtn);
    compSec.appendChild(attachBar);
  }

  const sections: HTMLElement[] = [headSec, compSec];

  // Prefab PBR Material Inspector
  if (prefab.components.sprite) {
    const sp = prefab.components.sprite;
    const matSec = document.createElement('div');
    matSec.className = 'p7-section';
    const matTitle = document.createElement('h3');
    matTitle.className = 'p7-section-title';
    matTitle.textContent = '模板 PBR 材質（同步傳播）';

    const sprField = document.createElement('div');
    sprField.className = 'p7-field';
    const sprLbl = document.createElement('label');
    sprLbl.textContent = '模板精靈資產';
    const sprSel = document.createElement('select');
    sprSel.className = 'p7-select p7-mono';
    sprSel.setAttribute('aria-label', '模板精靈紋理選擇');
    const seen = new Set<string>();
    for (const cs of Object.values(proj.customSprites ?? {})) {
      seen.add(cs.id);
      const o = document.createElement('option');
      o.value = cs.id;
      o.textContent = `[自訂] ${cs.name || cs.id} (${cs.width}×${cs.height})`;
      sprSel.appendChild(o);
    }
    for (const opt of cb.spriteOptions) {
      if (seen.has(opt.id)) continue;
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
    sprSel.value = sp.sprite;
    sprSel.addEventListener('change', () => {
      session.dispatch({
        type: 'update_prefab',
        prefabId: prefab.id,
        patch: { sprite: { sprite: sprSel.value as SpriteId } },
      });
    });
    sprField.append(sprLbl, sprSel);

    const sliders = document.createElement('div');
    sliders.className = 'p7-slider-group';
    sliders.append(
      cb.createSliderRow(
        '模板金屬度 Metallic',
        0,
        1,
        0.05,
        sp.metallic ?? 0.25,
        (v) => v.toFixed(2),
        (v) => cb.onMutateLiveMaterial(prefab.id, { metallic: v }),
        (v) => session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { metallic: v } } }),
      ),
      cb.createSliderRow(
        '模板粗糙度 Roughness',
        0.05,
        1,
        0.05,
        sp.roughness ?? 0.42,
        (v) => v.toFixed(2),
        (v) => cb.onMutateLiveMaterial(prefab.id, { roughness: v }),
        (v) => session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { roughness: v } } }),
      ),
      cb.createSliderRow(
        '模板自發光 Emissive',
        0,
        1.5,
        0.05,
        sp.emissive ?? 0,
        (v) => v.toFixed(2),
        (v) => cb.onMutateLiveMaterial(prefab.id, { emissive: v }),
        (v) => session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { emissive: v } } }),
      ),
    );
    matSec.append(matTitle, sprField, sliders);
    sections.push(matSec);
  }

  // Prefab Light Inspector
  if (prefab.components.light) {
    const lt = prefab.components.light;
    const lightSec = document.createElement('div');
    lightSec.className = 'p7-section';
    const lightTitle = document.createElement('h3');
    lightTitle.className = 'p7-section-title';
    lightTitle.textContent = '模板動態光源（同步傳播）';

    const colRow = document.createElement('div');
    colRow.className = 'p7-color-row';
    const colLbl = document.createElement('span');
    colLbl.textContent = '模板光色 Color';
    const colRight = document.createElement('div');
    colRight.className = 'p7-toolbar-group';
    const colHexText = document.createElement('span');
    colHexText.className = 'p7-mono p7-slider-val';
    colHexText.textContent = lt.color.toUpperCase();
    const colInput = document.createElement('input');
    colInput.type = 'color';
    colInput.className = 'p7-color-input';
    colInput.value = lt.color;
    colInput.setAttribute('aria-label', '模板光源顏色');
    colInput.addEventListener('input', () => {
      colHexText.textContent = colInput.value.toUpperCase();
      cb.onMutateLiveLight(prefab.id, { color: colInput.value });
    });
    colInput.addEventListener('change', () => {
      session.dispatch({
        type: 'update_prefab',
        prefabId: prefab.id,
        patch: { light: { color: colInput.value } },
      });
    });
    colRight.append(colHexText, colInput);
    colRow.append(colLbl, colRight);

    const lightSliders = document.createElement('div');
    lightSliders.className = 'p7-slider-group';
    lightSliders.append(
      cb.createSliderRow(
        '模板照射半徑 Radius',
        16,
        180,
        4,
        lt.radius,
        (v) => `${Math.round(v)}px`,
        (v) => cb.onMutateLiveLight(prefab.id, { radius: v }),
        (v) => session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { light: { radius: v } } }),
      ),
      cb.createSliderRow(
        '模板光照強度 Intensity',
        0.1,
        2.0,
        0.05,
        lt.intensity ?? 0.9,
        (v) => v.toFixed(2),
        (v) => cb.onMutateLiveLight(prefab.id, { intensity: v }),
        (v) => session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { light: { intensity: v } } }),
      ),
    );
    lightSec.append(lightTitle, colRow, lightSliders);
    sections.push(lightSec);
  }

  // Linked Instances List
  const linked = proj.entities.filter((e) => getEntityPrefabId(e) === prefab.id);
  const linkSec = document.createElement('div');
  linkSec.className = 'p7-section';
  const linkTitle = document.createElement('h3');
  linkTitle.className = 'p7-section-title';
  linkTitle.textContent = `已連結實例清單 (${linked.length})`;
  linkSec.appendChild(linkTitle);
  if (linked.length === 0) {
    const note = document.createElement('p');
    note.className = 'p7-empty-note';
    note.textContent = '目前尚無場景實例連結至此模板，可點擊上方「+ 立即生成實例」。';
    linkSec.appendChild(note);
  } else {
    for (const inst of linked) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'p7-entity-row';
      const nm = document.createElement('span');
      nm.className = 'p7-entity-name';
      nm.textContent = inst.name;
      const meta = document.createElement('span');
      meta.className = 'p7-meta-line p7-mono';
      const ov = countEntityOverrides(inst);
      meta.textContent = `${inst.id} · ${ov} 項覆寫`;
      btn.append(nm, meta);
      btn.addEventListener('click', () => cb.onSelectInstance(inst.id));
      linkSec.appendChild(btn);
    }
  }
  sections.push(linkSec);

  rightContentEl.append(...sections);
}
