#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createBridge } from './build/godot-bridge.js';

const INDEX_SOURCE = readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
const CLI_NOTIFY_SOURCE = readFileSync(new URL('./src/cli/notify.ts', import.meta.url), 'utf8');
const OPERATIONS_SOURCE = readFileSync(new URL('./src/scripts/godot_operations.gd', import.meta.url), 'utf8');
const RUNTIME_SOURCE = readFileSync(new URL('./src/addon/godot_mcp_runtime/mcp_runtime_autoload.gd', import.meta.url), 'utf8');

function makeRequest(method, params, id) {
  return JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
}

async function waitForJsonLine(stream, predicate, timeoutMs = 15000) {
  let buffer = '';
  const start = Date.now();

  return await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (predicate(parsed)) {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {
          // ignore partial/non-json lines
        }
      }

      if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error('Timed out waiting for JSON-RPC response'));
      }
    };

    const cleanup = () => {
      stream.off('data', onData);
    };

    stream.on('data', onData);
  });
}

async function withOccupiedBridgePort(run) {
  const blocker = createServer();
  const blockerState = await new Promise((resolve, reject) => {
    blocker.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        resolve({ alreadyOccupied: true });
        return;
      }
      reject(error);
    });
    blocker.listen(6505, '127.0.0.1', () => resolve({ alreadyOccupied: false }));
  });

  try {
    return await run();
  } finally {
    if (!blockerState.alreadyOccupied) {
      await new Promise((resolve, reject) => blocker.close((err) => (err ? reject(err) : resolve())));
    }
  }
}

class FakeSocket extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.readyState = 1;
    this.sent = [];
  }

  send(payload) {
    this.sent.push(payload);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }
}

function resolveGodotPath() {
  const candidates = [
    process.env.GODOT_PATH,
    '/home/yun/.local/bin/godot4',
    '/home/yun/.local/bin/godot',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function testStaleDisconnectRegression() {
  const bridge = createBridge(0, 1000, '127.0.0.1');
  const first = new FakeSocket('first');
  const second = new FakeSocket('second');

  bridge.handleConnection(first);
  assert.equal(bridge.getStatus().connected, true, 'first socket should be connected');

  first.readyState = 3;
  bridge.handleConnection(second);
  assert.equal(bridge.getStatus().connected, true, 'second socket should be connected');

  first.emit('close', 1000, Buffer.from('late close from stale socket'));
  assert.equal(bridge.getStatus().connected, true, 'stale close must not disconnect the replacement socket');

  second.emit('close', 1000, Buffer.from('active socket closed'));
  assert.equal(bridge.getStatus().connected, false, 'active socket close should disconnect bridge');
}

function testSceneToolsVectorRegression() {
  const godotPath = resolveGodotPath();
  if (!godotPath) {
    console.log('scene tools vector regression skipped (Godot not found)');
    return;
  }

  const projectDir = mkdtempSync(join(tmpdir(), 'gopeak-regression-'));
  try {
    mkdirSync(join(projectDir, 'addons', 'godot_mcp_editor', 'tools'), { recursive: true });
    mkdirSync(join(projectDir, 'scenes'), { recursive: true });
    cpSync('src/addon/godot_mcp_editor/tools/scene_tools.gd', join(projectDir, 'addons', 'godot_mcp_editor', 'tools', 'scene_tools.gd'));

    writeFileSync(join(projectDir, 'project.godot'), `; Engine configuration file.\n; It's best edited using the editor.\nconfig_version=5\n\n[application]\nconfig/name="GopeakRegression"\n`);

    writeFileSync(join(projectDir, 'runner.gd'), `extends SceneTree\n\nfunc _fail(message: String) -> void:\n\tprinterr(message)\n\tquit(1)\n\nfunc _init() -> void:\n\tvar root := Node2D.new()\n\troot.name = "Root"\n\tvar packed := PackedScene.new()\n\tif packed.pack(root) != OK:\n\t\t_fail("failed to pack root scene")\n\t\treturn\n\tif ResourceSaver.save(packed, "res://scenes/Test.tscn") != OK:\n\t\t_fail("failed to save root scene")\n\t\treturn\n\troot.queue_free()\n\n\tvar scene_tools = load("res://addons/godot_mcp_editor/tools/scene_tools.gd").new()\n\tvar project_path := ProjectSettings.globalize_path("res://")\n\n\tvar add_result: Dictionary = scene_tools.add_node({\n\t\t"projectPath": project_path,\n\t\t"scenePath": "res://scenes/Test.tscn",\n\t\t"nodeType": "Node2D",\n\t\t"nodeName": "TestNode",\n\t\t"parentNodePath": ".",\n\t\t"properties": {\n\t\t\t"position": {"x": 100, "y": 200},\n\t\t\t"scale": {"_type": "Vector2", "x": 2, "y": 2}\n\t\t}\n\t})\n\tif not add_result.get("ok", false):\n\t\t_fail("add_node failed: %s" % JSON.stringify(add_result))\n\t\treturn\n\n\tvar set_result: Dictionary = scene_tools.set_node_properties({\n\t\t"projectPath": project_path,\n\t\t"scenePath": "res://scenes/Test.tscn",\n\t\t"nodePath": "TestNode",\n\t\t"properties": {\n\t\t\t"position": [300, 400]\n\t\t}\n\t})\n\tif not set_result.get("ok", false):\n\t\t_fail("set_node_properties failed: %s" % JSON.stringify(set_result))\n\t\treturn\n\n\tvar loaded := load("res://scenes/Test.tscn") as PackedScene\n\tif loaded == null:\n\t\t_fail("failed to reload saved scene")\n\t\treturn\n\n\tvar instance := loaded.instantiate()\n\tvar node := instance.get_node_or_null("TestNode") as Node2D\n\tif node == null:\n\t\t_fail("saved node missing")\n\t\treturn\n\n\tif node.position != Vector2(300, 400):\n\t\t_fail("position mismatch: %s" % node.position)\n\t\treturn\n\tif node.scale != Vector2(2, 2):\n\t\t_fail("scale mismatch: %s" % node.scale)\n\t\treturn\n\n\tprint(JSON.stringify({"ok": true, "position": [node.position.x, node.position.y], "scale": [node.scale.x, node.scale.y]}))\n\tinstance.queue_free()\n\tquit(0)\n`);

    const run = spawnSync(godotPath, ['--headless', '--path', projectDir, '--script', join(projectDir, 'runner.gd')], {
      encoding: 'utf8',
      timeout: 120000,
    });

    if (run.status !== 0) {
      throw new Error((run.stderr || run.stdout || `godot exited ${run.status}`).trim());
    }

    const output = `${run.stdout}\n${run.stderr}`;
    assert.match(output, /"ok"\s*:\s*true/, 'runner should report success JSON');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

async function testEditorStatusPortConflict() {
  await withOccupiedBridgePort(async () => {
    const proc = spawn(process.execPath, ['./build/index.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GOPEAK_TOOL_PROFILE: 'compact',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderrChunks = [];
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

    try {
      await delay(500);
      assert.equal(proc.exitCode, null, 'server should stay alive when the bridge port is occupied');

      proc.stdin.write(makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'regression-test', version: '1.0.0' },
      }, 1));
      await waitForJsonLine(proc.stdout, (msg) => msg.id === 1);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

      proc.stdin.write(makeRequest('tools/call', { name: 'get_editor_status', arguments: {} }, 2));
      const response = await waitForJsonLine(proc.stdout, (msg) => msg.id === 2);
      const payload = JSON.parse(response.result.content[0].text);
      assert.equal(payload.bridgeAvailable, false);
      assert.match(payload.startupError ?? '', /EADDRINUSE/i);
      assert.match(payload.note ?? '', /Another gopeak instance may own the editor bridge/i);
    } finally {
      proc.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => proc.once('exit', resolve)),
        delay(2000),
      ]);
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
    }
  });
}

async function main() {
  testStaleDisconnectRegression();
  testSceneToolsVectorRegression();
  assert.match(INDEX_SOURCE, /key\.startsWith\('_'\)/, 'index.ts should preserve sentinel keys like _type during parameter normalization');
  assert.match(INDEX_SOURCE, /@file:/, 'index.ts should pass operation params via @file: temp payloads');
  assert.match(
    INDEX_SOURCE,
    /private async handleRunProject[\s\S]*?const cmdArgs = \[[^\]]*'--headless'[^\]]*'-d'[^\]]*'--path'[^\]]*args\.projectPath[^\]]*\]/,
    'run_project should launch Godot with --headless in handleRunProject cmdArgs',
  );
  assert.match(
    CLI_NOTIFY_SOURCE,
    /const wantsStar = await askYesNo\('[^']*Star GoPeak on GitHub\? \(y\/n\): '\);\s*\n\s*if \(wantsStar\) \{\s*\n\s*await handleStar\(\);/m,
    'star prompt should call handleStar only when the user accepts',
  );
  assert.match(OPERATIONS_SOURCE, /params_json\.begins_with\("@file:"\)/, 'godot_operations.gd should load params from @file: payloads');
  assert.match(
    INDEX_SOURCE,
    /export function scanDirectoryForGodotBinaries/,
    'index.ts should export scanDirectoryForGodotBinaries for versioned-binary detection',
  );
  assert.match(
    INDEX_SOURCE,
    /Godot_v4\.4\.1-stable_win64\.exe/,
    'index.ts detection scanner doc should reference versioned Windows binaries from Issue #67',
  );
  assert.match(
    INDEX_SOURCE,
    /scanDirectoryForGodotBinaries\(dir, osPlatform\)/,
    'detectGodotPath should call the versioned-binary scanner as a fallback before giving up',
  );
  assert.match(
    RUNTIME_SOURCE,
    /client\.poll\(\)\s*\n\s*if client\.get_status\(\) != StreamPeerTCP\.STATUS_CONNECTED:\s*\n\s*clients_to_remove\.append\(client\)\s*\n\s*continue\s*\n\s*var available = client\.get_available_bytes\(\)/m,
    'runtime autoload should re-check socket status after poll() before get_available_bytes()',
  );
  assert.match(
    RUNTIME_SOURCE,
    /if params\.has\("x"\) and params\.has\("y"\):\s*\n\s*position = Vector2\(float\(params\["x"\]\), float\(params\["y"\]\)\)/m,
    'runtime input injection should accept flat x/y coordinates from the MCP tool schema',
  );
  assert.match(
    RUNTIME_SOURCE,
    /if params\.has\("relativeX"\) and params\.has\("relativeY"\):\s*\n\s*relative = Vector2\(float\(params\["relativeX"\]\), float\(params\["relativeY"\]\)\)/m,
    'runtime mouse motion should accept flat relativeX/relativeY coordinates from the MCP tool schema',
  );
  assert.match(
    RUNTIME_SOURCE,
    /func _resolve_mouse_button\(raw: Variant\) -> int:/,
    'runtime mouse injection should resolve string button names before assigning button_index',
  );
  assert.match(
    RUNTIME_SOURCE,
    /if keycode_raw is String and not \(keycode_raw as String\)\.is_empty\(\) and key_label\.is_empty\(\):\s*\n\s*key_label = keycode_raw as String/m,
    'runtime key injection should treat string keycode values as key labels',
  );

  assert.doesNotMatch(
    OPERATIONS_SOURCE,
    /include_built_in and \(dep_path\.contains\("addons\/"\)/,
    'addons/ is project content and often ships, so dependency analysis must not skip it as built-in',
  );
  assert.match(
    INDEX_SOURCE,
    /maxDepth:[\s\S]*?includeBuiltIn:/,
    'get_dependencies must send the names the operation script reads, max_depth and include_built_in',
  );

  await testEditorStatusPortConflict();
  console.log('regression tests passed');
}

await main();
