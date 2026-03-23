import { createDAPTools } from './dap_client.js';
import { createLSPTools } from './lsp_client.js';
import type { MCPToolDefinition } from './server-types.js';

export function buildToolDefinitions(godotBridgePort: number): MCPToolDefinition[] {
  return [
        {
          name: 'launch_editor',
          description: 'Opens the Godot editor GUI for a project. Use when visual inspection or manual editing of scenes/scripts is needed. Opens a new window on the host system. Requires: project directory with project.godot file.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'run_project',
          description: 'Launches a Godot project in a new window and captures output. Use to test gameplay or verify script behavior. Runs until stop_project is called. Use get_debug_output to retrieve logs.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scene: {
                type: 'string',
                description: 'Optional: specific scene to run (e.g., "scenes/TestLevel.tscn"). If omitted, runs main scene from project settings.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_debug_output',
          description: 'Retrieves console output and errors from the currently running Godot project. Use after run_project to check logs, errors, and print statements. Returns empty if no project is running.',
          inputSchema: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Brief explanation of why you are calling this tool' }
            },
            required: ['reason'],
          },
        },
        {
          name: 'stop_project',
          description: 'Terminates the currently running Godot project process. Use to stop a project started with run_project. No effect if no project is running.',
          inputSchema: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Brief explanation of why you are calling this tool' }
            },
            required: ['reason'],
          },
        },
        {
          name: 'get_godot_version',
          description: 'Returns the installed Godot engine version string. Use to check compatibility (e.g., Godot 4.4+ features like UID). Returns version like "4.3.stable" or "4.4.dev".',
          inputSchema: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Brief explanation of why you are calling this tool' }
            },
            required: ['reason'],
          },
        },
        {
          name: 'list_projects',
          description: 'Scans a directory for Godot projects (folders containing project.godot). Use to discover projects before using other tools. Returns array of {path, name}.',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Absolute path to search (e.g., "/home/user/godot-projects" on Linux, "C:\\Games" on Windows)',
              },
              recursive: {
                type: 'boolean',
                description: 'If true, searches all subdirectories. If false (default), only checks immediate children.',
              },
            },
            required: ['directory'],
          },
        },
        {
          name: 'get_project_info',
          description: 'Returns metadata about a Godot project including name, version, main scene, autoloads, and directory structure. Use to understand project before modifying. Requires valid project.godot.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'scaffold_gameplay_prototype',
          description: 'Creates a minimal playable prototype scaffold in one shot: main scene, player scene, basic nodes, common input actions, and optional starter player script.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot.',
              },
              scenePath: {
                type: 'string',
                description: 'Main scene path relative to project. Default: scenes/Main.tscn',
              },
              playerScenePath: {
                type: 'string',
                description: 'Player scene path relative to project. Default: scenes/Player.tscn',
              },
              includePlayerScript: {
                type: 'boolean',
                description: 'If true, creates scripts/player.gd starter script. Default: true',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'validate_patch_with_lsp',
          description: 'Runs Godot LSP diagnostics for a script and returns whether it is safe to apply changes. Intended as a pre-apply quality gate.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot.',
              },
              scriptPath: {
                type: 'string',
                description: 'Script path relative to project (e.g., scripts/player.gd).',
              },
            },
            required: ['projectPath', 'scriptPath'],
          },
        },
        {
          name: 'enforce_version_gate',
          description: 'Checks Godot version and runtime addon protocol/capabilities against minimum requirements before risky operations.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot.',
              },
              minGodotVersion: {
                type: 'string',
                description: 'Minimum required Godot version (major.minor). Default: 4.2',
              },
              minProtocolVersion: {
                type: 'string',
                description: 'Minimum required runtime protocol version. Default: 1.0',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'capture_intent_snapshot',
          description: 'Capture/update an intent snapshot for current work (goal, constraints, acceptance criteria) and persist it for handoff.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              goal: { type: 'string', description: 'Primary goal of the current work.' },
              why: { type: 'string', description: 'Why this work matters.' },
              constraints: { type: 'array', items: { type: 'string' }, description: 'Operational/technical constraints.' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Definition of done.' },
              nonGoals: { type: 'array', items: { type: 'string' }, description: 'Out of scope items.' },
              priority: { type: 'string', description: 'Priority label (e.g., P0, P1).' }
            },
            required: ['projectPath', 'goal'],
          },
        },
        {
          name: 'record_decision_log',
          description: 'Record a structured decision log entry with rationale and alternatives.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              intentId: { type: 'string', description: 'Related intent id. Optional if latest intent should be inferred.' },
              decision: { type: 'string', description: 'Decision statement.' },
              rationale: { type: 'string', description: 'Why this decision was made.' },
              alternativesRejected: { type: 'array', items: { type: 'string' }, description: 'Alternatives considered and rejected.' },
              evidenceRefs: { type: 'array', items: { type: 'string' }, description: 'References supporting the decision.' }
            },
            required: ['projectPath', 'decision'],
          },
        },
        {
          name: 'generate_handoff_brief',
          description: 'Generate a handoff brief from saved intents, decisions, and execution traces for the next AI/operator.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              maxItems: { type: 'number', description: 'Max items per section. Default: 5' }
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'summarize_intent_context',
          description: 'Summarize current intent context (goal, open decisions, risks, next actions) in compact form.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' }
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'record_work_step',
          description: 'Unified operation: records execution trace and optionally refreshes handoff pack in one call.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              intentId: { type: 'string', description: 'Related intent id. Optional: auto-link active intent.' },
              action: { type: 'string', description: 'Executed action name.' },
              command: { type: 'string', description: 'Command or tool invocation.' },
              filesChanged: { type: 'array', items: { type: 'string' }, description: 'Changed file paths.' },
              result: { type: 'string', description: 'success|failed|partial' },
              artifact: { type: 'string', description: 'Artifact reference (branch, commit, build id).' },
              error: { type: 'string', description: 'Error details when failed.' },
              refreshHandoffPack: { type: 'boolean', description: 'If true, regenerates handoff pack after recording. Default: true' },
              maxItems: { type: 'number', description: 'Max items for refreshed handoff pack. Default: 10' }
            },
            required: ['projectPath', 'action', 'result'],
          },
        },
        {
          name: 'record_execution_trace',
          description: 'Record execution trace for a work step (command/tool, files changed, result, artifacts).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              intentId: { type: 'string', description: 'Related intent id. Optional: auto-link active intent.' },
              action: { type: 'string', description: 'Executed action name.' },
              command: { type: 'string', description: 'Command or tool invocation.' },
              filesChanged: { type: 'array', items: { type: 'string' }, description: 'Changed file paths.' },
              result: { type: 'string', description: 'success|failed|partial' },
              artifact: { type: 'string', description: 'Artifact reference (branch, commit, build id).' },
              error: { type: 'string', description: 'Error details when failed.' }
            },
            required: ['projectPath', 'action', 'result'],
          },
        },
        {
          name: 'export_handoff_pack',
          description: 'Export a machine-readable handoff pack combining intent, decisions, and execution traces.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              maxItems: { type: 'number', description: 'Maximum decisions/traces to include. Default: 10' }
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'set_recording_mode',
          description: 'Set recording mode: lite (minimal overhead) or full (richer context).',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', description: 'lite|full' }
            },
            required: ['mode'],
          },
        },
        {
          name: 'get_recording_mode',
          description: 'Get current recording mode and queue status.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'tool_catalog',
          description: 'Discover available tools including hidden legacy tools. Use query to search by capability keywords. Results include group categorization (core/dynamic). Matching dynamic groups are auto-activated and become available immediately. Core groups (always visible): core_meta, core_project, core_editor, core_scene, core_script, core_class, core_signal, core_resource, core_export, core_runtime, core_visualizer, core_diagnostics. Dynamic groups (on-demand): scene_advanced, uid, import_export, autoload, signal, runtime, resource, animation, plugin, input, tilemap, audio, navigation, theme_ui, asset_store, testing, dx_tools, intent_tracking, class_advanced, lsp, dap, version_gate.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Optional keyword search over tool names and descriptions.' },
              limit: { type: 'number', description: 'Maximum results to return. Default: 30, max: 100.' },
            },
            required: [],
          },
        },
        {
          name: 'manage_tool_groups',
          description: 'Manage tool groups. Actions: list (show all core + dynamic groups), activate (enable a dynamic group), deactivate (disable a dynamic group), reset (disable all dynamic), status (show current state). Core groups (always visible, 33 tools): core_meta, core_project, core_editor, core_scene, core_script, core_class, core_signal, core_resource, core_export, core_runtime, core_visualizer, core_diagnostics. Dynamic groups (on-demand, 78 tools): scene_advanced, uid, import_export, autoload, signal, runtime, resource, animation, plugin, input, tilemap, audio, navigation, theme_ui, asset_store, testing, dx_tools, intent_tracking, class_advanced, lsp, dap, version_gate.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action to perform: list, activate, deactivate, reset, status', enum: ['list', 'activate', 'deactivate', 'reset', 'status'] },
              group: { type: 'string', description: 'Group name for activate/deactivate (dynamic groups only). One of: scene_advanced, uid, import_export, autoload, signal, runtime, resource, animation, plugin, input, tilemap, audio, navigation, theme_ui, asset_store, testing, dx_tools, intent_tracking, class_advanced, lsp, dap, version_gate.' },
            },
            required: ['action'],
          },
        },
        {
          name: 'create_scene',
          description: 'Creates a new Godot scene file (.tscn) with a specified root node type. Use to start building new game levels, UI screens, or reusable components. The scene is saved automatically after creation.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path for new scene file relative to project (e.g., "scenes/Player.tscn", "levels/Level1.tscn")',
              },
              rootNodeType: {
                type: 'string',
                description: 'Godot node class for root (e.g., "Node2D" for 2D games, "Node3D" for 3D, "Control" for UI). Default: "Node"',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'add_node',
          description: 'Adds ANY node type to an existing scene. This is the universal node creation tool — replaces all specialized create_* node tools. Supports ALL ClassDB node types (Camera3D, DirectionalLight3D, AudioStreamPlayer, HTTPRequest, RayCast3D, etc.). Set any property via the properties parameter with type conversion support (Vector2, Vector3, Color, etc.). Use query_classes to discover available node types. Use query_class_info to discover available properties for a type.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              parentNodePath: {
                type: 'string',
                description: 'Node path within scene (e.g., "." for root, "Player" for direct child, "Player/Sprite2D" for nested)',
              },
              nodeType: {
                type: 'string',
                description: 'Godot node class name (e.g., "Sprite2D", "CollisionShape2D", "CharacterBody2D"). Must be valid Godot 4 class.',
              },
              nodeName: {
                type: 'string',
                description: 'Name for the new node (will be unique identifier in scene tree)',
              },
              properties: {
                type: 'string',
                description: 'Optional properties to set on the node (as JSON string)',
              },
            },
            required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
          },
        },
        {
          name: 'load_sprite',
          description: 'Assigns a texture to a Sprite2D node in a scene. Use to set character sprites, backgrounds, or UI images. The texture file must exist in the project.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to Sprite2D node in scene (e.g., ".", "Player/Sprite2D")',
              },
              texturePath: {
                type: 'string',
                description: 'Path to texture file relative to project (e.g., "assets/player.png", "sprites/enemy.svg")',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
          },
        },
        {
          name: 'save_scene',
          description: 'Saves changes to a scene file or creates a variant at a new path. Most scene modification tools save automatically, but use this for explicit saves or creating variants.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              newPath: {
                type: 'string',
                description: 'Optional: New path to save as variant (e.g., "scenes/PlayerBlue.tscn")',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'get_uid',
          description: 'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file (relative to project) for which to get the UID',
              },
            },
            required: ['projectPath', 'filePath'],
          },
        },
        {
          name: 'update_project_uids',
          description: 'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        // ============================================
        // Phase 1: Scene Operations (V3 Enhancement)
        // ============================================
        {
          name: 'list_scene_nodes',
          description: 'Returns complete scene tree structure with all nodes, types, and hierarchy. Use to understand scene organization before modifying. Returns nested tree with node paths.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              depth: {
                type: 'number',
                description: 'Maximum depth to traverse. -1 = all (default), 0 = root only, 1 = root + children',
              },
              includeProperties: {
                type: 'boolean',
                description: 'If true, includes all node properties. If false (default), only names and types.',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'get_node_properties',
          description: 'Returns all properties of a specific node in a scene. Use to inspect current values before modifying. Returns property names, values, and types.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to node within scene (e.g., ".", "Player", "Player/Sprite2D")',
              },
              includeDefaults: {
                type: 'boolean',
                description: 'If true, includes properties with default values. If false (default), only modified properties.',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath'],
          },
        },
        {
          name: 'set_node_properties',
          description: 'Sets multiple properties on a node in a scene. Prerequisite: scene and node must exist (use create_scene and add_node first). Use to modify position, scale, rotation, or any node-specific properties. Scene is saved automatically unless saveScene=false.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to node within scene (e.g., ".", "Player", "Player/Sprite2D")',
              },
              properties: {
                type: 'string',
                description: 'JSON object of properties to set (e.g., {"position": {"x": 100, "y": 200}, "scale": {"x": 2, "y": 2}})',
              },
              saveScene: {
                type: 'boolean',
                description: 'If true (default), saves scene after modification. Set false for batch operations.',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'properties'],
          },
        },
        {
          name: 'delete_node',
          description: 'Removes a node and all its children from a scene. Use to clean up unused nodes. Cannot delete root node. Scene is saved automatically unless saveScene=false.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to node to delete (e.g., "Player/OldSprite", "Enemies/Enemy1")',
              },
              saveScene: {
                type: 'boolean',
                description: 'If true (default), saves scene after deletion. Set false for batch operations.',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath'],
          },
        },
        {
          name: 'duplicate_node',
          description: 'Creates a copy of a node with all its properties and children. Use to replicate enemies, UI elements, or any repeated structures. Scene is saved automatically unless saveScene=false.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Level.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to node to duplicate (e.g., "Enemies/Enemy", "UI/Button")',
              },
              newName: {
                type: 'string',
                description: 'Name for the new duplicated node (e.g., "Enemy2", "ButtonCopy")',
              },
              parentPath: {
                type: 'string',
                description: 'Optional: Different parent path. If omitted, uses same parent as original.',
              },
              saveScene: {
                type: 'boolean',
                description: 'If true (default), saves scene after duplication. Set false for batch operations.',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'newName'],
          },
        },
        {
          name: 'reparent_node',
          description: 'Moves a node to a different parent in the scene tree, preserving all properties and children. Use for reorganizing scene hierarchy. Scene is saved automatically unless saveScene=false.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Level.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Path to node to move (e.g., "OldParent/Child", "UI/Button")',
              },
              newParentPath: {
                type: 'string',
                description: 'Path to new parent node (e.g., "NewParent", "UI/Panel")',
              },
              saveScene: {
                type: 'boolean',
                description: 'If true (default), saves scene after reparenting. Set false for batch operations.',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'newParentPath'],
          },
        },
        // ============================================
        // Phase 2: Import/Export Pipeline (V3 Enhancement)
        // ============================================
        {
          name: 'get_import_status',
          description: 'Returns import status for project resources. Use to find outdated or failed imports. Shows which resources need reimporting.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Optional: specific resource path (e.g., "textures/player.png"). If omitted, returns all.',
              },
              includeUpToDate: {
                type: 'boolean',
                description: 'If true, includes already-imported resources. Default: false (only pending)',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_import_options',
          description: 'Returns current import settings for a resource. Use to check compression, mipmaps, filter settings before modifying.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Path to resource file (e.g., "textures/player.png", "audio/music.ogg")',
              },
            },
            required: ['projectPath', 'resourcePath'],
          },
        },
        {
          name: 'set_import_options',
          description: 'Modifies import settings for a resource. Use to change compression, mipmaps, filter mode. Triggers reimport by default.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Path to resource file (e.g., "textures/player.png")',
              },
              options: {
                type: 'string',
                description: 'JSON string of import options (e.g., {"compress/mode": 1, "mipmaps/generate": true})',
              },
              reimport: {
                type: 'boolean',
                description: 'If true (default), reimports after setting. Set false for batch changes.',
              },
            },
            required: ['projectPath', 'resourcePath', 'options'],
          },
        },
        {
          name: 'reimport_resource',
          description: 'Forces reimport of resources. Use after modifying source files or to fix import issues. Can reimport single file or all modified.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Optional: specific resource to reimport. If omitted, reimports all modified.',
              },
              force: {
                type: 'boolean',
                description: 'If true, reimports even if up-to-date. Default: false',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'list_export_presets',
          description: 'Lists all export presets defined in export_presets.cfg. Use before export_project to see available targets (Windows, Linux, Android, etc.).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              includeTemplateStatus: {
                type: 'boolean',
                description: 'If true (default), shows if export templates are installed.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'export_project',
          description: 'Exports the project to a distributable format. Use to build final game executables. Requires export templates installed.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              preset: {
                type: 'string',
                description: 'Export preset name from export_presets.cfg (e.g., "Windows Desktop", "Linux/X11")',
              },
              outputPath: {
                type: 'string',
                description: 'Destination path for exported file (e.g., "builds/game.exe", "builds/game.x86_64")',
              },
              debug: {
                type: 'boolean',
                description: 'If true, exports debug build. Default: false (release)',
              },
            },
            required: ['projectPath', 'preset', 'outputPath'],
          },
        },
        {
          name: 'validate_project',
          description: 'Checks project for export issues: missing resources, script errors, configuration problems. Use before export_project.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              preset: {
                type: 'string',
                description: 'Optional: validate against specific export preset requirements',
              },
              includeSuggestions: {
                type: 'boolean',
                description: 'If true (default), includes fix suggestions for each issue',
              },
            },
            required: ['projectPath'],
          },
        },
        // ============================================
        // Phase 3: DX Tools (V3 Enhancement)
        // ============================================
        {
          name: 'get_dependencies',
          description: 'Analyzes resource dependencies and detects circular references. Use to understand what a scene/script depends on before refactoring.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Path to analyze (e.g., "scenes/player.tscn", "scripts/game.gd")',
              },
              depth: {
                type: 'number',
                description: 'How deep to traverse dependencies. -1 for unlimited. Default: -1',
              },
              includeBuiltin: {
                type: 'boolean',
                description: 'If true, includes Godot built-in resources. Default: false',
              },
            },
            required: ['projectPath', 'resourcePath'],
          },
        },
        {
          name: 'find_resource_usages',
          description: 'Finds all files that reference a resource. Use before deleting or renaming to avoid breaking references.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Resource to search for (e.g., "textures/player.png")',
              },
              fileTypes: {
                type: 'array',
                items: { type: 'string' },
                description: 'File types to search. Default: ["tscn", "tres", "gd"]',
              },
            },
            required: ['projectPath', 'resourcePath'],
          },
        },
        {
          name: 'parse_error_log',
          description: 'Parses Godot error log and provides fix suggestions. Use to diagnose runtime errors or script issues.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              logContent: {
                type: 'string',
                description: 'Optional: error log text. If omitted, reads from godot.log',
              },
              maxErrors: {
                type: 'number',
                description: 'Maximum errors to return. Default: 50',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_project_health',
          description: 'Generates a health report with scoring for project quality. Checks for unused resources, script errors, missing references, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              includeDetails: {
                type: 'boolean',
                description: 'If true (default), includes detailed breakdown per category',
              },
            },
            required: ['projectPath'],
          },
        },
        // ============================================
        // Phase 3: Project Configuration Tools
        // ============================================
        {
          name: 'get_project_setting',
          description: 'Reads a value from project.godot settings. Use to check game name, window size, physics settings, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              setting: {
                type: 'string',
                description: 'Setting path (e.g., "application/config/name", "display/window/size/width", "physics/2d/default_gravity")',
              },
            },
            required: ['projectPath', 'setting'],
          },
        },
        {
          name: 'set_project_setting',
          description: 'Writes a value to project.godot settings. Use to configure game name, window size, physics, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              setting: {
                type: 'string',
                description: 'Setting path (e.g., "application/config/name", "display/window/size/width")',
              },
              value: {
                type: 'string',
                description: 'Value to set (Godot auto-converts types)',
              },
            },
            required: ['projectPath', 'setting', 'value'],
          },
        },
        {
          name: 'add_autoload',
          description: 'Registers a script/scene as an autoload singleton. Use for global managers (GameManager, AudioManager, etc.). Loads automatically on game start.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              name: {
                type: 'string',
                description: 'Singleton name for global access (e.g., "GameManager", "EventBus")',
              },
              path: {
                type: 'string',
                description: 'Path to .gd or .tscn file (e.g., "autoload/game_manager.gd")',
              },
              enabled: {
                type: 'boolean',
                description: 'If true (default), autoload is active. Set false to temporarily disable.',
              },
            },
            required: ['projectPath', 'name', 'path'],
          },
        },
        {
          name: 'remove_autoload',
          description: 'Unregisters an autoload singleton. Use to remove global managers no longer needed.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              name: {
                type: 'string',
                description: 'Singleton name to remove (e.g., "GameManager")',
              },
            },
            required: ['projectPath', 'name'],
          },
        },
        {
          name: 'list_autoloads',
          description: 'Lists all registered autoload singletons in the project. Shows name, path, and enabled status.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'set_main_scene',
          description: 'Sets which scene loads first when the game starts. Updates application/run/main_scene in project.godot.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to main scene (e.g., "scenes/main_menu.tscn", "scenes/game.tscn")',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        // ============================================
        // Signal Management Tools
        // ============================================
        {
          name: 'connect_signal',
          description: 'Creates a signal connection between nodes in a scene. Prerequisite: source and target nodes must exist. Use to wire up button clicks, collision events, custom signals. Saved to scene file.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file (e.g., "scenes/ui/menu.tscn")',
              },
              sourceNodePath: {
                type: 'string',
                description: 'Emitting node path (e.g., "StartButton", "Player/Area2D")',
              },
              signalName: {
                type: 'string',
                description: 'Signal name (e.g., "pressed", "body_entered", "health_changed")',
              },
              targetNodePath: {
                type: 'string',
                description: 'Receiving node path (e.g., ".", "Player", "../GameManager")',
              },
              methodName: {
                type: 'string',
                description: 'Method to call on target (e.g., "_on_start_pressed", "take_damage")',
              },
              flags: {
                type: 'number',
                description: 'Optional: connection flags (0=default, 1=deferred, 2=persist, 4=one_shot)',
              },
            },
            required: ['projectPath', 'scenePath', 'sourceNodePath', 'signalName', 'targetNodePath', 'methodName'],
          },
        },
        {
          name: 'disconnect_signal',
          description: 'Removes a signal connection from a scene. Use to clean up unused connections or rewire logic.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file (e.g., "scenes/ui/menu.tscn")',
              },
              sourceNodePath: {
                type: 'string',
                description: 'Emitting node path (e.g., "StartButton")',
              },
              signalName: {
                type: 'string',
                description: 'Signal name (e.g., "pressed")',
              },
              targetNodePath: {
                type: 'string',
                description: 'Receiving node path (e.g., ".")',
              },
              methodName: {
                type: 'string',
                description: 'Connected method name (e.g., "_on_start_pressed")',
              },
            },
            required: ['projectPath', 'scenePath', 'sourceNodePath', 'signalName', 'targetNodePath', 'methodName'],
          },
        },
        {
          name: 'list_connections',
          description: 'Lists all signal connections in a scene. Use to understand event flow or debug connection issues.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file (e.g., "scenes/player.tscn")',
              },
              nodePath: {
                type: 'string',
                description: 'Optional: filter to connections involving this node. If omitted, shows all.',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        // ============================================
        // Phase 4: Runtime Connection Tools
        // ============================================
        {
          name: 'get_runtime_status',
          description: 'Checks if a Godot game instance is running and connected for live debugging. Use before other runtime tools.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'inspect_runtime_tree',
          description: 'Inspect the scene tree of a running Godot instance',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              nodePath: {
                type: 'string',
                description: 'Path to start inspection from (default: root)',
              },
              depth: {
                type: 'number',
                description: 'Maximum depth to inspect (default: 3)',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'set_runtime_property',
          description: 'Set a property on a node in a running Godot instance',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              nodePath: {
                type: 'string',
                description: 'Path to the target node',
              },
              property: {
                type: 'string',
                description: 'Property name to set',
              },
              value: {
                type: 'string',
                description: 'Value to set (Godot handles type conversion)',
              },
            },
            required: ['projectPath', 'nodePath', 'property', 'value'],
          },
        },
        {
          name: 'call_runtime_method',
          description: 'Call a method on a node in a running Godot instance',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              nodePath: {
                type: 'string',
                description: 'Path to the target node',
              },
              method: {
                type: 'string',
                description: 'Method name to call',
              },
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Arguments to pass to the method (as JSON strings)',
              },
            },
            required: ['projectPath', 'nodePath', 'method'],
          },
        },
        {
          name: 'get_runtime_metrics',
          description: 'Get performance metrics from a running Godot instance',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific metrics to retrieve (default: all)',
              },
            },
            required: ['projectPath'],
          },
        },
        // ============================================
        // Resource Creation Tools
        // ============================================
        {
          name: 'create_resource',
          description: 'Creates ANY resource type as a .tres file. This is the universal resource creation tool — replaces all specialized create_* resource tools (PhysicsMaterial, Environment, Theme, etc.). Supports ALL ClassDB resource types. Set any property via the properties parameter with type conversion support. Use query_classes with category "resource" to discover available resource types. Use query_class_info to discover available properties.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              resourcePath: {
                type: 'string',
                description: 'Path for new .tres file relative to project (e.g., "resources/items/sword.tres")',
              },
              resourceType: {
                type: 'string',
                description: 'Resource class name (e.g., "Resource", "CurveTexture", "GradientTexture2D")',
              },
              properties: {
                type: 'string',
                description: 'Optional: JSON object of properties to set (e.g., {"value": 100})',
              },
              script: {
                type: 'string',
                description: 'Optional: path to custom Resource script (e.g., "scripts/resources/item_data.gd")',
              },
            },
            required: ['projectPath', 'resourcePath', 'resourceType'],
          },
        },
        {
          name: 'create_material',
          description: 'Creates a material resource for 3D/2D rendering. Types: StandardMaterial3D (PBR), ShaderMaterial (custom), CanvasItemMaterial (2D), ParticleProcessMaterial (particles).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              materialPath: {
                type: 'string',
                description: 'Path for new material file relative to project (e.g., "materials/player.tres")',
              },
              materialType: {
                type: 'string',
                enum: ['StandardMaterial3D', 'ShaderMaterial', 'CanvasItemMaterial', 'ParticleProcessMaterial'],
                description: 'Material type: StandardMaterial3D (3D PBR), ShaderMaterial (custom shader), CanvasItemMaterial (2D), ParticleProcessMaterial (particles)',
              },
              properties: {
                type: 'string',
                description: 'Optional: JSON object of properties (e.g., {"albedo_color": [1, 0, 0, 1], "metallic": 0.8})',
              },
              shader: {
                type: 'string',
                description: 'Optional for ShaderMaterial: path to .gdshader file (e.g., "shaders/outline.gdshader")',
              },
            },
            required: ['projectPath', 'materialPath', 'materialType'],
          },
        },
        {
          name: 'create_shader',
          description: 'Creates a shader file (.gdshader) with optional templates. Types: canvas_item (2D), spatial (3D), particles, sky, fog. Templates: basic, color_shift, outline.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              shaderPath: {
                type: 'string',
                description: 'Path for new .gdshader file relative to project (e.g., "shaders/outline.gdshader")',
              },
              shaderType: {
                type: 'string',
                enum: ['canvas_item', 'spatial', 'particles', 'sky', 'fog'],
                description: 'Shader type: canvas_item (2D/UI), spatial (3D), particles, sky, fog',
              },
              code: {
                type: 'string',
                description: 'Optional: custom shader code. If omitted, uses template or generates basic shader.',
              },
              template: {
                type: 'string',
                description: 'Optional: predefined template - "basic", "color_shift", "outline"',
              },
            },
            required: ['projectPath', 'shaderPath', 'shaderType'],
          },
        },
        // ============================================
        // GDScript File Operations
        // ============================================
        {
          name: 'create_script',
          description: 'Creates a new GDScript (.gd) file with optional templates. Use to generate scripts for game logic. Templates: "singleton" (autoload), "state_machine" (FSM), "component" (modular), "resource" (custom Resource).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scriptPath: {
                type: 'string',
                description: 'Path for new script relative to project (e.g., "scripts/player.gd", "autoload/game_manager.gd")',
              },
              className: {
                type: 'string',
                description: 'Optional: class_name for global access (e.g., "Player", "GameManager")',
              },
              extends: {
                type: 'string',
                description: 'Base class to extend (e.g., "Node", "CharacterBody2D", "Resource"). Default: "Node"',
              },
              content: {
                type: 'string',
                description: 'Optional: initial script content to add after class declaration',
              },
              template: {
                type: 'string',
                description: 'Optional: template name - "singleton", "state_machine", "component", "resource"',
              },
              reason: {
                type: 'string',
                description: 'Optional reason/context for this change. Displayed in visualizer audit timeline.',
              },
            },
            required: ['projectPath', 'scriptPath'],
          },
        },
        {
          name: 'modify_script',
          description: 'Adds functions, variables, or signals to an existing GDScript. Use to extend scripts without manual editing. Supports @export, @onready annotations and type hints.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scriptPath: {
                type: 'string',
                description: 'Path to existing .gd file relative to project (e.g., "scripts/player.gd")',
              },
              modifications: {
                type: 'array',
                description: 'Array of modifications to apply',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Modification type: "add_function", "add_variable", or "add_signal"',
                    },
                    name: {
                      type: 'string',
                      description: 'Name of the function, variable, or signal',
                    },
                    params: {
                      type: 'string',
                      description: 'For functions/signals: parameter string (e.g., "delta: float, input: Vector2")',
                    },
                    returnType: {
                      type: 'string',
                      description: 'For functions: return type (e.g., "void", "bool", "Vector2")',
                    },
                    body: {
                      type: 'string',
                      description: 'For functions: function body code',
                    },
                    varType: {
                      type: 'string',
                      description: 'For variables: type annotation',
                    },
                    defaultValue: {
                      type: 'string',
                      description: 'For variables: default value',
                    },
                    isExport: {
                      type: 'boolean',
                      description: 'For variables: whether to add @export annotation',
                    },
                    exportHint: {
                      type: 'string',
                      description: 'For variables: export hint (e.g., "range(0, 100)")',
                    },
                    isOnready: {
                      type: 'boolean',
                      description: 'For variables: whether to add @onready annotation',
                    },
                    position: {
                      type: 'string',
                      description: 'For functions: where to insert ("end", "after_ready", "after_init")',
                    },
                  },
                  required: ['type', 'name'],
                },
              },
              reason: {
                type: 'string',
                description: 'Optional reason/context for this change. Displayed in visualizer audit timeline.',
              },
            },
            required: ['projectPath', 'scriptPath', 'modifications'],
          },
        },
        {
          name: 'get_script_info',
          description: 'Analyzes a GDScript and returns its structure: functions, variables, signals, class_name, extends. Use before modify_script to understand existing code.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scriptPath: {
                type: 'string',
                description: 'Path to .gd file relative to project (e.g., "scripts/player.gd")',
              },
              includeInherited: {
                type: 'boolean',
                description: 'If true, includes members from parent classes. Default: false (only script-defined members).',
              },
            },
            required: ['projectPath', 'scriptPath'],
          },
        },
        // ============================================
        // Animation Tools
        // ============================================
        {
          name: 'create_animation',
          description: 'Creates a new animation in an AnimationPlayer. Prerequisite: AnimationPlayer node must exist in scene (use add_node first). Use to set up character animations, UI transitions, or cutscenes. Supports loop modes: none, linear, pingpong.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              playerNodePath: {
                type: 'string',
                description: 'Path to AnimationPlayer node in scene (e.g., ".", "Player/AnimationPlayer")',
              },
              animationName: {
                type: 'string',
                description: 'Name for new animation (e.g., "walk", "idle", "attack")',
              },
              length: {
                type: 'number',
                description: 'Duration of the animation in seconds (default: 1.0)',
              },
              loopMode: {
                type: 'string',
                enum: ['none', 'linear', 'pingpong'],
                description: 'Loop mode for the animation (default: "none")',
              },
              step: {
                type: 'number',
                description: 'Keyframe snap step in seconds (default: 0.1)',
              },
            },
            required: ['projectPath', 'scenePath', 'playerNodePath', 'animationName'],
          },
        },
        {
          name: 'add_animation_track',
          description: 'Adds a property or method track to an animation. Prerequisite: animation must exist (use create_animation first). Use to animate position, rotation, color, or call methods at specific times. Keyframes define values over time.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to .tscn file relative to project (e.g., "scenes/Player.tscn")',
              },
              playerNodePath: {
                type: 'string',
                description: 'Path to AnimationPlayer node in scene (e.g., ".", "Player/AnimationPlayer")',
              },
              animationName: {
                type: 'string',
                description: 'Name of existing animation to add track to (e.g., "walk", "idle")',
              },
              track: {
                type: 'object',
                description: 'Track configuration',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['property', 'method'],
                    description: 'Type of track to add',
                  },
                  nodePath: {
                    type: 'string',
                    description: 'Path to the target node relative to AnimationPlayer\'s root (e.g., "Sprite2D")',
                  },
                  property: {
                    type: 'string',
                    description: 'Property name to animate (for property tracks, e.g., "position", "modulate")',
                  },
                  method: {
                    type: 'string',
                    description: 'Method name to call (for method tracks)',
                  },
                  keyframes: {
                    type: 'array',
                    description: 'Array of keyframes',
                    items: {
                      type: 'object',
                      properties: {
                        time: {
                          type: 'number',
                          description: 'Time position in seconds',
                        },
                        value: {
                          type: 'string',
                          description: 'Value at this keyframe (for property tracks)',
                        },
                        args: {
                          type: 'array',
                          items: { type: 'string' },
                          description: 'Arguments to pass to the method (for method tracks, as JSON strings)',
                        },
                      },
                      required: ['time'],
                    },
                  },
                },
                required: ['type', 'nodePath', 'keyframes'],
              },
            },
            required: ['projectPath', 'scenePath', 'playerNodePath', 'animationName', 'track'],
          },
        },
        // ============================================
        // Plugin Management Tools
        // ============================================
        {
          name: 'list_plugins',
          description: 'Lists all plugins in addons/ folder with enabled/disabled status. Use before enable_plugin or disable_plugin to see available plugins.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'enable_plugin',
          description: 'Enables a plugin from addons/ folder. Updates project.godot automatically. Use list_plugins first to see available plugins.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              pluginName: {
                type: 'string',
                description: 'Plugin folder name in addons/ (e.g., "dialogue_manager", "scatter")',
              },
            },
            required: ['projectPath', 'pluginName'],
          },
        },
        {
          name: 'disable_plugin',
          description: 'Disables a plugin in the project. Updates project.godot automatically. Plugin files remain in addons/ folder.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              pluginName: {
                type: 'string',
                description: 'Plugin folder name in addons/ (e.g., "dialogue_manager", "scatter")',
              },
            },
            required: ['projectPath', 'pluginName'],
          },
        },
        // ============================================
        // Input Action Tools
        // ============================================
        {
          name: 'add_input_action',
          description: 'Registers a new input action in project.godot InputMap. Use to set up keyboard, mouse, or gamepad controls for player actions like jump, move, attack.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              actionName: {
                type: 'string',
                description: 'Action name used in code (e.g., "jump", "move_left", "attack")',
              },
              events: {
                type: 'array',
                description: 'Array of input events - each with type (key/mouse_button/joypad_button/joypad_axis) and binding details',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['key', 'mouse_button', 'joypad_button', 'joypad_axis'],
                      description: 'Input event type',
                    },
                    keycode: {
                      type: 'string',
                      description: 'For key: key name (e.g., "Space", "W", "Escape")',
                    },
                    button: {
                      type: 'number',
                      description: 'For mouse_button: 1=left, 2=right, 3=middle; For joypad: button number',
                    },
                    axis: {
                      type: 'number',
                      description: 'For joypad_axis: axis number (0-3)',
                    },
                    axisValue: {
                      type: 'number',
                      description: 'For joypad_axis: direction (-1 or 1)',
                    },
                    ctrl: {
                      type: 'boolean',
                      description: 'For key: require Ctrl modifier',
                    },
                    alt: {
                      type: 'boolean',
                      description: 'For key: require Alt modifier',
                    },
                    shift: {
                      type: 'boolean',
                      description: 'For key: require Shift modifier',
                    },
                  },
                  required: ['type'],
                },
              },
              deadzone: {
                type: 'number',
                description: 'Analog stick deadzone (0-1). Default: 0.5',
              },
            },
            required: ['projectPath', 'actionName', 'events'],
          },
        },
        // ============================================
        // Project Search Tool
        // ============================================
        {
          name: 'search_project',
          description: 'Searches for text or regex patterns across project files. Use to find function usages, variable references, or TODOs. Returns file paths and line numbers.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              query: {
                type: 'string',
                description: 'Search text or regex pattern (e.g., "player", "TODO", "func.*damage")',
              },
              fileTypes: {
                type: 'array',
                items: { type: 'string' },
                description: 'File extensions to search. Default: ["gd", "tscn", "tres"]',
              },
              regex: {
                type: 'boolean',
                description: 'If true, treats query as regex. Default: false',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'If true, case-sensitive search. Default: false',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum results to return. Default: 100',
              },
            },
            required: ['projectPath', 'query'],
          },
        },
        // ============================================
        // 2D Tile Tools
        // ============================================
        {
          name: 'create_tileset',
          description: 'Creates a TileSet resource from texture atlases. Use for 2D tilemaps in platformers, RPGs, etc. Supports multiple atlas sources.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              tilesetPath: {
                type: 'string',
                description: 'Output path for TileSet (e.g., "resources/world_tiles.tres")',
              },
              sources: {
                type: 'array',
                description: 'Array of atlas sources, each with texture path and tileSize {x, y}',
                items: {
                  type: 'object',
                  properties: {
                    texture: {
                      type: 'string',
                      description: 'Texture path relative to project (e.g., "sprites/tileset.png")',
                    },
                    tileSize: {
                      type: 'object',
                      description: 'Tile dimensions in pixels',
                      properties: {
                        x: { type: 'number', description: 'Tile width (e.g., 16, 32)' },
                        y: { type: 'number', description: 'Tile height (e.g., 16, 32)' },
                      },
                      required: ['x', 'y'],
                    },
                    separation: {
                      type: 'object',
                      description: 'Optional: gap between tiles in source texture',
                      properties: {
                        x: { type: 'number', description: 'Horizontal gap' },
                        y: { type: 'number', description: 'Vertical gap' },
                      },
                    },
                    offset: {
                      type: 'object',
                      description: 'Optional: offset from texture origin',
                      properties: {
                        x: { type: 'number', description: 'Horizontal offset' },
                        y: { type: 'number', description: 'Vertical offset' },
                      },
                    },
                  },
                  required: ['texture', 'tileSize'],
                },
              },
            },
            required: ['projectPath', 'tilesetPath', 'sources'],
          },
        },
        {
          name: 'set_tilemap_cells',
          description: 'Places tiles in a TileMap node. Use to programmatically generate levels or modify existing tilemaps.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.',
              },
              scenePath: {
                type: 'string',
                description: 'Path to scene containing TileMap (e.g., "scenes/level1.tscn")',
              },
              tilemapNodePath: {
                type: 'string',
                description: 'Path to TileMap node (e.g., "World/TileMap")',
              },
              layer: {
                type: 'number',
                description: 'TileMap layer index. Default: 0',
              },
              cells: {
                type: 'array',
                description: 'Array of cells with coords {x,y}, sourceId, atlasCoords {x,y}',
                items: {
                  type: 'object',
                  properties: {
                    coords: {
                      type: 'object',
                      description: 'Grid position in tilemap',
                      properties: {
                        x: { type: 'number', description: 'Grid X' },
                        y: { type: 'number', description: 'Grid Y' },
                      },
                      required: ['x', 'y'],
                    },
                    sourceId: {
                      type: 'number',
                      description: 'TileSet source ID (0-indexed)',
                    },
                    atlasCoords: {
                      type: 'object',
                      description: 'Tile position in atlas',
                      properties: {
                        x: { type: 'number', description: 'Atlas X' },
                        y: { type: 'number', description: 'Atlas Y' },
                      },
                      required: ['x', 'y'],
                    },
                    alternativeTile: {
                      type: 'number',
                      description: 'Optional: alternative tile variant. Default: 0',
                    },
                  },
                  required: ['coords', 'sourceId', 'atlasCoords'],
                },
              },
            },
            required: ['projectPath', 'scenePath', 'tilemapNodePath', 'cells'],
          },
        },
        // ==================== AUDIO SYSTEM TOOLS ====================
        {
          name: 'create_audio_bus',
          description: 'Creates a new audio bus for mixing. Use to set up separate volume controls for music, SFX, voice, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              busName: { type: 'string', description: 'Name for the audio bus (e.g., "Music", "SFX", "Voice")' },
              parentBusIndex: { type: 'number', description: 'Parent bus index. Default: 0 (Master)' },
            },
            required: ['projectPath', 'busName'],
          },
        },
        {
          name: 'get_audio_buses',
          description: 'Lists all audio buses and their configuration. Use to check current audio setup.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'set_audio_bus_effect',
          description: 'Adds or configures an audio effect on a bus. Use for reverb, delay, EQ, compression, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              busIndex: { type: 'number', description: 'Bus index (0 = Master)' },
              effectIndex: { type: 'number', description: 'Effect slot index (0-7)' },
              effectType: { type: 'string', description: 'Effect type (e.g., "Reverb", "Delay", "Chorus", "Compressor")' },
              enabled: { type: 'boolean', description: 'Whether effect is active' },
            },
            required: ['projectPath', 'busIndex', 'effectIndex', 'effectType'],
          },
        },
        {
          name: 'set_audio_bus_volume',
          description: 'Sets volume for an audio bus in decibels. Use to balance audio levels.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              busIndex: { type: 'number', description: 'Bus index (0 = Master)' },
              volumeDb: { type: 'number', description: 'Volume in decibels (0 = unity, -80 = silent, +6 = boost)' },
            },
            required: ['projectPath', 'busIndex', 'volumeDb'],
          },
        },
        // ==================== NETWORKING TOOLS ====================
        // ==================== PHYSICS TOOLS ====================
        // ==================== NAVIGATION TOOLS ====================
        {
          name: 'create_navigation_region',
          description: 'Creates a NavigationRegion for pathfinding. Use to define walkable areas for AI navigation.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              scenePath: { type: 'string', description: 'Path to scene file' },
              parentPath: { type: 'string', description: 'Parent node path' },
              nodeName: { type: 'string', description: 'Node name (e.g., "WalkableArea")' },
              is3D: { type: 'boolean', description: 'If true, creates NavigationRegion3D. Default: false' },
            },
            required: ['projectPath', 'scenePath', 'parentPath', 'nodeName'],
          },
        },
        {
          name: 'create_navigation_agent',
          description: 'Creates a NavigationAgent for AI pathfinding. Use for enemies, NPCs that need to navigate around obstacles.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              scenePath: { type: 'string', description: 'Path to scene file' },
              parentPath: { type: 'string', description: 'Parent node path (usually the character)' },
              nodeName: { type: 'string', description: 'Node name (e.g., "NavAgent")' },
              is3D: { type: 'boolean', description: 'If true, creates NavigationAgent3D. Default: false' },
              pathDesiredDistance: { type: 'number', description: 'Distance to consider waypoint reached' },
              targetDesiredDistance: { type: 'number', description: 'Distance to consider target reached' },
            },
            required: ['projectPath', 'scenePath', 'parentPath', 'nodeName'],
          },
        },
        // ==================== RENDERING TOOLS ====================
        // ==================== ANIMATION TREE TOOLS ====================
        {
          name: 'create_animation_tree',
          description: 'Create an AnimationTree node linked to an AnimationPlayer',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              scenePath: { type: 'string', description: 'Path to the scene file' },
              parentPath: { type: 'string', description: 'Parent node path' },
              nodeName: { type: 'string', description: 'Name for AnimationTree' },
              animPlayerPath: { type: 'string', description: 'Path to AnimationPlayer node (relative to parent)' },
              rootType: { type: 'string', enum: ['StateMachine', 'BlendTree', 'BlendSpace1D', 'BlendSpace2D'], description: 'Root node type' },
            },
            required: ['projectPath', 'scenePath', 'parentPath', 'nodeName', 'animPlayerPath'],
          },
        },
        {
          name: 'add_animation_state',
          description: 'Add a state to an AnimationTree state machine',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              scenePath: { type: 'string', description: 'Path to the scene file' },
              animTreePath: { type: 'string', description: 'Path to AnimationTree node' },
              stateName: { type: 'string', description: 'Name for the state' },
              animationName: { type: 'string', description: 'Animation to play in this state' },
              stateMachinePath: { type: 'string', description: 'Path within tree to state machine (default: root)' },
            },
            required: ['projectPath', 'scenePath', 'animTreePath', 'stateName', 'animationName'],
          },
        },
        {
          name: 'connect_animation_states',
          description: 'Connect two states with a transition',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              scenePath: { type: 'string', description: 'Path to the scene file' },
              animTreePath: { type: 'string', description: 'Path to AnimationTree node' },
              fromState: { type: 'string', description: 'Source state name' },
              toState: { type: 'string', description: 'Target state name' },
              transitionType: { type: 'string', enum: ['immediate', 'sync', 'at_end'], description: 'Transition type' },
              advanceCondition: { type: 'string', description: 'Condition parameter name for auto-advance' },
            },
            required: ['projectPath', 'scenePath', 'animTreePath', 'fromState', 'toState'],
          },
        },
        // ==================== UI/THEME TOOLS ====================
        {
          name: 'set_theme_color',
          description: 'Set a color in a Theme resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              themePath: { type: 'string', description: 'Path to the theme resource' },
              controlType: { type: 'string', description: 'Control type (Button, Label, etc.)' },
              colorName: { type: 'string', description: 'Color name (font_color, etc.)' },
              color: { type: 'object', properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' }, a: { type: 'number' } }, description: 'Color value' },
            },
            required: ['projectPath', 'themePath', 'controlType', 'colorName', 'color'],
          },
        },
        {
          name: 'set_theme_font_size',
          description: 'Set a font size in a Theme resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot. Use the same path across all tool calls in a workflow.' },
              themePath: { type: 'string', description: 'Path to the theme resource' },
              controlType: { type: 'string', description: 'Control type (Button, Label, etc.)' },
              fontSizeName: { type: 'string', description: 'Font size name' },
              size: { type: 'number', description: 'Font size in pixels' },
            },
            required: ['projectPath', 'themePath', 'controlType', 'fontSizeName', 'size'],
          },
        },
        // ==================== THEME BUILDER TOOLS ====================
        {
          name: 'apply_theme_shader',
          description: 'Generate and apply theme-appropriate shader to a material in a scene',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
              nodePath: { type: 'string', description: 'Path to MeshInstance3D or Sprite node' },
              theme: {
                type: 'string',
                enum: ['medieval', 'cyberpunk', 'nature', 'scifi', 'horror', 'cartoon'],
                description: 'Visual theme to apply'
              },
              effect: {
                type: 'string',
                enum: ['none', 'glow', 'hologram', 'wind_sway', 'torch_fire', 'dissolve', 'outline'],
                description: 'Special effect to add (default: none)'
              },
              shaderParams: {
                type: 'string',
                description: 'Optional JSON string with custom shader parameters'
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'theme'],
          },
        },
        // ==================== CLASSDB INTROSPECTION TOOLS ====================
        {
          name: 'query_classes',
          description: 'Query available Godot classes from ClassDB with filtering. Use to discover node types, resource types, or any class before using add_node/create_resource. Categories: node, node2d, node3d, control, resource, physics, physics2d, audio, visual, animation.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              filter: { type: 'string', description: 'Optional: substring filter for class names (case-insensitive, e.g., "light", "collision")' },
              category: { type: 'string', description: 'Optional: filter by category (node, node2d, node3d, control, resource, physics, physics2d, audio, visual, animation)' },
              instantiableOnly: { type: 'boolean', description: 'If true, only return classes that can be instantiated (default: false)' },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'query_class_info',
          description: 'Get detailed information about a specific Godot class: methods, properties, signals, enums. Use to discover available properties before calling add_node/create_resource/set_node_properties, or to find methods before call_runtime_method.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              className: { type: 'string', description: 'Exact Godot class name (e.g., "CharacterBody3D", "StandardMaterial3D", "AnimationPlayer")' },
              includeInherited: { type: 'boolean', description: 'If true, include inherited members from parent classes (default: false — shows only class-specific members)' },
            },
            required: ['projectPath', 'className'],
          },
        },
        {
          name: 'inspect_inheritance',
          description: 'Inspect class inheritance hierarchy: ancestors, direct children, all descendants. Use to understand class relationships and find specialized alternatives.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              className: { type: 'string', description: 'Exact Godot class name to inspect' },
            },
            required: ['projectPath', 'className'],
          },
        },
        // ==================== RESOURCE MODIFICATION TOOL ====================
        {
          name: 'modify_resource',
          description: 'Modify properties of an existing resource file (.tres/.res). Use to update materials, environments, themes, or any saved resource without recreating it.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to project directory containing project.godot.' },
              resourcePath: { type: 'string', description: 'Path to existing resource file relative to project (e.g., "materials/player.tres")' },
              properties: { type: 'string', description: 'JSON object of properties to set (e.g., {"albedo_color": {"_type": "Color", "r": 1, "g": 0, "b": 0, "a": 1}})' },
            },
            required: ['projectPath', 'resourcePath', 'properties'],
          },
        },
        // ==================== MULTI-SOURCE ASSET TOOLS ====================
        {
          name: 'search_assets',
          description: 'Search for CC0 assets across multiple sources (Poly Haven, AmbientCG, Kenney). Returns results sorted by provider priority.',
          inputSchema: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: 'Search term (e.g., "chair", "rock", "tree")' },
              assetType: {
                type: 'string',
                enum: ['models', 'textures', 'hdris', 'audio', '2d'],
                description: 'Type of asset to search (optional, searches all if not specified)'
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)'
              },
              provider: {
                type: 'string',
                enum: ['all', 'polyhaven', 'ambientcg', 'kenney'],
                description: 'Specific provider to search, or "all" for multi-source (default: all)'
              },
              mode: {
                type: 'string',
                enum: ['parallel', 'sequential'],
                description: 'Search mode: "parallel" queries all providers, "sequential" stops at first with results (default: parallel)'
              },
            },
            required: ['keyword'],
          },
        },
        {
          name: 'fetch_asset',
          description: 'Download a CC0 asset from any supported source (Poly Haven, AmbientCG, Kenney) to your Godot project.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              assetId: { type: 'string', description: 'Asset ID from search results' },
              provider: {
                type: 'string',
                enum: ['polyhaven', 'ambientcg', 'kenney'],
                description: 'Source provider for the asset'
              },
              resolution: {
                type: 'string',
                enum: ['1k', '2k', '4k'],
                description: 'Resolution for download (default: 2k, only for PolyHaven/AmbientCG)'
              },
              targetFolder: {
                type: 'string',
                description: 'Target folder for download (default: downloaded_assets/<provider>)'
              },
            },
            required: ['projectPath', 'assetId', 'provider'],
          },
        },
        {
          name: 'list_asset_providers',
          description: 'List all available CC0 asset providers and their capabilities.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        // Screenshot Capture Tools (runtime addon TCP port 7777)
        {
          name: 'capture_screenshot',
          description: 'Capture a screenshot of the running Godot game viewport. Requires the runtime addon to be active (game must be running with the MCP runtime autoload).',
          inputSchema: {
            type: 'object',
            properties: {
              width: { type: 'number', description: 'Target width in pixels (default: current viewport width)' },
              height: { type: 'number', description: 'Target height in pixels (default: current viewport height)' },
              format: { type: 'string', enum: ['png', 'jpg'], description: 'Image format (default: png)' },
            },
          },
        },
        {
          name: 'capture_viewport',
          description: 'Capture a viewport texture as base64 image from the running Godot game. Similar to capture_screenshot but captures a specific viewport by path.',
          inputSchema: {
            type: 'object',
            properties: {
              viewportPath: { type: 'string', description: 'NodePath to the target Viewport node (default: root viewport)' },
              width: { type: 'number', description: 'Target width in pixels' },
              height: { type: 'number', description: 'Target height in pixels' },
            },
          },
        },
        // Input Injection Tools (runtime addon TCP port 7777)
        {
          name: 'inject_action',
          description: 'Simulate a Godot input action (press/release). Requires runtime addon.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action name as defined in Input Map (e.g., "ui_accept", "jump")' },
              pressed: { type: 'boolean', description: 'Whether to press (true) or release (false). Default: true' },
              strength: { type: 'number', description: 'Action strength 0.0–1.0. Default: 1.0' },
            },
            required: ['action'],
          },
        },
        {
          name: 'inject_key',
          description: 'Simulate a keyboard key press/release in the running Godot game. Requires runtime addon.',
          inputSchema: {
            type: 'object',
            properties: {
              keycode: { type: 'string', description: 'Key name (e.g., "A", "Space", "Escape", "Enter")' },
              pressed: { type: 'boolean', description: 'Press (true) or release (false). Default: true' },
              shift: { type: 'boolean', description: 'Shift modifier. Default: false' },
              ctrl: { type: 'boolean', description: 'Ctrl modifier. Default: false' },
              alt: { type: 'boolean', description: 'Alt modifier. Default: false' },
            },
            required: ['keycode'],
          },
        },
        {
          name: 'inject_mouse_click',
          description: 'Simulate a mouse click at specified position in the running Godot game. Requires runtime addon.',
          inputSchema: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate in viewport pixels' },
              y: { type: 'number', description: 'Y coordinate in viewport pixels' },
              button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Default: left' },
              pressed: { type: 'boolean', description: 'Press (true) or release (false). Default: true' },
              doubleClick: { type: 'boolean', description: 'Double-click. Default: false' },
            },
            required: ['x', 'y'],
          },
        },
        {
          name: 'inject_mouse_motion',
          description: 'Simulate mouse movement to a position in the running Godot game. Requires runtime addon.',
          inputSchema: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'Target X coordinate in viewport pixels' },
              y: { type: 'number', description: 'Target Y coordinate in viewport pixels' },
              relativeX: { type: 'number', description: 'Relative X movement delta' },
              relativeY: { type: 'number', description: 'Relative Y movement delta' },
            },
            required: ['x', 'y'],
          },
        },
        // Editor Plugin Bridge Status
        {
          name: 'get_editor_status',
          description: 'Returns the connection status of the Godot Editor Plugin bridge. Use to check if the editor is connected before using scene/resource tools that require the editor plugin.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        // Project Visualizer Tool
        {
          name: 'map_project',
          description: `Crawl the entire Godot project and build an interactive visual map of all scripts showing their structure (variables, functions, signals), connections (extends, preloads, signal connections), and descriptions. Opens an interactive browser-based visualization at localhost:${godotBridgePort}.`,
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Absolute path to the Godot project directory' },
              root: { type: 'string', description: 'Root path to start crawling from (default: res://)' },
              include_addons: { type: 'boolean', description: 'Whether to include scripts in addons/ folder (default: false)' },
            },
            required: ['projectPath'],
          },
        },
        // Godot LSP Tools (GDScript diagnostics via Godot editor LSP on port 6005)
        ...createLSPTools(),
        // Godot DAP Tools (Debug Adapter Protocol via Godot editor DAP on port 6006)
        ...createDAPTools(),
      ];
}
