/// <reference types="node" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditFinding, AuditOptions, AuditSectionReport, AuditSeverity } from './audit/AuditTypes.ts';
import { runMathScanner } from './audit/MathScanner.ts';
import { runPerfAndArchScanner } from './audit/PerfAndArchScanner.ts';
import { runStatusReport } from './audit/StatusReport.ts';

type SectionKey = 'status' | 'math' | 'perf';

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
  ok: 3,
};

const SEVERITY_TAG: Record<AuditSeverity, string> = {
  critical: '[CRIT]',
  warn: '[WARN]',
  info: '[INFO]',
  ok: '[ OK ]',
};

function parseArgs(argv: readonly string[]): {
  sections: Set<SectionKey>;
  json: boolean;
  verbose: boolean;
  strict: boolean;
  runGate: boolean;
  includeBuild: boolean;
  help: boolean;
} {
  const sections = new Set<SectionKey>(['status', 'math', 'perf']);
  let json = false;
  let verbose = false;
  let strict = false;
  let runGate = false;
  let includeBuild = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--verbose' || arg === '-v') verbose = true;
    else if (arg === '--strict') strict = true;
    else if (arg === '--gate') runGate = true;
    else if (arg === '--build') includeBuild = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg.startsWith('--only=')) {
      const raw = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
      sections.clear();
      for (const item of raw) {
        if (item === 'status' || item === 'math' || item === 'perf') {
          sections.add(item);
        }
      }
      if (sections.size === 0) {
        throw new Error(`Unknown --only section(s): ${raw.join(',')}. Expected status, math, or perf.`);
      }
    }
  }

  return { sections, json, verbose, strict, runGate, includeBuild, help };
}

function formatTextReport(sections: readonly AuditSectionReport[], verbose: boolean, elapsedMs: number): string {
  const lines: string[] = [];
  let crit = 0;
  let warn = 0;
  let info = 0;

  for (const sec of sections) {
    for (const f of sec.findings) {
      if (f.severity === 'critical') crit++;
      else if (f.severity === 'warn') warn++;
      else if (f.severity === 'info') info++;
    }
  }

  lines.push(`=== Pixer Read-Only Audit (${elapsedMs.toFixed(1)}ms) | critical=${crit} warn=${warn} info=${info} ===`);

  for (const sec of sections) {
    lines.push('');
    lines.push(`## ${sec.name}`);
    const summaryPairs = Object.entries(sec.summary).map(([k, v]) => `${k}=${String(v)}`);
    lines.push(`Summary: ${summaryPairs.join(' | ')}`);

    const sorted: AuditFinding[] = [...sec.findings].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
    const visible = verbose
      ? sorted
      : sorted.filter((f) => f.severity === 'critical' || f.severity === 'warn' || f.severity === 'ok');

    if (visible.length === 0) {
      lines.push('  (no critical/warn findings; pass --verbose for info items)');
    } else {
      for (const f of visible) {
        const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
        lines.push(`  ${SEVERITY_TAG[f.severity]} ${f.id} (${loc}) — ${f.message}`);
      }
      if (!verbose && sorted.length > visible.length) {
        lines.push(`  ... +${sorted.length - visible.length} info item(s) omitted (pass --verbose to expand)`);
      }
    }
  }

  return lines.join('\n');
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      [
        'Usage: node --experimental-strip-types scripts/pixer-audit.ts [options]',
        '',
        'Read-only, non-mutating Pixer diagnostic suite:',
        '  --only=status|math|perf   Run selected scanner(s), comma-separated',
        '  --gate                    Also run lint + sim + test verification gate',
        '  --build                   Include `bun run build` inside --gate',
        '  --verbose, -v             Include info-level findings',
        '  --json                    Emit compact JSON report',
        '  --strict                  Exit 1 if any critical finding is detected',
      ].join('\n'),
    );
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(__dirname, '..');
  const opts: AuditOptions = {
    rootDir,
    verbose: parsed.verbose,
    runGate: parsed.runGate,
    includeBuild: parsed.includeBuild,
  };

  const t0 = performance.now();
  const reports: AuditSectionReport[] = [];
  if (parsed.sections.has('status')) reports.push(runStatusReport(opts));
  if (parsed.sections.has('math')) reports.push(runMathScanner(opts));
  if (parsed.sections.has('perf')) reports.push(runPerfAndArchScanner(opts));
  const elapsedMs = performance.now() - t0;

  if (parsed.json) {
    console.log(JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(1)), reports }, null, 2));
  } else {
    console.log(formatTextReport(reports, parsed.verbose, elapsedMs));
  }

  if (parsed.strict) {
    const hasCritical = reports.some((r) => r.findings.some((f) => f.severity === 'critical'));
    if (hasCritical) process.exitCode = 1;
  }
}

main();
