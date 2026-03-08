#!/usr/bin/env node
import process from 'node:process';
/**
 * E2E Test: Dynamic Tool Group Activation
 * 
 * Tests the full MCP client flow with real tool execution:
 * 1. Initialize → List tools (33 compact)
 * 2. tool_catalog search → auto-activation → re-list
 * 3. manage_tool_groups activate/deactivate/reset/status/list
 * 4. Actual tool execution after group activation
 * 5. Multi-group activation
 * 6. Error handling (invalid group names)
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'build', 'index.js');
const TEST_PROJECT = '/home/doyun/godot-new-project';

let passed = 0;
let failed = 0;
let serverProcess = null;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    failed++;
  }
}

function makeRequest(method, params, id) {
  return JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
}

function makeNotification(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GOPEAK_TOOL_PROFILE: 'compact',
        GOPEAK_TOOLS_PAGE_SIZE: '200', // large page to get all tools at once
      },
    });
    serverProcess.on('error', reject);
    setTimeout(() => resolve(serverProcess), 500);
  });
}

function sendAndReceive(proc, request, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for response`)), timeoutMs);

    const handler = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id !== undefined || parsed.method === 'notifications/tools/list_changed') {
            clearTimeout(timer);
            proc.stdout.removeListener('data', handler);
            resolve(parsed);
            return;
          }
        } catch { /* partial JSON, keep buffering */ }
      }
    };

    proc.stdout.on('data', handler);
    proc.stdin.write(request);
  });
}

// Send and collect response, ignoring any toolListChanged notifications that arrive first
function sendAndReceiveById(proc, request, expectedId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const notifications = [];
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for id=${expectedId}`)), timeoutMs);

    const handler = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete last line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === expectedId) {
            clearTimeout(timer);
            proc.stdout.removeListener('data', handler);
            resolve({ response: parsed, notifications });
            return;
          } else if (parsed.method) {
            notifications.push(parsed);
          }
        } catch { /* partial */ }
      }
    };

    proc.stdout.on('data', handler);
    proc.stdin.write(request);
  });
}

async function drainNotifications(proc, ms = 300) {
  return new Promise((resolve) => {
    const notes = [];
    const handler = (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        try { notes.push(JSON.parse(line.trim())); } catch {}
      }
    };
    proc.stdout.on('data', handler);
    setTimeout(() => {
      proc.stdout.removeListener('data', handler);
      resolve(notes);
    }, ms);
  });
}

async function run() {
  console.log('=== E2E Test: Dynamic Tool Group Activation ===\n');

  // ── Phase 1: Server startup & init ────────────────────────
  console.log('[Phase 1] Server startup & initialization');
  const proc = await startServer();
  assert(!!proc.pid, 'Server process started');

  const initReq = makeRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e-test', version: '1.0.0' },
  }, 1);

  const { response: initRes } = await sendAndReceiveById(proc, initReq, 1);
  assert(initRes.result?.capabilities?.tools?.listChanged === true, 'Server advertises listChanged: true');

  proc.stdin.write(makeNotification('notifications/initialized'));
  await new Promise(r => setTimeout(r, 200));

  // ── Phase 2: Initial tool list (33 compact) ──────────────
  console.log('\n[Phase 2] Initial tool list verification');
  const { response: listRes1 } = await sendAndReceiveById(proc,
    makeRequest('tools/list', {}, 2), 2);
  const initialTools = listRes1.result.tools;
  assert(initialTools.length === 33, `Initial tool count = ${initialTools.length} (expected 33)`);

  const toolNames1 = initialTools.map(t => t.name);
  assert(toolNames1.includes('tool.catalog'), 'tool.catalog is exposed');
  assert(toolNames1.includes('tool.groups'), 'tool.groups is exposed');
  assert(!toolNames1.includes('create_animation'), 'create_animation is hidden');
  assert(!toolNames1.includes('create_audio_bus'), 'create_audio_bus is hidden');
  assert(!toolNames1.includes('dap_set_breakpoint'), 'dap_set_breakpoint is hidden');

  // ── Phase 3: tool_catalog auto-activation ─────────────────
  console.log('\n[Phase 3] tool_catalog auto-activation');

  const { response: catRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'animation' },
    }, 3), 3);
  const catData = JSON.parse(catRes.result.content[0].text);
  assert(catData.newlyActivated?.includes('animation'), 'animation group auto-activated by catalog query');
  assert(catData.activeGroups.includes('animation'), 'animation in activeGroups');

  // Drain the toolListChanged notification
  await drainNotifications(proc, 300);

  // Re-list tools — should include animation group
  const { response: listRes2 } = await sendAndReceiveById(proc,
    makeRequest('tools/list', {}, 4), 4);
  const toolNames2 = listRes2.result.tools.map(t => t.name);
  assert(toolNames2.includes('create_animation'), 'create_animation now exposed after activation');
  assert(toolNames2.includes('add_animation_track'), 'add_animation_track now exposed');
  assert(toolNames2.includes('create_animation_tree'), 'create_animation_tree now exposed');
  assert(toolNames2.includes('add_animation_state'), 'add_animation_state now exposed');
  assert(toolNames2.includes('connect_animation_states'), 'connect_animation_states now exposed');
  assert(toolNames2.length === 33 + 5, `Tool count after animation activation = ${toolNames2.length} (expected 38)`);

  // ── Phase 4: Multi-group activation (catalog + manual) ────
  console.log('\n[Phase 4] Multi-group activation');

  // Activate audio via catalog
  const { response: catRes2 } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'audio' },
    }, 5), 5);
  const catData2 = JSON.parse(catRes2.result.content[0].text);
  assert(catData2.newlyActivated?.includes('audio'), 'audio group auto-activated by catalog');

  await drainNotifications(proc, 300);

  // Activate dap manually via tool.groups
  const { response: activateRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'activate', group: 'dap' },
    }, 6), 6);
  const activateData = JSON.parse(activateRes.result.content[0].text);
  assert(activateData.activated === 'dap', 'dap group manually activated');
  assert(activateData.wasAlreadyActive === false, 'dap was newly activated');

  await drainNotifications(proc, 300);

  // Re-list — should have animation(5) + audio(4) + dap(6) = 15 extra
  const { response: listRes3 } = await sendAndReceiveById(proc,
    makeRequest('tools/list', {}, 7), 7);
  const toolNames3 = listRes3.result.tools.map(t => t.name);
  assert(toolNames3.includes('create_audio_bus'), 'create_audio_bus exposed (audio group)');
  assert(toolNames3.includes('dap_set_breakpoint'), 'dap_set_breakpoint exposed (dap group)');
  assert(toolNames3.includes('dap_get_stack_trace'), 'dap_get_stack_trace exposed (dap group)');
  assert(toolNames3.length === 33 + 5 + 4 + 6, `Tool count with 3 groups = ${toolNames3.length} (expected 48)`);

  // ── Phase 5: manage_tool_groups status & list ──────────────
  console.log('\n[Phase 5] manage_tool_groups status & list');

  const { response: statusRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'status' },
    }, 8), 8);
  const statusData = JSON.parse(statusRes.result.content[0].text);
  assert(statusData.dynamicGroups.activeCount === 3, `Active group count = ${statusData.dynamicGroups.activeCount} (expected 3)`);
  const activeNames = statusData.dynamicGroups.groups.map(g => g.name).sort();
  assert(JSON.stringify(activeNames) === '["animation","audio","dap"]', `Active groups = ${activeNames}`);

  const { response: listGroupsRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'list' },
    }, 9), 9);
  const listGroupsData = JSON.parse(listGroupsRes.result.content[0].text);
  assert(listGroupsData.totalGroups === 34, `Total groups = ${listGroupsData.totalGroups} (expected 34)`);
  const animGroup = listGroupsData.groups.find(g => g.name === 'animation');
  assert(animGroup?.active === true, 'animation group shows as active in list');
  const navGroup = listGroupsData.groups.find(g => g.name === 'navigation');
  assert(navGroup?.active === false, 'navigation group shows as inactive in list');
  const coreSceneGroup = listGroupsData.groups.find(g => g.name === 'core_scene');
  assert(coreSceneGroup?.alwaysVisible === true, 'core_scene group is alwaysVisible');
  assert(coreSceneGroup?.type === 'core', 'core_scene has type core');
  assert(listGroupsData.coreGroups === 12, `Core groups = ${listGroupsData.coreGroups} (expected 12)`);
  assert(listGroupsData.dynamicGroups === 22, `Dynamic groups = ${listGroupsData.dynamicGroups} (expected 22)`);

  // ── Phase 6: Deactivation ──────────────────────────────────
  console.log('\n[Phase 6] Deactivation');

  const { response: deactRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'deactivate', group: 'audio' },
    }, 10), 10);
  const deactData = JSON.parse(deactRes.result.content[0].text);
  assert(deactData.deactivated === 'audio', 'audio group deactivated');
  assert(deactData.wasActive === true, 'audio was previously active');

  await drainNotifications(proc, 300);

  const { response: listRes4 } = await sendAndReceiveById(proc,
    makeRequest('tools/list', {}, 11), 11);
  const toolNames4 = listRes4.result.tools.map(t => t.name);
  assert(!toolNames4.includes('create_audio_bus'), 'create_audio_bus hidden after deactivation');
  assert(toolNames4.includes('create_animation'), 'create_animation still exposed');
  assert(toolNames4.includes('dap_set_breakpoint'), 'dap_set_breakpoint still exposed');
  assert(toolNames4.length === 33 + 5 + 6, `Tool count after audio deactivation = ${toolNames4.length} (expected 44)`);

  // ── Phase 7: Reset ──────────────────────────────────────────
  console.log('\n[Phase 7] Reset all groups');

  const { response: resetRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'reset' },
    }, 12), 12);
  const resetData = JSON.parse(resetRes.result.content[0].text);
  assert(resetData.reset === true, 'Reset confirmed');
  assert(resetData.deactivated.length === 2, `Deactivated ${resetData.deactivated.length} groups (animation + dap)`);

  await drainNotifications(proc, 300);

  const { response: listRes5 } = await sendAndReceiveById(proc,
    makeRequest('tools/list', {}, 13), 13);
  assert(listRes5.result.tools.length === 33, `After reset: ${listRes5.result.tools.length} tools (expected 33)`);

  // ── Phase 8: Actual tool execution after activation ─────────
  console.log('\n[Phase 8] Actual tool execution after group activation');

  // Activate autoload group and call list_autoloads with real project
  const { response: actAutoload } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'activate', group: 'autoload' },
    }, 14), 14);
  assert(JSON.parse(actAutoload.result.content[0].text).activated === 'autoload', 'autoload group activated');

  await drainNotifications(proc, 300);

  // Call list_autoloads (a hidden tool now activated)
  const { response: autoloadRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'list_autoloads',
      arguments: { projectPath: TEST_PROJECT },
    }, 15), 15, 15000);
  const autoloadOk = !autoloadRes.error;
  assert(autoloadOk, `list_autoloads executed successfully (real tool call)`);
  if (autoloadRes.result?.content?.[0]?.text) {
    const autoloadData = JSON.parse(autoloadRes.result.content[0].text);
    assert(typeof autoloadData === 'object', `list_autoloads returned valid data`);
  }

  // Activate dx_tools and call get_project_health
  const { response: actDx } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'activate', group: 'dx_tools' },
    }, 16), 16);
  assert(JSON.parse(actDx.result.content[0].text).activated === 'dx_tools', 'dx_tools group activated');

  await drainNotifications(proc, 300);

  const { response: healthRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'get_project_health',
      arguments: { projectPath: TEST_PROJECT },
    }, 17), 17, 15000);
  assert(!healthRes.error, `get_project_health executed successfully (real tool call)`);

  // ── Phase 9: Error handling ──────────────────────────────────
  console.log('\n[Phase 9] Error handling');

  const { response: badGroupRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'activate', group: 'nonexistent_group' },
    }, 18), 18);
  const badData = JSON.parse(badGroupRes.result.content[0].text);
  assert(badData.error?.includes('Unknown group'), `Invalid group returns error: ${badData.error?.substring(0, 50)}...`);

  // Duplicate activation should be idempotent
  const { response: dupRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'activate', group: 'autoload' },
    }, 19), 19);
  const dupData = JSON.parse(dupRes.result.content[0].text);
  assert(dupData.wasAlreadyActive === true, 'Duplicate activation is idempotent');

  // ── Phase 10: Keyword-based catalog activation ────────────
  console.log('\n[Phase 10] Keyword-based catalog activation');

  // Reset first
  await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.groups',
      arguments: { action: 'reset' },
    }, 20), 20);
  await drainNotifications(proc, 300);

  // Search for "breakpoint" should activate dap group via keyword match
  const { response: bpRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'breakpoint' },
    }, 21), 21);
  const bpData = JSON.parse(bpRes.result.content[0].text);
  assert(bpData.activeGroups.includes('dap'), 'Keyword "breakpoint" activates dap group');

  await drainNotifications(proc, 300);

  // Search for "theme" should activate theme_ui group
  const { response: themeRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'theme' },
    }, 22), 22);
  const themeData = JSON.parse(themeRes.result.content[0].text);
  assert(themeData.activeGroups.includes('theme_ui'), 'Keyword "theme" activates theme_ui group');

  await drainNotifications(proc, 300);

  // Search for "navigate" should NOT activate navigation (keyword is "navigation" not "navigate")
  // Actually "navigation" keyword includes "nav" prefix... let me test "pathfinding"
  const { response: navRes } = await sendAndReceiveById(proc,
    makeRequest('tools/call', {
      name: 'tool.catalog',
      arguments: { query: 'pathfinding' },
    }, 23), 23);
  const navData = JSON.parse(navRes.result.content[0].text);
  assert(navData.activeGroups.includes('navigation'), 'Keyword "pathfinding" activates navigation group');

  // ── Summary ────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}`);

  // Cleanup
  serverProcess.kill('SIGTERM');
  process.exit(failed > 0 ? 1 : 0);
}

// Error handling
process.on('exit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
});
process.on('SIGINT', () => {
  if (serverProcess) serverProcess.kill('SIGTERM');
  process.exit(1);
});

run().catch((err) => {
  console.error('Test runner error:', err);
  if (serverProcess) serverProcess.kill('SIGTERM');
  process.exit(1);
});
