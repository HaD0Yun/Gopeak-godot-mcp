import { readFile, realpath } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

type DiagnosticsWaiter = {
  resolve: (diagnostics: unknown[]) => void;
  timer: NodeJS.Timeout;
};

type JsonRecord = Record<string, unknown>;

export class GodotLSPClient {
  private socket: Socket | null = null;
  private connected: boolean = false;
  private port: number;
  private host: string;
  private requestId: number = 0;
  private pendingRequests: Map<number, PendingRequest>;
  private buffer: string = '';

  private connectPromise: Promise<void> | null = null;
  private initialized: boolean = false;
  private rootPath: string | null = null;
  private diagnosticsWaiters: Map<string, DiagnosticsWaiter> = new Map();
  private documentVersions: Map<string, number> = new Map();

  constructor(port: number = 6005, host: string = '127.0.0.1') {
    this.port = port;
    this.host = host;
    this.pendingRequests = new Map<number, PendingRequest>();
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolveConnect, rejectConnect) => {
      let settled = false;

      const socket = createConnection({ port: this.port, host: this.host }, () => {
        this.socket = socket;
        this.connected = true;
        this.buffer = '';

        if (!settled) {
          settled = true;
          resolveConnect();
        }
      });

      socket.setEncoding('utf8');

      socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        this.parseMessages();
      });

      socket.on('error', (error: Error) => {
        if (!settled && !this.connected) {
          settled = true;
          rejectConnect(new Error(`Failed to connect to Godot LSP at ${this.host}:${this.port}: ${error.message}`));
        }
        this.handleSocketFailure(error);
      });

      socket.on('close', () => {
        this.handleSocketClose();
      });
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      this.connected = false;
      this.initialized = false;
      return;
    }

    const socketToClose = this.socket;
    this.socket = null;
    this.connected = false;
    this.initialized = false;

    await new Promise<void>((resolveClose) => {
      socketToClose.once('close', () => resolveClose());
      socketToClose.end();
      setTimeout(() => {
        if (!socketToClose.destroyed) {
          socketToClose.destroy();
        }
        resolveClose();
      }, 1000);
    });

    this.rejectAllPending(new Error('Disconnected from Godot LSP'));
    this.resolveAllDiagnosticsWaiters([]);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.socket) {
      await this.connect();
    }
  }

  private async ensureInitializedForFile(filePath: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    const rootPath = this.rootPath ?? dirname(resolve(filePath));
    await this.initialize(rootPath);
  }

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    await this.ensureConnected();

    if (!this.socket) {
      throw new Error('Not connected to Godot LSP');
    }

    this.requestId += 1;
    const id = this.requestId;

    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const content = JSON.stringify(payload);
    const framed = this.frameMessage(content);

    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        rejectRequest(new Error(`LSP request timed out after 10s: ${method}`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });

      const socket = this.socket;
      if (!socket) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        rejectRequest(new Error(`Not connected while sending LSP request ${method}`));
        return;
      }

      socket.write(framed, 'utf8', (error?: Error | null) => {
        if (error) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          rejectRequest(new Error(`Failed to send LSP request ${method}: ${error.message}`));
        }
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected to Godot LSP');
    }

    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const content = JSON.stringify(payload);
    const framed = this.frameMessage(content);

    this.socket.write(framed, 'utf8');
  }

  private frameMessage(content: string): string {
    const contentLength = Buffer.byteLength(content, 'utf8');
    return `Content-Length: ${contentLength}\r\n\r\n${content}`;
  }

  private parseMessages(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) {
        return;
      }

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== 'object') {
        continue;
      }

      const message: JsonRecord = parsed as JsonRecord;

      if (typeof message.id === 'number') {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(message.id);

          const errorPayload = message.error;
          if (errorPayload && typeof errorPayload === 'object') {
            const errorObject = errorPayload as JsonRecord;
            const code = typeof errorObject.code === 'number' ? errorObject.code : 'unknown';
            const messageText = typeof errorObject.message === 'string' ? errorObject.message : 'Unknown LSP error';
            pending.reject(new Error(`LSP error (${code}): ${messageText}`));
          } else {
            pending.resolve(message.result);
          }
        }
      }

      if (message.method === 'textDocument/publishDiagnostics') {
        const params = message.params;
        const paramsObject = params && typeof params === 'object' ? (params as JsonRecord) : null;
        const uri = paramsObject && typeof paramsObject.uri === 'string' ? paramsObject.uri : null;
        const diagnostics = paramsObject && Array.isArray(paramsObject.diagnostics)
          ? (paramsObject.diagnostics as unknown[])
          : [];
        if (typeof uri === 'string') {
          const waiter = this.diagnosticsWaiters.get(uri);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.diagnosticsWaiters.delete(uri);
            waiter.resolve(diagnostics);
          }
        }
      }
    }
  }

  private handleSocketFailure(error: Error): void {
    this.connected = false;
    this.initialized = false;
    this.socket = null;
    this.rejectAllPending(new Error(`Godot LSP connection error: ${error.message}`));
    this.resolveAllDiagnosticsWaiters([]);
  }

  private handleSocketClose(): void {
    this.connected = false;
    this.initialized = false;
    this.socket = null;
    this.rejectAllPending(new Error('Godot LSP socket closed'));
    this.resolveAllDiagnosticsWaiters([]);
  }

  private rejectAllPending(error: Error): void {
    this.pendingRequests.forEach((pending, id) => {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    });
  }

  private resolveAllDiagnosticsWaiters(diagnostics: unknown[]): void {
    this.diagnosticsWaiters.forEach((waiter, uri) => {
      clearTimeout(waiter.timer);
      waiter.resolve(diagnostics);
      this.diagnosticsWaiters.delete(uri);
    });
  }

  private toFileUri(filePath: string): string {
    return pathToFileURL(resolve(filePath)).href;
  }

  private syncDocument(filePath: string, content: string): string {
    const uri = this.toFileUri(filePath);
    const currentVersion = this.documentVersions.get(uri) ?? 0;
    const nextVersion = currentVersion + 1;
    this.documentVersions.set(uri, nextVersion);

    if (currentVersion === 0) {
      this.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: 'gdscript',
          version: nextVersion,
          text: content,
        },
      });
    } else {
      this.sendNotification('textDocument/didChange', {
        textDocument: {
          uri,
          version: nextVersion,
        },
        contentChanges: [
          {
            text: content,
          },
        ],
      });
    }

    return uri;
  }

  async initialize(rootPath: string): Promise<unknown> {
    await this.ensureConnected();

    const resolvedRootPath = resolve(rootPath);
    const rootUri = pathToFileURL(resolvedRootPath).href;

    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      rootPath: resolvedRootPath,
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          completion: {
            completionItem: {
              snippetSupport: true,
            },
          },
          hover: {
            contentFormat: ['markdown', 'plaintext'],
          },
          documentSymbol: {},
        },
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: resolvedRootPath,
        },
      ],
    });

    this.sendNotification('initialized', {});

    this.initialized = true;
    this.rootPath = resolvedRootPath;

    return result;
  }

  async getDiagnostics(filePath: string, content: string): Promise<unknown[]> {
    await this.ensureConnected();
    await this.ensureInitializedForFile(filePath);

    const uri = this.toFileUri(filePath);

    const diagnosticsPromise = new Promise<unknown[]>((resolveDiagnostics) => {
      const existing = this.diagnosticsWaiters.get(uri);
      if (existing) {
        clearTimeout(existing.timer);
      }

      const timer = setTimeout(() => {
        this.diagnosticsWaiters.delete(uri);
        resolveDiagnostics([]);
      }, 5000);

      this.diagnosticsWaiters.set(uri, {
        resolve: resolveDiagnostics,
        timer,
      });
    });

    try {
      this.syncDocument(filePath, content);
      return await diagnosticsPromise;
    } catch (error) {
      const waiter = this.diagnosticsWaiters.get(uri);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.diagnosticsWaiters.delete(uri);
      }
      throw error;
    }
  }

  async getCompletions(filePath: string, content: string, line: number, character: number): Promise<unknown[]> {
    await this.ensureConnected();
    await this.ensureInitializedForFile(filePath);

    const uri = this.syncDocument(filePath, content);
    const result = await this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line, character },
    });

    if (Array.isArray(result)) {
      return result;
    }

    if (result && typeof result === 'object') {
      const resultObject = result as JsonRecord;
      if (Array.isArray(resultObject.items)) {
        return resultObject.items;
      }
    }

    return [];
  }

  async getHover(filePath: string, content: string, line: number, character: number): Promise<unknown> {
    await this.ensureConnected();
    await this.ensureInitializedForFile(filePath);

    const uri = this.syncDocument(filePath, content);
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async getDocumentSymbols(filePath: string, content: string): Promise<unknown[]> {
    await this.ensureConnected();
    await this.ensureInitializedForFile(filePath);

    const uri = this.syncDocument(filePath, content);
    const result = await this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });

    return Array.isArray(result) ? result : [];
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export function createLSPTools(): Array<{ name: string, description: string, inputSchema: Record<string, unknown> }> {
  return [
    {
      name: 'lsp_get_diagnostics',
      description: 'Get GDScript diagnostics from Godot Language Server for a script file.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to Godot project root' },
          scriptPath: { type: 'string', description: 'Path to script relative to project root' },
        },
        required: ['projectPath', 'scriptPath'],
      },
    },
    {
      name: 'lsp_get_completions',
      description: 'Get code completions from Godot Language Server at a given position.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to Godot project root' },
          scriptPath: { type: 'string', description: 'Path to script relative to project root' },
          line: { type: 'number', description: 'Zero-based line number' },
          character: { type: 'number', description: 'Zero-based character offset' },
        },
        required: ['projectPath', 'scriptPath', 'line', 'character'],
      },
    },
    {
      name: 'lsp_get_hover',
      description: 'Get hover information from Godot Language Server at a given position.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to Godot project root' },
          scriptPath: { type: 'string', description: 'Path to script relative to project root' },
          line: { type: 'number', description: 'Zero-based line number' },
          character: { type: 'number', description: 'Zero-based character offset' },
        },
        required: ['projectPath', 'scriptPath', 'line', 'character'],
      },
    },
    {
      name: 'lsp_get_symbols',
      description: 'Get document symbols for a GDScript file from Godot Language Server.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Absolute path to Godot project root' },
          scriptPath: { type: 'string', description: 'Path to script relative to project root' },
        },
        required: ['projectPath', 'scriptPath'],
      },
    },
  ];
}

function asToolResponse(payload: unknown): { content: Array<{ type: string, text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function normalizeLSPError(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('Failed to connect to Godot LSP') ||
      error.message.includes('socket closed')
    ) {
      return 'Godot LSP is unavailable. Start the Godot editor and enable Language Server in Editor Settings (port 6005 by default).';
    }
    return error.message;
  }

  return String(error);
}

function normalizePathForComparison(pathValue: string): string {
  const resolved = resolve(pathValue);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = normalizePathForComparison(rootPath);
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootPrefix);
}

async function resolveLSPPaths(
  projectPathValue: string,
  scriptPathValue: string
): Promise<{ projectPath: string; scriptPath: string }> {
  const requestedProjectPath = resolve(projectPathValue);
  let projectPath: string;
  try {
    projectPath = await realpath(requestedProjectPath);
  } catch {
    throw new Error(`Project path does not exist: ${requestedProjectPath}`);
  }

  const requestedScriptPath = resolve(projectPath, scriptPathValue);
  let scriptPath: string;
  try {
    scriptPath = await realpath(requestedScriptPath);
  } catch {
    throw new Error(`Script file does not exist: ${requestedScriptPath}`);
  }

  if (!isPathWithinRoot(projectPath, scriptPath)) {
    throw new Error('scriptPath resolves outside the project root boundary.');
  }

  return { projectPath, scriptPath };
}

export async function handleLSPTool(
  client: GodotLSPClient,
  toolName: string,
  args: unknown
): Promise<{ content: Array<{ type: string, text: string }> }> {
  try {
    if (!args || typeof args !== 'object') {
      throw new Error('Tool arguments must be an object.');
    }

    const parsedArgs = args as JsonRecord;
    const projectPathValue = parsedArgs.projectPath;
    const scriptPathValue = parsedArgs.scriptPath;

    if (typeof projectPathValue !== 'string' || projectPathValue.length === 0) {
      throw new Error('Missing required argument: projectPath');
    }

    if (typeof scriptPathValue !== 'string' || scriptPathValue.length === 0) {
      throw new Error('Missing required argument: scriptPath');
    }

    const { projectPath, scriptPath } = await resolveLSPPaths(projectPathValue, scriptPathValue);
    const content = await readFile(scriptPath, 'utf8');

    await client.initialize(projectPath);

    switch (toolName) {
      case 'lsp_get_diagnostics': {
        const diagnostics = await client.getDiagnostics(scriptPath, content);
        return asToolResponse({ diagnostics });
      }

      case 'lsp_get_completions': {
        const line = Number(parsedArgs.line);
        const character = Number(parsedArgs.character);

        if (!Number.isFinite(line) || !Number.isFinite(character)) {
          throw new Error('Arguments line and character must be numbers.');
        }

        const completions = await client.getCompletions(scriptPath, content, line, character);
        return asToolResponse({ completions });
      }

      case 'lsp_get_hover': {
        const line = Number(parsedArgs.line);
        const character = Number(parsedArgs.character);

        if (!Number.isFinite(line) || !Number.isFinite(character)) {
          throw new Error('Arguments line and character must be numbers.');
        }

        const hover = await client.getHover(scriptPath, content, line, character);
        return asToolResponse({ hover });
      }

      case 'lsp_get_symbols': {
        const symbols = await client.getDocumentSymbols(scriptPath, content);
        return asToolResponse({ symbols });
      }

      default:
        return asToolResponse({ error: `Unknown LSP tool: ${toolName}` });
    }
  } catch (error) {
    return asToolResponse({
      error: normalizeLSPError(error),
    });
  }
}
