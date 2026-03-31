#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const packOutput = execFileSync(npmCmd, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

const packEntries = JSON.parse(packOutput);
assert.ok(Array.isArray(packEntries) && packEntries.length > 0, 'npm pack --json should return at least one entry');

const packedFiles = new Set((packEntries[0].files || []).map((file) => file.path));

assert.ok(packedFiles.has('build/cli.js'), 'published package should include build/cli.js');
assert.ok(packedFiles.has('build/index.js'), 'published package should include build/index.js');

const postinstallScript = pkg.scripts?.postinstall;
assert.equal(typeof postinstallScript, 'string', 'package.json should define a postinstall script');

const nodeScriptMatch = postinstallScript.match(/\bnode\s+([^\s]+)/);
assert.ok(nodeScriptMatch, `postinstall should execute a concrete node script: ${postinstallScript}`);

const postinstallTarget = nodeScriptMatch[1];
assert.ok(
  packedFiles.has(postinstallTarget),
  `published package must include the postinstall target referenced by package.json: ${postinstallTarget}`,
);

console.log('packaging consistency regression checks passed');
