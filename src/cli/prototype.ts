import { callCompactTool, extractTextContent } from './mcp-client.js';

type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

function toCamelCase(input: string): string {
  return input.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      positionals.push(current);
      continue;
    }

    const trimmed = current.slice(2);
    const [rawKey, inlineValue] = trimmed.split('=', 2);
    const key = toCamelCase(rawKey);

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
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

function requireString(flags: Record<string, string | boolean>, key: string, help: string): string {
  const value = flags[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}\n\n${help}`);
}

function parseJsonFlag<T>(flags: Record<string, string | boolean>, key: string, fallback: T): T {
  const value = flags[key];
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Invalid JSON for --${key}: ${(error as Error).message}`);
  }
}

function printPrototypeHelp(): void {
  console.log(`
Prototype task commands (compact MCP-backed):
  gopeak script create --project-path <abs> --script-path <rel> [--extends Node] [--class-name Foo] [--template component] [--content '...']
  gopeak script modify --project-path <abs> --script-path <rel> --modifications '[{"type":"add_function","name":"hello","body":"pass"}]'
  gopeak editor run --project-path <abs> [--scene <rel-scene>]
  gopeak debug output --reason <text>
  gopeak editor stop --reason <text>
  gopeak project export --project-path <abs> --preset <name> --output-path <abs-or-rel> [--debug]
  gopeak project validate --project-path <abs> [--preset <name>] [--include-suggestions false]

Notes:
  - These commands intentionally cover the benchmark task families only.
  - They call the compact MCP aliases internally so behavior stays aligned with the MCP baseline.
`.trim());
}

export async function runPrototypeCommand(args: string[]): Promise<boolean> {
  const parsed = parseArgs(args);
  const [group, action] = parsed.positionals;

  if (!group || group === 'help' || parsed.flags.help === true) {
    printPrototypeHelp();
    return true;
  }

  let toolName: string;
  let toolArgs: Record<string, unknown>;

  switch (`${group}:${action ?? ''}`) {
    case 'script:create':
      toolName = 'script.create';
      toolArgs = {
        projectPath: requireString(parsed.flags, 'projectPath', 'Required for script create'),
        scriptPath: requireString(parsed.flags, 'scriptPath', 'Required for script create'),
        extends: typeof parsed.flags.extends === 'string' ? parsed.flags.extends : 'Node',
        className: typeof parsed.flags.className === 'string' ? parsed.flags.className : undefined,
        template: typeof parsed.flags.template === 'string' ? parsed.flags.template : undefined,
        content: typeof parsed.flags.content === 'string' ? parsed.flags.content : undefined,
      };
      break;
    case 'script:modify':
      toolName = 'script.modify';
      toolArgs = {
        projectPath: requireString(parsed.flags, 'projectPath', 'Required for script modify'),
        scriptPath: requireString(parsed.flags, 'scriptPath', 'Required for script modify'),
        modifications: parseJsonFlag(parsed.flags, 'modifications', []),
      };
      break;
    case 'editor:run':
      toolName = 'editor.run';
      toolArgs = {
        projectPath: requireString(parsed.flags, 'projectPath', 'Required for editor run'),
        scene: typeof parsed.flags.scene === 'string' ? parsed.flags.scene : undefined,
      };
      break;
    case 'editor:stop':
      toolName = 'editor.stop';
      toolArgs = {
        reason: typeof parsed.flags.reason === 'string' ? parsed.flags.reason : 'CLI prototype stop',
      };
      break;
    case 'debug:output':
      toolName = 'editor.debug_output';
      toolArgs = {
        reason: requireString(parsed.flags, 'reason', 'Required for debug output'),
      };
      break;
    case 'project:export':
      toolName = 'export.run';
      toolArgs = {
        projectPath: requireString(parsed.flags, 'projectPath', 'Required for project export'),
        preset: requireString(parsed.flags, 'preset', 'Required for project export'),
        outputPath: requireString(parsed.flags, 'outputPath', 'Required for project export'),
        debug: parsed.flags.debug === true,
      };
      break;
    case 'project:validate': {
      const projectPath = requireString(parsed.flags, 'projectPath', 'Required for project validate');
      const groupResult = await callCompactTool('tool.groups', { action: 'activate', group: 'import_export' });
      if ('isError' in groupResult && groupResult.isError) {
        console.error(extractTextContent(groupResult));
        return false;
      }
      toolName = 'validate_project';
      toolArgs = {
        projectPath,
        preset: typeof parsed.flags.preset === 'string' ? parsed.flags.preset : '',
        includeSuggestions: parsed.flags.includeSuggestions !== 'false',
      };
      break;
    }
    default:
      printPrototypeHelp();
      throw new Error(`Unknown prototype command: ${group}${action ? ` ${action}` : ''}`);
  }

  const result = await callCompactTool(toolName, toolArgs);
  const text = extractTextContent(result);

  if ('isError' in result && result.isError) {
    console.error(text);
    return false;
  }

  console.log(text);
  return true;
}
