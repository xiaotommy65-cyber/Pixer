import fs from 'node:fs';
import { PixerMcpSession } from '../src/core/ai/PixerMcpProtocol.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../src/core/ecs/EcsProjectSchema.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

const MAX_MCP_FRAME_BYTES = 16 * 1024 * 1024; // 16 MiB safety cap per JSON-RPC frame

function loadInitialProject(): EcsProjectV2 {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--project');
  if (idx >= 0 && args[idx + 1]) {
    const raw = fs.readFileSync(args[idx + 1], 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const valid = validateEcsProjectV2(parsed);
    if (!valid.ok) {
      throw new Error(`Invalid ECS project JSON: ${valid.errors.join('; ')}`);
    }
    return parsed as EcsProjectV2;
  }
  return OBSIDIAN_CITADEL_PROJECT;
}

/**
 * Byte-accurate JSON-RPC framing parser supporting BOTH:
 * - LSP / MCP `Content-Length: <utf8-bytes>\r\n\r\n<payload>` framing (multi-byte UTF-8 safe)
 * - Newline-delimited JSON-RPC 2.0 (`\n`) framing (MCP stdio standard)
 */
export function createMcpFrameReader(onMessage: (utf8Payload: string) => void): (chunk: Buffer) => void {
  let buf: Buffer = Buffer.alloc(0);

  return (chunk: Buffer): void => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

    while (buf.length > 0) {
      // Skip leading blank lines between messages
      let skip = 0;
      while (skip < buf.length && (buf[skip] === 0x0d || buf[skip] === 0x0a)) {
        skip++;
      }
      if (skip > 0) {
        buf = buf.subarray(skip);
        if (buf.length === 0) break;
      }

      // Detect Content-Length header case-insensitively at frame boundary
      const headProbe = buf.subarray(0, Math.min(buf.length, 64)).toString('ascii');
      if (/^Content-Length:/i.test(headProbe)) {
        let sepIdx = buf.indexOf('\r\n\r\n');
        let sepLen = 4;
        const lfSepIdx = buf.indexOf('\n\n');
        if (lfSepIdx !== -1 && (sepIdx === -1 || lfSepIdx < sepIdx)) {
          sepIdx = lfSepIdx;
          sepLen = 2;
        }
        if (sepIdx === -1) break; // Incomplete header

        const headerText = buf.subarray(0, sepIdx).toString('ascii');
        const match = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          buf = buf.subarray(sepIdx + sepLen);
          continue;
        }
        const contentLength = Number(match[1]);
        if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_MCP_FRAME_BYTES) {
          throw new Error(`Invalid MCP Content-Length: ${match[1]}`);
        }
        const bodyStart = sepIdx + sepLen;
        if (buf.length < bodyStart + contentLength) break; // Wait for more UTF-8 bytes

        const bodyText = buf.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
        buf = buf.subarray(bodyStart + contentLength);
        onMessage(bodyText);
        continue;
      }

      // Newline-delimited JSON-RPC fallback
      const nlIdx = buf.indexOf(0x0a);
      if (nlIdx === -1) break;
      const lineText = buf.subarray(0, nlIdx).toString('utf8');
      buf = buf.subarray(nlIdx + 1);
      onMessage(lineText);
    }
  };
}

/**
 * Local Pixer MCP Stdio Server (Zero external packages).
 * Supports both newline-delimited JSON-RPC 2.0 (MCP stdio standard) and UTF-8 byte-accurate Content-Length framing.
 * Usage: npm run mcp [-- --project path/to/project.json]
 */
function main(): void {
  const mcp = new PixerMcpSession(loadInitialProject());

  const sendResponse = (payload: unknown): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const handlePayloadText = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON payload' },
      });
      return;
    }
    const resp = mcp.handleRequest(parsed);
    if (resp !== null) sendResponse(resp);
  };

  const feedChunk = createMcpFrameReader(handlePayloadText);
  process.stdin.on('data', (chunk: Buffer | string) => {
    try {
      feedChunk(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    } catch (err) {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: err instanceof Error ? err.message : 'Invalid MCP frame' },
      });
    }
  });
}

// Only start stdio listener when executed directly as CLI entry point (keeps createMcpFrameReader unit-testable)
if (
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/pixer-mcp.ts')
) {
  main();
}
