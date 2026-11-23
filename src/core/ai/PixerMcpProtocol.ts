import {
  ECS_ATTACHABLE_COMPONENTS,
  ECS_COMMAND_CATALOG,
  EcsStudioSession,
  type EcsStudioCommand,
} from '../ecs/EcsStudioSession.ts';
import {
  ECS_PROCEDURAL_SPRITE_PATTERNS,
  type EcsProjectV2,
} from '../ecs/EcsProjectSchema.ts';
import { CASTLE_TILE_REGISTRY } from '../ecs/EcsTilemapTypes.ts';
import {
  runScriptedPlaytest,
  type EcsKeypointPlaytestPlan,
} from './EcsPlaytestVerifier.ts';
import {
  analyzeActionReachability,
  analyzeWorldMapReachability,
  observeSceneSemantics,
  renderRoomAscii,
  type ReachabilityOptions,
} from './EcsSpatialOracle.ts';
import { critiqueCutsceneAesthetics } from './EcsCinematicOracle.ts';
import {
  buildInteropStudioCommands,
  detectJsonInteropFormat,
  parseLdtkProject,
  parseTiledMap,
  type DecodedPngImage,
} from '../interop/index.ts';

export const PIXER_MCP_PROTOCOL_VERSION = '2024-11-05';

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const PIXER_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'get_scene_semantics',
    description:
      'Returns a compact, token-efficient multi-dimensional spatial topology summary (entities with z/height/dimensionMask, projection mode, solid platforms, grapple anchors, trigger zones, prefabs, and structural warnings).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_prefabs',
    description: 'Lists all reusable Prefabs in the current ECS project with category, component keys, and live linked instance counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_custom_sprites',
    description: 'Lists all project-embedded custom pixel sprites (palette grids & Oklab+Bayer procedural recipes) hot-compiled into TextureAtlas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'describe_editor_grammar',
    description:
      'Self-describing schema for AI agents: returns all valid EcsStudioCommand grammars (including upsert_custom_sprite, upsert_animation, set_atmosphere, stamp_room_ascii, upsert_interaction_rule, upsert_ai_profile, upsert_tile_def), attachable components, procedural sprite patterns, custom sprites, and active built-in + custom tile IDs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_room_ascii',
    description:
      'Renders a compact 2D ASCII blueprint (~150 tokens) of a WorldMap room showing walls, floors, hazards, locked gates, portals, and entity coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Optional room ID (defaults to worldMap.startRoomId).' },
      },
    },
  },
  {
    name: 'analyze_world_map',
    description:
      'Runs a deterministic multi-room BFS + key/switch dependency solver to prove all rooms, portals, interactions, and Bosses are reachable with zero soft-locks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_attachable_components',
    description: 'Lists all dynamic ECS component keys supported by attach_component and detach_component (including spatial3d, characterMotor2d, grappleAnchor, triggerZone, verletChain).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dispatch_ecs_command',
    description:
      'Executes a single transactional EcsStudioCommand (spawn_entity, patch_entity, attach_component, set_atmosphere, upsert_animation, set_projection, upsert_script with EventGraph layout, create_prefab, instantiate_prefab, update_prefab, etc.) with automatic schema validation and rollback on error.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'object', description: 'Valid EcsStudioCommand object with a "type" discriminator.' },
      },
    },
  },
  {
    name: 'dispatch_ecs_batch',
    description:
      'Executes an array of EcsStudioCommand objects atomically as a single Undo/Redo transaction. Rolls back completely if any step fails.',
    inputSchema: {
      type: 'object',
      required: ['commands'],
      properties: {
        commands: { type: 'array', items: { type: 'object' }, minItems: 1 },
        label: { type: 'string', description: 'Optional human-readable history summary for this atomic batch.' },
      },
    },
  },
  {
    name: 'analyze_reachability',
    description:
      'Runs the kinematic spatial reachability & soft-lock oracle over CharacterMotor2D platforms, jump/dash envelopes, grapple anchors, and trigger/goal zones.',
    inputSchema: {
      type: 'object',
      properties: {
        heroEntityId: { type: 'string' },
        goalEntityIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'run_scripted_playtest',
    description:
      'Executes a deterministic 60Hz headless playtest with timed input keypoints and structured assertions (reach_entity, reach_rect, global_gte, score_gte, event_fired, no_nan_positions).',
    inputSchema: {
      type: 'object',
      required: ['plan'],
      properties: {
        plan: {
          type: 'object',
          required: ['maxFrames', 'keypoints', 'assertions'],
          properties: {
            maxFrames: { type: 'number', minimum: 1, maximum: 3600 },
            keypoints: { type: 'array', items: { type: 'object' } },
            assertions: { type: 'array', items: { type: 'object' } },
            watchActorIds: { type: 'array', items: { type: 'string' } },
            sampleEveryFrames: { type: 'number' },
          },
        },
      },
    },
  },
  {
    name: 'undo',
    description: 'Reverts the most recent committed ECS edit or atomic batch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'redo',
    description: 'Re-applies the most recently undone ECS edit or atomic batch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'import_external_map',
    description:
      'Imports an industry-standard LDtk (.ldtk) or Tiled (.tmj/.json, CSV or Base64 zlib/gzip) map atomically via EcsStudioSession.dispatchBatch (single Undo step) and automatically runs BFS reachability analysis.',
    inputSchema: {
      type: 'object',
      required: ['jsonText'],
      properties: {
        format: {
          type: 'string',
          enum: ['auto', 'ldtk', 'tiled'],
          description: 'Optional format hint (defaults to auto-detection).',
        },
        jsonText: { type: 'string', description: 'Raw LDtk or Tiled JSON string.' },
        sourceName: { type: 'string', description: 'Optional source file name for ID prefixing.' },
        replaceWorldMap: { type: 'boolean', description: 'Replace current WorldMap rooms & entities (default true).' },
        wallExtrudeH: { type: 'number', minimum: 8, maximum: 48, description: 'HD-2D wall extrusion height in px (default 24).' },
      },
    },
  },
  {
    name: 'export_project_json',
    description: 'Exports the full validated EcsProjectV2 JSON document and current revision number.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function makeToolSuccess(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: unknown;
  isError: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

function makeToolError(message: string, details?: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: unknown;
  isError: boolean;
} {
  const payload = { ok: false, error: message, ...(details !== undefined ? { details } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

/**
 * Pure, DOM-free, zero-dependency Model Context Protocol (MCP) JSON-RPC 2.0 router
 * backed directly by `EcsStudioSession`, `EcsSpatialOracle`, and `EcsPlaytestVerifier`.
 * Directly unit-testable in Node and mountable over stdio in `scripts/pixer-mcp.ts`.
 */
export class PixerMcpSession {
  public readonly session: EcsStudioSession;

  constructor(initialProject: EcsProjectV2) {
    this.session = new EcsStudioSession(initialProject);
  }

  public handleRequest(raw: unknown): McpJsonRpcResponse | null {
    if (!isRecord(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }

    const req = raw as unknown as McpJsonRpcRequest;
    const hasId = req.id !== undefined;
    const id = req.id ?? null;

    // Notifications (no id) do not return a JSON-RPC response
    if (!hasId && req.method.startsWith('notifications/')) {
      return null;
    }

    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PIXER_MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'pixer-ecs-mcp', version: '9.5.0' },
          },
        };

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: PIXER_MCP_TOOLS },
        };

      case 'tools/call': {
        const params = isRecord(req.params) ? req.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        const args = isRecord(params.arguments) ? params.arguments : {};
        if (!name) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing required tool name' },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: this.invokeTool(name, args),
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  }

  public invokeTool(
    name: string,
    args: Record<string, unknown> = {},
  ): {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: unknown;
    isError: boolean;
  } {
    switch (name) {
      case 'get_scene_semantics':
        return makeToolSuccess(observeSceneSemantics(this.session.getProject()));

      case 'list_prefabs':
        return makeToolSuccess({
          revision: this.session.getRevision(),
          prefabs: this.session.listPrefabs(),
        });

      case 'list_custom_sprites':
        return makeToolSuccess({
          revision: this.session.getRevision(),
          customSprites: this.session.listCustomSprites(),
        });

      case 'describe_editor_grammar': {
        const proj = this.session.getProject();
        const mergedTiles = new Map(CASTLE_TILE_REGISTRY.map((t) => [t.id, t]));
        if (proj.worldMap?.tileDefs) {
          for (const td of proj.worldMap.tileDefs) mergedTiles.set(td.id, td);
        }
        return makeToolSuccess({
          commands: ECS_COMMAND_CATALOG,
          attachableComponents: [...ECS_ATTACHABLE_COMPONENTS],
          proceduralSpritePatterns: [...ECS_PROCEDURAL_SPRITE_PATTERNS],
          customSprites: this.session.listCustomSprites(),
          tiles: Array.from(mergedTiles.values()).map((t) => ({
            id: t.id,
            name: t.name,
            layer: t.layer,
            sprite: t.sprite,
            solid: t.solid,
            ...(t.hazard ? { hazard: true } : {}),
            ...(t.extrudeH ? { extrudeH: t.extrudeH } : {}),
            ...(t.renderH ? { renderH: t.renderH } : {}),
            ...(t.unlockGlobal ? { unlockGlobal: t.unlockGlobal } : {}),
          })),
        });
      }

      case 'get_room_ascii': {
        const roomId = typeof args.roomId === 'string' ? args.roomId : undefined;
        return makeToolSuccess(renderRoomAscii(this.session.getProject(), roomId));
      }

      case 'analyze_world_map':
        return makeToolSuccess(analyzeWorldMapReachability(this.session.getProject()));

      case 'list_attachable_components':
        return makeToolSuccess({ components: [...ECS_ATTACHABLE_COMPONENTS] });

      case 'dispatch_ecs_command': {
        const cmd = args.command;
        if (!isRecord(cmd) || typeof cmd.type !== 'string') {
          return makeToolError('Expected "command" object with string "type"');
        }
        const res = this.session.dispatch(cmd as unknown as EcsStudioCommand);
        return res.ok ? makeToolSuccess(res) : makeToolError(res.summary, res);
      }

      case 'dispatch_ecs_batch': {
        const cmds = args.commands;
        if (!Array.isArray(cmds) || cmds.length === 0 || !cmds.every((c) => isRecord(c) && typeof c.type === 'string')) {
          return makeToolError('Expected non-empty "commands" array of valid EcsStudioCommand objects');
        }
        const label = typeof args.label === 'string' ? args.label : undefined;
        const res = this.session.dispatchBatch(cmds as unknown as EcsStudioCommand[], label);
        return res.ok ? makeToolSuccess(res) : makeToolError(res.summary, res);
      }

      case 'analyze_reachability': {
        const opts: ReachabilityOptions = {};
        if (typeof args.heroEntityId === 'string') opts.heroEntityId = args.heroEntityId;
        if (Array.isArray(args.goalEntityIds)) {
          opts.goalEntityIds = args.goalEntityIds.filter((g): g is string => typeof g === 'string');
        }
        return makeToolSuccess(analyzeActionReachability(this.session.getProject(), opts));
      }

      case 'run_scripted_playtest': {
        const rawPlan = args.plan;
        if (!isRecord(rawPlan) || !Array.isArray(rawPlan.keypoints) || !Array.isArray(rawPlan.assertions)) {
          return makeToolError('Expected "plan" object with "maxFrames", "keypoints", and "assertions" arrays');
        }
        const plan: EcsKeypointPlaytestPlan = {
          maxFrames: typeof rawPlan.maxFrames === 'number' ? rawPlan.maxFrames : 180,
          keypoints: rawPlan.keypoints as EcsKeypointPlaytestPlan['keypoints'],
          assertions: rawPlan.assertions as EcsKeypointPlaytestPlan['assertions'],
          ...(Array.isArray(rawPlan.watchActorIds)
            ? { watchActorIds: rawPlan.watchActorIds.filter((s): s is string => typeof s === 'string') }
            : {}),
          ...(typeof rawPlan.sampleEveryFrames === 'number' ? { sampleEveryFrames: rawPlan.sampleEveryFrames } : {}),
        };
        const report = runScriptedPlaytest(this.session.getProject(), plan);
        return makeToolSuccess(report);
      }

      case 'undo': {
        const res = this.session.undo();
        return res.ok ? makeToolSuccess(res) : makeToolError(res.summary, res);
      }

      case 'redo': {
        const res = this.session.redo();
        return res.ok ? makeToolSuccess(res) : makeToolError(res.summary, res);
      }

      case 'import_external_map': {
        const jsonText = typeof args.jsonText === 'string' ? args.jsonText : '';
        if (!jsonText.trim()) {
          return makeToolError('Expected non-empty "jsonText" string containing LDtk or Tiled JSON');
        }
        const rawFmt = typeof args.format === 'string' ? args.format : 'auto';
        const detected = rawFmt === 'auto' ? detectJsonInteropFormat(jsonText) : rawFmt;
        if (detected !== 'ldtk' && detected !== 'tiled') {
          return makeToolError(`Unsupported or unrecognized external map format: ${String(detected)}`);
        }
        const sourceName =
          typeof args.sourceName === 'string' && args.sourceName.trim()
            ? args.sourceName.trim()
            : detected === 'ldtk'
              ? 'mcp_import.ldtk'
              : 'mcp_import.tmj';
        const wallExtrudeH =
          typeof args.wallExtrudeH === 'number' && Number.isFinite(args.wallExtrudeH)
            ? args.wallExtrudeH
            : 24;
        const replaceWorldMap = args.replaceWorldMap !== false;

        try {
          const emptyAssets = new Map<string, DecodedPngImage>();
          const parsed =
            detected === 'ldtk'
              ? parseLdtkProject(jsonText, emptyAssets, sourceName, { wallExtrudeH })
              : parseTiledMap(jsonText, emptyAssets, sourceName, { wallExtrudeH });
          const cmds = buildInteropStudioCommands(parsed, this.session.getProject(), {
            replaceWorldMap,
            wallExtrudeH,
          });
          const res = this.session.dispatchBatch(cmds, `外部匯入 ${parsed.sourceName} (${parsed.format})`);
          if (!res.ok) {
            return makeToolError(res.summary, res);
          }
          const reachability = analyzeWorldMapReachability(this.session.getProject());
          return makeToolSuccess({
            ok: true,
            revision: res.revision,
            format: parsed.format,
            summary: parsed.summary,
            rooms: parsed.rooms.length,
            tileDefs: parsed.tileDefs.length,
            portals: parsed.portals.length,
            entities: parsed.entities.length,
            customSprites: parsed.customSprites.length,
            warnings: parsed.warnings,
            missingAssetPaths: parsed.missingAssetPaths,
            reachability,
          });
        } catch (err) {
          return makeToolError(err instanceof Error ? err.message : String(err));
        }
      }

      case 'critique_cutscene_aesthetics': {
        const cutsceneId = typeof args.cutsceneId === 'string' ? args.cutsceneId.trim() : '';
        if (!cutsceneId) {
          return makeToolError('Expected non-empty "cutsceneId" string');
        }
        const report = critiqueCutsceneAesthetics(this.session.getProject(), cutsceneId);
        return report.ok ? makeToolSuccess(report) : makeToolError(report.suggestions[0] ?? 'Cutscene critique failed', report);
      }

      case 'export_project_json':
        return makeToolSuccess({
          revision: this.session.getRevision(),
          project: this.session.getProject(),
        });

      default:
        return makeToolError(`Unknown Pixer MCP tool: ${name}`);
    }
  }
}
