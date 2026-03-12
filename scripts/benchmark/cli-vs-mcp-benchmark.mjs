#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const prototypePath = join(__dirname, 'gopeak-cli-prototype.mjs');
const matrixPath = join(__dirname, 'cli-vs-mcp.matrix.json');
const buildServerPath = join(repoRoot, 'build', 'index.js');

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value).length / 4));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ensureProjectCopy(sourceProjectPath, label) {
  const tempRoot = mkdtempSync(join(tmpdir(), `gopeak-bench-${label}-`));
  const target = join(tempRoot, 'project');
  cpSync(sourceProjectPath, target, { recursive: true });
  return { tempRoot, projectPath: target };
}

function assertTask(task, projectPath, surfaceResult) {
  const failures = [];
  for (const assertion of task.assertions || []) {
    if (assertion.type === 'path_exists') {
      const fullPath = join(projectPath, assertion.path);
      if (!existsSync(fullPath)) {
        failures.push(`missing path: ${assertion.path}`);
      }
    }
    if (assertion.type === 'file_contains') {
      const fullPath = join(projectPath, assertion.path);
      const content = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
      if (!content.includes(assertion.needle)) {
        failures.push(`missing content in ${assertion.path}: ${assertion.needle}`);
      }
    }
    if (assertion.type === 'stdout_nonempty') {
      if (!String(surfaceResult.stdout || '').trim()) {
        failures.push('stdout was empty');
      }
    }
  }
  return failures;
}

class McpClient {
  constructor(env) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.process = spawn(process.execPath, [buildServerPath], {
      cwd: repoRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this.process.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof payload.id !== 'undefined' && this.pending.has(payload.id)) {
        const { resolve: resolvePromise } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        resolvePromise(payload);
      }
    });
    this.process.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
  }

  async request(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId += 1;
    const payload = { jsonrpc: '2.0', id, method, params };
    const serialized = JSON.stringify(payload);
    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
    this.process.stdin.write(`${serialized}\n`);
    return { response: await responsePromise, tokenEstimate: estimateTokens(serialized) };
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cli-vs-mcp-benchmark', version: '1.0.0' },
    });
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }

  async callTool(name, args) {
    return await this.request('tools/call', { name, arguments: args });
  }

  async close() {
    if (this.process.exitCode === null) {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function runCliTask(task, projectPath, godotPath) {
  const args = [prototypePath, task.cli.command, '--projectPath', projectPath, '--godotPath', godotPath];
  for (const [key, value] of Object.entries(task.cli.args || {})) {
    args.push(`--${key}`);
    args.push(typeof value === 'string' ? value : JSON.stringify(value));
  }

  const startedAt = Date.now();
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  const stdout = stdoutChunks.join('').trim();
  const stderr = stderrChunks.join('').trim();
  let parsed = null;
  try {
    parsed = stdout ? JSON.parse(stdout) : null;
  } catch {}

  return {
    ok: exitCode === 0 && Boolean(parsed?.ok),
    exitCode,
    stdout,
    stderr,
    parsed,
    durationMs: Date.now() - startedAt,
    invocationCount: parsed?.invocationCount ?? 1,
    interfaceTokenEstimate: parsed?.interfaceTokenEstimate ?? estimateTokens(args.slice(1).join(' ')),
  };
}

async function runMcpTask(task, mcp, projectPath) {
  const startedAt = Date.now();
  let invocationCount = 0;
  let interfaceTokenEstimate = 0;
  let lastText = '';
  const responses = [];

  for (const call of task.mcp.calls) {
    const args = { ...(call.args || {}), projectPath };
    const { response, tokenEstimate } = await mcp.callTool(call.tool, args);
    invocationCount += 1;
    interfaceTokenEstimate += tokenEstimate;
    responses.push(response);
    const text = response?.result?.content?.map((part) => part?.text || '').join('\n') || '';
    lastText = text;
    if (response?.error) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        invocationCount,
        interfaceTokenEstimate,
        stdout: lastText,
        stderr: response.error.message || 'MCP error',
        responses,
      };
    }
  }

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    invocationCount,
    interfaceTokenEstimate,
    stdout: lastText,
    stderr: '',
    responses,
  };
}

function summarize(results) {
  const summary = {};
  for (const surface of ['cli', 'mcp']) {
    const surfaceRuns = results.filter((entry) => entry.surface === surface);
    const successfulRuns = surfaceRuns.filter((entry) => entry.ok);
    const skippedRuns = surfaceRuns.filter((entry) => entry.skipped);
    summary[surface] = {
      okRuns: successfulRuns.length,
      skippedRuns: skippedRuns.length,
    };
    if (successfulRuns.length > 0) {
      summary[surface].medianDurationMs = median(successfulRuns.map((entry) => entry.durationMs));
      summary[surface].medianInvocationCount = median(successfulRuns.map((entry) => entry.invocationCount));
      summary[surface].medianInterfaceTokenEstimate = median(successfulRuns.map((entry) => entry.interfaceTokenEstimate));
    }
  }
  return summary;
}

async function detectCapabilities(mcp) {
  const capabilities = {
    editor_bridge: false,
  };

  try {
    const { response } = await mcp.callTool('editor.status', {});
    const text = response?.result?.content?.map((part) => part?.text || '').join('\n') || '';
    const parsed = text ? JSON.parse(text) : {};
    capabilities.editor_bridge = Boolean(parsed.connected);
  } catch {}

  return capabilities;
}

function getMissingRequirements(task, surface, capabilities) {
  const required = task.requires?.[surface] || [];
  return required.filter((requirement) => !capabilities[requirement]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const sourceProjectPath = resolve(args.projectPath || '/home/yun/gopeak-demo');
  const selectedTaskIds = args.tasks ? String(args.tasks).split(',').map((item) => item.trim()) : matrix.tasks.map((task) => task.id);
  const iterations = Math.max(1, Number.parseInt(args.iterations || '1', 10));
  const godotPath = args.godotPath || process.env.GODOT_PATH || 'godot';

  const mcp = new McpClient({
    ...process.env,
    GODOT_PATH: godotPath,
    GOPEAK_TOOL_PROFILE: matrix.baseline?.mcpProfile || 'compact',
  });
  await mcp.initialize();
  const capabilities = await detectCapabilities(mcp);

  const runResults = [];
  try {
    for (const taskId of selectedTaskIds) {
      const task = matrix.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`Unknown task id: ${taskId}`);
      }

      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        for (const surface of ['cli', 'mcp']) {
          const fixture = ensureProjectCopy(sourceProjectPath, `${task.id}-${surface}-${iteration}`);
          try {
            const missingRequirements = getMissingRequirements(task, surface, capabilities);
            if (missingRequirements.length > 0) {
              runResults.push({
                taskId: task.id,
                family: task.family,
                label: task.label,
                surface,
                iteration,
                projectPath: fixture.projectPath,
                ok: false,
                skipped: true,
                skipReason: `missing capabilities: ${missingRequirements.join(', ')}`,
                durationMs: 0,
                invocationCount: 0,
                interfaceTokenEstimate: 0,
                stdout: '',
                stderr: '',
                assertionFailures: [],
              });
              continue;
            }

            const surfaceResult = surface === 'cli'
              ? await runCliTask(task, fixture.projectPath, godotPath)
              : await runMcpTask(task, mcp, fixture.projectPath);
            const assertionFailures = assertTask(task, fixture.projectPath, surfaceResult);
            runResults.push({
              taskId: task.id,
              family: task.family,
              label: task.label,
              surface,
              iteration,
              projectPath: fixture.projectPath,
              ok: surfaceResult.ok && assertionFailures.length === 0,
              skipped: false,
              durationMs: surfaceResult.durationMs,
              invocationCount: surfaceResult.invocationCount,
              interfaceTokenEstimate: surfaceResult.interfaceTokenEstimate,
              stdout: surfaceResult.stdout,
              stderr: surfaceResult.stderr,
              assertionFailures,
            });
          } finally {
            if (!args.keepFixtures) {
              rmSync(fixture.tempRoot, { recursive: true, force: true });
            }
          }
        }
      }
    }
  } finally {
    await mcp.close();
  }

  const grouped = selectedTaskIds.map((taskId) => {
    const task = matrix.tasks.find((entry) => entry.id === taskId);
    const taskRuns = runResults.filter((entry) => entry.taskId === taskId);
    return {
      taskId,
      family: task?.family,
      label: task?.label,
      summary: summarize(taskRuns),
      runs: taskRuns,
    };
  });

  const report = {
    benchmark: 'gopeak-cli-vs-mcp',
    sourceProjectPath,
    mcpProfile: matrix.baseline?.mcpProfile || 'compact',
    iterations,
    generatedAt: new Date().toISOString(),
    capabilities,
    tasks: grouped,
  };

  if (args.output) {
    writeFileSync(resolve(args.output), JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
