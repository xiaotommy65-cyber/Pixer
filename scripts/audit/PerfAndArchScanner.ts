/// <reference types="node" />
import path from 'node:path';
import {
  findAllMatchingLines,
  findFirstLine,
  readTextSafe,
  relPosix,
  walkFiles,
  type AuditFinding,
  type AuditOptions,
  type AuditSectionReport,
} from './AuditTypes.ts';

function scanHotPathGc(rootDir: string, findings: AuditFinding[]): Record<string, number> {
  const snapFiles = [
    'src/core/ecs/EcsSnapshotProjector.ts',
    'src/core/sim/DataRuntimeSnapshot.ts',
  ];
  let snapshotArrayResets = 0;

  for (const rel of snapFiles) {
    const text = readTextSafe(path.join(rootDir, rel));
    const lines = findAllMatchingLines(text, /\.(length\s*=\s*0)\b/);
    snapshotArrayResets += lines.length;
    if (lines.length > 0 && /\.push\s*\(/.test(text)) {
      findings.push({
        id: 'PERF-ARRAY-THRASH',
        severity: 'critical',
        category: 'perf',
        file: rel,
        line: lines[0],
        message: `Hot snapshot array \`length = 0\` (${lines.length} sites) + \`.push()\` causes ~6.9 KB/frame backing-store reallocation.`,
      });
    }
  }

  // Dynamic import() check across src/
  const srcFiles = walkFiles(rootDir, 'src', ['.ts']);
  let dynamicImportCount = 0;
  for (const abs of srcFiles) {
    const text = readTextSafe(abs);
    const matches = text.match(/\bimport\s*\(/g);
    if (matches) dynamicImportCount += matches.length;
  }
  if (dynamicImportCount === 0) {
    findings.push({
      id: 'PERF-NO-CODE-SPLIT',
      severity: 'warn',
      category: 'perf',
      file: 'src/main.ts',
      line: 1,
      message: 'Zero dynamic `import()` calls across src/; vite.config.ts manualChunks load eagerly on initial boot.',
    });
  }

  // WebGL2 texImage3D reallocation on atlas upload
  const gl2Path = 'src/core/gpu/WebGl2Backend.ts';
  const gl2Text = readTextSafe(path.join(rootDir, gl2Path));
  const tex3dLines = findAllMatchingLines(gl2Text, /gl\.texImage3D\s*\(/);
  if (tex3dLines.length > 0) {
    findings.push({
      id: 'PERF-GL2-TEX3D-REALLOC',
      severity: 'warn',
      category: 'perf',
      file: gl2Path,
      line: tex3dLines[0],
      message: `WebGl2Backend.uploadAtlas calls gl.texImage3D (${tex3dLines.length} sites) reallocating full 3D atlas storage instead of texSubImage3D on dirty pages.`,
    });
  }

  // Canvas2D per-frame gradient allocations
  const c2dPath = 'src/core/gpu/Canvas2DBackend.ts';
  const c2dText = readTextSafe(path.join(rootDir, c2dPath));
  const gradLines = findAllMatchingLines(c2dText, /create(?:Linear|Radial)Gradient\s*\(/);
  if (gradLines.length > 0) {
    findings.push({
      id: 'PERF-C2D-GRADIENT',
      severity: 'info',
      category: 'perf',
      file: c2dPath,
      line: gradLines[0],
      message: `Canvas2DBackend creates ${gradLines.length} CanvasGradient allocations in draw paths.`,
    });
  }

  // EcsWorldMapController per-frame collides closure + uncached A*
  const wmcPath = 'src/core/ecs/EcsWorldMapController.ts';
  const wmcText = readTextSafe(path.join(rootDir, wmcPath));
  const collidesLine = findFirstLine(wmcText, /const\s+collides\s*=\s*\(/);
  if (collidesLine !== undefined) {
    findings.push({
      id: 'PERF-WMC-CLOSURE',
      severity: 'warn',
      category: 'perf',
      file: wmcPath,
      line: collidesLine,
      message: 'moveWithTileCollision allocates a fresh `collides` closure on every call.',
    });
  }

  // Legacy StudioSession boot instantiation
  const mainText = readTextSafe(path.join(rootDir, 'src/main.ts'));
  const legacyStudioLine = findFirstLine(mainText, /new\s+StudioSession\s*\(/);
  if (legacyStudioLine !== undefined) {
    findings.push({
      id: 'ARCH-LEGACY-STUDIO-BOOT',
      severity: 'info',
      category: 'arch',
      file: 'src/main.ts',
      line: legacyStudioLine,
      message: 'Boot eagerly constructs legacy `new StudioSession(...)` solely for AgentBridge.',
    });
  }

  return {
    snapshotArrayResets,
    dynamicImportCount,
  };
}

function scanDeadAndDuplicateCss(rootDir: string, findings: AuditFinding[]): Record<string, number> {
  const cssFiles = walkFiles(rootDir, 'src/styles', ['.css']);
  const refFiles = [
    ...walkFiles(rootDir, 'src', ['.ts', '.html']),
    path.join(rootDir, 'index.html'),
  ];
  const refCorpus = refFiles.map((f) => readTextSafe(f)).join('\n');

  const classToFiles = new Map<string, Set<string>>();
  let totalDeadClasses = 0;
  let totalImportant = 0;

  for (const abs of cssFiles) {
    const rel = relPosix(rootDir, abs);
    const text = readTextSafe(abs);
    const impMatches = text.match(/!important\b/g);
    if (impMatches) totalImportant += impMatches.length;

    const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const classMatches = clean.matchAll(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    const uniqueInFile = new Set<string>();
    for (const m of classMatches) {
      const cls = m[1];
      // Ignore numeric decimals like .5rem or CSS pseudo-classes
      if (/^\d/.test(cls)) continue;
      uniqueInFile.add(cls);
      if (!classToFiles.has(cls)) classToFiles.set(cls, new Set());
      classToFiles.get(cls)?.add(rel);
    }

    const deadInFile: string[] = [];
    for (const cls of uniqueInFile) {
      if (!refCorpus.includes(cls)) deadInFile.push(cls);
    }
    totalDeadClasses += deadInFile.length;
    if (deadInFile.length > 0) {
      findings.push({
        id: 'CSS-DEAD-CLASSES',
        severity: deadInFile.length >= 20 ? 'warn' : 'info',
        category: 'css',
        file: rel,
        message: `${deadInFile.length} CSS class(es) appear unreferenced in src/ & index.html (e.g. .${deadInFile.slice(0, 4).join(', .')}).`,
      });
    }
  }

  let duplicateSelectors = 0;
  for (const [cls, files] of classToFiles) {
    if (files.size >= 3) {
      duplicateSelectors++;
      if (duplicateSelectors <= 3) {
        findings.push({
          id: 'CSS-CROSS-FILE-DUP',
          severity: 'info',
          category: 'css',
          file: [...files][0],
          message: `Selector \`.${cls}\` is defined across ${files.size} stylesheets (${[...files].join(', ')}).`,
        });
      }
    }
  }

  return {
    cssFiles: cssFiles.length,
    totalDeadClasses,
    duplicateSelectors3Plus: duplicateSelectors,
    totalImportant,
  };
}

function scanCommandCatalogParity(rootDir: string, findings: AuditFinding[]): Record<string, number> {
  const sessionPath = 'src/core/ecs/EcsStudioSession.ts';
  const sessionText = readTextSafe(path.join(rootDir, sessionPath));

  const cmdBlockMatch = sessionText.match(/export\s+type\s+EcsStudioCommand\s*=([\s\S]*?);\s*\r?\n\s*export\s+const\s+ECS_COMMAND_CATALOG/);
  const catBlockMatch = sessionText.match(/export\s+const\s+ECS_COMMAND_CATALOG[\s\S]*?=\s*\[([\s\S]*?)\]\s*as\s+const/);

  const cmdTypes = new Set<string>();
  const catalogTypes = new Set<string>();

  if (cmdBlockMatch) {
    for (const m of cmdBlockMatch[1].matchAll(/type:\s*'([a-z0-9_]+)'/g)) {
      cmdTypes.add(m[1]);
    }
  }
  if (catBlockMatch) {
    for (const m of catBlockMatch[1].matchAll(/\{\s*type:\s*'([a-z0-9_]+)'/g)) {
      catalogTypes.add(m[1]);
    }
  }

  const missingFromCatalog = [...cmdTypes].filter((t) => !catalogTypes.has(t));
  if (missingFromCatalog.length > 0) {
    findings.push({
      id: 'ARCH-CATALOG-DRIFT',
      severity: 'warn',
      category: 'arch',
      file: sessionPath,
      line: findFirstLine(sessionText, /ECS_COMMAND_CATALOG/),
      message: `ECS_COMMAND_CATALOG misses ${missingFromCatalog.length} EcsStudioCommand type(s): ${missingFromCatalog.join(', ')}.`,
    });
  }

  return {
    ecsCommandTypes: cmdTypes.size,
    catalogEntries: catalogTypes.size,
  };
}

export function runPerfAndArchScanner(opts: AuditOptions): AuditSectionReport {
  const findings: AuditFinding[] = [];
  const gcStats = scanHotPathGc(opts.rootDir, findings);
  const cssStats = scanDeadAndDuplicateCss(opts.rootDir, findings);
  const catalogStats = scanCommandCatalogParity(opts.rootDir, findings);

  return {
    name: 'Zero-GC Performance, Coupling & CSS Bloat Audit',
    summary: {
      ...gcStats,
      ...cssStats,
      ...catalogStats,
      findingsCount: findings.length,
    },
    findings,
  };
}
