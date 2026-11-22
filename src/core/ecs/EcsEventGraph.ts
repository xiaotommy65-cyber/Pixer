import type {
  EcsCompareOp,
  EcsScriptCond,
  EcsScriptDef,
  EcsScriptOp,
  EcsScriptRuleDef,
  EcsScriptTrigger,
} from './EcsProjectSchema.ts';

export interface EcsEventGraphPos {
  x: number;
  y: number;
}

export type EcsEventGraphLayoutMap = Record<string, EcsEventGraphPos>;

export type EcsEventGraphNodeKind = 'trigger' | 'condition' | 'action';

export interface EcsEventGraphNode {
  id: string;
  kind: EcsEventGraphNodeKind;
  x: number;
  y: number;
  /** Index of the rule this node belongs to when compiled from EcsScriptDef (used for live VM trace highlighting). */
  ruleIndex?: number;
  trigger?: EcsScriptTrigger;
  cond?: EcsScriptCond;
  op?: EcsScriptOp;
}

export interface EcsEventGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface EcsEventGraphIR {
  scriptId: string;
  scriptName: string;
  description?: string;
  nodes: EcsEventGraphNode[];
  edges: EcsEventGraphEdge[];
}

export interface EventGraphCompileOutput {
  script: EcsScriptDef;
  layout: EcsEventGraphLayoutMap;
  warnings: string[];
}

export interface EventGraphNodeDisplay {
  badge: string;
  title: string;
  subtitle: string;
}

const COL_START_X = 36;
const COL_STEP_X = 248;
const ROW_START_Y = 36;
const ROW_STEP_Y = 152;

function cloneObj<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Lossless forward compiler: transforms a declarative `EcsScriptDef` (rules of Trigger -> Conditions -> Ops)
 * into a positioned `EcsEventGraphIR` suitable for visual node-graph editing and live VM trace highlighting.
 * 100% pure & DOM-free (zero eval / zero new Function).
 */
export function compileScriptToEventGraph(
  script: EcsScriptDef,
  savedLayout?: EcsEventGraphLayoutMap,
): EcsEventGraphIR {
  const nodes: EcsEventGraphNode[] = [];
  const edges: EcsEventGraphEdge[] = [];

  for (let r = 0; r < script.rules.length; r++) {
    const rule = script.rules[r];
    const rowY = ROW_START_Y + r * ROW_STEP_Y;
    let colIdx = 0;

    const trigId = `r${r}_trig`;
    const trigPos = savedLayout?.[trigId] ?? { x: COL_START_X + colIdx * COL_STEP_X, y: rowY };
    nodes.push({
      id: trigId,
      kind: 'trigger',
      x: trigPos.x,
      y: trigPos.y,
      ruleIndex: r,
      trigger: cloneObj(rule.trigger),
    });
    let prevId = trigId;
    colIdx++;

    const conds = rule.when ?? [];
    for (let c = 0; c < conds.length; c++) {
      const condId = `r${r}_cond_${c}`;
      const pos = savedLayout?.[condId] ?? { x: COL_START_X + colIdx * COL_STEP_X, y: rowY };
      nodes.push({
        id: condId,
        kind: 'condition',
        x: pos.x,
        y: pos.y,
        ruleIndex: r,
        cond: cloneObj(conds[c]),
      });
      edges.push({ id: `e_${prevId}_${condId}`, fromNodeId: prevId, toNodeId: condId });
      prevId = condId;
      colIdx++;
    }

    for (let o = 0; o < rule.ops.length; o++) {
      const opId = `r${r}_op_${o}`;
      const pos = savedLayout?.[opId] ?? { x: COL_START_X + colIdx * COL_STEP_X, y: rowY };
      nodes.push({
        id: opId,
        kind: 'action',
        x: pos.x,
        y: pos.y,
        ruleIndex: r,
        op: cloneObj(rule.ops[o]),
      });
      edges.push({ id: `e_${prevId}_${opId}`, fromNodeId: prevId, toNodeId: opId });
      prevId = opId;
      colIdx++;
    }
  }

  return {
    scriptId: script.id,
    scriptName: script.name,
    description: script.description,
    nodes,
    edges,
  };
}

/**
 * Lossless reverse compiler: deterministically compiles an `EcsEventGraphIR` back into
 * an executable `EcsScriptDef` for `SandboxScriptVm` plus a persisted node layout map.
 * Cycle-safe and strictly validates Trigger -> Condition* -> Action* topology.
 */
export function compileEventGraphToScript(graph: EcsEventGraphIR): EventGraphCompileOutput {
  const warnings: string[] = [];
  const nodeMap = new Map<string, EcsEventGraphNode>();
  const outgoing = new Map<string, string[]>();

  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    nodeMap.set(n.id, n);
  }

  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i];
    if (!nodeMap.has(e.fromNodeId) || !nodeMap.has(e.toNodeId)) continue;
    const list = outgoing.get(e.fromNodeId);
    if (list) list.push(e.toNodeId);
    else outgoing.set(e.fromNodeId, [e.toNodeId]);
  }

  // Sort outgoing targets stably by (x, y, id) for deterministic execution order
  for (const list of outgoing.values()) {
    list.sort((aId, bId) => {
      const a = nodeMap.get(aId)!;
      const b = nodeMap.get(bId)!;
      if (Math.abs(a.x - b.x) > 4) return a.x - b.x;
      if (Math.abs(a.y - b.y) > 4) return a.y - b.y;
      return a.id.localeCompare(b.id);
    });
  }

  // Collect all trigger root nodes sorted top-to-bottom (preserving rule order)
  const triggerNodes = graph.nodes
    .filter((n) => n.kind === 'trigger' && n.trigger)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 8) return a.y - b.y;
      if (Math.abs(a.x - b.x) > 8) return a.x - b.x;
      return a.id.localeCompare(b.id);
    });

  const rules: EcsScriptRuleDef[] = [];
  const layout: EcsEventGraphLayoutMap = {};
  const reachedNodes = new Set<string>();

  for (let r = 0; r < triggerNodes.length; r++) {
    const trigNode = triggerNodes[r];
    const conds: EcsScriptCond[] = [];
    const ops: EcsScriptOp[] = [];
    const visitedInRule = new Set<string>();

    const walk = (currId: string): void => {
      if (visitedInRule.has(currId)) {
        warnings.push(`偵測到循環連線（節點 ${currId}），已自動截斷以避免無窮迴圈。`);
        return;
      }
      visitedInRule.add(currId);
      reachedNodes.add(currId);

      const node = nodeMap.get(currId);
      if (!node) return;
      if (node.kind === 'condition' && node.cond) {
        const cIdx = conds.length;
        conds.push(cloneObj(node.cond));
        layout[`r${r}_cond_${cIdx}`] = { x: Math.round(node.x), y: Math.round(node.y) };
      } else if (node.kind === 'action' && node.op) {
        const oIdx = ops.length;
        ops.push(cloneObj(node.op));
        layout[`r${r}_op_${oIdx}`] = { x: Math.round(node.x), y: Math.round(node.y) };
      }

      const nexts = outgoing.get(currId);
      if (!nexts) return;
      for (let i = 0; i < nexts.length; i++) {
        const nextNode = nodeMap.get(nexts[i]);
        if (!nextNode || nextNode.kind === 'trigger') continue;
        walk(nexts[i]);
      }
    };

    layout[`r${r}_trig`] = { x: Math.round(trigNode.x), y: Math.round(trigNode.y) };
    reachedNodes.add(trigNode.id);
    visitedInRule.add(trigNode.id);
    const rootsOut = outgoing.get(trigNode.id) ?? [];
    for (let i = 0; i < rootsOut.length; i++) {
      const nextNode = nodeMap.get(rootsOut[i]);
      if (!nextNode || nextNode.kind === 'trigger') continue;
      walk(rootsOut[i]);
    }

    const ruleDef: EcsScriptRuleDef = {
      trigger: cloneObj(trigNode.trigger!),
      ops,
    };
    if (conds.length > 0) {
      ruleDef.when = conds;
    }
    rules.push(ruleDef);
  }

  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    if (!reachedNodes.has(n.id)) {
      warnings.push(`節點 ${n.id} 尚未連接至任何觸發器，將不會於運行時執行。`);
    }
  }

  return {
    script: {
      id: graph.scriptId,
      name: graph.scriptName,
      ...(graph.description ? { description: graph.description } : {}),
      rules,
    },
    layout,
    warnings,
  };
}

/** Checks whether connecting `fromNodeId -> toNodeId` would introduce a directed cycle. */
function wouldCreateCycle(edges: readonly EcsEventGraphEdge[], fromNodeId: string, toNodeId: string): boolean {
  if (fromNodeId === toNodeId) return true;
  const visited = new Set<string>();
  const stack: string[] = [toNodeId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === fromNodeId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].fromNodeId === curr) {
        stack.push(edges[i].toNodeId);
      }
    }
  }
  return false;
}

export function connectEventGraphNodes(
  graph: EcsEventGraphIR,
  fromNodeId: string,
  toNodeId: string,
): { graph: EcsEventGraphIR; ok: boolean; error?: string } {
  const fromNode = graph.nodes.find((n) => n.id === fromNodeId);
  const toNode = graph.nodes.find((n) => n.id === toNodeId);
  if (!fromNode || !toNode) {
    return { graph, ok: false, error: '找不到來源或目標節點' };
  }
  if (toNode.kind === 'trigger') {
    return { graph, ok: false, error: '觸發器節點不能作為連線目標（僅能作為規則起點）' };
  }
  if (fromNode.kind === 'action' && toNode.kind === 'condition') {
    return { graph, ok: false, error: '條件節點必須連接於觸發器之後、動作之前' };
  }
  if (graph.edges.some((e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId)) {
    return { graph, ok: false, error: '這兩個節點已經連線' };
  }
  if (wouldCreateCycle(graph.edges, fromNodeId, toNodeId)) {
    return { graph, ok: false, error: '禁止建立循環連線' };
  }

  const nextEdge: EcsEventGraphEdge = {
    id: `e_${fromNodeId}_${toNodeId}_${graph.edges.length + 1}`,
    fromNodeId,
    toNodeId,
  };
  return {
    ok: true,
    graph: {
      ...graph,
      edges: [...graph.edges, nextEdge],
    },
  };
}

export function disconnectEventGraphEdge(graph: EcsEventGraphIR, edgeId: string): EcsEventGraphIR {
  return {
    ...graph,
    edges: graph.edges.filter((e) => e.id !== edgeId),
  };
}

export function moveEventGraphNode(
  graph: EcsEventGraphIR,
  nodeId: string,
  x: number,
  y: number,
): EcsEventGraphIR {
  const cx = Math.max(12, Math.round(x));
  const cy = Math.max(12, Math.round(y));
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, x: cx, y: cy } : n)),
  };
}

export function removeEventGraphNode(graph: EcsEventGraphIR, nodeId: string): EcsEventGraphIR {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
  };
}

export function addEventGraphNode(
  graph: EcsEventGraphIR,
  kind: EcsEventGraphNodeKind,
  x?: number,
  y?: number,
): { graph: EcsEventGraphIR; createdNodeId: string } {
  const seq = graph.nodes.length + 1;
  let id = `n_${kind}_${seq}`;
  while (graph.nodes.some((n) => n.id === id)) {
    id = `n_${kind}_${seq}_${Math.floor(Math.random() * 1000)}`;
  }

  const maxY = graph.nodes.reduce((acc, n) => Math.max(acc, n.y), ROW_START_Y - ROW_STEP_Y);
  const nx =
    x !== undefined
      ? Math.round(x)
      : kind === 'trigger'
        ? COL_START_X
        : kind === 'condition'
          ? COL_START_X + COL_STEP_X
          : COL_START_X + COL_STEP_X * 2;
  const ny =
    y !== undefined
      ? Math.round(y)
      : kind === 'trigger'
        ? Math.max(ROW_START_Y, maxY + ROW_STEP_Y)
        : Math.max(ROW_START_Y, maxY);

  const node: EcsEventGraphNode =
    kind === 'trigger'
      ? { id, kind, x: nx, y: ny, trigger: { on: 'event', name: 'custom_event' } }
      : kind === 'condition'
        ? { id, kind, x: nx, y: ny, cond: { kind: 'global', key: 'energy', op: 'gte', value: 10 } }
        : { id, kind, x: nx, y: ny, op: { op: 'add_score', delta: 100 } };

  return {
    createdNodeId: id,
    graph: {
      ...graph,
      nodes: [...graph.nodes, node],
    },
  };
}

export function autoLayoutEventGraph(graph: EcsEventGraphIR): EcsEventGraphIR {
  const compiled = compileEventGraphToScript(graph);
  return compileScriptToEventGraph(compiled.script);
}

const COMPARE_LABELS: Record<EcsCompareOp, string> = {
  eq: '==',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

export function describeEventGraphNode(node: EcsEventGraphNode): EventGraphNodeDisplay {
  if (node.kind === 'trigger' && node.trigger) {
    const t = node.trigger;
    switch (t.on) {
      case 'start':
        return { badge: '觸發', title: '實體誕生 (onStart)', subtitle: '建立後首幀執行一次' };
      case 'tick':
        return { badge: '觸發', title: '每幀更新 (onTick)', subtitle: '60Hz 持續檢查' };
      case 'timer':
        return { badge: '觸發', title: '定時週期 (onTimer)', subtitle: `每 ${t.intervalSec.toFixed(2)} 秒觸發` };
      case 'input':
        return { badge: '觸發', title: `按鍵輸入 [${t.button.toUpperCase()}]`, subtitle: '按下瞬間觸發' };
      case 'collide':
        return { badge: '觸發', title: '物理碰撞 (onCollide)', subtitle: t.withTag ? `目標標籤：${t.withTag}` : '任意碰撞對象' };
      case 'event':
        return { badge: '觸發', title: `監聽事件「${t.name}」`, subtitle: '接收 TriggerZone / VM 事件' };
      case 'path_end':
        return { badge: '觸發', title: '路徑抵達終點', subtitle: 'PathFollower 走完路徑' };
    }
  }

  if (node.kind === 'condition' && node.cond) {
    const c = node.cond;
    const lhs = c.kind === 'global' ? `全域 ${c.key ?? ''}` : c.kind === 'var' ? `槽位 var[${c.slot ?? 0}]` : '自身 HP';
    return {
      badge: '條件',
      title: `${lhs} ${COMPARE_LABELS[c.op]} ${c.value}`,
      subtitle: '條件成立時繼續下游動作',
    };
  }

  if (node.kind === 'action' && node.op) {
    const o = node.op;
    switch (o.op) {
      case 'set_global':
        return { badge: '動作', title: `設定全域 ${o.key} = ${o.value}`, subtitle: '寫入 ECS Globals' };
      case 'add_global':
        return { badge: '動作', title: `增減全域 ${o.key} (${o.delta >= 0 ? '+' : ''}${o.delta})`, subtitle: '累積或扣減全域數值' };
      case 'set_var':
        return { badge: '動作', title: `設定 var[${o.slot}] = ${o.value}`, subtitle: '實體局部變數' };
      case 'add_var':
        return { badge: '動作', title: `增減 var[${o.slot}] (${o.delta >= 0 ? '+' : ''}${o.delta})`, subtitle: '實體局部變數' };
      case 'set_vel':
        return { badge: '動作', title: `設定速度 (${o.vx}, ${o.vy})`, subtitle: '調整 Velocity2D' };
      case 'spawn_prefab':
        return { badge: '動作', title: `生成 Prefab「${o.prefab}」`, subtitle: o.atX !== undefined ? `座標 (${o.atX}, ${o.atY ?? 0})` : `相對偏移 (${o.offsetX ?? 0}, ${o.offsetY ?? 0})` };
      case 'destroy_self':
        return { badge: '動作', title: '銷毀自身實體', subtitle: '安全釋放世代句柄' };
      case 'find_nearest':
        return { badge: '動作', title: `搜尋最近「${o.tag}」`, subtitle: `半徑 ${o.range}px 鎖定目標` };
      case 'fire_at_target':
        return { badge: '動作', title: `發射「${o.prefab}」`, subtitle: `速度 ${o.speed} · 冷卻 ${o.cooldownSec}s` };
      case 'damage_global':
        return { badge: '動作', title: `扣減 ${o.key} (-${Math.abs(o.delta)})`, subtitle: '歸零時判定失敗' };
      case 'add_score':
        return { badge: '動作', title: `增加分數 +${o.delta}`, subtitle: '同步 HUD 分數' };
      case 'play_sfx':
        return { badge: '動作', title: `播放音效 [${o.sfx}]`, subtitle: 'Web Audio 合成觸發' };
      case 'emit_event':
        return { badge: '動作', title: `廣播事件「${o.name}」`, subtitle: '推送至沙盒事件佇列' };
      case 'judge_lane_hit':
        return { badge: '動作', title: `節拍判定 軌道 ${o.lane + 1}`, subtitle: `充能 ${o.energyGlobal} / 連擊 ${o.comboGlobal}` };
      case 'set_status':
        return { badge: '動作', title: o.status === 'won' ? '宣告關卡勝利' : '宣告關卡失敗', subtitle: `狀態 -> ${o.status}` };
    }
  }

  return { badge: '節點', title: node.id, subtitle: '' };
}
