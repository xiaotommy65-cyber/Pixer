import { Unzlib, zlibSync } from 'fflate';
import { encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import type { EcsCustomSpriteDef } from '../ecs/EcsProjectSchema.ts';
import {
  fitRgbaToSpriteBounds,
  sanitizeInteropId,
  sliceRgbaRect,
  type DecodedPngImage,
  type InteropAnimationTag,
  type InteropImportResult,
} from './InteropTypes.ts';

function unzlibBounded(rawBytes: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Unzlib((chunk) => {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`Aseprite 壓縮圖層資料超過預期上限 (${maxBytes} bytes)`);
    }
    chunks.push(chunk);
  });
  stream.push(rawBytes, true);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const ASE_HEADER_MAGIC = 0xa5e0;
const ASE_FRAME_MAGIC = 0xf1fa;

const CHUNK_OLD_PALETTE = 0x0004;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_TAGS = 0x2018;
const CHUNK_PALETTE = 0x2019;

interface AseLayerInfo {
  index: number;
  visible: boolean;
  isGroup: boolean;
  opacity: number;
  name: string;
}

interface AseCelData {
  layerIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  rgba: Uint8Array;
}

function readUtf8(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.length, offset + Math.max(0, length));
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes.subarray(offset, end));
  }
  let out = '';
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function writeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function alphaBlendPixel(
  dst: Uint8Array,
  dstOff: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
): void {
  if (sa <= 0) return;
  const da = dst[dstOff + 3] ?? 0;
  if (sa >= 255 || da === 0) {
    dst[dstOff] = sr;
    dst[dstOff + 1] = sg;
    dst[dstOff + 2] = sb;
    dst[dstOff + 3] = sa;
    return;
  }
  const srcA = sa / 255;
  const dstA = da / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  dst[dstOff] = Math.round((sr * srcA + dst[dstOff] * dstA * (1 - srcA)) / outA);
  dst[dstOff + 1] = Math.round((sg * srcA + dst[dstOff + 1] * dstA * (1 - srcA)) / outA);
  dst[dstOff + 2] = Math.round((sb * srcA + dst[dstOff + 2] * dstA * (1 - srcA)) / outA);
  dst[dstOff + 3] = Math.round(outA * 255);
}

function decodeCelPixelsToRgba(
  rawPixels: Uint8Array,
  w: number,
  h: number,
  colorDepth: number,
  transparentIndex: number,
  palette: readonly [number, number, number, number][],
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const count = w * h;
  if (colorDepth === 32) {
    out.set(rawPixels.subarray(0, Math.min(rawPixels.length, out.length)));
    return out;
  }
  if (colorDepth === 16) {
    for (let i = 0; i < count; i++) {
      const v = rawPixels[i * 2] ?? 0;
      const a = rawPixels[i * 2 + 1] ?? 0;
      const off = i * 4;
      out[off] = v;
      out[off + 1] = v;
      out[off + 2] = v;
      out[off + 3] = a;
    }
    return out;
  }
  if (colorDepth === 8) {
    for (let i = 0; i < count; i++) {
      const idx = rawPixels[i] ?? 0;
      const off = i * 4;
      if (idx === transparentIndex) {
        out[off + 3] = 0;
      } else {
        const c = palette[idx] ?? [255, 0, 255, 255];
        out[off] = c[0];
        out[off + 1] = c[1];
        out[off + 2] = c[2];
        out[off + 3] = c[3];
      }
    }
  }
  return out;
}

/**
 * Pure, DOM-free Aseprite binary (`.ase` / `.aseprite`) specification parser.
 * Supports 32-bit RGBA, 16-bit Grayscale, and 8-bit Indexed color depths,
 * Layer visibility/opacity (`0x2004`), Palette (`0x2019` / `0x0004`), Tags (`0x2018`),
 * and Raw / Linked / Zlib-Compressed Cel chunks (`0x2005` via `fflate.unzlibSync`).
 */
export function parseAsepriteBinary(bytes: Uint8Array, sourceName: string): InteropImportResult {
  const warnings: string[] = [];
  if (bytes.byteLength < 128) {
    throw new Error('Aseprite 檔案長度不足 128 bytes，非有效 .ase/.aseprite 檔');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint16(4, true);
  if (magic !== ASE_HEADER_MAGIC) {
    throw new Error(`Aseprite 檔頭標記錯誤 (0x${magic.toString(16)})，預期 0xA5E0`);
  }

  const frameCount = Math.max(1, dv.getUint16(6, true));
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const colorDepth = dv.getUint16(12, true);
  const transparentIndex = dv.getUint8(28);

  if (width <= 0 || height <= 0 || width > 2048 || height > 2048) {
    throw new Error(`Aseprite 畫布尺寸異常: ${width}×${height}`);
  }
  if (colorDepth !== 32 && colorDepth !== 16 && colorDepth !== 8) {
    throw new Error(`不支援的 Aseprite 色深: ${colorDepth} bpp`);
  }

  const palette: [number, number, number, number][] = Array.from({ length: 256 }, () => [0, 0, 0, 255]);
  const layers: AseLayerInfo[] = [];
  const animationTags: InteropAnimationTag[] = [];
  const frameCels: Map<number, AseCelData>[] = [];

  let offset = 128;
  for (let f = 0; f < frameCount; f++) {
    if (offset + 16 > bytes.byteLength) {
      warnings.push(`影格 ${f} 提前截斷，已略過後續資料`);
      break;
    }
    const frameBytes = dv.getUint32(offset, true);
    const frameMagic = dv.getUint16(offset + 4, true);
    if (frameMagic !== ASE_FRAME_MAGIC || frameBytes < 16) {
      throw new Error(`影格 ${f} 標記錯誤 (0x${frameMagic.toString(16)})`);
    }
    const oldChunks = dv.getUint16(offset + 6, true);
    const newChunks = dv.getUint32(offset + 12, true);
    const chunkCount = newChunks !== 0 ? newChunks : oldChunks;

    const frameEnd = Math.min(bytes.byteLength, offset + frameBytes);
    let chunkPos = offset + 16;
    const celsForFrame = new Map<number, AseCelData>();

    for (let c = 0; c < chunkCount && chunkPos + 6 <= frameEnd; c++) {
      const chunkSize = dv.getUint32(chunkPos, true);
      const chunkType = dv.getUint16(chunkPos + 4, true);
      if (chunkSize < 6) break;
      const dataStart = chunkPos + 6;
      const chunkEnd = Math.min(frameEnd, chunkPos + chunkSize);

      if (chunkType === CHUNK_OLD_PALETTE && dataStart + 2 <= chunkEnd) {
        const packetCount = dv.getUint16(dataStart, true);
        let pPos = dataStart + 2;
        let palIdx = 0;
        for (let p = 0; p < packetCount && pPos + 2 <= chunkEnd; p++) {
          const skip = dv.getUint8(pPos);
          let count = dv.getUint8(pPos + 1);
          pPos += 2;
          palIdx += skip;
          if (count === 0) count = 256;
          for (let k = 0; k < count && pPos + 3 <= chunkEnd; k++) {
            if (palIdx < 256) {
              palette[palIdx] = [dv.getUint8(pPos), dv.getUint8(pPos + 1), dv.getUint8(pPos + 2), 255];
            }
            palIdx++;
            pPos += 3;
          }
        }
      } else if (chunkType === CHUNK_PALETTE && dataStart + 20 <= chunkEnd) {
        const firstIdx = dv.getUint32(dataStart + 4, true);
        const lastIdx = dv.getUint32(dataStart + 8, true);
        let pPos = dataStart + 20;
        for (let idx = firstIdx; idx <= lastIdx && pPos + 6 <= chunkEnd; idx++) {
          const entryFlags = dv.getUint16(pPos, true);
          const r = dv.getUint8(pPos + 2);
          const g = dv.getUint8(pPos + 3);
          const b = dv.getUint8(pPos + 4);
          const a = dv.getUint8(pPos + 5);
          pPos += 6;
          if (entryFlags & 1 && pPos + 2 <= chunkEnd) {
            const nameLen = dv.getUint16(pPos, true);
            pPos += 2 + nameLen;
          }
          if (idx >= 0 && idx < 256) {
            palette[idx] = [r, g, b, a];
          }
        }
      } else if (chunkType === CHUNK_LAYER && dataStart + 18 <= chunkEnd) {
        const flags = dv.getUint16(dataStart, true);
        const layerType = dv.getUint16(dataStart + 2, true);
        const opacity = dv.getUint8(dataStart + 12);
        const nameLen = dv.getUint16(dataStart + 16, true);
        const name = readUtf8(bytes, dataStart + 18, nameLen);
        layers.push({
          index: layers.length,
          visible: (flags & 1) !== 0,
          isGroup: layerType === 1,
          opacity,
          name: name || `layer_${layers.length}`,
        });
      } else if (chunkType === CHUNK_TAGS && dataStart + 10 <= chunkEnd) {
        const tagCount = dv.getUint16(dataStart, true);
        let tPos = dataStart + 10;
        const dirMap = ['forward', 'reverse', 'pingpong', 'pingpong_reverse'] as const;
        for (let t = 0; t < tagCount && tPos + 19 <= chunkEnd; t++) {
          const fromFrame = dv.getUint16(tPos, true);
          const toFrame = dv.getUint16(tPos + 2, true);
          const dirByte = dv.getUint8(tPos + 4);
          const nameLen = dv.getUint16(tPos + 17, true);
          const name = readUtf8(bytes, tPos + 19, nameLen);
          tPos += 19 + nameLen;
          animationTags.push({
            name: name || `tag_${t}`,
            fromFrame,
            toFrame,
            direction: dirMap[dirByte] ?? 'forward',
          });
        }
      } else if (chunkType === CHUNK_CEL && dataStart + 16 <= chunkEnd) {
        const layerIndex = dv.getUint16(dataStart, true);
        const celX = dv.getInt16(dataStart + 2, true);
        const celY = dv.getInt16(dataStart + 4, true);
        const opacity = dv.getUint8(dataStart + 6);
        const celType = dv.getUint16(dataStart + 7, true);
        const payloadStart = dataStart + 16;

        if (celType === 0 && payloadStart + 4 <= chunkEnd) {
          // Raw Image Data
          const cw = dv.getUint16(payloadStart, true);
          const ch = dv.getUint16(payloadStart + 2, true);
          const rawPix = bytes.subarray(payloadStart + 4, chunkEnd);
          const rgba = decodeCelPixelsToRgba(rawPix, cw, ch, colorDepth, transparentIndex, palette);
          celsForFrame.set(layerIndex, { layerIndex, x: celX, y: celY, w: cw, h: ch, opacity, rgba });
        } else if (celType === 1 && payloadStart + 2 <= chunkEnd) {
          // Linked Cel referencing an earlier frame
          const linkedFrame = dv.getUint16(payloadStart, true);
          const srcCel = frameCels[linkedFrame]?.get(layerIndex);
          if (srcCel) {
            celsForFrame.set(layerIndex, { ...srcCel });
          }
        } else if (celType === 2 && payloadStart + 4 <= chunkEnd) {
          // Compressed Image Data (bounded streaming zlib via fflate to prevent zlib-bomb OOM)
          const cw = dv.getUint16(payloadStart, true);
          const ch = dv.getUint16(payloadStart + 2, true);
          const bpp = colorDepth === 32 ? 4 : colorDepth === 16 ? 2 : 1;
          const maxCelBytes = cw * ch * bpp;
          if (cw <= 0 || ch <= 0 || cw > 2048 || ch > 2048 || maxCelBytes > 16 * 1024 * 1024) {
            throw new Error(`Aseprite 壓縮圖層尺寸異常: ${cw}×${ch}`);
          }
          const compressed = bytes.subarray(payloadStart + 4, chunkEnd);
          const inflated = unzlibBounded(compressed, maxCelBytes);
          const rgba = decodeCelPixelsToRgba(inflated, cw, ch, colorDepth, transparentIndex, palette);
          celsForFrame.set(layerIndex, { layerIndex, x: celX, y: celY, w: cw, h: ch, opacity, rgba });
        }
      }

      chunkPos += chunkSize;
    }

    frameCels.push(celsForFrame);
    offset += frameBytes;
  }

  // Composite each frame from visible non-group layers in bottom-to-top order
  const baseId = sanitizeInteropId(sourceName, 'ase_sprite', 44);
  const customSprites: EcsCustomSpriteDef[] = [];
  let warnedResize = false;

  for (let f = 0; f < frameCels.length; f++) {
    const canvas = new Uint8Array(width * height * 4);
    const cels = frameCels[f];
    const layerCount = Math.max(layers.length, ...Array.from(cels.keys()).map((k) => k + 1), 0);

    for (let li = 0; li < layerCount; li++) {
      const layerMeta = layers[li];
      if (layerMeta && (!layerMeta.visible || layerMeta.isGroup)) continue;
      const cel = cels.get(li);
      if (!cel) continue;
      const combinedOpacity =
        ((layerMeta ? layerMeta.opacity : 255) / 255) * (cel.opacity / 255);

      for (let cy = 0; cy < cel.h; cy++) {
        const dy = cel.y + cy;
        if (dy < 0 || dy >= height) continue;
        for (let cx = 0; cx < cel.w; cx++) {
          const dx = cel.x + cx;
          if (dx < 0 || dx >= width) continue;
          const srcOff = (cy * cel.w + cx) * 4;
          const sa = Math.round((cel.rgba[srcOff + 3] ?? 0) * combinedOpacity);
          if (sa <= 0) continue;
          const dstOff = (dy * width + dx) * 4;
          alphaBlendPixel(
            canvas,
            dstOff,
            cel.rgba[srcOff] ?? 0,
            cel.rgba[srcOff + 1] ?? 0,
            cel.rgba[srcOff + 2] ?? 0,
            sa,
          );
        }
      }
    }

    const fitted = fitRgbaToSpriteBounds(canvas, width, height);
    if (fitted.resized && !warnedResize) {
      warnedResize = true;
      warnings.push(
        `原始尺寸 ${width}×${height} 超出單張精靈範圍 (8..128)，已以鄰近取樣適配為 ${fitted.width}×${fitted.height}`,
      );
    }
    const id = frameCels.length === 1 ? baseId : `${baseId}_f${f}`;
    customSprites.push({
      id,
      name: frameCels.length === 1 ? sourceName.replace(/\.(ase|aseprite)$/i, '') : `${baseId} #${f + 1}`,
      width: fitted.width,
      height: fitted.height,
      kind: 'rgba_b64',
      rgbaB64: encodeRgbaToZlibB64(fitted.rgba),
    });
  }

  return {
    format: 'aseprite_bin',
    sourceName,
    summary: `Aseprite 二進位精靈：${customSprites.length} 影格 (${customSprites[0]?.width ?? width}×${customSprites[0]?.height ?? height})`,
    tileSize: 32,
    customSprites,
    tileDefs: [],
    rooms: [],
    portals: [],
    prefabs: [],
    entities: [],
    animationTags,
    warnings,
    missingAssetPaths: [],
  };
}

interface AseJsonFrameEntry {
  filename?: string;
  frame?: { x: number; y: number; w: number; h: number };
}

/**
 * Parses an Aseprite JSON Sprite Sheet (both Array and Hash `frames` formats + `meta.frameTags`)
 * paired with its decoded companion PNG image.
 */
export function parseAsepriteJsonSheet(
  jsonText: string,
  sheetImage: DecodedPngImage | null,
  sourceName: string,
): InteropImportResult {
  const parsed = JSON.parse(jsonText) as {
    frames?: AseJsonFrameEntry[] | Record<string, AseJsonFrameEntry>;
    meta?: {
      image?: string;
      frameTags?: Array<{ name?: string; from?: number; to?: number; direction?: string }>;
    };
  };

  if (!parsed || typeof parsed !== 'object' || !parsed.frames) {
    throw new Error('非有效的 Aseprite JSON Sprite Sheet（缺少 frames 欄位）');
  }

  const warnings: string[] = [];
  const missingAssetPaths: string[] = [];
  const entries: Array<{ label: string; x: number; y: number; w: number; h: number }> = [];

  if (Array.isArray(parsed.frames)) {
    for (let i = 0; i < parsed.frames.length; i++) {
      const f = parsed.frames[i];
      if (!f?.frame) continue;
      entries.push({
        label: f.filename ?? `frame_${i}`,
        x: f.frame.x,
        y: f.frame.y,
        w: f.frame.w,
        h: f.frame.h,
      });
    }
  } else if (typeof parsed.frames === 'object') {
    for (const [k, f] of Object.entries(parsed.frames)) {
      if (!f?.frame) continue;
      entries.push({
        label: k,
        x: f.frame.x,
        y: f.frame.y,
        w: f.frame.w,
        h: f.frame.h,
      });
    }
  }

  const animationTags: InteropAnimationTag[] = [];
  if (Array.isArray(parsed.meta?.frameTags)) {
    for (const t of parsed.meta.frameTags) {
      const dir =
        t.direction === 'reverse' || t.direction === 'pingpong' || t.direction === 'pingpong_reverse'
          ? t.direction
          : 'forward';
      animationTags.push({
        name: String(t.name ?? 'anim'),
        fromFrame: Number(t.from ?? 0),
        toFrame: Number(t.to ?? 0),
        direction: dir,
      });
    }
  }

  const baseId = sanitizeInteropId(sourceName, 'ase_sheet', 42);
  const customSprites: EcsCustomSpriteDef[] = [];

  if (!sheetImage) {
    const imgRef = parsed.meta?.image ?? `${baseId}.png`;
    missingAssetPaths.push(imgRef);
    warnings.push(`尚未提供伴隨圖檔「${imgRef}」，已先建立像素預覽佔位精靈（補傳 PNG 後即可無損切片）。`);
    for (let i = 0; i < Math.min(entries.length, 16); i++) {
      const e = entries[i];
      const w = Math.max(8, Math.min(128, Math.round(e.w || 32)));
      const h = Math.max(8, Math.min(128, Math.round(e.h || 32)));
      customSprites.push({
        id: entries.length === 1 ? baseId : `${baseId}_f${i}`,
        name: e.label,
        width: w,
        height: h,
        kind: 'procedural',
        recipe: {
          pattern: 'crystal',
          baseHex: '#38bdf8',
          secondaryHex: '#1e3a5f',
          accentHex: '#fef08a',
          seed: 101 + i * 17,
        },
      });
    }
  } else {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const sliced = sliceRgbaRect(sheetImage, e.x, e.y, e.w, e.h);
      const fitted = fitRgbaToSpriteBounds(sliced, e.w, e.h);
      customSprites.push({
        id: entries.length === 1 ? baseId : `${baseId}_f${i}`,
        name: e.label,
        width: fitted.width,
        height: fitted.height,
        kind: 'rgba_b64',
        rgbaB64: encodeRgbaToZlibB64(fitted.rgba),
      });
    }
  }

  return {
    format: 'aseprite_json',
    sourceName,
    summary: `Aseprite Sprite Sheet：${customSprites.length} 影格` + (animationTags.length > 0 ? ` · ${animationTags.length} 動畫標籤` : ''),
    tileSize: 32,
    customSprites,
    tileDefs: [],
    rooms: [],
    portals: [],
    prefabs: [],
    entities: [],
    animationTags,
    warnings,
    missingAssetPaths,
  };
}

export interface MinimalAsepriteEncodeOptions {
  width: number;
  height: number;
  frames: Uint8Array[];
  layerName?: string;
  tagName?: string;
  colorDepth?: 32 | 8;
  palette?: readonly [number, number, number, number][];
}

/**
 * Builds a genuine spec-compliant binary `.aseprite` file with Zlib-compressed Cel chunks (`0x2005`),
 * Layer chunk (`0x2004`), optional Palette (`0x2019`), and Tags (`0x2018`).
 * Used by both built-in 1-click Workstation samples and unit tests.
 */
export function encodeMinimalAsepriteBinary(opts: MinimalAsepriteEncodeOptions): Uint8Array {
  const width = Math.max(1, Math.floor(opts.width));
  const height = Math.max(1, Math.floor(opts.height));
  const depth = opts.colorDepth ?? 32;
  const frameCount = Math.max(1, opts.frames.length);

  const buildChunk = (type: number, payload: Uint8Array): Uint8Array => {
    const out = new Uint8Array(6 + payload.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, out.length, true);
    dv.setUint16(4, type, true);
    out.set(payload, 6);
    return out;
  };

  const layerNameBytes = writeUtf8(opts.layerName ?? 'Body');
  const layerPayload = new Uint8Array(18 + layerNameBytes.length);
  const layerDv = new DataView(layerPayload.buffer);
  layerDv.setUint16(0, 1, true); // visible
  layerDv.setUint16(2, 0, true); // normal layer
  layerDv.setUint8(12, 255); // opacity
  layerDv.setUint16(16, layerNameBytes.length, true);
  layerPayload.set(layerNameBytes, 18);
  const layerChunk = buildChunk(CHUNK_LAYER, layerPayload);

  let palChunk: Uint8Array | null = null;
  if (depth === 8 && opts.palette && opts.palette.length > 0) {
    const count = Math.min(256, opts.palette.length);
    const palPayload = new Uint8Array(20 + count * 6);
    const pdv = new DataView(palPayload.buffer);
    pdv.setUint32(0, count, true);
    pdv.setUint32(4, 0, true);
    pdv.setUint32(8, count - 1, true);
    for (let i = 0; i < count; i++) {
      const c = opts.palette[i];
      const off = 20 + i * 6;
      pdv.setUint16(off, 0, true);
      pdv.setUint8(off + 2, c[0]);
      pdv.setUint8(off + 3, c[1]);
      pdv.setUint8(off + 4, c[2]);
      pdv.setUint8(off + 5, c[3]);
    }
    palChunk = buildChunk(CHUNK_PALETTE, palPayload);
  }

  let tagChunk: Uint8Array | null = null;
  if (opts.tagName) {
    const tName = writeUtf8(opts.tagName);
    const tPayload = new Uint8Array(10 + 19 + tName.length);
    const tdv = new DataView(tPayload.buffer);
    tdv.setUint16(0, 1, true); // 1 tag
    tdv.setUint16(10, 0, true); // fromFrame
    tdv.setUint16(12, frameCount - 1, true); // toFrame
    tdv.setUint8(14, 0); // forward
    tdv.setUint16(10 + 17, tName.length, true);
    tPayload.set(tName, 10 + 19);
    tagChunk = buildChunk(CHUNK_TAGS, tPayload);
  }

  const frameBuffers: Uint8Array[] = [];
  for (let f = 0; f < frameCount; f++) {
    const chunks: Uint8Array[] = [];
    if (f === 0) {
      if (palChunk) chunks.push(palChunk);
      chunks.push(layerChunk);
      if (tagChunk) chunks.push(tagChunk);
    }

    const compressed = zlibSync(opts.frames[f], { level: 6 });
    const celPayload = new Uint8Array(20 + compressed.length);
    const cdv = new DataView(celPayload.buffer);
    cdv.setUint16(0, 0, true); // layerIndex 0
    cdv.setInt16(2, 0, true); // x
    cdv.setInt16(4, 0, true); // y
    cdv.setUint8(6, 255); // opacity
    cdv.setUint16(7, 2, true); // compressed image
    cdv.setUint16(16, width, true);
    cdv.setUint16(18, height, true);
    celPayload.set(compressed, 20);
    chunks.push(buildChunk(CHUNK_CEL, celPayload));

    const totalChunksBytes = chunks.reduce((s, ch) => s + ch.length, 0);
    const frameBuf = new Uint8Array(16 + totalChunksBytes);
    const fdv = new DataView(frameBuf.buffer);
    fdv.setUint32(0, frameBuf.length, true);
    fdv.setUint16(4, ASE_FRAME_MAGIC, true);
    fdv.setUint16(6, chunks.length, true);
    fdv.setUint16(8, 180, true); // duration ms
    fdv.setUint32(12, chunks.length, true);

    let pos = 16;
    for (const ch of chunks) {
      frameBuf.set(ch, pos);
      pos += ch.length;
    }
    frameBuffers.push(frameBuf);
  }

  const totalSize = 128 + frameBuffers.reduce((s, fb) => s + fb.length, 0);
  const out = new Uint8Array(totalSize);
  const hdv = new DataView(out.buffer);
  hdv.setUint32(0, totalSize, true);
  hdv.setUint16(4, ASE_HEADER_MAGIC, true);
  hdv.setUint16(6, frameCount, true);
  hdv.setUint16(8, width, true);
  hdv.setUint16(10, height, true);
  hdv.setUint16(12, depth, true);
  hdv.setUint32(14, 1, true); // layer opacity valid
  hdv.setUint16(18, 180, true);
  hdv.setUint8(28, 0); // transparent index
  hdv.setUint16(32, opts.palette?.length ?? 256, true);
  hdv.setUint8(34, 1);
  hdv.setUint8(35, 1);

  let pos = 128;
  for (const fb of frameBuffers) {
    out.set(fb, pos);
    pos += fb.length;
  }
  return out;
}
