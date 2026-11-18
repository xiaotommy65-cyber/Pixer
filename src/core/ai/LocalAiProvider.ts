import { SeededRng } from '../runtime/SeededRng.ts';
import { btAction, btCondition, btSequence, btUtilitySelector, type BtNode } from '../sim/BehaviorTree.ts';
import type {
  AiProvider,
  AiProviderMode,
  DynamicDialogRequest,
  DynamicDialogResult,
  PixelSpriteRequest,
  PixelSpriteResult,
  StageRecipeRequest,
  StageRecipeResult,
  TacticalAdviceRequest,
  TacticalAdviceResult,
} from './AiTypes.ts';
import type { UnifiedGameObservation } from './ObservationSerializer.ts';

export type DndCampaignGeneratorHook = (seed?: number) => { payload: string; summary: string } | null;

let registeredDndCampaignGenerator: DndCampaignGeneratorHook | null = null;

/**
 * Registers the procedural CRPG campaign generator without coupling src/core/ to src/game/.
 */
export function registerDndCampaignGenerator(hook: DndCampaignGeneratorHook | null): void {
  registeredDndCampaignGenerator = hook;
}

interface AdvisorBlackboard {
  obs: UnifiedGameObservation;
  chosenId: string | null;
  rationale: string;
  confidence: number;
}

const ADVISOR_TREE: BtNode<AdvisorBlackboard> = btUtilitySelector<AdvisorBlackboard>([
  {
    id: 'shmup-hangar-launch',
    score: (bb) => (bb.obs.shmupDetails?.phase === 'hangar' ? 90 : 0),
    node: btAction((bb) => {
      bb.chosenId = 'launch_sortie';
      bb.rationale = 'Ready in hangar; launch sortie into active wave.';
      bb.confidence = 0.94;
    }),
  },
  {
    id: 'shmup-emergency-bomb',
    score: (bb) => {
      const sh = bb.obs.shmupDetails;
      if (!sh || sh.phase !== 'sortie') return 0;
      return sh.hearts <= 1 && sh.bombs > 0 ? 96 : 0;
    },
    node: btAction((bb) => {
      bb.chosenId = 'bomb';
      bb.rationale = 'Low hull integrity with bombs stocked; deploy Starlight Bomb.';
      bb.confidence = 0.92;
    }),
  },
  {
    id: 'chronicle-advance-cutscene',
    score: (bb) => (bb.obs.chronicleDetails?.cutscene?.awaitingInput ? 95 : 0),
    node: btAction((bb) => {
      bb.chosenId = 'dialog_next';
      bb.rationale = 'Cutscene awaiting confirmation.';
      bb.confidence = 0.98;
    }),
  },
  {
    id: 'chronicle-boss-relic',
    score: (bb) => {
      const ch = bb.obs.chronicleDetails;
      if (!ch || ch.uiMode !== 'PLAYING' || !ch.boss) return 0;
      return ch.hero.mp >= ch.hero.relicMpCost ? 85 : 0;
    },
    node: btAction((bb) => {
      bb.chosenId = 'cast_relic';
      bb.rationale = 'Boss engaged with full relic mana; unleash burst skill.';
      bb.confidence = 0.87;
    }),
  },
  {
    id: 'turn-first-legal-action',
    score: (bb) => (bb.obs.legalActions.some((a) => a.enabled) ? 60 : 0),
    node: btSequence([
      btCondition((bb) => bb.obs.legalActions.some((a) => a.enabled)),
      btAction((bb) => {
        const heal = bb.obs.legalActions.find(
          (a) => a.enabled && (a.id.includes('potion') || a.id.includes('heal')) && bb.obs.hero.hearts <= 2,
        );
        const pick = heal ?? bb.obs.legalActions.find((a) => a.enabled)!;
        bb.chosenId = pick.id;
        bb.rationale = heal ? 'Low HP heuristic selected recovery option.' : `Selected available action ${pick.label}.`;
        bb.confidence = 0.78;
      }),
    ]),
  },
]);

function hashStringSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic client-side procedural AI provider. Guarantees instant offline fallback
 * for stage synthesis, contextual dialog, 32-bit RGBA pixel sprites, and tactical advice.
 */
export class LocalProceduralAiProvider implements AiProvider {
  public readonly id = 'local-procedural-v1';
  public readonly mode: AiProviderMode = 'local-procedural';

  public async generateStageRecipe(req: StageRecipeRequest): Promise<StageRecipeResult> {
    const seed = req.seed ?? hashStringSeed(`${req.cartridgeId}:${req.theme}:${req.difficulty ?? 'balanced'}`);
    const rng = new SeededRng(seed);

    if (req.cartridgeId === 'emberkeep-dnd' && registeredDndCampaignGenerator) {
      const generated = registeredDndCampaignGenerator(seed);
      if (generated) {
        return {
          kind: 'dnd-module',
          payload: generated.payload,
          title: `餘燼深淵 #${seed % 1000}`,
          summary: generated.summary,
          tags: ['dnd', req.theme, req.difficulty ?? 'balanced'],
          providerId: this.id,
        };
      }
    }

    const skySets: [string, string][] = [
      ['#5979d6', '#ffd9e8'],
      ['#1a1433', '#3b2459'],
      ['#69c9ff', '#fff4df'],
    ];
    const [top, bottom] = skySets[rng.int(0, skySets.length - 1)];
    const isDark = req.theme.includes('暗') || req.theme.includes('dungeon') || top === '#1a1433';
    const lines = [
      `// AI Procedural Recipe: ${req.theme}`,
      `api.setSky('${top}', '${bottom}');`,
      isDark ? `api.setDarkness(0.72, '#0d091c');` : '',
      `api.setHeroSpawn(24, 120);`,
      `api.addCloud(${rng.int(64, 96)}, ${rng.int(100, 124)}, 3);`,
      `api.addCloud(${rng.int(164, 200)}, ${rng.int(78, 102)}, 4);`,
      `api.addSpring(${rng.int(52, 74)}, 134);`,
      `api.addCrate(${rng.int(98, 128)}, 134);`,
      `api.addBomb(${rng.int(134, 152)}, 134);`,
      `api.addSwitch(${rng.int(210, 240)}, 134);`,
      `api.addStar(${rng.int(80, 110)}, 84);`,
      `api.addStar(${rng.int(180, 220)}, 66);`,
      `api.addSlime(${rng.int(156, 190)}, 134);`,
      isDark ? `api.addTorch(48, 134); api.addTorch(232, 134);` : '',
      `api.addGate(284, 134);`,
    ].filter(Boolean);

    return {
      kind: 'sandbox-script',
      payload: lines.join('\n'),
      title: `星語秘境「${req.theme}」`,
      summary: `程序化生成機關關卡（含彈簧、炸彈與開關大門）`,
      tags: ['sandbox', req.theme, req.difficulty ?? 'balanced'],
      providerId: this.id,
    };
  }

  public async generateDynamicDialog(req: DynamicDialogRequest): Promise<DynamicDialogResult> {
    const lv = req.heroLevel ?? 1;
    const tones = [
      `星脈正在「${req.contextHint}」附近共振。保持警戒，Lv.${lv} 的光芒足以照亮暗影。`,
      `別輕忽前方守護者！以閃避接上遺物奧義，能瞬間瓦解它的護盾。`,
    ];
    return {
      speaker: req.speaker,
      lines: tones,
      choices: [
        { id: 'accept_blessing', label: '接受星光祝福' },
        { id: 'ask_lore', label: '追問古老封印' },
      ],
      providerId: this.id,
    };
  }

  public async generatePixelSprite(req: PixelSpriteRequest): Promise<PixelSpriteResult> {
    const w = req.width === 32 ? 32 : 16;
    const h = req.height === 32 ? 32 : 16;
    const seed = req.seed ?? hashStringSeed(`${req.id}:${req.theme}`);
    const rng = new SeededRng(seed);
    const rgba = new Uint8Array(w * h * 4);

    const hueShift = rng.int(0, 2);
    const baseColors: [number, number, number][] = [
      [255, 112, 141],
      [94, 194, 247],
      [255, 212, 71],
    ];
    const [cr, cg, cb] = baseColors[hueShift];
    const halfW = w / 2;
    const cy = h / 2;

    const mask = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < halfW; x++) {
        const dx = (halfW - x - 0.5) / (halfW - 2);
        const dy = Math.abs(y - cy + 0.5) / (cy - 2);
        const dist = dx * 0.9 + dy * 1.05;
        if (dist < 0.78 + rng.next() * 0.16) {
          mask[y * w + x] = 1;
          mask[y * w + (w - 1 - x)] = 1;
        }
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (mask[idx]) {
          const light = Math.max(0.55, 1.18 - ((x / w) * 0.32 + (y / h) * 0.42));
          rgba[p] = Math.min(255, Math.round(cr * light + (y < cy * 0.65 ? 36 : 0)));
          rgba[p + 1] = Math.min(255, Math.round(cg * light + (y < cy * 0.65 ? 32 : 0)));
          rgba[p + 2] = Math.min(255, Math.round(cb * light + (y < cy * 0.65 ? 28 : 0)));
          rgba[p + 3] = 255;
        } else {
          const hasNeighbor =
            (x > 0 && mask[idx - 1]) ||
            (x + 1 < w && mask[idx + 1]) ||
            (y > 0 && mask[idx - w]) ||
            (y + 1 < h && mask[idx + w]);
          if (hasNeighbor) {
            rgba[p] = 56;
            rgba[p + 1] = 40;
            rgba[p + 2] = 32;
            rgba[p + 3] = 255;
          }
        }
      }
    }

    return { id: req.id, width: w, height: h, rgba, providerId: this.id };
  }

  public async adviseTacticalAction(req: TacticalAdviceRequest): Promise<TacticalAdviceResult> {
    const bb: AdvisorBlackboard = {
      obs: req.observation,
      chosenId: null,
      rationale: 'Maintain current movement or explore.',
      confidence: 0.45,
    };
    ADVISOR_TREE.tick(bb);
    return {
      recommendedActionId: bb.chosenId,
      rationale: bb.rationale,
      confidence: bb.confidence,
      providerId: this.id,
    };
  }
}
