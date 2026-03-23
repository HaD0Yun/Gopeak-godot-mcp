import type { ToolGroupDefinition } from './server-types.js';

export const TOOL_GROUPS: Record<string, ToolGroupDefinition> = {
  scene_advanced: {
    description: 'Advanced scene tree manipulation (duplicate, reparent, sprite)',
    tools: ['duplicate_node', 'reparent_node', 'load_sprite'],
    keywords: ['duplicate', 'reparent', 'move node', 'sprite', 'texture', 'copy node'],
  },
  uid: {
    description: 'UID management for resources',
    tools: ['get_uid', 'update_project_uids'],
    keywords: ['uid', 'resource id', 'unique id'],
  },
  import_export: {
    description: 'Import pipeline and project validation',
    tools: ['get_import_status', 'get_import_options', 'set_import_options', 'reimport_resource', 'validate_project'],
    keywords: ['import', 'reimport', 'import settings', 'import options', 'validate project'],
  },
  autoload: {
    description: 'Autoload singletons and main scene management',
    tools: ['add_autoload', 'remove_autoload', 'list_autoloads', 'set_main_scene'],
    keywords: ['autoload', 'singleton', 'main scene'],
  },
  signal: {
    description: 'Signal disconnection and connection listing',
    tools: ['disconnect_signal', 'list_connections'],
    keywords: ['disconnect signal', 'list signals', 'signal connections', 'list connections'],
  },
  runtime: {
    description: 'Runtime inspection and live game control',
    tools: ['inspect_runtime_tree', 'set_runtime_property', 'call_runtime_method', 'get_runtime_metrics'],
    keywords: ['runtime inspect', 'live inspect', 'running game', 'performance', 'metrics', 'runtime tree', 'runtime property', 'runtime method'],
  },
  resource: {
    description: 'Resource creation and modification (materials, shaders)',
    tools: ['create_resource', 'create_material', 'create_shader', 'modify_resource'],
    keywords: ['material', 'shader', 'resource create', 'modify resource', 'create material', 'create shader'],
  },
  animation: {
    description: 'Animation system (animations, tracks, animation tree, state machine)',
    tools: ['create_animation', 'add_animation_track', 'create_animation_tree', 'add_animation_state', 'connect_animation_states'],
    keywords: ['animation', 'animate', 'keyframe', 'animation tree', 'state machine', 'animation track', 'animation state'],
  },
  plugin: {
    description: 'Plugin/addon management',
    tools: ['list_plugins', 'enable_plugin', 'disable_plugin'],
    keywords: ['plugin', 'addon', 'enable plugin', 'disable plugin', 'list plugins'],
  },
  input: {
    description: 'Input action mapping',
    tools: ['add_input_action'],
    keywords: ['input action', 'input map', 'key binding', 'controller', 'input mapping'],
  },
  tilemap: {
    description: 'TileMap and TileSet system',
    tools: ['create_tileset', 'set_tilemap_cells'],
    keywords: ['tilemap', 'tileset', 'tile', '2d map', 'tilemap cells'],
  },
  audio: {
    description: 'Audio bus system',
    tools: ['create_audio_bus', 'get_audio_buses', 'set_audio_bus_effect', 'set_audio_bus_volume'],
    keywords: ['audio', 'sound', 'music', 'audio bus', 'volume', 'sound effect'],
  },
  navigation: {
    description: 'Navigation and pathfinding system',
    tools: ['create_navigation_region', 'create_navigation_agent'],
    keywords: ['navigation', 'pathfinding', 'navmesh', 'nav agent', 'navigation region'],
  },
  theme_ui: {
    description: 'Theme and UI styling',
    tools: ['set_theme_color', 'set_theme_font_size', 'apply_theme_shader'],
    keywords: ['theme', 'ui style', 'font size', 'color override', 'theme color', 'theme shader'],
  },
  asset_store: {
    description: 'Asset library search and download',
    tools: ['search_assets', 'fetch_asset', 'list_asset_providers'],
    keywords: ['asset store', 'asset library', 'download asset', 'search assets', 'fetch asset'],
  },
  testing: {
    description: 'Screenshot capture and input injection for testing',
    tools: ['capture_screenshot', 'capture_viewport', 'inject_action', 'inject_key', 'inject_mouse_click', 'inject_mouse_motion'],
    keywords: ['screenshot', 'capture', 'inject input', 'simulate', 'test input', 'inject key', 'inject mouse', 'viewport capture'],
  },
  dx_tools: {
    description: 'Developer experience tools (error log, health, usages, scaffold)',
    tools: ['parse_error_log', 'get_project_health', 'find_resource_usages', 'scaffold_gameplay_prototype'],
    keywords: ['error log', 'project health', 'find usages', 'scaffold', 'prototype', 'resource usages'],
  },
  intent_tracking: {
    description: 'Intent capture, decision logging, and handoff',
    tools: ['capture_intent_snapshot', 'record_decision_log', 'generate_handoff_brief', 'summarize_intent_context', 'record_work_step', 'record_execution_trace', 'export_handoff_pack', 'set_recording_mode', 'get_recording_mode'],
    keywords: ['intent', 'handoff', 'decision log', 'work step', 'recording', 'execution trace', 'handoff brief'],
  },
  class_advanced: {
    description: 'Advanced class introspection',
    tools: ['inspect_inheritance'],
    keywords: ['inheritance', 'class hierarchy', 'extends', 'inspect inheritance'],
  },
  lsp: {
    description: 'GDScript Language Server tools (completions, hover, symbols)',
    tools: ['lsp_get_completions', 'lsp_get_hover', 'lsp_get_symbols'],
    keywords: ['completion', 'hover info', 'lsp completions', 'code completion', 'gdscript symbols'],
  },
  dap: {
    description: 'Debug Adapter Protocol tools (breakpoints, stepping, stack trace)',
    tools: ['dap_set_breakpoint', 'dap_remove_breakpoint', 'dap_continue', 'dap_pause', 'dap_step_over', 'dap_get_stack_trace'],
    keywords: ['breakpoint', 'debugger', 'step over', 'stack trace', 'pause execution', 'debug adapter'],
  },
  version_gate: {
    description: 'Version validation and patch verification',
    tools: ['validate_patch_with_lsp', 'enforce_version_gate'],
    keywords: ['version gate', 'validate patch', 'version constraint', 'version check'],
  },
};

export const CORE_TOOL_GROUPS: Record<string, ToolGroupDefinition> = {
  core_meta: {
    description: 'Tool discovery and group management',
    tools: ['tool_catalog', 'manage_tool_groups'],
    keywords: ['catalog', 'discover', 'search tools', 'groups', 'manage groups'],
  },
  core_project: {
    description: 'Project discovery, info, search, and settings',
    tools: ['list_projects', 'get_project_info', 'search_project', 'get_project_setting', 'set_project_setting'],
    keywords: ['project', 'list projects', 'project info', 'project search', 'project setting'],
  },
  core_editor: {
    description: 'Editor launch, run, stop, debug output, and version info',
    tools: ['launch_editor', 'run_project', 'stop_project', 'get_debug_output', 'get_editor_status', 'get_godot_version'],
    keywords: ['editor', 'launch', 'run game', 'stop game', 'debug output', 'editor status', 'godot version'],
  },
  core_scene: {
    description: 'Scene creation, saving, node tree manipulation',
    tools: ['create_scene', 'save_scene', 'list_scene_nodes', 'add_node', 'get_node_properties', 'set_node_properties', 'delete_node'],
    keywords: ['scene', 'node', 'create scene', 'add node', 'delete node', 'node properties', 'scene tree'],
  },
  core_script: {
    description: 'GDScript creation, modification, and analysis',
    tools: ['create_script', 'modify_script', 'get_script_info'],
    keywords: ['script', 'gdscript', 'create script', 'modify script', 'script info'],
  },
  core_class: {
    description: 'ClassDB querying and class introspection',
    tools: ['query_classes', 'query_class_info'],
    keywords: ['class', 'classdb', 'query class', 'class info', 'node types'],
  },
  core_signal: {
    description: 'Signal connection',
    tools: ['connect_signal'],
    keywords: ['connect signal', 'signal'],
  },
  core_resource: {
    description: 'Resource dependency analysis',
    tools: ['get_dependencies'],
    keywords: ['dependencies', 'resource deps', 'dependency tree'],
  },
  core_export: {
    description: 'Export presets and project export/build',
    tools: ['list_export_presets', 'export_project'],
    keywords: ['export', 'build', 'export preset', 'publish'],
  },
  core_runtime: {
    description: 'Runtime connection status',
    tools: ['get_runtime_status'],
    keywords: ['runtime status', 'game status', 'runtime connection'],
  },
  core_visualizer: {
    description: 'Interactive project code map visualization',
    tools: ['map_project'],
    keywords: ['visualize', 'code map', 'project map', 'visualizer'],
  },
  core_diagnostics: {
    description: 'GDScript diagnostics and DAP debug output',
    tools: ['lsp_get_diagnostics', 'dap_get_output'],
    keywords: ['diagnostics', 'errors', 'warnings', 'linting', 'debug output'],
  },
};
