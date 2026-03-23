#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const serverManifest = JSON.parse(fs.readFileSync(new URL('./server.json', import.meta.url), 'utf8'));

assert.equal(serverManifest.version, pkg.version, 'server.json version should match package.json');
assert.equal(serverManifest.packages?.[0]?.identifier, pkg.name, 'server.json package identifier should match package name');
assert.equal(serverManifest.packages?.[0]?.version, pkg.version, 'server.json package version should match package version');
assert.match(pkg.description, /GoPeak/i, 'package description should use GoPeak branding');
assert.match(serverManifest.description, /GoPeak/i, 'server manifest description should use GoPeak branding');

const versionOutput = execFileSync(process.execPath, ['./build/cli.js', 'version'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();
assert.equal(versionOutput, `gopeak v${pkg.version}`, 'CLI version output should stay in sync with package.json');

const child = spawn(process.execPath, ['./build/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    GOPEAK_TOOL_PROFILE: 'compact',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  await delay(500);
  assert.equal(child.exitCode, null, `build/index.js exited during startup: ${stderr}`);

  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'metadata-test', version: '1.0.0' },
    },
  })}\n`);

  const deadline = Date.now() + 10000;
  let initResponse;
  while (Date.now() < deadline && !initResponse) {
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === 1) {
          initResponse = parsed;
          break;
        }
      } catch {
        // ignore non-JSON lines
      }
    }
    if (!initResponse) {
      await delay(100);
    }
  }

  assert.ok(initResponse, `initialize response missing. stderr: ${stderr}`);
  assert.equal(initResponse.error, undefined, `initialize failed: ${JSON.stringify(initResponse.error)}`);
  assert.equal(initResponse.result?.serverInfo?.name, pkg.name, 'initialize should report package-aligned server name');
  assert.equal(initResponse.result?.serverInfo?.version, pkg.version, 'initialize should report package-aligned server version');
  assert.equal(initResponse.result?.capabilities?.tools?.listChanged, true, 'initialize should advertise listChanged tool capability');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2000),
    ]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(2000),
      ]);
    }
  }
}

console.log('metadata consistency regression checks passed');
