/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { createEmptyInputState, type InputState } from '../../src/core/types/WorldTypes.ts';

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Simulation assertion failed: ${msg}`);
}

export function emptyInput(): InputState {
  return createEmptyInputState();
}

export function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
