@tool
extends Node
class_name MCPToolExecutor

var _editor_plugin: EditorPlugin = null

var _scene_tools: Node = null
var _resource_tools: Node = null
var _animation_tools: Node = null

var _tool_map: Dictionary = {}
var _initialized := false


func set_editor_plugin(plugin: EditorPlugin) -> void:
	_editor_plugin = plugin
	_init_tools()

	if _scene_tools and _scene_tools.has_method("set_editor_plugin"):
		_scene_tools.set_editor_plugin(plugin)
	if _resource_tools and _resource_tools.has_method("set_editor_plugin"):
		_resource_tools.set_editor_plugin(plugin)
	if _animation_tools and _animation_tools.has_method("set_editor_plugin"):
		_animation_tools.set_editor_plugin(plugin)


func _init_tools() -> void:
	if _initialized:
		return
	_initialized = true

	var base_path: String = get_script().resource_path.get_base_dir()
	var scene_tools_path := "%s/tools/scene_tools.gd" % base_path
	var resource_tools_path := "%s/tools/resource_tools.gd" % base_path
	var animation_tools_path := "%s/tools/animation_tools.gd" % base_path

	if ResourceLoader.exists(scene_tools_path):
		var scene_script: Script = load(scene_tools_path)
		if scene_script:
			_scene_tools = scene_script.new()
			_scene_tools.name = "SceneTools"
			add_child(_scene_tools)

	if ResourceLoader.exists(resource_tools_path):
		var resource_script: Script = load(resource_tools_path)
		if resource_script:
			_resource_tools = resource_script.new()
			_resource_tools.name = "ResourceTools"
			add_child(_resource_tools)

	if ResourceLoader.exists(animation_tools_path):
		var animation_script: Script = load(animation_tools_path)
		if animation_script:
			_animation_tools = animation_script.new()
			_animation_tools.name = "AnimationTools"
			add_child(_animation_tools)

	_tool_map = {
		# Scene tools
		"create_scene": [_scene_tools, "create_scene"],
		"list_scene_nodes": [_scene_tools, "list_scene_nodes"],
		"add_node": [_scene_tools, "add_node"],
		"delete_node": [_scene_tools, "delete_node"],
		"duplicate_node": [_scene_tools, "duplicate_node"],
		"reparent_node": [_scene_tools, "reparent_node"],
		"set_node_properties": [_scene_tools, "set_node_properties"],
		"get_node_properties": [_scene_tools, "get_node_properties"],
		"load_sprite": [_scene_tools, "load_sprite"],
		"save_scene": [_scene_tools, "save_scene"],
		"connect_signal": [_scene_tools, "connect_signal"],
		"disconnect_signal": [_scene_tools, "disconnect_signal"],
		"list_connections": [_scene_tools, "list_connections"],
		"rescan_filesystem": [_scene_tools, "rescan_filesystem"],

		# Resource tools
		"create_resource": [_resource_tools, "create_resource"],
		"modify_resource": [_resource_tools, "modify_resource"],
		"create_material": [_resource_tools, "create_material"],
		"create_shader": [_resource_tools, "create_shader"],
		"create_tileset": [_resource_tools, "create_tileset"],
		"set_tilemap_cells": [_resource_tools, "set_tilemap_cells"],
		"set_theme_color": [_resource_tools, "set_theme_color"],
		"set_theme_font_size": [_resource_tools, "set_theme_font_size"],
		"apply_theme_shader": [_resource_tools, "apply_theme_shader"],

		# Animation tools
		"create_animation": [_animation_tools, "create_animation"],
		"add_animation_track": [_animation_tools, "add_animation_track"],
		"create_animation_tree": [_animation_tools, "create_animation_tree"],
		"add_animation_state": [_animation_tools, "add_animation_state"],
		"connect_animation_states": [_animation_tools, "connect_animation_states"],
		"create_navigation_region": [_animation_tools, "create_navigation_region"],
		"create_navigation_agent": [_animation_tools, "create_navigation_agent"]
	}


func execute_tool(tool_name: String, args: Dictionary) -> Dictionary:
	if not _tool_map.has(tool_name):
		return {"ok": false, "error": "Unknown tool: " + tool_name}

	var handler: Array = _tool_map[tool_name]
	var node: Node = handler[0]
	var method: String = handler[1]

	if node == null:
		return {"ok": false, "error": "Tool handler unavailable: " + tool_name}

	if not node.has_method(method):
		return {"ok": false, "error": "Tool method not found: %s.%s" % [node.name, method]}

	var result = node.call(method, args)
	if result is Dictionary:
		return result

	return {"ok": false, "error": "Invalid tool result from: " + tool_name}
