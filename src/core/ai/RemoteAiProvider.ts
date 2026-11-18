import { appLogger } from '../runtime/AppLogger.ts';
import type {
  AiProvider,
  AiProviderMode,
  DynamicDialogRequest,
  DynamicDialogResult,
  StageRecipeRequest,
  StageRecipeResult,
  TacticalAdviceRequest,
  TacticalAdviceResult,
} from './AiTypes.ts';

export interface RemoteHttpAiConfig {
  id?: string;
  baseUrl: string; // e.g. '/api/ai' server proxy (never put API secrets in client!)
  timeoutMs?: number;
}

/**
 * Pluggable HTTP Proxy AI Provider ready for future Gemini / LLM backend routes (`/api/ai/*`).
 * Keeps simulation pure and enforces response timeouts, schema sanitization, and structured audit logging.
 */
export class RemoteHttpAiProvider implements AiProvider {
  public readonly id: string;
  public readonly mode: AiProviderMode = 'remote-http';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: RemoteHttpAiConfig) {
    this.id = cfg.id ?? 'remote-http-proxy';
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = cfg.timeoutMs ?? 8000;
  }

  private async postJson<TReq, TRes>(path: string, body: TReq, externalSignal?: AbortSignal): Promise<TRes> {
    if (typeof fetch !== 'function') {
      const err = new Error('fetch unavailable in current runtime');
      appLogger.error('network', 'ai.remote.fetchCheck', '無法發送 AI 網路請求：執行環境不支援 fetch', err, { path });
      throw err;
    }

    const endpoint = `${this.baseUrl}${path}`;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Serialize request body inside its own try-catch so cyclic objects fail cleanly
    // before opening a network socket or leaking a timeout timer.
    let serializedBody: string;
    try {
      serializedBody = JSON.stringify(body);
    } catch (serializeErr) {
      appLogger.error('parsing', 'ai.remote.serializeBody', `AI 請求序列化失敗 (${path})`, serializeErr, { path });
      throw serializeErr;
    }

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, this.timeoutMs);
    const onExternalAbort = () => ctrl.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializedBody,
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`AI proxy HTTP ${resp.status} (${resp.statusText || 'error'})`);
      }

      // Parse response JSON explicitly so malformed non-JSON proxy errors (e.g. HTML 502)
      // are distinguished from transport errors in diagnostic logs.
      let parsed: TRes;
      try {
        parsed = (await resp.json()) as TRes;
      } catch (parseErr) {
        const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        appLogger.error(
          'parsing',
          'ai.remote.parseResponse',
          `AI 代理回應 JSON 解析失敗 (${path})`,
          parseErr,
          { endpoint, status: resp.status },
          dt,
        );
        throw parseErr;
      }

      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      appLogger.success(
        'network',
        'ai.remote.postJson',
        `AI 網路請求成功 (${path})`,
        { endpoint, status: resp.status, requestBytes: serializedBody.length },
        dt,
      );
      return parsed;
    } catch (err) {
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const reason = timedOut ? 'timeout' : externalSignal?.aborted ? 'aborted' : 'request_failed';
      appLogger.error(
        'network',
        'ai.remote.postJson',
        `AI 網路請求失敗 (${path}: ${reason})`,
        err,
        { endpoint, timeoutMs: this.timeoutMs, reason },
        dt,
      );
      throw err;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async generateStageRecipe(req: StageRecipeRequest, signal?: AbortSignal): Promise<StageRecipeResult> {
    const raw = await this.postJson<StageRecipeRequest, Partial<StageRecipeResult>>('/stage', req, signal);
    if (!raw || typeof raw.payload !== 'string' || raw.payload.trim().length === 0) {
      throw new Error('Invalid stage recipe payload from remote AI provider');
    }
    return {
      kind: raw.kind === 'dnd-module' ? 'dnd-module' : 'sandbox-script',
      payload: raw.payload,
      title: typeof raw.title === 'string' ? raw.title : `AI Stage (${req.theme})`,
      summary: typeof raw.summary === 'string' ? raw.summary : 'AI generated stage',
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [req.theme],
      providerId: this.id,
    };
  }

  public async generateDynamicDialog(req: DynamicDialogRequest, signal?: AbortSignal): Promise<DynamicDialogResult> {
    const raw = await this.postJson<DynamicDialogRequest, Partial<DynamicDialogResult>>('/dialog', req, signal);
    if (!raw || !Array.isArray(raw.lines) || raw.lines.length === 0) {
      throw new Error('Invalid dialog payload from remote AI provider');
    }
    return {
      speaker: typeof raw.speaker === 'string' ? raw.speaker : req.speaker,
      lines: raw.lines.map(String).slice(0, 6),
      choices: Array.isArray(raw.choices)
        ? raw.choices.slice(0, 4).map((c, idx) => ({
            id: typeof c?.id === 'string' ? c.id : `choice_${idx}`,
            label: typeof c?.label === 'string' ? c.label : `Option ${idx + 1}`,
          }))
        : [],
      providerId: this.id,
    };
  }

  public async adviseTacticalAction(req: TacticalAdviceRequest, signal?: AbortSignal): Promise<TacticalAdviceResult> {
    const raw = await this.postJson<TacticalAdviceRequest, Partial<TacticalAdviceResult>>('/advise', req, signal);
    if (!raw || typeof raw.rationale !== 'string') {
      throw new Error('Invalid tactical advice payload from remote AI provider');
    }
    return {
      recommendedActionId: typeof raw.recommendedActionId === 'string' ? raw.recommendedActionId : null,
      rationale: raw.rationale,
      confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      providerId: this.id,
    };
  }
}
