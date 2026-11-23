import {
  loadExternalInteropFiles,
  type DecodedPngImage,
  type InteropBundleFile,
  type InteropImportOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';

export interface InteropWorkerRequest {
  id: number;
  files: { name: string; buffer: ArrayBuffer }[];
  options: InteropImportOptions;
}

export type InteropWorkerResponse =
  | { id: number; ok: true; result: InteropImportResult }
  | { id: number; ok: false; error: string };

async function decodePngInWorker(bytes: Uint8Array): Promise<DecodedPngImage | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
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
  } catch {
    return null;
  }
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<InteropWorkerRequest>) => void) | null;
  postMessage: (msg: InteropWorkerResponse) => void;
};

workerScope.onmessage = (ev: MessageEvent<InteropWorkerRequest>) => {
  const { id, files, options } = ev.data;
  const bundleFiles: InteropBundleFile[] = files.map((f) => ({
    name: f.name,
    bytes: new Uint8Array(f.buffer),
  }));

  void loadExternalInteropFiles(bundleFiles, (bytes) => decodePngInWorker(bytes), options)
    .then((result) => {
      workerScope.postMessage({ id, ok: true, result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      workerScope.postMessage({ id, ok: false, error: message });
    });
};
