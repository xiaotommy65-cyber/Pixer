import fs from 'node:fs';
import { PixerMcpSession } from '../src/core/ai/PixerMcpProtocol.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../src/core/ecs/EcsProjectSchema.ts';
import { RHYTHM_BASTION_PROJECT } from '../src/game/rhythmBastion/RhythmBastionProject.ts';

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
  return RHYTHM_BASTION_PROJECT;
}

/**
 * Local Pixer MCP Stdio Server (Zero external packages).
 * Supports both newline-delimited JSON-RPC 2.0 (MCP stdio standard) and Content-Length framing.
 * Usage: npm run mcp [-- --project path/to/project.json]
 */
function main(): void {
  const mcp = new PixerMcpSession(loadInitialProject());
  let buffer = '';

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

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    while (buffer.length > 0) {
      // Support Content-Length framed messages if client sends LSP-style headers
      const headerMatch = /^Content-Length:\s*(\d+)\r?\n\r?\n/i.exec(buffer);
      if (headerMatch) {
        const len = Number(headerMatch[1]);
        const headerLen = headerMatch[0].length;
        if (Buffer.byteLength(buffer.slice(headerLen), 'utf8') < len) break;
        const body = buffer.slice(headerLen, headerLen + len);
        buffer = buffer.slice(headerLen + len);
        handlePayloadText(body);
        continue;
      }

      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handlePayloadText(line);
    }
  });
}

main();
