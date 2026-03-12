import { join } from 'path';
import process from 'process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type CompactToolResult = Awaited<ReturnType<Client['callTool']>>;
export type CompactToolDefinition = Awaited<ReturnType<Client['listTools']>>['tools'][number];

function getBuildRoot(): string {
  return join(import.meta.dirname, '..');
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const root = getBuildRoot();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'index.js')],
    cwd: root,
    env: {
      ...process.env,
      GOPEAK_TOOL_PROFILE: process.env.GOPEAK_TOOL_PROFILE || 'compact',
    },
    stderr: 'pipe',
  });

  const client = new Client({
    name: 'gopeak-cli-prototype',
    version: '0.0.0',
  });

  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await transport.close();
  }
}

export async function callCompactTool(name: string, args: Record<string, unknown> = {}): Promise<CompactToolResult> {
  return withClient((client) => client.callTool({ name, arguments: args }));
}

export async function listCompactTools(): Promise<CompactToolDefinition[]> {
  return withClient(async (client) => {
    const result = await client.listTools();
    return result.tools;
  });
}

export function extractTextContent(result: CompactToolResult): string {
  if ('toolResult' in result) {
    return JSON.stringify(result.toolResult, null, 2);
  }

  const textParts = result.content
    .filter((entry): entry is Extract<typeof entry, { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text);

  if (textParts.length > 0) {
    return textParts.join('\n');
  }

  return JSON.stringify(result, null, 2);
}
