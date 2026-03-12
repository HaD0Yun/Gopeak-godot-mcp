#!/usr/bin/env node
import { execFile, exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const execAsync = promisify(execCallback);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const operationsScriptPath = join(repoRoot, 'src', 'scripts', 'godot_operations.gd');

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

function parseJsonArgument(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runGodotOperation(operation, params, projectPath, godotPath) {
  const payload = JSON.stringify(params ?? {});
  const commandArgs = [
    '--headless',
    '--path',
    projectPath,
    '--script',
    operationsScriptPath,
    operation,
    payload,
  ];

  return await new Promise((resolvePromise, rejectPromise) => {
    execFile(godotPath, commandArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolvePromise({ ok: false, stdout, stderr, error: error.message, commandArgs });
        return;
      }
      resolvePromise({ ok: true, stdout, stderr, commandArgs });
    });
  });
}

async function validateProject(projectPath, godotPath, preset = '', includeSuggestions = true) {
  return await runGodotOperation(
    'validate_project',
    { preset, include_suggestions: includeSuggestions },
    projectPath,
    godotPath,
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed._;
  const godotPath = parsed.godotPath || process.env.GODOT_PATH || 'godot';

  if (!command || parsed.help) {
    console.log([
      'GoPeak CLI Prototype (benchmark-only)',
      '',
      'Commands:',
      '  scene-create      --projectPath <dir> --scenePath <res> [--rootNodeType Node2D]',
      '  script-modify     --projectPath <dir> --scriptPath <res> --modifications <json>',
      '  validate-project  --projectPath <dir> [--preset <name>] [--includeSuggestions true|false]',
      '',
      'Output is JSON by default.',
    ].join('\n'));
    return;
  }

  const startedAt = Date.now();
  let operationName = command;
  let execution;

  switch (command) {
    case 'scene-create': {
      if (!parsed.projectPath || !parsed.scenePath) {
        throw new Error('scene-create requires --projectPath and --scenePath');
      }
      operationName = 'create_scene';
      execution = await runGodotOperation(
        'create_scene',
        { scene_path: parsed.scenePath, root_node_type: parsed.rootNodeType || 'Node2D' },
        parsed.projectPath,
        godotPath,
      );
      break;
    }
    case 'script-modify': {
      if (!parsed.projectPath || !parsed.scriptPath || !parsed.modifications) {
        throw new Error('script-modify requires --projectPath, --scriptPath, and --modifications');
      }
      operationName = 'modify_script';
      execution = await runGodotOperation(
        'modify_script',
        {
          script_path: parsed.scriptPath,
          modifications: parseJsonArgument(parsed.modifications, []),
        },
        parsed.projectPath,
        godotPath,
      );
      break;
    }
    case 'validate-project': {
      if (!parsed.projectPath) {
        throw new Error('validate-project requires --projectPath');
      }
      operationName = 'validate_project';
      execution = await validateProject(
        parsed.projectPath,
        godotPath,
        typeof parsed.preset === 'string' ? parsed.preset : '',
        parsed.includeSuggestions !== 'false',
      );
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  const result = {
    ok: Boolean(execution?.ok),
    surface: 'cli-prototype',
    command,
    operationName,
    invocationCount: 1,
    interfaceTokenEstimate: estimateTokens(process.argv.slice(2).join(' ')),
    durationMs: Date.now() - startedAt,
    stdout: execution?.stdout?.trim() ?? '',
    stderr: execution?.stderr?.trim() ?? '',
    error: execution?.error ?? null,
    commandArgs: execution?.commandArgs ?? [],
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    surface: 'cli-prototype',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
