import { appLogger } from '../runtime/AppLogger.ts';
import type { EngineEventBus } from '../runtime/EventBus.ts';
import type { CartridgeId } from '../types/WorldTypes.ts';
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
import { LocalProceduralAiProvider } from './LocalAiProvider.ts';

/**
 * Coordinates primary AI Provider with seamless fallback to LocalProceduralAiProvider,
 * emitting lifecycle telemetry on EngineEventBus while logging structured outcomes.
 */
export class HybridAiDirector {
  private primaryProvider: AiProvider | null = null;
  private readonly fallback = new LocalProceduralAiProvider();
  private readonly bus?: EngineEventBus;
  private spriteSink: ((sprite: PixelSpriteResult) => void) | null = null;
  private taskSeq = 1;

  constructor(bus?: EngineEventBus, primaryProvider?: AiProvider) {
    this.bus = bus;
    this.primaryProvider = primaryProvider ?? null;
  }

  public setProvider(provider: AiProvider | null): void {
    this.primaryProvider = provider;
    appLogger.info('network', 'ai.director.setProvider', '已切換 AI 提供者', {
      providerId: provider?.id ?? this.fallback.id,
      mode: provider?.mode ?? 'local-procedural',
    });
  }

  public setSpriteSink(sink: ((sprite: PixelSpriteResult) => void) | null): void {
    this.spriteSink = sink;
  }

  public getProviderInfo(): { activeId: string; mode: AiProviderMode; hasRemotePrimary: boolean } {
    if (this.primaryProvider) {
      return {
        activeId: this.primaryProvider.id,
        mode: this.primaryProvider.mode === 'remote-http' ? 'hybrid' : this.primaryProvider.mode,
        hasRemotePrimary: this.primaryProvider.mode === 'remote-http',
      };
    }
    return {
      activeId: this.fallback.id,
      mode: 'local-procedural',
      hasRemotePrimary: false,
    };
  }

  private async runWithFallback<T>(
    kind: string,
    cartridgeId: CartridgeId,
    primaryCall: (() => Promise<T>) | undefined,
    fallbackCall: () => Promise<T>,
  ): Promise<T> {
    const taskId = `ai-${this.taskSeq++}`;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.bus?.emit('ai:task_queued', { taskId, kind, cartridgeId });

    try {
      const providerId = primaryCall && this.primaryProvider ? this.primaryProvider.id : this.fallback.id;
      const result = primaryCall ? await primaryCall() : await fallbackCall();
      const dt = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      this.bus?.emit('ai:task_completed', {
        taskId,
        kind,
        providerId,
        durationMs: dt,
      });
      appLogger.success(
        'network',
        'ai.director.execute',
        `AI 任務完成 (${kind})`,
        { taskId, kind, cartridgeId, providerId },
        dt,
      );
      return result;
    } catch (err) {
      if (primaryCall) {
        // Primary AI call failed (network outage, timeout, or schema error):
        // attempt deterministic local procedural fallback so gameplay never stalls.
        try {
          const result = await fallbackCall();
          const dt = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
          this.bus?.emit('ai:task_completed', {
            taskId,
            kind: `${kind}:fallback`,
            providerId: this.fallback.id,
            durationMs: dt,
          });
          appLogger.warn(
            'network',
            'ai.director.fallback',
            `遠端 AI 失敗，已自動降級至本機程序生成 (${kind})`,
            err,
            { taskId, kind, cartridgeId, fallbackProviderId: this.fallback.id },
            dt,
          );
          return result;
        } catch (fbErr) {
          const dt = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
          this.bus?.emit('ai:task_failed', {
            taskId,
            kind,
            error: fbErr instanceof Error ? fbErr.message : String(fbErr),
          });
          appLogger.error(
            'network',
            'ai.director.execute',
            `AI 主任務與本機保底皆執行失敗 (${kind})`,
            fbErr,
            { taskId, kind, cartridgeId },
            dt,
          );
          throw fbErr;
        }
      }
      const dt = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      this.bus?.emit('ai:task_failed', {
        taskId,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      appLogger.error('network', 'ai.director.execute', `本機 AI 任務失敗 (${kind})`, err, { taskId, kind, cartridgeId }, dt);
      throw err;
    }
  }

  public generateStageRecipe(req: StageRecipeRequest, signal?: AbortSignal): Promise<StageRecipeResult> {
    const primary = this.primaryProvider?.generateStageRecipe;
    return this.runWithFallback(
      'stage-recipe',
      req.cartridgeId,
      primary ? () => primary.call(this.primaryProvider, req, signal) : undefined,
      () => this.fallback.generateStageRecipe(req),
    );
  }

  public generateDynamicDialog(req: DynamicDialogRequest, signal?: AbortSignal): Promise<DynamicDialogResult> {
    const primary = this.primaryProvider?.generateDynamicDialog;
    return this.runWithFallback(
      'dynamic-dialog',
      req.cartridgeId,
      primary ? () => primary.call(this.primaryProvider, req, signal) : undefined,
      () => this.fallback.generateDynamicDialog(req),
    );
  }

  public async generatePixelSprite(req: PixelSpriteRequest, signal?: AbortSignal): Promise<PixelSpriteResult> {
    const primary = this.primaryProvider?.generatePixelSprite;
    const res = await this.runWithFallback(
      'pixel-sprite',
      'sandbox-toybox',
      primary ? () => primary.call(this.primaryProvider, req, signal) : undefined,
      () => this.fallback.generatePixelSprite(req),
    );
    this.spriteSink?.(res);
    return res;
  }

  public adviseTacticalAction(req: TacticalAdviceRequest, signal?: AbortSignal): Promise<TacticalAdviceResult> {
    const primary = this.primaryProvider?.adviseTacticalAction;
    return this.runWithFallback(
      'tactical-advice',
      req.observation.cartridgeId,
      primary ? () => primary.call(this.primaryProvider, req, signal) : undefined,
      () => this.fallback.adviseTacticalAction(req),
    );
  }
}
