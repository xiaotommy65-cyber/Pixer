import type { GpuEngine } from '../gpu/GpuEngine.ts';
import type { RenderSceneSnapshot } from '../types/WorldTypes.ts';

export interface HudWorldProjector {
  projectWorldX(wx: number, wy: number): number;
  projectWorldY(wy: number, wx?: number, wz?: number): number;
}

/**
 * Renders classic heart/key/star/boss-bar HUD elements and cartridge data-driven `hudPrimitives`
 * across both 2D/2.5D and True 3D camera projections without per-frame allocations.
 */
export function renderSceneHudOverlay(
  gpu: GpuEngine,
  snap: RenderSceneSnapshot,
  viewW: number,
  zoom: number,
  camFracX: number,
  camFracY: number,
  projector: HudWorldProjector,
): void {
  if (!snap.rpgHud && !snap.chronicleHud && !snap.shmupHud && !snap.hideClassicHud) {
    for (let i = 0; i < snap.maxHearts; i++) {
      gpu.drawSpriteRaw(i < snap.hearts ? 'heart_full' : 'heart_empty', 12 + i * 13 + camFracX, 11 + camFracY, 11, 11);
    }

    if (snap.hasKey) {
      gpu.drawSpriteRaw('key', viewW - 14 + camFracX, 11 + camFracY, 12, 12);
    }

    const maxStarIcons = Math.min(snap.starsTotal, 6);
    const activeStars = snap.starsTotal > 6 ? snap.starsCollected % 3 || (snap.starsCollected > 0 ? 3 : 0) : snap.starsCollected;
    const shownCount = snap.starsTotal > 6 ? 3 : maxStarIcons;
    for (let i = 0; i < shownCount; i++) {
      const collected = i < activeStars;
      const baseOffset = snap.hasKey ? 28 : 14;
      gpu.drawSpriteRaw('star_a', viewW - baseOffset - i * 12 + camFracX, 11 + camFracY, 10, 10, false, 0, collected ? '#ffd447' : '#8c9ab5', collected ? 1 : 0.45);
    }

    if (snap.bossMaxHp > 0 && snap.bossHp > 0) {
      const barW = 90;
      const ratio = Math.max(0, Math.min(1, snap.bossHp / snap.bossMaxHp));
      gpu.drawRect(viewW * 0.5 + camFracX, 11 + camFracY, barW + 6, 9, '#2b1d1a', 0.92, 0, false, 0, 1);
      gpu.drawRect(viewW * 0.5 - barW * 0.5 * (1 - ratio) + camFracX, 11 + camFracY, Math.max(2, barW * ratio), 4.5, '#ff708d', 1, 0, false, 0, 1);
    }
  }

  if (snap.hudPrimitives && snap.hudPrimitives.length > 0) {
    for (let i = 0; i < snap.hudPrimitives.length; i++) {
      const p = snap.hudPrimitives[i];
      if (p.kind === 'aim_line') {
        const isWorld = p.worldSpace !== false;
        const wx2 = p.x2 ?? p.x;
        const wy2 = p.y2 ?? p.y;
        const sx1 = isWorld ? projector.projectWorldX(p.x, p.y) : p.x + camFracX;
        const sy1 = isWorld ? projector.projectWorldY(p.y, p.x, 4) : p.y + camFracY;
        const sx2 = isWorld ? projector.projectWorldX(wx2, wy2) : wx2 + camFracX;
        const sy2 = isWorld ? projector.projectWorldY(wy2, wx2, 4) : wy2 + camFracY;
        const alpha = p.alpha ?? 0.7;
        const dotW = Math.max(1.2, isWorld ? p.w * zoom : p.w);
        const dotH = Math.max(1.2, isWorld ? p.h * zoom : p.h);
        for (let d = 1; d <= 9; d++) {
          const t = d * 0.1;
          const dotX = sx1 + (sx2 - sx1) * t;
          const dotY = sy1 + (sy2 - sy1) * t;
          gpu.drawRect(dotX, dotY, dotW, dotH, p.color, alpha * (0.45 + 0.55 * t), 0, true);
        }
        const pulse = 0.75 + 0.25 * Math.sin(snap.timeSec * 10);
        gpu.drawLight(sx2, sy2, Math.max(4, dotW * 2.8) * pulse, p.color, alpha * 0.75, 1.8);
      } else if (p.kind === 'bar') {
        const isWorld = p.worldSpace === true;
        const wcx = p.x + p.w * 0.5;
        const wcy = p.y + p.h * 0.5;
        const cx = isWorld ? projector.projectWorldX(wcx, wcy) : wcx + camFracX;
        const cy = isWorld ? projector.projectWorldY(wcy, wcx, 28) : wcy + camFracY;
        const bw = Math.max(2, isWorld ? p.w * zoom : p.w);
        const bh = Math.max(1, isWorld ? p.h * zoom : p.h);
        const alpha = p.alpha ?? 0.94;
        const rawRatio = p.ratio ?? 1;
        const ratio = Number.isFinite(rawRatio) ? Math.max(0, Math.min(1, rawRatio)) : 0;
        gpu.drawRect(cx, cy, bw + 2, bh + 2, p.bgColor ?? '#1b1426', alpha, 0, false, 0, 1);
        if (ratio > 0.001) {
          const fillW = Math.max(1.5, bw * ratio);
          const fillCx = cx - (bw - fillW) * 0.5;
          gpu.drawRect(fillCx, cy, fillW, bh, p.color, alpha, 0, false, 0, 1);
        }
      } else if (p.kind === 'box') {
        const isWorld = p.worldSpace === true;
        const wcx = p.x + p.w * 0.5;
        const wcy = p.y + p.h * 0.5;
        const cx = isWorld ? projector.projectWorldX(wcx, wcy) : wcx + camFracX;
        const cy = isWorld ? projector.projectWorldY(wcy, wcx, 2) : wcy + camFracY;
        const bw = Math.max(1, isWorld ? p.w * zoom : p.w);
        const bh = Math.max(1, isWorld ? p.h * zoom : p.h);
        gpu.drawRect(cx, cy, bw, bh, p.color, p.alpha ?? 0.9, 0, false, 0, 1);
      } else if (p.kind === 'text') {
        const isWorld = p.worldSpace === true;
        const sx = isWorld ? projector.projectWorldX(p.x, p.y) : p.x + camFracX;
        const sy = isWorld ? projector.projectWorldY(p.y, p.x, 30) : p.y + camFracY;
        gpu.drawPixelText(
          p.text ?? '',
          sx,
          sy,
          p.color,
          p.scale ?? 1,
          p.align ?? 'left',
          p.shadowColor ?? '#120d1e',
          p.alpha ?? 1,
        );
      }
    }
  }
}
