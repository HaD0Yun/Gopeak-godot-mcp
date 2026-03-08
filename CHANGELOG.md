# Changelog

All notable changes to GoPeak (godot-mcp) will be documented in this file.

## [2.3.3] - 2026-03-09

### Fixed
- Runtime addon framing handling now tolerates welcome and pong responses more reliably
- Runtime status checks now verify addon connectivity more accurately
- ClassDB MCP responses and node-path helper synchronization issues were corrected
- Postinstall setup hook behavior was hardened for cross-platform compatibility on Windows

### Improved
- CI/test coverage, observability, and documentation/structure updates from recent main branch work are now included in the npm release

## [2.0.0] - 2025-02-20

### Added
- **MCP Resources**: `godot://` URI protocol for scene, script, and resource file access with path traversal protection
- **GDScript LSP Integration**: 4 tools (`lsp_get_diagnostics`, `lsp_get_completions`, `lsp_get_hover`, `lsp_get_symbols`) via Godot's built-in Language Server (port 6005)
- **Debug Adapter Protocol (DAP)**: 7 tools (`dap_get_output`, `dap_set_breakpoint`, `dap_remove_breakpoint`, `dap_continue`, `dap_pause`, `dap_step_over`, `dap_get_stack_trace`) via Godot's built-in DAP (port 6006)
- **Screenshot Capture**: `capture_screenshot` and `capture_viewport` tools via runtime addon TCP
- **Input Injection**: `inject_action`, `inject_key`, `inject_mouse_click`, `inject_mouse_motion` tools via runtime addon TCP
- **npm Publishing**: Package available as `gopeak` on npm (`npx gopeak`)
- Lazy LSP/DAP client initialization (connects only when first tool is called)
- Graceful cleanup of LSP/DAP connections on server shutdown

### Changed
- Rebranded from "Godot MCP" to "GoPeak"
- Server identity updated to `gopeak` v2.0.0
- Updated README with new features, tool reference, and `npx` install instructions
- Package version bumped to 2.0.0

## [1.1.0] - 2025-02-19

### Changed
- **ClassDB Refactoring**: Replaced 96 hardcoded tools with 78 ClassDB-based generic tools
- Added `query_classes`, `query_class_info`, `inspect_inheritance` for dynamic class discovery
- Generic `add_node` and `create_resource` now work with ANY Godot class

## [1.0.0] - Initial

### Added
- Core tools: launch editor, run project, stop project, get debug output, get version
- Scene management: create, add/delete/duplicate/reparent nodes, get/set properties
- GDScript operations: create, modify, analyze scripts
- Resource management: create resource, create material, create shader
- Animation system: create animation, add tracks
- Signal management: connect, disconnect, list
- Import/export pipeline
- Project configuration: settings, autoloads, input actions
- Plugin management
- Developer experience: dependencies, usage finder, error parser, health check, search
- Runtime addon: live scene tree, property modification, method calling, metrics
- Audio system: buses, effects, volume
- Navigation: regions, agents
- UI/Themes: colors, font sizes, shaders
- Asset library: Poly Haven, AmbientCG, Kenney (CC0)
- Auto Reload editor plugin
- UID management (Godot 4.4+)
