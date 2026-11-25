import { CloudSyncClient, isValidShareSlug } from '../core/cloud/index.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';

const LS_API_BASE_KEY = 'pixer_cloud_api_base';
const SS_AUTH_TOKEN_KEY = 'pixer_cloud_auth_token';

function normalizeSlugCandidate(rawId: string): string {
  const cleaned = rawId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
  if (isValidShareSlug(cleaned)) return cleaned;
  const padded = `${cleaned || 'pixer'}-stage`.slice(0, 48).replace(/-+$/g, '');
  return isValidShareSlug(padded) ? padded : 'pixer-stage';
}

function safeStorageGet(storage: 'local' | 'session', key: string): string {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    return store.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function safeStorageSet(storage: 'local' | 'session', key: string, value: string): void {
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}

/**
 * Lazy-loaded Workstation Cloud Publish Modal backed by `CloudSyncClient`:
 * supports optional Edge API / Supabase Bearer token, slug validation,
 * optimistic ETag (`If-Match`) conflict recovery, share URL copying (`?play=<slug>`),
 * and offline `.json` project export when Cloud API is not yet provisioned.
 */
export class CloudPublishModalView {
  public readonly element: HTMLDivElement;
  private readonly ac = new AbortController();

  private readonly apiBaseInput: HTMLInputElement;
  private readonly tokenInput: HTMLInputElement;
  private readonly slugInput: HTMLInputElement;
  private readonly visibilitySelect: HTMLSelectElement;
  private readonly noteInput: HTMLInputElement;
  private readonly statusEl: HTMLDivElement;
  private readonly shareRowEl: HTMLDivElement;
  private readonly shareUrlInput: HTMLInputElement;
  private readonly copyUrlBtn: HTMLButtonElement;
  private readonly forceOverwriteBtn: HTMLButtonElement;
  private readonly exportJsonBtn: HTMLButtonElement;
  private readonly submitBtn: HTMLButtonElement;

  private activeProject: EcsProjectV2 | null = null;
  private readonly slugEtags = new Map<string, string>();
  private conflictRetryWithoutEtag = false;
  private busy = false;

  constructor() {
    const { signal } = this.ac;

    this.element = document.createElement('div');
    this.element.className = 'p7-interop-backdrop';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', '雲端發佈與分享連結');
    this.element.setAttribute('data-testid', 'cloud-publish-modal');

    const dialog = document.createElement('div');
    dialog.className = 'p7-interop-dialog';

    const header = document.createElement('div');
    header.className = 'p7-interop-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'p7-interop-title-wrap';
    const title = document.createElement('h2');
    title.className = 'p7-interop-title';
    title.textContent = '雲端一鍵發佈與 ?play= 分享';
    const subtitle = document.createElement('div');
    subtitle.className = 'p7-interop-subtitle';
    subtitle.textContent =
      '透過 Cloudflare Workers + R2 + Supabase 發布 EcsProjectV2，或直接離線匯出可攜式專案 JSON。';
    titleWrap.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'p7-btn p7-btn-xs';
    closeBtn.textContent = '關閉 (Esc)';
    closeBtn.addEventListener('click', () => this.close(), { signal });
    header.append(titleWrap, closeBtn);

    const body = document.createElement('div');
    body.className = 'p7-interop-body';

    const formCard = document.createElement('div');
    formCard.className = 'p7-rule-card';

    const envBase =
      typeof import.meta.env.VITE_CLOUD_API_BASE === 'string'
        ? import.meta.env.VITE_CLOUD_API_BASE.trim()
        : '';
    const savedBase = safeStorageGet('local', LS_API_BASE_KEY) || envBase;
    const savedToken = safeStorageGet('session', SS_AUTH_TOKEN_KEY);

    this.apiBaseInput = this.createInput('url', savedBase, 'https://api.your-pixer-edge.workers.dev');
    this.tokenInput = this.createInput('password', savedToken, 'Supabase JWT / Bearer Token（選填）');
    this.tokenInput.autocomplete = 'off';
    this.slugInput = this.createInput('text', '', 'obsidian-citadel（3..48 小寫英數與連字號）');
    this.noteInput = this.createInput('text', '', '例如：Wave 3 Boss 過場定稿');

    this.visibilitySelect = document.createElement('select');
    this.visibilitySelect.className = 'p7-select p7-mono';
    for (const [id, label] of [
      ['unlisted', '不公開列冊 (unlisted · 憑連結遊玩)'],
      ['public', '公開精選 (public)'],
      ['private', '僅自己可見 (private)'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      this.visibilitySelect.appendChild(opt);
    }

    formCard.append(
      this.wrapField('Edge API Base URL', this.apiBaseInput),
      this.wrapField('登入授權 Token（僅暫存於本分頁 SessionStorage）', this.tokenInput),
      this.wrapField('分享代號 Slug (?play=<slug>)', this.slugInput),
      this.wrapField('可見權限 Visibility', this.visibilitySelect),
      this.wrapField('版本備註 Note', this.noteInput),
    );

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'p7-interop-status';
    this.statusEl.setAttribute('data-testid', 'cloud-publish-status');

    this.shareRowEl = document.createElement('div');
    this.shareRowEl.className = 'p7-rule-card';
    this.shareRowEl.hidden = true;
    const shareLbl = document.createElement('span');
    shareLbl.className = 'p7-meta-line';
    shareLbl.textContent = '即時遊玩分享連結：';
    const shareBar = document.createElement('div');
    shareBar.className = 'p7-toolbar-group';
    this.shareUrlInput = document.createElement('input');
    this.shareUrlInput.type = 'text';
    this.shareUrlInput.readOnly = true;
    this.shareUrlInput.className = 'p7-input p7-mono';
    this.shareUrlInput.style.flex = '1';
    this.copyUrlBtn = document.createElement('button');
    this.copyUrlBtn.type = 'button';
    this.copyUrlBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
    this.copyUrlBtn.textContent = '複製連結';
    this.copyUrlBtn.addEventListener('click', () => {
      void this.copyShareUrl();
    }, { signal });
    shareBar.append(this.shareUrlInput, this.copyUrlBtn);
    this.shareRowEl.append(shareLbl, shareBar);

    body.append(formCard, this.statusEl, this.shareRowEl);

    const footer = document.createElement('div');
    footer.className = 'p7-interop-footer';

    this.exportJsonBtn = document.createElement('button');
    this.exportJsonBtn.type = 'button';
    this.exportJsonBtn.className = 'p7-btn';
    this.exportJsonBtn.setAttribute('data-testid', 'cloud-export-json');
    this.exportJsonBtn.textContent = '匯出專案 JSON';
    this.exportJsonBtn.addEventListener('click', () => this.downloadProjectJson(), { signal });

    const actions = document.createElement('div');
    actions.className = 'p7-interop-footer-actions';

    this.forceOverwriteBtn = document.createElement('button');
    this.forceOverwriteBtn.type = 'button';
    this.forceOverwriteBtn.className = 'p7-btn p7-btn-danger';
    this.forceOverwriteBtn.hidden = true;
    this.forceOverwriteBtn.textContent = '強制覆寫遠端 ETag';
    this.forceOverwriteBtn.addEventListener('click', () => {
      this.conflictRetryWithoutEtag = true;
      void this.handlePublish();
    }, { signal });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'p7-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => this.close(), { signal });

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.className = 'p7-btn p7-btn-accent';
    this.submitBtn.setAttribute('data-testid', 'cloud-publish-submit');
    this.submitBtn.textContent = '發佈至雲端並產生連結';
    this.submitBtn.addEventListener('click', () => {
      this.conflictRetryWithoutEtag = false;
      void this.handlePublish();
    }, { signal });

    actions.append(this.forceOverwriteBtn, cancelBtn, this.submitBtn);
    footer.append(this.exportJsonBtn, actions);

    dialog.append(header, body, footer);
    this.element.appendChild(dialog);

    this.element.addEventListener(
      'click',
      (e) => {
        if (e.target === this.element) this.close();
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.element.hidden && e.code === 'Escape') {
          e.preventDefault();
          this.close();
        }
      },
      { signal },
    );

    const refreshGuidance = () => this.syncGuidanceStatus();
    this.apiBaseInput.addEventListener('input', refreshGuidance, { signal });
    this.slugInput.addEventListener('input', () => {
      this.forceOverwriteBtn.hidden = true;
      this.syncGuidanceStatus();
    }, { signal });
  }

  private createInput(type: string, value: string, placeholder: string): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'p7-input p7-mono';
    inp.value = value;
    inp.placeholder = placeholder;
    return inp;
  }

  private wrapField(label: string, control: HTMLElement): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'p7-rule-field';
    const span = document.createElement('span');
    span.textContent = label;
    row.append(span, control);
    return row;
  }

  public isOpen(): boolean {
    return !this.element.hidden;
  }

  public open(project: EcsProjectV2): void {
    this.activeProject = project;
    this.slugInput.value = normalizeSlugCandidate(project.meta.id);
    this.forceOverwriteBtn.hidden = true;
    this.shareRowEl.hidden = true;
    this.conflictRetryWithoutEtag = false;
    this.element.hidden = false;
    this.syncGuidanceStatus();
  }

  public close(): void {
    this.element.hidden = true;
  }

  private setStatus(kind: 'neutral' | 'ok' | 'error', text: string): void {
    this.statusEl.className =
      kind === 'ok'
        ? 'p7-interop-status is-ok'
        : kind === 'error'
          ? 'p7-interop-status is-error'
          : 'p7-interop-status';
    this.statusEl.textContent = text;
  }

  private syncGuidanceStatus(): void {
    const apiBase = this.apiBaseInput.value.trim();
    const slug = this.slugInput.value.trim().toLowerCase();
    if (!apiBase) {
      this.setStatus(
        'neutral',
        '尚未設定 Edge API Base URL（請參閱 docs/CLOUD_SETUP.md 佈建 Workers / R2 / Supabase，或先使用「匯出專案 JSON」離線備份）。',
      );
      return;
    }
    if (!isValidShareSlug(slug)) {
      this.setStatus('error', 'Slug 須為 3..48 字元之小寫英數與連字號，例如 obsidian-citadel。');
      return;
    }
    this.setStatus('neutral', `就緒：將發布「${this.activeProject?.meta.title ?? slug}」至 ${apiBase}`);
  }

  private async handlePublish(): Promise<void> {
    if (this.busy || !this.activeProject) return;
    const apiBase = this.apiBaseInput.value.trim();
    const token = this.tokenInput.value.trim();
    const slug = this.slugInput.value.trim().toLowerCase();

    if (!apiBase) {
      this.setStatus(
        'error',
        '請先填入 Edge API Base URL（設定方法見 docs/CLOUD_SETUP.md），或點左下角「匯出專案 JSON」。',
      );
      return;
    }
    if (!isValidShareSlug(slug)) {
      this.setStatus('error', '無效的分享代號 Slug（須為 3..48 字元小寫英數與連字號）。');
      return;
    }
    if (!token) {
      this.setStatus('error', '請填入 Supabase JWT / Bearer Token 後再執行雲端發佈。');
      return;
    }

    safeStorageSet('local', LS_API_BASE_KEY, apiBase);
    safeStorageSet('session', SS_AUTH_TOKEN_KEY, token);

    const client = new CloudSyncClient({ apiBaseUrl: apiBase });
    client.setAuthToken(token);
    const expectedEtag = this.conflictRetryWithoutEtag ? undefined : this.slugEtags.get(slug);

    this.busy = true;
    this.submitBtn.disabled = true;
    this.forceOverwriteBtn.hidden = true;
    this.setStatus('neutral', `正在上傳至雲端 R2 / Supabase（slug=${slug}）...`);

    try {
      const res = await client.publishProject(slug, this.activeProject, {
        visibility: (this.visibilitySelect.value as 'private' | 'unlisted' | 'public') || 'unlisted',
        expectedEtag,
        note: this.noteInput.value.trim() || undefined,
      });

      if (!res.ok) {
        if (res.conflictEtag) {
          this.forceOverwriteBtn.hidden = false;
          this.setStatus(
            'error',
            `遠端版本已更新（ETag 衝突：${res.conflictEtag}），可按「強制覆寫遠端 ETag」覆蓋。`,
          );
        } else {
          this.setStatus('error', `雲端發佈失敗：${res.error ?? '未知錯誤'}`);
        }
        return;
      }

      if (res.etag) {
        this.slugEtags.set(slug, res.etag);
      }
      const shareQuery = res.shareQuery ?? `?play=${slug}`;
      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}${shareQuery}`
          : shareQuery;

      this.shareUrlInput.value = shareUrl;
      this.shareRowEl.hidden = false;
      this.conflictRetryWithoutEtag = false;
      const copied = await this.copyShareUrl(true);
      this.setStatus(
        'ok',
        `發佈成功（ETag ${res.etag || 'ok'}）${copied ? '，已複製分享連結至剪貼簿！' : '，分享連結已產生。'}`,
      );
    } finally {
      this.busy = false;
      this.submitBtn.disabled = false;
    }
  }

  private async copyShareUrl(quiet = false): Promise<boolean> {
    const url = this.shareUrlInput.value.trim();
    if (!url) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        if (!quiet) this.setStatus('ok', '已複製分享連結至剪貼簿！');
        return true;
      }
    } catch {
      // Fallback below
    }
    this.shareUrlInput.focus();
    this.shareUrlInput.select();
    if (!quiet) this.setStatus('neutral', '已選取連結，請按 Ctrl/Cmd+C 複製。');
    return false;
  }

  private downloadProjectJson(): void {
    if (!this.activeProject) return;
    const slug = normalizeSlugCandidate(this.slugInput.value.trim() || this.activeProject.meta.id);
    const json = JSON.stringify(this.activeProject, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.pixer.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus('ok', `已匯出專案 JSON：${slug}.pixer.json`);
  }

  public destroy(): void {
    this.ac.abort();
    this.element.remove();
  }
}
