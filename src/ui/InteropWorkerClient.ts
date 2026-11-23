import {
  loadExternalInteropFiles,
  type DecodedPngImage,
  type InteropBundleFile,
  type InteropImportOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';
import type { InteropWorkerRequest, InteropWorkerResponse } from '../workers/interop.worker.ts';

const WORKER_TIMEOUT_MS = 30_000;

async function decodePngOnMainThread(bytes: Uint8Array): Promise<DecodedPngImage | null> {
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'image/png' });
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bmp, 0, 0);
        const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
        return {
          width: imgData.width,
          height: imgData.height,
          rgba: new Uint8Array(imgData.data.buffer.slice(0)),
        };
      } finally {
        bmp.close();
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface PendingJob {
  resolve: (result: InteropImportResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Main-thread client that offloads heavy external archive/map/sprite parsing
 * (`.zip`, `.aseprite`, `.ldtk`, `.tmj`, `.json`) to `src/workers/interop.worker.ts`,
 * with automatic main-thread fallback when `Worker` or `OffscreenCanvas` is unavailable.
 */
export class InteropWorkerClient {
  private worker: Worker | null = null;
  private workerBroken = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();

  public async parseFiles(
    files: readonly InteropBundleFile[],
    options: InteropImportOptions = {},
  ): Promise<InteropImportResult> {
    const worker = this.ensureWorker();
    if (!worker) {
      return loadExternalInteropFiles(files, (bytes) => decodePngOnMainThread(bytes), options);
    }

    const id = this.nextId++;
    const payloadFiles: { name: string; buffer: ArrayBuffer }[] = [];
    const transferables: ArrayBuffer[] = [];
    for (const f of files) {
      // Copy slice so caller's currentFiles bytes remain reusable for supplementary PNG drops
      const copied = new Uint8Array(f.bytes.byteLength);
      copied.set(f.bytes);
      payloadFiles.push({ name: f.name, buffer: copied.buffer });
      transferables.push(copied.buffer);
    }

    return new Promise<InteropImportResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.resetWorker();
        reject(new Error('外部檔案解析逾時（超過 30 秒），請確認檔案大小是否正常'));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      const req: InteropWorkerRequest = { id, files: payloadFiles, options };
      try {
        worker.postMessage(req, transferables);
      } catch (postErr) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.workerBroken = true;
        this.resetWorker();
        void loadExternalInteropFiles(files, (bytes) => decodePngOnMainThread(bytes), options)
          .then(resolve)
          .catch((fallbackErr) => reject(fallbackErr instanceof Error ? fallbackErr : new Error(String(postErr))));
      }
    });
  }

  public destroy(): void {
    this.resetWorker();
  }

  private ensureWorker(): Worker | null {
    if (this.workerBroken) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      return null;
    }
    try {
      const w = new Worker(new URL('../workers/interop.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (ev: MessageEvent<InteropWorkerResponse>) => {
        const msg = ev.data;
        const job = this.pending.get(msg.id);
        if (!job) return;
        clearTimeout(job.timer);
        this.pending.delete(msg.id);
        if (msg.ok) job.resolve(msg.result);
        else job.reject(new Error(msg.error));
      };
      w.onerror = () => {
        this.workerBroken = true;
        this.resetWorker('Web Worker 解析器發生異常');
      };
      this.worker = w;
      return w;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }

  private resetWorker(rejectReason?: string): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(new Error(rejectReason ?? '外部檔案解析任務已取消'));
    }
    this.pending.clear();
  }
}
