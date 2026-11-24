/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizePosix,
  readTextSafe,
  relPosix,
  walkFiles,
  type AuditFinding,
  type AuditOptions,
  type AuditSectionReport,
} from './AuditTypes.ts';

function tryExec(cmd: string, args: readonly string[], cwd: string): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync(cmd, [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim();
    return { ok: true, stdout };
  } catch (err) {
    const out = (err as { stdout?: Buffer | string; stderr?: Buffer | string }).stdout;
    const errOut = (err as { stderr?: Buffer | string }).stderr;
    const text = `${typeof out === 'string' ? out : ''}\n${typeof errOut === 'string' ? errOut : ''}`.trim();
    return { ok: false, stdout: text };
  }
}

function resolveGitBinary(): string {
  const probe = tryExec('git', ['--version'], process.cwd());
  if (probe.ok) return 'git';
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const winGit = path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe');
    if (fs.existsSync(winGit)) return winGit;
  }
  return 'git';
}

function resolveBunBinary(): string {
  const probe = tryExec('bun', ['--version'], process.cwd());
  if (probe.ok) return 'bun';
  const userHome = process.env.USERPROFILE ?? process.env.HOME;
  if (userHome) {
    const winBun = path.join(userHome, '.bun', 'bin', 'bun.exe');
    if (fs.existsSync(winBun)) return winBun;
  }
  return 'bun';
}

function parseImportTargets(srcText: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null = re.exec(srcText);
  while (match !== null) {
    out.push(match[1]);
    match = re.exec(srcText);
  }
  return out;
}

function resolveRelativeTs(fromRel: string, spec: string, tsSet: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = normalizePosix(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')];
  for (const c of candidates) {
    if (tsSet.has(c)) return c;
  }
  return null;
}

function findCircularDeps(tsSet: Set<string>, adj: Map<string, string[]>): string[][] {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const dfs = (node: string, trail: string[]): void => {
    visited.add(node);
    onStack.add(node);
    for (const nxt of adj.get(node) ?? []) {
      if (!nxt.startsWith('src/')) continue;
      if (onStack.has(nxt)) {
        const idx = trail.indexOf(nxt);
        if (idx >= 0) cycles.push(trail.slice(idx).concat(nxt));
      } else if (!visited.has(nxt)) {
        dfs(nxt, trail.concat(nxt));
      }
    }
    onStack.delete(node);
  };

  for (const f of tsSet) {
    if (f.startsWith('src/') && !visited.has(f)) {
      dfs(f, [f]);
    }
  }
  return cycles;
}

export function runStatusReport(opts: AuditOptions): AuditSectionReport {
  const { rootDir } = opts;
  const findings: AuditFinding[] = [];

  // 1. Toolchain & environment readiness (strictly read-only)
  const gitBin = resolveGitBinary();
  const bunBin = resolveBunBinary();
  const gitVer = tryExec(gitBin, ['--version'], rootDir);
  const bunVer = tryExec(bunBin, ['--version'], rootDir);
  const nodeVer = process.version;
  const hasNodeModules = fs.existsSync(path.join(rootDir, 'node_modules'));
  const hasBunLock = fs.existsSync(path.join(rootDir, 'bun.lock'));
  const hasPkgLock = fs.existsSync(path.join(rootDir, 'package-lock.json'));
  const hasDist = fs.existsSync(path.join(rootDir, 'dist'));
  const hasEnv = fs.existsSync(path.join(rootDir, '.env'));

  if (!hasNodeModules) {
    findings.push({
      id: 'ENV-NO-MODULES',
      severity: 'critical',
      category: 'status',
      file: 'package.json',
      message: 'node_modules is missing; run `bun install --frozen-lockfile`.',
    });
  }
  if (!bunVer.ok) {
    findings.push({
      id: 'ENV-NO-BUN',
      severity: 'warn',
      category: 'status',
      file: 'bun.lock',
      message: 'bun binary not found in PATH or ~/.bun/bin (CI pins Bun 1.4.5).',
    });
  }
  if (hasPkgLock) {
    findings.push({
      id: 'ENV-PKG-LOCK',
      severity: 'critical',
      category: 'arch',
      file: 'package-lock.json',
      message: 'Forbidden package-lock.json present; Pixer enforces single lockfile on bun.lock.',
    });
  }
  if (hasDist) {
    findings.push({
      id: 'HYGIENE-DIST',
      severity: 'info',
      category: 'status',
      file: 'dist',
      message: 'dist/ directory exists; run `bun run clean` before committing.',
    });
  }

  // 2. Git branch & dirty tree check
  let branch = 'unknown';
  let headSha = 'unknown';
  let dirtyCount = 0;
  if (gitVer.ok) {
    const br = tryExec(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD'], rootDir);
    const sha = tryExec(gitBin, ['rev-parse', '--short', 'HEAD'], rootDir);
    const st = tryExec(gitBin, ['status', '--porcelain'], rootDir);
    if (br.ok) branch = br.stdout;
    if (sha.ok) headSha = sha.stdout;
    if (st.ok && st.stdout.length > 0) dirtyCount = st.stdout.split(/\r?\n/).length;
    if (branch === 'main') {
      findings.push({
        id: 'GIT-ON-MAIN',
        severity: 'info',
        category: 'status',
        file: '.git/HEAD',
        message: 'Currently on `main` branch; cut a topic branch before modifying source code.',
      });
    }
  }

  // 3. AGENTS.md budget guard (<= 120 lines)
  const agentsText = readTextSafe(path.join(rootDir, 'AGENTS.md'));
  const agentsLines = agentsText.trimEnd().split(/\r?\n/).length;
  if (agentsLines > 120) {
    findings.push({
      id: 'DOC-AGENTS-BUDGET',
      severity: 'critical',
      category: 'arch',
      file: 'AGENTS.md',
      line: agentsLines,
      message: `AGENTS.md exceeds 120-line budget (${agentsLines} lines).`,
    });
  }

  // 4. LOC, God-file & Dependency Graph audit
  const codeFiles = [
    ...walkFiles(rootDir, 'src', ['.ts', '.css']),
    ...walkFiles(rootDir, 'workers', ['.ts']),
    ...walkFiles(rootDir, 'scripts', ['.ts']),
  ];

  let srcTsLoc = 0;
  let srcCssLoc = 0;
  const godFiles: Array<{ file: string; lines: number }> = [];
  const tsSet = new Set<string>();
  const fileContents = new Map<string, string>();

  for (const abs of codeFiles) {
    const rel = relPosix(rootDir, abs);
    const text = readTextSafe(abs);
    const lines = text.split(/\r?\n/).length;
    if (rel.startsWith('src/')) {
      if (rel.endsWith('.css')) srcCssLoc += lines;
      else srcTsLoc += lines;
    }
    if (lines >= 900 && !rel.startsWith('scripts/sim/')) {
      godFiles.push({ file: rel, lines });
    }
    if (rel.endsWith('.ts')) {
      tsSet.add(rel);
      fileContents.set(rel, text);
    }
  }

  godFiles.sort((a, b) => b.lines - a.lines);
  for (const gf of godFiles) {
    findings.push({
      id: 'ARCH-GOD-FILE',
      severity: gf.lines >= 1200 ? 'warn' : 'info',
      category: 'arch',
      file: gf.file,
      line: gf.lines,
      message: `Large module (${gf.lines} lines); candidate for decomposition.`,
    });
  }

  // 5. Circular dependencies & production reachability
  const adj = new Map<string, string[]>();
  for (const [rel, text] of fileContents) {
    const targets: string[] = [];
    for (const spec of parseImportTargets(text)) {
      const resolved = resolveRelativeTs(rel, spec, tsSet);
      if (resolved) targets.push(resolved);
    }
    adj.set(rel, targets);
  }

  const cycles = findCircularDeps(tsSet, adj);
  for (const cycle of cycles) {
    findings.push({
      id: 'ARCH-CYCLE',
      severity: 'warn',
      category: 'arch',
      file: cycle[0],
      message: `Circular import chain: ${cycle.join(' -> ')}`,
    });
  }

  const prodEntries = ['src/main.ts', 'src/workers/interop.worker.ts', 'workers/api/src/index.ts'];
  const reachable = new Set<string>();
  const queue = prodEntries.filter((e) => tsSet.has(e));
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || reachable.has(cur)) continue;
    reachable.add(cur);
    for (const nxt of adj.get(cur) ?? []) {
      if (!reachable.has(nxt)) queue.push(nxt);
    }
  }

  const unreachableSrc: string[] = [];
  for (const rel of tsSet) {
    if (rel.startsWith('src/') && !reachable.has(rel)) {
      unreachableSrc.push(rel);
    }
  }
  if (unreachableSrc.length > 0) {
    findings.push({
      id: 'ARCH-UNREACHABLE',
      severity: 'info',
      category: 'arch',
      file: unreachableSrc[0],
      message: `${unreachableSrc.length} src/*.ts module(s) unreachable from app/worker/api entries: ${unreachableSrc.join(', ')}`,
    });
  }

  // 6. Optional Gate Execution (--gate)
  let gateSummary = 'skipped (pass --gate to run)';
  if (opts.runGate) {
    const lintRes = tryExec(bunBin, ['run', 'lint'], rootDir);
    const simRes = lintRes.ok ? tryExec(bunBin, ['run', 'sim'], rootDir) : { ok: false, stdout: '' };
    const testRes = simRes.ok
      ? tryExec('node', ['--experimental-strip-types', '--test', 'scripts/sim/EcsCore.test.ts', 'scripts/sim/WorldMap.test.ts', 'scripts/sim/Engine10Core.test.ts', 'scripts/sim/Interop.test.ts', 'scripts/sim/DualPerspective3D.test.ts', 'scripts/sim/Hd2dFeel.test.ts', 'scripts/sim/CloudOffload.test.ts'], rootDir)
      : { ok: false, stdout: '' };
    const buildRes = testRes.ok && opts.includeBuild ? tryExec(bunBin, ['run', 'build'], rootDir) : null;

    const benchLines = simRes.stdout
      .split(/\r?\n/)
      .filter((l) => /\[BENCH\]|\[SIM BENCH\]|\[SIM ALL PASSED\]/.test(l))
      .map((l) => l.trim());
    const testMatch = testRes.stdout.match(/pass\s+(\d+)[\s\S]*?fail\s+(\d+)/i);
    const testCounts = testMatch ? `${testMatch[1]} pass / ${testMatch[2]} fail` : testRes.ok ? 'PASS' : 'FAIL';

    gateSummary = `lint=${lintRes.ok ? 'PASS' : 'FAIL'}, sim=${simRes.ok ? 'PASS' : 'FAIL'}, test=${testCounts}${
      buildRes ? `, build=${buildRes.ok ? 'PASS' : 'FAIL'}` : ''
    }`;

    if (!lintRes.ok || !simRes.ok || !testRes.ok || (buildRes !== null && !buildRes.ok)) {
      findings.push({
        id: 'GATE-FAIL',
        severity: 'critical',
        category: 'status',
        file: 'package.json',
        message: `Verification gate failed (${gateSummary}).`,
      });
    } else if (benchLines.length > 0) {
      findings.push({
        id: 'GATE-BENCH',
        severity: 'ok',
        category: 'perf',
        file: 'scripts/headless-sim.ts',
        message: benchLines.join(' | '),
      });
    }
  }

  return {
    name: 'Status & Architecture Snapshot',
    summary: {
      node: nodeVer,
      bun: bunVer.ok ? bunVer.stdout : 'missing',
      git: gitVer.ok ? `${branch}@${headSha} (dirty=${dirtyCount})` : 'missing',
      nodeModules: hasNodeModules,
      singleBunLock: hasBunLock && !hasPkgLock,
      agentsLines: `${agentsLines}/120`,
      cloudEnvConfigured: hasEnv,
      srcTsLoc,
      srcCssLoc,
      godFilesCount: godFiles.length,
      circularDepsCount: cycles.length,
      gate: gateSummary,
    },
    findings,
  };
}
