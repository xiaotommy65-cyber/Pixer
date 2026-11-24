/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

export type AuditSeverity = 'critical' | 'warn' | 'info' | 'ok';

export interface AuditFinding {
  readonly id: string;
  readonly severity: AuditSeverity;
  readonly category: 'status' | 'math' | 'shader' | 'perf' | 'arch' | 'css';
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

export interface AuditSectionReport {
  readonly name: string;
  readonly summary: Record<string, string | number | boolean>;
  readonly findings: readonly AuditFinding[];
}

export interface AuditOptions {
  readonly rootDir: string;
  readonly verbose: boolean;
  readonly runGate: boolean;
  readonly includeBuild: boolean;
}

export function normalizePosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function relPosix(rootDir: string, absPath: string): string {
  return normalizePosix(path.relative(rootDir, absPath));
}

export function walkFiles(
  rootDir: string,
  relSubDir: string,
  exts: readonly string[],
  out: string[] = [],
): string[] {
  const start = path.join(rootDir, relSubDir);
  if (!fs.existsSync(start)) return out;
  const stack: string[] = [start];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
        stack.push(path.join(cur, ent.name));
      } else if (exts.some((ext) => ent.name.endsWith(ext))) {
        out.push(path.join(cur, ent.name));
      }
    }
  }
  out.sort();
  return out;
}

export function readTextSafe(absPath: string): string {
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
}

export function findFirstLine(text: string, pattern: RegExp): number | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return undefined;
}

export function findAllMatchingLines(
  text: string,
  pattern: RegExp,
  maxMatches = 8,
): number[] {
  const lines = text.split(/\r?\n/);
  const matched: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matched.push(i + 1);
      if (matched.length >= maxMatches) break;
    }
  }
  return matched;
}
