#!/usr/bin/env node
/**
 * Godot MCP Server
 *
 * This MCP server provides tools for interacting with the Godot game engine.
 * It enables AI assistants to launch the Godot editor, run Godot projects,
 * capture debug output, and control project execution.
 */

import { fileURLToPath } from 'url';
import { join, dirname, basename, normalize } from 'path';
import { existsSync, readdirSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { createConnection as createTcpConnection } from 'node:net';
import { promisify } from 'util';
import { exec } from 'child_process';


import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { PRIORITY_1_TOOLS, handlePriority1Tools } from './tools.js';
import { setupResourceHandlers } from './resources.js';
import { GodotLSPClient, createLSPTools, handleLSPTool } from './lsp_client.js';
import { GodotDAPClient, createDAPTools, handleDAPTool } from './dap_client.js';
import { mapProject } from './gdscript_parser.js';
import { serveVisualization, setProjectPath, stopVisualizationServer } from './visualizer-server.js';
import { GodotBridge, getDefaultBridge } from './godot-bridge.js';
import { getPrompt, listPrompts } from './prompts.js';

// Check if debug mode is enabled
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE: boolean = true; // Always use GODOT DEBUG MODE

const execAsync = promisify(exec);

// Derive __filename and __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * Interface representing a running Godot process
 */
interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

/**
 * Interface for server configuration
 */
interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
  godotDebugMode?: boolean;
  strictPathValidation?: boolean; // New option to control path validation behavior
}

/**
 * Interface for operation parameters
 */
interface OperationParams {
  [key: string]: any;
}

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Main server class for the Godot MCP server
 */
class GodotServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string | null = null;
  private operationsScriptPath: string;
  private validatedPaths: Map<string, boolean> = new Map();
  private strictPathValidation: boolean = false;
  private lspClient: GodotLSPClient | null = null;
  private dapClient: GodotDAPClient | null = null;
  private lastProjectPath: string | null = null;
  private recordingMode: 'lite' | 'full' = (process.env.LOG_MODE === 'full' ? 'full' : 'lite');
  private logQueue: Array<{ filePath: string; payload: Record<string, unknown> }> = [];
  private logFlushTimer: NodeJS.Timeout | null = null;
  private readonly logFlushIntervalMs: number = 1500;
  private godotBridge: GodotBridge;
  private shutdownInitiated = false;
  private cachedToolDefinitions: MCPToolDefinition[] = [];
  private readonly toolExposureProfile: 'compact' | 'full' | 'legacy';
  private readonly toolsListPageSize: number;
  private readonly compactAliasToLegacy: Record<string, string> = {
    'tool.catalog': 'tool_catalog',
    'project.list': 'list_projects',
    'project.info': 'get_project_info',
    'project.search': 'search_project',
    'editor.launch': 'launch_editor',
    'editor.run': 'run_project',
    'editor.stop': 'stop_project',
    'editor.debug_output': 'get_debug_output',
    'editor.status': 'get_editor_status',
    'scene.create': 'create_scene',
    'scene.node.add': 'add_node',
    'scene.save': 'save_scene',
    'script.create': 'create_script',
    'script.modify': 'modify_script',
    'script.info': 'get_script_info',
    'class.query': 'query_classes',
    'class.info': 'query_class_info',
    'runtime.status': 'get_runtime_status',
    'visualizer.map': 'map_project',
    'lsp.diagnostics': 'lsp_get_diagnostics',
    'dap.output': 'dap_get_output',
  };

  /**
   * Parameter name mappings between snake_case and camelCase
   * This allows the server to accept both formats
   */
  private parameterMappings: Record<string, string> = {
    'project_path': 'projectPath',
    'scene_path': 'scenePath',
    'root_node_type': 'rootNodeType',
    'parent_node_path': 'parentNodePath',
    'node_type': 'nodeType',
    'node_name': 'nodeName',
    'texture_path': 'texturePath',
    'node_path': 'nodePath',
    'output_path': 'outputPath',
    'mesh_item_names': 'meshItemNames',
    'new_path': 'newPath',
    'file_path': 'filePath',
    'directory': 'directory',
    'recursive': 'recursive',
    'scene': 'scene',
    'source_node_path': 'sourceNodePath',
    'signal_name': 'signalName',
    'target_node_path': 'targetNodePath',
    'method_name': 'methodName',
    'player_node_path': 'playerNodePath',
    'animation_name': 'animationName',
    'loop_mode': 'loopMode',
    'plugin_name': 'pluginName',
    'action_name': 'actionName',
    'file_types': 'fileTypes',
    'case_sensitive': 'caseSensitive',
    'max_results': 'maxResults',
    'axis_value': 'axisValue',
    // 2D Tile tools
    'tileset_path': 'tilesetPath',
    'tile_size': 'tileSize',
    'tilemap_node_path': 'tilemapNodePath',
    'source_id': 'sourceId',
    'atlas_coords': 'atlasCoords',
    'alternative_tile': 'alternativeTile',
  };

  /**
   * Reverse mapping from camelCase to snake_case
   * Generated from parameterMappings for quick lookups
   */
  private reverseParameterMappings: Record<string, string> = {};

  constructor(config?: GodotServerConfig) {
    const rawProfile = (process.env.GOPEAK_TOOL_PROFILE || process.env.MCP_TOOL_PROFILE || 'compact').toLowerCase();
    if (rawProfile === 'full' || rawProfile === 'legacy' || rawProfile === 'compact') {
      this.toolExposureProfile = rawProfile;
    } else {
      this.toolExposureProfile = 'compact';
    }

    const rawToolsPageSize = parseInt(process.env.GOPEAK_TOOLS_PAGE_SIZE || '20', 10);
    this.toolsListPageSize = Number.isFinite(rawToolsPageSize) && rawToolsPageSize > 0
      ? rawToolsPageSize
      : 20;

    // Initialize reverse parameter mappings
    for (const [snakeCase, camelCase] of Object.entries(this.parameterMappings)) {
      this.reverseParameterMappings[camelCase] = snakeCase;
    }
    // Apply configuration if provided
    let debugMode = DEBUG_MODE;
    let godotDebugMode = GODOT_DEBUG_MODE;

    if (config) {
      if (config.debugMode !== undefined) {
        debugMode = config.debugMode;
      }
      if (config.godotDebugMode !== undefined) {
        godotDebugMode = config.godotDebugMode;
      }
      if (config.strictPathValidation !== undefined) {
        this.strictPathValidation = config.strictPathValidation;
      }

      // Store and validate custom Godot path if provided
      if (config.godotPath) {
        const normalizedPath = normalize(config.godotPath);
        this.godotPath = normalizedPath;
        this.logDebug(`Custom Godot path provided: ${this.godotPath}`);

        // Validate immediately with sync check
        if (!this.isValidGodotPathSync(this.godotPath)) {
          console.warn(`[SERVER] Invalid custom Godot path provided: ${this.godotPath}`);
          this.godotPath = null; // Reset to trigger auto-detection later
        }
      }
    }

    // Set the path to the operations script
    this.operationsScriptPath = join(__dirname, 'scripts', 'godot_operations.gd');

    // Initialize the Godot Editor Bridge (WebSocket server for editor plugin)
    this.godotBridge = getDefaultBridge();
    if (debugMode) console.error(`[DEBUG] Operations script path: ${this.operationsScriptPath}`);

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'gopeak',
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );

    // Set up tool handlers
    this.setupToolHandlers();

    // Set up resource handlers for godot:// URIs
    setupResourceHandlers(this.server, () => this.lastProjectPath);

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);

    this.setupShutdownHandlers();
  }

  /**
   * Log debug messages if debug mode is enabled
   * Using stderr instead of stdout to avoid interfering with JSON-RPC communication
   */
  private logDebug(message: string): void {
    if (DEBUG_MODE) {
      console.error(`[DEBUG] ${message}`);
    }
  }

  /**
   * Create a standardized error response with possible solutions
   */
  private createErrorResponse(message: string, possibleSolutions: string[] = []): any {
    // Log the error
    console.error(`[SERVER] Error response: ${message}`);
    if (possibleSolutions.length > 0) {
      console.error(`[SERVER] Possible solutions: ${possibleSolutions.join(', ')}`);
    }

    const response: any = {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };

    if (possibleSolutions.length > 0) {
      response.content.push({
        type: 'text',
        text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- '),
      });
    }

    return response;
  }

  /**
   * Validate a path to prevent path traversal attacks
   */
  private validatePath(path: string): boolean {
    // Basic validation to prevent path traversal
    if (!path || path.includes('..')) {
      return false;
    }

    // Add more validation as needed
    return true;
  }

  /**
   * Synchronous validation for constructor use
   * This is a quick check that only verifies file existence, not executable validity
   * Full validation will be performed later in detectGodotPath
   * @param path Path to check
   * @returns True if the path exists or is 'godot' (which might be in PATH)
   */
  private isValidGodotPathSync(path: string): boolean {
    try {
      this.logDebug(`Quick-validating Godot path: ${path}`);
      return path === 'godot' || existsSync(path);
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      return false;
    }
  }

  /**
   * Validate if a Godot path is valid and executable
   */
  private async isValidGodotPath(path: string): Promise<boolean> {
    // Check cache first
    if (this.validatedPaths.has(path)) {
      return this.validatedPaths.get(path)!;
    }

    try {
      this.logDebug(`Validating Godot path: ${path}`);

      // Check if the file exists (skip for 'godot' which might be in PATH)
      if (path !== 'godot' && !existsSync(path)) {
        this.logDebug(`Path does not exist: ${path}`);
        this.validatedPaths.set(path, false);
        return false;
      }

      // Try to execute Godot with --version flag
      const command = path === 'godot' ? 'godot --version' : `"${path}" --version`;
      await execAsync(command);

      this.logDebug(`Valid Godot path: ${path}`);
      this.validatedPaths.set(path, true);
      return true;
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      this.validatedPaths.set(path, false);
      return false;
    }
  }

  /**
   * Detect the Godot executable path based on the operating system
   */
  private async detectGodotPath() {
    // If godotPath is already set and valid, use it
    if (this.godotPath && await this.isValidGodotPath(this.godotPath)) {
      this.logDebug(`Using existing Godot path: ${this.godotPath}`);
      return;
    }

    // Check environment variable next
    if (process.env.GODOT_PATH) {
      const normalizedPath = normalize(process.env.GODOT_PATH);
      this.logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Using Godot path from environment: ${this.godotPath}`);
        return;
      } else {
        this.logDebug(`GODOT_PATH environment variable is invalid`);
      }
    }

    // Auto-detect based on platform
    const osPlatform = process.platform;
    this.logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);

    const possiblePaths: string[] = [
      'godot', // Check if 'godot' is in PATH first
    ];

    // Add platform-specific paths
    if (osPlatform === 'darwin') {
      possiblePaths.push(
        '/Applications/Godot.app/Contents/MacOS/Godot',
        '/Applications/Godot_4.app/Contents/MacOS/Godot',
        `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
      );
    } else if (osPlatform === 'win32') {
      possiblePaths.push(
        'C:\\Program Files\\Godot\\Godot.exe',
        'C:\\Program Files (x86)\\Godot\\Godot.exe',
        'C:\\Program Files\\Godot_4\\Godot.exe',
        'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
        `${process.env.USERPROFILE}\\Godot\\Godot.exe`
      );
    } else if (osPlatform === 'linux') {
      possiblePaths.push(
        '/usr/bin/godot',
        '/usr/local/bin/godot',
        '/snap/bin/godot',
        `${process.env.HOME}/.local/bin/godot`
      );
    }

    // Try each possible path
    for (const path of possiblePaths) {
      const normalizedPath = normalize(path);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Found Godot at: ${normalizedPath}`);
        return;
      }
    }

    // If we get here, we couldn't find Godot
    this.logDebug(`Warning: Could not find Godot in common locations for ${osPlatform}`);
    console.error(`[SERVER] Could not find Godot in common locations for ${osPlatform}`);
    console.error(`[SERVER] Set GODOT_PATH=/path/to/godot environment variable or pass { godotPath: '/path/to/godot' } in the config to specify the correct path.`);

    if (this.strictPathValidation) {
      // In strict mode, throw an error
      throw new Error(`Could not find a valid Godot executable. Set GODOT_PATH or provide a valid path in config.`);
    } else {
      // Fallback to a default path in non-strict mode; this may not be valid and requires user configuration for reliability
      if (osPlatform === 'win32') {
        this.godotPath = normalize('C:\\Program Files\\Godot\\Godot.exe');
      } else if (osPlatform === 'darwin') {
        this.godotPath = normalize('/Applications/Godot.app/Contents/MacOS/Godot');
      } else {
        this.godotPath = normalize('/usr/bin/godot');
      }

      this.logDebug(`Using default path: ${this.godotPath}, but this may not work.`);
      console.error(`[SERVER] Using default path: ${this.godotPath}, but this may not work.`);
      console.error(`[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.`);
    }
  }

  /**
   * Set a custom Godot path
   * @param customPath Path to the Godot executable
   * @returns True if the path is valid and was set, false otherwise
   */
  public async setGodotPath(customPath: string): Promise<boolean> {
    if (!customPath) {
      return false;
    }

    // Normalize the path to ensure consistent format across platforms
    // (e.g., backslashes to forward slashes on Windows, resolving relative paths)
    const normalizedPath = normalize(customPath);
    if (await this.isValidGodotPath(normalizedPath)) {
      this.godotPath = normalizedPath;
      this.logDebug(`Godot path set to: ${normalizedPath}`);
      return true;
    }

    this.logDebug(`Failed to set invalid Godot path: ${normalizedPath}`);
    return false;
  }

  /**
   * Clean up resources when shutting down
   */
  private async cleanup() {
    this.logDebug('Cleaning up resources');
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    this.flushLogQueue();

    if (this.activeProcess) {
      this.logDebug('Killing active Godot process');
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
    if (this.lspClient) {
      try { await this.lspClient.disconnect(); } catch {}
      this.lspClient = null;
    }
    if (this.dapClient) {
      try { await this.dapClient.disconnect(); } catch {}
      this.dapClient = null;
    }
    stopVisualizationServer();
    if (this.godotBridge) {
      try { await this.godotBridge.stop(); } catch {}
    }
    await this.server.close();
  }

  private setupShutdownHandlers(): void {
    const requestShutdown = (source: string, exitCode?: number): void => {
      void this.handleShutdown(source, exitCode);
    };

    process.once('SIGINT', () => requestShutdown('SIGINT', 0));
    process.once('SIGTERM', () => requestShutdown('SIGTERM', 0));
    process.once('SIGHUP', () => requestShutdown('SIGHUP', 0));
    process.once('beforeExit', (code: number) => requestShutdown(`beforeExit:${code}`));
    process.once('exit', () => this.forceCleanupOnExit());
  }

  private async handleShutdown(source: string, exitCode?: number): Promise<void> {
    if (this.shutdownInitiated) {
      return;
    }

    this.shutdownInitiated = true;
    this.logDebug(`Shutting down server via ${source}`);

    try {
      await this.cleanup();
    } catch (error) {
      console.error(`[SERVER] Shutdown cleanup failed (${source}):`, error);
    } finally {
      if (typeof exitCode === 'number') {
        process.exit(exitCode);
      }
    }
  }

  private forceCleanupOnExit(): void {
    if (this.shutdownInitiated) {
      return;
    }
    this.shutdownInitiated = true;

    if (this.activeProcess) {
      try {
        this.activeProcess.process.kill();
      } catch {}
      this.activeProcess = null;
    }

    if (this.godotBridge) {
      void this.godotBridge.stop().catch(() => {});
    }
  }

  private async handleRuntimeCommand(command: string, args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const params = (args && typeof args === 'object') ? args as Record<string, unknown> : {};
    const RUNTIME_PORT = 7777;
    const RUNTIME_HOST = '127.0.0.1';
    const TIMEOUT_MS = 10000;

    return new Promise((resolve) => {
      const socket = createTcpConnection({ port: RUNTIME_PORT, host: RUNTIME_HOST }, () => {
        const payload = JSON.stringify({ command, params, id: Date.now() });
        socket.write(payload + '\n');
      });

      let responseData = '';
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({
          content: [{ type: 'text', text: `Runtime command '${command}' timed out after ${TIMEOUT_MS}ms. Ensure the Godot game is running with the MCP runtime addon enabled.` }],
        });
      }, TIMEOUT_MS);

      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        responseData += chunk;
        if (responseData.includes('\n') || responseData.includes('}')) {
          clearTimeout(timer);
          socket.destroy();
          try {
            const parsed = JSON.parse(responseData.trim());
            if (parsed.type === 'screenshot' && parsed.data) {
              resolve({
                content: [
                  { type: 'text', text: `Screenshot captured: ${parsed.width}x${parsed.height} ${parsed.format}` },
                  { type: 'image', text: parsed.data },
                ],
              });
              return;
            }
            resolve({
              content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
            });
          } catch {
            resolve({
              content: [{ type: 'text', text: responseData.trim() || 'Command sent successfully (no structured response).' }],
            });
          }
        }
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({
          content: [{ type: 'text', text: `Failed to connect to Godot runtime addon at ${RUNTIME_HOST}:${RUNTIME_PORT}: ${error.message}. Ensure the game is running with the MCP runtime autoload enabled.` }],
        });
      });
    });
  }

  private async handleLSP(toolName: string, args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    if (!this.lspClient) {
      this.lspClient = new GodotLSPClient();
    }
    return handleLSPTool(this.lspClient, toolName, args);
  }

  private async handleDAP(toolName: string, args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    if (!this.dapClient) {
      this.dapClient = new GodotDAPClient();
    }
    return handleDAPTool(this.dapClient, toolName, args);
  }

  private resolveToolAlias(requestedToolName: string): string {
    return this.compactAliasToLegacy[requestedToolName] || requestedToolName;
  }

  private buildCompactTools(allTools: MCPToolDefinition[]): MCPToolDefinition[] {
    const compactTools: MCPToolDefinition[] = [];

    for (const [compactName, legacyName] of Object.entries(this.compactAliasToLegacy)) {
      const source = allTools.find((tool) => tool.name === legacyName);
      if (!source) {
        continue;
      }

      compactTools.push({
        ...source,
        name: compactName,
        description: `[compact alias of ${legacyName}] ${source.description}`,
      });
    }

    return compactTools;
  }

  private getExposedTools(allTools: MCPToolDefinition[]): MCPToolDefinition[] {
    if (this.toolExposureProfile === 'full' || this.toolExposureProfile === 'legacy') {
      return allTools;
    }

    return this.buildCompactTools(allTools);
  }

  private parseToolsListCursor(cursor: unknown, total: number): number {
    if (typeof cursor !== 'string' || cursor.length === 0) {
      return 0;
    }

    const offset = Number.parseInt(cursor, 10);
    if (!Number.isInteger(offset) || offset < 0 || offset > total) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid tools/list cursor: ${cursor}`);
    }

    return offset;
  }

  private paginateToolsForList(tools: MCPToolDefinition[], cursor: unknown): { tools: MCPToolDefinition[]; nextCursor?: string } {
    const start = this.parseToolsListCursor(cursor, tools.length);
    const end = Math.min(start + this.toolsListPageSize, tools.length);
    const page = tools.slice(start, end);

    if (end < tools.length) {
      return {
        tools: page,
        nextCursor: String(end),
      };
    }

    return { tools: page };
  }

  private async handleToolCatalog(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    const normalizedArgs = this.normalizeParameters(args || {});
    const query = typeof normalizedArgs.query === 'string' ? normalizedArgs.query.trim().toLowerCase() : '';
    const rawLimit = typeof normalizedArgs.limit === 'number' ? normalizedArgs.limit : 30;
    const limit = Math.max(1, Math.min(100, rawLimit));

    const tools = this.cachedToolDefinitions;
    const reverseAlias = new Map<string, string>();
    for (const [compactName, legacyName] of Object.entries(this.compactAliasToLegacy)) {
      reverseAlias.set(legacyName, compactName);
    }

    const filtered = tools.filter((tool) => {
      if (!query) return true;
      const haystack = `${tool.name} ${tool.description}`.toLowerCase();
      return haystack.includes(query);
    });

    const items = filtered.slice(0, limit).map((tool) => ({
      tool: tool.name,
      compactAlias: reverseAlias.get(tool.name) || null,
      description: tool.description,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          profile: this.toolExposureProfile,
          totalTools: tools.length,
          query: query || null,
          returned: items.length,
          tools: items,
        }, null, 2),
      }],
    };
  }

  /**
   * Check if the Godot version is 4.4 or later
   * @param version The Godot version string
   * @returns True if the version is 4.4 or later
   */
  private isGodot44OrLater(version: string): boolean {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      return major > 4 || (major === 4 && minor >= 4);
    }
    return false;
  }

  /**
   * Normalize parameters to camelCase format
   * @param params Object with either snake_case or camelCase keys
   * @returns Object with all keys in camelCase format
   */
  private normalizeParameters(params: OperationParams): OperationParams {
    if (!params || typeof params !== 'object') {
      return params;
    }
    
    const result: OperationParams = {};
    
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        let normalizedKey = key;
        
        // If the key is in snake_case, convert it to camelCase using our mapping
        if (key.includes('_') && this.parameterMappings[key]) {
          normalizedKey = this.parameterMappings[key];
        }
        
        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[normalizedKey] = this.normalizeParameters(params[key] as OperationParams);
        } else {
          result[normalizedKey] = params[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Convert camelCase keys to snake_case
   * @param params Object with camelCase keys
   * @returns Object with snake_case keys
   */
  private convertCamelToSnakeCase(params: OperationParams): OperationParams {
    const result: OperationParams = {};
    
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        // Convert camelCase to snake_case
        const snakeKey = this.reverseParameterMappings[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        
        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[snakeKey] = this.convertCamelToSnakeCase(params[key] as OperationParams);
        } else {
          result[snakeKey] = params[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Execute a Godot operation using the operations script
   * @param operation The operation to execute
   * @param params The parameters for the operation
   * @param projectPath The path to the Godot project
   * @returns The stdout and stderr from the operation
   */
  private async executeOperation(
    operation: string,
    params: OperationParams,
    projectPath: string
  ): Promise<{ stdout: string; stderr: string }> {
    this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
    this.logDebug(`Original operation params: ${JSON.stringify(params)}`);

    // Convert camelCase parameters to snake_case for Godot script
    const snakeCaseParams = this.convertCamelToSnakeCase(params);
    this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);


    // Ensure godotPath is set
    if (!this.godotPath) {
      await this.detectGodotPath();
      if (!this.godotPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    try {
      // Serialize the snake_case parameters to a valid JSON string
      const paramsJson = JSON.stringify(snakeCaseParams);
      // Escape single quotes in the JSON string to prevent command injection
      const escapedParams = paramsJson.replace(/'/g, "'\\''");
      // On Windows, cmd.exe does not strip single quotes, so we use
      // double quotes and escape them to ensure the JSON is parsed
      // correctly by Godot.
      const isWindows = process.platform === 'win32';
      const quotedParams = isWindows
        ? `\"${paramsJson.replace(/\"/g, '\\"')}\"`
        : `'${escapedParams}'`;


      // Add debug arguments if debug mode is enabled
      const debugArgs = GODOT_DEBUG_MODE ? ['--debug-godot'] : [];

      // Construct the command with the operation and JSON parameters
      const cmd = [
        `"${this.godotPath}"`,
        '--headless',
        '--path',
        `"${projectPath}"`,
        '--script',
        `"${this.operationsScriptPath}"`,
        operation,
        quotedParams, // Pass the JSON string as a single argument
        ...debugArgs,
      ].join(' ');

      this.logDebug(`Command: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd);

      return { stdout, stderr };
    } catch (error: unknown) {
      // If execAsync throws, it still contains stdout/stderr
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        const execError = error as Error & { stdout: string; stderr: string };
        return {
          stdout: execError.stdout,
          stderr: execError.stderr,
        };
      }

      throw error;
    }
  }

  /**
   * Get the structure of a Godot project
   * @param projectPath Path to the Godot project
   * @returns Object representing the project structure
   */
  private async getProjectStructure(projectPath: string): Promise<any> {
    try {
      // Get top-level directories in the project
      const entries = readdirSync(projectPath, { withFileTypes: true });

      const structure: any = {
        scenes: [],
        scripts: [],
        assets: [],
        other: [],
      };

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();

          // Skip hidden directories
          if (dirName.startsWith('.')) {
            continue;
          }

          // Count files in common directories
          if (dirName === 'scenes' || dirName.includes('scene')) {
            structure.scenes.push(entry.name);
          } else if (dirName === 'scripts' || dirName.includes('script')) {
            structure.scripts.push(entry.name);
          } else if (
            dirName === 'assets' ||
            dirName === 'textures' ||
            dirName === 'models' ||
            dirName === 'sounds' ||
            dirName === 'music'
          ) {
            structure.assets.push(entry.name);
          } else {
            structure.other.push(entry.name);
          }
        }
      }

      return structure;
    } catch (error) {
      this.logDebug(`Error getting project structure: ${error}`);
      return { error: 'Failed to get project structure' };
    }
  }

  /**
   * Find Godot projects in a directory
   * @param directory Directory to search
   * @param recursive Whether to search recursively
   * @returns Array of Godot projects
   */
  private findGodotProjects(directory: string, recursive: boolean): Array<{ path: string; name: string }> {
    const projects: Array<{ path: string; name: string }> = [];

    try {
      // Check if the directory itself is a Godot project
      const projectFile = join(directory, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({
          path: directory,
          name: basename(directory),
        });
      }

      // If not recursive, only check immediate subdirectories
      if (!recursive) {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            }
          }
        }
      } else {
        // Recursive search
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            // Skip hidden directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            // Check if this directory is a Godot project
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            } else {
              // Recursively search this directory
              const subProjects = this.findGodotProjects(subdir, true);
              projects.push(...subProjects);
            }
          }
        }
      }
    } catch (error) {
      this.logDebug(`Error searching directory ${directory}: ${error}`);
    }

    return projects;
  }

  /**
   * Set up the tool handlers for the MCP server
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      return listPrompts(request.params?.cursor);
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return getPrompt(request.params.name, request.params.arguments);
    });

    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const allTools: MCPToolDefinition[] = [
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
          description: 'Discover available tools including hidden legacy tools. Use query to search by capability keywords (e.g., animation, import, tilemap, audio).',
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
          description: `Crawl the entire Godot project and build an interactive visual map of all scripts showing their structure (variables, functions, signals), connections (extends, preloads, signal connections), and descriptions. Opens an interactive browser-based visualization at localhost:${this.godotBridge.getStatus().port}.`,
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

      this.cachedToolDefinitions = allTools;

      const exposedTools = this.getExposedTools(allTools);
      return this.paginateToolsForList(exposedTools, request.params?.cursor);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      this.logDebug(`Handling tool request: ${request.params.name}`);
      const rawArgs = request.params.arguments as Record<string, unknown> | undefined;
      const normalizedArgs = this.normalizeParameters((rawArgs || {}) as OperationParams);
      if (typeof normalizedArgs?.projectPath === 'string') {
        this.lastProjectPath = normalizedArgs.projectPath;
      }
      const resolvedToolName = this.resolveToolAlias(request.params.name);
      switch (resolvedToolName) {
        case 'launch_editor':
          return await this.handleLaunchEditor(request.params.arguments);
        case 'run_project':
          return await this.handleRunProject(request.params.arguments);
        case 'get_debug_output':
          return await this.handleGetDebugOutput();
        case 'stop_project':
          return await this.handleStopProject();
        case 'get_godot_version':
          return await this.handleGetGodotVersion();
        case 'list_projects':
          return await this.handleListProjects(request.params.arguments);
        case 'get_project_info':
          return await this.handleGetProjectInfo(request.params.arguments);
        case 'scaffold_gameplay_prototype':
          return await this.handleScaffoldGameplayPrototype(request.params.arguments);
        case 'validate_patch_with_lsp':
          return await this.handleValidatePatchWithLsp(request.params.arguments);
        case 'enforce_version_gate':
          return await this.handleEnforceVersionGate(request.params.arguments);
        case 'capture_intent_snapshot':
          return await this.handleCaptureIntentSnapshot(request.params.arguments);
        case 'record_decision_log':
          return await this.handleRecordDecisionLog(request.params.arguments);
        case 'generate_handoff_brief':
          return await this.handleGenerateHandoffBrief(request.params.arguments);
        case 'summarize_intent_context':
          return await this.handleSummarizeIntentContext(request.params.arguments);
        case 'record_work_step':
          return await this.handleRecordWorkStep(request.params.arguments);
        case 'record_execution_trace':
          return await this.handleRecordExecutionTrace(request.params.arguments);
        case 'export_handoff_pack':
          return await this.handleExportHandoffPack(request.params.arguments);
        case 'set_recording_mode':
          return await this.handleSetRecordingMode(request.params.arguments);
        case 'get_recording_mode':
          return await this.handleGetRecordingMode();
        case 'tool_catalog':
          return await this.handleToolCatalog(request.params.arguments);
        case 'create_scene':
          return await this.handleViaBridge('create_scene', request.params.arguments);
        case 'add_node':
          return await this.handleViaBridge('add_node', request.params.arguments);
        case 'load_sprite':
          return await this.handleViaBridge('load_sprite', request.params.arguments);
        case 'save_scene':
          return await this.handleViaBridge('save_scene', request.params.arguments);
        case 'get_uid':
          return await this.handleGetUid(request.params.arguments);
        case 'update_project_uids':
          return await this.handleUpdateProjectUids(request.params.arguments);
        // Phase 1: Scene Operations handlers
        case 'list_scene_nodes':
          return await this.handleViaBridge('list_scene_nodes', request.params.arguments);
        case 'get_node_properties':
          return await this.handleViaBridge('get_node_properties', request.params.arguments);
        case 'set_node_properties':
          return await this.handleViaBridge('set_node_properties', request.params.arguments);
        case 'delete_node':
          return await this.handleViaBridge('delete_node', request.params.arguments);
        case 'duplicate_node':
          return await this.handleViaBridge('duplicate_node', request.params.arguments);
        case 'reparent_node':
          return await this.handleViaBridge('reparent_node', request.params.arguments);
        // Phase 2: Import/Export Pipeline handlers
        case 'get_import_status':
          return await this.handleGetImportStatus(request.params.arguments);
        case 'get_import_options':
          return await this.handleGetImportOptions(request.params.arguments);
        case 'set_import_options':
          return await this.handleSetImportOptions(request.params.arguments);
        case 'reimport_resource':
          return await this.handleReimportResource(request.params.arguments);
        case 'list_export_presets':
          return await this.handleListExportPresets(request.params.arguments);
        case 'export_project':
          return await this.handleExportProject(request.params.arguments);
        case 'validate_project':
          return await this.handleValidateProject(request.params.arguments);
        // Phase 3: DX Tools handlers
        case 'get_dependencies':
          return await this.handleGetDependencies(request.params.arguments);
        case 'find_resource_usages':
          return await this.handleFindResourceUsages(request.params.arguments);
        case 'parse_error_log':
          return await this.handleParseErrorLog(request.params.arguments);
        case 'get_project_health':
          return await this.handleGetProjectHealth(request.params.arguments);
        // Phase 3: Config Tools handlers
        case 'get_project_setting':
          return await this.handleGetProjectSetting(request.params.arguments);
        case 'set_project_setting':
          return await this.handleSetProjectSetting(request.params.arguments);
        case 'add_autoload':
          return await this.handleAddAutoload(request.params.arguments);
        case 'remove_autoload':
          return await this.handleRemoveAutoload(request.params.arguments);
        case 'list_autoloads':
          return await this.handleListAutoloads(request.params.arguments);
        case 'set_main_scene':
          return await this.handleSetMainScene(request.params.arguments);
        // Signal Management handlers
        case 'connect_signal':
          return await this.handleViaBridge('connect_signal', request.params.arguments);
        case 'disconnect_signal':
          return await this.handleViaBridge('disconnect_signal', request.params.arguments);
        case 'list_connections':
          return await this.handleViaBridge('list_connections', request.params.arguments);
        // Phase 4: Runtime Tools handlers
        case 'get_runtime_status':
          return await this.handleGetRuntimeStatus(request.params.arguments);
        case 'inspect_runtime_tree':
          return await this.handleInspectRuntimeTree(request.params.arguments);
        case 'set_runtime_property':
          return await this.handleSetRuntimeProperty(request.params.arguments);
        case 'call_runtime_method':
          return await this.handleCallRuntimeMethod(request.params.arguments);
        case 'get_runtime_metrics':
          return await this.handleGetRuntimeMetrics(request.params.arguments);
        // Resource Creation Tools handlers
        case 'create_resource':
          return await this.handleViaBridge('create_resource', request.params.arguments);
        case 'create_material':
          return await this.handleViaBridge('create_material', request.params.arguments);
        case 'create_shader':
          return await this.handleViaBridge('create_shader', request.params.arguments);
        // GDScript File Operations handlers
        case 'create_script':
          return await this.handleCreateScript(request.params.arguments);
        case 'modify_script':
          return await this.handleModifyScript(request.params.arguments);
        case 'get_script_info':
          return await this.handleGetScriptInfo(request.params.arguments);
        // Animation Tools handlers
        case 'create_animation':
          return await this.handleViaBridge('create_animation', request.params.arguments);
        case 'add_animation_track':
          return await this.handleViaBridge('add_animation_track', request.params.arguments);
        // Plugin Management handlers
        case 'list_plugins':
          return await this.handleListPlugins(request.params.arguments);
        case 'enable_plugin':
          return await this.handleEnablePlugin(request.params.arguments);
        case 'disable_plugin':
          return await this.handleDisablePlugin(request.params.arguments);
        // Input Action handlers
        case 'add_input_action':
          return await this.handleAddInputAction(request.params.arguments);
        // Project Search handlers
        case 'search_project':
          return await this.handleSearchProject(request.params.arguments);
        // 2D Tile Tools handlers
        case 'create_tileset':
          return await this.handleViaBridge('create_tileset', request.params.arguments);
        case 'set_tilemap_cells':
          return await this.handleViaBridge('set_tilemap_cells', request.params.arguments);
        // Audio System Tools handlers
        case 'create_audio_bus':
          return await this.handleCreateAudioBus(request.params.arguments);
        case 'get_audio_buses':
          return await this.handleGetAudioBuses(request.params.arguments);
        case 'set_audio_bus_effect':
          return await this.handleSetAudioBusEffect(request.params.arguments);
        case 'set_audio_bus_volume':
          return await this.handleSetAudioBusVolume(request.params.arguments);
        // Networking Tools handlers
        // Physics Tools handlers
        // Navigation Tools handlers
        case 'create_navigation_region':
          return await this.handleViaBridge('create_navigation_region', request.params.arguments);
        case 'create_navigation_agent':
          return await this.handleViaBridge('create_navigation_agent', request.params.arguments);
        // Rendering Tools handlers
        // Animation Tree Tools handlers
        case 'create_animation_tree':
          return await this.handleViaBridge('create_animation_tree', request.params.arguments);
        case 'add_animation_state':
          return await this.handleViaBridge('add_animation_state', request.params.arguments);
        case 'connect_animation_states':
          return await this.handleViaBridge('connect_animation_states', request.params.arguments);
        // UI/Theme Tools handlers
        case 'set_theme_color':
          return await this.handleViaBridge('set_theme_color', request.params.arguments);
        case 'set_theme_font_size':
          return await this.handleViaBridge('set_theme_font_size', request.params.arguments);
        case 'apply_theme_shader':
          return await this.handleViaBridge('apply_theme_shader', request.params.arguments);
        case 'search_assets':
          return await this.handleSearchAssets(request.params.arguments);
        case 'fetch_asset':
          return await this.handleFetchAsset(request.params.arguments);
        case 'list_asset_providers':
          return await this.handleListAssetProviders();
        // ClassDB Introspection Tools
        case 'query_classes':
          return await this.handleQueryClasses(request.params.arguments);
        case 'query_class_info':
          return await this.handleQueryClassInfo(request.params.arguments);
        case 'inspect_inheritance':
          return await this.handleInspectInheritance(request.params.arguments);
        // Resource Modification Tool
        case 'modify_resource':
          return await this.handleViaBridge('modify_resource', request.params.arguments);
        // Editor Plugin Bridge Status
        case 'get_editor_status':
          return { content: [{ type: 'text', text: JSON.stringify(this.godotBridge.getStatus(), null, 2) }] };
        // Project Visualizer Tool
        case 'map_project':
          return await this.handleMapProject(request.params.arguments);
        case 'capture_screenshot':
          return await this.handleRuntimeCommand('capture_screenshot', request.params.arguments);
        case 'capture_viewport':
          return await this.handleRuntimeCommand('capture_viewport', request.params.arguments);
        case 'inject_action':
          return await this.handleRuntimeCommand('inject_action', request.params.arguments);
        case 'inject_key':
          return await this.handleRuntimeCommand('inject_key', request.params.arguments);
        case 'inject_mouse_click':
          return await this.handleRuntimeCommand('inject_mouse_click', request.params.arguments);
        case 'inject_mouse_motion':
          return await this.handleRuntimeCommand('inject_mouse_motion', request.params.arguments);
        case 'lsp_get_diagnostics':
        case 'lsp_get_completions':
        case 'lsp_get_hover':
        case 'lsp_get_symbols':
          return await this.handleLSP(resolvedToolName, request.params.arguments);
        case 'dap_get_output':
        case 'dap_set_breakpoint':
        case 'dap_remove_breakpoint':
        case 'dap_continue':
        case 'dap_pause':
        case 'dap_step_over':
        case 'dap_get_stack_trace':
          return await this.handleDAP(resolvedToolName, request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Handle the launch_editor tool
   * @param args Tool arguments
   */
  private async handleLaunchEditor(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      this.logDebug(`Launching Godot editor for project: ${args.projectPath}`);
      const process = spawn(this.godotPath, ['-e', '--path', args.projectPath], {
        stdio: 'pipe',
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot editor:', err);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Godot editor launched successfully for project at ${args.projectPath}.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to launch Godot editor: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the run_project tool
   * @param args Tool arguments
   */
  private async handleRunProject(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Kill any existing process
      if (this.activeProcess) {
        this.logDebug('Killing existing Godot process before starting a new one');
        this.activeProcess.process.kill();
      }

      const cmdArgs = ['-d', '--path', args.projectPath];
      if (args.scene && this.validatePath(args.scene)) {
        this.logDebug(`Adding scene parameter: ${args.scene}`);
        cmdArgs.push(args.scene);
      }

      this.logDebug(`Running Godot project: ${args.projectPath}`);
      const process = spawn(this.godotPath!, cmdArgs, { stdio: 'pipe' });
      const output: string[] = [];
      const errors: string[] = [];

      process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        output.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stdout] ${line}`);
        });
      });

      process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        errors.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stderr] ${line}`);
        });
      });

      process.on('exit', (code: number | null) => {
        this.logDebug(`Godot process exited with code ${code}`);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot process:', err);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      this.activeProcess = { process, output, errors };

      return {
        content: [
          {
            type: 'text',
            text: `Godot project started in debug mode. Use get_debug_output to see output.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to run Godot project: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Route a tool call through the Godot Editor Plugin bridge (WebSocket).
   * Returns an error response if the editor is not connected.
   */
  private async handleViaBridge(toolName: string, args: any): Promise<any> {
    if (!this.godotBridge.isConnected()) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: 'Godot Editor not connected. Launch Godot Editor and enable the "Godot MCP Editor" plugin to use this tool.',
          suggestion: 'Use the launch_editor tool to open the Godot Editor, then enable the plugin in Project > Project Settings > Plugins.',
        }, null, 2) }],
        isError: true,
      };
    }
    try {
      const result = await this.godotBridge.invokeTool(toolName, args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }, null, 2) }],
        isError: true,
      };
    }
  }

  /**
   * Handle the get_debug_output tool
   */
  private async handleGetDebugOutput() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process.',
        [
          'Use run_project to start a Godot project first',
          'Check if the Godot process crashed unexpectedly',
        ]
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              output: this.activeProcess.output,
              errors: this.activeProcess.errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the stop_project tool
   */
  private async handleStopProject() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process to stop.',
        [
          'Use run_project to start a Godot project first',
          'The process may have already terminated',
        ]
      );
    }

    this.logDebug('Stopping active Godot process');
    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'Godot project stopped',
              finalOutput: output,
              finalErrors: errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the get_godot_version tool
   */
  private async handleGetGodotVersion() {
    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      this.logDebug('Getting Godot version');
      const { stdout } = await execAsync(`"${this.godotPath}" --version`);
      return {
        content: [
          {
            type: 'text',
            text: stdout.trim(),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to get Godot version: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]
      );
    }
  }

  /**
   * Handle the list_projects tool
   */
  private async handleListProjects(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.directory) {
      return this.createErrorResponse(
        'Directory is required',
        ['Provide a valid directory path to search for Godot projects']
      );
    }

    if (!this.validatePath(args.directory)) {
      return this.createErrorResponse(
        'Invalid directory path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      this.logDebug(`Listing Godot projects in directory: ${args.directory}`);
      if (!existsSync(args.directory)) {
        return this.createErrorResponse(
          `Directory does not exist: ${args.directory}`,
          ['Provide a valid directory path that exists on the system']
        );
      }

      const recursive = args.recursive === true;
      const projects = this.findGodotProjects(args.directory, recursive);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list projects: ${error?.message || 'Unknown error'}`,
        [
          'Ensure the directory exists and is accessible',
          'Check if you have permission to read the directory',
        ]
      );
    }
  }

  /**
   * Get the structure of a Godot project asynchronously by counting files recursively
   * @param projectPath Path to the Godot project
   * @returns Promise resolving to an object with counts of scenes, scripts, assets, and other files
   */
  private getProjectStructureAsync(projectPath: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        const structure = {
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0,
        };

        const scanDirectory = (currentPath: string) => {
          const entries = readdirSync(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);
            
            // Skip hidden files and directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            
            if (entry.isDirectory()) {
              // Recursively scan subdirectories
              scanDirectory(entryPath);
            } else if (entry.isFile()) {
              // Count file by extension
              const ext = entry.name.split('.').pop()?.toLowerCase();
              
              if (ext === 'tscn') {
                structure.scenes++;
              } else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
                structure.scripts++;
              } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')) {
                structure.assets++;
              } else {
                structure.other++;
              }
            }
          }
        };
        
        // Start scanning from the project root
        scanDirectory(projectPath);
        resolve(structure);
      } catch (error) {
        this.logDebug(`Error getting project structure asynchronously: ${error}`);
        resolve({ 
          error: 'Failed to get project structure',
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0
        });
      }
    });
  }

  /**
   * Handle the get_project_info tool
   */
  private async handleGetProjectInfo(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }
  
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }
  
    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }
  
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }
  
      this.logDebug(`Getting project info for: ${args.projectPath}`);
  
      // Get Godot version
      const execOptions = { timeout: 10000 }; // 10 second timeout
      const { stdout } = await execAsync(`"${this.godotPath}" --version`, execOptions);
  
      // Get project structure using the recursive method
      const projectStructure = await this.getProjectStructureAsync(args.projectPath);
  
      // Extract project name from project.godot file
      let projectName = basename(args.projectPath);
      try {
        const projectFileContent = readFileSync(projectFile, 'utf8');
        const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
        if (configNameMatch && configNameMatch[1]) {
          projectName = configNameMatch[1];
          this.logDebug(`Found project name in config: ${projectName}`);
        }
      } catch (error) {
        this.logDebug(`Error reading project file: ${error}`);
        // Continue with default project name if extraction fails
      }
  
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: projectName,
                path: args.projectPath,
                godotVersion: stdout.trim(),
                structure: projectStructure,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project info: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  private compareMajorMinorVersions(actual: string, minimum: string): boolean {
    const parse = (value: string): [number, number] => {
      const m = value.match(/(\d+)\.(\d+)/);
      if (!m) return [0, 0];
      return [parseInt(m[1], 10), parseInt(m[2], 10)];
    };

    const [aMaj, aMin] = parse(actual);
    const [mMaj, mMin] = parse(minimum);

    if (aMaj > mMaj) return true;
    if (aMaj < mMaj) return false;
    return aMin >= mMin;
  }

  /**
   * One-shot gameplay prototype scaffold
   */
  private async handleScaffoldGameplayPrototype(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', ['Provide projectPath']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, [
        'Ensure project.godot exists in the provided path',
      ]);
    }

    const scenePath = args.scenePath || 'scenes/Main.tscn';
    const playerScenePath = args.playerScenePath || 'scenes/Player.tscn';
    const includePlayerScript = args.includePlayerScript !== false;

    const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];

    const runOperation = async (operation: string, params: Record<string, any>) => {
      const { stdout, stderr } = await this.executeOperation(operation, params, args.projectPath);
      const ok = !(stderr && stderr.includes('ERROR'));
      return { ok, stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' };
    };

    try {
      // 1) Create main scene
      const createMain = await runOperation('create_scene', {
        scenePath,
        rootNodeType: 'Node2D',
      });
      steps.push({ step: 'create_main_scene', ok: createMain.ok, detail: createMain.stderr || createMain.stdout });
      if (!createMain.ok) {
        return this.createErrorResponse('Failed to scaffold: could not create main scene', [createMain.stderr || 'Unknown error']);
      }

      // 2) Create player scene
      const createPlayerScene = await runOperation('create_scene', {
        scenePath: playerScenePath,
        rootNodeType: 'CharacterBody2D',
      });
      steps.push({ step: 'create_player_scene', ok: createPlayerScene.ok, detail: createPlayerScene.stderr || createPlayerScene.stdout });
      if (!createPlayerScene.ok) {
        return this.createErrorResponse('Failed to scaffold: could not create player scene', [createPlayerScene.stderr || 'Unknown error']);
      }

      // 3) Add common player child nodes
      const playerNodeAdds: Array<{ nodeType: string; nodeName: string; properties?: any }> = [
        { nodeType: 'Sprite2D', nodeName: 'Sprite2D' },
        { nodeType: 'CollisionShape2D', nodeName: 'CollisionShape2D' },
        { nodeType: 'Camera2D', nodeName: 'Camera2D', properties: { enabled: true } },
      ];

      for (const node of playerNodeAdds) {
        const add = await runOperation('add_node', {
          scenePath: playerScenePath,
          nodeType: node.nodeType,
          nodeName: node.nodeName,
          properties: node.properties,
        });
        steps.push({ step: `add_node_${node.nodeName}`, ok: add.ok, detail: add.stderr || add.stdout });
      }

      // 4) Add Player instance placeholder to main scene (as Node2D) and attach player scene path as meta hint
      const addPlayerRoot = await runOperation('add_node', {
        scenePath,
        nodeType: 'Node2D',
        nodeName: 'Player',
      });
      steps.push({ step: 'add_player_root_to_main', ok: addPlayerRoot.ok, detail: addPlayerRoot.stderr || addPlayerRoot.stdout });

      // 5) Input actions
      const inputActions = [
        {
          actionName: 'move_left',
          events: [{ type: 'key', keycode: 'A' }, { type: 'key', keycode: 'Left' }],
        },
        {
          actionName: 'move_right',
          events: [{ type: 'key', keycode: 'D' }, { type: 'key', keycode: 'Right' }],
        },
        {
          actionName: 'jump',
          events: [{ type: 'key', keycode: 'Space' }],
        },
      ];

      for (const action of inputActions) {
        const inputResult = await runOperation('add_input_action', action);
        steps.push({ step: `add_input_${action.actionName}`, ok: inputResult.ok, detail: inputResult.stderr || inputResult.stdout });
      }

      // 6) Optional starter player script
      if (includePlayerScript) {
        const scriptResult = await runOperation('create_script', {
          script_path: 'scripts/player.gd',
          class_name: 'PlayerController',
          extends_class: 'CharacterBody2D',
          content: "@export var speed: float = 220.0\n@export var jump_velocity: float = -420.0\n@export var gravity: float = 980.0\n\nfunc _physics_process(delta: float) -> void:\n\tvar dir := Input.get_axis(\"move_left\", \"move_right\")\n\tvelocity.x = dir * speed\n\tif not is_on_floor():\n\t\tvelocity.y += gravity * delta\n\tif is_on_floor() and Input.is_action_just_pressed(\"jump\"):\n\t\tvelocity.y = jump_velocity\n\tmove_and_slide()\n",
        });
        steps.push({ step: 'create_player_script', ok: scriptResult.ok, detail: scriptResult.stderr || scriptResult.stdout });

        // Attach script to player root
        const attachScript = await runOperation('set_node_properties', {
          scenePath: playerScenePath,
          nodePath: '.',
          properties: { script: 'res://scripts/player.gd' },
        });
        steps.push({ step: 'attach_player_script', ok: attachScript.ok, detail: attachScript.stderr || attachScript.stdout });
      }

      // 7) Set main scene
      const setMain = await runOperation('set_main_scene', { scenePath });
      steps.push({ step: 'set_main_scene', ok: setMain.ok, detail: setMain.stderr || setMain.stdout });

      const allOk = steps.every((s) => s.ok);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: allOk,
                summary: allOk
                  ? 'Gameplay prototype scaffold completed.'
                  : 'Scaffold completed with some failed steps. Check steps[] details.',
                outputs: {
                  mainScene: scenePath,
                  playerScene: playerScenePath,
                  playerScript: includePlayerScript ? 'scripts/player.gd' : null,
                },
                steps,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to scaffold gameplay prototype: ${error?.message || 'Unknown error'}`, [
        'Ensure Godot is installed and accessible',
        'Check project path and write permissions',
      ]);
    }
  }

  /**
   * Pre-apply LSP validation gate
   */
  private async handleValidatePatchWithLsp(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath || !args.scriptPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath and scriptPath']);
    }

    try {
      const lspResult = await this.handleLSP('lsp_get_diagnostics', {
        projectPath: args.projectPath,
        scriptPath: args.scriptPath,
      });

      const textPayload = lspResult?.content?.[0]?.text || '{}';
      let diagnostics: any[] = [];
      try {
        const parsed = JSON.parse(textPayload);
        diagnostics = Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
      } catch {
        diagnostics = [];
      }

      const hasBlocking = diagnostics.some((d: any) => {
        const severity = d?.severity;
        return severity === 1 || severity === 'error' || severity === 'ERROR';
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scriptPath: args.scriptPath,
                diagnosticsCount: diagnostics.length,
                blockOnError: hasBlocking,
                canApply: !hasBlocking,
                diagnostics,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed LSP validation: ${error?.message || 'Unknown error'}`, [
        'Ensure Godot editor is running with LSP enabled (port 6005)',
      ]);
    }
  }

  /**
   * Version and protocol gate
   */
  private async handleEnforceVersionGate(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', ['Provide projectPath']);
    }

    const minGodotVersion = args.minGodotVersion || '4.2';
    const minProtocolVersion = args.minProtocolVersion || '1.0';

    try {
      const versionResult = await this.handleGetGodotVersion();
      const godotVersion = (versionResult?.content?.[0]?.text || '').trim();
      const godotOk = this.compareMajorMinorVersions(godotVersion, minGodotVersion);

      let runtimeProtocol = 'unknown';
      let runtimeConnected = false;
      let protocolOk = false;
      let capabilityInfo: any = {};

      const runtime = await this.handleRuntimeCommand('ping', {});
      const runtimeText = runtime?.content?.[0]?.text || '{}';
      try {
        const parsed = JSON.parse(runtimeText);
        runtimeConnected = !parsed?.error;
        runtimeProtocol = parsed?.protocol_version || parsed?.protocolVersion || '1.0';
        capabilityInfo = {
          hasRuntime: runtimeConnected,
          responseType: parsed?.type || null,
        };
      } catch {
        runtimeConnected = false;
      }

      protocolOk = this.compareMajorMinorVersions(runtimeProtocol, minProtocolVersion);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: godotOk && (runtimeConnected ? protocolOk : true),
                requirements: {
                  minGodotVersion,
                  minProtocolVersion,
                },
                actual: {
                  godotVersion,
                  runtimeConnected,
                  runtimeProtocol,
                },
                checks: {
                  godotOk,
                  protocolOk: runtimeConnected ? protocolOk : null,
                },
                capabilityInfo,
                recommendation:
                  godotOk
                    ? runtimeConnected
                      ? protocolOk
                        ? 'Version gate passed.'
                        : 'Runtime protocol is below minimum. Update runtime addon.'
                      : 'Godot version is compatible. Runtime addon not connected; run project/addon for full protocol check.'
                    : 'Godot version below minimum requirement. Upgrade Godot.',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to enforce version gate: ${error?.message || 'Unknown error'}`, [
        'Ensure Godot is installed and runtime addon is available',
      ]);
    }
  }

  private getIntentMemoryDir(projectPath: string): string {
    const dir = join(projectPath, '.godot-mcp-memory');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private scheduleLogFlush(): void {
    if (this.logFlushTimer) return;
    this.logFlushTimer = setTimeout(() => {
      this.flushLogQueue();
    }, this.logFlushIntervalMs);
  }

  private flushLogQueue(): void {
    const batch = this.logQueue.splice(0, this.logQueue.length);
    this.logFlushTimer = null;
    if (batch.length === 0) return;

    const grouped = new Map<string, string[]>();
    for (const item of batch) {
      const line = JSON.stringify(item.payload) + '\n';
      const existing = grouped.get(item.filePath) || [];
      existing.push(line);
      grouped.set(item.filePath, existing);
    }

    for (const [filePath, lines] of grouped.entries()) {
      appendFileSync(filePath, lines.join(''), 'utf8');
    }
  }

  private appendJsonl(filePath: string, payload: Record<string, unknown>): void {
    // Lite mode: asynchronous queued write to reduce user-facing latency
    // Full mode: still queued/batched to avoid frequent fs sync stalls
    this.logQueue.push({ filePath, payload });

    // Backpressure guard: if queue grows too large, flush immediately
    if (this.logQueue.length >= 50) {
      this.flushLogQueue();
      return;
    }

    this.scheduleLogFlush();
  }

  private readJsonArray(filePath: string): any[] {
    if (!existsSync(filePath)) return [];
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeJsonArray(filePath: string, value: any[]): void {
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private readJsonl(filePath: string): any[] {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((v) => v !== null);
  }

  /**
   * Capture/update current intent snapshot
   */
  private async handleCaptureIntentSnapshot(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath || !args.goal) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath and goal']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');

    const existing = this.readJsonArray(indexPath);
    const intentId = `intent_${Date.now()}`;

    const snapshot = {
      intent_id: intentId,
      ts: new Date().toISOString(),
      goal: args.goal,
      why: args.why || '',
      constraints: Array.isArray(args.constraints) ? args.constraints : [],
      acceptance_criteria: Array.isArray(args.acceptanceCriteria) ? args.acceptanceCriteria : [],
      non_goals: Array.isArray(args.nonGoals) ? args.nonGoals : [],
      priority: args.priority || 'P1',
      status: 'active',
    };

    for (const item of existing) {
      if (item && item.status === 'active') {
        item.status = 'archived';
      }
    }
    existing.push(snapshot);
    this.writeJsonArray(indexPath, existing);

    const eventsPath = join(memoryDir, 'dev-activity.jsonl');
    this.appendJsonl(eventsPath, {
      ts: new Date().toISOString(),
      actor: 'mcp-server',
      action: 'capture_intent_snapshot',
      intent_id: intentId,
      result: 'success',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, intent: snapshot, files: { indexPath, eventsPath } }, null, 2),
        },
      ],
    };
  }

  /**
   * Record decision log entry
   */
  private async handleRecordDecisionLog(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath || !args.decision) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath and decision']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');
    const decisionsPath = join(memoryDir, 'decision-log.jsonl');

    const intents = this.readJsonArray(indexPath);
    const activeIntent = intents.find((i) => i && i.status === 'active');
    const intentId = args.intentId || activeIntent?.intent_id || null;

    const decisionRecord = {
      decision_id: `dec_${Date.now()}`,
      ts: new Date().toISOString(),
      intent_id: intentId,
      decision: args.decision,
      rationale: args.rationale || '',
      alternatives_rejected: Array.isArray(args.alternativesRejected) ? args.alternativesRejected : [],
      evidence_refs: Array.isArray(args.evidenceRefs) ? args.evidenceRefs : [],
    };

    this.appendJsonl(decisionsPath, decisionRecord);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, decision: decisionRecord, file: decisionsPath }, null, 2),
        },
      ],
    };
  }

  /**
   * Generate handoff brief
   */
  private async handleGenerateHandoffBrief(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', ['Provide projectPath']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const maxItems = Number.isFinite(Number(args.maxItems)) ? Number(args.maxItems) : 5;
    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');
    const decisionsPath = join(memoryDir, 'decision-log.jsonl');
    const eventsPath = join(memoryDir, 'dev-activity.jsonl');

    const intents = this.readJsonArray(indexPath);
    const decisions = this.readJsonl(decisionsPath);
    const events = this.readJsonl(eventsPath);

    const activeIntent = intents.find((i) => i && i.status === 'active');
    const relatedDecisions = decisions.filter((d) => d?.intent_id && activeIntent?.intent_id && d.intent_id === activeIntent.intent_id).slice(-maxItems);
    const recentEvents = events.slice(-maxItems);

    const brief = {
      handoff_id: `handoff_${Date.now()}`,
      ts: new Date().toISOString(),
      current_goal: activeIntent?.goal || null,
      constraints: activeIntent?.constraints || [],
      acceptance_criteria: activeIntent?.acceptance_criteria || [],
      open_decisions: relatedDecisions.map((d) => d.decision),
      recent_actions: recentEvents.map((e) => `${e.ts} ${e.action}`),
      next_actions: [
        'Validate active intent against latest user message',
        'Resolve top open decision and record rationale',
        'Execute next implementation step and append execution trace',
      ],
    };

    const handoffPath = join(memoryDir, 'handoff-latest.json');
    writeFileSync(handoffPath, JSON.stringify(brief, null, 2), 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, handoff: brief, file: handoffPath }, null, 2),
        },
      ],
    };
  }

  /**
   * Summarize current intent context
   */
  private async handleSummarizeIntentContext(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', ['Provide projectPath']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');
    const decisionsPath = join(memoryDir, 'decision-log.jsonl');

    const intents = this.readJsonArray(indexPath);
    const decisions = this.readJsonl(decisionsPath);
    const activeIntent = intents.find((i) => i && i.status === 'active');

    const relatedDecisions = decisions.filter((d) => d?.intent_id && activeIntent?.intent_id && d.intent_id === activeIntent.intent_id).slice(-3);

    const summary = {
      goal: activeIntent?.goal || null,
      why: activeIntent?.why || null,
      constraints: activeIntent?.constraints || [],
      acceptance_criteria: activeIntent?.acceptance_criteria || [],
      recent_decisions: relatedDecisions.map((d) => ({
        decision: d.decision,
        rationale: d.rationale,
      })),
      risk: relatedDecisions.length === 0 ? 'No decisions logged yet; context may be weak.' : null,
      next_action: 'Call generate_handoff_brief after next major change.',
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  /**
   * Unified work-step recorder (trace + optional handoff pack refresh)
   */
  private async handleRecordWorkStep(args: any) {
    args = this.normalizeParameters(args);

    const traceResponse: any = await this.handleRecordExecutionTrace(args);
    const refreshHandoffPack = args.refreshHandoffPack !== false;

    if (!refreshHandoffPack) {
      return traceResponse;
    }

    const handoffResponse: any = await this.handleExportHandoffPack({
      projectPath: args.projectPath,
      maxItems: args.maxItems,
    });

    const traceText = traceResponse?.content?.[0]?.text;
    const handoffText = handoffResponse?.content?.[0]?.text;

    let tracePayload: any = null;
    let handoffPayload: any = null;

    try { tracePayload = traceText ? JSON.parse(traceText) : null; } catch {}
    try { handoffPayload = handoffText ? JSON.parse(handoffText) : null; } catch {}

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: !!(tracePayload?.success && handoffPayload?.success),
              mode: 'record_work_step',
              trace: tracePayload,
              handoffPack: handoffPayload,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Record execution trace
   */
  private async handleRecordExecutionTrace(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath || !args.action || !args.result) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, action, result']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');
    const eventsPath = join(memoryDir, 'dev-activity.jsonl');
    const tracesPath = join(memoryDir, 'execution-trace.jsonl');

    const intents = this.readJsonArray(indexPath);
    const activeIntent = intents.find((i) => i && i.status === 'active');
    const intentId = args.intentId || activeIntent?.intent_id || null;

    const liteMode = this.recordingMode === 'lite';

    const trace = {
      trace_id: `trace_${Date.now()}`,
      ts: new Date().toISOString(),
      intent_id: intentId,
      action: args.action,
      command: args.command || null,
      files_changed: Array.isArray(args.filesChanged) ? args.filesChanged : [],
      result: args.result,
      artifact: args.artifact || null,
      error: args.error || null,
      mode: this.recordingMode,
    };

    this.appendJsonl(tracesPath, trace);

    this.appendJsonl(eventsPath, {
      ts: new Date().toISOString(),
      actor: 'mcp-server',
      action: 'record_execution_trace',
      intent_id: intentId,
      result: args.result,
      summary: liteMode ? `${args.action}:${args.result}` : `${args.action}:${args.result} files=${trace.files_changed.length}`,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, trace, file: tracesPath }, null, 2),
        },
      ],
    };
  }

  /**
   * Export handoff pack for team-mode relay
   */
  private async handleExportHandoffPack(args: any) {
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', ['Provide projectPath']);
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
    }

    const maxItems = Number.isFinite(Number(args.maxItems)) ? Number(args.maxItems) : 10;
    const memoryDir = this.getIntentMemoryDir(args.projectPath);
    const indexPath = join(memoryDir, 'intent-index.json');
    const decisionsPath = join(memoryDir, 'decision-log.jsonl');
    const tracesPath = join(memoryDir, 'execution-trace.jsonl');

    const intents = this.readJsonArray(indexPath);
    const decisions = this.readJsonl(decisionsPath);
    const traces = this.readJsonl(tracesPath);

    const activeIntent = intents.find((i) => i && i.status === 'active');
    const intentId = activeIntent?.intent_id || null;

    const relatedDecisions = decisions.filter((d) => d?.intent_id && intentId && d.intent_id === intentId).slice(-maxItems);
    const relatedTraces = traces.filter((t) => t?.intent_id && intentId && t.intent_id === intentId).slice(-maxItems);

    const handoffPack = {
      pack_id: `pack_${Date.now()}`,
      ts: new Date().toISOString(),
      mode: this.recordingMode,
      intent: activeIntent || null,
      decisions: relatedDecisions,
      execution_traces: relatedTraces,
      summary: {
        decisions_count: relatedDecisions.length,
        traces_count: relatedTraces.length,
        latest_result: relatedTraces.length > 0 ? relatedTraces[relatedTraces.length - 1].result : null,
      },
      next_actions: [
        'Check intent acceptance criteria against latest changes',
        'Resolve remaining open decisions',
        'Execute next highest-priority trace and record result',
      ],
    };

    const packPath = join(memoryDir, 'handoff_pack.json');
    writeFileSync(packPath, JSON.stringify(handoffPack, null, 2), 'utf8');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, file: packPath, handoffPack }, null, 2),
        },
      ],
    };
  }

  /**
   * Set recording mode
   */
  private async handleSetRecordingMode(args: any) {
    args = this.normalizeParameters(args);
    const mode = `${args.mode || ''}`.toLowerCase();

    if (mode !== 'lite' && mode !== 'full') {
      return this.createErrorResponse('Invalid mode', ['Use mode="lite" or mode="full"']);
    }

    this.recordingMode = mode as 'lite' | 'full';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, recordingMode: this.recordingMode }, null, 2),
        },
      ],
    };
  }

  /**
   * Get recording mode
   */
  private async handleGetRecordingMode() {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              recordingMode: this.recordingMode,
              queueSize: this.logQueue.length,
              flushIntervalMs: this.logFlushIntervalMs,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the create_scene tool
   */
  private async handleCreateScene(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Project path and scene path are required',
        ['Provide valid paths for both the project and the scene']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        scenePath: args.scenePath,
        rootNodeType: args.rootNodeType || 'Node2D',
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('create_scene', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to create scene: ${stderr}`,
          [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Scene created successfully at: ${args.scenePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the add_node tool
   */
  private async handleAddNode(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodeType, and nodeName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
        nodeType: args.nodeType,
        nodeName: args.nodeName,
      };

      // Add optional parameters
      if (args.parentNodePath) {
        params.parentNodePath = args.parentNodePath;
      }

      if (args.properties) {
        params.properties = args.properties;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('add_node', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to add node: ${stderr}`,
          [
            'Check if the node type is valid',
            'Ensure the parent node path exists',
            'Verify the scene file is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Node '${args.nodeName}' of type '${args.nodeType}' added successfully to '${args.scenePath}'.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add node: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the load_sprite tool
   */
  private async handleLoadSprite(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and texturePath']
      );
    }

    if (
      !this.validatePath(args.projectPath) ||
      !this.validatePath(args.scenePath) ||
      !this.validatePath(args.nodePath) ||
      !this.validatePath(args.texturePath)
    ) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Check if the texture file exists
      const texturePath = join(args.projectPath, args.texturePath);
      if (!existsSync(texturePath)) {
        return this.createErrorResponse(
          `Texture file does not exist: ${args.texturePath}`,
          [
            'Ensure the texture path is correct',
            'Upload or create the texture file first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        texturePath: args.texturePath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('load_sprite', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to load sprite: ${stderr}`,
          [
            'Check if the node path is correct',
            'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
            'Verify the texture file is a valid image format',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Sprite loaded successfully with texture: ${args.texturePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to load sprite: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the save_scene tool
   */
  private async handleSaveScene(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    // If newPath is provided, validate it
    if (args.newPath && !this.validatePath(args.newPath)) {
      return this.createErrorResponse(
        'Invalid new path',
        ['Provide a valid new path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
      };

      // Add optional parameters
      if (args.newPath) {
        params.newPath = args.newPath;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('save_scene', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to save scene: ${stderr}`,
          [
            'Check if the scene file is valid',
            'Ensure you have write permissions to the output path',
            'Verify the scene can be properly packed',
          ]
        );
      }

      const savePath = args.newPath || args.scenePath;
      return {
        content: [
          {
            type: 'text',
            text: `Scene saved successfully to: ${savePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to save scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the get_uid tool
   */
  private async handleGetUid(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.filePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and filePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.filePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the file exists
      const filePath = join(args.projectPath, args.filePath);
      if (!existsSync(filePath)) {
        return this.createErrorResponse(
          `File does not exist: ${args.filePath}`,
          ['Ensure the file path is correct']
        );
      }

      // Get Godot version to check if UIDs are supported
      const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
      const version = versionOutput.trim();

      if (!this.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        filePath: args.filePath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('get_uid', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to get UID: ${stderr}`,
          [
            'Check if the file is a valid Godot resource',
            'Ensure the file path is correct',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `UID for ${args.filePath}: ${stdout.trim()}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get UID: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the update_project_uids tool
   */
  private async handleUpdateProjectUids(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Get Godot version to check if UIDs are supported
      const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
      const version = versionOutput.trim();

      if (!this.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        projectPath: args.projectPath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('resave_resources', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to update project UIDs: ${stderr}`,
          [
            'Check if the project is valid',
            'Ensure you have write permissions to the project directory',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Project UIDs updated successfully.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to update project UIDs: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  // ============================================
  // Phase 1: Scene Operations Handlers
  // ============================================

  /**
   * Handle the list_scene_nodes tool
   */
  private async handleListSceneNodes(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct', 'Use create_scene to create a new scene first']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        depth: args.depth !== undefined ? args.depth : -1,
        includeProperties: args.includeProperties || false,
      };

      const { stdout, stderr } = await this.executeOperation('list_scene_nodes', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to list scene nodes: ${stderr}`,
          ['Verify the scene file is valid']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list scene nodes: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the get_node_properties tool
   */
  private async handleGetNodeProperties(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and nodePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        includeDefaults: args.includeDefaults || false,
      };

      const { stdout, stderr } = await this.executeOperation('get_node_properties', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get node properties: ${stderr}`,
          ['Verify the node path is correct', 'Check if the node exists in the scene']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get node properties: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the set_node_properties tool
   */
  private async handleSetNodeProperties(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.properties) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and properties']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        properties: args.properties,
        saveScene: args.saveScene !== false,
      };

      const { stdout, stderr } = await this.executeOperation('set_node_properties', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to set node properties: ${stderr}`,
          ['Verify the node path is correct', 'Check if properties are valid for the node type']
        );
      }

      return {
        content: [{ type: 'text', text: `Properties updated successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set node properties: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the delete_node tool
   */
  private async handleDeleteNode(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and nodePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        saveScene: args.saveScene !== false,
      };

      const { stdout, stderr } = await this.executeOperation('delete_node', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to delete node: ${stderr}`,
          ['Verify the node path is correct', 'Cannot delete root node']
        );
      }

      return {
        content: [{ type: 'text', text: `Node deleted successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to delete node: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the duplicate_node tool
   */
  private async handleDuplicateNode(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.newName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and newName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        newName: args.newName,
        saveScene: args.saveScene !== false,
      };

      if (args.parentPath) {
        params.parentPath = args.parentPath;
      }

      const { stdout, stderr } = await this.executeOperation('duplicate_node', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to duplicate node: ${stderr}`,
          ['Verify the node path is correct', 'Check if the new name is valid']
        );
      }

      return {
        content: [{ type: 'text', text: `Node duplicated successfully as '${args.newName}'.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to duplicate node: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the reparent_node tool
   */
  private async handleReparentNode(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.newParentPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and newParentPath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        newParentPath: args.newParentPath,
        saveScene: args.saveScene !== false,
      };

      const { stdout, stderr } = await this.executeOperation('reparent_node', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to reparent node: ${stderr}`,
          ['Verify both node paths are correct', 'Cannot reparent root node']
        );
      }

      return {
        content: [{ type: 'text', text: `Node reparented successfully to '${args.newParentPath}'.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to reparent node: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Phase 2: Import/Export Pipeline Handlers
  // ============================================

  /**
   * Handle the get_import_status tool
   */
  private async handleGetImportStatus(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        resourcePath: args.resourcePath || '',
        includeUpToDate: args.includeUpToDate || false,
      };

      const { stdout, stderr } = await this.executeOperation('get_import_status', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get import status: ${stderr}`,
          ['Verify the resource path if specified']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get import status: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the get_import_options tool
   */
  private async handleGetImportOptions(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and resourcePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const resourceFile = join(args.projectPath, args.resourcePath);
      if (!existsSync(resourceFile)) {
        return this.createErrorResponse(
          `Resource file does not exist: ${args.resourcePath}`,
          ['Ensure the resource path is correct']
        );
      }

      const params: any = {
        resourcePath: args.resourcePath,
      };

      const { stdout, stderr } = await this.executeOperation('get_import_options', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get import options: ${stderr}`,
          ['Verify the resource is an importable file type']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get import options: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the set_import_options tool
   */
  private async handleSetImportOptions(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath || !args.options) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, resourcePath, and options']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const resourceFile = join(args.projectPath, args.resourcePath);
      if (!existsSync(resourceFile)) {
        return this.createErrorResponse(
          `Resource file does not exist: ${args.resourcePath}`,
          ['Ensure the resource path is correct']
        );
      }

      const params: any = {
        resourcePath: args.resourcePath,
        options: args.options,
        reimport: args.reimport !== false,
      };

      const { stdout, stderr } = await this.executeOperation('set_import_options', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to set import options: ${stderr}`,
          ['Verify the options are valid for this resource type']
        );
      }

      return {
        content: [{ type: 'text', text: `Import options updated successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set import options: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the reimport_resource tool
   */
  private async handleReimportResource(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      if (args.resourcePath) {
        const resourceFile = join(args.projectPath, args.resourcePath);
        if (!existsSync(resourceFile)) {
          return this.createErrorResponse(
            `Resource file does not exist: ${args.resourcePath}`,
            ['Ensure the resource path is correct']
          );
        }
      }

      const params: any = {
        resourcePath: args.resourcePath || '',
        force: args.force || false,
      };

      const { stdout, stderr } = await this.executeOperation('reimport_resource', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to reimport resource: ${stderr}`,
          ['Verify the resource path if specified']
        );
      }

      return {
        content: [{ type: 'text', text: `Reimport completed.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to reimport resource: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the list_export_presets tool
   */
  private async handleListExportPresets(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        includeTemplateStatus: args.includeTemplateStatus !== false,
      };

      const { stdout, stderr } = await this.executeOperation('list_export_presets', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to list export presets: ${stderr}`,
          ['Check if export_presets.cfg exists in the project']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list export presets: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the export_project tool
   */
  private async handleExportProject(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.preset || !args.outputPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, preset, and outputPath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.outputPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      // Export uses Godot's CLI directly, not our script
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            ['Ensure Godot is installed correctly', 'Set GODOT_PATH environment variable']
          );
        }
      }

      const exportFlag = args.debug ? '--export-debug' : '--export-release';
      const cmd = `"${this.godotPath}" --headless --path "${args.projectPath}" ${exportFlag} "${args.preset}" "${args.outputPath}"`;
      
      this.logDebug(`Export command: ${cmd}`);
      
      const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 }); // 5 minute timeout for exports

      if (stderr && (stderr.includes('ERROR') || stderr.includes('Invalid preset'))) {
        return this.createErrorResponse(
          `Failed to export project: ${stderr}`,
          ['Verify the preset name is correct', 'Ensure export templates are installed']
        );
      }

      return {
        content: [{ type: 'text', text: `Project exported successfully to: ${args.outputPath}\n\n${stdout}${stderr}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to export project: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify export templates are installed', 'Check the preset name is valid']
      );
    }
  }

  /**
   * Handle the validate_project tool
   */
  private async handleValidateProject(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        preset: args.preset || '',
        includeSuggestions: args.includeSuggestions !== false,
      };

      const { stdout, stderr } = await this.executeOperation('validate_project', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to validate project: ${stderr}`,
          ['Verify the project structure is valid']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to validate project: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Phase 3: DX Tools Handlers
  // ============================================

  /**
   * Handle the get_dependencies tool
   */
  private async handleGetDependencies(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and resourcePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        resourcePath: args.resourcePath,
        depth: args.depth !== undefined ? args.depth : -1,
        includeBuiltin: args.includeBuiltin || false,
      };

      const { stdout, stderr } = await this.executeOperation('get_dependencies', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get dependencies: ${stderr}`,
          ['Verify the resource path is correct']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get dependencies: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the find_resource_usages tool
   */
  private async handleFindResourceUsages(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and resourcePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        resourcePath: args.resourcePath,
        fileTypes: args.fileTypes || ['tscn', 'tres', 'gd'],
      };

      const { stdout, stderr } = await this.executeOperation('find_resource_usages', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to find resource usages: ${stderr}`,
          ['Verify the resource path is correct']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to find resource usages: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the parse_error_log tool
   */
  private async handleParseErrorLog(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        logContent: args.logContent || '',
        maxErrors: args.maxErrors || 50,
      };

      const { stdout, stderr } = await this.executeOperation('parse_error_log', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to parse error log: ${stderr}`,
          ['Verify the log content or ensure godot.log exists']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to parse error log: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the get_project_health tool
   */
  private async handleGetProjectHealth(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        includeDetails: args.includeDetails !== false,
      };

      const { stdout, stderr } = await this.executeOperation('get_project_health', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get project health: ${stderr}`,
          ['Verify the project structure']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project health: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Phase 3: Project Configuration Handlers
  // ============================================

  /**
   * Handle the get_project_setting tool
   */
  private async handleGetProjectSetting(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.setting) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and setting']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        setting: args.setting,
      };

      const { stdout, stderr } = await this.executeOperation('get_project_setting', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to get project setting: ${stderr}`,
          ['Verify the setting path is correct']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project setting: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the set_project_setting tool
   */
  private async handleSetProjectSetting(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.setting || args.value === undefined) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, setting, and value']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        setting: args.setting,
        value: args.value,
      };

      const { stdout, stderr } = await this.executeOperation('set_project_setting', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to set project setting: ${stderr}`,
          ['Verify the setting path and value']
        );
      }

      return {
        content: [{ type: 'text', text: `Setting updated successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set project setting: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the add_autoload tool
   */
  private async handleAddAutoload(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.name || !args.path) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, name, and path']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.path)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        name: args.name,
        path: args.path,
        enabled: args.enabled !== false,
      };

      const { stdout, stderr } = await this.executeOperation('add_autoload', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to add autoload: ${stderr}`,
          ['Verify the script/scene path exists']
        );
      }

      return {
        content: [{ type: 'text', text: `Autoload '${args.name}' added successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add autoload: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the remove_autoload tool
   */
  private async handleRemoveAutoload(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.name) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and name']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        name: args.name,
      };

      const { stdout, stderr } = await this.executeOperation('remove_autoload', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to remove autoload: ${stderr}`,
          ['Verify the autoload name exists']
        );
      }

      return {
        content: [{ type: 'text', text: `Autoload '${args.name}' removed successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to remove autoload: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the list_autoloads tool
   */
  private async handleListAutoloads(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const { stdout, stderr } = await this.executeOperation('list_autoloads', {}, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to list autoloads: ${stderr}`,
          ['Verify the project structure']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list autoloads: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the set_main_scene tool
   */
  private async handleSetMainScene(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const sceneFile = join(args.projectPath, args.scenePath);
      if (!existsSync(sceneFile)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
      };

      const { stdout, stderr } = await this.executeOperation('set_main_scene', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to set main scene: ${stderr}`,
          ['Verify the scene path is correct']
        );
      }

      return {
        content: [{ type: 'text', text: `Main scene set to '${args.scenePath}'.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set main scene: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Signal Management Handlers
  // ============================================

  /**
   * Handle the connect_signal tool
   */
  private async handleConnectSignal(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.sourceNodePath || !args.signalName || !args.targetNodePath || !args.methodName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, sourceNodePath, signalName, targetNodePath, and methodName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct', 'Use create_scene to create a new scene first']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        sourceNodePath: args.sourceNodePath,
        signalName: args.signalName,
        targetNodePath: args.targetNodePath,
        methodName: args.methodName,
      };

      if (args.flags !== undefined) {
        params.flags = args.flags;
      }

      const { stdout, stderr } = await this.executeOperation('connect_signal', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to connect signal: ${stderr}`,
          ['Verify node paths are correct', 'Ensure the signal exists on the source node']
        );
      }

      return {
        content: [{ type: 'text', text: `Signal '${args.signalName}' connected successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to connect signal: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the disconnect_signal tool
   */
  private async handleDisconnectSignal(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.sourceNodePath || !args.signalName || !args.targetNodePath || !args.methodName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, sourceNodePath, signalName, targetNodePath, and methodName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        sourceNodePath: args.sourceNodePath,
        signalName: args.signalName,
        targetNodePath: args.targetNodePath,
        methodName: args.methodName,
      };

      const { stdout, stderr } = await this.executeOperation('disconnect_signal', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to disconnect signal: ${stderr}`,
          ['Verify the connection exists', 'Check node paths and signal/method names']
        );
      }

      return {
        content: [{ type: 'text', text: `Signal '${args.signalName}' disconnected successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to disconnect signal: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the list_connections tool
   */
  private async handleListConnections(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
      };

      if (args.nodePath) {
        params.nodePath = args.nodePath;
      }

      const { stdout, stderr } = await this.executeOperation('list_connections', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to list connections: ${stderr}`,
          ['Verify the scene path is correct']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list connections: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Phase 4: Runtime Tools Handlers
  // ============================================

  /**
   * Handle the get_runtime_status tool
   */
  private async handleGetRuntimeStatus(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    try {
      // Runtime connection requires a running Godot instance with the addon
      // For now, return status based on active process
      if (this.activeProcess) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connected: true,
              status: 'running',
              note: 'A Godot process is active. Use inspect_runtime_tree to explore.',
            }, null, 2),
          }],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connected: false,
              status: 'not_running',
              note: 'No active Godot process. Use run_project to start one.',
            }, null, 2),
          }],
        };
      }
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get runtime status: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly']
      );
    }
  }

  /**
   * Handle the inspect_runtime_tree tool
   */
  private async handleInspectRuntimeTree(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    try {
      // Runtime inspection requires a running Godot instance
      if (!this.activeProcess) {
        return this.createErrorResponse(
          'No active Godot process',
          ['Use run_project to start a Godot instance first']
        );
      }

      // Return information about the running process
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'running',
            nodePath: args.nodePath || '/',
            depth: args.depth || 3,
            note: 'Runtime tree inspection requires the godot_mcp_runtime addon. Current output shows debug logs.',
            recentOutput: this.activeProcess.output.slice(-20),
            recentErrors: this.activeProcess.errors.slice(-10),
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to inspect runtime tree: ${error?.message || 'Unknown error'}`,
        ['Ensure a Godot process is running']
      );
    }
  }

  /**
   * Handle the set_runtime_property tool
   */
  private async handleSetRuntimeProperty(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.nodePath || !args.property || args.value === undefined) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, nodePath, property, and value']
      );
    }

    try {
      if (!this.activeProcess) {
        return this.createErrorResponse(
          'No active Godot process',
          ['Use run_project to start a Godot instance first']
        );
      }

      // Runtime property modification requires the addon
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'not_implemented',
            note: 'Runtime property modification requires the godot_mcp_runtime addon installed in the running project.',
            requested: {
              nodePath: args.nodePath,
              property: args.property,
              value: args.value,
            },
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set runtime property: ${error?.message || 'Unknown error'}`,
        ['Ensure a Godot process is running with the runtime addon']
      );
    }
  }

  /**
   * Handle the call_runtime_method tool
   */
  private async handleCallRuntimeMethod(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.nodePath || !args.method) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, nodePath, and method']
      );
    }

    try {
      if (!this.activeProcess) {
        return this.createErrorResponse(
          'No active Godot process',
          ['Use run_project to start a Godot instance first']
        );
      }

      // Runtime method calling requires the addon
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'not_implemented',
            note: 'Runtime method calling requires the godot_mcp_runtime addon installed in the running project.',
            requested: {
              nodePath: args.nodePath,
              method: args.method,
              args: args.args || [],
            },
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to call runtime method: ${error?.message || 'Unknown error'}`,
        ['Ensure a Godot process is running with the runtime addon']
      );
    }
  }

  /**
   * Handle the get_runtime_metrics tool
   */
  private async handleGetRuntimeMetrics(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    try {
      if (!this.activeProcess) {
        return this.createErrorResponse(
          'No active Godot process',
          ['Use run_project to start a Godot instance first']
        );
      }

      // Basic metrics from process output
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'running',
            metrics: {
              outputLines: this.activeProcess.output.length,
              errorLines: this.activeProcess.errors.length,
              note: 'Detailed metrics require the godot_mcp_runtime addon.',
            },
            requestedMetrics: args.metrics || 'all',
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get runtime metrics: ${error?.message || 'Unknown error'}`,
        ['Ensure a Godot process is running']
      );
    }
  }

  // ============================================
  // GDScript File Operations Handlers
  // ============================================

  /**
   * Handle the create_script tool
   * Creates a new GDScript file with proper structure and optional templates
   */
  private async handleCreateScript(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!args.scriptPath) {
      return this.createErrorResponse(
        'Script path is required',
        ['Provide a path for the new script file (e.g., "scripts/player.gd")']
      );
    }

    if (!args.scriptPath.endsWith('.gd')) {
      return this.createErrorResponse(
        'Script path must end with .gd extension',
        ['Provide a valid GDScript path (e.g., "scripts/player.gd")']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(
        `Not a valid Godot project: ${args.projectPath}`,
        ['Ensure the path points to a directory containing a project.godot file']
      );
    }

    try {
      const params = {
        script_path: args.scriptPath,
        class_name: args.className || '',
        extends_class: args.extends || 'Node',
        content: args.content || '',
        template: args.template || '',
      };

      const { stdout, stderr } = await this.executeOperation('create_script', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create script: ${stderr}`,
          ['Check the script path and ensure parent directories exist']
        );
      }

      // Try to parse JSON result
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }
      } catch {
        // Fall through to return raw output
      }

      return {
        content: [{
          type: 'text',
          text: stdout.trim(),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create script: ${error?.message || 'Unknown error'}`,
        ['Check that Godot is properly installed and accessible']
      );
    }
  }

  /**
   * Handle the modify_script tool
   * Modifies an existing GDScript file by adding functions, variables, or signals
   */
  private async handleModifyScript(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!args.scriptPath) {
      return this.createErrorResponse(
        'Script path is required',
        ['Provide the path to an existing script file']
      );
    }

    if (!args.modifications || !Array.isArray(args.modifications) || args.modifications.length === 0) {
      return this.createErrorResponse(
        'Modifications array is required',
        ['Provide an array of modifications with type and name properties']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(
        `Not a valid Godot project: ${args.projectPath}`,
        ['Ensure the path points to a directory containing a project.godot file']
      );
    }

    try {
      const params = {
        script_path: args.scriptPath,
        modifications: args.modifications,
      };

      const { stdout, stderr } = await this.executeOperation('modify_script', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to modify script: ${stderr}`,
          ['Check that the script file exists and is a valid GDScript']
        );
      }

      // Try to parse JSON result
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }
      } catch {
        // Fall through to return raw output
      }

      return {
        content: [{
          type: 'text',
          text: stdout.trim(),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to modify script: ${error?.message || 'Unknown error'}`,
        ['Check that Godot is properly installed and accessible']
      );
    }
  }

  /**
   * Handle the get_script_info tool
   * Analyzes a GDScript file and returns its structure
   */
  private async handleGetScriptInfo(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!args.scriptPath) {
      return this.createErrorResponse(
        'Script path is required',
        ['Provide the path to a script file to analyze']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    const projectFile = join(args.projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      return this.createErrorResponse(
        `Not a valid Godot project: ${args.projectPath}`,
        ['Ensure the path points to a directory containing a project.godot file']
      );
    }

    try {
      const params = {
        script_path: args.scriptPath,
        include_inherited: args.includeInherited || false,
      };

      const { stdout, stderr } = await this.executeOperation('get_script_info', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to analyze script: ${stderr}`,
          ['Check that the script file exists and is a valid GDScript']
        );
      }

      // Try to parse JSON result
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }
      } catch {
        // Fall through to return raw output
      }

      return {
        content: [{
          type: 'text',
          text: stdout.trim(),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to analyze script: ${error?.message || 'Unknown error'}`,
        ['Check that Godot is properly installed and accessible']
      );
    }
  }

  // ============================================
  // Resource Creation Tools Handlers
  // ============================================

  /**
   * Handle the create_resource tool
   */
  private async handleCreateResource(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath || !args.resourceType) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, resourcePath, and resourceType']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      // If a script path is provided, verify it exists
      if (args.script) {
        const scriptFile = join(args.projectPath, args.script);
        if (!existsSync(scriptFile)) {
          return this.createErrorResponse(
            `Script file does not exist: ${args.script}`,
            ['Ensure the script path is correct']
          );
        }
      }

      const params: any = {
        resourcePath: args.resourcePath,
        resourceType: args.resourceType,
        properties: args.properties || {},
        script: args.script || '',
      };

      const { stdout, stderr } = await this.executeOperation('create_resource', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create resource: ${stderr}`,
          ['Verify the resource type is valid', 'Check if the class can be instantiated']
        );
      }

      return {
        content: [{ type: 'text', text: `Resource created successfully at: ${args.resourcePath}\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create resource: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the resource type exists']
      );
    }
  }

  /**
   * Handle the create_material tool
   */
  private async handleCreateMaterial(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.materialPath || !args.materialType) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, materialPath, and materialType']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.materialPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    const validMaterialTypes = ['StandardMaterial3D', 'ShaderMaterial', 'CanvasItemMaterial', 'ParticleProcessMaterial'];
    if (!validMaterialTypes.includes(args.materialType)) {
      return this.createErrorResponse(
        `Invalid material type: ${args.materialType}`,
        [`Valid types: ${validMaterialTypes.join(', ')}`]
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      // If a shader path is provided for ShaderMaterial, verify it exists
      if (args.shader && args.materialType === 'ShaderMaterial') {
        const shaderFile = join(args.projectPath, args.shader);
        if (!existsSync(shaderFile)) {
          return this.createErrorResponse(
            `Shader file does not exist: ${args.shader}`,
            ['Ensure the shader path is correct', 'Use create_shader to create a shader first']
          );
        }
      }

      const params: any = {
        materialPath: args.materialPath,
        materialType: args.materialType,
        properties: args.properties || {},
        shader: args.shader || '',
      };

      const { stdout, stderr } = await this.executeOperation('create_material', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create material: ${stderr}`,
          ['Verify the material type is valid', 'Check property names and values']
        );
      }

      return {
        content: [{ type: 'text', text: `Material created successfully at: ${args.materialPath}\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create material: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the material type']
      );
    }
  }

  /**
   * Handle the create_shader tool
   */
  private async handleCreateShader(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.shaderPath || !args.shaderType) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, shaderPath, and shaderType']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.shaderPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    const validShaderTypes = ['canvas_item', 'spatial', 'particles', 'sky', 'fog'];
    if (!validShaderTypes.includes(args.shaderType)) {
      return this.createErrorResponse(
        `Invalid shader type: ${args.shaderType}`,
        [`Valid types: ${validShaderTypes.join(', ')}`]
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        shaderPath: args.shaderPath,
        shaderType: args.shaderType,
        code: args.code || '',
        template: args.template || '',
      };

      const { stdout, stderr } = await this.executeOperation('create_shader', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create shader: ${stderr}`,
          ['Verify the shader type is valid', 'Check shader code syntax']
        );
      }

      return {
        content: [{ type: 'text', text: `Shader created successfully at: ${args.shaderPath}\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create shader: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the shader type']
      );
    }
  }

  // ============================================
  // Animation Tools Handlers
  // ============================================

  /**
   * Handle the create_animation tool
   * Creates a new animation in an AnimationPlayer node
   */
  private async handleCreateAnimation(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.playerNodePath || !args.animationName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, playerNodePath, and animationName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct', 'Use create_scene to create a new scene first']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        playerNodePath: args.playerNodePath,
        animationName: args.animationName,
        length: args.length !== undefined ? args.length : 1.0,
        loopMode: args.loopMode || 'none',
        step: args.step !== undefined ? args.step : 0.1,
      };

      const { stdout, stderr } = await this.executeOperation('create_animation', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create animation: ${stderr}`,
          ['Verify the AnimationPlayer node path is correct', 'Check if the node is an AnimationPlayer']
        );
      }

      return {
        content: [{ type: 'text', text: `Animation '${args.animationName}' created successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create animation: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the add_animation_track tool
   * Adds a track to an existing animation in an AnimationPlayer
   */
  private async handleAddAnimationTrack(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.playerNodePath || !args.animationName || !args.track) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, playerNodePath, animationName, and track']
      );
    }

    if (!args.track.type || !args.track.nodePath || !args.track.keyframes) {
      return this.createErrorResponse(
        'Invalid track configuration',
        ['Track must have type, nodePath, and keyframes properties']
      );
    }

    if (!['property', 'method'].includes(args.track.type)) {
      return this.createErrorResponse(
        `Invalid track type: ${args.track.type}`,
        ['Track type must be "property" or "method"']
      );
    }

    if (args.track.type === 'property' && !args.track.property) {
      return this.createErrorResponse(
        'Property track requires a property name',
        ['Provide the property name to animate (e.g., "position", "modulate")']
      );
    }

    if (args.track.type === 'method' && !args.track.method) {
      return this.createErrorResponse(
        'Method track requires a method name',
        ['Provide the method name to call']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct']
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        playerNodePath: args.playerNodePath,
        animationName: args.animationName,
        track: args.track,
      };

      const { stdout, stderr } = await this.executeOperation('add_animation_track', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to add animation track: ${stderr}`,
          ['Verify the animation exists', 'Check the node path and property/method name']
        );
      }

      return {
        content: [{ type: 'text', text: `Track added successfully to animation '${args.animationName}'.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add animation track: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Plugin Management Handlers
  // ============================================

  /**
   * Handle the list_plugins tool
   */
  private async handleListPlugins(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const { stdout, stderr } = await this.executeOperation('list_plugins', {}, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to list plugins: ${stderr}`,
          ['Verify the project structure']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list plugins: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the enable_plugin tool
   */
  private async handleEnablePlugin(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.pluginName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and pluginName']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        pluginName: args.pluginName,
      };

      const { stdout, stderr } = await this.executeOperation('enable_plugin', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to enable plugin: ${stderr}`,
          ['Verify the plugin exists in the addons directory', 'Check the plugin name is correct']
        );
      }

      return {
        content: [{ type: 'text', text: `Plugin '${args.pluginName}' enabled successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to enable plugin: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the disable_plugin tool
   */
  private async handleDisablePlugin(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.pluginName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and pluginName']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        pluginName: args.pluginName,
      };

      const { stdout, stderr } = await this.executeOperation('disable_plugin', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to disable plugin: ${stderr}`,
          ['Verify the plugin is currently enabled', 'Check the plugin name is correct']
        );
      }

      return {
        content: [{ type: 'text', text: `Plugin '${args.pluginName}' disabled successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to disable plugin: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Input Action Handlers
  // ============================================

  /**
   * Handle the add_input_action tool
   */
  private async handleAddInputAction(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.actionName || !args.events) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, actionName, and events']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    if (!Array.isArray(args.events) || args.events.length === 0) {
      return this.createErrorResponse(
        'Events must be a non-empty array',
        ['Provide at least one input event']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        actionName: args.actionName,
        events: args.events,
        deadzone: args.deadzone !== undefined ? args.deadzone : 0.5,
      };

      const { stdout, stderr } = await this.executeOperation('add_input_action', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to add input action: ${stderr}`,
          ['Verify the event types and parameters are valid']
        );
      }

      return {
        content: [{ type: 'text', text: `Input action '${args.actionName}' added successfully.\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add input action: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Project Search Handlers
  // ============================================

  /**
   * Handle the search_project tool
   */
  private async handleSearchProject(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.query) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and query']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const params: any = {
        query: args.query,
        fileTypes: args.fileTypes || ['gd', 'tscn', 'tres'],
        regex: args.regex || false,
        caseSensitive: args.caseSensitive || false,
        maxResults: args.maxResults || 100,
      };

      const { stdout, stderr } = await this.executeOperation('search_project', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to search project: ${stderr}`,
          ['Check if the query/regex pattern is valid']
        );
      }

      return {
        content: [{ type: 'text', text: stdout.trim() }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to search project: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Run the MCP server
   */
  async run() {
    try {
      // Detect Godot path before starting the server
      await this.detectGodotPath();

      if (!this.godotPath) {
        console.error('[SERVER] Failed to find a valid Godot executable path');
        console.error('[SERVER] Please set GODOT_PATH environment variable or provide a valid path');
        process.exit(1);
      }

      // Check if the path is valid
      const isValid = await this.isValidGodotPath(this.godotPath);

      if (!isValid) {
        if (this.strictPathValidation) {
          // In strict mode, exit if the path is invalid
          console.error(`[SERVER] Invalid Godot path: ${this.godotPath}`);
          console.error('[SERVER] Please set a valid GODOT_PATH environment variable or provide a valid path');
          process.exit(1);
        } else {
          // In compatibility mode, warn but continue with the default path
          console.error(`[SERVER] Warning: Using potentially invalid Godot path: ${this.godotPath}`);
          console.error('[SERVER] This may cause issues when executing Godot commands');
          console.error('[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.');
        }
      }

      console.error(`[SERVER] Using Godot at: ${this.godotPath}`);

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Godot MCP server running on stdio');

      // Start the Godot Editor Bridge (WebSocket server for editor plugin).
      // Bridge startup issues should not take down the stdio MCP server.
      try {
        await this.godotBridge.start();
        const bridgeStatus = this.godotBridge.getStatus();
        console.error(`[SERVER] Godot Editor Bridge started on ${bridgeStatus.host}:${bridgeStatus.port}`);
      } catch (bridgeError) {
        const bridgeMessage = bridgeError instanceof Error ? bridgeError.message : String(bridgeError);
        console.error(`[SERVER] Warning: Godot Editor Bridge failed to start: ${bridgeMessage}`);
        console.error('[SERVER] Continuing without bridge-backed editor tools.');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SERVER] Failed to start:', errorMessage);
      process.exit(1);
    }
  }

  // ============================================
  // 2D Tile Tools Handlers
  // ============================================

  /**
   * Handle the create_tileset tool
   * Creates a TileSet resource with atlas sources
   */
  private async handleCreateTileset(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.tilesetPath || !args.sources) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, tilesetPath, and sources array']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.tilesetPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    if (!Array.isArray(args.sources) || args.sources.length === 0) {
      return this.createErrorResponse(
        'Sources must be a non-empty array',
        ['Provide at least one source with texture and tileSize']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      // Verify all texture files exist
      for (const source of args.sources) {
        if (!source.texture || !source.tileSize) {
          return this.createErrorResponse(
            'Each source must have texture and tileSize',
            ['Provide texture path and tileSize { x, y } for each source']
          );
        }
        const texturePath = join(args.projectPath, source.texture);
        if (!existsSync(texturePath)) {
          return this.createErrorResponse(
            `Texture file does not exist: ${source.texture}`,
            ['Ensure the texture path is correct']
          );
        }
      }

      const params: any = {
        tilesetPath: args.tilesetPath,
        sources: args.sources,
      };

      const { stdout, stderr } = await this.executeOperation('create_tileset', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to create tileset: ${stderr}`,
          ['Verify all texture paths are correct', 'Check tile size values']
        );
      }

      return {
        content: [{ type: 'text', text: `TileSet created successfully at: ${args.tilesetPath}\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create tileset: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  /**
   * Handle the set_tilemap_cells tool
   * Sets cells in a TileMap node within a scene
   */
  private async handleSetTilemapCells(args: any) {
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.tilemapNodePath || !args.cells) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, tilemapNodePath, and cells array']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    if (!Array.isArray(args.cells)) {
      return this.createErrorResponse(
        'Cells must be an array',
        ['Provide an array of cell objects with coords, sourceId, and atlasCoords']
      );
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          ['Ensure the path points to a directory containing a project.godot file']
        );
      }

      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          ['Ensure the scene path is correct', 'Use create_scene to create a new scene first']
        );
      }

      // Validate cell structure
      for (const cell of args.cells) {
        if (!cell.coords || cell.sourceId === undefined || !cell.atlasCoords) {
          return this.createErrorResponse(
            'Each cell must have coords, sourceId, and atlasCoords',
            ['Provide coords { x, y }, sourceId (number), and atlasCoords { x, y } for each cell']
          );
        }
      }

      const params: any = {
        scenePath: args.scenePath,
        tilemapNodePath: args.tilemapNodePath,
        layer: args.layer !== undefined ? args.layer : 0,
        cells: args.cells,
      };

      const { stdout, stderr } = await this.executeOperation('set_tilemap_cells', params, args.projectPath);

      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(
          `Failed to set tilemap cells: ${stderr}`,
          ['Verify the TileMap node path is correct', 'Check that the TileMap has a valid TileSet']
        );
      }

      return {
        content: [{ type: 'text', text: `TileMap cells set successfully (${args.cells.length} cells).\n\n${stdout.trim()}` }],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to set tilemap cells: ${error?.message || 'Unknown error'}`,
        ['Ensure Godot is installed correctly', 'Verify the project path is accessible']
      );
    }
  }

  // ============================================
  // Audio System Handlers
  // ============================================

  private async handleCreateAudioBus(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.busName) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath and busName']);
    }
    try {
      const params = {
        busName: args.busName,
        parentBusIndex: args.parentBusIndex || 0,
      };
      const { stdout, stderr } = await this.executeOperation('create_audio_bus', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to create audio bus: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Audio bus '${args.busName}' created successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to create audio bus: ${error?.message}`, []);
    }
  }

  private async handleGetAudioBuses(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Project path is required', []);
    }
    try {
      const { stdout, stderr } = await this.executeOperation('get_audio_buses', {}, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to get audio buses: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: stdout.trim() }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to get audio buses: ${error?.message}`, []);
    }
  }

  private async handleSetAudioBusEffect(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || args.busIndex === undefined || args.effectIndex === undefined || !args.effectType) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, busIndex, effectIndex, and effectType']);
    }
    try {
      const params = {
        busIndex: args.busIndex,
        effectIndex: args.effectIndex,
        effectType: args.effectType,
        enabled: args.enabled !== false,
      };
      const { stdout, stderr } = await this.executeOperation('set_audio_bus_effect', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to set audio bus effect: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Audio bus effect set successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to set audio bus effect: ${error?.message}`, []);
    }
  }

  private async handleSetAudioBusVolume(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || args.busIndex === undefined || args.volumeDb === undefined) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, busIndex, and volumeDb']);
    }
    try {
      const params = { busIndex: args.busIndex, volumeDb: args.volumeDb };
      const { stdout, stderr } = await this.executeOperation('set_audio_bus_volume', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to set audio bus volume: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Audio bus volume set to ${args.volumeDb}dB.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to set audio bus volume: ${error?.message}`, []);
    }
  }

  // ============================================
  // Networking Handlers
  // ============================================

  // ============================================
  // Physics Handlers
  // ============================================

  // ============================================
  // Navigation Handlers
  // ============================================

  private async handleCreateNavigationRegion(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.parentPath || !args.nodeName) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, scenePath, parentPath, and nodeName']);
    }
    try {
      const params = {
        scenePath: args.scenePath,
        parentPath: args.parentPath,
        nodeName: args.nodeName,
        is3D: args.is3D || false,
      };
      const { stdout, stderr } = await this.executeOperation('create_navigation_region', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to create navigation region: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `NavigationRegion '${args.nodeName}' created successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to create navigation region: ${error?.message}`, []);
    }
  }

  private async handleCreateNavigationAgent(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.parentPath || !args.nodeName) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, scenePath, parentPath, and nodeName']);
    }
    try {
      const params = {
        scenePath: args.scenePath,
        parentPath: args.parentPath,
        nodeName: args.nodeName,
        is3D: args.is3D || false,
        pathDesiredDistance: args.pathDesiredDistance || 4.0,
        targetDesiredDistance: args.targetDesiredDistance || 4.0,
      };
      const { stdout, stderr } = await this.executeOperation('create_navigation_agent', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to create navigation agent: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `NavigationAgent '${args.nodeName}' created successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to create navigation agent: ${error?.message}`, []);
    }
  }

  // ============================================
  // Rendering Handlers
  // ============================================

  // ============================================
  // Animation Tree Handlers
  // ============================================

  private async handleCreateAnimationTree(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.parentPath || !args.nodeName || !args.animPlayerPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, scenePath, parentPath, nodeName, and animPlayerPath']);
    }
    try {
      const params = {
        scenePath: args.scenePath,
        parentPath: args.parentPath,
        nodeName: args.nodeName,
        animPlayerPath: args.animPlayerPath,
        rootType: args.rootType || 'StateMachine',
      };
      const { stdout, stderr } = await this.executeOperation('create_animation_tree', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to create AnimationTree: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `AnimationTree '${args.nodeName}' created successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to create AnimationTree: ${error?.message}`, []);
    }
  }

  private async handleAddAnimationState(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.animTreePath || !args.stateName || !args.animationName) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, scenePath, animTreePath, stateName, and animationName']);
    }
    try {
      const params = {
        scenePath: args.scenePath,
        animTreePath: args.animTreePath,
        stateName: args.stateName,
        animationName: args.animationName,
        stateMachinePath: args.stateMachinePath || '',
      };
      const { stdout, stderr } = await this.executeOperation('add_animation_state', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to add animation state: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Animation state '${args.stateName}' added successfully.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to add animation state: ${error?.message}`, []);
    }
  }

  private async handleConnectAnimationStates(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.animTreePath || !args.fromState || !args.toState) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, scenePath, animTreePath, fromState, and toState']);
    }
    try {
      const params = {
        scenePath: args.scenePath,
        animTreePath: args.animTreePath,
        fromState: args.fromState,
        toState: args.toState,
        transitionType: args.transitionType || 'immediate',
        advanceCondition: args.advanceCondition || '',
      };
      const { stdout, stderr } = await this.executeOperation('connect_animation_states', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to connect animation states: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `States '${args.fromState}' -> '${args.toState}' connected.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to connect animation states: ${error?.message}`, []);
    }
  }

  // ============================================
  // UI/Theme Handlers
  // ============================================

  private async handleSetThemeColor(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.themePath || !args.controlType || !args.colorName || !args.color) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, themePath, controlType, colorName, and color']);
    }
    try {
      const params = {
        themePath: args.themePath,
        controlType: args.controlType,
        colorName: args.colorName,
        color: args.color,
      };
      const { stdout, stderr } = await this.executeOperation('set_theme_color', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to set theme color: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Theme color '${args.colorName}' for '${args.controlType}' set.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to set theme color: ${error?.message}`, []);
    }
  }

  private async handleSetThemeFontSize(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.themePath || !args.controlType || !args.fontSizeName || !args.size) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath, themePath, controlType, fontSizeName, and size']);
    }
    try {
      const params = {
        themePath: args.themePath,
        controlType: args.controlType,
        fontSizeName: args.fontSizeName,
        size: args.size,
      };
      const { stdout, stderr } = await this.executeOperation('set_theme_font_size', params, args.projectPath);
      if (stderr && stderr.includes('ERROR')) {
        return this.createErrorResponse(`Failed to set theme font size: ${stderr}`, []);
      }
      return { content: [{ type: 'text', text: `Theme font size '${args.fontSizeName}' for '${args.controlType}' set to ${args.size}px.\n\n${stdout.trim()}` }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to set theme font size: ${error?.message}`, []);
    }
  }


  private async handleApplyThemeShader(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.theme) {
      return this.createErrorResponse('Missing required parameters', [
        'Provide projectPath, scenePath, nodePath, and theme',
      ]);
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, []);
      }

      const shaderTemplates: Record<string, { code: string; description: string }> = {
        medieval: {
          description: 'Warm stone/aged material look',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform float roughness : hint_range(0.0, 1.0) = 0.85;
uniform float age_factor : hint_range(0.0, 1.0) = 0.3;
uniform vec3 tint_color : source_color = vec3(0.9, 0.85, 0.75);

void fragment() {
    vec4 albedo = texture(albedo_texture, UV);
    vec3 aged = mix(albedo.rgb, albedo.rgb * tint_color, age_factor);
    ALBEDO = aged;
    ROUGHNESS = roughness;
    SPECULAR = 0.2;
    METALLIC = 0.0;
}`,
        },
        cyberpunk: {
          description: 'Neon glow with pulsing effect',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

uniform vec3 neon_color : source_color = vec3(1.0, 0.0, 0.8);
uniform float pulse_speed : hint_range(0.0, 10.0) = 2.0;
uniform float intensity : hint_range(0.0, 5.0) = 2.5;
uniform float base_brightness : hint_range(0.0, 1.0) = 0.3;

void fragment() {
    float pulse = sin(TIME * pulse_speed) * 0.5 + 0.5;
    vec3 emissive = neon_color * intensity * (0.5 + pulse * 0.5);
    
    ALBEDO = neon_color * base_brightness;
    EMISSION = emissive;
    METALLIC = 0.8;
    ROUGHNESS = 0.2;
}`,
        },
        nature: {
          description: 'Wind sway for foliage',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform float wind_strength : hint_range(0.0, 2.0) = 0.3;
uniform float wind_speed : hint_range(0.0, 5.0) = 1.5;
uniform float wind_scale : hint_range(0.1, 10.0) = 1.0;

void vertex() {
    float wind = sin(TIME * wind_speed + VERTEX.x * wind_scale + VERTEX.z * wind_scale * 0.7);
    float height_factor = UV.y;
    VERTEX.x += wind * wind_strength * height_factor;
    VERTEX.z += wind * wind_strength * height_factor * 0.5;
}

void fragment() {
    vec4 albedo = texture(albedo_texture, UV);
    ALBEDO = albedo.rgb;
    ALPHA = albedo.a;
    ALPHA_SCISSOR_THRESHOLD = 0.5;
    ROUGHNESS = 0.8;
}`,
        },
        scifi: {
          description: 'Clean metallic with LED accents',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform vec3 led_color : source_color = vec3(0.0, 0.8, 1.0);
uniform float led_intensity : hint_range(0.0, 3.0) = 1.5;
uniform float metallic_value : hint_range(0.0, 1.0) = 0.9;

void fragment() {
    vec4 albedo = texture(albedo_texture, UV);
    float led_mask = step(0.9, albedo.r) * step(0.9, albedo.g) * step(0.9, albedo.b);
    
    ALBEDO = mix(albedo.rgb, albedo.rgb * 0.3, led_mask);
    EMISSION = led_color * led_intensity * led_mask;
    METALLIC = metallic_value;
    ROUGHNESS = mix(0.3, 0.1, led_mask);
}`,
        },
        horror: {
          description: 'Dark with subtle pulsing shadows',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform float darkness : hint_range(0.0, 1.0) = 0.6;
uniform float pulse_speed : hint_range(0.0, 5.0) = 0.5;
uniform vec3 shadow_tint : source_color = vec3(0.1, 0.0, 0.15);

void fragment() {
    float pulse = sin(TIME * pulse_speed) * 0.1 + 0.9;
    vec4 albedo = texture(albedo_texture, UV);
    vec3 darkened = mix(albedo.rgb, shadow_tint, darkness);
    
    ALBEDO = darkened * pulse;
    ROUGHNESS = 0.9;
    METALLIC = 0.0;
}`,
        },
        cartoon: {
          description: 'Cel-shaded toon look',
          code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform vec3 outline_color : source_color = vec3(0.0, 0.0, 0.0);
uniform float shade_levels : hint_range(2.0, 8.0) = 3.0;

void fragment() {
    vec4 albedo = texture(albedo_texture, UV);
    ALBEDO = albedo.rgb;
    ROUGHNESS = 1.0;
    SPECULAR = 0.0;
}

void light() {
    float NdotL = dot(NORMAL, LIGHT);
    float stepped = floor(NdotL * shade_levels) / shade_levels;
    DIFFUSE_LIGHT += stepped * ATTENUATION * LIGHT_COLOR;
}`,
        },
      };

      const effectTemplates: Record<string, string> = {
        glow: `
uniform float glow_power : hint_range(0.0, 5.0) = 1.5;
// Add to fragment(): EMISSION += ALBEDO * glow_power;`,
        hologram: `
uniform float scan_speed : hint_range(0.0, 10.0) = 2.0;
uniform float scan_lines : hint_range(10.0, 100.0) = 50.0;
// Add to fragment(): 
// float scan = sin(UV.y * scan_lines + TIME * scan_speed) * 0.5 + 0.5;
// ALPHA = 0.7 * scan;`,
        dissolve: `
uniform sampler2D noise_texture : filter_linear;
uniform float dissolve_amount : hint_range(0.0, 1.0) = 0.0;
// Add to fragment():
// float noise = texture(noise_texture, UV).r;
// if (noise < dissolve_amount) discard;`,
      };

      const theme = args.theme as string;
      const effect = args.effect || 'none';
      
      if (!shaderTemplates[theme]) {
        return this.createErrorResponse(`Unknown theme: ${theme}`, [
          `Available themes: ${Object.keys(shaderTemplates).join(', ')}`,
        ]);
      }

      const template = shaderTemplates[theme];
      let shaderCode = template.code;
      
      if (effect !== 'none' && effectTemplates[effect]) {
        shaderCode += `\n// Effect: ${effect}\n${effectTemplates[effect]}`;
      }

      if (args.shaderParams) {
        try {
          const customParams = JSON.parse(args.shaderParams);
          for (const [key, value] of Object.entries(customParams)) {
            const regex = new RegExp(`(uniform[^;]*${key}[^=]*=\\s*)([^;]+)`, 'g');
            shaderCode = shaderCode.replace(regex, `$1${value}`);
          }
        } catch (e) {
          this.logDebug(`Failed to parse custom shader params: ${e}`);
        }
      }

      const shaderDir = join(args.projectPath, 'shaders');
      if (!existsSync(shaderDir)) {
        mkdirSync(shaderDir, { recursive: true });
      }

      const shaderFileName = `theme_${theme}${effect !== 'none' ? '_' + effect : ''}.gdshader`;
      const shaderPath = join(shaderDir, shaderFileName);
      
      const fs = await import('fs');
      fs.writeFileSync(shaderPath, shaderCode);

      const params = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        shaderPath: `shaders/${shaderFileName}`,
      };

      const { stdout, stderr } = await this.executeOperation('apply_shader_to_node', params, args.projectPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            theme,
            effect,
            description: template.description,
            shaderPath: `res://shaders/${shaderFileName}`,
            appliedTo: args.nodePath,
            output: stdout.trim(),
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to apply theme shader: ${error?.message}`, [
        'Ensure the node path is valid',
        'Check that the scene exists',
      ]);
    }
  }

  private async handleSearchAssets(args: any) {
    args = this.normalizeParameters(args);
    if (!args.keyword) {
      return this.createErrorResponse('Missing required parameter: keyword', []);
    }

    try {
      const { assetManager } = await import('./providers/index.js');
      
      const searchOptions = {
        keyword: args.keyword,
        assetType: args.assetType,
        maxResults: args.maxResults || 10,
      };

      let results: any[];
      const providerFilter = args.provider || 'all';
      const mode = args.mode || 'parallel';

      if (providerFilter !== 'all') {
        results = await assetManager.searchProvider(providerFilter, searchOptions);
      } else if (mode === 'sequential') {
        results = await assetManager.searchSequential(searchOptions);
      } else {
        results = await assetManager.searchAll(searchOptions);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            query: args.keyword,
            mode,
            provider: providerFilter,
            totalResults: results.length,
            results: results.map(r => ({
              id: r.id,
              name: r.name,
              provider: r.provider,
              assetType: r.assetType,
              categories: r.categories,
              tags: r.tags.slice(0, 5),
              license: r.license,
              previewUrl: r.previewUrl,
              downloadCommand: `fetch_asset(projectPath, assetId="${r.id}", provider="${r.provider}")`,
            })),
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to search assets: ${error?.message}`, [
        'Check internet connection',
        'Try a different keyword',
      ]);
    }
  }

  private async handleFetchAsset(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath || !args.assetId || !args.provider) {
      return this.createErrorResponse('Missing required parameters', [
        'Provide projectPath, assetId, and provider',
      ]);
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a valid project path']);
    }

    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, [
          'Ensure the path contains a project.godot file',
        ]);
      }

      const { assetManager } = await import('./providers/index.js');

      const result = await assetManager.download({
        assetId: args.assetId,
        projectPath: args.projectPath,
        provider: args.provider,
        resolution: args.resolution || '2k',
        targetFolder: args.targetFolder,
      });

      if (result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              asset: {
                id: result.assetId,
                provider: result.provider,
              },
              downloadedTo: `res://${result.localPath}`,
              license: result.license,
              attribution: result.attribution,
              sourceUrl: result.sourceUrl,
            }, null, 2),
          }],
        };
      } else {
        return this.createErrorResponse(`Failed to download asset: ${args.assetId}`, [
          'Check that the asset ID is correct',
          'Verify the provider name',
          'Try a different asset',
        ]);
      }
    } catch (error: any) {
      return this.createErrorResponse(`Failed to fetch asset: ${error?.message}`, [
        'Check internet connection',
        'Verify the asset ID and provider',
      ]);
    }
  }

  private async handleListAssetProviders() {
    try {
      const { assetManager } = await import('./providers/index.js');
      const providers = assetManager.getProviderInfo();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            providers: providers.map(p => ({
              name: p.name,
              displayName: p.displayName,
              priority: p.priority,
              supportedTypes: p.types,
              license: 'CC0',
              requiresAuth: false,
            })),
            usage: {
              search: 'search_assets(keyword="chair", assetType="models")',
              download: 'fetch_asset(projectPath, assetId="asset_id", provider="polyhaven")',
            },
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to list providers: ${error?.message}`, []);
    }
  }

  /**
   * Handle the query_classes tool — ClassDB introspection
   */
  private async handleQueryClasses(args: any) {
    const projectPath = args?.projectPath || args?.project_path;
    if (!projectPath) {
      throw new McpError(ErrorCode.InvalidParams, 'projectPath is required');
    }
    const params: Record<string, any> = {};
    if (args?.filter) params.filter = args.filter;
    if (args?.category) params.category = args.category;
    if (args?.instantiableOnly !== undefined) params.instantiable_only = args.instantiableOnly;
    if (args?.instantiable_only !== undefined) params.instantiable_only = args.instantiable_only;
    return await this.executeOperation('query_classes', params, projectPath);
  }

  /**
   * Handle the query_class_info tool — ClassDB introspection
   */
  private async handleQueryClassInfo(args: any) {
    const projectPath = args?.projectPath || args?.project_path;
    const className = args?.className || args?.class_name;
    if (!projectPath) {
      throw new McpError(ErrorCode.InvalidParams, 'projectPath is required');
    }
    if (!className) {
      throw new McpError(ErrorCode.InvalidParams, 'className is required');
    }
    const params: Record<string, any> = {
      class_name: className,
    };
    if (args?.includeInherited !== undefined) params.include_inherited = args.includeInherited;
    if (args?.include_inherited !== undefined) params.include_inherited = args.include_inherited;
    return await this.executeOperation('query_class_info', params, projectPath);
  }

  /**
   * Handle the inspect_inheritance tool — ClassDB introspection
   */
  private async handleInspectInheritance(args: any) {
    const projectPath = args?.projectPath || args?.project_path;
    const className = args?.className || args?.class_name;
    if (!projectPath) {
      throw new McpError(ErrorCode.InvalidParams, 'projectPath is required');
    }
    if (!className) {
      throw new McpError(ErrorCode.InvalidParams, 'className is required');
    }
    return await this.executeOperation('inspect_inheritance', {
      class_name: className,
    }, projectPath);
  }

  /**
   * Handle the modify_resource tool
   */
  private async handleModifyResource(args: any) {
    const projectPath = args?.projectPath || args?.project_path;
    const resourcePath = args?.resourcePath || args?.resource_path;
    if (!projectPath) {
      throw new McpError(ErrorCode.InvalidParams, 'projectPath is required');
    }
    if (!resourcePath) {
      throw new McpError(ErrorCode.InvalidParams, 'resourcePath is required');
    }
    const params: Record<string, any> = {
      resource_path: resourcePath,
    };
    if (args?.properties) {
      params.properties = typeof args.properties === 'string' ? JSON.parse(args.properties) : args.properties;
    }
    return await this.executeOperation('modify_resource', params, projectPath);
  }

  private async handleMapProject(args: any) {
    const projectPath = args?.projectPath || args?.project_path;
    if (!projectPath) {
      throw new McpError(ErrorCode.InvalidParams, 'projectPath is required');
    }
    const root = (args?.root as string) || 'res://';
    const includeAddons = (args?.include_addons as boolean) || false;

    const result = mapProject(projectPath, root, includeAddons);
    if (!result.ok || !result.project_map) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error || 'Failed to map project' }) }],
        isError: true,
      };
    }

    setProjectPath(projectPath);
    try {
      const url = await serveVisualization(result.project_map, this.godotBridge);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          ok: true,
          url,
          total_scripts: result.project_map.total_scripts,
          total_connections: result.project_map.total_connections,
          message: `Interactive project map opened at ${url} — ${result.project_map.total_scripts} scripts, ${result.project_map.total_connections} connections`,
        }, null, 2) }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Failed to start visualizer: ${errMsg}`, project_map: result.project_map }) }],
      };
    }
  }
}

// Create and run the server
const server = new GodotServer();
server.run().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Failed to run server:', errorMessage);
  process.exit(1);
});
