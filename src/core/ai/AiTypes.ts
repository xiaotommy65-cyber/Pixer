import type { CartridgeId } from '../types/WorldTypes.ts';
import type { UnifiedGameObservation } from './ObservationSerializer.ts';

export type AiProviderMode = 'local-procedural' | 'remote-http' | 'hybrid';

export interface StageRecipeRequest {
  cartridgeId: CartridgeId;
  theme: string;
  difficulty?: 'cozy' | 'balanced' | 'intense';
  seed?: number;
}

export interface StageRecipeResult {
  kind: 'sandbox-script' | 'dnd-module';
  payload: string;
  title: string;
  summary: string;
  tags: string[];
  providerId: string;
}

export interface DynamicDialogRequest {
  cartridgeId: CartridgeId;
  speaker: string;
  contextHint: string;
  heroLevel?: number;
  seed?: number;
}

export interface DynamicDialogResult {
  speaker: string;
  lines: string[];
  choices: { id: string; label: string }[];
  providerId: string;
}

export interface PixelSpriteRequest {
  id: string;
  theme: string;
  width?: 16 | 32;
  height?: 16 | 32;
  seed?: number;
}

export interface PixelSpriteResult {
  id: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  providerId: string;
}

export interface TacticalAdviceRequest {
  observation: UnifiedGameObservation;
}

export interface TacticalAdviceResult {
  recommendedActionId: string | null;
  rationale: string;
  confidence: number;
  providerId: string;
}

/**
 * Unified AI Provider SPI enabling seamless switching or hybrid composition between
 * deterministic local algorithms and future remote LLM / Gemini server proxy endpoints.
 */
export interface AiProvider {
  readonly id: string;
  readonly mode: AiProviderMode;
  generateStageRecipe?(req: StageRecipeRequest, signal?: AbortSignal): Promise<StageRecipeResult>;
  generateDynamicDialog?(req: DynamicDialogRequest, signal?: AbortSignal): Promise<DynamicDialogResult>;
  generatePixelSprite?(req: PixelSpriteRequest, signal?: AbortSignal): Promise<PixelSpriteResult>;
  adviseTacticalAction?(req: TacticalAdviceRequest, signal?: AbortSignal): Promise<TacticalAdviceResult>;
}
