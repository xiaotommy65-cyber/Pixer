import type { SpriteId } from '../assets/TextureAtlas.ts';
import { analyzeWorldMapReachability } from '../core/ai/EcsSpatialOracle.ts';
import type { EcsHudGaugeDef, EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type {
  EcsMapInteractionRule,
  EcsMapPortalDef,
  EcsTopDownAiProfile,
  EcsTopDownHeroConfig,
} from '../core/ecs/EcsTilemapTypes.ts';

export type WorldRulesSubTab = 'portals' | 'interactions' | 'ai' | 'hero_hud';

export interface WorldRulesInspectorCallbacks {
  onFocusRoom: (roomId: string) => void;
  getSpriteOptions: (proj: EcsProjectV2) => { id: SpriteId; label: string }[];
}

/**
 * Pure Data-Driven M2 Visual World Rules Inspector Panel:
 * Visually edits `portals`, `interactions`, `aiProfiles`, `heroConfig`, and `hud[]`
 * exclusively through transactional `EcsStudioSession` commands (full Undo/Redo parity
 * with AI MCP tools) with live BFS multi-room soft-lock diagnostics.
 *
 * Strictly zero game-specific hardcoding.
 */
export class EcsWorldRulesInspectorPanel {
  private readonly ac = new AbortController();
  private renderAc = new AbortController();
  private subTab: WorldRulesSubTab = 'portals';
  private readonly callbacks: WorldRulesInspectorCallbacks;

  constructor(callbacks: WorldRulesInspectorCallbacks) {
    this.callbacks = callbacks;
  }

  public getSubTab(): WorldRulesSubTab {
    return this.subTab;
  }

  public setSubTab(tab: WorldRulesSubTab): void {
    this.subTab = tab;
  }

  public renderInto(
    container: HTMLElement,
    proj: EcsProjectV2,
    session: EcsStudioSession,
    activeRoomId: string,
  ): void {
    this.renderAc.abort();
    this.renderAc = new AbortController();
    const { signal } = this.renderAc;

    container.textContent = '';

    const wm = proj.worldMap;
    if (!wm || wm.rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'p7-empty-hint';
      empty.textContent = '目前專案尚未建立多房間地圖。請先切到「地圖」分頁初始化地圖，或透過下方按鈕建立。';
      const initBtn = document.createElement('button');
      initBtn.type = 'button';
      initBtn.className = 'p7-btn p7-btn-xs';
      initBtn.textContent = '＋ 初始化多房間世界';
      initBtn.addEventListener(
        'click',
        () => {
          session.dispatch({ type: 'ensure_world_map', cols: 24, rows: 16, roomName: '起始房間' });
        },
        { signal },
      );
      container.append(empty, initBtn);
      return;
    }

    // 1. Live Multi-Room BFS Soft-Lock Oracle Banner
    const reach = analyzeWorldMapReachability(proj);
    const diagBox = document.createElement('div');
    diagBox.className = reach.pass ? 'p7-rules-diag is-ok' : 'p7-rules-diag is-warn';
    const diagHead = document.createElement('div');
    diagHead.className = 'p7-rules-diag-title';
    diagHead.textContent = reach.pass
      ? `✅ 空間預言機：可達 ${reach.reachableRoomIds.length}/${wm.rooms.length} 房間・0 軟鎖風險`
      : `⚠️ 空間預言機：偵測到 ${reach.softLockRisks.length} 項潛在軟鎖`;
    diagBox.appendChild(diagHead);
    if (!reach.pass && reach.softLockRisks.length > 0) {
      const riskList = document.createElement('div');
      riskList.className = 'p7-rules-diag-list';
      for (const risk of reach.softLockRisks.slice(0, 3)) {
        const line = document.createElement('div');
        line.textContent = `• ${risk}`;
        riskList.appendChild(line);
      }
      diagBox.appendChild(riskList);
    }
    container.appendChild(diagBox);

    // 2. Sub-tab switcher
    const tabBar = document.createElement('div');
    tabBar.className = 'p7-seg-tabs p7-rules-subtabs';
    const tabs: { id: WorldRulesSubTab; label: string }[] = [
      { id: 'portals', label: `傳送門 (${wm.portals.length})` },
      { id: 'interactions', label: `機關 (${wm.interactions?.length ?? 0})` },
      { id: 'ai', label: `AI (${Object.keys(wm.aiProfiles ?? {}).length})` },
      { id: 'hero_hud', label: `主角/HUD (${proj.hud.length})` },
    ];
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = this.subTab === t.id ? 'p7-seg-btn is-active' : 'p7-seg-btn';
      b.textContent = t.label;
      b.addEventListener(
        'click',
        () => {
          this.subTab = t.id;
          this.renderInto(container, session.getProject(), session, activeRoomId);
        },
        { signal },
      );
      tabBar.appendChild(b);
    }
    container.appendChild(tabBar);

    const body = document.createElement('div');
    body.className = 'p7-rules-body';
    container.appendChild(body);

    if (this.subTab === 'portals') {
      this.renderPortalsTab(body, proj, session, activeRoomId, signal);
    } else if (this.subTab === 'interactions') {
      this.renderInteractionsTab(body, proj, session, signal);
    } else if (this.subTab === 'ai') {
      this.renderAiProfilesTab(body, proj, session, signal);
    } else {
      this.renderHeroAndHudTab(body, proj, session, signal);
    }
  }

  private renderPortalsTab(
    body: HTMLElement,
    proj: EcsProjectV2,
    session: EcsStudioSession,
    activeRoomId: string,
    signal: AbortSignal,
  ): void {
    const wm = proj.worldMap!;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p7-btn p7-btn-xs';
    addBtn.textContent = '＋ 新增傳送門';
    addBtn.addEventListener(
      'click',
      () => {
        const fromId = activeRoomId || wm.rooms[0].id;
        const targetRoom = wm.rooms.find((r) => r.id !== fromId) ?? wm.rooms[0];
        const nextId = `portal_${Date.now().toString(36).slice(-4)}`;
        const portal: EcsMapPortalDef = {
          id: nextId,
          name: `傳送門 ${wm.portals.length + 1}`,
          fromRoomId: fromId,
          col: 2,
          row: 2,
          cols: 2,
          rows: 1,
          toRoomId: targetRoom.id,
          targetX: wm.tileSize * 4,
          targetY: wm.tileSize * 4,
        };
        session.dispatch({ type: 'upsert_portal', portal });
      },
      { signal },
    );
    body.appendChild(addBtn);

    if (wm.portals.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'p7-meta-line';
      empty.textContent = '尚無跨房傳送門，點擊上方按鈕建立。';
      body.appendChild(empty);
      return;
    }

    const roomOpts = wm.rooms.map((r) => ({ id: r.id, label: `${r.name} (${r.id})` }));
    for (const p of wm.portals) {
      const card = document.createElement('div');
      card.className = 'p7-rule-card';

      const head = document.createElement('div');
      head.className = 'p7-rule-card-head';
      const title = document.createElement('strong');
      title.className = 'p7-mono';
      title.textContent = `${p.name} [${p.id}]`;

      const actions = document.createElement('div');
      actions.className = 'p7-rule-card-actions';
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'p7-btn p7-btn-xs';
      jumpBtn.textContent = '定位';
      jumpBtn.addEventListener('click', () => this.callbacks.onFocusRoom(p.fromRoomId), { signal });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p7-btn p7-btn-xs p7-btn-danger';
      delBtn.textContent = '刪除';
      delBtn.addEventListener(
        'click',
        () => session.dispatch({ type: 'remove_portal', portalId: p.id }),
        { signal },
      );
      actions.append(jumpBtn, delBtn);
      head.append(title, actions);
      card.appendChild(head);

      const commit = (patch: Partial<EcsMapPortalDef>) => {
        session.dispatch({ type: 'upsert_portal', portal: { ...p, ...patch } });
      };

      card.append(
        this.makeSelectField('來源房間', p.fromRoomId, roomOpts, (v) => commit({ fromRoomId: v }), signal),
        this.makeSelectField('目標房間', p.toRoomId, roomOpts, (v) => commit({ toRoomId: v }), signal),
        this.makeNumPairField(
          '觸發格 (col, row)',
          p.col,
          p.row,
          (col, row) => commit({ col: Math.max(0, Math.round(col)), row: Math.max(0, Math.round(row)) }),
          signal,
        ),
        this.makeNumPairField(
          '門寬高 (cols, rows)',
          p.cols,
          p.rows,
          (cols, rows) => commit({ cols: Math.max(1, Math.round(cols)), rows: Math.max(1, Math.round(rows)) }),
          signal,
        ),
        this.makeNumPairField(
          '落地像素 (X, Y)',
          p.targetX,
          p.targetY,
          (targetX, targetY) => commit({ targetX, targetY }),
          signal,
        ),
        this.makeTextField(
          '解鎖全域旗標',
          p.requiresGlobal ?? '',
          '留空表示不鎖門',
          (v) => commit({ requiresGlobal: v.trim() || undefined }),
          signal,
        ),
        this.makeTextField(
          '鎖門提示文字',
          p.lockedHint ?? '',
          '未解鎖時顯示提示',
          (v) => commit({ lockedHint: v.trim() || undefined }),
          signal,
        ),
      );
      body.appendChild(card);
    }
  }

  private renderInteractionsTab(
    body: HTMLElement,
    proj: EcsProjectV2,
    session: EcsStudioSession,
    signal: AbortSignal,
  ): void {
    const wm = proj.worldMap!;
    const rules = wm.interactions ?? [];
    const spriteOpts = [{ id: '' as SpriteId, label: '(不替換貼圖)' }, ...this.callbacks.getSpriteOptions(proj)];

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p7-btn p7-btn-xs';
    addBtn.textContent = '＋ 新增互動機關規則';
    addBtn.addEventListener(
      'click',
      () => {
        const tag = `prop_${rules.length + 1}`;
        const rule: EcsMapInteractionRule = {
          tag,
          trigger: 'slash_or_touch',
          radius: 34,
          oneShot: true,
          scoreDelta: 100,
          popupText: '機關已啟動',
          popupColor: '#fde047',
        };
        session.dispatch({ type: 'upsert_interaction_rule', rule });
      },
      { signal },
    );
    body.appendChild(addBtn);

    if (rules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'p7-meta-line';
      empty.textContent = '尚無互動機關規則，點擊上方按鈕建立。';
      body.appendChild(empty);
      return;
    }

    for (const r of rules) {
      const card = document.createElement('div');
      card.className = 'p7-rule-card';

      const head = document.createElement('div');
      head.className = 'p7-rule-card-head';
      const title = document.createElement('strong');
      title.className = 'p7-mono';
      title.textContent = `tag: ${r.tag}`;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p7-btn p7-btn-xs p7-btn-danger';
      delBtn.textContent = '刪除';
      delBtn.addEventListener(
        'click',
        () => session.dispatch({ type: 'remove_interaction_rule', tag: r.tag }),
        { signal },
      );
      head.append(title, delBtn);
      card.appendChild(head);

      const commit = (patch: Partial<EcsMapInteractionRule>) => {
        session.dispatch({ type: 'upsert_interaction_rule', rule: { ...r, ...patch } });
      };

      card.append(
        this.makeSelectField(
          '觸發方式',
          r.trigger,
          [
            { id: 'touch', label: '接觸觸發 (touch)' },
            { id: 'slash_or_touch', label: '揮擊或接觸 (slash_or_touch)' },
          ],
          (v) => commit({ trigger: v === 'touch' ? 'touch' : 'slash_or_touch' }),
          signal,
        ),
        this.makeNumPairField(
          '半徑 / 得分',
          r.radius,
          r.scoreDelta ?? 0,
          (radius, scoreDelta) => commit({ radius: Math.max(8, radius), scoreDelta }),
          signal,
        ),
        this.makeNumPairField(
          '回血量 / 門檻數',
          r.healAmount ?? 0,
          r.thresholdCount ?? 0,
          (healAmount, thresholdCount) =>
            commit({
              healAmount: healAmount > 0 ? healAmount : undefined,
              thresholdCount: thresholdCount > 0 ? thresholdCount : undefined,
            }),
          signal,
        ),
        this.makeSelectField(
          '啟動後替換貼圖',
          r.swapSprite ?? '',
          spriteOpts,
          (v) => commit({ swapSprite: (v || undefined) as SpriteId | undefined }),
          signal,
        ),
        this.makeTextField(
          '設定全域變數 (setGlobal)',
          r.setGlobal ?? '',
          '例如 key_obtained',
          (v) => commit({ setGlobal: v.trim() || undefined, setGlobalValue: v.trim() ? (r.setGlobalValue ?? 1) : undefined }),
          signal,
        ),
        this.makeTextField(
          '累加全域變數 (addGlobal)',
          r.addGlobal ?? '',
          '例如 counter_a',
          (v) => commit({ addGlobal: v.trim() || undefined, addGlobalDelta: v.trim() ? (r.addGlobalDelta ?? 1) : undefined }),
          signal,
        ),
        this.makeTextField(
          '達標解鎖旗標',
          r.thresholdUnlockGlobal ?? '',
          '達門檻時設為 1 的變數',
          (v) => commit({ thresholdUnlockGlobal: v.trim() || undefined }),
          signal,
        ),
        this.makeTextField(
          '彈出提示文字',
          r.popupText ?? '',
          '互動時飄字提示',
          (v) => commit({ popupText: v.trim() || undefined }),
          signal,
        ),
        this.makeToggleRow(
          '單次觸發 (oneShot)',
          r.oneShot,
          (oneShot) => commit({ oneShot }),
          signal,
        ),
      );
      body.appendChild(card);
    }
  }

  private renderAiProfilesTab(
    body: HTMLElement,
    proj: EcsProjectV2,
    session: EcsStudioSession,
    signal: AbortSignal,
  ): void {
    const wm = proj.worldMap!;
    const profiles = wm.aiProfiles ?? {};
    const entries = Object.entries(profiles);
    const prefabOpts = [
      { id: '', label: '(無彈幕發射)' },
      ...Object.values(proj.prefabs).map((pf) => ({ id: pf.id, label: `${pf.name} (${pf.id})` })),
    ];

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p7-btn p7-btn-xs';
    addBtn.textContent = '＋ 新增敵人 / 魔王 AI';
    addBtn.addEventListener(
      'click',
      () => {
        const tag = `foe_${entries.length + 1}`;
        const profile: EcsTopDownAiProfile = {
          chaseRange: 180,
          stopRange: 24,
          moveSpeed: 54,
          contactDamage: 1,
          contactRange: 24,
          scoreOnDefeat: 250,
          knockback: 18,
        };
        session.dispatch({ type: 'upsert_ai_profile', tag, profile });
      },
      { signal },
    );
    body.appendChild(addBtn);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'p7-meta-line';
      empty.textContent = '尚無敵人或魔王 AI 設定檔，點擊上方按鈕建立。';
      body.appendChild(empty);
      return;
    }

    for (const [tag, prof] of entries) {
      const card = document.createElement('div');
      card.className = 'p7-rule-card';

      const head = document.createElement('div');
      head.className = 'p7-rule-card-head';
      const title = document.createElement('strong');
      title.className = 'p7-mono';
      title.textContent = prof.isBoss ? `👑 BOSS tag: ${tag}` : `tag: ${tag}`;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'p7-btn p7-btn-xs p7-btn-danger';
      delBtn.textContent = '刪除';
      delBtn.addEventListener(
        'click',
        () => session.dispatch({ type: 'remove_ai_profile', tag }),
        { signal },
      );
      head.append(title, delBtn);
      card.appendChild(head);

      const commit = (patch: Partial<EcsTopDownAiProfile>) => {
        session.dispatch({ type: 'upsert_ai_profile', tag, profile: { ...prof, ...patch } });
      };

      card.append(
        this.makeNumPairField(
          '追擊距離 / 移動速度',
          prof.chaseRange,
          prof.moveSpeed,
          (chaseRange, moveSpeed) => commit({ chaseRange: Math.max(16, chaseRange), moveSpeed: Math.max(0, moveSpeed) }),
          signal,
        ),
        this.makeNumPairField(
          '接觸傷害 / 擊殺得分',
          prof.contactDamage,
          prof.scoreOnDefeat,
          (contactDamage, scoreOnDefeat) =>
            commit({ contactDamage: Math.max(0, Math.round(contactDamage)), scoreOnDefeat: Math.max(0, Math.round(scoreOnDefeat)) }),
          signal,
        ),
        this.makeNumPairField(
          '二階血量比 / 二階速度',
          prof.phase2HpRatio ?? 0.5,
          prof.phase2Speed ?? prof.moveSpeed,
          (phase2HpRatio, phase2Speed) =>
            commit({
              phase2HpRatio: Math.max(0.05, Math.min(0.95, phase2HpRatio)),
              phase2Speed: Math.max(0, phase2Speed),
            }),
          signal,
        ),
        this.makeSelectField(
          '彈幕 Prefab',
          prof.projectilePrefab ?? '',
          prefabOpts,
          (v) => commit({ projectilePrefab: v || undefined }),
          signal,
        ),
        this.makeNumPairField(
          '發射間隔(s) / 單輪彈數',
          prof.projectileInterval ?? 1.8,
          prof.projectileCount ?? 3,
          (projectileInterval, projectileCount) =>
            commit({
              projectileInterval: Math.max(0.2, projectileInterval),
              projectileCount: Math.max(1, Math.round(projectileCount)),
            }),
          signal,
        ),
        this.makeToggleRow('設為魔王 Boss (顯示魔王血條)', Boolean(prof.isBoss), (isBoss) => commit({ isBoss }), signal),
        this.makeToggleRow('擊敗後判定勝利 (winOnDefeat)', Boolean(prof.winOnDefeat), (winOnDefeat) => commit({ winOnDefeat }), signal),
      );
      body.appendChild(card);
    }
  }

  private renderHeroAndHudTab(
    body: HTMLElement,
    proj: EcsProjectV2,
    session: EcsStudioSession,
    signal: AbortSignal,
  ): void {
    const wm = proj.worldMap!;
    const hc: EcsTopDownHeroConfig = wm.heroConfig ?? {};
    const roomOpts = wm.rooms.map((r) => ({ id: r.id, label: `${r.name} (${r.id})` }));
    const spriteOpts = [{ id: '' as SpriteId, label: '(預設)' }, ...this.callbacks.getSpriteOptions(proj)];

    const heroCard = document.createElement('div');
    heroCard.className = 'p7-rule-card';
    const heroHead = document.createElement('div');
    heroHead.className = 'p7-rule-card-head';
    const heroTitle = document.createElement('strong');
    heroTitle.textContent = '主角動作與世界設定';
    heroHead.appendChild(heroTitle);
    heroCard.appendChild(heroHead);

    const commitHero = (patch: Partial<EcsTopDownHeroConfig>) => {
      session.dispatch({ type: 'set_world_map_config', heroConfig: { ...hc, ...patch } });
    };

    heroCard.append(
      this.makeSelectField(
        '起始房間 (startRoomId)',
        wm.startRoomId,
        roomOpts,
        (startRoomId) => session.dispatch({ type: 'set_world_map_config', startRoomId }),
        signal,
      ),
      this.makeSelectField(
        '行走影格 A',
        hc.walkSpriteA ?? '',
        spriteOpts,
        (v) => commitHero({ walkSpriteA: (v || undefined) as SpriteId | undefined }),
        signal,
      ),
      this.makeSelectField(
        '行走影格 B',
        hc.walkSpriteB ?? '',
        spriteOpts,
        (v) => commitHero({ walkSpriteB: (v || undefined) as SpriteId | undefined }),
        signal,
      ),
      this.makeSelectField(
        '揮擊特效貼圖',
        hc.slashSprite ?? '',
        spriteOpts,
        (v) => commitHero({ slashSprite: (v || undefined) as SpriteId | undefined }),
        signal,
      ),
      this.makeNumPairField(
        '斬擊距離 / 衝刺倍率',
        hc.slashReach ?? 34,
        hc.dashSpeedMultiplier ?? 2.35,
        (slashReach, dashSpeedMultiplier) =>
          commitHero({
            slashReach: Math.max(12, slashReach),
            dashSpeedMultiplier: Math.max(1, dashSpeedMultiplier),
          }),
        signal,
      ),
      this.makeTextField(
        '敵方彈幕標籤',
        wm.hostileProjectileTag ?? 'enemy_orb',
        'enemy_orb',
        (v) => session.dispatch({ type: 'set_world_map_config', hostileProjectileTag: v.trim() || 'enemy_orb' }),
        signal,
      ),
    );
    body.appendChild(heroCard);

    // HUD Gauges section
    const hudHeader = document.createElement('div');
    hudHeader.className = 'p7-rule-card-head';
    hudHeader.style.marginTop = '8px';
    const hudTitle = document.createElement('strong');
    hudTitle.textContent = `自訂 HUD 儀表 (${proj.hud.length})`;
    const addHudBtn = document.createElement('button');
    addHudBtn.type = 'button';
    addHudBtn.className = 'p7-btn p7-btn-xs';
    addHudBtn.textContent = '＋ 新增 HUD';
    addHudBtn.addEventListener(
      'click',
      () => {
        const gauge: EcsHudGaugeDef = {
          kind: 'text',
          label: `STAT_${proj.hud.length + 1}`,
          globalKey: Object.keys(proj.globals)[0] ?? 'progress',
          x: 16,
          y: 28 + proj.hud.length * 16,
          color: '#38bdf8',
        };
        session.dispatch({ type: 'upsert_hud_gauge', gauge });
      },
      { signal },
    );
    hudHeader.append(hudTitle, addHudBtn);
    body.appendChild(hudHeader);

    for (const g of proj.hud) {
      const card = document.createElement('div');
      card.className = 'p7-rule-card';
      const h = document.createElement('div');
      h.className = 'p7-rule-card-head';
      const t = document.createElement('strong');
      t.className = 'p7-mono';
      t.textContent = `${g.label} (${g.kind})`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'p7-btn p7-btn-xs p7-btn-danger';
      del.textContent = '刪除';
      del.addEventListener('click', () => session.dispatch({ type: 'remove_hud_gauge', label: g.label }), { signal });
      h.append(t, del);
      card.appendChild(h);

      const commitHud = (patch: Partial<EcsHudGaugeDef>) => {
        session.dispatch({ type: 'upsert_hud_gauge', gauge: { ...g, ...patch } });
      };
      card.append(
        this.makeSelectField(
          '顯示型態',
          g.kind,
          [
            { id: 'text', label: '文字 (text)' },
            { id: 'bar', label: '進度條 (bar)' },
          ],
          (v) => commitHud({ kind: v === 'bar' ? 'bar' : 'text' }),
          signal,
        ),
        this.makeTextField('綁定全域變數', g.globalKey ?? '', 'globalKey', (v) => commitHud({ globalKey: v.trim() || undefined }), signal),
        this.makeNumPairField('螢幕座標 (X, Y)', g.x, g.y, (x, y) => commitHud({ x: Math.round(x), y: Math.round(y) }), signal),
        this.makeTextField('顏色 Hex', g.color, '#38bdf8', (v) => commitHud({ color: v.trim() || '#38bdf8' }), signal),
      );
      body.appendChild(card);
    }
  }

  private makeSelectField(
    label: string,
    value: string,
    options: readonly { id: string; label: string }[],
    onChange: (next: string) => void,
    signal: AbortSignal,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'p7-rule-field';
    const sp = document.createElement('span');
    sp.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'p7-select';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      if (o.id === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value), { signal });
    row.append(sp, sel);
    return row;
  }

  private makeTextField(
    label: string,
    value: string,
    placeholder: string,
    onChange: (next: string) => void,
    signal: AbortSignal,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'p7-rule-field';
    const sp = document.createElement('span');
    sp.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'p7-input';
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener('change', () => onChange(inp.value), { signal });
    row.append(sp, inp);
    return row;
  }

  private makeNumPairField(
    label: string,
    valA: number,
    valB: number,
    onChange: (a: number, b: number) => void,
    signal: AbortSignal,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'p7-rule-field';
    const sp = document.createElement('span');
    sp.textContent = label;
    const pair = document.createElement('div');
    pair.className = 'p7-rule-pair';
    const inA = document.createElement('input');
    inA.type = 'number';
    inA.className = 'p7-input p7-mono';
    inA.step = 'any';
    inA.value = String(valA);
    const inB = document.createElement('input');
    inB.type = 'number';
    inB.className = 'p7-input p7-mono';
    inB.step = 'any';
    inB.value = String(valB);
    const fire = () => {
      const a = Number(inA.value);
      const b = Number(inB.value);
      if (Number.isFinite(a) && Number.isFinite(b)) onChange(a, b);
    };
    inA.addEventListener('change', fire, { signal });
    inB.addEventListener('change', fire, { signal });
    pair.append(inA, inB);
    row.append(sp, pair);
    return row;
  }

  private makeToggleRow(
    label: string,
    checked: boolean,
    onChange: (next: boolean) => void,
    signal: AbortSignal,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'p7-rule-toggle';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = checked;
    chk.addEventListener('change', () => onChange(chk.checked), { signal });
    const sp = document.createElement('span');
    sp.textContent = label;
    row.append(chk, sp);
    return row;
  }

  public destroy(): void {
    this.renderAc.abort();
    this.ac.abort();
  }
}
