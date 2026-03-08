#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const SERVER_ENTRY = './build/index.js';
const GODOT_PATH = process.env.GODOT_PATH || '/home/doyun/Apps/godot-4.6-rc2/Godot_v4.6-rc2_linux.x86_64';

let passCount = 0;
let failCount = 0;
let nextId = 1;

function pass(message) {
  passCount += 1;
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failCount += 1;
  console.log(`FAIL: ${message}`);
}

function assert(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
    return true;
  }
  fail(failureMessage || successMessage);
  return false;
}

function makeRequest(method, params = {}) {
  return {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params,
  };
}

class StdioJsonRpcClient {
  constructor(child) {
    this.child = child;
    this.buffer = '';
    this.pending = new Map();
    this.notifications = [];

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      this.#drainBuffer();
    });
  }

  #drainBuffer() {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (typeof message.id !== 'undefined' && this.pending.has(message.id)) {
        const resolver = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolver(message);
      } else {
        this.notifications.push(message);
      }
    }
  }

  send(method, params = {}) {
    const request = makeRequest(method, params);
    const payload = `${JSON.stringify(request)}\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Timed out waiting for response to ${method}`));
      }, 15000);

      this.pending.set(request.id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });

      this.child.stdin.write(payload, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(request.id);
          reject(error);
        }
      });
    });
  }

  notify(method, params = {}) {
    const notification = { jsonrpc: '2.0', method, params };
    this.child.stdin.write(`${JSON.stringify(notification)}\n`);
  }
}

function parseToolCallJson(response) {
  if (response?.error) {
    throw new Error(response.error.message || 'Tool call returned JSON-RPC error');
  }

  const text = (response?.result?.content || [])
    .filter((chunk) => chunk?.type === 'text')
    .map((chunk) => chunk.text || '')
    .join('');

  if (!text) {
    throw new Error('Tool call did not return text content');
  }

  return JSON.parse(text);
}

async function listAllTools(client) {
  const tools = [];
  let cursor;

  for (let page = 0; page < 20; page += 1) {
    const response = await client.send('tools/list', cursor ? { cursor } : {});
    if (response.error) {
      throw new Error(`tools/list failed: ${response.error.message}`);
    }

    const pageTools = response.result?.tools || [];
    tools.push(...pageTools);

    cursor = response.result?.nextCursor;
    if (!cursor) {
      break;
    }
  }

  return tools;
}

async function main() {
  console.log('Running dynamic tool group MCP test...');

  const server = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GODOT_PATH,
      GOPEAK_TOOL_PROFILE: 'compact',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const cleanup = async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => server.once('exit', resolve)),
        delay(2000),
      ]);

      if (server.exitCode === null) {
        server.kill('SIGKILL');
        await Promise.race([
          new Promise((resolve) => server.once('exit', resolve)),
          delay(2000),
        ]);
      }
    }
  };

  try {
    await delay(500);
    assert(server.exitCode === null, 'Server process is running', 'Server exited during startup');

    const client = new StdioJsonRpcClient(server);

    const init = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dynamic-group-test', version: '1.0.0' },
    });

    assert(!init.error, 'initialize succeeded', `initialize failed: ${init.error?.message || 'unknown error'}`);
    client.notify('notifications/initialized');

    const initialTools = await listAllTools(client);
    const initialToolNames = new Set(initialTools.map((tool) => tool.name));

    assert(
      initialTools.length === 33,
      'Default compact profile exposes exactly 33 tools',
      `Expected 33 initial tools, got ${initialTools.length}`,
    );
    assert(
      initialToolNames.has('tool.groups'),
      'Compact alias tool.groups is available',
      'Compact alias tool.groups is missing',
    );
    assert(
      !initialToolNames.has('create_animation'),
      'Animation legacy tool is hidden by default',
      'Animation legacy tool should not be exposed before activation',
    );

    const catalogResponse = await client.send('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'animation' },
    });
    const catalogPayload = parseToolCallJson(catalogResponse);

    assert(
      Array.isArray(catalogPayload.newlyActivated) && catalogPayload.newlyActivated.includes('animation'),
      'tool_catalog auto-activates animation group for query "animation"',
      `Expected newlyActivated to include animation, got: ${JSON.stringify(catalogPayload.newlyActivated)}`,
    );
    assert(
      Array.isArray(catalogPayload.activeGroups) && catalogPayload.activeGroups.includes('animation'),
      'tool_catalog reports animation group as active',
      `Expected activeGroups to include animation, got: ${JSON.stringify(catalogPayload.activeGroups)}`,
    );

    const postActivationTools = await listAllTools(client);
    const postActivationNames = new Set(postActivationTools.map((tool) => tool.name));
    const animationGroupTools = [
      'create_animation',
      'add_animation_track',
      'create_animation_tree',
      'add_animation_state',
      'connect_animation_states',
    ];

    assert(
      animationGroupTools.every((name) => postActivationNames.has(name)),
      'After activation, exposed tools include animation group tools',
      `Missing animation tools after activation: ${animationGroupTools.filter((name) => !postActivationNames.has(name)).join(', ')}`,
    );

    const statusResponse = await client.send('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'status' },
    });
    const statusPayload = parseToolCallJson(statusResponse);
    const statusActiveNames = new Set((statusPayload.dynamicGroups?.groups || []).map((group) => group?.name));

    assert(
      statusActiveNames.has('animation'),
      'manage_tool_groups status shows animation as active',
      `Expected status active groups to include animation, got: ${JSON.stringify(statusPayload.dynamicGroups?.groups)}`,
    );

    const resetResponse = await client.send('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'reset' },
    });
    const resetPayload = parseToolCallJson(resetResponse);

    assert(
      Array.isArray(resetPayload.activeGroups) && resetPayload.activeGroups.length === 0,
      'manage_tool_groups reset deactivates all groups',
      `Expected activeGroups to be empty after reset, got: ${JSON.stringify(resetPayload.activeGroups)}`,
    );

    const afterResetTools = await listAllTools(client);
    const afterResetNames = new Set(afterResetTools.map((tool) => tool.name));

    assert(
      afterResetTools.length === 33,
      'After reset, compact profile exposes exactly 33 tools again',
      `Expected 33 tools after reset, got ${afterResetTools.length}`,
    );
    assert(
      animationGroupTools.every((name) => !afterResetNames.has(name)),
      'After reset, animation group tools are no longer exposed',
      `Animation tools still exposed after reset: ${animationGroupTools.filter((name) => afterResetNames.has(name)).join(', ')}`,
    );

    console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
    if (failCount > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    fail(`Unhandled test error: ${error?.message || String(error)}`);
    console.log(`\nSummary: ${passCount} passed, ${failCount} failed`);
    process.exitCode = 1;
  } finally {
    await cleanup();
    if (stderr.trim()) {
      console.log('\n[Server stderr excerpt]');
      console.log(stderr.trim().split('\n').slice(-10).join('\n'));
    }
  }
}

await main();
