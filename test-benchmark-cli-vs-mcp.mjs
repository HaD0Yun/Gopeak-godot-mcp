#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const REPO = '/home/yun/Gopeak-godot-mcp';
const CLI = join(REPO, 'build/cli.js');
const SCRIPT_BENCHMARK = join(REPO, 'scripts', 'benchmark', 'cli-vs-mcp-benchmark.mjs');
const FIXTURE = '/home/yun/gopeak-demo';
const ARTIFACT_DIR = '/home/yun/.omx/artifacts/gopeak-cli-vs-mcp/worker-2';

async function runCli(args, extraEnv = {}) {
  const { stdout, stderr } = await execFile(process.execPath, [CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 1024 * 1024 * 10,
  });
  return { stdout, stderr };
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'gopeak-benchmark-worker-2-'));
  const projectCopy = join(tempRoot, 'gopeak-demo');
  const specPath = join(tempRoot, 'benchmark-spec.json');
  const outPath = join(tempRoot, 'benchmark-report.json');

  try {
    await execFile('cp', ['-R', FIXTURE, projectCopy], { cwd: REPO, maxBuffer: 1024 * 1024 * 20 });

    const help = await runCli(['help']);
    assert.match(help.stdout, /gopeak benchmark \.\.\./);

    const scriptHelp = await runCli(['script', '--help']);
    assert.match(scriptHelp.stdout, /gopeak script create/);
    assert.match(scriptHelp.stdout, /gopeak project export/);

    const compat = await runCli(['benchmark', 'compat'], {
      GOPEAK_TOOL_PROFILE: 'compact',
      GOPEAK_TOOLS_PAGE_SIZE: '9999',
    });
    assert.match(compat.stdout, /Compatibility checks passed/);

    const spec = {
      name: 'worker-2-benchmark-smoke',
      repetitions: 1,
      tasks: [
        {
          id: 'script-create',
          family: 'script-mutation',
          cli: {
            command: [
              'script',
              'create',
              '--project-path', projectCopy,
              '--script-path', 'scripts/worker2_cli_create.gd',
              '--extends', 'Node',
            ],
          },
          mcp: {
            tool: 'script.create',
            args: {
              projectPath: projectCopy,
              scriptPath: 'scripts/worker2_mcp_create.gd',
              extends: 'Node',
            },
          },
        },
        {
          id: 'script-modify',
          family: 'script-mutation',
          cli: {
            command: [
              'script',
              'modify',
              '--project-path', projectCopy,
              '--script-path', 'scripts/worker2_cli_create.gd',
              '--modifications', '[{"type":"add_function","name":"worker_two_cli","body":"pass"}]',
            ],
          },
          mcp: {
            tool: 'script.modify',
            args: {
              projectPath: projectCopy,
              scriptPath: 'scripts/worker2_mcp_create.gd',
              modifications: [
                { type: 'add_function', name: 'worker_two_mcp', body: 'pass' },
              ],
            },
          },
        },
      ],
    };

    await writeFile(specPath, JSON.stringify(spec, null, 2));

    const compare = await runCli(['benchmark', 'compare', '--spec', specPath, '--out', outPath, '--runs', '1'], {
      GOPEAK_TOOL_PROFILE: 'compact',
      GOPEAK_TOOLS_PAGE_SIZE: '9999',
    });
    assert.match(compare.stdout, /Benchmark results written to/);

    const report = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(report.runs.length, 4, `expected 4 run records, got ${report.runs.length}`);
    assert(report.runs.every((run) => run.success === true), 'expected all benchmark runs to succeed');

    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(join(ARTIFACT_DIR, 'benchmark-smoke-spec.json'), JSON.stringify(spec, null, 2));
    await writeFile(join(ARTIFACT_DIR, 'benchmark-smoke-report.json'), JSON.stringify(report, null, 2));

    const cliScript = await readFile(join(projectCopy, 'scripts/worker2_cli_create.gd'), 'utf8');
    const mcpScript = await readFile(join(projectCopy, 'scripts/worker2_mcp_create.gd'), 'utf8');
    assert.match(cliScript, /func worker_two_cli\(\)/);
    assert.match(mcpScript, /func worker_two_mcp\(\)/);

    const { stdout: scriptBenchmarkStdout } = await execFile(process.execPath, [
      SCRIPT_BENCHMARK,
      '--projectPath', projectCopy,
      '--tasks', 'scene_create',
      '--iterations', '1',
    ], {
      cwd: REPO,
      env: { ...process.env, GOPEAK_TOOL_PROFILE: 'compact' },
      maxBuffer: 1024 * 1024 * 20,
    });
    const scriptBenchmark = JSON.parse(scriptBenchmarkStdout);
    assert.equal(scriptBenchmark.tasks[0].summary.cli.okRuns, 1);
    assert.equal(scriptBenchmark.capabilities.editor_bridge, false);
    assert.equal(scriptBenchmark.tasks[0].summary.mcp.okRuns, 0);
    assert.equal(scriptBenchmark.tasks[0].summary.mcp.skippedRuns, 1);
    assert.equal(scriptBenchmark.tasks[0].runs[1].surface, 'mcp');
    assert.equal(scriptBenchmark.tasks[0].runs[1].skipped, true);
    assert.equal(scriptBenchmark.tasks[0].runs[1].skipReason, 'missing capabilities: editor_bridge');

    console.log('PASS test-benchmark-cli-vs-mcp');
    console.log(`report=${outPath}`);
    console.log(`project_copy=${projectCopy}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL test-benchmark-cli-vs-mcp');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
