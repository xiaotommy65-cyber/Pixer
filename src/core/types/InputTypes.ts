export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  action: boolean;
  skillX: boolean;
  skillY: boolean;
  shoulderL: boolean;
  shoulderR: boolean;
  restart: boolean;
  rightStickX: number;
  rightStickY: number;
}

export function createEmptyInputState(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    action: false,
    skillX: false,
    skillY: false,
    shoulderL: false,
    shoulderR: false,
    restart: false,
    rightStickX: 0,
    rightStickY: 0,
  };
}

export interface CartridgeControlProfile {
  a: string;
  b: string;
  x: string;
  y: string;
  l: string;
  r: string;
  rightStick: string;
  legend: string;
}

export interface RuntimeParams {
  gravityScale: number;
  moveSpeed: number;
  jumpPower: number;
  glowIntensity: number;
  sparkleDensity: number;
  enemyCount: number;
  shakeScale: number;
  cozyFilter: number; // 1 = subtle LCD scanline on, 0 = off
}

export interface CartridgeParamDef {
  key: keyof RuntimeParams;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
}

export const DEFAULT_RUNTIME_PARAMS: RuntimeParams = {
  gravityScale: 1.0,
  moveSpeed: 96,
  jumpPower: 220,
  glowIntensity: 1.0,
  sparkleDensity: 1.0,
  enemyCount: 3,
  shakeScale: 1.0,
  cozyFilter: 1,
};

export const CARTRIDGE_PARAM_DEFS: CartridgeParamDef[] = [
  { key: 'gravityScale', label: '重力手感', min: 0.4, max: 1.6, step: 0.1, defaultValue: 1.0, unit: 'x' },
  { key: 'moveSpeed', label: '移動速度', min: 60, max: 150, step: 5, defaultValue: 96, unit: 'px/s' },
  { key: 'jumpPower', label: '跳躍彈力', min: 160, max: 290, step: 10, defaultValue: 220, unit: '' },
  { key: 'glowIntensity', label: 'GPU 光暈強度', min: 0, max: 1.8, step: 0.1, defaultValue: 1.0, unit: 'x' },
  { key: 'sparkleDensity', label: '星星特效粒子', min: 0.2, max: 2.0, step: 0.2, defaultValue: 1.0, unit: 'x' },
  { key: 'shakeScale', label: '震動打擊回饋', min: 0, max: 1.5, step: 0.25, defaultValue: 1.0, unit: 'x' },
  { key: 'enemyCount', label: '秘密基地怪物數', min: 0, max: 8, step: 1, defaultValue: 3, unit: '隻' },
];
