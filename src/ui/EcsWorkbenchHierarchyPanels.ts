import {
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsEntityInitDef,
  type EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';

export interface PrefabsPaneState {
  selectedEntityId: string | null;
  selectedPrefabId: string | null;
  filterQuery: string;
}

export interface PrefabsPaneCallbacks {
  onFilterChange: (nextQuery: string) => void;
  onSaveEntityAsPrefab: (entityId: string, customName: string) => void;
  onInstantiatePrefab: (prefabId: string) => void;
  onSelectPrefab: (prefabId: string) => void;
}

export interface HierarchyPaneState {
  selectedEntityId: string | null;
  selectedEntityIds?: readonly string[];
  selectedPrefabId: string | null;
  filterQuery: string;
}

export interface HierarchyPaneCallbacks {
  onFilterChange: (nextQuery: string) => void;
  onInstantiatePrefab: (prefabId: string) => void;
  onSelectEntity: (entityId: string) => void;
  onToggleSelectEntity?: (entityId: string) => void;
}

/**
 * Renders the Prefab Library tab in the left pane.
 * Updates only the filtered list container on search input so text cursor focus stays intact.
 */
export function renderPrefabsPane(
  container: HTMLElement,
  proj: EcsProjectV2,
  session: EcsStudioSession,
  state: PrefabsPaneState,
  cb: PrefabsPaneCallbacks,
): void {
  const summaries = session.listPrefabs();
  const selectedEnt = proj.entities.find((e) => e.id === state.selectedEntityId);

  const saveSec = document.createElement('div');
  saveSec.className = 'p7-section';
  const saveTitle = document.createElement('h3');
  saveTitle.className = 'p7-section-title';
  saveTitle.textContent = '從目前實體建立 Prefab';

  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.className = 'p7-input';
  nameInp.placeholder = selectedEnt ? `${selectedEnt.name} 模板` : '請先於階層選取實體';
  nameInp.setAttribute('aria-label', '新 Prefab 模板名稱');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'p7-btn p7-btn-accent';
  saveBtn.disabled = !selectedEnt;
  saveBtn.textContent = '+ 將目前實體存為 Prefab';
  saveBtn.title = selectedEnt ? `將「${selectedEnt.name}」存為 Prefab` : '請先於階層選取實體';
  saveBtn.addEventListener('click', () => {
    if (!selectedEnt) return;
    cb.onSaveEntityAsPrefab(selectedEnt.id, nameInp.value);
  });
  saveSec.append(saveTitle, nameInp, saveBtn);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'p7-input';
  search.placeholder = '篩選 Prefab 模板...';
  search.value = state.filterQuery;
  search.setAttribute('aria-label', '篩選 Prefab 模板');

  const list = document.createElement('div');
  list.className = 'p7-prefab-list';

  const populateList = (query: string) => {
    list.textContent = '';
    const filtered = summaries.filter((p) => {
      if (!query) return true;
      return (
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '尚無符合條件的 Prefab 模板。';
      list.appendChild(empty);
      return;
    }

    for (const pref of filtered) {
      const card = document.createElement('div');
      card.className = 'p7-prefab-card';
      if (state.selectedPrefabId === pref.id) card.classList.add('is-selected');

      const nm = document.createElement('span');
      nm.className = 'p7-entity-name';
      nm.textContent = pref.name;

      const meta = document.createElement('span');
      meta.className = 'p7-meta-line p7-mono';
      meta.textContent = `${pref.id} · ${pref.instanceCount} 實例 · ${pref.componentKeys.length} 元件`;

      const actions = document.createElement('div');
      actions.className = 'p7-prefab-actions';

      const spawnBtn = document.createElement('button');
      spawnBtn.type = 'button';
      spawnBtn.className = 'p7-btn p7-btn-accent p7-btn-xs';
      spawnBtn.textContent = '+ 生成實例';
      spawnBtn.setAttribute('aria-label', `生成 ${pref.name} 實例`);
      spawnBtn.addEventListener('click', () => cb.onInstantiatePrefab(pref.id));

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = state.selectedPrefabId === pref.id ? 'p7-btn p7-btn-xs p7-btn-accent' : 'p7-btn p7-btn-xs';
      editBtn.textContent = '編輯模板';
      editBtn.setAttribute('aria-label', `編輯 ${pref.name} 模板`);
      editBtn.addEventListener('click', () => cb.onSelectPrefab(pref.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
      delBtn.textContent = '刪除';
      delBtn.setAttribute('aria-label', `刪除 ${pref.name} 模板`);
      delBtn.addEventListener('click', () => {
        session.dispatch({ type: 'delete_prefab', prefabId: pref.id, mode: 'unlink' });
      });

      actions.append(spawnBtn, editBtn, delBtn);
      card.append(nm, meta, actions);
      list.appendChild(card);
    }
  };

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    cb.onFilterChange(q);
    populateList(q);
  });

  populateList(state.filterQuery);
  container.append(saveSec, search, list);
}

/**
 * Renders the Entity Hierarchy Tree tab in the left pane.
 * Updates only the entity list container on search input (preventing duplicate inputs and preserving focus).
 */
export function renderHierarchyPane(
  container: HTMLElement,
  proj: EcsProjectV2,
  session: EcsStudioSession,
  state: HierarchyPaneState,
  cb: HierarchyPaneCallbacks,
): void {
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'p7-input';
  search.placeholder = '篩選實體或標籤...';
  search.value = state.filterQuery;

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'p7-btn';
  addBtn.textContent = proj.prefabs.solar_turret
    ? '+ 新增自律星軌砲塔'
    : proj.prefabs.rift_crystal
      ? '+ 新增星界裂隙結晶'
      : '+ 新增場景實體';
  addBtn.addEventListener('click', () => {
    if (proj.prefabs.solar_turret) {
      cb.onInstantiatePrefab('solar_turret');
      return;
    }
    if (proj.prefabs.rift_crystal) {
      cb.onInstantiatePrefab('rift_crystal');
      return;
    }
    const idx = proj.entities.length + 1;
    const newEnt: EcsEntityInitDef = {
      id: `turret_custom_${idx}`,
      name: `星軌砲塔 #${idx}`,
      components: {
        transform: { x: 180 + ((idx * 53) % 280), y: 112 + ((idx * 29) % 80), w: 34, h: 34, zOrder: 3 },
        sprite: {
          sprite: 'hd_turret_solar',
          tint: '#ffffff',
          castShadow: true,
          metallic: 0.85,
          roughness: 0.18,
          emissive: 0.25,
        },
        light: { radius: 76, color: '#f59e0b', intensity: 0.9 },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    };
    const res = session.dispatch({ type: 'spawn_entity', entity: newEnt });
    if (res.ok) {
      cb.onSelectEntity(newEnt.id);
    }
  });

  const list = document.createElement('div');
  list.className = 'p7-entity-list';

  const populateList = (query: string) => {
    list.textContent = '';
    const filtered = proj.entities.filter((e) => {
      if (!query) return true;
      const resolved = resolveEntityComponents(e, proj.prefabs);
      const pid = getEntityPrefabId(e) ?? '';
      return (
        e.name.toLowerCase().includes(query) ||
        e.id.toLowerCase().includes(query) ||
        pid.toLowerCase().includes(query) ||
        (resolved.tag ?? '').toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '目前沒有符合條件的實體，可點擊上方按鈕新增。';
      list.appendChild(empty);
      return;
    }

    const selectedSet = new Set(
      state.selectedEntityIds && state.selectedEntityIds.length > 0
        ? state.selectedEntityIds
        : state.selectedEntityId
          ? [state.selectedEntityId]
          : [],
    );

    for (const ent of filtered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'p7-entity-row';
      if (!state.selectedPrefabId && selectedSet.has(ent.id)) row.classList.add('is-selected');

      const resolved = resolveEntityComponents(ent, proj.prefabs);
      const pid = getEntityPrefabId(ent);

      const nameEl = document.createElement('span');
      nameEl.className = 'p7-entity-name';
      nameEl.textContent = ent.name;

      const meta = document.createElement('span');
      meta.className = 'p7-meta-line p7-mono';
      const compCount = Object.keys(resolved).length;
      meta.textContent = pid
        ? `Prefab:${pid} · ${compCount} 元件`
        : `${resolved.tag || 'entity'} · ${compCount} 元件`;

      row.append(nameEl, meta);
      row.addEventListener('click', (ev) => {
        if ((ev.shiftKey || ev.ctrlKey || ev.metaKey) && cb.onToggleSelectEntity) {
          cb.onToggleSelectEntity(ent.id);
        } else {
          cb.onSelectEntity(ent.id);
        }
      });
      list.appendChild(row);
    }
  };

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    cb.onFilterChange(q);
    populateList(q);
  });

  populateList(state.filterQuery);
  container.append(search, addBtn, list);
}
