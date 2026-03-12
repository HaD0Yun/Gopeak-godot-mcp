import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { callCompactTool, extractTextContent, listCompactTools } from './mcp-client.js';

interface CliTaskSpec {
  command: string[];
  interfaceText?: string;
}

interface McpTaskSpec {
  tool: string;
  args?: Record<string, unknown>;
}

interface BenchmarkTaskSpec {
  id: string;
  family: string;
  description?: string;
  cli?: CliTaskSpec;
  mcp?: McpTaskSpec;
}

interface BenchmarkSpec {
  name?: string;
  repetitions?: number;
  tasks: BenchmarkTaskSpec[];
}

interface RunRecord {
  taskId: string;
  family: string;
  surface: 'cli' | 'mcp';
  success: boolean;
  durationMs: number;
  invocationCount: number;
  estimatedInputTokens: number;
  startedAt: string;
  finishedAt: string;
  summary: string;
  command?: string[];
  tool?: string;
  stderr?: string;
}


function resolvePlaceholders(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let resolved = value;
    for (const [key, replacement] of Object.entries(replacements)) {
      resolved = resolved.replaceAll(`{${key}}`, replacement);
    }
    return resolved;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolvePlaceholders(entry, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolvePlaceholders(entry, replacements)])
    );
  }

  return value;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      positionals.push(current);
      continue;
    }

    const stripped = current.slice(2);
    const [key, inline] = stripped.split('=', 2);
    if (inline !== undefined) {
      flags[key] = inline;
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { positionals, flags };
}

function requireString(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`Missing --${key}`);
}

function printBenchmarkHelp(): void {
  console.log(`
Benchmark commands:
  gopeak benchmark compare --spec <path> [--out <path>] [--runs <n>]
  gopeak benchmark compat

Spec schema:
  {
    "name": "gopeak-cli-vs-mcp",
    "repetitions": 3,
    "tasks": [
      {
        "id": "script-create",
        "family": "script-mutation",
        "cli": { "command": ["script", "create", "--project-path", "/abs/project", "--script-path", "scripts/foo.gd"] },
        "mcp": { "tool": "script.create", "args": { "projectPath": "/abs/project", "scriptPath": "scripts/foo.gd" } }
      }
    ]
  }
`.trim());
}

async function runCliTask(task: BenchmarkTaskSpec, runNumber: number): Promise<RunRecord> {
  if (!task.cli) {
    throw new Error(`Task ${task.id} is missing cli spec`);
  }

  const started = new Date();
  const resolvedCli = resolvePlaceholders(task.cli, { surface: 'cli', run: String(runNumber) }) as CliTaskSpec;
  const commandText = resolvedCli.interfaceText || resolvedCli.command.join(' ');
  const cliPath = join(import.meta.dirname, '..', 'cli.js');

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...resolvedCli.command], {
      cwd: join(import.meta.dirname, '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const finished = new Date();
      resolve({
        taskId: task.id,
        family: task.family,
        surface: 'cli',
        success: code === 0,
        durationMs: finished.getTime() - started.getTime(),
        invocationCount: 1,
        estimatedInputTokens: estimateTokens(commandText),
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        summary: (stdout || stderr).trim().slice(0, 500),
        command: resolvedCli.command,
        stderr: stderr.trim() || undefined,
      });
    });
  });
}

async function runMcpTask(task: BenchmarkTaskSpec, schemaTokenCache: Map<string, number>, runNumber: number): Promise<RunRecord> {
  if (!task.mcp) {
    throw new Error(`Task ${task.id} is missing mcp spec`);
  }

  const resolvedMcp = resolvePlaceholders(task.mcp, { surface: 'mcp', run: String(runNumber) }) as McpTaskSpec;
  const started = new Date();
  const result = await callCompactTool(resolvedMcp.tool, resolvedMcp.args || {});
  const finished = new Date();
  const schemaTokens = schemaTokenCache.get(resolvedMcp.tool) || 0;
  const argTokens = estimateTokens(JSON.stringify(resolvedMcp.args || {}));

  return {
    taskId: task.id,
    family: task.family,
    surface: 'mcp',
    success: !('isError' in result && result.isError),
    durationMs: finished.getTime() - started.getTime(),
    invocationCount: 1,
    estimatedInputTokens: schemaTokens + argTokens,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    summary: extractTextContent(result).slice(0, 500),
    tool: resolvedMcp.tool,
  };
}

async function buildSchemaTokenCache(): Promise<Map<string, number>> {
  const tools = await listCompactTools();
  const cache = new Map<string, number>();
  for (const tool of tools) {
    cache.set(tool.name, estimateTokens(JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })));
  }
  return cache;
}

async function runCompatibilityChecks(): Promise<void> {
  const tools = await listCompactTools();
  const compactNames = new Set(tools.map((tool) => tool.name));
  const required = ['tool.catalog', 'script.create', 'script.modify', 'editor.run', 'editor.debug_output', 'export.run'];
  const missing = required.filter((name) => !compactNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing compact tools: ${missing.join(', ')}`);
  }

  const catalogResult = await callCompactTool('tool.catalog', { query: 'script', limit: 5 });
  if ('isError' in catalogResult && catalogResult.isError) {
    throw new Error(`tool.catalog compatibility check failed: ${extractTextContent(catalogResult)}`);
  }

  console.log('Compatibility checks passed: compact tool aliases present and tool.catalog callable.');
}

async function runCompare(flags: Record<string, string | boolean>): Promise<boolean> {
  const specPath = requireString(flags, 'spec');
  const outPath = typeof flags.out === 'string' ? flags.out : 'artifacts/gopeak-cli-vs-mcp-benchmark.json';
  const file = readFileSync(specPath, 'utf8');
  const spec = JSON.parse(file) as BenchmarkSpec;
  const repetitions = typeof flags.runs === 'string' ? Number(flags.runs) : spec.repetitions || 3;
  if (!Number.isFinite(repetitions) || repetitions < 1) {
    throw new Error(`Invalid repetition count: ${repetitions}`);
  }

  await runCompatibilityChecks();
  const schemaTokenCache = await buildSchemaTokenCache();
  const runs: RunRecord[] = [];

  for (const task of spec.tasks) {
    for (let index = 0; index < repetitions; index += 1) {
      if (task.cli) {
        runs.push(await runCliTask(task, index + 1));
      }
      if (task.mcp) {
        runs.push(await runMcpTask(task, schemaTokenCache, index + 1));
      }
    }
  }

  const summary = Object.values(
    runs.reduce<Record<string, { taskId: string; family: string; surface: 'cli' | 'mcp'; durations: number[]; tokens: number[]; successes: number }>>((acc, run) => {
      const key = `${run.taskId}:${run.surface}`;
      if (!acc[key]) {
        acc[key] = {
          taskId: run.taskId,
          family: run.family,
          surface: run.surface,
          durations: [],
          tokens: [],
          successes: 0,
        };
      }
      acc[key].durations.push(run.durationMs);
      acc[key].tokens.push(run.estimatedInputTokens);
      acc[key].successes += run.success ? 1 : 0;
      return acc;
    }, {})
  ).map((entry) => ({
    taskId: entry.taskId,
    family: entry.family,
    surface: entry.surface,
    medianDurationMs: median(entry.durations),
    medianEstimatedInputTokens: median(entry.tokens),
    successRate: entry.successes / entry.durations.length,
    samples: entry.durations.length,
  }));

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    name: spec.name || 'gopeak-cli-vs-mcp-benchmark',
    generatedAt: new Date().toISOString(),
    repetitions,
    runs,
    summary,
  }, null, 2));

  console.log(`Benchmark results written to ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
  return true;
}

export async function runBenchmarkCommand(args: string[]): Promise<boolean> {
  const parsed = parseArgs(args);
  const [subcommand] = parsed.positionals;

  if (!subcommand || subcommand === 'help' || parsed.flags.help === true) {
    printBenchmarkHelp();
    return true;
  }

  switch (subcommand) {
    case 'compat':
      await runCompatibilityChecks();
      return true;
    case 'compare':
      return runCompare(parsed.flags);
    default:
      printBenchmarkHelp();
      throw new Error(`Unknown benchmark command: ${subcommand}`);
  }
}
