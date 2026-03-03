import {
  ErrorCode,
  McpError,
  type GetPromptResult,
  type ListPromptsResult,
  type Prompt,
} from '@modelcontextprotocol/sdk/types.js';

type PromptArgs = Record<string, string> | undefined;

type PromptTemplate = {
  prompt: Prompt;
  render: (args: PromptArgs) => GetPromptResult;
};

const PROMPTS_PAGE_SIZE = 20;

function getTrimmedArg(args: PromptArgs, key: string): string | undefined {
  const value = args?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireArg(args: PromptArgs, key: string, promptName: string): string {
  const value = getTrimmedArg(args, key);
  if (!value) {
    throw new McpError(ErrorCode.InvalidParams, `Prompt '${promptName}' requires argument '${key}'`);
  }

  return value;
}

const promptTemplates: PromptTemplate[] = [
  {
    prompt: {
      name: 'godot.scene_bootstrap',
      title: 'Godot Scene Bootstrap',
      description: 'Generate a deterministic scene bootstrap plan and starter GDScript wiring for a new gameplay scene.',
      arguments: [
        {
          name: 'project_path',
          description: 'Absolute path to the Godot project directory.',
          required: true,
        },
        {
          name: 'scene_path',
          description: 'Scene path to create, for example: res://scenes/Player.tscn',
          required: true,
        },
        {
          name: 'root_node_type',
          description: 'Root node type for the scene. Defaults to Node2D.',
        },
        {
          name: 'feature_goal',
          description: 'Short feature goal to guide node and script choices.',
        },
      ],
    },
    render: (args: PromptArgs): GetPromptResult => {
      const projectPath = requireArg(args, 'project_path', 'godot.scene_bootstrap');
      const scenePath = requireArg(args, 'scene_path', 'godot.scene_bootstrap');
      const rootNodeType = getTrimmedArg(args, 'root_node_type') || 'Node2D';
      const featureGoal = getTrimmedArg(args, 'feature_goal') || 'Create a playable prototype with clear input and movement behavior.';

      return {
        description: 'Deterministic checklist for creating and wiring a new Godot scene.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Bootstrap a Godot scene using this deterministic sequence:',
                `- Project path: ${projectPath}`,
                `- Scene path: ${scenePath}`,
                `- Root node type: ${rootNodeType}`,
                `- Goal: ${featureGoal}`,
                '',
                'Execute in order:',
                '1) Call project.info to confirm project metadata and main scene.',
                `2) Call scene.create with scene_path='${scenePath}' and root_node_type='${rootNodeType}'.`,
                '3) Add core nodes with scene.node.add (or add_node), then save the scene.',
                '4) Create or modify the attached script with script.create/script.modify using typed exports for tunable values.',
                '5) Run editor.run on the same project path, collect editor.debug_output, and fix top blocking errors.',
                '6) Return a concise summary containing created nodes, script path, and unresolved risks.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  },
  {
    prompt: {
      name: 'godot.debug_triage',
      title: 'Godot Debug Triage',
      description: 'Run a focused Godot debug triage loop from reproduction to verified fix.',
      arguments: [
        {
          name: 'project_path',
          description: 'Absolute path to the Godot project directory.',
          required: true,
        },
        {
          name: 'error_excerpt',
          description: 'Error excerpt from Godot output or debugger panel.',
          required: true,
        },
        {
          name: 'repro_steps',
          description: 'Optional reproduction steps observed by the developer.',
        },
      ],
    },
    render: (args: PromptArgs): GetPromptResult => {
      const projectPath = requireArg(args, 'project_path', 'godot.debug_triage');
      const errorExcerpt = requireArg(args, 'error_excerpt', 'godot.debug_triage');
      const reproSteps = getTrimmedArg(args, 'repro_steps') || 'No reproduction steps provided.';

      return {
        description: 'Deterministic debug triage workflow for Godot runtime/editor errors.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'Triage and fix this Godot issue with deterministic steps:',
                `- Project path: ${projectPath}`,
                `- Error excerpt: ${errorExcerpt}`,
                `- Repro steps: ${reproSteps}`,
                '',
                'Workflow:',
                '1) Call editor.run for the target project and reproduce once.',
                '2) Collect logs with editor.debug_output and parse_error_log; isolate the first root-cause error.',
                '3) Use lsp.diagnostics/lsp_get_hover on the implicated script(s) before editing.',
                '4) Apply the smallest fix with script.modify or scene/resource tools.',
                '5) Re-run editor.run and confirm the original error excerpt no longer appears.',
                '6) Report root cause, changed files, and any follow-up checks.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  },
];

const promptTemplatesByName = new Map(promptTemplates.map((template) => [template.prompt.name, template]));

function parsePromptsListCursor(cursor: unknown, total: number): number {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return 0;
  }

  const offset = Number.parseInt(cursor, 10);
  if (!Number.isInteger(offset) || offset < 0 || offset > total) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid prompts/list cursor: ${cursor}`);
  }

  return offset;
}

export function listPrompts(cursor: unknown): ListPromptsResult {
  const promptDefs = promptTemplates.map((template) => template.prompt);
  const start = parsePromptsListCursor(cursor, promptDefs.length);
  const end = Math.min(start + PROMPTS_PAGE_SIZE, promptDefs.length);
  const page = promptDefs.slice(start, end);

  if (end < promptDefs.length) {
    return {
      prompts: page,
      nextCursor: String(end),
    };
  }

  return { prompts: page };
}

export function getPrompt(name: string, args?: Record<string, string>): GetPromptResult {
  const template = promptTemplatesByName.get(name);
  if (!template) {
    const available = promptTemplates.map((entry) => entry.prompt.name).join(', ');
    throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}. Available prompts: ${available}`);
  }

  return template.render(args);
}
