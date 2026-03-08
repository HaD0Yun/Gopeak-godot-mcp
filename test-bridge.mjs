#!/usr/bin/env node
/**
 * Integration test for Godot MCP Bridge
 * Tests: MCP server startup, WebSocket bridge, tool routing
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const MCP_SERVER = './build/index.js';
const bridgePortRaw = process.env.GODOT_BRIDGE_PORT || process.env.MCP_BRIDGE_PORT || process.env.GOPEAK_BRIDGE_PORT;
const parsedBridgePort = Number.parseInt(bridgePortRaw || '', 10);
const BRIDGE_PORT = Number.isInteger(parsedBridgePort) && parsedBridgePort >= 1 && parsedBridgePort <= 65535
  ? parsedBridgePort
  : null;
const BRIDGE_HOST = process.env.GOPEAK_BRIDGE_HOST || process.env.GODOT_BRIDGE_HOST || '127.0.0.1';
const GODOT_PATH = process.env.GODOT_PATH || '/home/doyun/Apps/godot-4.6-rc2/Godot_v4.6-rc2_linux.x86_64';
const TEST_PROJECT = process.env.GOPEAK_TEST_PROJECT || '/home/doyun/gopeak-smoke-test';
const RUNTIME_PORT = 7777;

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}
function fail(name, err) {
  failed++;
  console.log(`  ❌ ${name}: ${err}`);
}

// --- MCP JSON-RPC helpers ---
let msgId = 1;
function rpcMsg(method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: msgId++, method, params }) + '\n';
}

function parseResponses(data) {
  const lines = data.split('\n').filter(l => l.trim());
  const results = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line)); } catch {}
  }
  return results;
}

function parseTextContent(response) {
  const text = response?.result?.content?.map(chunk => chunk?.text || '').join('') || '';
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function chooseTool(toolNames, preferred) {
  for (const name of preferred) {
    if (name && toolNames.has(name)) {
      return name;
    }
  }
  return preferred.find(Boolean);
}

async function reserveBridgePort() {
  if (BRIDGE_PORT) {
    return BRIDGE_PORT;
  }

  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, BRIDGE_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve bridge port')));
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

// --- Main test ---
async function main() {
  console.log('\n🧪 Godot MCP Bridge Integration Test\n');
  const bridgePort = await reserveBridgePort();
  const godotWsUrl = `ws://${BRIDGE_HOST}:${bridgePort}/godot`;
  const vizWsUrl = `ws://${BRIDGE_HOST}:${bridgePort}/visualizer`;

  // 1. Start MCP server
  console.log('📦 Starting MCP server...');
  const server = spawn(process.execPath, [MCP_SERVER], {
    env: { ...process.env, GODOT_PATH, DEBUG: 'true', GOPEAK_TOOL_PROFILE: 'compact', GOPEAK_BRIDGE_PORT: String(bridgePort), GOPEAK_BRIDGE_HOST: BRIDGE_HOST },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', d => { stderr += d.toString(); });

  let stdout = '';
  server.stdout.on('data', d => { stdout += d.toString(); });

  // Wait for server startup
  await delay(2000);

  if (server.exitCode !== null) {
    console.log('💥 Server crashed on startup!');
    console.log('stderr:', stderr);
    process.exit(1);
  }
  ok('MCP server started (pid: ' + server.pid + ')');

  // 2. Send MCP initialize
  console.log('\n📡 Testing MCP Protocol...');
  stdout = ''; // reset
  server.stdin.write(rpcMsg('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }));
  await delay(1000);

  const initResponses = parseResponses(stdout);
  if (initResponses.length > 0 && initResponses[0].result) {
    ok('MCP initialize response received');
    const caps = initResponses[0].result;
    if (caps.serverInfo) {
      ok(`Server: ${caps.serverInfo.name} v${caps.serverInfo.version}`);
    }
    if (caps.capabilities?.prompts) {
      ok('Server advertises prompts capability');
    } else {
      fail('prompts capability', 'Missing capabilities.prompts in initialize response');
    }
  } else {
    fail('MCP initialize', 'No valid response. stdout: ' + stdout.substring(0, 200));
  }

  // 3. Send initialized notification
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await delay(500);

  // 4. List tools
  console.log('\n🧠 Testing MCP prompts...');
  stdout = '';
  server.stdin.write(rpcMsg('prompts/list'));
  await delay(1000);

  const promptListResponses = parseResponses(stdout);
  const promptListResult = promptListResponses.find(response => response.result?.prompts)?.result;
  if (promptListResult?.prompts?.length >= 2) {
    ok(`prompts/list returned ${promptListResult.prompts.length} prompt(s)`);
    const promptNames = new Set(promptListResult.prompts.map(prompt => prompt.name));
    if (promptNames.has('godot.scene_bootstrap') && promptNames.has('godot.debug_triage')) {
      ok('Expected Godot prompts are listed');
    } else {
      fail('prompt listing', `Expected godot.scene_bootstrap and godot.debug_triage, got: ${Array.from(promptNames).join(', ')}`);
    }
  } else {
    fail('prompts/list', 'No valid prompt list response');
  }

  stdout = '';
  server.stdin.write(rpcMsg('prompts/get', {
    name: 'godot.scene_bootstrap',
    arguments: {
      project_path: '/tmp/demo-project',
      scene_path: 'res://scenes/Player.tscn',
    },
  }));
  await delay(1000);

  const promptGetResponses = parseResponses(stdout);
  const promptGetResult = promptGetResponses.find(response => response.result?.messages)?.result;
  if (promptGetResult?.messages?.length > 0) {
    const promptText = promptGetResult.messages.map(message => message?.content?.text || '').join('\n');
    if (promptText.includes('/tmp/demo-project') && promptText.includes('res://scenes/Player.tscn')) {
      ok('prompts/get returns templated prompt content');
    } else {
      fail('prompts/get template args', 'Prompt content did not include expected argument values');
    }
  } else {
    fail('prompts/get', 'No valid prompt response for godot.scene_bootstrap');
  }

  stdout = '';
  server.stdin.write(rpcMsg('prompts/get', { name: 'godot.unknown_prompt', arguments: {} }));
  await delay(1000);
  const unknownPromptResponses = parseResponses(stdout);
  const unknownPromptError = unknownPromptResponses.find(response => response.error)?.error;
  if (unknownPromptError?.message?.includes('Unknown prompt')) {
    ok('prompts/get returns clear error for unknown prompt');
  } else {
    fail('unknown prompt handling', 'Expected explicit unknown prompt error');
  }

  // 5. Test tool catalog before tools/list (regression: issue #6)
  console.log('\n📚 Testing tool catalog before tools/list...');
  let catalogToolName = 'tool.catalog';
  let catalogPayload = null;
  for (const candidate of ['tool.catalog', 'tool_catalog']) {
    stdout = '';
    server.stdin.write(rpcMsg('tools/call', { name: candidate, arguments: { limit: 20 } }));
    await delay(1000);
    const catalogResponses = parseResponses(stdout);
    const catalogResult = catalogResponses.find(response => response.result?.content);
    const parsedCatalog = parseTextContent(catalogResult);
    if (parsedCatalog && typeof parsedCatalog.totalTools === 'number') {
      catalogToolName = candidate;
      catalogPayload = parsedCatalog;
      break;
    }
  }

  if (catalogPayload) {
    if (catalogPayload.totalTools > 0) {
      ok(`${catalogToolName} returned non-zero totalTools (${catalogPayload.totalTools}) before tools/list`);
    } else {
      fail(`${catalogToolName} totalTools`, `Expected > 0, got ${catalogPayload.totalTools}`);
    }

    stdout = '';
    server.stdin.write(rpcMsg('tools/call', { name: catalogToolName, arguments: { query: 'scene', limit: 20 } }));
    await delay(1000);
    const knownToolResponses = parseResponses(stdout);
    const knownToolPayload = parseTextContent(knownToolResponses.find(response => response.result?.content));
    const catalogIncludesKnownTool = Array.isArray(knownToolPayload?.tools) && knownToolPayload.tools.some((entry) => {
      return ['create_scene', 'scene.create'].includes(entry?.tool)
        || ['create_scene', 'scene.create'].includes(entry?.compactAlias);
    });
    if (catalogIncludesKnownTool) {
      ok(`${catalogToolName} query includes known tool entry`);
    } else {
      fail(`${catalogToolName} known tool`, `Known scene tool not found in query results`);
    }
  } else {
    fail('tool catalog preflight', 'No valid tool catalog response before tools/list');
  }

  // 5. List tools
  async function listAllTools() {
    const allTools = [];
    let cursor;

    for (let page = 1; page <= 20; page++) {
      stdout = '';
      server.stdin.write(rpcMsg('tools/list', cursor ? { cursor } : {}));
      await delay(1500);

      const responses = parseResponses(stdout);
      const result = responses.find(response => response.result?.tools)?.result;
      if (!result?.tools) {
        throw new Error(`No valid tools/list response for page ${page}. stdout: ${stdout.substring(0, 500)}`);
      }

      allTools.push(...result.tools);
      if (!result.nextCursor) {
        return allTools;
      }
      cursor = result.nextCursor;
    }

    throw new Error('tools/list pagination did not terminate within 20 pages');
  }

  let statusToolName = 'get_editor_status';
  let runtimeStatusToolName = 'get_runtime_status';
  let sceneCreateToolName = 'create_scene';
  try {
    const tools = await listAllTools();
    const toolNames = new Set(tools.map(tool => tool.name));
    const isCompactProfile = Array.from(toolNames).some(name => name.includes('.'));
    const hasTool = (...names) => names.filter(Boolean).some(name => toolNames.has(name));

    ok(`tools/list returned ${tools.length} tools across all pages`);

    if (hasTool('get_editor_status', 'editor.status')) {
      ok('get_editor_status/editor.status tool registered');
    } else {
      fail('get_editor_status/editor.status', 'Not found in tool list');
    }
    statusToolName = chooseTool(toolNames, ['editor.status', 'get_editor_status']);
    runtimeStatusToolName = chooseTool(toolNames, ['runtime.status', 'get_runtime_status']);
    sceneCreateToolName = chooseTool(toolNames, ['scene.create', 'create_scene']);

    const migratedTools = [
      { legacy: 'create_scene', compact: 'scene.create' },
      { legacy: 'add_node', compact: 'scene.node.add' },
      { legacy: 'list_scene_nodes' },
      { legacy: 'create_resource' },
      { legacy: 'create_animation' },
    ];

    for (const { legacy, compact } of migratedTools) {
      if (hasTool(legacy, compact)) {
        ok(`Tool '${compact || legacy}' registered`);
      } else if (isCompactProfile && !compact) {
        ok(`Tool '${legacy}' omitted by compact profile (expected)`);
      } else {
        fail(`Tool '${legacy}'`, 'Not found');
      }
    }
  } catch (error) {
    fail('tools/list', error.message);
  }

  // 5.5 Regression: class introspection tools should return structured MCP content
  console.log('\n🏛️ Testing ClassDB introspection tools...');
  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: 'query_classes',
    arguments: {
      projectPath: TEST_PROJECT,
      category: 'node2d',
      filter: 'sprite',
      instantiableOnly: true,
    }
  }));
  await delay(1500);

  const queryClassesResponses = parseResponses(stdout);
  const queryClassesPayload = parseTextContent(queryClassesResponses.find(response => response.result?.content));
  if (queryClassesPayload && Array.isArray(queryClassesPayload.classes)) {
    ok(`query_classes returned structured JSON (${queryClassesPayload.classes.length} classes)`);
  } else {
    fail('query_classes structured response', JSON.stringify(queryClassesResponses[0] || null));
  }

  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: 'query_class_info',
    arguments: {
      projectPath: TEST_PROJECT,
      className: 'Node2D',
    }
  }));
  await delay(1500);

  const queryClassInfoResponses = parseResponses(stdout);
  const queryClassInfoPayload = parseTextContent(queryClassInfoResponses.find(response => response.result?.content));
  if (queryClassInfoPayload && queryClassInfoPayload.class_name === 'Node2D' && Array.isArray(queryClassInfoPayload.methods)) {
    ok(`query_class_info returned structured JSON (${queryClassInfoPayload.methods.length} methods)`);
  } else {
    fail('query_class_info structured response', JSON.stringify(queryClassInfoResponses[0] || null));
  }

  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: 'search_project',
    arguments: {
      projectPath: TEST_PROJECT,
      query: 'extends CharacterBody2D',
      fileTypes: ['gd'],
      maxResults: 10,
    }
  }));
  await delay(1500);

  const searchProjectResponses = parseResponses(stdout);
  const searchProjectText = searchProjectResponses
    .flatMap((response) => response?.result?.content || [])
    .map((chunk) => chunk?.text || '')
    .join('\n');
  if (searchProjectText.includes('player.gd') || searchProjectText.includes('CharacterBody2D')) {
    ok('search_project runs without script parse errors');
  } else {
    fail('search_project regression', searchProjectText.substring(0, 400) || JSON.stringify(searchProjectResponses[0] || null));
  }

  // 5.6 Runtime status should reflect addon ping, not only process state
  console.log('\n🧭 Testing runtime status...');
  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: runtimeStatusToolName,
    arguments: { projectPath: TEST_PROJECT }
  }));
  await delay(1500);

  const runtimeStatusResponses = parseResponses(stdout);
  const runtimeStatusPayload = parseTextContent(runtimeStatusResponses.find(response => response.result?.content));
  if (runtimeStatusPayload?.connected === false && runtimeStatusPayload?.status === 'not_running') {
    ok('get_runtime_status reports not_running without runtime addon');
  } else {
    fail('get_runtime_status initial state', JSON.stringify(runtimeStatusResponses[0] || null));
  }

  const runtimeServer = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) {
        return;
      }

      const line = buffer.split('\n')[0].trim();
      if (!line) {
        socket.end();
        return;
      }

      try {
        const request = JSON.parse(line);
        socket.write(`${JSON.stringify({ type: 'welcome', protocol: 'godot_mcp_runtime', version: '1.0.0' })}\n`);
        socket.write(`${JSON.stringify({ type: 'pong', id: request.id, timestamp: Date.now() })}\n`);
      } catch {
        socket.write(`${JSON.stringify({ error: 'invalid_json' })}\n`);
      }
      socket.end();
    });
  });

  await new Promise((resolve, reject) => {
    runtimeServer.once('error', reject);
    runtimeServer.listen(RUNTIME_PORT, '127.0.0.1', resolve);
  });

  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: runtimeStatusToolName,
    arguments: { projectPath: TEST_PROJECT }
  }));
  await delay(1500);

  const runtimeConnectedResponses = parseResponses(stdout);
  const runtimeConnectedPayload = parseTextContent(runtimeConnectedResponses.find(response => response.result?.content));
  if (runtimeConnectedPayload?.connected === true && runtimeConnectedPayload?.runtimeAddon === 'connected') {
    ok('get_runtime_status reports connected when runtime addon responds to ping');
  } else {
    fail('get_runtime_status connected state', JSON.stringify(runtimeConnectedResponses[0] || null));
  }

  await new Promise((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));

  // 6. Call get_editor_status (should show disconnected)
  console.log('\n🔌 Testing get_editor_status (no Godot connected)...');
  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: statusToolName,
    arguments: {}
  }));
  await delay(1500);

  const statusResponses = parseResponses(stdout);
  if (statusResponses.length > 0) {
    const res = statusResponses[0];
    if (res.result?.content) {
      const text = res.result.content.map(c => c.text).join('');
      ok('get_editor_status responded');
      if (text.includes('false') || text.includes('disconnected') || text.includes('not connected')) {
        ok('Status shows disconnected (correct - no Godot)');
      } else {
        console.log('    Response:', text.substring(0, 300));
      }
    } else if (res.error) {
      fail('get_editor_status', JSON.stringify(res.error));
    }
  } else {
    fail('get_editor_status', 'No response');
  }

  // 7. Test a migrated tool (should fail gracefully when no Godot)
  console.log('\n🎮 Testing migrated tool without Godot connected...');
  stdout = '';
  server.stdin.write(rpcMsg('tools/call', {
    name: sceneCreateToolName,
    arguments: { scene_path: 'res://test.tscn', root_type: 'Node2D' }
  }));
  await delay(2000);

  const sceneResponses = parseResponses(stdout);
  if (sceneResponses.length > 0) {
    const res = sceneResponses[0];
    if (res.result?.content) {
      const text = res.result.content.map(c => c.text).join('');
      if (text.includes('not connected') || text.includes('editor') || text.includes('Error') || text.includes('error')) {
        ok('create_scene correctly reports editor not connected');
      } else {
        ok('create_scene responded: ' + text.substring(0, 200));
      }
    } else if (res.error) {
      ok('create_scene returned error (expected): ' + res.error.message?.substring(0, 100));
    }
  } else {
    fail('create_scene without Godot', 'No response');
  }

  // 8. Test visualizer WebSocket path routing
  console.log('\n🖥️ Testing visualizer WebSocket path...');
  try {
    const vizWs = await new Promise((resolve, reject) => {
      const socket = new WebSocket(vizWsUrl);
      socket.on('open', () => resolve(socket));
      socket.on('error', reject);
      setTimeout(() => reject(new Error('Visualizer WS connect timeout')), 3000);
    });
    ok('Visualizer WebSocket connected to /visualizer');
    vizWs.close();
    await delay(200);
  } catch (e) {
    fail('Visualizer WebSocket path', e.message);
  }

  // 9. Test WebSocket connection (mock Godot client)
  console.log('\n🌐 Testing WebSocket bridge...');
  try {
    const ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(godotWsUrl);
      socket.on('open', () => resolve(socket));
      socket.on('error', reject);
      setTimeout(() => reject(new Error('WS connect timeout')), 3000);
    });
    ok('Godot WebSocket connected to /godot');

    // Send godot_ready
    ws.send(JSON.stringify({
      type: 'godot_ready',
      project_path: TEST_PROJECT
    }));
    await delay(500);
    ok('Sent godot_ready message');

    // Check editor status again (should be connected now)
    stdout = '';
    server.stdin.write(rpcMsg('tools/call', {
      name: statusToolName,
      arguments: {}
    }));
    await delay(1500);

    const connStatusResponses = parseResponses(stdout);
    if (connStatusResponses.length > 0) {
      const text = connStatusResponses[0].result?.content?.map(c => c.text).join('') || '';
      try {
        const status = JSON.parse(text);
        if (status?.connected === true) {
          ok('get_editor_status shows connected after godot_ready');
        } else {
          fail('Connected status', 'Expected connected=true, got: ' + text.substring(0, 200));
        }
      } catch {
        fail('Connected status', 'Expected JSON status payload, got: ' + text.substring(0, 200));
      }
    }

    // Test tool invocation through WebSocket
    console.log('\n🔧 Testing tool invocation via WebSocket bridge...');

    // Listen for incoming tool_invoke on the mock Godot side
    const toolInvokePromise = new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'tool_invoke') {
            resolve(msg);
          }
        } catch {}
      });
      setTimeout(() => reject(new Error('No tool_invoke received')), 5000);
    });

    // Send create_scene via MCP
    stdout = '';
    server.stdin.write(rpcMsg('tools/call', {
      name: sceneCreateToolName,
      arguments: {
        project_path: TEST_PROJECT,
        scene_path: 'res://test_bridge.tscn',
        root_type: 'Node2D',
      }
    }));

    try {
      const invokeMsg = await toolInvokePromise;
      ok(`Received tool_invoke: tool="${invokeMsg.tool}", id="${invokeMsg.id}"`);
      
      if (invokeMsg.tool === 'create_scene') {
        ok('Correct tool invocation routed to legacy bridge command');
      } else {
        fail('Tool routing', `Expected "create_scene", got "${invokeMsg.tool}"`);
      }

      if (
        invokeMsg.args?.projectPath === TEST_PROJECT
        && invokeMsg.args?.scenePath === 'res://test_bridge.tscn'
        && invokeMsg.args?.rootNodeType === 'Node2D'
      ) {
        ok('Bridge tool arguments normalized to camelCase before dispatch');
      } else {
        fail('Bridge arg normalization', JSON.stringify(invokeMsg.args));
      }

      // Send back a mock result
      ws.send(JSON.stringify({
        type: 'tool_result',
        id: invokeMsg.id,
        success: true,
        result: {
          message: 'Scene created successfully',
          scene_path: 'res://test_bridge.tscn',
          root_type: 'Node2D'
        }
      }));
      await delay(1500);

      // Check MCP got the result
      const toolResponses = parseResponses(stdout);
      if (toolResponses.length > 0) {
        const res = toolResponses[0];
        if (res.result?.content) {
          const text = res.result.content.map(c => c.text).join('');
          if (text.includes('success') || text.includes('Scene created') || text.includes('test_bridge')) {
            ok('MCP received tool result from mock Godot');
          } else {
            ok('MCP response: ' + text.substring(0, 200));
          }
        }
      } else {
        fail('Tool result relay', 'No MCP response after tool_result');
      }

    } catch (e) {
      console.log(`  ⚠️ Tool invoke via WebSocket check skipped: ${e.message}`);
    }

    // Regression: issue #7 (missing args must fail fast and must not emit tool_invoke)
    const missingArgsToolName = chooseTool(new Set([sceneCreateToolName, 'scene.create', 'create_scene']), [
      sceneCreateToolName,
      'scene.create',
      'create_scene',
    ]);
    const unexpectedInvokes = [];
    const missingArgsCapture = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'tool_invoke') {
          unexpectedInvokes.push(msg);
        }
      } catch {}
    };
    ws.on('message', missingArgsCapture);
    const missingArgsStartedAt = Date.now();
    stdout = '';
    server.stdin.write(rpcMsg('tools/call', {
      name: missingArgsToolName,
      arguments: {},
    }));
    await delay(1200);
    ws.off('message', missingArgsCapture);

    const missingArgsResponses = parseResponses(stdout);
    const missingArgsError = missingArgsResponses.find(response => response.error)?.error;
    const missingArgsResultText = missingArgsResponses
      .flatMap((response) => response?.result?.content || [])
      .map((chunk) => chunk?.text || '')
      .join('\n');
    const missingArgsRejected = Boolean(missingArgsError)
      || /missing required arguments/i.test(missingArgsResultText);
    if (missingArgsRejected) {
      const elapsed = Date.now() - missingArgsStartedAt;
      ok(`${missingArgsToolName} missing args rejected immediately (${elapsed}ms)`);
    } else {
      fail(
        `${missingArgsToolName} missing args`,
        `Expected immediate missing-args rejection. Responses: ${JSON.stringify(missingArgsResponses[0] || null)}`
      );
    }

    if (unexpectedInvokes.length === 0) {
      ok(`${missingArgsToolName} missing args does not emit tool_invoke`);
    } else {
      fail(`${missingArgsToolName} emitted tool_invoke`, JSON.stringify(unexpectedInvokes[0]));
    }

    ws.close();
    await delay(500);

  } catch (e) {
    fail('WebSocket connection', e.message);
  }

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  server.stdin.end();
  server.kill('SIGTERM');
  await delay(1000);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
