import { getCartridgeJson } from '../core/runtime/CartridgeRegistry.ts';
import { embedCartridgeIntoPng } from '../core/runtime/CartridgePngCodec.ts';
import type { CartridgeJsonV1 } from '../core/sim/CartridgeSchema.ts';
import type { CartridgeId, CartridgeMeta } from '../core/types/WorldTypes.ts';
import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { atlasSpriteToCanvas } from './MomoMascot.ts';

interface ArtSpec {
  top: string;
  bottom: string;
  sprites: { id: SpriteId; x: number; y: number; scale: number; flip?: boolean }[];
  ground?: SpriteId;
}

const ART: Record<string, ArtSpec> = {
  'cloudberry-hop': {
    top: '#76c7ff',
    bottom: '#fff3df',
    ground: 'grass',
    sprites: [
      { id: 'cloud_l', x: 6, y: 6, scale: 1 },
      { id: 'cloud_r', x: 22, y: 6, scale: 1 },
      { id: 'star_a', x: 58, y: 8, scale: 1.25 },
      { id: 'slime_a', x: 60, y: 30, scale: 1.25, flip: true },
      { id: 'hero_a', x: 16, y: 18, scale: 1.9 },
    ],
  },
  'sugar-starlight': {
    top: '#243c70',
    bottom: '#f7adc4',
    sprites: [
      { id: 'sparkle', x: 46, y: 4, scale: 0.75 },
      { id: 'sparkle', x: 10, y: 34, scale: 0.6 },
      { id: 'jelly_ufo', x: 58, y: 22, scale: 1.25 },
      { id: 'bolt', x: 36, y: 16, scale: 1 },
      { id: 'ship_a', x: 8, y: 12, scale: 1.9 },
    ],
  },
  'sandbox-toybox': {
    top: '#8fd8ff',
    bottom: '#fff4df',
    ground: 'grass',
    sprites: [
      { id: 'cloud_l', x: 44, y: 8, scale: 1 },
      { id: 'cloud_m', x: 60, y: 8, scale: 1 },
      { id: 'star_b', x: 50, y: 0, scale: 0.9 },
      { id: 'slime_b', x: 58, y: 30, scale: 1.25 },
      { id: 'momo_idle', x: 12, y: 18, scale: 1.9 },
    ],
  },
  'emberkeep-dnd': {
    top: '#18102a',
    bottom: '#3a224d',
    ground: 'stone',
    sprites: [
      { id: 'torch', x: 6, y: 10, scale: 1 },
      { id: 'chest_closed', x: 34, y: 28, scale: 1.1 },
      { id: 'dragon', x: 52, y: 14, scale: 1.5 },
      { id: 'hero_a', x: 10, y: 20, scale: 1.6 },
    ],
  },
  'astral-chronicles': {
    top: '#182442',
    bottom: '#ffd447',
    ground: 'grass',
    sprites: [
      { id: 'astral_core', x: 52, y: 4, scale: 1.25 },
      { id: 'shrine', x: 34, y: 18, scale: 1.25 },
      { id: 'sword_slash', x: 24, y: 18, scale: 1.2 },
      { id: 'ember_warden', x: 54, y: 24, scale: 1.35, flip: true },
      { id: 'hero_a', x: 8, y: 20, scale: 1.65 },
    ],
  },
  'celestial-parkour': {
    top: '#16112e',
    bottom: '#ff5d8f',
    ground: 'stone',
    sprites: [
      { id: 'grapple_ring', x: 34, y: 4, scale: 1 },
      { id: 'crystal_reset', x: 52, y: 8, scale: 1 },
      { id: 'grapple_claw', x: 26, y: 15, scale: 0.9 },
      { id: 'ik_claw', x: 54, y: 22, scale: 1.35, flip: true },
      { id: 'parkour_hero_dash', x: 8, y: 20, scale: 1.65 },
    ],
  },
};

const W = 80;
const H = 50;

interface CardArtCacheEntry {
  revision: number;
  epoch: number;
  urls: Map<CartridgeId, string>;
}

const cardArtCache = new WeakMap<TextureAtlas, CardArtCacheEntry>();
let cardArtEpoch = 0;

export function invalidateCardArtCache(): void {
  cardArtEpoch++;
}

/** Paints a tiny pixel-art cartridge label from live atlas sprites (so the painted hero or custom cartridge shows up). */
export function renderCardArt(atlas: TextureAtlas, id: CartridgeId): string {
  const rev = atlas.getRevision();
  let entry = cardArtCache.get(atlas);
  if (!entry || entry.revision !== rev || entry.epoch !== cardArtEpoch) {
    entry = { revision: rev, epoch: cardArtEpoch, urls: new Map() };
    cardArtCache.set(atlas, entry);
  }
  const cached = entry.urls.get(id);
  if (cached !== undefined) return cached;

  const customJson = !ART[id] ? getCartridgeJson(id) : undefined;
  const st0 = customJson?.stages[0];
  const spec: ArtSpec = ART[id] ?? {
    top: st0?.skyTop ?? '#8fd8ff',
    bottom: st0?.skyBottom ?? '#fff4df',
    ground: st0?.groundTop ?? 'grass',
    sprites: [
      { id: 'cloud_l', x: 46, y: 6, scale: 1 },
      { id: customJson?.archetypes?.star?.sprite ?? 'star_a', x: 58, y: 8, scale: 1.2 },
      { id: customJson?.archetypes?.slime?.sprite ?? 'slime_a', x: 56, y: 28, scale: 1.25, flip: true },
      { id: customJson?.player.sprite ?? 'hero_a', x: 12, y: 18, scale: 1.85 },
    ],
  };

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, spec.top);
  grad.addColorStop(1, spec.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (spec.ground) {
    const g = atlasSpriteToCanvas(atlas, spec.ground);
    for (let x = 0; x < W; x += 16) ctx.drawImage(g, x, H - 8, 16, 16);
  } else {
    ctx.fillStyle = '#fffaf0';
    for (let i = 0; i < 14; i++) {
      ctx.fillRect((i * 29 + 7) % W, (i * 17 + 3) % H, 1, 1);
    }
  }

  for (const s of spec.sprites) {
    const sc = atlasSpriteToCanvas(atlas, s.id);
    const w = Math.round(sc.width * s.scale);
    const h = Math.round(sc.height * s.scale);
    ctx.save();
    if (s.flip) {
      ctx.translate(s.x + w, s.y);
      ctx.scale(-1, 1);
      ctx.drawImage(sc, 0, 0, w, h);
    } else {
      ctx.drawImage(sc, s.x, s.y, w, h);
    }
    ctx.restore();
  }
  const dataUrl = c.toDataURL('image/png');
  entry.urls.set(id, dataUrl);
  return dataUrl;
}

/** Renders a 320x180 pixel cover preview from a CartridgeJsonV1 stage for Workshop Polaroid PNG exports. */
export function renderCartridgeCoverCanvas(atlas: TextureAtlas, cartridge: CartridgeJsonV1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = false;

  const st = cartridge.stages[0];
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, st?.skyTop ?? '#76c7ff');
  grad.addColorStop(1, st?.skyBottom ?? '#fff3df');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  if (st?.tileGrid) {
    const { cols, rows, tiles, spriteMap } = st.tileGrid;
    for (let r = 0; r < rows && r < 12; r++) {
      for (let col = 0; col < cols && col < 20; col++) {
        const tid = tiles[r * cols + col] ?? 0;
        if (tid === 0) continue;
        const sid = spriteMap[String(tid)] ?? 'stone';
        const spr = atlasSpriteToCanvas(atlas, sid);
        ctx.drawImage(spr, col * 16, r * 16 - 12, 16, 16);
      }
    }
  }

  for (const sp of st?.spawns ?? []) {
    if (sp.x >= 320) continue;
    const arch = cartridge.archetypes[sp.archetype];
    if (!arch) continue;
    const spr = atlasSpriteToCanvas(atlas, arch.sprite);
    ctx.drawImage(spr, sp.x, sp.y - 12, arch.w, arch.h);
  }

  if (st?.spawn) {
    const heroSpr = atlasSpriteToCanvas(atlas, cartridge.player.sprite);
    ctx.drawImage(heroSpr, st.spawn.x, st.spawn.y - 12, cartridge.player.w, cartridge.player.h);
  }
  return c;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function buildPolaroidCanvas(
  gameCanvas: HTMLCanvasElement,
  meta: CartridgeMeta | null,
  score: number,
  starsCollected: number,
  starsTotal: number,
  hasCartridgePayload = false,
): HTMLCanvasElement {
  const cardW = 520;
  const cardH = 382;
  const c = document.createElement('canvas');
  c.width = cardW;
  c.height = cardH;
  const ctx = c.getContext('2d');
  if (!ctx) return gameCanvas;

  const accent = meta?.accentHex ?? '#ff8fa8';
  const ink = '#382820';

  ctx.fillStyle = '#f8f1e4';
  ctx.fillRect(0, 0, cardW, cardH);

  const pad = 12;
  const bx = pad;
  const by = pad;
  const bw = cardW - pad * 2;
  const bh = cardH - pad * 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx + 18, by);
  ctx.lineTo(bx + bw - 38, by);
  ctx.lineTo(bx + bw, by + 38);
  ctx.lineTo(bx + bw, by + bh - 18);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - 18, by + bh);
  ctx.lineTo(bx + 18, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - 18);
  ctx.lineTo(bx, by + 18);
  ctx.quadraticCurveTo(bx, by, bx + 18, by);
  ctx.closePath();
  ctx.fillStyle = '#fffdf8';
  ctx.fill();
  ctx.clip();

  ctx.fillStyle = accent;
  ctx.fillRect(bx, by, bw, 56);
  ctx.fillStyle = ink;
  ctx.fillRect(bx, by + 56, bw, 4);
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(bx + 18, by);
  ctx.lineTo(bx + bw - 38, by);
  ctx.lineTo(bx + bw, by + 38);
  ctx.lineTo(bx + bw, by + bh - 18);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - 18, by + bh);
  ctx.lineTo(bx + 18, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - 18);
  ctx.lineTo(bx, by + 18);
  ctx.quadraticCurveTo(bx, by, bx + 18, by);
  ctx.closePath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = ink;
  ctx.stroke();

  ctx.fillStyle = '#fffdf8';
  ctx.font = 'bold 20px "JetBrains Mono", monospace';
  ctx.fillText(meta ? `${meta.code} · ${meta.title}` : 'PIXEL ATELIER · HOME', bx + 20, by + 36);

  const scrX = bx + 22;
  const scrY = by + 72;
  const scrW = bw - 44;
  const scrH = Math.round((scrW * 9) / 16);

  drawRoundedRect(ctx, scrX - 4, scrY - 4, scrW + 8, scrH + 8, 10);
  ctx.fillStyle = '#1c1619';
  ctx.fill();

  ctx.save();
  drawRoundedRect(ctx, scrX, scrY, scrW, scrH, 6);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gameCanvas, scrX, scrY, scrW, scrH);
  ctx.restore();

  const footY = scrY + scrH + 30;
  ctx.fillStyle = ink;
  ctx.font = 'bold 15px "JetBrains Mono", monospace';
  ctx.fillText(hasCartridgePayload ? 'PIXER POLAROID · PLAYABLE PNG' : 'PIXEL ATELIER · GPU CARD', bx + 22, footY);

  const statText = meta ? `SCORE ${score}  ★ ${starsCollected}/${starsTotal}` : 'MOMO IDLE HOME';
  const metrics = ctx.measureText(statText);
  const tagSize = hasCartridgePayload ? 27 : 0;
  const statRight = bx + bw - 22 - (tagSize > 0 ? tagSize + 10 : 0);
  ctx.fillStyle = '#755c4e';
  ctx.fillText(statText, statRight - metrics.width, footY);

  if (hasCartridgePayload) {
    const qx = bx + bw - 22 - tagSize;
    const qy = scrY + scrH + 11;
    let h = 2166136261;
    const tagKey = `${meta?.code ?? 'CUS'}:${meta?.id ?? 'pixer'}`;
    for (let i = 0; i < tagKey.length; i++) {
      h = Math.imul(h ^ tagKey.charCodeAt(i), 16777619) >>> 0;
    }
    ctx.fillStyle = ink;
    for (let r = 0; r < 9; r++) {
      for (let col = 0; col < 9; col++) {
        const corner =
          (r < 3 && col < 3 && (r !== 1 || col !== 1)) ||
          (r < 3 && col > 5 && (r !== 1 || col !== 7)) ||
          (r > 5 && col < 3 && (r !== 7 || col !== 1));
        const bit = ((h >>> ((r * 9 + col) % 24)) ^ (r * 3 + col)) & 1;
        if (corner || (bit === 1 && !(r < 4 && col < 4) && !(r < 4 && col > 4) && !(r > 4 && col < 4))) {
          ctx.fillRect(qx + col * 3, qy + r * 3, 3, 3);
        }
      }
    }
  }
  return c;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas PNG blob conversion failed'));
        return;
      }
      void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Composites a Polaroid cartridge frame around the live GPU canvas screenshot and embeds
 * CartridgeJsonV1 via lossless PNG iTXt (`pixer-cartridge-v1`) whenever cartridgeJson is present.
 */
export async function exportCartridgeCardPngDataUrl(
  gameCanvas: HTMLCanvasElement,
  meta: CartridgeMeta | null,
  score: number,
  starsCollected: number,
  starsTotal: number,
  cartridgeJson?: CartridgeJsonV1,
): Promise<string> {
  const cardCanvas = buildPolaroidCanvas(
    gameCanvas,
    meta,
    score,
    starsCollected,
    starsTotal,
    Boolean(cartridgeJson),
  );
  if (!cartridgeJson) {
    return cardCanvas.toDataURL('image/png');
  }
  const rawBytes = await canvasToPngBytes(cardCanvas);
  const embedded = await embedCartridgeIntoPng(rawBytes, cartridgeJson);
  return bytesToPngDataUrl(embedded);
}
