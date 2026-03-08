import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gopeak-setup-test-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const utils = await import('./build/cli/utils.js');
const { setupShellHooks } = await import('./build/cli/setup.js');

assert.equal(utils.supportsShellHooks('win32', ''), false, 'Windows must not install bash/zsh hooks');
assert.equal(utils.supportsShellHooks('linux', '/bin/bash'), true, 'bash on Unix-like systems should be supported');
assert.equal(utils.supportsShellHooks('linux', '/bin/zsh'), true, 'zsh on Unix-like systems should be supported');
assert.equal(utils.supportsShellHooks('linux', ''), false, 'unknown shells should not be auto-configured');

const bashrcPath = path.join(tmpHome, '.bashrc');
const originalPlatform = process.platform;
const originalShell = process.env.SHELL;

try {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  delete process.env.SHELL;
  await setupShellHooks(['--silent']);
  assert.equal(fs.existsSync(bashrcPath), false, 'Windows silent setup should not create .bashrc');
} finally {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
}

console.log('setup hook regression checks passed');
