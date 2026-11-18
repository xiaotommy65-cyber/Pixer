import { validateCartridgeJson, type CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';

export const CARTRIDGE_PNG_KEYWORD = 'pixer-cartridge-v1';
export const MAX_PNG_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_DECOMPRESSED_JSON_BYTES = 512 * 1024;

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0xffffffff): number {
  let c = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

async function compressDeflate(raw: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writePromise = writer.write(copy).then(() => writer.close());
  const out = await new Response(cs.readable).arrayBuffer();
  await writePromise;
  return new Uint8Array(out);
}

async function decompressDeflateBounded(compressed: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(copy).then(() => writer.close()).catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Decompressed cartridge JSON exceeds ${maxBytes} bytes limit`);
        }
        chunks.push(value);
      }
    }
  } finally {
    await writePromise;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const ch of chunks) {
    out.set(ch, offset);
    offset += ch.byteLength;
  }
  return out;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crc = crc32(data, crc32(typeBytes) ^ 0xffffffff);
  view.setUint32(8 + data.byteLength, crc, false);
  return out;
}

/**
 * Embeds a validated CartridgeJsonV1 payload into a PNG binary using a zlib-compressed iTXt chunk.
 */
export async function embedCartridgeIntoPng(pngBytes: Uint8Array, cartridge: CartridgeJsonV1): Promise<Uint8Array> {
  if (!isPngSignature(pngBytes)) {
    throw new Error('Invalid PNG signature');
  }
  const jsonBytes = textEncoder.encode(JSON.stringify(cartridge));
  if (jsonBytes.byteLength > MAX_DECOMPRESSED_JSON_BYTES) {
    throw new Error(`Cartridge JSON exceeds ${MAX_DECOMPRESSED_JSON_BYTES} bytes limit`);
  }
  const compressed = await compressDeflate(jsonBytes);
  const keyBytes = textEncoder.encode(CARTRIDGE_PNG_KEYWORD);
  // iTXt format: keyword\0 + compFlag(1) + compMethod(0) + langTag\0 + translatedKey\0 + compressedText
  const itxtData = new Uint8Array(keyBytes.byteLength + 5 + compressed.byteLength);
  itxtData.set(keyBytes, 0);
  itxtData[keyBytes.byteLength] = 0;
  itxtData[keyBytes.byteLength + 1] = 1;
  itxtData[keyBytes.byteLength + 2] = 0;
  itxtData[keyBytes.byteLength + 3] = 0;
  itxtData[keyBytes.byteLength + 4] = 0;
  itxtData.set(compressed, keyBytes.byteLength + 5);
  const itxtChunk = buildChunk('iTXt', itxtData);

  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  const keptChunks: Uint8Array[] = [PNG_SIG];
  let inserted = false;
  let offset = 8;

  while (offset + 12 <= pngBytes.byteLength) {
    const len = view.getUint32(offset, false);
    if (offset + 12 + len > pngBytes.byteLength) break;
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    const fullChunk = pngBytes.subarray(offset, offset + 12 + len);
    const dataSlice = pngBytes.subarray(offset + 8, offset + 8 + len);

    if (type === 'iTXt' && startsWithKeyword(dataSlice, keyBytes)) {
      offset += 12 + len;
      continue;
    }
    if (type === 'IEND' && !inserted) {
      keptChunks.push(itxtChunk);
      inserted = true;
    }
    keptChunks.push(fullChunk);
    offset += 12 + len;
    if (type === 'IEND') break;
  }

  if (!inserted) {
    keptChunks.push(itxtChunk);
  }

  let totalBytes = 0;
  for (const c of keptChunks) totalBytes += c.byteLength;
  const out = new Uint8Array(totalBytes);
  let pos = 0;
  for (const c of keptChunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function startsWithKeyword(chunkData: Uint8Array, keyBytes: Uint8Array): boolean {
  if (chunkData.byteLength <= keyBytes.byteLength) return false;
  for (let i = 0; i < keyBytes.byteLength; i++) {
    if (chunkData[i] !== keyBytes[i]) return false;
  }
  return chunkData[keyBytes.byteLength] === 0;
}

export type ExtractCartridgePngResult =
  | { ok: true; data: CartridgeJsonV1 }
  | { ok: false; error: string };

/**
 * Extracts and validates CartridgeJsonV1 from a Polaroid PNG iTXt chunk with strict bomb/CRC guards.
 */
export async function extractCartridgeFromPng(pngBytes: Uint8Array): Promise<ExtractCartridgePngResult> {
  if (pngBytes.byteLength > MAX_PNG_FILE_BYTES) {
    return { ok: false, error: `PNG 檔案超過 ${Math.round(MAX_PNG_FILE_BYTES / (1024 * 1024))}MB 上限` };
  }
  if (!isPngSignature(pngBytes)) {
    return { ok: false, error: '不是有效的 PNG 圖檔' };
  }

  const keyBytes = textEncoder.encode(CARTRIDGE_PNG_KEYWORD);
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let offset = 8;

  while (offset + 12 <= pngBytes.byteLength) {
    const len = view.getUint32(offset, false);
    if (len > pngBytes.byteLength - offset - 12) {
      return { ok: false, error: 'PNG 區塊長度損毀' };
    }
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    const dataSlice = pngBytes.subarray(offset + 8, offset + 8 + len);

    if (type === 'iTXt' && startsWithKeyword(dataSlice, keyBytes)) {
      const expectedCrc = view.getUint32(offset + 8 + len, false);
      const actualCrc = crc32(pngBytes.subarray(offset + 4, offset + 8 + len));
      if (expectedCrc !== actualCrc) {
        return { ok: false, error: 'PNG 卡匣區塊 CRC 校驗失敗' };
      }

      const p = keyBytes.byteLength + 1;
      if (p + 2 > dataSlice.byteLength) {
        return { ok: false, error: 'iTXt 標頭格式不完整' };
      }
      const compFlag = dataSlice[p];
      const compMethod = dataSlice[p + 1];
      let cursor = p + 2;
      // Skip language tag (\0) and translated keyword (\0)
      let nullsSeen = 0;
      while (cursor < dataSlice.byteLength && nullsSeen < 2) {
        if (dataSlice[cursor] === 0) nullsSeen++;
        cursor++;
      }
      if (nullsSeen < 2) {
        return { ok: false, error: 'iTXt 語言欄位格式錯誤' };
      }
      const payload = dataSlice.subarray(cursor);

      let rawJsonBytes: Uint8Array;
      try {
        if (compFlag === 1) {
          if (compMethod !== 0) return { ok: false, error: '不支援的 iTXt 壓縮格式' };
          rawJsonBytes = await decompressDeflateBounded(payload, MAX_DECOMPRESSED_JSON_BYTES);
        } else if (compFlag === 0) {
          if (payload.byteLength > MAX_DECOMPRESSED_JSON_BYTES) {
            return { ok: false, error: '卡匣 JSON 超過 512KB 上限' };
          }
          rawJsonBytes = payload;
        } else {
          return { ok: false, error: '不支援的 iTXt 壓縮旗標' };
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '卡匣資料解壓縮失敗' };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(textDecoder.decode(rawJsonBytes));
      } catch {
        return { ok: false, error: '卡匣 JSON 語法解析失敗' };
      }

      const valid = validateCartridgeJson(parsed);
      if (!valid.ok) {
        return { ok: false, error: `卡匣驗證失敗：${valid.errors[0] ?? '格式不符'}` };
      }
      return { ok: true, data: valid.data };
    }

    offset += 12 + len;
    if (type === 'IEND') break;
  }

  return { ok: false, error: '這張 PNG 沒有包含 Pixer 卡匣資料' };
}
