export interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

export interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
  godotDebugMode?: boolean;
  strictPathValidation?: boolean;
}

export interface OperationParams {
  [key: string]: any;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolGroupDefinition {
  description: string;
  tools: string[];
  keywords: string[];
}
