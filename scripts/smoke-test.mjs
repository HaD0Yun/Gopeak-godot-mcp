#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { WebSocket } from 'ws';

function parseResponses(data) {
  return data
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve a TCP port.')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function connectWebSocket(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timeout connecting to ${url}`));
    }, 3000);

    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const host = process.env.GOPEAK_BRIDGE_HOST || '127.0.0.1';
  const configuredPort = Number.parseInt(process.env.GOPEAK_BRIDGE_PORT || '', 10);
  const port = Number.isInteger(configuredPort) && configuredPort > 0
    ? configuredPort
    : await reservePort();

  const server = spawn(process.execPath, ['build/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GODOT_PATH: process.env.GODOT_PATH || process.execPath,
      GOPEAK_BRIDGE_PORT: String(port),
      GOPEAK_BRIDGE_HOST: host,
      GOPEAK_TOOL_PROFILE: 'compact',
    },
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const cleanup = async () => {
    if (server.exitCode === null) {
      server.stdin.end();
      server.kill('SIGTERM');
      await delay(250);
    }
  };

  const send = (payload) => {
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  const PROMPTS_LIST_ID = 2;
  const TOOLS_LIST_ID = 3;

  try {
    await delay(2000);
    if (server.exitCode !== null) {
      throw new Error(`server exited early: ${stderr || '(no stderr)'}`);
    }

    stdout = '';
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ci-smoke', version: '1.0.0' },
      },
    });

    await delay(1000);
    const init = parseResponses(stdout).find((message) => message?.id === 1 && message?.result?.serverInfo);
    if (!init) {
      throw new Error('missing initialize response');
    }
    if (!init.result?.capabilities?.prompts) {
      throw new Error('missing prompts capability');
    }

    stdout = '';
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: PROMPTS_LIST_ID, method: 'prompts/list', params: {} });
    await delay(1000);

    const prompts = parseResponses(stdout).find((message) => message?.id === PROMPTS_LIST_ID && Array.isArray(message?.result?.prompts));
    if (!prompts || prompts.result.prompts.length < 2) {
      throw new Error('missing prompts/list response');
    }

    stdout = '';
    send({ jsonrpc: '2.0', id: TOOLS_LIST_ID, method: 'tools/list', params: {} });

    await delay(1500);
    const tools = parseResponses(stdout).find((message) => message?.id === TOOLS_LIST_ID && Array.isArray(message?.result?.tools));
    if (!tools || tools.result.tools.length === 0) {
      throw new Error('missing tools/list response');
    }

    await connectWebSocket(`ws://${host}:${port}/visualizer`);
    await connectWebSocket(`ws://${host}:${port}/godot`);

    console.log(`ci smoke passed with ${tools.result.tools.length} tools on ${host}:${port}`);
    await cleanup();
  } catch (error) {
    await cleanup();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
